/* Fix X Agent — Premium Access Key site */
(() => {
"use strict";
const API = "https://fixasif-premium.fixasif.workers.dev";
const TK = "fxa_token";
const SUPPORT = "https://t.me/Fixasif";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtDT = (t) => t ? new Date(t).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const FALLBACK_PACKAGES = [
  { id: "starter", name: "Starter", price: 5, keys: 1, months: 3 },
  { id: "standard", name: "Standard", price: 7, keys: 1, months: 6, badge: "Save 30%" },
  { id: "bestvalue", name: "Best Value", price: 10, keys: 1, months: 12, badge: "Best Value — Save 55%" }
];
let CFG = { packages: FALLBACK_PACKAGES, extensionUrl: "#", supportUrl: SUPPORT, orderMinutes: 30 };
let USER = null, pendingPlan = null, order = null, timerId = 0, tsWidget = null, lastReceipt = null, KEYS = [];

/* ---------- api ---------- */
async function api(path, opts = {}) {
  const h = { "Content-Type": "application/json" };
  const t = localStorage.getItem(TK);
  if (t) h.Authorization = "Bearer " + t;
  let r;
  try { r = await fetch(API + path, { method: opts.method || (opts.body ? "POST" : "GET"), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { throw Object.assign(new Error("Network error — check your internet and try again"), { code: "network" }); }
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok || d.ok === false) {
    if (r.status === 401 && t && !opts.keepToken) { localStorage.removeItem(TK); USER = null; renderUser(); }
    throw Object.assign(new Error(d.message || "Something went wrong — please try again"), { code: d.error, status: r.status });
  }
  return d;
}

/* ---------- toast / copy ---------- */
let toastT = 0;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }
async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) {} ta.remove(); }
  toast(label + " ✓");
}
function setMsg(form, text, type) { const m = $(".form-msg", form); if (!m) return; m.textContent = text || ""; m.className = "form-msg" + (type ? " " + type : ""); }
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + (label || "Please wait…"); } else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; } }

/* ---------- session ---------- */
function setSession(d) { if (d.token) localStorage.setItem(TK, d.token); USER = d.user || USER; renderUser(); }
function renderUser() {
  document.body.classList.toggle("authed", !!USER);
  if (!USER) { if (location.hash.startsWith("#/dashboard")) route(); return; }
  const nm = USER.name || USER.email.split("@")[0];
  $("#navAvatar").textContent = (nm[0] || "U").toUpperCase();
  $("#navName").textContent = nm;
  $("#dashName").textContent = nm;
  $("#dashEmail").textContent = USER.email;
  const fp = $("#formProfile"); fp.name.value = USER.name || ""; fp.email.value = USER.email;
  $$(".pw-current").forEach((el) => (el.hidden = !USER.hasPassword));
  $("#pwTitle").textContent = USER.hasPassword ? "Change password" : "Set a password";
}
async function loadMe() {
  if (!localStorage.getItem(TK)) { renderUser(); return; }
  try { const d = await api("/me"); USER = d.user; } catch (e) { if (e.status === 401) USER = null; }
  renderUser();
}
function logout() { localStorage.removeItem(TK); USER = null; KEYS = []; renderUser(); closeDropdown(); location.hash = ""; showView("landing"); toast("Logged out"); }

/* ---------- modals ---------- */
function openModal(id) { const m = $("#" + id); m.hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(id) { const m = $("#" + id); if (!m || m.hidden) return; m.hidden = true; if ($$(".modal").every((x) => x.hidden)) document.body.style.overflow = ""; if (id === "payModal") stopTimer(); }

/* ---------- auth ---------- */
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  const m = $("#authModal"); m.classList.toggle("is-signup", mode === "signup");
  $$("[data-tab-auth]").forEach((b) => b.classList.toggle("active", b.dataset.tabAuth === mode));
  $("#authTitle").textContent = mode === "signup" ? "Create your account" : "Welcome back";
  $("#authSub").textContent = mode === "signup" ? "Your keys and receipts stay safe in your dashboard." : "Log in to buy keys and see your dashboard.";
  $("#authSubmit").textContent = mode === "signup" ? "Create account" : "Log in";
  $("#authForm").password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  setMsg($("#authForm"), "");
}
function openAuth(mode = "login") { setAuthMode(mode); openModal("authModal"); setTimeout(() => $("#authForm").email.focus(), 50); }
function pwStrength(v) {
  let s = 0; if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
  const bar = $(".pw-meter span"); const c = ["#ff3b5c", "#ff3b5c", "#fbbf24", "#fbbf24", "#39ff88", "#39ff88"][s];
  bar.style.width = (v ? Math.max(12, s * 20) : 0) + "%"; bar.style.background = c;
}
async function submitAuth(e) {
  e.preventDefault();
  const f = e.target, btn = $("#authSubmit");
  const email = f.email.value.trim(), password = f.password.value, name = f.name.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setMsg(f, "Enter a valid email address", "err");
  if (password.length < 8) return setMsg(f, "Password must be at least 8 characters", "err");
  setMsg(f, ""); busy(btn, true);
  try {
    const d = await api(authMode === "signup" ? "/auth/signup" : "/auth/login", { body: authMode === "signup" ? { email, password, name } : { email, password } });
    setSession(d); f.reset(); pwStrength(""); closeModal("authModal");
    toast(authMode === "signup" ? "Account created 🎉" : "Welcome back!");
    afterLogin();
  } catch (err) { setMsg(f, err.message, "err"); }
  finally { busy(btn, false); }
}
function afterLogin() {
  if (pendingPlan) { const p = pendingPlan; pendingPlan = null; startCheckout(p); return; }
  if (!location.hash.startsWith("#/dashboard")) location.hash = "#/dashboard"; else route();
}

/* ---------- Google (PKCE) ---------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function googleLogin() {
  if (!CFG.googleClientId || !CFG.googleRedirectUri) { toast("Google sign-in is not available right now"); return; }
  const state = rand(16), verifier = rand(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("fxa_g_state", state);
  sessionStorage.setItem("fxa_g_verifier", verifier);
  sessionStorage.setItem("fxa_g_return", pendingPlan ? "#buy=" + pendingPlan : "#/dashboard");
  const q = new URLSearchParams({ client_id: CFG.googleClientId, redirect_uri: CFG.googleRedirectUri, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}

/* ---------- pricing ---------- */
const FEATS = ["AI replies with your own key", "Auto-Scroll like & comment", "Link Engage (bulk links)", "PC Chrome + Kiwi Android", "Works with 1 X account"];
function renderPricing() {
  const pk = (CFG.packages && CFG.packages.length ? CFG.packages : FALLBACK_PACKAGES);
  const base = pk[0] ? pk[0].price / pk[0].months : 0;
  $("#pricingGrid").innerHTML = pk.map((p, i) => {
    const per = (p.price / p.months).toFixed(2);
    const featured = p.id === "bestvalue";
    const badge = p.badge ? `<span class="badge${featured ? "" : " save"}">${esc(p.badge)}</span>` : "";
    return `<div class="card plan reveal${featured ? " featured" : ""}">${badge}
      <span class="plan-name">${esc(p.name)}</span>
      <div class="plan-price"><b>$${esc(p.price)}</b><span>USDT</span></div>
      <div class="plan-sub">${p.months} months access · $${per}/month${i && base ? "" : ""}</div>
      <ul>${[`${p.keys} Access Key · ${p.months} months`, ...FEATS].map((f) => `<li><i class="fa-solid fa-check"></i>${esc(f)}</li>`).join("")}</ul>
      <button class="btn ${featured ? "btn-primary" : "btn-ghost"} btn-block" data-buy="${esc(p.id)}"><i class="fa-solid fa-key"></i> Buy ${esc(p.name)}</button>
    </div>`;
  }).join("");
  observeReveal();
}

/* ---------- checkout ---------- */
function showStep(n) {
  $$("#payModal .pay-step").forEach((s) => (s.hidden = s.dataset.step !== String(n)));
  $$(".stepper span").forEach((s, i) => { s.classList.toggle("active", i + 1 === n); s.classList.toggle("done", i + 1 < n); });
}
function startCheckout(planId) {
  const p = (CFG.packages || FALLBACK_PACKAGES).find((x) => x.id === planId);
  if (!p) return;
  if (!USER) { pendingPlan = planId; openAuth("signup"); toast("Create an account (or log in) to buy"); return; }
  order = { plan: p };
  $("#payPlan").textContent = `${p.name} — ${p.months} months · ${p.price} USDT`;
  showStep(1);
  $("#xUserForm").hidden = false; $("#payDetails").hidden = true; setMsg($("#xUserForm"), "");
  $("#xUserForm").xUsername.value = localStorage.getItem("fxa_last_xuser") || "";
  $("#verifyForm").reset(); setMsg($("#verifyForm"), "");
  openModal("payModal");
  setTimeout(() => $("#xUserForm").xUsername.focus(), 60);
}
const cleanX = (v) => String(v || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#\s]/)[0].toLowerCase();
async function submitXUser(e) {
  e.preventDefault();
  const f = e.target, xu = cleanX(f.xUsername.value);
  if (!/^[a-z0-9_]{1,15}$/.test(xu)) return setMsg(f, "Enter a valid X username (letters, numbers, _ — max 15)", "err");
  setMsg(f, ""); const btn = $("#xUserBtn"); busy(btn, true, "Creating your order…");
  try {
    const d = await api("/create-order", { body: { packageId: order.plan.id, xUsername: xu } });
    order = { ...order, ...d };
    localStorage.setItem("fxa_last_xuser", xu);
    $("#payXUser").textContent = "@" + d.xUsername;
    $("#payAmount").textContent = d.amount;
    $$(".amt-inline").forEach((el) => (el.textContent = d.amount));
    $("#payUid").textContent = d.binanceUid || CFG.binanceUid || "—";
    f.hidden = true; $("#payDetails").hidden = false;
    startTimer(d.expiresAt);
  } catch (err) {
    if (err.status === 401) { closeModal("payModal"); pendingPlan = order.plan.id; openAuth("login"); }
    setMsg(f, err.message, "err");
  } finally { busy(btn, false); }
}
function startTimer(exp) {
  stopTimer();
  const el = $("#payTimer");
  const tick = () => {
    const left = Math.max(0, exp - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    el.parentElement.classList.toggle("late", left < 5 * 60000);
    if (!left) { stopTimer(); toast("Order expired — please start again"); }
  };
  tick(); timerId = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(timerId); timerId = 0; }
function goVerify() { showStep(2); renderTurnstile(); setTimeout(() => $("#verifyForm").binanceOrderId.focus(), 60); }
function renderTurnstile() {
  const box = $("#turnstileBox");
  if (!CFG.turnstileSiteKey) return;
  if (!window.turnstile) { setTimeout(renderTurnstile, 400); return; }
  if (tsWidget !== null) { try { turnstile.reset(tsWidget); } catch (e) {} return; }
  tsWidget = turnstile.render(box, { sitekey: CFG.turnstileSiteKey, theme: "dark", "error-callback": () => { setTimeout(() => { try { turnstile.reset(tsWidget); } catch (e) {} }, 1500); } });
}
async function submitVerify(e) {
  e.preventDefault();
  const f = e.target, id = f.binanceOrderId.value.replace(/\s+/g, "");
  if (!/^\d{6,30}$/.test(id)) return setMsg(f, "Paste the Binance Order ID (numbers only) from your Pay history", "err");
  let token = "";
  try { token = window.turnstile && tsWidget !== null ? turnstile.getResponse(tsWidget) : ""; } catch (err) {}
  if (CFG.turnstileSiteKey && !token) return setMsg(f, "Please complete the “I am human” check first", "err");
  setMsg(f, ""); const btn = $("#verifyBtn"), ld = $(".pay-loading", f);
  busy(btn, true, "Verifying…"); ld.hidden = false;
  try {
    const d = await api("/verify", { body: { orderId: order.orderId, binanceOrderId: id, turnstileToken: token } });
    stopTimer(); showSuccess(d);
  } catch (err) {
    setMsg(f, err.message, "err");
    try { turnstile.reset(tsWidget); } catch (_) {}
  } finally { busy(btn, false); ld.hidden = true; }
}

/* ---------- receipt ---------- */
function receiptData(d, k) {
  return {
    key: k ? k.key : "", xUsername: (k && k.xUsername) || d.xUsername || "", plan: d.package, months: d.months,
    purchased: (k && k.soldAt) || d.paidAt, expires: k ? k.expiresAt : null, amount: d.amount, currency: d.currency || "USDT",
    binanceOrderId: d.binanceOrderId, orderId: d.orderId, email: USER ? USER.email : "", extensionUrl: d.extensionUrl || CFG.extensionUrl, supportUrl: d.supportUrl || SUPPORT
  };
}
function receiptHTML(r) {
  return `<div class="receipt">
    <div class="receipt-head"><span>FIX X AGENT · RECEIPT</span><span>#${esc(r.orderId || "—")}</span></div>
    ${r.key ? `<div class="receipt-key"><b>${esc(r.key)}</b><button class="icon-btn" type="button" data-copy="${esc(r.key)}" title="Copy key"><i class="fa-regular fa-copy"></i></button></div>` : ""}
    <dl>
      <dt>X username</dt><dd>@${esc(r.xUsername)}</dd>
      <dt>Plan</dt><dd>${esc(r.plan)}${r.months ? " · " + r.months + " months" : ""}</dd>
      <dt>Purchased</dt><dd>${fmtDT(r.purchased)}</dd>
      <dt>Expires</dt><dd>${fmtDate(r.expires)}</dd>
      <dt>Amount</dt><dd>${esc(r.amount)} ${esc(r.currency)}</dd>
      <dt>Binance Order ID</dt><dd class="mono">${esc(r.binanceOrderId || "—")}</dd>
      ${r.email ? `<dt>Account</dt><dd>${esc(r.email)}</dd>` : ""}
    </dl></div>`;
}
function receiptText(r) {
  return [
    "FIX X AGENT — PURCHASE RECEIPT", "==============================", "",
    "Access Key:        " + (r.key || "(pending)"),
    "X username:        @" + r.xUsername,
    "Plan:              " + r.plan + (r.months ? " (" + r.months + " months)" : ""),
    "Purchased:         " + fmtDT(r.purchased),
    "Expires:           " + fmtDate(r.expires),
    "Amount:            " + r.amount + " " + r.currency,
    "Binance Order ID:  " + (r.binanceOrderId || "-"),
    "Order #:           " + (r.orderId || "-"),
    r.email ? "Account:           " + r.email : "", "",
    "HOW TO USE", "1. Install the extension: " + r.extensionUrl,
    "2. Open the extension and enter the Access Key + X username @" + r.xUsername + ".",
    "3. The key works ONLY with this X username.", "",
    "Support (Telegram): " + r.supportUrl, "Keep this receipt safe. Do not share your key."
  ].filter((l) => l !== "").join("\n").replace(/\nHOW/, "\n\nHOW").replace(/\nSupport/, "\n\nSupport");
}
function downloadReceipt(r) {
  if (!r) return;
  const blob = new Blob([receiptText(r)], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "fix-receipt-" + (r.orderId || "key") + ".txt"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Receipt downloaded");
}
function printReceipt(r) {
  if (!r) return;
  const row = (a, b) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
  $("#printArea").innerHTML = `<div class="pr"><h1>Fix X Agent — Receipt</h1>
    <div class="pk">${esc(r.key || "(pending)")}</div>
    <table>${row("X username", "@" + r.xUsername)}${row("Plan", r.plan + (r.months ? " (" + r.months + " months)" : ""))}${row("Purchased", fmtDT(r.purchased))}${row("Expires", fmtDate(r.expires))}${row("Amount", r.amount + " " + r.currency)}${row("Binance Order ID", r.binanceOrderId || "-")}${row("Order #", r.orderId || "-")}${r.email ? row("Account", r.email) : ""}</table>
    <ol><li>Install the extension: ${esc(r.extensionUrl)}</li><li>Enter the Access Key + X username @${esc(r.xUsername)}.</li><li>The key works only with this X username.</li></ol>
    <div class="pf">Support: ${esc(r.supportUrl)} · Printed ${esc(new Date().toLocaleString())}</div></div>`;
  window.print();
}
function showSuccess(d) {
  const k = d.keys && d.keys[0];
  lastReceipt = receiptData(d, k);
  $("#successMsg").textContent = d.pending ? d.message : "Your key is ready. The receipt is also saved in your account.";
  $("#successReceipt").innerHTML = receiptHTML(lastReceipt);
  setExtLinks(d.extensionUrl);
  showStep(3); confetti();
  KEYS = []; // refresh dashboard next time
}

/* ---------- dashboard ---------- */
function setExtLinks(url) {
  if (url) CFG.extensionUrl = url;
  $$("[data-ext-link]").forEach((a) => { a.href = CFG.extensionUrl || "#"; });
}
const mask = (k) => k.slice(0, 4) + k.slice(4).replace(/[A-Z0-9]/g, "•");
function keyCard(k, i) {
  const total = k.expiresAt && k.soldAt ? k.expiresAt - k.soldAt : 0;
  const pct = total ? Math.max(0, Math.min(100, ((k.expiresAt - Date.now()) / total) * 100)) : 0;
  const days = k.expiresAt ? Math.max(0, Math.ceil((k.expiresAt - Date.now()) / 864e5)) : 0;
  return `<div class="card keyrow reveal">
    <div class="keyrow-top"><span class="k" data-k="${i}">${esc(mask(k.key))}</span>
      <div class="keyrow-actions">
        <button class="icon-btn" data-reveal="${i}" title="Show / hide"><i class="fa-regular fa-eye"></i></button>
        <button class="icon-btn" data-copy="${esc(k.key)}" title="Copy key"><i class="fa-regular fa-copy"></i></button>
        <button class="icon-btn" data-dl="${i}" title="Download receipt"><i class="fa-solid fa-file-arrow-down"></i></button>
        <button class="icon-btn" data-print="${i}" title="Print receipt"><i class="fa-solid fa-print"></i></button>
      </div></div>
    <div class="keymeta"><span class="status ${esc(k.status)}">${esc(k.status)}</span>
      <span>X: <b>@${esc(k.xUsername || "—")}</b></span><span>Plan: <b>${esc(k.package || "—")}</b></span>
      <span>Bought: <b>${fmtDate(k.soldAt)}</b></span><span>Expires: <b>${fmtDate(k.expiresAt)}</b>${k.status === "Active" ? ` (${days} days left)` : ""}</span>
      ${k.binanceOrderId ? `<span>Binance: <b class="mono">${esc(k.binanceOrderId)}</b></span>` : ""}</div>
    ${k.status === "Active" ? `<div class="life"><span style="width:${pct.toFixed(1)}%"></span></div>` : ""}
  </div>`;
}
function keyReceipt(k) {
  const pkg = (CFG.packages || FALLBACK_PACKAGES).find((p) => p.name === k.package);
  return { key: k.key, xUsername: k.xUsername || "", plan: k.package, months: pkg ? pkg.months : "", purchased: k.soldAt, expires: k.expiresAt, amount: k.amount, currency: "USDT", binanceOrderId: k.binanceOrderId, orderId: k.orderId, email: USER ? USER.email : "", extensionUrl: CFG.extensionUrl, supportUrl: SUPPORT };
}
async function loadKeys() {
  const list = $("#keysList");
  list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const d = await api("/dashboard/keys");
    KEYS = d.keys || []; setExtLinks(d.extensionUrl);
    const act = KEYS.filter((k) => k.status === "Active");
    $("#stActive").textContent = act.length;
    $("#stTotal").textContent = KEYS.length;
    const nx = act.map((k) => k.expiresAt).filter(Boolean).sort((a, b) => a - b)[0];
    $("#stNext").textContent = nx ? fmtDate(nx) : "—";
    list.innerHTML = KEYS.length ? KEYS.map(keyCard).join("") : `<div class="card empty"><i class="fa-solid fa-key"></i><p>No keys yet.</p><a href="#pricing" class="btn btn-primary" data-go-pricing>Buy your first key</a></div>`;
    observeReveal();
  } catch (e) { list.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}
async function loadHistory() {
  const body = $("#historyBody"); body.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
  try {
    const d = await api("/dashboard/history"); const o = d.orders || [];
    $("#historyEmpty").hidden = !!o.length;
    body.innerHTML = o.map((x) => `<tr><td>${fmtDate(x.paidAt || x.createdAt)}</td><td>${esc(x.package)}</td><td>@${esc(x.xUsername || "—")}</td><td>${esc(x.amount)} ${esc(x.currency)}</td><td class="mono">${esc(x.binanceOrderId || "—")}</td><td><span class="status Paid">Paid</span></td></tr>`).join("");
  } catch (e) { body.innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
}
async function submitProfile(e) {
  e.preventDefault(); const f = e.target, btn = $("button[type=submit]", f);
  const b = { name: f.name.value.trim(), email: f.email.value.trim() };
  if (USER.hasPassword && b.email.toLowerCase() !== USER.email) b.currentPassword = f.currentPassword.value;
  busy(btn, true);
  try { setSession(await api("/dashboard/update", { body: b })); f.currentPassword.value = ""; setMsg(f, "Saved ✓", "ok"); }
  catch (err) { setMsg(f, err.message, "err"); } finally { busy(btn, false); }
}
async function submitPassword(e) {
  e.preventDefault(); const f = e.target, btn = $("button[type=submit]", f);
  if (f.newPassword.value.length < 8) return setMsg(f, "New password must be at least 8 characters", "err");
  const b = { newPassword: f.newPassword.value }; if (USER.hasPassword) b.currentPassword = f.currentPassword.value;
  busy(btn, true);
  try { setSession(await api("/dashboard/update", { body: b })); f.reset(); setMsg(f, "Password updated ✓", "ok"); }
  catch (err) { setMsg(f, err.message, "err"); } finally { busy(btn, false); }
}

/* ---------- router ---------- */
function showView(v) { $("#viewLanding").hidden = v !== "landing"; $("#viewDashboard").hidden = v !== "dashboard"; }
function route() {
  const h = location.hash;
  if (h.startsWith("#buy=")) { const p = h.slice(5); history.replaceState(null, "", location.pathname); showView("landing"); waitCfg.then(() => startCheckout(p)); return; }
  if (h.startsWith("#/dashboard")) {
    if (!USER) { if (localStorage.getItem(TK)) return; showView("landing"); openAuth("login"); return; }
    const tab = h.includes("history") ? "history" : h.includes("settings") ? "settings" : "keys";
    showView("dashboard"); window.scrollTo(0, 0);
    $$("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (tab === "keys") loadKeys(); else if (tab === "history") loadHistory();
    return;
  }
  showView("landing");
  if (h && h.length > 1 && !h.startsWith("#/")) { const t = document.getElementById(h.slice(1)); if (t) setTimeout(() => t.scrollIntoView({ behavior: "smooth" }), 30); }
}

/* ---------- effects ---------- */
function scrambleKey() {
  const el = $("#keyPreview"); if (!el) return; const C = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const target = "FIX-" + Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => C[Math.random() * C.length | 0]).join("")).join("-");
  let f = 0; const iv = setInterval(() => { f++; el.textContent = target.split("").map((ch, i) => ch === "-" || i < f ? ch : C[Math.random() * C.length | 0]).join(""); if (f >= target.length) clearInterval(iv); }, 35);
}
function countUp(el, n) { const t0 = performance.now(), d = 1200; const step = (t) => { const p = Math.min(1, (t - t0) / d); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))).toLocaleString(); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
let io = null;
function observeReveal() {
  if (!("IntersectionObserver" in window)) { $$(".reveal").forEach((e) => e.classList.add("in")); return; }
  io = io || new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.12 });
  $$(".reveal:not(.in)").forEach((e) => io.observe(e));
}
function confetti() {
  const cv = document.createElement("canvas"); cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999"; document.body.appendChild(cv);
  const ctx = cv.getContext("2d"); cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#a78bfa", "#7c3aed", "#39ff88", "#60a5fa", "#f472b6"];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -12 - 2, s: Math.random() * 6 + 3, c: cols[Math.random() * cols.length | 0], r: Math.random() * 6 }));
  let fr = 0; (function loop() { ctx.clearRect(0, 0, cv.width, cv.height); ps.forEach((p) => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); ctx.restore(); }); if (++fr < 150) requestAnimationFrame(loop); else cv.remove(); })();
}
function closeDropdown() { $("#userDropdown").classList.remove("open"); $("#userMenuBtn").setAttribute("aria-expanded", "false"); }

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a"); if (!t) { if (!e.target.closest(".user-menu")) closeDropdown(); return; }
  if (!t.closest(".user-menu")) closeDropdown();
  if (t.matches("[data-auth]")) { pendingPlan = null; openAuth(t.dataset.auth); }
  else if (t.matches("[data-tab-auth]")) setAuthMode(t.dataset.tabAuth);
  else if (t.matches("[data-close]")) { const m = t.closest(".modal"); if (m) closeModal(m.id); }
  else if (t.matches("[data-close-go]")) { e.preventDefault(); closeModal("payModal"); location.hash = "#/dashboard"; route(); }
  else if (t.matches("[data-logout]")) logout();
  else if (t.matches("[data-buy]")) startCheckout(t.dataset.buy);
  else if (t.matches("[data-go-pricing]")) { e.preventDefault(); showView("landing"); history.replaceState(null, "", location.pathname + "#pricing"); $("#pricing").scrollIntoView({ behavior: "smooth" }); }
  else if (t.matches("[data-copy]")) copy(t.dataset.copy, "Key copied");
  else if (t.matches("[data-copy-target]")) copy($("#" + t.dataset.copyTarget).textContent.trim(), "Copied");
  else if (t.matches("[data-reveal]")) { const i = +t.dataset.reveal, el = $(`[data-k="${i}"]`); const shown = el.textContent === KEYS[i].key; el.textContent = shown ? mask(KEYS[i].key) : KEYS[i].key; t.innerHTML = shown ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>'; }
  else if (t.matches("[data-dl]")) downloadReceipt(keyReceipt(KEYS[+t.dataset.dl]));
  else if (t.matches("[data-print]")) printReceipt(keyReceipt(KEYS[+t.dataset.print]));
  else if (t.id === "googleBtn") googleLogin();
  else if (t.id === "userMenuBtn") { const dd = $("#userDropdown"); dd.classList.toggle("open"); t.setAttribute("aria-expanded", dd.classList.contains("open")); }
  else if (t.id === "navToggle") $("#navLinks").classList.toggle("open");
  else if (t.closest("#navLinks") && t.tagName === "A") $("#navLinks").classList.remove("open");
  else if (t.id === "changeXUser") { stopTimer(); $("#payDetails").hidden = true; $("#xUserForm").hidden = false; $("#xUserForm").xUsername.focus(); }
  else if (t.id === "confirmPayBtn") goVerify();
  else if (t.id === "backStep1") showStep(1);
  else if (t.id === "pasteBtn") navigator.clipboard && navigator.clipboard.readText().then((v) => { $("#verifyForm").binanceOrderId.value = v.replace(/\D/g, ""); }).catch(() => toast("Paste manually (long-press → Paste)"));
  else if (t.id === "dlReceipt") downloadReceipt(lastReceipt);
  else if (t.id === "printReceipt") printReceipt(lastReceipt);
  else if (t.matches(".pw-eye") && t.id !== "pasteBtn") { const inp = t.parentElement.querySelector("input"); inp.type = inp.type === "password" ? "text" : "password"; t.innerHTML = inp.type === "password" ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>'; }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $$(".modal").forEach((m) => closeModal(m.id)); closeDropdown(); } });
$("#authForm").addEventListener("submit", submitAuth);
$("#authForm").password.addEventListener("input", (e) => authMode === "signup" && pwStrength(e.target.value));
$("#xUserForm").addEventListener("submit", submitXUser);
$("#xUserForm").xUsername.addEventListener("input", (e) => { const v = e.target.value; if (/^@|[A-Z]/.test(v)) e.target.value = v.replace(/^@+/, "").toLowerCase(); });
$("#verifyForm").addEventListener("submit", submitVerify);
$("#formProfile").addEventListener("submit", submitProfile);
$("#formPassword").addEventListener("submit", submitPassword);
window.addEventListener("hashchange", route);

/* ---------- boot ---------- */
$("#year").textContent = new Date().getFullYear();
const waitCfg = api("/config").then((c) => { CFG = { ...CFG, ...c }; }).catch(() => {}).finally(() => { renderPricing(); setExtLinks(); });
renderPricing(); setExtLinks(); observeReveal(); scrambleKey(); setInterval(scrambleKey, 6000);
api("/stats").then((s) => {
  if ((s.keysSold || 0) < 10) { const hs = $(".hero-stats"); if (hs) hs.hidden = true; return; }
  $$("[data-count]").forEach((el) => countUp(el, s[el.dataset.count] || 0));
}).catch(() => { const hs = $(".hero-stats"); if (hs) hs.hidden = true; });
loadMe().then(route);
})();
