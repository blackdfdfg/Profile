/* FixAsif Agent — Cloudflare Worker (D1 binding: DB)
   Secrets: BINANCE_API_KEY, BINANCE_SECRET, TURNSTILE_SECRET,
            GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, JWT_SECRET
   Optional: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (sale + low-stock alerts)
   Vars:    BINANCE_UID, TURNSTILE_SITE_KEY, SITE_ORIGIN, GOOGLE_REDIRECT_URI */

const PACKAGES = {
  starter:   { name: "Starter",    price: 5,  keys: 1, months: 3 },
  standard:  { name: "Standard",   price: 7,  keys: 1, months: 6,  badge: "Save 30%" },
  bestvalue: { name: "Best Value", price: 10, keys: 1, months: 12, badge: "Best Value \u2014 Save 55%" }
};
const ORDER_TTL_MS = 30 * 60 * 1000;     // pay within 30 minutes
const VERIFY_GRACE_MS = 30 * 60 * 1000;  // may still verify up to 30 min after expiry if paid in time
const LOW_STOCK = 5;
const DEFAULT_EXTENSION_URL = "https://chromewebstore.google.com/detail/free-vpn-for-chrome-vpn-p/majdfhpaihoncoakbjgbdhglocklcgno?hl=en";
const SUPPORT_URL = "https://t.me/Fixasif";
const extUrl = (env) => env.EXTENSION_URL || DEFAULT_EXTENSION_URL;
const JWT_TTL_S = 30 * 24 * 3600;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();

/* ---------------- helpers ---------------- */
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const site = env.SITE_ORIGIN || "https://fixasif.com";
  const ok = origin === site || origin === "https://www.fixasif.com" ||
    origin.startsWith("chrome-extension://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : site,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(req, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(req, env) }
  });
}
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }
const now = () => Date.now();
const clientIp = (req) => req.headers.get("CF-Connecting-IP") || "0.0.0.0";
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = (s) => b64u(enc.encode(s));
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function addMonths(ts, m) { const d = new Date(ts); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); }
function normEmail(e) { return String(e || "").trim().toLowerCase(); }
function normX(u) { return String(u || "").trim().replace(/^@+/, "").toLowerCase(); }
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------------- password hashing (PBKDF2-SHA256, WebCrypto) ---------------- */
async function hashPassword(pw, saltB = crypto.getRandomValues(new Uint8Array(16)), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltB, iterations: iter }, key, 256);
  return "pbkdf2$" + iter + "$" + b64u(saltB) + "$" + b64u(bits);
}
async function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [alg, iter, salt] = stored.split("$");
  if (alg !== "pbkdf2") return false;
  const h = await hashPassword(pw, fromB64u(salt), Number(iter));
  return timingSafeEq(h, stored);
}

/* ---------------- JWT (HS256) ---------------- */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signJwt(env, payload) {
  const head = b64uStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(now() / 1000);
  const pl = b64uStr(JSON.stringify({ ...payload, iat, exp: iat + JWT_TTL_S }));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.JWT_SECRET), enc.encode(head + "." + pl));
  return head + "." + pl + "." + b64u(sig);
}
async function verifyJwt(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.JWT_SECRET), fromB64u(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  let p; try { p = JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))); } catch (e) { return null; }
  if (!p.exp || p.exp < Math.floor(now() / 1000)) return null;
  return p;
}
async function requireUser(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const p = await verifyJwt(env, auth.replace(/^Bearer\s+/i, ""));
  if (!p) fail(401, "unauthorized", "Please log in again");
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(p.sub).first();
  if (!u || (u.token_version || 0) !== (p.tv || 0)) fail(401, "unauthorized", "Session expired, please log in again");
  return u;
}
const sessionFor = async (env, u) => ({
  token: await signJwt(env, { sub: u.id, tv: u.token_version || 0 }),
  user: publicUser(u)
});
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || "", google: !!u.google_id, hasPassword: !!u.password_hash, createdAt: u.created_at });

/* ---------------- rate limit (D1, fixed window) ---------------- */
async function rateLimit(env, key, limit, windowMs) {
  const t = now();
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE k = ?").bind(key).first();
  if (!row || t - row.window_start > windowMs) {
    await env.DB.prepare("INSERT INTO rate_limits (k, count, window_start) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(key, t).run();
    return;
  }
  if (row.count >= limit) fail(429, "rate_limited", "Too many attempts \u2014 please wait a few minutes and try again");
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE k = ?").bind(key).run();
}

/* ---------------- Turnstile ---------------- */
async function checkTurnstile(env, token, ip) {
  if (!token) return false;
  const fd = new FormData();
  fd.append("secret", env.TURNSTILE_SECRET);
  fd.append("response", token);
  fd.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
    const d = await r.json();
    return d.success === true;
  } catch (e) { return false; }
}

/* ---------------- Binance Pay history ---------------- */
const BINANCE_HOSTS = ["https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com", "https://api-gcp.binance.com"];
async function binancePayTransactions(env, startTime, endTime) {
  const qs = "startTime=" + startTime + "&endTime=" + endTime + "&limit=100&recvWindow=10000&timestamp=" + now();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.BINANCE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, enc.encode(qs)));
  let lastErr = "";
  for (const host of BINANCE_HOSTS) {
    try {
      const r = await fetch(host + "/sapi/v1/pay/transactions?" + qs + "&signature=" + sig, { headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY } });
      const text = await r.text();
      if (r.status === 451 || r.status === 403 || r.status >= 500) { lastErr = host + " " + r.status; continue; }
      const d = JSON.parse(text);
      if (!r.ok || (d.code && String(d.code) !== "000000")) { lastErr = (d.msg || d.message || text).slice(0, 200); continue; }
      return Array.isArray(d.data) ? d.data : [];
    } catch (e) { lastErr = String(e).slice(0, 200); }
  }
  console.log("binance error", lastErr);
  fail(502, "binance_unavailable", "Payment service is temporarily unavailable \u2014 please try again in a minute");
}
function txAmountUSDT(tx) {
  // Received payments are positive. Prefer fundsDetail (exact USDT part).
  if (String(tx.currency || "").toUpperCase() === "USDT") return Number(tx.amount);
  const fd = (tx.fundsDetail || []).find((f) => String(f.currency).toUpperCase() === "USDT");
  return fd ? Number(fd.amount) : NaN;
}
function txIds(tx) {
  return [tx.transactionId, tx.orderId, tx.orderNo, tx.merchantTradeNo, tx.prepayId].filter(Boolean).map(String);
}

/* ---------------- keys ---------------- */
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function genKey() {
  const out = [];
  while (out.length < 24) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    for (const x of b) { if (x < 256 - (256 % KEY_ALPHABET.length)) out.push(KEY_ALPHABET[x % KEY_ALPHABET.length]); if (out.length === 24) break; }
  }
  const s = out.join("");
  return "FIX-" + s.slice(0, 6) + "-" + s.slice(6, 12) + "-" + s.slice(12, 18) + "-" + s.slice(18, 24);
}
function keyStatus(k) {
  if (k.status === "revoked") return "Revoked";
  if (k.status === "sold") return k.expires_at && k.expires_at <= now() ? "Expired" : "Active";
  return "Unused";
}
async function notify(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) { console.log("notify:", text); return; }
  try {
    await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
    });
  } catch (e) {}
}
async function stockLeft(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_keys WHERE status = 'available'").first();
  return r ? r.n : 0;
}

// Claim the keys for a PAID order. Idempotent: never claims more than the
// package needs, even if called twice at the same time.
async function claimKeysForOrder(env, order, userId) {
  const pkg = PACKAGES[order.package];
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_keys WHERE order_id = ?").bind(order.id).first();
  const need = pkg.keys - (have ? have.n : 0);
  if (need > 0) {
    const t = now();
    const exp = addMonths(t, pkg.months);
    await env.DB.prepare(
      "UPDATE access_keys SET status = 'sold', sold_at = ?, expires_at = ?, order_id = ?, user_id = ?, x_username = ? " +
      "WHERE id IN (SELECT id FROM access_keys WHERE status = 'available' ORDER BY id ASC LIMIT ?) " +
      "AND (SELECT COUNT(*) FROM access_keys WHERE order_id = ?) < ? RETURNING key"
    ).bind(t, exp, order.id, userId, order.x_username || null, need, order.id, pkg.keys).all();
  }
  const rows = await env.DB.prepare("SELECT key, sold_at, expires_at, x_username, status FROM access_keys WHERE order_id = ? ORDER BY id").bind(order.id).all();
  return rows.results || [];
}

/* ---------------- routes ---------------- */
async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const M = req.method;
  const ip = clientIp(req);

  if (M === "GET" && (p === "/" || p === "/health")) return json(req, env, { ok: true, service: "fixasif-premium" });

  if (M === "GET" && p === "/config") {
    return json(req, env, {
      packages: Object.entries(PACKAGES).map(([id, v]) => ({ id, ...v, perKey: +(v.price / v.keys).toFixed(2) })),
      binanceUid: env.BINANCE_UID,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      googleClientId: env.GOOGLE_OAUTH_CLIENT_ID,
      googleRedirectUri: env.GOOGLE_REDIRECT_URI,
      extensionUrl: extUrl(env),
      supportUrl: SUPPORT_URL,
      orderMinutes: ORDER_TTL_MS / 60000
    });
  }

  if (M === "GET" && p === "/stats") {
    const sold = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_keys WHERE status = 'sold'").first();
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_keys WHERE status = 'sold' AND expires_at > ?").bind(now()).first();
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    return json(req, env, { keysSold: sold.n, activeKeys: active.n, users: users.n });
  }

  /* ----- auth ----- */
  if (M === "POST" && p === "/auth/signup") {
    await rateLimit(env, "signup:" + ip, 10, 3600e3);
    const b = await body(req);
    const email = normEmail(b.email), pw = String(b.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, "bad_email", "Enter a valid email address");
    if (pw.length < 8) fail(400, "weak_password", "Password must be at least 8 characters");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (exists) fail(409, "email_taken", "An account with this email already exists \u2014 please log in");
    const name = String(b.name || "").trim().slice(0, 60) || email.split("@")[0];
    const u = await env.DB.prepare("INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?) RETURNING *")
      .bind(email, await hashPassword(pw), name, now()).first();
    return json(req, env, await sessionFor(env, u));
  }
  if (M === "POST" && p === "/auth/login") {
    await rateLimit(env, "login:" + ip, 20, 900e3);
    const b = await body(req);
    const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(normEmail(b.email)).first();
    if (!u || !u.password_hash || !(await verifyPassword(String(b.password || ""), u.password_hash))) {
      if (u && !u.password_hash && u.google_id) fail(401, "use_google", "This account uses Google sign-in \u2014 tap \u201cContinue with Google\u201d");
      fail(401, "bad_credentials", "Wrong email or password");
    }
    return json(req, env, await sessionFor(env, u));
  }
  // Optional server-side redirect to Google (frontend normally builds this itself).
  if (M === "GET" && p === "/auth/google") {
    const q = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, response_type: "code",
      scope: "openid email profile", prompt: "select_account",
      state: url.searchParams.get("state") || "", code_challenge: url.searchParams.get("code_challenge") || "",
      code_challenge_method: "S256"
    });
    return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + q, 302);
  }
  if (M === "POST" && p === "/auth/google/exchange") {
    await rateLimit(env, "google:" + ip, 30, 900e3);
    const b = await body(req);
    if (!b.code) fail(400, "bad_request", "Missing Google code");
    const form = new URLSearchParams({
      code: b.code, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code"
    });
    if (b.codeVerifier) form.set("code_verifier", b.codeVerifier);
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) fail(401, "google_failed", "Google sign-in failed \u2014 please try again");
    const ir = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + tok.access_token } });
    const info = await ir.json();
    if (!info.sub || !info.email || info.email_verified === false) fail(401, "google_failed", "Google account email is not verified");
    const email = normEmail(info.email);
    let u = await env.DB.prepare("SELECT * FROM users WHERE google_id = ?").bind(info.sub).first();
    if (!u) {
      u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (u) u = await env.DB.prepare("UPDATE users SET google_id = ?, name = COALESCE(NULLIF(name,''), ?) WHERE id = ? RETURNING *").bind(info.sub, info.name || "", u.id).first();
      else u = await env.DB.prepare("INSERT INTO users (email, name, google_id, created_at) VALUES (?, ?, ?, ?) RETURNING *").bind(email, (info.name || email.split("@")[0]).slice(0, 60), info.sub, now()).first();
    }
    return json(req, env, await sessionFor(env, u));
  }
  if (M === "GET" && p === "/me") {
    const u = await requireUser(req, env);
    return json(req, env, { user: publicUser(u) });
  }

  /* ----- orders / payment ----- */
  if (M === "POST" && p === "/create-order") {
    const u = await requireUser(req, env);
    await rateLimit(env, "order:" + u.id, 20, 3600e3);
    const b = await body(req);
    const pkg = PACKAGES[b.packageId];
    if (!pkg) fail(400, "bad_package", "Unknown package");
    const xu = normX(b.xUsername);
    if (!/^[a-z0-9_]{1,15}$/.test(xu)) fail(400, "bad_username", "Enter a valid X username (letters, numbers, _ \u2014 max 15)");
    // reuse a still-open order for the same package + username (prevents spam)
    const open = await env.DB.prepare("SELECT * FROM orders WHERE user_id = ? AND package = ? AND x_username = ? AND status = 'pending' AND expires_at > ? ORDER BY id DESC LIMIT 1")
      .bind(u.id, b.packageId, xu, now() + 5 * 60e3).first();
    const o = open || await env.DB.prepare("INSERT INTO orders (package, amount, status, created_at, expires_at, ip, user_id, x_username) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?) RETURNING *")
      .bind(b.packageId, pkg.price, now(), now() + ORDER_TTL_MS, ip, u.id, xu).first();
    return json(req, env, { orderId: o.id, packageId: o.package, package: pkg.name, amount: o.amount, currency: "USDT", binanceUid: env.BINANCE_UID, expiresAt: o.expires_at, xUsername: xu });
  }

  if (M === "POST" && p === "/verify") {
    const u = await requireUser(req, env);
    await rateLimit(env, "verify:" + ip, 8, 600e3);
    await rateLimit(env, "verifyu:" + u.id, 12, 600e3);
    const b = await body(req);
    const binanceOrderId = String(b.binanceOrderId || "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(binanceOrderId)) fail(400, "bad_order_id", "Enter the Order ID from your Binance payment details");
    if (!(await checkTurnstile(env, b.turnstileToken, ip))) fail(403, "human_failed", "Human verification failed");

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(Number(b.orderId), u.id).first();
    if (!order) fail(404, "order_not_found", "Order not found \u2014 please start again");

    // Idempotent: already paid with this Binance order -> return the same keys
    if (order.status === "paid") {
      if (order.binance_order_id !== binanceOrderId) fail(409, "order_used", "This order is already paid with another Order ID");
      const keys = await claimKeysForOrder(env, order, u.id);
      return json(req, env, verifyResponse(env, order, keys));
    }
    const used = await env.DB.prepare("SELECT id FROM orders WHERE binance_order_id = ?").bind(binanceOrderId).first();
    if (used) fail(409, "order_id_used", "Order ID already used");
    if (now() > order.expires_at + VERIFY_GRACE_MS) {
      await env.DB.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(order.id).run();
      fail(410, "order_expired", "Order expired \u2014 please create a new order");
    }

    const from = order.created_at - 10 * 60e3;
    const to = Math.min(now(), order.expires_at + VERIFY_GRACE_MS);
    const txs = await binancePayTransactions(env, from, to);
    const tx = txs.find((t) => txIds(t).includes(binanceOrderId));
    if (!tx) fail(404, "payment_not_found", "Payment not found \u2014 check the Order ID, or wait 1 minute and try again");
    const amt = txAmountUSDT(tx);
    if (!(amt > 0)) fail(400, "not_received", "This Order ID is not a payment received by FixAsif");
    if (Math.abs(amt - order.amount) > 0.000001) fail(400, "amount_mismatch", "Amount mismatch \u2014 please send exactly " + order.amount + " USDT");
    const txTime = Number(tx.transactionTime || 0);
    if (txTime && (txTime < order.created_at - 5 * 60e3 || txTime > order.expires_at + 2 * 60e3)) fail(410, "order_expired", "Order expired \u2014 payment was not made within 30 minutes of this order");
    if (env.BINANCE_UID && tx.receiverInfo && tx.receiverInfo.binanceId && String(tx.receiverInfo.binanceId) !== String(env.BINANCE_UID)) {
      fail(400, "wrong_receiver", "This payment was not sent to FixAsif");
    }

    // Mark paid (UNIQUE binance_order_id guarantees one use), then claim keys.
    try {
      const r = await env.DB.prepare("UPDATE orders SET status = 'paid', binance_order_id = ?, paid_at = ? WHERE id = ? AND status = 'pending'")
        .bind(binanceOrderId, now(), order.id).run();
      if (!r.meta || r.meta.changes !== 1) {
        const again = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first();
        if (!again || again.binance_order_id !== binanceOrderId) fail(409, "order_id_used", "Order ID already used");
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (/UNIQUE/i.test(String(e))) fail(409, "order_id_used", "Order ID already used");
      throw e;
    }
    order.status = "paid"; order.binance_order_id = binanceOrderId; order.paid_at = now();
    const keys = await claimKeysForOrder(env, order, u.id);
    const left = await stockLeft(env);
    const pkg = PACKAGES[order.package];
    ctx.waitUntil((async () => {
      await notify(env, "\u2705 New sale: " + pkg.name + " \u2014 " + order.amount + " USDT\nUser: " + u.email + "\nKeys: " + keys.length + "\nStock left: " + left);
      if (keys.length < pkg.keys) await notify(env, "\u26a0\ufe0f OUT OF KEYS \u2014 order #" + order.id + " is paid but missing keys. Add keys now!");
      else if (left < LOW_STOCK) await notify(env, "\u26a0\ufe0f Low stock: only " + left + " access keys left.");
    })());
    return json(req, env, verifyResponse(env, order, keys));
  }

  /* ----- extension login ----- */
  if (M === "POST" && p === "/verify-extension") {
    await rateLimit(env, "ext:" + ip, 30, 600e3);
    const b = await body(req);
    const key = String(b.accessKey || "").trim().toUpperCase();
    const xu = normX(b.xUsername);
    if (!key) fail(400, "bad_key", "Enter your Access Key");
    if (!/^[a-z0-9_]{1,15}$/.test(xu)) fail(400, "bad_username", "Enter a valid X username");
    const k = await env.DB.prepare("SELECT * FROM access_keys WHERE key = ?").bind(key).first();
    if (!k || k.status === "available") fail(401, "invalid_key", "Invalid Access Key");
    if (k.status === "revoked") fail(403, "revoked", "This Access Key has been revoked \u2014 contact support");
    if (!k.expires_at || k.expires_at <= now()) fail(403, "expired", "This Access Key has expired \u2014 buy a new key at fixasif.com/agent");
    const t = now();
    if (!k.x_username) {
      const r = await env.DB.prepare("UPDATE access_keys SET x_username = ?, last_login_at = ? WHERE key = ? AND x_username IS NULL").bind(xu, t, key).run();
      if (!r.meta || r.meta.changes !== 1) {
        const again = await env.DB.prepare("SELECT x_username FROM access_keys WHERE key = ?").bind(key).first();
        if (!again || again.x_username !== xu) fail(403, "bound_other", "This Access Key is already linked to another X account");
      }
    } else if (k.x_username !== xu) {
      fail(403, "bound_other", "This Access Key is linked to @" + k.x_username + " \u2014 log in with that X username");
    } else {
      await env.DB.prepare("UPDATE access_keys SET last_login_at = ? WHERE key = ?").bind(t, key).run();
    }
    return json(req, env, { ok: true, xUsername: xu, expiresAt: k.expires_at, status: "Active" });
  }

  /* ----- dashboard ----- */
  if (M === "GET" && p === "/dashboard/keys") {
    const u = await requireUser(req, env);
    const r = await env.DB.prepare(
      "SELECT k.key, k.status, k.sold_at, k.expires_at, k.x_username, k.last_login_at, o.package, o.amount, o.binance_order_id, o.id AS oid FROM access_keys k LEFT JOIN orders o ON o.id = k.order_id WHERE k.user_id = ? ORDER BY k.sold_at DESC"
    ).bind(u.id).all();
    return json(req, env, { keys: (r.results || []).map((k) => ({
      key: k.key, status: keyStatus(k), soldAt: k.sold_at, expiresAt: k.expires_at,
      xUsername: k.x_username, lastLoginAt: k.last_login_at, package: PACKAGES[k.package] ? PACKAGES[k.package].name : k.package,
      amount: k.amount, binanceOrderId: k.binance_order_id, orderId: k.oid
    })), extensionUrl: extUrl(env) });
  }
  if (M === "GET" && p === "/dashboard/history") {
    const u = await requireUser(req, env);
    const r = await env.DB.prepare("SELECT id, package, amount, status, binance_order_id, created_at, paid_at, x_username FROM orders WHERE user_id = ? AND status = 'paid' ORDER BY id DESC").bind(u.id).all();
    return json(req, env, { orders: (r.results || []).map((o) => ({
      id: o.id, package: PACKAGES[o.package] ? PACKAGES[o.package].name : o.package, amount: o.amount, currency: "USDT",
      status: o.status, binanceOrderId: o.binance_order_id, createdAt: o.created_at, paidAt: o.paid_at, xUsername: o.x_username
    })) });
  }
  if (M === "POST" && p === "/dashboard/update") {
    const u = await requireUser(req, env);
    await rateLimit(env, "upd:" + u.id, 20, 3600e3);
    const b = await body(req);
    let { email, name, password_hash, token_version } = u;
    const needCurrent = () => {
      if (!u.password_hash) return Promise.resolve(true);
      return verifyPassword(String(b.currentPassword || ""), u.password_hash);
    };
    if (b.name !== undefined) name = String(b.name).trim().slice(0, 60);
    if (b.email !== undefined && normEmail(b.email) !== u.email) {
      const ne = normEmail(b.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ne)) fail(400, "bad_email", "Enter a valid email address");
      if (!(await needCurrent())) fail(401, "bad_password", "Current password is wrong");
      const ex = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?").bind(ne, u.id).first();
      if (ex) fail(409, "email_taken", "That email is already used by another account");
      email = ne;
    }
    if (b.newPassword !== undefined) {
      const np = String(b.newPassword);
      if (np.length < 8) fail(400, "weak_password", "New password must be at least 8 characters");
      if (!(await needCurrent())) fail(401, "bad_password", "Current password is wrong");
      password_hash = await hashPassword(np);
      token_version = (token_version || 0) + 1; // log out other sessions
    }
    const nu = await env.DB.prepare("UPDATE users SET email = ?, name = ?, password_hash = ?, token_version = ? WHERE id = ? RETURNING *")
      .bind(email, name, password_hash, token_version, u.id).first();
    return json(req, env, await sessionFor(env, nu));
  }

  fail(404, "not_found", "Not found");
}
function verifyResponse(env, order, keys) {
  const pkg = PACKAGES[order.package];
  const base = { ok: true, orderId: order.id, package: pkg.name, months: pkg.months, amount: order.amount, currency: "USDT",
    binanceOrderId: order.binance_order_id, xUsername: order.x_username, paidAt: order.paid_at || now(),
    extensionUrl: extUrl(env), supportUrl: SUPPORT_URL };
  if (!keys.length) {
    return { ...base, pending: true, keys: [],
      message: "Payment received! Your key will be delivered shortly \u2014 please contact support on Telegram." };
  }
  return { ...base, keys: keys.map((k) => ({ key: k.key, soldAt: k.sold_at, expiresAt: k.expires_at, xUsername: k.x_username })) };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      return await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json(req, env, { ok: false, error: e.code, message: e.message }, e.status);
      console.log("error", e && e.stack || String(e));
      return json(req, env, { ok: false, error: "server_error", message: "Something went wrong \u2014 please try again" }, 500);
    }
  },
  // daily cleanup: expire stale pending orders, drop old rate-limit rows
  async scheduled(event, env) {
    await env.DB.prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at < ?").bind(now() - VERIFY_GRACE_MS).run();
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now() - 86400e3).run();
  }
};
export { genKey, PACKAGES };
