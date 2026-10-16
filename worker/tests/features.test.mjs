import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {WEBSITE_ACTIONS,validateHuman} from '../src/human.js';
import {creditQuote,grantWelcome,fulfillOrder,attachReferral,cleanupFeatures} from '../src/features.js';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../migrations/0002_credits_referrals.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../migrations/0003_payout_journal.sql',import.meta.url),'utf8'));this.db.exec(readFileSync(new URL('../migrations/0005_notification_diagnostics.sql',import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;let args=[];const p={bind(...v){args=v;return p},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},_exec(){if(/\bRETURNING\b|^\s*SELECT\b/i.test(sql))return {results:db.prepare(sql).all(...args),meta:{changes:db.prepare('SELECT changes() AS n').get().n}};const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}};return p;}
 async batch(statements){this.db.exec('BEGIN');try{const out=statements.map(s=>s._exec());this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
}
const key='FIX-TESTAA-TESTBB-TESTCC-TESTDD';
function setup(){const env={DB:new D1(),JWT_SECRET:'test-only-secret',TURNSTILE_SECRET:'test-turnstile-secret',SITE_ORIGIN:'https://fixasif.com',OPENAI_API_KEY:'test-only',AI_MODEL:'test-model',AI_ENDPOINT:'https://api.openai.com/v1/chat/completions',TELEGRAM_CHAT_ID:'123',TELEGRAM_WEBHOOK_SECRET:'test-hook'};env.DB.db.prepare("INSERT INTO access_keys(id,key,status,expires_at,x_username,user_id) VALUES (1,?,'sold',?,'alice',1)").run(key,Date.now()+86400000);return env;}
async function call(env,path,data,token){if(data&&WEBSITE_ACTIONS[path])data={...data,turnstileToken:data.turnstileToken||'action:'+WEBSITE_ACTIONS[path]};const req=new Request('https://worker.test'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'CF-Connecting-IP':'10.1.1.1'},body:data?JSON.stringify(data):undefined});const pending=[];const res=await worker.fetch(req,env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return {status:res.status,data:await res.json()};}
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,opts)=>{const u=String(input);if(u.includes('api.openai.com'))return Response.json({choices:[{message:{content:'A useful reply'}}]});if(u.includes('api.telegram.org'))return Response.json({ok:true});if(u.includes('turnstile')){return Response.json({success:true,hostname:'fixasif.com',action:opts.body.get('response').startsWith('action:')?opts.body.get('response').slice(7):undefined});}return realFetch(input,opts)};
test('all boundaries use integer micro-dollar calculations',()=>{for(const [n,rate,total] of [[500,200,.1],[999,200,.1998],[1000,180,.18],[4999,180,.89982],[5000,160,.8],[5001,160,.80016],[19999,160,3.19984],[20000,150,3],[49999,150,7.49985],[50000,140,7],[50001,140,7.00014]]){assert.equal(creditQuote(n).unitMicros,rate);assert.equal(creditQuote(n).amount,total)}for(const n of [0,499,500.5,NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>creditQuote(n));});
test('welcome credits are issued once, including repeated key verification',async()=>{const env=setup();await grantWelcome(env,1);await grantWelcome(env,1);let r=await call(env,'/credits/balance',{accessKey:key});assert.equal(r.data.balance,300);assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get().n,1);});
test('topup fulfillment is atomic and idempotent',async()=>{const env=setup();await grantWelcome(env,1);const order={id:10,kind:'credits',credit_key_id:1,credit_quantity:734,amount:.1468,x_username:'alice'};await fulfillOrder(env,order,{email:'a@test.example'});await fulfillOrder(env,order,{email:'a@test.example'});const wallet=env.DB.db.prepare('SELECT * FROM credit_wallets').get();assert.equal(wallet.balance,1034);assert.equal(wallet.purchased,734);assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);});
test('generation, cached retry, successful settlement and one-time failed-post refund',async()=>{const env=setup();const b={accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'A real post'};let r=await call(env,'/credits/generate',b);assert.equal(r.status,200);assert.equal(r.data.balance,299);r=await call(env,'/credits/generate',b);assert.equal(r.data.balance,299);r=await call(env,'/credits/settle',{...b,posted:false});assert.equal(r.data.balance,300);r=await call(env,'/credits/settle',{...b,posted:false});assert.equal(r.data.balance,300);const b2={...b,requestId:crypto.randomUUID()};await call(env,'/credits/generate',b2);await call(env,'/credits/settle',{...b2,posted:true});r=await call(env,'/credits/settle',{...b2,posted:false});assert.equal(r.data.balance,299);});
test('failed provider call returns the credit without leaking provider details',async()=>{const env=setup(),old=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{message:'secret upstream detail'}},{status:401});try{const r=await call(env,'/credits/generate',{accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'A post'});assert.equal(r.status,502);assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,300);assert.ok(!JSON.stringify(r.data).includes('upstream'));}finally{globalThis.fetch=old}});
test('prompt limit and identity binding cannot be bypassed',async()=>{const env=setup();const b={accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Post'};assert.equal((await call(env,'/credits/generate',{...b,stylePrompt:'অ'.repeat(501)})).status,400);assert.equal((await call(env,'/credits/generate',{...b,xUsername:'mallory'})).status,403);assert.equal((await call(env,'/credits/generate',{...b,stylePrompt:'😍'.repeat(500)})).status,200);});
test('cannot overspend the last credit',async()=>{const env=setup();await grantWelcome(env,1);env.DB.db.exec('UPDATE credit_wallets SET balance=1');const b={accessKey:key,xUsername:'alice',tweetText:'Post'};const first=await call(env,'/credits/generate',{...b,requestId:crypto.randomUUID()});const second=await call(env,'/credits/generate',{...b,requestId:crypto.randomUUID()});assert.equal(first.status,200);assert.equal(second.status,402);assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,0);});
test('one successful referral reward per referred buyer and no self-referral',async()=>{const env=setup();env.DB.db.prepare('INSERT INTO referral_profiles(user_id,code,wallet_address,created_at) VALUES (2,?,?,?)').run('ABCDEF1234567890','0x'+'1'.repeat(40),Date.now());await attachReferral(env,{id:2},'ABCDEF1234567890','127.0.0.1');assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM referrals').get().n,0);await attachReferral(env,{id:1},'ABCDEF1234567890','127.0.0.2');const order={id:1,kind:'license',package:'starter',amount:5,x_username:'alice'};await fulfillOrder(env,order,{id:1,email:'a@test.example'},[{key}]);await fulfillOrder(env,{...order,id:2},{id:1,email:'a@test.example'},[{key}]);assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM referral_payouts').get().n,1);assert.equal(env.DB.db.prepare('SELECT status FROM referrals').get().status,'successful');});
test('Telegram webhook authenticates secret and owner, never falsely marks a payment paid',async()=>{const env=setup();const payout=crypto.randomUUID();env.DB.db.prepare('INSERT INTO referral_payouts(id,referral_id,user_id,wallet_address,created_at) VALUES (?,1,2,?,?)').run(payout,'0x'+'1'.repeat(40),Date.now());const b={callback_query:{id:'1',from:{id:123},message:{chat:{id:123}},data:'rp:c:'+payout}};assert.equal((await call(env,'/telegram/webhook',b)).status,403);async function hook(data){const res=await worker.fetch(new Request('https://worker.test/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-hook'},body:JSON.stringify(data)}),env,{waitUntil(){}});return res.status;}assert.equal(await hook({...b,callback_query:{...b.callback_query,from:{id:456}}}),403);assert.equal(await hook(b),200);assert.equal(env.DB.db.prepare('SELECT status FROM referral_payouts').get().status,'approved_pending_wallet');assert.equal(await hook({...b,callback_query:{...b.callback_query,data:'rp:x:'+payout}}),200);assert.equal(env.DB.db.prepare('SELECT status FROM referral_payouts').get().status,'approved_pending_wallet');});
test('another signed-in account may top up a key without changing its owner',async()=>{const env=setup();const signup=await call(env,'/auth/signup',{email:'new@test.example',password:'test-password',name:'New'});assert.equal(signup.status,200);env.DB.db.exec('UPDATE access_keys SET user_id=2');const result=await call(env,'/credits/order',{accessKey:key,quantity:500},signup.data.token);assert.equal(result.status,200);const destination=env.DB.db.prepare('SELECT user_id FROM access_keys WHERE id=1').get();assert.equal(destination.user_id,2);const o=env.DB.db.prepare('SELECT user_id,credit_key_id FROM orders WHERE id=?').get(result.data.orderId);assert.equal(o.user_id,1);assert.equal(o.credit_key_id,1);});
test('verified topup adds the exact quantity once and rejects payment reuse by aliases',async()=>{
 const env=setup();env.BINANCE_API_KEY='test';env.BINANCE_SECRET='test';env.BINANCE_UID='516036906';
 const user=await call(env,'/auth/signup',{email:'buyer@test.example',password:'test-password',name:'Buyer'});
 const order=await call(env,'/credits/order',{accessKey:key,quantity:734},user.data.token);assert.equal(order.status,200);assert.equal(order.data.amount,.1468);
 const prior=globalThis.fetch;globalThis.fetch=async(input,opts)=>{
  if(String(input).includes('/sapi/v1/pay/transactions'))return Response.json({code:'000000',data:[{transactionId:'canonical1234',orderId:'alias1234',currency:'USDT',amount:'0.1468',transactionTime:Date.now(),receiverInfo:{binanceId:'516036906'}}]});
  return prior(input,opts);
 };
 try{
  let result=await call(env,'/verify',{orderId:order.data.orderId,binanceOrderId:'alias1234',turnstileToken:'mock'},user.data.token);assert.equal(result.status,200);assert.equal(result.data.quantity,734);
  result=await call(env,'/verify',{orderId:order.data.orderId,binanceOrderId:'alias1234',turnstileToken:'mock'},user.data.token);assert.equal(result.status,200);assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,1034);
  const second=await call(env,'/credits/order',{accessKey:key,quantity:734},user.data.token);
  result=await call(env,'/verify',{orderId:second.data.orderId,binanceOrderId:'canonical1234',turnstileToken:'mock'},user.data.token);assert.equal(result.status,409);assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,1034);
 }finally{globalThis.fetch=prior;}
});
test('topup rejects a different transferred amount',async()=>{
 const env=setup();env.BINANCE_API_KEY='test';env.BINANCE_SECRET='test';const user=await call(env,'/auth/signup',{email:'amount@test.example',password:'test-password'});
 const order=await call(env,'/credits/order',{accessKey:key,quantity:500},user.data.token),prior=globalThis.fetch;
 globalThis.fetch=async(input,opts)=>String(input).includes('/sapi/v1/pay/transactions')?Response.json({code:'000000',data:[{transactionId:'amount1234',currency:'USDT',amount:'0.2',transactionTime:Date.now()}]}):prior(input,opts);
 try{const result=await call(env,'/verify',{orderId:order.data.orderId,binanceOrderId:'amount1234',turnstileToken:'mock'},user.data.token);assert.equal(result.status,400);assert.equal(result.data.error,'amount_mismatch');assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,300);}finally{globalThis.fetch=prior;}
});
test('referral dashboard separates paid and queued rewards, excluding cancelled rewards',async()=>{
 const env=setup();const user=await call(env,'/auth/signup',{email:'ref-owner@test.example',password:'test-password'});
 for(const [i,status] of [[11,'paid'],[12,'awaiting_confirmation'],[13,'cancelled']])env.DB.db.prepare('INSERT INTO referral_payouts(id,referral_id,user_id,wallet_address,status,created_at) VALUES (?,?,?,?,?,?)').run(String(i),i,1,'0x'+'1'.repeat(40),status,Date.now());
 const r=await call(env,'/referrals/dashboard',null,user.data.token);assert.equal(r.status,200);assert.equal(r.data.payoutSummary.paidMicros,1000000);assert.equal(r.data.payoutSummary.pendingMicros,1000000);
});
test('wallet diagnostics never expose balances without owner authorization',async()=>{
 const env=setup();env.OWNER_ADMIN_SECRET='owner-test-only';const r=await call(env,'/admin/payout-status');assert.equal(r.status,403);assert.ok(!('address' in r.data));
});
test('referral links need no address; reward claim validates and locks each receiving address',async()=>{
 const env=setup(),user=await call(env,'/auth/signup',{email:'claim-owner@test.example',password:'test-password'});
 let r=await call(env,'/referrals/create',{},user.data.token);assert.equal(r.status,200);assert.ok(r.data.url);assert.equal(env.DB.db.prepare('SELECT wallet_address FROM referral_profiles').get().wallet_address,'');
 env.DB.db.prepare("INSERT INTO referrals(id,referrer_id,referred_id,status,created_at) VALUES (100,1,2,'successful',?)").run(Date.now());
 env.DB.db.prepare("INSERT INTO referral_payouts(id,referral_id,user_id,wallet_address,status,created_at) VALUES ('claim-test',100,1,'','claimable',?)").run(Date.now());
 const base={referralId:100,confirmed:true};assert.equal((await call(env,'/referrals/claim',{...base,walletAddress:'0x'+'0'.repeat(40)},user.data.token)).status,400);
 assert.equal((await call(env,'/referrals/claim',{...base,walletAddress:'0xFd15B779576ff6460dc81CAf0462028607bd0493'},user.data.token)).status,400);
 assert.equal((await call(env,'/referrals/claim',{...base,confirmed:false,walletAddress:'0x'+'1'.repeat(40)},user.data.token)).status,400);
 r=await call(env,'/referrals/claim',{...base,walletAddress:'0x'+'1'.repeat(40)},user.data.token);assert.equal(r.status,200);assert.equal(r.data.status,'awaiting_confirmation');
 assert.equal((await call(env,'/referrals/claim',{...base,walletAddress:'0x'+'1'.repeat(40)},user.data.token)).status,200);
 assert.equal((await call(env,'/referrals/claim',{...base,walletAddress:'0x'+'2'.repeat(40)},user.data.token)).status,409);
 assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE event_id='claim:claim-test'").get().n,1);
 const other=await call(env,'/auth/signup',{email:'not-owner@test.example',password:'test-password'});assert.equal((await call(env,'/referrals/claim',{...base,walletAddress:'0x'+'1'.repeat(40)},other.data.token)).status,404);
});

test('friend payment credits the destination key once; the license owner cannot verify the friend order',async()=>{
 const env=setup();env.BINANCE_API_KEY='test';env.BINANCE_SECRET='test';env.BINANCE_UID='516036906';
 const owner=await call(env,'/auth/signup',{email:'owner@test.example',password:'test-password'});
 const friend=await call(env,'/auth/signup',{email:'friend@test.example',password:'test-password'});
 const missing=await call(env,'/credits/order',{quantity:734},friend.data.token);assert.equal(missing.status,401);
 const order=await call(env,'/credits/order',{accessKey:key,quantity:734},friend.data.token);assert.equal(order.status,200);assert.equal(order.data.xUsername,'alice');
 const prior=globalThis.fetch;globalThis.fetch=async(input,opts)=>String(input).includes('/sapi/v1/pay/transactions')?Response.json({code:'000000',data:[{transactionId:'friend-canonical123',orderId:'friend-alias123',currency:'USDT',amount:'0.1468',transactionTime:Date.now(),receiverInfo:{binanceId:'516036906'}}]}):prior(input,opts);
 try{
  const payload={orderId:order.data.orderId,binanceOrderId:'friend-alias123',turnstileToken:'mock'};
  assert.equal((await call(env,'/verify',payload,owner.data.token)).status,404);
  assert.equal((await call(env,'/verify',payload,friend.data.token)).status,200);
  assert.equal((await call(env,'/verify',payload,friend.data.token)).status,200);
  assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets WHERE key_id=1').get().balance,1034);
  const k=env.DB.db.prepare('SELECT user_id,x_username FROM access_keys WHERE id=1').get();assert.equal(k.user_id,1);assert.equal(k.x_username,'alice');
 }finally{globalThis.fetch=prior;}
});
test('username lookup requires a paid bot purchase, shows its credit balance but never the key or email',async()=>{
 const env=setup();const owner=await call(env,'/auth/signup',{email:'username-owner@test.example',password:'test-password'});const friend=await call(env,'/auth/signup',{email:'username-friend@test.example',password:'test-password'});
 assert.equal((await call(env,'/credits/resolve',{xUsername:'alice'},friend.data.token)).status,404);
 env.DB.db.prepare("INSERT INTO orders(id,package,amount,status,created_at,expires_at,user_id,x_username,kind) VALUES (100,'starter',5,'pending',?,?,1,'alice','license')").run(Date.now(),Date.now()+86400000);env.DB.db.exec('UPDATE access_keys SET order_id=100');
 assert.equal((await call(env,'/credits/resolve',{xUsername:'alice'},friend.data.token)).status,404);
 env.DB.db.exec("UPDATE orders SET status='paid' WHERE id=100");
 assert.equal((await call(env,'/credits/resolve',{xUsername:'alice'})).status,401);const r=await call(env,'/credits/resolve',{xUsername:'@ALICE'},friend.data.token);assert.equal(r.status,200);assert.deepEqual(Object.keys(r.data).sort(),['balance','destinationPolicy','ok','xUsername']);assert.equal(r.data.xUsername,'alice');assert.equal(r.data.balance,300);env.DB.db.exec('UPDATE credit_wallets SET balance=125 WHERE key_id=1');assert.equal((await call(env,'/credits/resolve',{xUsername:'alice'},friend.data.token)).data.balance,125);
 env.DB.db.exec("UPDATE access_keys SET status='revoked'");assert.equal((await call(env,'/credits/order',{xUsername:'alice',quantity:500},friend.data.token)).status,404);
 env.DB.db.exec("UPDATE access_keys SET status='sold',expires_at=1");assert.equal((await call(env,'/credits/resolve',{xUsername:'alice'},friend.data.token)).status,404);
 assert.equal((await call(env,'/credits/resolve',{xUsername:'https://x.com/alice'},friend.data.token)).status,400);
});
test('username gift is pinned to the newest active purchased key, not the payer',async()=>{
 const env=setup();await call(env,'/auth/signup',{email:'destination-owner@test.example',password:'test-password'});const friend=await call(env,'/auth/signup',{email:'destination-friend@test.example',password:'test-password'});
 for(const id of [100,101])env.DB.db.prepare("INSERT INTO orders(id,package,amount,status,created_at,expires_at,user_id,x_username,kind) VALUES (?,'starter',5,'paid',?,?,1,'alice','license')").run(id,Date.now(),Date.now()+86400000);
 env.DB.db.exec('UPDATE access_keys SET order_id=100,sold_at=1000');env.DB.db.prepare("INSERT INTO access_keys(id,key,status,sold_at,expires_at,x_username,user_id,order_id) VALUES (2,'FIX-NEWEST-TESTAA-TESTBB-TESTCC','sold',2000,?,'alice',1,101)").run(Date.now()+86400000);
 await grantWelcome(env,1);env.DB.db.exec('UPDATE credit_wallets SET balance=7 WHERE key_id=1');const lookup=await call(env,'/credits/resolve',{xUsername:'@ALICE'},friend.data.token);assert.equal(lookup.data.balance,300);assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets WHERE key_id=1').get().balance,7);
 const r=await call(env,'/credits/order',{xUsername:'@ALICE',quantity:734},friend.data.token);assert.equal(r.status,200);const order=env.DB.db.prepare('SELECT * FROM orders WHERE id=?').get(r.data.orderId);assert.equal(order.credit_key_id,2);assert.equal(order.user_id,2);
 await fulfillOrder(env,order,{id:2,email:'friend@test.example'});await fulfillOrder(env,order,{id:2,email:'friend@test.example'});assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets WHERE key_id=2').get().balance,1034);assert.equal(env.DB.db.prepare('SELECT user_id FROM access_keys WHERE id=2').get().user_id,1);
 assert.equal((await call(env,'/credits/order',{accessKey:key,xUsername:'alice',quantity:500},friend.data.token)).status,400);
});
test('generation reuses existing welcome wallets without repeating grant writes',async()=>{
 const env=setup();await grantWelcome(env,1);let writes=0;const original=env.DB.batch.bind(env.DB);env.DB.batch=async statements=>{writes++;return original(statements)};
 await call(env,'/credits/balance',{accessKey:key});assert.equal(writes,0);
 const r=await call(env,'/credits/generate',{accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'A real post',stylePrompt:'A concise reply'});assert.equal(r.status,200);assert.equal(writes,2);assert.equal(r.data.balance,299);
});
test('gift lookup does not allow username-only AI generation and order expiry cannot exceed key expiry',async()=>{
 const env=setup();await call(env,'/auth/signup',{email:'cap-owner@test.example',password:'test-password'});const friend=await call(env,'/auth/signup',{email:'cap-friend@test.example',password:'test-password'});
 env.DB.db.prepare("INSERT INTO orders(id,package,amount,status,created_at,expires_at,user_id,x_username,kind) VALUES (100,'starter',5,'paid',?,?,1,'alice','license')").run(Date.now(),Date.now()+86400000);
 const expiry=Date.now()+120000;env.DB.db.prepare('UPDATE access_keys SET order_id=100,expires_at=? WHERE id=1').run(expiry);
 const r=await call(env,'/credits/order',{xUsername:'alice',quantity:500},friend.data.token);assert.equal(r.status,200);assert.equal(r.data.expiresAt,expiry);
 assert.equal((await call(env,'/credits/generate',{xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'A post'},friend.data.token)).status,401);
});
test('bulk topup orders use authoritative 20k and 50k rates, not a client price',async()=>{
 const env=setup();const user=await call(env,'/auth/signup',{email:'bulk@test.example',password:'test-password',name:'Bulk'});
 for(const [quantity,amount,unitPrice] of [[19999,3.19984,.00016],[20000,3,.00015],[49999,7.49985,.00015],[50000,7,.00014]]){
  const r=await call(env,'/credits/order',{accessKey:key,quantity,amount:.01,unitPrice:.000001},user.data.token);
  assert.equal(r.status,200);assert.equal(r.data.amount,amount);assert.equal(r.data.unitPrice,unitPrice);
  const stored=env.DB.db.prepare('SELECT amount,credit_quantity FROM orders WHERE id=?').get(r.data.orderId);assert.equal(stored.amount,amount);assert.equal(stored.credit_quantity,quantity);
 }
 const config=await call(env,'/config');assert.deepEqual(config.data.creditRates.slice(-2),[{min:20000,max:49999,unitPrice:.00015},{min:50000,unitPrice:.00014}]);
});

test('paid wallet remains usable after fourteen refunds and refunds stay idempotent',async()=>{
 const env=setup();await grantWelcome(env,1);env.DB.db.exec('UPDATE credit_wallets SET balance=20300,purchased=20000');
 for(let i=0;i<14;i++){const b={accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Real post '+i};assert.equal((await call(env,'/credits/generate',b)).status,200);assert.equal((await call(env,'/credits/settle',{...b,posted:false})).status,200);for(let n=0;n<3;n++)assert.equal((await call(env,'/credits/settle',{...b,posted:false})).status,200);}
 const r=await call(env,'/credits/generate',{accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Next real post'});assert.equal(r.status,200);assert.equal(r.data.balance,20299);
});
test('provider and interrupted refunds do not lock a free-credit wallet',async()=>{
 const env=setup();await grantWelcome(env,1);for(let i=0;i<14;i++){const id=crypto.randomUUID();env.DB.db.prepare("INSERT INTO credit_jobs(id,key_id,status,created_at,updated_at) VALUES (?,1,'refunded',?,?)").run(id,Date.now(),Date.now());env.DB.db.prepare("INSERT INTO credit_ledger(event_id,key_id,delta,reason,created_at) VALUES (?,1,1,?,?)").run('refund:'+id,i%2?'ai_failed':'interrupted',Date.now());}
 assert.equal((await call(env,'/credits/generate',{accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Post'})).status,200);
});
test('free-credit abuse guard remains after ten actual failed posts',async()=>{
 const env=setup();for(let i=0;i<10;i++){const b={accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Post'};assert.equal((await call(env,'/credits/generate',b)).status,200);await call(env,'/credits/settle',{...b,posted:false});}const r=await call(env,'/credits/generate',{accessKey:key,xUsername:'alice',requestId:crypto.randomUUID(),tweetText:'Post'});assert.equal(r.status,429);assert.equal(r.data.error,'refund_limit');assert.equal(env.DB.db.prepare('SELECT balance FROM credit_wallets').get().balance,300);
});

test('new referral rewards wait for claim before any owner approval or signing',async()=>{const env=setup();env.DB.db.prepare("INSERT INTO referral_profiles(user_id,code,wallet_address,created_at) VALUES (2,'ABCDEF1234567890','',?)").run(Date.now());await attachReferral(env,{id:1},'ABCDEF1234567890','127.0.0.1');await fulfillOrder(env,{id:1,kind:'license',amount:5,x_username:'alice'},{id:1,email:'buyer@example.test'},[{key}]);const payout=env.DB.db.prepare('SELECT * FROM referral_payouts').get();assert.equal(payout.status,'claimable');assert.equal(payout.wallet_address,'');const note=env.DB.db.prepare("SELECT * FROM notification_outbox WHERE event_id LIKE 'referral:%'").get();assert.equal(note.buttons,null);});

test('repeated cleanup only writes old response text once and preserves recent text',async()=>{
 const env=setup(),t=Date.now(),old=t-2*86400000;
 for(const [id,text,at] of [['old-cleared',null,old],['old-text','Old response',old],['recent-text','Keep this reply',t]])env.DB.db.prepare("INSERT INTO credit_jobs(id,key_id,status,response_text,created_at,updated_at) VALUES (?,1,'committed',?,?,?)").run(id,text,at,at);
 const prepare=env.DB.prepare.bind(env.DB);let writes=0;
 env.DB.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('UPDATE credit_jobs SET response_text=NULL')){const run=stmt.run;stmt.run=async()=>{const r=await run();writes+=r.meta.changes;return r;};}return stmt;};
 await cleanupFeatures(env);assert.equal(writes,1);
 await cleanupFeatures(env);assert.equal(writes,1,'Second cleanup must not rewrite NULL rows');
 assert.equal(env.DB.db.prepare("SELECT response_text FROM credit_jobs WHERE id='recent-text'").get().response_text,'Keep this reply');
 assert.equal(env.DB.db.prepare("SELECT response_text FROM credit_jobs WHERE id='old-text'").get().response_text,null);
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM credit_jobs').get().n,3,'Preserve all job IDs for idempotency');
});

test('every sensitive website route rejects missing verification before any D1 access',async()=>{
 const env=setup();let queries=0;env.DB.prepare=()=>{queries++;throw Error('Unverified request reached D1')};
 for(const path of Object.keys(WEBSITE_ACTIONS)){
  const r=await worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env,{waitUntil(){}});
  assert.equal(r.status,403,path);assert.equal((await r.json()).error,'human_failed',path);
 }
 assert.equal(queries,0);
});
test('human verification fails closed without a configured secret',async()=>{
 const env=setup();delete env.TURNSTILE_SECRET;
 assert.equal((await call(env,'/auth/signup',{email:'blocked@test.example',password:'test-password'})).status,503);
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
});
test('human verification checks hostname and action, rejects failure, oversized tokens and network errors',async()=>{
 const env=setup(),prior=globalThis.fetch;let requests=0;
 try{
  const answer=data=>{globalThis.fetch=async()=>{requests++;return Response.json(data)}};
  answer({success:true,hostname:'fixasif.com',action:'signup'});assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),true);
  answer({success:true,hostname:'www.fixasif.com',action:'signup'});assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),true);
  answer({success:true,hostname:'attacker.example',action:'signup'});assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),false);
  answer({success:true,hostname:'fixasif.com',action:'login'});assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),false);
  answer({success:false,hostname:'fixasif.com',action:'signup'});assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),false);
  const before=requests;assert.equal(await validateHuman(env,'x'.repeat(2049),'127.0.0.1','signup'),false);assert.equal(requests,before);
  globalThis.fetch=async()=>{throw Error('offline')};assert.equal(await validateHuman(env,'token','127.0.0.1','signup'),false);
 }finally{globalThis.fetch=prior}
});
test('a replayed human token cannot create another account',async()=>{
 const env=setup(),prior=globalThis.fetch;let used=false;
 globalThis.fetch=async(input,options)=>{
  if(String(input).includes('turnstile')){const success=!used;used=true;return Response.json({success,hostname:'fixasif.com',action:'signup'})}
  return prior(input,options);
 };
 try{
  assert.equal((await call(env,'/auth/signup',{email:'first@test.example',password:'test-password',turnstileToken:'one-use'})).status,200);
  assert.equal((await call(env,'/auth/signup',{email:'second@test.example',password:'test-password',turnstileToken:'one-use'})).status,403);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
 }finally{globalThis.fetch=prior}
});
test('denied repeated requests stop rewriting an exhausted D1 rate-limit counter',async()=>{
 const env=setup();let denied=0;
 for(let i=0;i<25;i++){const r=await call(env,'/telegram/bot');if(r.status===429)denied++}
 assert.equal(denied,15);
 assert.equal(env.DB.db.prepare("SELECT count FROM rate_limits WHERE k='bot-info:10.1.1.1'").get().count,10);
 env.DB.db.prepare("UPDATE rate_limits SET window_start=? WHERE k='bot-info:10.1.1.1'").run(Date.now()-600001);
 await call(env,'/telegram/bot');assert.equal(env.DB.db.prepare("SELECT count FROM rate_limits WHERE k='bot-info:10.1.1.1'").get().count,1);
});
