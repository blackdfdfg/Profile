// Browser-only actions. Extension generation, balance and settlement are deliberately
// excluded: inserting CAPTCHAs there would break legitimate background operation.
export const WEBSITE_ACTIONS = Object.freeze({
  '/auth/signup': 'signup',
  '/auth/login': 'login',
  '/auth/google/exchange': 'google_login',
  '/create-order': 'license_order',
  '/credits/lookup': 'credit_lookup',
  '/credits/resolve': 'credit_resolve',
  '/credits/order': 'credit_order',
  '/referrals/create': 'referral_create',
  '/referrals/claim': 'referral_claim',
  '/dashboard/update': 'account_update',
  '/verify': 'payment_verify'
});

export async function validateHuman(env, token, ip, expectedAction = '') {
  if (typeof token !== 'string' || !token || token.length > 2048 || !env.TURNSTILE_SECRET) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return false;
    const data = await response.json();
    const hostname = new URL(env.SITE_ORIGIN || 'https://fixasif.com').hostname;
    // The existing payment widget has no action. Keep it compatible, but validate
    // its hostname and one-time token before any database access.
    return data.success === true &&
      [hostname, hostname.startsWith('www.') ? hostname.slice(4) : 'www.' + hostname].includes(data.hostname) &&
      (!expectedAction || data.action === expectedAction);
  } catch { return false; }
}