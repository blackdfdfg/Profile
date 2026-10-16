/* One fresh, single-use Turnstile token for each sensitive browser action. */
(() => {
  'use strict';
  const actions = Object.freeze({
    '/auth/signup':'signup', '/auth/login':'login', '/auth/google/exchange':'google_login',
    '/create-order':'license_order', '/credits/lookup':'credit_lookup',
    '/credits/resolve':'credit_resolve', '/credits/order':'credit_order',
    '/referrals/create':'referral_create', '/referrals/claim':'referral_claim',
    '/dashboard/update':'account_update'
  });
  let pending = null;
  async function verify(path, sitekey) {
    if (!actions[path]) return '';
    if (pending) throw Error('Finish the current human check first.');
    if (!sitekey) throw Error('Human verification is unavailable. Please reload and try again.');
    for (let i = 0; !window.turnstile && i < 100; i++) await new Promise(r => setTimeout(r, 100));
    if (!window.turnstile) throw Error('Human verification could not load. Check your connection and try again.');
    if (pending) throw Error('Finish the current human check first.');
    return new Promise((resolve, reject) => {
      const previous = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'fix-human-dialog';
      dialog.setAttribute('aria-labelledby', 'fixHumanTitle');
      dialog.innerHTML = '<h2 id="fixHumanTitle">Quick security check</h2><p>Please verify before continuing. This helps protect accounts and payments.</p><div class="fix-human-widget"></div><p class="fix-human-message" role="status"></p><button type="button">Cancel</button>';
      document.body.append(dialog);
      let widget = null, finished = false;
      const finish = (error, token) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        try { if (widget !== null) window.turnstile.remove(widget); } catch {}
        if (dialog.open) dialog.close();
        dialog.remove(); pending = null;
        previous?.focus?.();
        error ? reject(error) : resolve(token);
      };
      const timeout = setTimeout(() => finish(Error('Human check timed out. Please try again.')), 300000);
      pending = dialog;
      dialog.addEventListener('cancel', e => { e.preventDefault(); finish(Error('Human verification cancelled.')); });
      dialog.addEventListener('close', () => finish(Error('Human verification cancelled.')));
      dialog.querySelector('button').onclick = () => finish(Error('Human verification cancelled.'));
      try {
        dialog.showModal();
        widget = window.turnstile.render(dialog.querySelector('.fix-human-widget'), {
          sitekey, action: actions[path], theme: 'dark', size: 'flexible',
          callback: token => finish(null, token),
          'expired-callback': () => finish(Error('Human check expired. Please try again.')),
          'error-callback': () => {
            dialog.querySelector('.fix-human-message').textContent = 'Verification could not complete. Cancel and try again.';
          }
        });
      } catch { finish(Error('Human verification could not load. Please try again.')); }
    });
  }
  window.FixHuman = Object.freeze({ required: path => !!actions[path], verify });
})();