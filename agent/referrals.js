'use strict';
const referralStatusLabels={pending:'Purchase pending',successful:'Eligible · 1 USDT',review:'Under review'};
const payoutStatusLabels={claimable:'Ready to claim',awaiting_confirmation:'Processing · owner review',approved_pending_wallet:'Processing · wallet setup',approved:'Processing',broadcast_pending:'Processing transfer',submitted:'Processing · confirming',paid:'Success · 1 USDT',cancelled:'Cancelled',failed:'Needs attention',review:'Under review'};
window.loadFixReferrals=async function(api,esc){
 const box=document.getElementById('referralContent');box.setAttribute('aria-busy','true');box.textContent='Loading referrals…';
 try{
 const d=await api('/referrals/dashboard'),s=d.payoutSummary||{},money=n=>(Number(n||0)/1000000).toFixed(2);
 box.innerHTML=`<header class="ref-heading"><div><p class="ref-kicker">INVITE & EARN</p><h2>A good recommendation. A $1 thank-you.</h2><p>Earn 1 USDT for each eligible friend’s first paid bot purchase. No wallet needed to create your link.</p></div><div class="ref-reward"><b>$1</b><span>USDT per referral</span></div></header>
 <div class="ref-stats"><div><span>Pending signups</span><strong>${Number(d.stats.pending||0)}</strong></div><div><span>Ready to claim</span><strong>${money(s.claimableMicros)} <small>USDT</small></strong></div><div><span>Processing</span><strong>${money(s.pendingMicros)} <small>USDT</small></strong></div><div><span>Paid</span><strong>${money(s.paidMicros)} <small>USDT</small></strong></div></div>
 <div class="ref-two-col"><section class="ref-box">${d.profile?`<h3>Your invite link</h3><div class="ref-link-row"><input id="referralLink" readonly aria-label="Referral link" value="${esc(d.profile.url)}"><button id="referralCopy" class="btn btn-ghost" type="button">Copy link</button></div><div class="ref-code-row"><div><span>Invite code</span><input id="referralCodeValue" readonly aria-label="Referral code" value="${esc(d.profile.code)}"></div><button id="referralCodeCopy" class="btn btn-ghost" type="button">Copy code</button></div><p id="refCopyMessage" class="ref-feedback" role="status" aria-live="polite" aria-atomic="true"></p>`:`<h3>Your link, ready in a click.</h3><p class="ref-muted">Share it with a new friend. Add your receiving address only when you claim an eligible reward.</p><form id="createReferralForm"><button class="btn btn-primary" type="submit">Create referral link</button><p id="referralMessage" role="status"></p></form>`}</section>
 <aside class="ref-box"><h3>Invite → Purchase → Claim</h3><p class="ref-muted">After an eligible first purchase, Claim appears beside that referral. Add a BEP20 receiving address and confirm. Allow a few hours for owner review and processing.</p><p class="ref-muted">USDT · BNB Smart Chain / BEP20. Success appears only after on-chain confirmation; its transaction link stays in your history.</p>${d.payoutsEnabled?'':'<p class="ref-notice">Transfers are waiting for payout setup. Claims can be reviewed and queued, but are not marked paid.</p>'}</aside></div>
 <section class="ref-box ref-activity"><div class="ref-activity-head"><div><h3>Your referral rewards</h3><p class="ref-muted">${Number(d.stats.total||0)} invitations · latest 200</p></div><button id="refRefresh" class="btn btn-ghost" type="button">Refresh</button></div>${d.referrals.length?`<div class="ref-table-wrap"><table class="ref-table"><thead><tr><th>Referral</th><th>Joined</th><th>Progress</th><th>Reward</th></tr></thead><tbody>${d.referrals.map(r=>`<tr><td data-label="Referral">#${Number(r.id)}</td><td data-label="Joined">${esc(new Date(r.created_at).toLocaleDateString())}</td><td data-label="Progress">${esc(referralStatusLabels[r.status]||r.status)}</td><td data-label="Reward">${r.status==='successful'&&r.payment_status==='claimable'?`<button type="button" class="btn btn-primary ref-claim" data-claim="${Number(r.id)}">Claim 1 USDT</button>`:`<span class="ref-state ${r.payment_status==='paid'?'ref-paid':''}">${esc(payoutStatusLabels[r.payment_status]||'Not eligible yet')}</span>`}${r.tx_hash&&/^0x[a-fA-F0-9]{64}$/.test(r.tx_hash)?`<a class="ref-tx" href="https://bscscan.com/tx/${esc(r.tx_hash)}" target="_blank" rel="noopener">View Tx ↗</a>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="ref-empty"><b>Your first invitation starts here.</b><p>Share your link. A signup is pending until its first eligible purchase.</p></div>'}</section>
 <dialog id="claimDialog" class="claim-dialog"><form id="claimForm"><div class="ref-activity-head"><h3>Claim 1 USDT</h3><button type="button" id="claimClose" class="btn btn-ghost" aria-label="Close claim">×</button></div><p class="ref-muted">BNB Smart Chain · BEP20 only. The receiving address cannot be changed after submission.</p><label for="claimWallet">Receiving wallet address</label><input id="claimWallet" name="walletAddress" required pattern="0x[a-fA-F0-9]{40}" placeholder="0x…" autocomplete="off" spellcheck="false"><label class="claim-confirm"><input type="checkbox" id="claimConfirm" required> I checked the address and BEP20 network.</label><p class="ref-muted">Never enter a private key or seed phrase.</p><button class="btn btn-primary" type="submit">Confirm claim</button><p id="claimMessage" role="status"></p></form></dialog>`;
 // Per-button acknowledgement; never report success unless a copy API succeeds.
 const copyTimers=new Map();
 async function copy(value,button,field,label){
  if(button.disabled)return;
  const original=button.dataset.label||(button.dataset.label=button.textContent);
  clearTimeout(copyTimers.get(button));button.disabled=true;button.textContent='Copying…';
  const feedback=document.getElementById('refCopyMessage');feedback.textContent='';
  let copied=false;
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);copied=true;}}catch{}
  if(!copied){
   field.focus();field.select();field.setSelectionRange(0,field.value.length);
   try{copied=document.execCommand('copy')===true;}catch{}
  }
  button.classList.toggle('is-copied',copied);
  button.textContent=copied?'✓ Copied!':'Copy manually';
  feedback.textContent=copied?label+' copied. Ready to share.':'Could not copy automatically. The '+label.toLowerCase()+' is selected; long-press or press Ctrl/Cmd+C to copy it.';
  if(copied)button.focus();
  button.disabled=false;
  copyTimers.set(button,setTimeout(()=>{if(button.isConnected){button.textContent=original;button.classList.remove('is-copied');}},3500));
 }
 document.getElementById('referralCopy')?.addEventListener('click',e=>copy(d.profile.url,e.currentTarget,document.getElementById('referralLink'),'Referral link'));
 document.getElementById('referralCodeCopy')?.addEventListener('click',e=>copy(d.profile.code,e.currentTarget,document.getElementById('referralCodeValue'),'Referral code'));
 document.getElementById('refRefresh').onclick=()=>window.loadFixReferrals(api,esc);
 document.getElementById('createReferralForm')?.addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('/referrals/create',{body:{}});await window.loadFixReferrals(api,esc);}catch(err){document.getElementById('referralMessage').textContent=err.message;b.disabled=false;}});
 const dialog=document.getElementById('claimDialog');let selected=null;document.getElementById('claimClose').onclick=()=>dialog.close();
 box.querySelectorAll('[data-claim]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.claim);document.getElementById('claimForm').reset();document.getElementById('claimMessage').textContent='';dialog.showModal();document.getElementById('claimWallet').focus();});
 document.getElementById('claimForm').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{await api('/referrals/claim',{body:{referralId:selected,walletAddress:document.getElementById('claimWallet').value.trim(),confirmed:document.getElementById('claimConfirm').checked}});dialog.close();await window.loadFixReferrals(api,esc);}catch(err){document.getElementById('claimMessage').textContent=err.message;b.disabled=false;}};
 }catch(err){box.textContent=err.message;}finally{box.setAttribute('aria-busy','false');}
};
