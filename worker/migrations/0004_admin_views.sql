CREATE VIEW IF NOT EXISTS admin_accounts AS
 SELECT u.id,u.name,u.email,datetime(u.created_at/1000,'unixepoch') AS registered_utc,
 (SELECT COUNT(*) FROM access_keys k WHERE k.user_id=u.id AND k.status='sold') AS purchased_keys
 FROM users u;
CREATE VIEW IF NOT EXISTS admin_licence_sales AS
 SELECT o.id AS order_id,u.email,o.x_username,o.package,o.amount,o.status,
 datetime(o.paid_at/1000,'unixepoch') AS paid_utc,
 (SELECT COUNT(*) FROM access_keys k WHERE k.order_id=o.id) AS keys_delivered
 FROM orders o JOIN users u ON u.id=o.user_id WHERE o.kind='license' AND o.status='paid';
CREATE VIEW IF NOT EXISTS admin_credit_balances AS
 SELECT k.id AS key_id,u.email,k.x_username,k.status AS licence_status,
 datetime(k.expires_at/1000,'unixepoch') AS licence_expires_utc,
 w.balance,w.free_granted,w.purchased,w.used
 FROM credit_wallets w JOIN access_keys k ON k.id=w.key_id LEFT JOIN users u ON u.id=k.user_id;
CREATE VIEW IF NOT EXISTS admin_credit_sales AS
 SELECT o.id AS order_id,u.email,o.x_username,o.credit_quantity,o.amount,o.status,
 datetime(o.paid_at/1000,'unixepoch') AS paid_utc
 FROM orders o JOIN users u ON u.id=o.user_id WHERE o.kind='credits';
CREATE VIEW IF NOT EXISTS admin_referrals AS
 SELECT r.id,a.email AS referrer_email,b.email AS referred_email,r.status AS referral_status,
 p.status AS payment_status,p.wallet_address,p.tx_hash,
 datetime(r.created_at/1000,'unixepoch') AS signup_utc,
 datetime(r.success_at/1000,'unixepoch') AS success_utc
 FROM referrals r JOIN users a ON a.id=r.referrer_id JOIN users b ON b.id=r.referred_id
 LEFT JOIN referral_payouts p ON p.referral_id=r.id;
