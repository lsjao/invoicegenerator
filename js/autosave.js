/*
 * Auto-save to a file: after every change the encrypted setup file is rewritten to a file the user picked once.
 * Uses the File System Access API (Chrome, Edge and other Chromium browsers, over https or from a local file).
 * The browser remembers the choice; after a restart it may ask once to allow writing again.
 */
window.AutoFile = (function () {
  const supported = typeof window.showSaveFilePicker === 'function' && window.isSecureContext !== false;
  let handle = null, status = supported ? 'off' : 'unsupported', last = null, timer = null, pending = null, listener = () => {};
  const DB = 'invoiceMaker.autosave', STORE = 'h', KEY = 'file';

  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbGet() { try { const d = await idb(); return await new Promise(res => { const q = d.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function idbPut(v) { try { const d = await idb(); await new Promise(res => { const t = d.transaction(STORE, 'readwrite'); v ? t.objectStore(STORE).put(v, KEY) : t.objectStore(STORE).delete(KEY); t.oncomplete = res; t.onerror = res; }); } catch (e) {} }
  const emit = () => listener({ status, name: handle ? handle.name : '', last });
  const set = s => { status = s; emit(); };

  async function permission(ask) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    try {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      return ask && (await handle.requestPermission(opts)) === 'granted';
    } catch (e) { return false; }
  }

  async function init(onChange) {
    listener = onChange || listener;
    if (!supported) return emit();
    handle = await idbGet();
    if (handle) set((await permission(false)) ? 'on' : 'needs-permission'); else emit();
  }

  async function writeNow() {
    if (!handle || !pending) return;
    const make = pending; pending = null;
    if (!(await permission(false))) return set('needs-permission');
    try {
      const text = await make();
      const w = await handle.createWritable();
      await w.write(text); await w.close();
      last = new Date(); set('on');
    } catch (e) { set('error'); }
  }

  // Call after every change; writes are batched so a burst of edits makes one write
  function schedule(makeText) {
    if (!handle || status === 'unsupported' || status === 'needs-permission') return;
    pending = makeText; clearTimeout(timer); timer = setTimeout(writeNow, 600);
  }
  async function flush() { clearTimeout(timer); await writeNow(); }

  async function choose(makeText) {
    if (!supported) return false;
    try {
      const h = await window.showSaveFilePicker({ suggestedName: 'invoice-maker-data.json', types: [{ description: 'Invoice Maker setup file', accept: { 'application/json': ['.json'] } }] });
      handle = h; await idbPut(h); pending = makeText; await writeNow(); return status === 'on';
    } catch (e) { return false; }   // picker closed
  }
  async function reconnect(makeText) { if (await permission(true)) { pending = makeText; await writeNow(); return true; } return false; }
  async function disable() { clearTimeout(timer); pending = null; handle = null; last = null; await idbPut(null); set(supported ? 'off' : 'unsupported'); }

  return { supported, init, schedule, flush, choose, reconnect, disable, state: () => ({ status, name: handle ? handle.name : '', last }) };
})();
