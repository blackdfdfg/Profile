import {buildReplyMessages} from './reply-request.js';
import { runApprovedPayouts, payoutStatus } from "./payouts.js";
/* Credits and referral bookkeeping. All credentials come from Worker Secrets. */
export function creditQuote(quantity) {
  const n = Number(quantity);
  if (!Number.isSafeInteger(n) || n < 500) throw new Error('Buy at least 500 whole credits');
  // Inclusive thresholds; one fixed rate applies to the entire order.
  const unitMicros = n >= 50000 ? 140 : n >= 20000 ? 150 : n >= 5000 ? 160 : n >= 1000 ? 180 : 200;
  if(!Number.isSafeInteger(n * unitMicros))throw new Error('This quantity is too large for an exact payment calculation');
  return { quantity: n, unitMicros, amountMicros: n * unitMicros, amount: n * unitMicros / 1000000 };
}
export async function grantWelcome(env, keyId) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO credit_wallets(key_id,balance,free_granted) VALUES (?,300,300)').bind(keyId),
    env.DB.prepare("INSERT OR IGNORE INTO credit_ledger(event_id,key_id,delta,reason,created_at) VALUES (?,?,300,'welcome',?)").bind('welcome:' + keyId,keyId,Date.now())
  ]);
}
export async function queueNotification(env, id, text, buttons = null) {
  await env.DB.prepare('INSERT OR IGNORE INTO notification_outbox(event_id,text,buttons,created_at) VALUES (?,?,?,?)')
    .bind(id,text,buttons ? JSON.stringify(buttons) : null,Date.now()).run();
}
export async function flushNotifications(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const rows = await env.DB.prepare("SELECT * FROM notification_outbox WHERE status='pending' AND (last_attempt IS NULL OR last_attempt < ? - CASE WHEN attempts>=20 THEN 86400000 WHEN attempts>=5 THEN 3600000 ELSE 0 END) ORDER BY created_at LIMIT 20").bind(Date.now()).all();
  for (const row of rows.results || []) {
    const claimed = await env.DB.prepare("UPDATE notification_outbox SET status='sending', attempts=attempts+1,last_attempt=? WHERE event_id=? AND status='pending'")
      .bind(Date.now(),row.event_id).run();
    if (claimed.meta?.changes !== 1) continue;
    try {
      const payload = { chat_id: env.TELEGRAM_CHAT_ID, text: row.text };
      if (row.buttons) payload.reply_markup = { inline_keyboard: JSON.parse(row.buttons) };
      const r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      const data = await r.json();
      if (!r.ok || !data.ok) {
        const description=String(data.description||'').toLowerCase();
        const reason=description.includes('chat not found')?'chat_not_found':description.includes('blocked')?'bot_blocked':r.status===401?'invalid_bot_token':r.status===429?'rate_limited':'delivery_failed';
        await env.DB.prepare('UPDATE notification_outbox SET last_error=? WHERE event_id=?').bind(reason,row.event_id).run();
        throw new Error('Delivery failed');
      }
      await env.DB.prepare("UPDATE notification_outbox SET status='sent',last_error=NULL WHERE event_id=?").bind(row.event_id).run();
    } catch {
      await env.DB.prepare("UPDATE notification_outbox SET status='pending' WHERE event_id=?").bind(row.event_id).run();
    }
  }
}
export async function attachReferral(env, user, code, ip) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return;
  const profile = await env.DB.prepare('SELECT * FROM referral_profiles WHERE code=?').bind(normalized).first();
  if (!profile || profile.user_id === user.id) return;
  const data = new TextEncoder().encode(ip + ':' + (env.JWT_SECRET || ''));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO referrals(referrer_id,referred_id,signup_ip_hash,created_at) VALUES (?,?,?,?)')
    .bind(profile.user_id,user.id,hash,Date.now()).run();
}
export async function fulfillOrder(env, order, user, keys = []) {
  if (order.kind === 'credits') {
    // D1 batch is a single transaction. The unique ledger event gates the balance increase.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO credit_ledger(event_id,key_id,delta,reason,created_at) VALUES (?,?,?,'topup',?)")
        .bind('topup:' + order.id,order.credit_key_id,order.credit_quantity,Date.now()),
      env.DB.prepare('UPDATE credit_wallets SET balance=balance+?,purchased=purchased+? WHERE key_id=? AND changes()=1')
        .bind(order.credit_quantity,order.credit_quantity,order.credit_key_id)
    ]);
    await queueNotification(env,'sale:' + order.id,'✅ Credit topup #' + order.id + '\nUser: ' + user.email + '\n@' + order.x_username + '\nCredits: ' + order.credit_quantity + '\nPaid: ' + order.amount + ' USDT');
    return;
  }
  for (const k of keys) {
    const row = await env.DB.prepare('SELECT id FROM access_keys WHERE key=?').bind(k.key).first();
    if (row) await grantWelcome(env,row.id);
  }
  await queueNotification(env,'sale:' + order.id,'✅ Bot purchased #' + order.id + '\nUser: ' + user.email + '\nX: @' + order.x_username + '\nPlan: ' + order.package + '\nPaid: ' + order.amount + ' USDT\nKeys delivered: ' + keys.length);
  if (!keys.length) return; // Only qualify after the licence was actually delivered.
  const referral = await env.DB.prepare("SELECT r.*,p.wallet_address FROM referrals r JOIN referral_profiles p ON p.user_id=r.referrer_id WHERE r.referred_id=? AND r.status='pending'").bind(user.id).first();
  if (!referral || referral.referrer_id === user.id) return;
  // Do not automatically reward the referrer's own licensed X identity.
  const own = await env.DB.prepare("SELECT id FROM access_keys WHERE user_id=? AND lower(x_username)=? AND status='sold' LIMIT 1").bind(referral.referrer_id,order.x_username).first();
  if (own) { await env.DB.prepare("UPDATE referrals SET status='review' WHERE id=? AND status='pending'").bind(referral.id).run(); return; }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE referrals SET status='successful',success_at=?,order_id=? WHERE id=? AND status='pending'").bind(Date.now(),order.id,referral.id),
    env.DB.prepare("INSERT OR IGNORE INTO referral_payouts(id,referral_id,user_id,wallet_address,created_at) SELECT ?,id,referrer_id,?,? FROM referrals WHERE id=? AND status='successful'")
      .bind(id,referral.wallet_address,Date.now(),referral.id)
  ]);
  const payout = await env.DB.prepare('SELECT * FROM referral_payouts WHERE referral_id=?').bind(referral.id).first();
  await queueNotification(env,'referral:' + referral.id,'🎁 Successful referral, $1 pending review\nPayout: ' + payout.id + '\nNew buyer: @' + order.x_username + '\nWallet: ' + payout.wallet_address + '\nCheck for self-referrals before confirming.', [[{text:'Confirm',callback_data:'rp:c:' + payout.id},{text:'Cancel',callback_data:'rp:x:' + payout.id}]]);
}
export async function cleanupFeatures(env) {
  await env.DB.prepare("UPDATE notification_outbox SET status='pending' WHERE status='sending' AND last_attempt<?").bind(Date.now()-300000).run();
  // A provider request interrupted after debit is refunded exactly once after 3 minutes.
  const jobs = await env.DB.prepare("SELECT id,key_id FROM credit_jobs WHERE (status='generating' AND updated_at<?) OR (status='ready' AND updated_at<?) LIMIT 100").bind(Date.now()-180000,Date.now()-1800000).all();
  for (const job of jobs.results || []) await refundJob(env,job.id,job.key_id,'interrupted');
  await env.DB.prepare('UPDATE credit_jobs SET response_text=NULL WHERE created_at<?').bind(Date.now()-86400000).run();
  await runApprovedPayouts(env,queueNotification);
  await flushNotifications(env);
}
async function refundJob(env,id,keyId,reason) {
  await env.DB.batch([
    env.DB.prepare("UPDATE credit_jobs SET status='refunded',updated_at=?,response_text=NULL WHERE id=? AND key_id=? AND status IN ('generating','ready')")
      .bind(Date.now(),id,keyId),
    env.DB.prepare("INSERT OR IGNORE INTO credit_ledger(event_id,key_id,delta,reason,created_at) SELECT ?,?,1,?,? WHERE changes()=1")
      .bind('refund:' + id,keyId,reason,Date.now()),
    env.DB.prepare('UPDATE credit_wallets SET balance=balance+1,used=used-1 WHERE key_id=? AND changes()=1').bind(keyId)
  ]);
}
export async function featureRoute(req,env,ctx,a) {
 const url = new URL(req.url), p = url.pathname.replace(/\/+$/,'') || '/', M=req.method;
 const { json,body,fail,requireUser,rateLimit,normX,now,clientIp }=a;
 if(M==='GET' && p==='/admin/payout-status') {
   await rateLimit(env,'payout-status:'+clientIp(req),10,600000);
   if(!env.OWNER_ADMIN_SECRET || req.headers.get('X-Owner-Secret')!==env.OWNER_ADMIN_SECRET)fail(403,'forbidden','Owner access only');
   try{return json(req,env,await payoutStatus(env));}catch{fail(503,'wallet_unavailable','Wallet diagnostics unavailable');}
 }
 if(M==='GET' && p==='/telegram/bot') {
   await rateLimit(env,'bot-info:'+clientIp(req),10,600000);
   if(!env.TELEGRAM_BOT_TOKEN)fail(503,'not_configured','Telegram is not configured');
   const r=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/getMe');
   const data=await r.json();
   if(!r.ok||!data.ok)fail(502,'bot_unavailable','Telegram bot could not be verified');
   return json(req,env,{username:data.result.username,url:'https://t.me/'+data.result.username});
 }

 async function keyAuth(b,usernameRequired=false) {
   await rateLimit(env,'credit-key:' + clientIp(req),600,600000);
   const k=await env.DB.prepare('SELECT k.*,w.key_id AS wallet_present,w.balance AS wallet_balance,w.free_granted AS wallet_free,w.purchased AS wallet_purchased,w.used AS wallet_used FROM access_keys k LEFT JOIN credit_wallets w ON w.key_id=k.id WHERE k.key=?').bind(String(b.accessKey||'').trim().toUpperCase()).first();
   if (!k || k.status!=='sold') fail(401,'invalid_key','Enter a valid purchased Access Key');
   if (!k.expires_at || k.expires_at<=now()) fail(403,'expired','Your Access Key has expired');
   if (!k.x_username) fail(403,'unbound','Log in to the extension first');
   if (usernameRequired && normX(b.xUsername)!==normX(k.x_username)) fail(403,'bound_other','This key belongs to another X account');
   if(!k.wallet_present)await grantWelcome(env,k.id); return k;
 }
 async function balance(k,cached=false) {
   if(cached&&k.wallet_present)return {ok:true,xUsername:k.x_username,balance:k.wallet_balance,freeGranted:k.wallet_free,purchased:k.wallet_purchased,used:k.wallet_used};
   const w=await env.DB.prepare('SELECT * FROM credit_wallets WHERE key_id=?').bind(k.id).first();
   return {ok:true,xUsername:k.x_username,balance:w.balance,freeGranted:w.free_granted,purchased:w.purchased,used:w.used};
 }
 if(M==='POST' && p==='/credits/balance') {const k=await keyAuth(await body(req));ctx.waitUntil(flushNotifications(env));return json(req,env,await balance(k,true));}
 async function usernameDestination(value) {
   const username=normX(value);
   if(!/^[a-z0-9_]{1,15}$/.test(username))fail(400,'bad_username','Enter a valid X username, without a URL');
   const k=await env.DB.prepare("SELECT k.* FROM access_keys k JOIN orders o ON o.id=k.order_id WHERE lower(k.x_username)=? AND k.status='sold' AND k.expires_at>? AND o.status='paid' AND o.kind='license' AND o.amount>0 AND o.user_id=k.user_id AND lower(o.x_username)=lower(k.x_username) ORDER BY k.sold_at DESC,k.id DESC LIMIT 1").bind(username,now()).first();
   if(!k)fail(404,'no_active_purchase','No verified bot purchase with an active Access Key was found for this username');
   return k;
 }
 if(M==='POST' && p==='/credits/resolve') {
   const u=await requireUser(req,env),b=await body(req);
   await rateLimit(env,'dest-ip:'+clientIp(req),30,600000);await rateLimit(env,'dest-user:'+u.id,30,600000);
   const k=await usernameDestination(b.xUsername);
   if(!(await env.DB.prepare('SELECT key_id FROM credit_wallets WHERE key_id=?').bind(k.id).first()))await grantWelcome(env,k.id);
   const wallet=await balance(k);
   return json(req,env,{ok:true,xUsername:k.x_username,balance:wallet.balance,destinationPolicy:'newest_active_purchased_key'});
 }
 if(M==='POST' && p==='/credits/order') {
   const u=await requireUser(req,env),b=await body(req);
   await rateLimit(env,'topup:' + u.id,20,3600000);
   if(b.accessKey&&b.xUsername)fail(400,'ambiguous_destination','Choose Access Key or X username, not both');
   const k=b.accessKey?await keyAuth(b):b.xUsername?await usernameDestination(b.xUsername):null;
   if(!k)fail(401,'destination_required','Enter and check an Access Key or purchased X username first');
   if(!b.accessKey)await grantWelcome(env,k.id);
   // Credits always target the resolved key ID; license ownership never changes.
   let q;try{q=creditQuote(b.quantity)}catch(e){fail(400,'bad_quantity',e.message)}
   const open=await env.DB.prepare("SELECT * FROM orders WHERE user_id=? AND kind='credits' AND credit_key_id=? AND credit_quantity=? AND status='pending' AND expires_at>? ORDER BY id DESC LIMIT 1").bind(u.id,k.id,q.quantity,now()+300000).first();
   const o=open||await env.DB.prepare("INSERT INTO orders(package,amount,status,created_at,expires_at,ip,user_id,x_username,kind,credit_quantity,credit_key_id) VALUES ('credits',?,'pending',?,?,?,?,?,'credits',?,?) RETURNING *")
     .bind(q.amount,now(),Math.min(now()+1800000,k.expires_at),clientIp(req),u.id,k.x_username,q.quantity,k.id).first();
   return json(req,env,{orderId:o.id,kind:'credits',quantity:q.quantity,amount:o.amount,unitPrice:q.unitMicros/1000000,currency:'USDT',binanceUid:env.BINANCE_UID,expiresAt:o.expires_at,xUsername:k.x_username});
 }
 if(M==='POST' && p==='/credits/generate') {
   const started=performance.now(),b=await body(req),k=await keyAuth(b,true),authed=performance.now();
   if(!env.OPENAI_API_KEY || !env.AI_MODEL || !env.AI_ENDPOINT) fail(503,'ai_unavailable','Credit replies are not configured yet. You can still use your own API.');
   const prompt=String(b.stylePrompt||'');
   if([...prompt].length>500) fail(400,'prompt_limit','Reply style must be 500 characters or less');
   const tweet=String(b.tweetText||'').trim();
   if(!tweet || tweet.length>12000) fail(400,'bad_post','Enter a post of up to 12,000 characters');
   const id=String(b.requestId||'');
   if(!/^[a-zA-Z0-9-]{16,64}$/.test(id)) fail(400,'bad_request','A unique reply request ID is required');
   const [_,job,refunds]=await Promise.all([rateLimit(env,'ai:' + k.id,180,600000),env.DB.prepare('SELECT * FROM credit_jobs WHERE id=?').bind(id).first(),env.DB.prepare("SELECT COUNT(*) AS n FROM credit_jobs j JOIN credit_ledger l ON l.event_id='refund:'||j.id WHERE j.key_id=? AND j.status='refunded' AND l.reason='post_failed' AND j.created_at>?").bind(k.id,now()-86400000).first()]);
   if(job) {
     if(job.key_id!==k.id) fail(409,'request_used','Request ID already used');
     if(['ready','committed'].includes(job.status) && job.response_text) return json(req,env,{...(await balance(k)),text:job.response_text,requestId:id});
     fail(409,'request_pending','This request has already been processed or is in progress');
   }
   // Provider failures and interrupted requests are not customer misuse.
   // Purchased wallets must remain usable; the rolling generation rate limit still applies.
   if(!(k.wallet_purchased>0) && refunds.n>=10) fail(429,'refund_limit','Free-credit failed-post limit reached. Contact support or top up to continue.');
   const result=await env.DB.batch([
     env.DB.prepare("INSERT OR IGNORE INTO credit_jobs(id,key_id,status,created_at,updated_at) SELECT ?,?,'generating',?,? FROM credit_wallets WHERE key_id=? AND balance>0").bind(id,k.id,now(),now(),k.id),
     env.DB.prepare('UPDATE credit_wallets SET balance=balance-1,used=used+1 WHERE key_id=? AND balance>0 AND changes()=1').bind(k.id),
     env.DB.prepare("INSERT INTO credit_ledger(event_id,key_id,delta,reason,created_at) SELECT ?,?,-1,'reply',? WHERE changes()=1").bind('reply:' + id,k.id,now())
   ]);
   if(result[0].meta?.changes!==1) fail(402,'no_credits','No credits left. Top up on fixasif.com/agent/tokens/');
   const reserved=performance.now();
   try {
     const endpoint=new URL(env.AI_ENDPOINT);
     if(endpoint.protocol!=='https:' || endpoint.hostname!=='api.openai.com') throw new Error('Invalid AI endpoint');
     const r=await fetch(endpoint.toString(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + env.OPENAI_API_KEY},signal:AbortSignal.timeout(60000),body:JSON.stringify({model:env.AI_MODEL,max_tokens:220,messages:buildReplyMessages({...b,tweetText:tweet})})});
     const data=await r.json();const text=String(data.choices?.[0]?.message?.content||'').trim();
     if(!r.ok||!text) throw new Error('No reply returned');
     const generated=performance.now();
     const done=await env.DB.batch([env.DB.prepare("UPDATE credit_jobs SET status='ready',response_text=?,updated_at=? WHERE id=? AND status='generating'").bind(text,now(),id),env.DB.prepare('SELECT * FROM credit_wallets WHERE key_id=?').bind(k.id)]);
     if(done[0].meta?.changes!==1) fail(409,'request_expired','This reply request expired. Try again.');
     const wallet=done[1].results[0];
     const response=json(req,env,{ok:true,xUsername:k.x_username,balance:wallet.balance,freeGranted:wallet.free_granted,purchased:wallet.purchased,used:wallet.used,text,requestId:id});
     response.headers.set('Server-Timing','auth;dur='+Math.round(authed-started)+', reserve;dur='+Math.round(reserved-authed)+', generation;dur='+Math.round(generated-reserved)+', finish;dur='+Math.round(performance.now()-generated));
     return response;
   }catch(e){await refundJob(env,id,k.id,'ai_failed');if(e.status)throw e;fail(502,'ai_failed','Reply generation failed. Your credit was returned.');}
 }
 if(M==='POST' && p==='/credits/settle') {
   const b=await body(req),k=await keyAuth(b,true),id=String(b.requestId||'');
   const job=await env.DB.prepare('SELECT * FROM credit_jobs WHERE id=? AND key_id=?').bind(id,k.id).first();
   if(!job) fail(404,'not_found','Reply request not found');
   if(b.posted===true) await env.DB.prepare("UPDATE credit_jobs SET status='committed',updated_at=? WHERE id=? AND status='ready'").bind(now(),id).run();
   else if(b.posted===false) {
     // Replayed settlements are no-ops and must never exhaust a refund allowance.
     if(['generating','ready'].includes(job.status)){await rateLimit(env,'refund:' + k.id,180,600000);await refundJob(env,id,k.id,'post_failed');}
   }
   else fail(400,'bad_request','Specify whether the comment was posted');
   return json(req,env,await balance(k));
 }
 if(M==='POST' && p==='/referrals/create') {
   const u=await requireUser(req,env),b=await body(req);await rateLimit(env,'ref-create:'+u.id,5,3600000);
   const existing=await env.DB.prepare('SELECT * FROM referral_profiles WHERE user_id=?').bind(u.id).first();
   if(existing) return json(req,env,{code:existing.code,url:(env.SITE_ORIGIN||'https://fixasif.com')+'/agent/?ref='+existing.code,walletAddress:existing.wallet_address});
   let address=String(b.walletAddress||'').trim();
   if(!/^0x[a-fA-F0-9]{40}$/.test(address)||/^0x0{40}$/i.test(address)) fail(400,'bad_wallet','Enter a valid BEP20 wallet address');
   const {getAddress}=await import('ethers');
   try{address=getAddress(address);}catch{fail(400,'bad_wallet','Check your wallet address and checksum');}
   const code=[...crypto.getRandomValues(new Uint8Array(8))].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
   await env.DB.prepare('INSERT INTO referral_profiles(user_id,code,wallet_address,created_at) VALUES (?,?,?,?)').bind(u.id,code,address,now()).run();
   return json(req,env,{code,url:(env.SITE_ORIGIN||'https://fixasif.com')+'/agent/?ref='+code,walletAddress:address});
 }
 if(M==='GET' && p==='/referrals/dashboard') {
   const u=await requireUser(req,env),profile=await env.DB.prepare('SELECT * FROM referral_profiles WHERE user_id=?').bind(u.id).first();
   const rows=await env.DB.prepare('SELECT r.id,r.status,r.created_at,r.success_at,p.status AS payment_status,p.tx_hash,p.amount_micros FROM referrals r LEFT JOIN referral_payouts p ON p.referral_id=r.id WHERE r.referrer_id=? ORDER BY r.id DESC LIMIT 200').bind(u.id).all();
   const stats=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='successful' THEN 1 ELSE 0 END) AS successful FROM referrals WHERE referrer_id=?").bind(u.id).first();
   const payoutSummary=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount_micros ELSE 0 END),0) AS paidMicros,COALESCE(SUM(CASE WHEN status IN ('awaiting_confirmation','approved','approved_pending_wallet','broadcast_pending','submitted') THEN amount_micros ELSE 0 END),0) AS pendingMicros FROM referral_payouts WHERE user_id=?").bind(u.id).first();
   return json(req,env,{profile:profile?{code:profile.code,walletAddress:profile.wallet_address,url:(env.SITE_ORIGIN||'https://fixasif.com')+'/agent/?ref='+profile.code}:null,referrals:rows.results||[],stats,payoutSummary,payoutsEnabled:env.PAYOUT_ENABLED==='true'});
 }
 if(M==='POST' && p==='/telegram/webhook') {
   const supplied=req.headers.get('X-Telegram-Bot-Api-Secret-Token')||'';
   if(!env.TELEGRAM_WEBHOOK_SECRET || !a.timingSafeEq(supplied,env.TELEGRAM_WEBHOOK_SECRET)) fail(403,'forbidden','Not authorized');
   const update=await body(req), cb=update.callback_query;
   if(!cb) return json(req,env,{ok:true});
   if(String(cb.from?.id)!==String(env.TELEGRAM_CHAT_ID)||String(cb.message?.chat?.id)!==String(env.TELEGRAM_CHAT_ID)) fail(403,'forbidden','Only the owner can confirm payments');
   const match=/^rp:([cx]):([a-f0-9-]{36})$/.exec(String(cb.data||''));
   let answer='Unknown action';
   if(match){
     const status=match[1]==='c'?(env.PAYOUT_ENABLED==='true'?'approved':'approved_pending_wallet'):'cancelled';
     const r=await env.DB.prepare("UPDATE referral_payouts SET status=?,approved_at=? WHERE id=? AND status='awaiting_confirmation'").bind(status,now(),match[2]).run();
     answer=r.meta?.changes===1?(match[1]==='c'?(env.PAYOUT_ENABLED==='true'?'Approved. The transfer will be processed and confirmed on-chain.':'Approved. Transfer is disabled until a safe payout wallet is configured.'):'Cancelled.'):'Already processed';
     if(r.meta?.changes===1 && match[1]==='c' && env.PAYOUT_ENABLED==='true')ctx.waitUntil(runApprovedPayouts(env,queueNotification).then(()=>flushNotifications(env))); 
   }
   await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/answerCallbackQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:cb.id,text:answer.slice(0,200),show_alert:true})});
   return json(req,env,{ok:true});
 }
 return null;
}
