/* Public coupon is not a secret. Turnstile authenticates a challenge, not X ownership. */
export const TRIAL_CODE='E8JQ42B7MS';
export const TRIAL_MS=15*86400000;
export async function claimTrial(env,user,b,{fail,now,normX}) {
 const xu=normX(b.xUsername);
 if(!/^[a-z0-9_]{1,15}$/.test(xu)||['i','home','intent','settings','compose','explore','notifications','messages'].includes(xu))fail(400,'bad_username','Enter your own valid X username');
 if(String(b.coupon||'').trim().toUpperCase()!==TRIAL_CODE)fail(400,'bad_coupon','Enter the trial code shown on the website');
 const t=now(),key='FXTRIAL-'+crypto.randomUUID().replaceAll('-','').toUpperCase(),expires=t+TRIAL_MS;
 // D1 batch is one atomic transaction. Both username and website user have permanent unique claims.
 // Never erase claims when a key expires, is revoked, or an account changes.
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO trial_claims(x_username,user_id,access_key,claimed_at,expires_at)
    SELECT ?,?,?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM access_keys WHERE lower(x_username)=? AND status!='available'
    ) AND NOT EXISTS (
      SELECT 1 FROM orders WHERE lower(x_username)=? AND status='paid' AND kind='license' AND amount>0
    )`).bind(xu,user.id,key,t,expires,xu,xu),
  env.DB.prepare(`INSERT OR IGNORE INTO access_keys(key,status,sold_at,expires_at,x_username,user_id)
    SELECT access_key,'sold',claimed_at,expires_at,x_username,user_id FROM trial_claims WHERE access_key=?`).bind(key),
  // No free credit/ledger grant on public trials. Own API or separately purchased credits.
  env.DB.prepare(`INSERT OR IGNORE INTO credit_wallets(key_id,balance,free_granted)
    SELECT id,0,0 FROM access_keys WHERE key=?`).bind(key),
  env.DB.prepare(`UPDATE referrals SET status='trial' WHERE referred_id=? AND status='pending'
    AND EXISTS(SELECT 1 FROM trial_claims WHERE access_key=?)`).bind(user.id,key)
 ]);
 const claim=await env.DB.prepare('SELECT * FROM trial_claims WHERE x_username=?').bind(xu).first();
 if(claim?.user_id===user.id){
  const k=await env.DB.prepare('SELECT status FROM access_keys WHERE key=?').bind(claim.access_key).first();
  if(k?.status!=='sold'||claim.expires_at<=now())fail(409,'trial_used','This username has already used its one-time trial');
  return {ok:true,accessKey:claim.access_key,xUsername:xu,expiresAt:claim.expires_at,days:15,trial:true,freeCredits:0};
 }
 fail(409,'trial_ineligible','This username or website account has already used a trial, or the username has previously purchased bot access');
}
