/* An approved referral is not "paid" until a successful blockchain receipt.
   Disabled by default. Signing keys are read from Worker Secrets only.
   Approved payouts are serialized, and the exact signed transaction is saved
   before broadcast. Retries broadcast the same bytes, never a new payment. */
export async function runApprovedPayouts(env,queueNotification) {
  if(env.PAYOUT_ENABLED!=='true')return;
  if(!env.BEP20_PRIVATE_KEY || !env.BEP20_RPC_URL || !env.BEP20_TOKEN_ADDRESS)return;
  const owner=crypto.randomUUID(),t=Date.now();
  const claimed=await env.DB.prepare('UPDATE payout_locks SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,t+180000,t).run();
  if(claimed.meta?.changes!==1)return;
  try{
    const {JsonRpcProvider,Wallet,Contract,Interface,Transaction,parseUnits,getAddress}=await import('ethers');
    const rpc=new URL(env.BEP20_RPC_URL);if(rpc.protocol!=='https:')throw new Error('Invalid RPC configuration');
    const provider=new JsonRpcProvider(rpc.toString(),undefined,{batchMaxCount:1});
    const network=await provider.getNetwork();
    if(network.chainId!==56n)throw new Error('BEP20 payouts require BNB Smart Chain mainnet');
    const wallet=new Wallet(env.BEP20_PRIVATE_KEY,provider);
    // Finish any persisted broadcast first. A timeout never creates a second transfer.
    const pending=await env.DB.prepare("SELECT t.*,p.status FROM payout_transactions t JOIN referral_payouts p ON p.id=t.payout_id WHERE p.status IN ('broadcast_pending','submitted') ORDER BY t.created_at LIMIT 1").first();
    if(pending){
      if(pending.chain_id!==56 || pending.payer.toLowerCase()!==wallet.address.toLowerCase())return;
      const receipt=await provider.getTransactionReceipt(pending.tx_hash);
      if(receipt){
        const confirmations=await receipt.confirmations();
        if(confirmations<3)return;
        if(receipt.status===1){
          await env.DB.batch([
            env.DB.prepare("UPDATE referral_payouts SET status='paid',tx_hash=?,error=NULL WHERE id=? AND status IN ('broadcast_pending','submitted')").bind(pending.tx_hash,pending.payout_id),
            env.DB.prepare('UPDATE payout_transactions SET confirmed_at=? WHERE payout_id=?').bind(Date.now(),pending.payout_id)
          ]);
          await queueNotification(env,'payout-paid:'+pending.payout_id,'✅ Referral payout confirmed: $1 USDT\nPayout: '+pending.payout_id+'\nTransaction: '+pending.tx_hash);
        }else{
          await env.DB.prepare("UPDATE referral_payouts SET status='failed',error='Blockchain transaction reverted. Owner review required.' WHERE id=? AND status IN ('broadcast_pending','submitted')").bind(pending.payout_id).run();
          await queueNotification(env,'payout-failed:'+pending.payout_id,'⚠️ Referral transfer failed on-chain. Do not retry blindly. Payout: '+pending.payout_id);
        }
        return;
      }
      const existing=await provider.getTransaction(pending.tx_hash);
      if(!existing){
        try{await provider.broadcastTransaction(pending.signed_tx);}catch{/* The next scan checks the same hash and bytes again. */}
      }
      await env.DB.prepare("UPDATE referral_payouts SET status='submitted' WHERE id=? AND status='broadcast_pending'").bind(pending.payout_id).run();
      return;
    }
    const payout=await env.DB.prepare("SELECT * FROM referral_payouts WHERE status IN ('approved','approved_pending_wallet') ORDER BY approved_at LIMIT 1").first();
    if(!payout)return;
    if(payout.amount_micros!==1000000)throw new Error('Unsupported reward amount');
    const recipient=getAddress(payout.wallet_address),contractAddress=getAddress(env.BEP20_TOKEN_ADDRESS);
    if(recipient.toLowerCase()===wallet.address.toLowerCase()){
      await env.DB.prepare("UPDATE referral_payouts SET status='review',error='Payout wallet cannot be its own recipient' WHERE id=?").bind(payout.id).run();return;
    }
    const token=new Contract(contractAddress,['function decimals() view returns(uint8)','function symbol() view returns(string)','function balanceOf(address) view returns(uint256)'],provider);
    const decimals=Number(await token.decimals()),symbol=await token.symbol();
    if(symbol!=='USDT'||decimals!==18)throw new Error('Configured token is not supported USDT BEP20');
    const amount=parseUnits('1',decimals);
    if(await token.balanceOf(wallet.address)<amount){await env.DB.prepare("UPDATE referral_payouts SET error='Payout wallet needs USDT' WHERE id=?").bind(payout.id).run();return;}
    const iface=new Interface(['function transfer(address,uint256) returns(bool)']);
    const request={to:contractAddress,data:iface.encodeFunctionData('transfer',[recipient,amount]),value:0n,chainId:56};
    const gas=await wallet.estimateGas(request),fees=await provider.getFeeData();
    if(!fees.gasPrice)throw new Error('Gas fee is unavailable');
    const gasLimit=gas*120n/100n;
    if(gasLimit*fees.gasPrice>1000000000000000n)throw new Error('Gas cost exceeds configured safety ceiling');
    if(await provider.getBalance(wallet.address)<gasLimit*fees.gasPrice){await env.DB.prepare("UPDATE referral_payouts SET error='Payout wallet needs BNB for gas' WHERE id=?").bind(payout.id).run();return;}
    const nonce=await provider.getTransactionCount(wallet.address,'pending');
    const signed=await wallet.signTransaction({...request,nonce,gasLimit,gasPrice:fees.gasPrice,type:0});
    const txHash=Transaction.from(signed).hash;
    const saved=await env.DB.batch([
      env.DB.prepare("UPDATE referral_payouts SET status='broadcast_pending',tx_hash=?,error=NULL WHERE id=? AND status IN ('approved','approved_pending_wallet') AND EXISTS(SELECT 1 FROM payout_locks WHERE id=1 AND owner=? AND expires_at>?)")
        .bind(txHash,payout.id,owner,Date.now()),
      env.DB.prepare('INSERT INTO payout_transactions(payout_id,signed_tx,tx_hash,chain_id,payer,nonce,created_at) SELECT ?,?,?,56,?,?,? WHERE changes()=1')
        .bind(payout.id,signed,txHash,wallet.address,nonce,Date.now())
    ]);
    if(saved[0].meta?.changes!==1)return;
    try{await provider.broadcastTransaction(signed);await env.DB.batch([
      env.DB.prepare("UPDATE referral_payouts SET status='submitted' WHERE id=? AND status='broadcast_pending'").bind(payout.id),
      env.DB.prepare('UPDATE payout_transactions SET broadcast_at=? WHERE payout_id=?').bind(Date.now(),payout.id)
    ]);}catch{/* The durable journal permits retrying this same signed transaction only. */}
  }catch{
    // Never log errors from an RPC or signer; they may contain credential details.
    await queueNotification(env,'payout-configuration:'+Math.floor(Date.now()/3600000),'⚠️ Referral payout paused. Check wallet, chain, token and gas configuration. No new transfer was marked paid.');
  }finally{await env.DB.prepare('UPDATE payout_locks SET expires_at=0 WHERE id=1 AND owner=?').bind(owner).run();}
}
