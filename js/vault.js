/*
 * Password vault: everything the app stores is encrypted with AES-256-GCM using a key
 * derived from the user's password (PBKDF2-SHA256). The password and key are never stored;
 * without the password the saved data cannot be read.
 */
window.Vault = (function () {
  const KEY_ENC = 'invoiceMaker.v1.enc';
  const KEY_PLAIN = 'invoiceMaker.v1';   // pre-encryption storage, migrated then removed
  const DRAFT = 'im.draft.enc';
  const ITER = 600000;      // PBKDF2-SHA256 work factor for new files (OWASP guidance); older files keep their own count
  let keyIter = ITER;       // work factor the current key was derived with
  const FORMAT = 'invoice-maker-encrypted';
  const te = new TextEncoder(), td = new TextDecoder();
  let key = null, salt = null, chain = Promise.resolve();

  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const del = k => { try { localStorage.removeItem(k); } catch (e) {} };
  function b64(buf) {
    const a = new Uint8Array(buf); let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function derive(pw, saltBytes, iter = ITER) {
    const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(k, s, text, iter = keyIter) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(text));
    return { format: FORMAT, v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64(s), iv: b64(iv), ct: b64(ct) };
  }
  async function open_(k, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
    return JSON.parse(td.decode(pt));
  }
  const readBox = () => { try { const b = JSON.parse(get(KEY_ENC)); return b && b.format === FORMAT ? b : null; } catch (e) { return null; } };

  /* ---------- Lock screen ---------- */
  function overlay(mode, hasPlain) {
    const el = document.createElement('div');
    el.className = 'lock';
    el.innerHTML = `
      <form class="lock-card" autocomplete="off">
        <img src="assets/icon.svg" alt="" width="44" height="44">
        <h1>Invoice Maker</h1>
        ${mode === 'unlock'
          ? `<p>Enter your password to unlock your saved data.</p>
             <label>Password<input type="password" id="lockPw" autocomplete="current-password" required></label>`
          : mode === 'unsupported'
          ? `<p>This browser can't encrypt data here. Open the tool over https or in an up-to-date Chrome, Edge, Firefox or Safari.</p>`
          : `<p>Create a password. Everything you save (bank details, addresses, invoices) is encrypted with it${hasPlain ? ', including the data you already have' : ''}.</p>
             <label>New password<input type="password" id="lockPw" autocomplete="new-password" minlength="8" required></label>
             <label>Confirm password<input type="password" id="lockPw2" autocomplete="new-password" minlength="8" required></label>
             <p class="lock-note">At least 8 characters. There is no recovery: if you forget it, the data can't be opened. Keep a backup.</p>`}
        <p class="lock-err" id="lockErr" hidden></p>
        ${mode === 'unsupported' ? '' : `<button class="btn primary" id="lockGo">${mode === 'unlock' ? 'Unlock' : 'Create password'}</button>`}
        ${mode === 'unlock' ? `<button type="button" class="lock-link" id="lockForgot">Forgot password?</button>
          <div class="lock-forgot" id="lockForgotBox" hidden><p>Without the password the data can't be recovered. You can erase it and start again, or restore a backup afterwards.</p>
          <button type="button" class="btn danger ghost small" id="lockErase">Erase all data and start again</button></div>` : ''}
      </form>`;
    document.body.appendChild(el);
    setTimeout(() => { const i = el.querySelector('#lockPw'); if (i) i.focus(); }, 30);
    return el;
  }

  // Resolves with the decrypted data (or null for a fresh start) once the user unlocks.
  function open() {
    return new Promise(resolve => {
      if (!(window.crypto && crypto.subtle && window.isSecureContext !== false)) { overlay('unsupported'); return; }
      const box = readBox();
      let plain = null;
      try { plain = JSON.parse(get(KEY_PLAIN)); } catch (e) {}
      const mode = box ? 'unlock' : 'setup';
      const el = overlay(mode, !!plain);
      const err = el.querySelector('#lockErr'), go = el.querySelector('#lockGo');
      const fail = m => { err.textContent = m; err.hidden = false; go.disabled = false; go.textContent = mode === 'unlock' ? 'Unlock' : 'Create password'; };
      el.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const pw = el.querySelector('#lockPw').value;
        err.hidden = true; go.disabled = true; go.textContent = mode === 'unlock' ? 'Unlocking…' : 'Encrypting…';
        try {
          if (mode === 'unlock') {
            const k = await derive(pw, unb64(box.salt), box.iter || ITER);
            let data;
            try { data = await open_(k, box); } catch (x) { return fail('Wrong password. Try again.'); }
            key = k; salt = unb64(box.salt); keyIter = box.iter || 310000;
            if (keyIter < ITER) {   // silently upgrade an older file to the current work factor
              try { const s2 = crypto.getRandomValues(new Uint8Array(16)), k2 = await derive(pw, s2, ITER);
                if (put(KEY_ENC, JSON.stringify(await seal(k2, s2, JSON.stringify(data), ITER)))) { key = k2; salt = s2; keyIter = ITER; } } catch (x) {}
            }
            el.remove(); resolve(data);
          } else {
            if (pw.length < 8) return fail('Use at least 8 characters.');
            if (pw !== el.querySelector('#lockPw2').value) return fail('The two passwords don’t match.');
            salt = crypto.getRandomValues(new Uint8Array(16));
            key = await derive(pw, salt); keyIter = ITER;
            if (plain) {
              if (!put(KEY_ENC, JSON.stringify(await seal(key, salt, JSON.stringify(plain), ITER)))) return fail('Could not save to browser storage.');
              del(KEY_PLAIN);
            }
            el.remove(); resolve(plain);
          }
        } catch (x) { fail('Something went wrong: ' + x.message); }
      });
      const forgot = el.querySelector('#lockForgot');
      if (forgot) {
        forgot.onclick = () => (el.querySelector('#lockForgotBox').hidden = false);
        el.querySelector('#lockErase').onclick = () => {
          const b = el.querySelector('#lockErase');
          if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to erase everything'; return; }
          [KEY_ENC, KEY_PLAIN].forEach(del); try { sessionStorage.clear(); } catch (e) {}
          el.remove(); key = null; open().then(resolve);   // straight to creating a new password
        };
      }
    });
  }

  /* ---------- Save / load while unlocked ---------- */
  function save(obj) {
    const text = JSON.stringify(obj);
    chain = chain.then(async () => { if (key) put(KEY_ENC, JSON.stringify(await seal(key, salt, text))); }).catch(() => {});
    return chain;
  }
  const flush = () => chain;
  async function saveDraft(obj) {
    if (!key) return;
    try { sessionStorage.setItem(DRAFT, JSON.stringify(await seal(key, salt, JSON.stringify(obj)))); } catch (e) {}
  }
  async function loadDraft() {
    try { const b = JSON.parse(sessionStorage.getItem(DRAFT)); return b && key ? await open_(key, b) : null; } catch (e) { return null; }
  }
  async function exportWithPassword(obj, pw) {
    const s2 = crypto.getRandomValues(new Uint8Array(16));
    return JSON.stringify(await seal(await derive(pw, s2, ITER), s2, JSON.stringify(obj), ITER), null, 1);
  }
  async function exportBackup(obj) { return JSON.stringify(await seal(key, salt, JSON.stringify(obj)), null, 1); }
  const isEncrypted = obj => obj && obj.format === FORMAT;
  async function decryptBackup(box, pw) { return open_(await derive(pw, unb64(box.salt), box.iter || ITER), box); }

  async function changePassword(current, next, obj) {
    const box = readBox();
    try { await open_(await derive(current, unb64(box.salt), box.iter || ITER), box); } catch (e) { throw new Error('Current password is wrong.'); }
    await flush();
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(next, salt, ITER); keyIter = ITER;
    await save(obj);
    try { sessionStorage.removeItem(DRAFT); } catch (e) {}
  }
  // Lock without reloading the page (hosted pages may not allow reloads): forget the key and ask again
  async function lock() { await flush(); key = null; return open(); }
  function eraseAll() { [KEY_ENC, KEY_PLAIN].forEach(del); try { sessionStorage.clear(); } catch (e) {} }

  return { open, save, flush, saveDraft, loadDraft, exportBackup, exportWithPassword, isEncrypted, decryptBackup, changePassword, lock, eraseAll };
})();
