/* Invoice Maker: state, create flow, queue, subcontractors, settings, PDF export. */
(async function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P = window.InvoiceParser;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const APP_VERSION = 'v16 · 6 Oct 2026';
  const VAT_OPTIONS = [['none', 'No VAT'], ['20', '20% (Standard)'], ['5', '5% (Reduced)'], ['0', '0% (Zero rated)']];

  /* ---------- Storage ---------- */
  const SEED = {
    subs: [],
    clients: [],   // your clients, properties and subcontractors are added in the tool or imported from a setup file
    sites: [], rates: [], invoices: [],
    settings: { prefix: 'INV-', nextNo: 1, vat: 'none', template: 'modern', clientId: '', dlMode: 'separate' }
  };
  // Data is encrypted at rest (js/vault.js); nothing loads until the password is entered.
  // Anything loaded from storage or an imported file is cleaned first: ids become safe tokens, dates and
  // numbers are checked, text is length-capped, so a tampered file can't inject markup or break the page.
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const str = (v, n = 600) => (v == null ? '' : String(v)).slice(0, n);
  const isoOr = v => (ISO.test(v) ? v : '');
  const safeId = v => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || uid();
  const numOr = (v, d = 0) => (v !== '' && v != null && Number.isFinite(+v) ? +v : d);
  const VATS = ['none', '0', '5', '20'];
  const arr = v => (Array.isArray(v) ? v : []);
  function clean(d) {
    const out = { ...d };
    out.clients = arr(d.clients).map(c => ({ id: safeId(c.id), name: str(c.name, 200), addr: str(c.addr, 400) }));
    out.subs = arr(d.subs).map(x => ({ ...x, id: safeId(x.id), name: str(x.name, 200), addr: str(x.addr, 400), accName: str(x.accName, 200), accNo: str(x.accNo, 40), sort: str(x.sort, 20),
      rate: x.rate === '' || x.rate == null ? '' : numOr(x.rate), vat: VATS.includes(String(x.vat)) ? String(x.vat) : '', aliases: arr(x.aliases).map(a => str(a, 200)),
      phone: str(x.phone, 60), email: str(x.email, 200), notes: str(x.notes, 1000) }));
    out.sites = arr(d.sites).map(x => ({ code: str(x.code, 20), name: str(x.name, 200), area: str(x.area, 100), postcode: str(x.postcode, 20), aliases: arr(x.aliases).map(a => str(a, 100)) }));
    out.rates = arr(d.rates).map(r => numOr(r, NaN)).filter(Number.isFinite);
    out.invoices = arr(d.invoices).map(i => ({ ...i, id: safeId(i.id), template: 'modern', number: str(i.number, 40), currency: 'GBP',
      date: isoOr(i.date) || todayISO(), due: isoOr(i.due), weekStart: isoOr(i.weekStart), paidDate: isoOr(i.paidDate), paid: !!i.paid, notTax: !!i.notTax, selected: !!i.selected, archived: !!i.archived,
      createdAt: str(i.createdAt, 40), downloadedAt: i.downloadedAt ? str(i.downloadedAt, 40) : null, site: str(i.site, 20), label: str(i.label, 60), vatAll: VATS.includes(String(i.vatAll)) ? String(i.vatAll) : 'none',
      rate: i.rate === '' || i.rate == null ? '' : numOr(i.rate),
      from: { name: str(i.from?.name, 200), addr: str(i.from?.addr, 400), accName: str(i.from?.accName, 200), accNo: str(i.from?.accNo, 40), sort: str(i.from?.sort, 20) },
      to: { name: str(i.to?.name, 200), addr: str(i.to?.addr, 400) },
      items: arr(i.items).map(it => ({ ...(it.lump ? { lump: true } : {}), ...(ISO.test(it.week) ? { week: it.week } : {}), date: isoOr(it.date), site: str(it.site, 60), label: str(it.label, 60),
        qty: numOr(it.qty, 1), price: numOr(it.price), vat: VATS.includes(String(it.vat)) ? String(it.vat) : 'none' })) }));
    const st = d.settings || {};
    out.settings = { ...st, prefix: str(st.prefix ?? 'INV-', 20), nextNo: Math.max(1, Math.floor(numOr(st.nextNo, 1))), vat: VATS.includes(String(st.vat)) ? String(st.vat) : 'none', template: 'modern',
      clientId: st.clientId ? safeId(st.clientId) : '', dlMode: st.dlMode === 'zip' ? 'zip' : 'separate', qStatus: ['all', 'paid', 'unpaid'].includes(st.qStatus) ? st.qStatus : 'all',
      autoLock: [0, 5, 15, 30, 60].includes(+st.autoLock) ? +st.autoLock : 15, sitesSeeded: !!st.sitesSeeded };
    return out;
  }
  const normalize = v => clean(v ? { ...SEED, ...v, settings: { ...SEED.settings, ...v.settings } } : JSON.parse(JSON.stringify(SEED)));
  const db = normalize(await window.Vault.open());
  db.settings.template = 'modern';
  if (!db.settings.autoLock && db.settings.autoLock !== 0) db.settings.autoLock = 15;
  document.body.classList.add('unlocked');
  document.querySelector('.brand').title = 'Invoice Maker ' + APP_VERSION;
  let saveTimer;
  // Every save also refreshes the auto-save file (if one is set up): it holds the same encrypted setup data
  const fileText = () => window.Vault.exportBackup(db);
  const autoFile = () => window.AutoFile && window.AutoFile.schedule(fileText);
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { window.Vault.save(db); autoFile(); }, 150); }
  function saveNow() { clearTimeout(saveTimer); window.Vault.save(db); autoFile(); }

  /* ---------- Helpers shared with templates ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = n => (+n || 0).toFixed(2);
  const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const longDate = iso => { if (!iso) return ''; const { y, m, d } = parseISO(iso); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const shortDate = iso => { const { y, m, d } = parseISO(iso); return `${pad(d)}/${pad(m)}/${String(y).slice(2)}`; };
  const weekdayName = iso => DAY_NAMES[(new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7];
  // A line is either one day (date) or a whole week with no daily breakdown (week = that Monday)
  const lineDesc = it => [it.label || 'Labour', it.site,
    it.date ? weekdayName(it.date) : it.week ? `Week ${shortDate(it.week)} – ${shortDate(P.addDays(it.week, 6))}` : '',
    it.date && shortDate(it.date)].filter(Boolean).join(' - ');
  const vatLabel = v => (v === 'none' || v == null || v === '' ? 'No VAT' : v + '%');
  const lines = s => esc(s).replace(/\n/g, '<br>');
  function totals(inv) {
    let sub = 0; const byRate = {};
    for (const it of inv.items) {
      const a = (+it.qty || 0) * (+it.price || 0); sub += a;
      if (it.vat !== 'none' && +it.vat > 0) byRate[it.vat] = (byRate[it.vat] || 0) + a * (+it.vat) / 100;
    }
    const vat = Object.entries(byRate).map(([rate, amount]) => ({ rate, amount }));
    return { sub, vat, vatTotal: vat.reduce((s, v) => s + v.amount, 0), total: sub + vat.reduce((s, v) => s + v.amount, 0) };
  }
  const H = { esc, money, num, longDate, lineDesc, totals, lines, vatLabel };
  window.IM = { db, H, save, P, weekdayName, shortDate, esc, money };

  function ask(message, okLabel = 'OK') {
    const d = $('#askDialog');
    d.returnValue = ''; $('#askText').textContent = message; $('#askOk').textContent = okLabel;
    d.showModal();
    return new Promise(res => { d.onclose = () => res(d.returnValue === 'ok'); });
  }
  // Non-default dialog buttons close with their own value, so Enter always means the primary action
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(c.dataset.close); });
  function askPassword(message) {
    const d = $('#pwDialog');
    d.returnValue = ''; $('#pwText').textContent = message; $('#pwInput').value = '';
    d.showModal(); setTimeout(() => $('#pwInput').focus(), 30);
    return new Promise(res => { d.onclose = () => res(d.returnValue === 'ok' ? $('#pwInput').value : null); });
  }
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }
  const get = (o, k) => k.split('.').reduce((a, p) => (a ? a[p] : undefined), o);
  const set = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((a, p) => (a[p] ??= {}), o)[last] = v; };
  const findSub = name => {
    const n = String(name || '').trim().toLowerCase();
    return n ? db.subs.find(s => s.name.trim().toLowerCase() === n) || db.subs.find(s => (s.aliases || []).some(a => a.trim().toLowerCase() === n)) : undefined;
  };
  const fmtSort = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 6 ? d.replace(/(\d\d)(\d\d)(\d\d)/, '$1-$2-$3') : s; };
  const lastMonday = () => P.addDays(P.mondayOf(todayISO()), -7);
  const vatOptionsHtml = sel => VAT_OPTIONS.map(([v, l]) => `<option value="${v}"${String(sel) === v ? ' selected' : ''}>${l}</option>`).join('');

  /* ---------- Numbering ---------- */
  // One invoice number sequence for everyone, whoever the subcontractor is
  function numberFor() { return db.settings.prefix + pad4(db.settings.nextNo); }
  const pad4 = n => String(n).padStart(4, '0');
  function bumpNumber(inv, sub) {
    const n = +(String(inv.number).match(/(\d+)\s*$/) || [])[1];
    if (!n) return;
    db.settings.nextNo = Math.max(+db.settings.nextNo || 1, n + 1);
  }

  /* ---------- Current invoice ---------- */
  function blankInvoice(keep = {}) {
    const client = db.clients.find(c => c.id === db.settings.clientId) || db.clients[0] || { name: '', addr: '' };
    return {
      id: uid(), template: 'modern', number: numberFor(null), date: todayISO(), due: '',
      weekStart: keep.weekStart || lastMonday(), site: keep.site || '', rate: '', label: 'Labour', vatAll: db.settings.vat,
      from: { name: '', addr: '', accName: '', accNo: '', sort: '' },
      to: keep.to || { name: client.name, addr: client.addr },
      items: [], notTax: false, currency: 'GBP'
    };
  }
  let cur = blankInvoice();
  let editingId = null;
  let numberTouched = false;
  let dayPicks = [true, true, true, true, true, false, false];

  function applySub(sub, inv = cur) {
    if (!sub) return;
    Object.assign(inv.from, { name: sub.name, addr: sub.addr || '', accName: sub.accName || sub.name, accNo: sub.accNo || '', sort: sub.sort || '' });
    if (sub.rate) { inv.rate = sub.rate; inv.items.forEach(it => { if (!+it.price) it.price = +sub.rate; }); }
    if (sub.vat) { inv.vatAll = sub.vat; inv.items.forEach(it => (it.vat = sub.vat)); }
    if (inv !== cur || (!numberTouched && !editingId)) inv.number = numberFor(sub);
  }

  /* ---------- Tabs & steps ---------- */
  let currentTab = 'create';
  function showTab(name) {
    currentTab = name;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach(v => (v.hidden = v.dataset.view !== name));
    if (name === 'queue') renderQueue();
    if (name === 'subs') renderSubs();
    if (name === 'settings') renderSettings();
    if (name === 'dash') window.Dashboard && window.Dashboard.render();
    if (name === 'timesheet') window.Timesheet && window.Timesheet.render();
    if (name === 'create') renderPreview();
    try { sessionStorage.setItem('im.tab', name); } catch (e) {}
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  function showStep(name) {
    $$('.step').forEach(b => b.classList.toggle('active', b.dataset.step === name));
    $$('[data-panel]').forEach(p => (p.hidden = p.dataset.panel !== name));
    if (name === 'finish') renderChecklist();
    renderPreview();
  }
  $$('.step').forEach(b => b.addEventListener('click', () => showStep(b.dataset.step)));
  document.addEventListener('click', e => { const g = e.target.closest('[data-gostep]'); if (g) showStep(g.dataset.gostep); });

  function setMode(m) {
    $$('.mode[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $$('[data-modebody]').forEach(b => (b.hidden = b.dataset.modebody !== m));
    renderPreview();
  }
  $$('.mode[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ---------- Form ---------- */
  function fillSelects() {
    $('#clientSelect').innerHTML = '<option value="">— New / custom —</option>' + db.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const match = db.clients.find(c => c.name === cur.to.name);
    $('#clientSelect').value = match ? match.id : '';
    $('#subSelect').innerHTML = '<option value="">— New subcontractor —</option>' + db.subs.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const sm = findSub(cur.from.name); $('#subSelect').value = sm ? sm.id : '';
    $('#dl-subs').innerHTML = db.subs.map(s => `<option value="${esc(s.name)}">`).join('');
    $('#dl-sites').innerHTML = db.sites.map(s => `<option value="${esc(s.code)}">${esc(s.name || '')}</option>`).join('');
    $('#dl-rates').innerHTML = db.rates.map(r => `<option value="${r}">`).join('');
    $$('.vat-options').forEach(sel => { if (!sel.options.length) sel.innerHTML = vatOptionsHtml('none'); });
  }

  function fillForm() {
    $$('[data-k]').forEach(el => {
      const v = get(cur, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v ?? '';
    });
    $('#vatAll').value = cur.vatAll || 'none';
    fillSelects();
    renderDayPicks();
    renderItems();
  }

  $$('[data-k]').forEach(el => {
    const handler = () => {
      const k = el.dataset.k;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      set(cur, k, v);
      if (k === 'number') numberTouched = true;
      if (k === 'paid' && v && !cur.paidDate) { cur.paidDate = cur.date; fillForm(); }
      if (k === 'from.name') {
        const s = findSub(v);
        if (s && el._lastApplied !== s.id) { el._lastApplied = s.id; applySub(s); fillForm(); }
        $('#subSelect').value = s ? s.id : '';
      }
      if (k === 'rate') cur.items.forEach(it => { if (!it._priceSet) it.price = +v || 0; });
      if (k === 'rate') renderItems();
      onChange();
    };
    el.addEventListener('input', handler);
    if (el.dataset.k === 'from.sort') el.addEventListener('blur', () => { cur.from.sort = el.value = fmtSort(el.value); onChange(); });
  });

  $('#subSelect').addEventListener('change', e => {
    const s = db.subs.find(x => x.id === e.target.value);
    if (s) applySub(s); else { cur.from = { name: '', addr: '', accName: '', accNo: '', sort: '' }; if (!numberTouched && !editingId) cur.number = numberFor(null); }
    fillForm(); onChange();
  });
  $('#clientSelect').addEventListener('change', e => {
    const c = db.clients.find(x => x.id === e.target.value);
    cur.to = c ? { name: c.name, addr: c.addr } : { name: '', addr: '' };
    fillForm(); onChange();
  });
  $('#vatAll').addEventListener('change', e => { cur.vatAll = e.target.value; cur.items.forEach(it => (it.vat = cur.vatAll)); renderItems(); onChange(); });

  function weekLabel(ws) {
    const we = P.addDays(ws, 6), a = parseISO(ws), b = parseISO(we);
    const title = a.m === b.m ? `${a.d} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}` : `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
    const diff = Math.round((new Date(ws) - new Date(P.mondayOf(todayISO()))) / 604800000);
    const sub = diff === 0 ? 'This week' : diff === -1 ? 'Last week' : diff === 1 ? 'Next week' : diff < 0 ? `${-diff} weeks ago` : `In ${diff} weeks`;
    return { title, sub };
  }
  function renderDayPicks() {
    if (!cur.weekStart) cur.weekStart = lastMonday();
    const ws = cur.weekStart, today = todayISO();
    const l = weekLabel(ws);
    $('#wkTitle').textContent = l.title; $('#wkSub').textContent = l.sub;
    const has = new Set(cur.items.map(i => i.date));
    $('#dayPicks').innerHTML = DAY_NAMES.map((d, i) => {
      const date = P.addDays(ws, i);
      return `<label class="daycell${date === today ? ' today' : ''}${has.has(date) ? ' has' : ''}" title="${has.has(date) ? 'Already has a line' : ''}"><input type="checkbox" data-day="${i}"${dayPicks[i] ? ' checked' : ''}><span><small>${d.slice(0, 3)}</small><b>${+date.slice(8)}</b></span></label>`;
    }).join('');
  }
  $('#dayPicks').addEventListener('change', e => { const i = e.target.dataset.day; if (i != null) dayPicks[i] = e.target.checked; });
  const moveWeek = n => { cur.weekStart = n === 0 ? P.mondayOf(todayISO()) : P.addDays(cur.weekStart || lastMonday(), 7 * n); renderDayPicks(); onChange(); };
  $('#wkPrev').addEventListener('click', () => moveWeek(-1));
  $('#wkNext').addEventListener('click', () => moveWeek(1));
  $('#wkThis').addEventListener('click', () => moveWeek(0));

  $('#addDays').addEventListener('click', () => {
    if (!cur.weekStart) return toast('Pick the week commencing date first');
    const picked = dayPicks.map((on, i) => (on ? i : -1)).filter(i => i >= 0);
    if (!picked.length) return toast('Select at least one day');
    for (const i of picked) cur.items.push({ date: P.addDays(cur.weekStart, i), site: (cur.site || '').toUpperCase(), label: cur.label || 'Labour', qty: 1, price: +cur.rate || 0, vat: cur.vatAll || 'none' });
    cur.items.sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    renderItems(); renderDayPicks(); onChange();
  });
  $('#addLine').addEventListener('click', () => { cur.items.push({ date: '', site: '', label: 'Labour', qty: 1, price: +cur.rate || 0, vat: cur.vatAll || 'none' }); renderItems(); onChange(); });

  function renderItems() {
    $('#itemsBody').innerHTML = cur.items.map((it, i) => `
      <tr data-i="${i}">
        <td class="w-date"><input type="date" data-f="date" value="${esc(it.date)}"></td>
        <td><input data-f="site" value="${esc(it.site)}" list="dl-sites" size="6"></td>
        <td><input data-f="label" value="${esc(it.label)}" size="8"></td>
        <td class="w-num"><input type="number" step="0.5" data-f="qty" value="${esc(it.qty)}"></td>
        <td class="w-num"><input type="number" step="0.01" data-f="price" value="${esc(it.price)}"></td>
        <td><select data-f="vat">${vatOptionsHtml(it.vat || 'none').replace(/ \(.*?\)/g, '')}</select></td>
        <td class="amt">${money(it.qty * it.price)}</td>
        <td><button class="x" data-del="${i}" title="Remove">×</button></td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted small" style="padding:10px 4px">No lines yet. Pick days above and click “Add selected days”.</td></tr>';
    updateFormTotal();
  }
  function updateFormTotal() {
    const t = totals(cur);
    $('#formTotal').textContent = cur.items.length ? `Subtotal £${money(t.sub)}${t.vatTotal ? `  ·  VAT £${money(t.vatTotal)}` : ''}  ·  Total £${money(t.total)}` : '';
  }
  $('#itemsBody').addEventListener('input', e => {
    const tr = e.target.closest('tr'); const f = e.target.dataset.f; if (!tr || !f) return;
    const it = cur.items[tr.dataset.i];
    it[f] = ['qty', 'price'].includes(f) ? +e.target.value : (f === 'site' ? e.target.value.toUpperCase() : e.target.value);
    if (f === 'price') it._priceSet = true;
    tr.querySelector('.amt').textContent = money(it.qty * it.price);
    updateFormTotal(); onChange();
  });
  $('#itemsBody').addEventListener('change', e => { if (e.target.dataset.f === 'vat') { cur.items[e.target.closest('tr').dataset.i].vat = e.target.value; updateFormTotal(); onChange(); } });
  $('#itemsBody').addEventListener('click', e => { const d = e.target.dataset.del; if (d != null) { cur.items.splice(+d, 1); renderItems(); onChange(); } });

  $('#newInvoice').addEventListener('click', () => {
    if (cur.items.length) return ask('Start a new blank invoice? Unsaved changes will be lost.', 'Start new').then(ok => ok && resetCurrent());
    resetCurrent();
  });
  function resetCurrent() {
    cur = blankInvoice({ weekStart: cur.weekStart, to: cur.to, template: cur.template });
    editingId = null; numberTouched = false;
    $$('[data-k="from.name"]').forEach(el => (el._lastApplied = null));
    fillForm(); onChange(); showStep('details');
  }

  /* ---------- Paste extraction ---------- */
  // Fill an invoice object from a parse result. Returns the matched saved subcontractor, if any.
  function applyParse(inv, r) {
    const sub = findSub(r.from.name);
    if (sub) applySub(sub, inv);
    Object.entries(r.from).forEach(([k, v]) => { if (v) inv.from[k] = v; });
    if (!inv.from.accName && inv.from.name) inv.from.accName = inv.from.name;
    if (r.to) inv.to = { name: r.to.name, addr: r.to.addr || (db.clients.find(c => c.name === r.to.name) || {}).addr || '' };
    if (r.number) inv.number = r.number;
    if (r.date) inv.date = r.date;
    if (r.due) inv.due = r.due;
    if (r.weekStart) inv.weekStart = r.weekStart;
    if (r.rate) inv.rate = r.rate;
    if (r.site) inv.site = r.site;
    inv._format = r.format;
    inv._warn = r.warnings || [];
    if (r.paid) { inv.paid = true; inv.paidDate = r.paidDate || r.date || inv.date; }
    if (r.items.length) {
      const vat = (sub && sub.vat) || inv.vatAll || 'none';
      inv._fixes = [];
      inv.items = r.items.map(it => {
        const res = P.resolveSite(it.site, db.sites);
        if (res.how && it.site) inv._fixes.push(res);
        return { ...it, site: res.code, price: it.price || +inv.rate || 0, vat };
      });
    }
    return sub;
  }
  // Chips describing site codes that were corrected or not recognised
  const warnChips = inv => (inv._warn || []).map(w => `<span class="chip warn" title="Check this before queueing">${esc(w)}</span>`).join('');
  function fixChips(inv) {
    const seen = new Set();
    return (inv._fixes || []).filter(f => { const k = f.from + f.code; if (seen.has(k)) return false; seen.add(k); return true; }).map(f =>
      f.how === 'unknown' ? `<span class="chip miss" title="Not a saved site. Add it in Settings → Properties / sites.">Unknown site ${esc(f.from)}</span>`
        : `<span class="chip fix" title="Corrected automatically">${esc(f.from)} → ${esc(f.code)}</span>`).join('');
  }
  // "Already paid" control: preset from the detected format, highlighted when the format was unclear
  function paidControl(inv, attr) {
    const ask = inv._format === 'unknown';
    return `<div class="paid-q${ask ? ' ask' : ''}">
      <label class="check"><input type="checkbox" ${attr}${inv.paid ? ' checked' : ''}> ${ask ? 'Already paid? Couldn’t tell from the text' : 'Already paid'}</label>
      ${inv.paid ? `<label class="paid-on">on <input type="date" ${attr}date value="${esc(inv.paidDate || '')}"></label>` : ''}</div>`;
  }
  const formatPill = inv => inv._format === 'payment' ? '<span class="pill paid">Payment</span>' : inv._format === 'labour' ? '<span class="pill">Work days</span>' : '<span class="pill warnp">Format unclear</span>';
  function setPaid(inv, on) { inv.paid = on; if (on && !inv.paidDate) inv.paidDate = inv.date; }
  function missingFor(inv) {
    const need = [['Name', inv.from.name], ['Account no.', inv.from.accNo], ['Sort code', inv.from.sort], ['Address', inv.from.addr], ['Work lines', inv.items.length], ['Rate', inv.items.length && inv.items.every(i => +i.price)]];
    return need.filter(n => !n[1]).map(n => n[0]);
  }

  let batch = [], selBatch = -1;
  function extract() {
    const text = $('#pasteBox').value.trim();
    if (!text) return toast('Paste some details first');
    const { header, segments } = P.splitBatch(text, db);
    if (segments.length > 1) return extractBatch(header, segments);

    batch = []; selBatch = -1;
    const r = P.parse(text, db);
    applyParse(cur, r);
    if (r.number) numberTouched = true;
    fillForm(); onChange();
    const missing = missingFor(cur);
    const box = $('#extractResult');
    box.hidden = false;
    box.innerHTML = `
      <div class="small muted">Found</div>
      <div class="chips">${r.found.map(f => `<span class="chip"><b>${esc(f.label)}:</b> ${esc(f.value)}</span>`).join('') || '<span class="muted small">Nothing recognised</span>'}</div>
      <div class="row gap" style="margin:4px 0">${formatPill(cur)}</div>
      ${paidControl(cur, 'data-spaid')}
      ${(cur._warn || []).length ? `<div class="small muted">Check</div><div class="chips">${warnChips(cur)}</div>` : ''}
      ${(cur._fixes || []).length ? `<div class="small muted">Site references</div><div class="chips">${fixChips(cur)}</div>` : ''}
      ${missing.length ? `<div class="small muted">Missing</div><div class="chips">${missing.map(m => `<span class="chip miss">${m}</span>`).join('')}</div>` : ''}
      <div class="row gap" style="margin-top:8px">
        <button class="btn small" id="reviewForm">Review in form</button>
        <button class="btn small primary" data-gostep="finish">Looks good → review</button>
      </div>`;
    $('#reviewForm').onclick = () => setMode('form');
  }

  // Several subcontractors in one paste: one invoice each
  function extractBatch(header, segments) {
    batch = segments.map(seg => {
      const inv = blankInvoice({ weekStart: cur.weekStart, to: cur.to, template: cur.template });
      const r = P.parse(header ? header + '\n' + seg : seg, db);
      applyParse(inv, r);
      inv._autoNumber = !r.number;
      inv._include = !problems(inv).length;
      return inv;
    });
    renderBatch();
  }
  function renderBatch() {
    const box = $('#extractResult');
    box.hidden = !batch.length;
    if (!batch.length) { selBatch = -1; renderPreview(); return; }
    const n = batch.filter(i => i._include).length;
    const mode = db.settings.dlMode;
    box.innerHTML = `
      <div class="small muted">Found ${batch.length} subcontractors · one invoice each · click a card to jump to its preview</div>
      <div class="batch">${batch.map((inv, i) => {
        const t = totals(inv), miss = missingFor(inv), days = inv.items.map(x => x.date).filter(Boolean).sort();
        return `<div class="batch-item${selBatch === i ? ' sel' : ''}" data-bi="${i}">
          <label class="toggle" title="Include"><input type="checkbox" data-binc${inv._include ? ' checked' : ''}${problems(inv).length ? ' disabled' : ''}><span></span></label>
          <div class="bthumb" data-bthumb="${i}" tabindex="0" aria-label="Preview ${esc(inv.from.name)}">${renderInvoiceHTML(inv)}</div>
          <div><b>${esc(inv.from.name || 'Unknown')}</b> ${formatPill(inv)}
            <div class="muted">${inv.items.length} line(s)${days.length ? ` · ${shortDate(days[0])}–${shortDate(days[days.length - 1])}` : ''} · £${money(t.total)}${inv.number && !inv._autoNumber ? ' · ' + esc(inv.number) : ''}</div>
            ${paidControl(inv, 'data-bpaid')}
            <div class="chips">${warnChips(inv)}${fixChips(inv)}${miss.filter(m => m !== 'Rate').map(m => `<span class="chip miss">${m}</span>`).join('')}</div>
            ${miss.includes('Rate') ? `<label class="inline-rate">Day rate £<input type="number" step="0.01" data-brate placeholder="e.g. 160"></label>` : ''}</div>
          <button class="btn small ghost" data-bact="edit">Edit</button>
          <button class="x" data-bact="del" title="Remove">×</button>
        </div>`;
      }).join('')}</div>
      <div class="batch-bar">
        <div class="seg" id="batchMode"><button data-v="separate"${mode === 'separate' ? ' class="active"' : ''}>Separate PDFs</button><button data-v="zip"${mode === 'zip' ? ' class="active"' : ''}>One ZIP</button></div>
        <div class="row gap">
          <button class="btn small" id="batchQueue"${n ? '' : ' disabled'}>Add ${n} to queue</button>
          <button class="btn small primary" id="batchDownload"${n ? '' : ' disabled'}>Add &amp; download ${n}</button>
        </div>
      </div>`;
    renderPreview();
  }
  // Batch preview: hovering a card shows it in the big preview; hovering its thumbnail shows a bubble of its lines
  const bubble = $('#bubble');
  function showBubble(el, inv) {
    const t = totals(inv);
    bubble.innerHTML = `<b>${esc(inv.from.name || 'Unknown')}</b><span class="muted small"> · ${esc(inv.number)}</span>
      <table>${inv.items.map(it => `<tr><td>${esc(lineDesc(it))}</td><td class="r">${+it.qty !== 1 ? it.qty + ' × ' : ''}£${money(it.price)}</td></tr>`).join('')}
      <tr class="tot"><td>Total${t.vatTotal ? ' incl. VAT' : ''}</td><td class="r">£${money(t.total)}</td></tr></table>`;
    bubble.hidden = false;
    const r = el.getBoundingClientRect();
    const left = Math.min(r.right + 10, window.innerWidth - bubble.offsetWidth - 10);
    const top = Math.min(Math.max(8, r.top - 10), window.innerHeight - bubble.offsetHeight - 8);
    bubble.style.left = Math.max(8, left) + 'px'; bubble.style.top = top + 'px';
  }
  function selectBatch(i) {
    selBatch = selBatch === i ? -1 : i;
    $$('#extractResult [data-bi]').forEach(c => c.classList.toggle('sel', +c.dataset.bi === selBatch));
    $$('#pageScale [data-stack]').forEach(c => c.classList.toggle('sel', +c.dataset.stack === selBatch));
    const item = $(`#pageScale [data-stack="${i}"]`), wrap = $('#preview');
    if (item) wrap.scrollTo({ top: item.offsetTop - 12, behavior: 'smooth' });
    updateStackLabel();
  }
  function updateStackLabel() {
    const inc = batch.filter(i => i._include).length;
    $('#previewLabel').textContent = selBatch >= 0 && batch[selBatch]
      ? `Invoice ${selBatch + 1} of ${batch.length} · ${batch[selBatch].from.name || ''}`
      : `All ${batch.length} invoices · ${inc} included · scroll to check`;
  }
  $('#extractResult').addEventListener('mouseover', e => {
    const card = e.target.closest('[data-bi]'); if (!card) return;
    const inv = batch[card.dataset.bi]; if (!inv) return;
    const th = e.target.closest('[data-bthumb]');
    if (th) showBubble(th, inv); else bubble.hidden = true;
  });
  $('#extractResult').addEventListener('mouseleave', () => { bubble.hidden = true; });
  $('#extractResult').addEventListener('focusin', e => { const th = e.target.closest('[data-bthumb]'); if (th) showBubble(th, batch[th.dataset.bthumb]); });
  $('#extractResult').addEventListener('focusout', () => (bubble.hidden = true));
  $('#extractResult').addEventListener('change', e => {
    const t = e.target;
    if (t.hasAttribute('data-spaid')) { setPaid(cur, t.checked); fillForm(); onChange(); t.closest('.paid-q').outerHTML = paidControl(cur, 'data-spaid'); return; }
    if (t.hasAttribute('data-spaiddate')) { cur.paidDate = t.value; fillForm(); onChange(); return; }
    if (t.hasAttribute('data-bpaid')) { setPaid(batch[t.closest('[data-bi]').dataset.bi], t.checked); renderBatch(); return; }
    if (t.hasAttribute('data-bpaiddate')) { batch[t.closest('[data-bi]').dataset.bi].paidDate = t.value; renderPreview(); return; }
    if (e.target.hasAttribute('data-brate')) {
      const inv = batch[e.target.closest('[data-bi]').dataset.bi], v = +e.target.value;
      if (v > 0) { inv.rate = v; inv.items.forEach(it => { if (!+it.price) it.price = v; }); inv._include = !problems(inv).length; renderBatch(); }
      return;
    }
    if (!e.target.hasAttribute('data-binc')) return;
    batch[e.target.closest('[data-bi]').dataset.bi]._include = e.target.checked; renderBatch();
  });
  $('#extractResult').addEventListener('click', async e => {
    const bi = e.target.closest('[data-bi]');
    const act = e.target.dataset.bact;
    if (bi && act === 'del') { batch.splice(+bi.dataset.bi, 1); selBatch = -1; renderBatch(); return; }
    if (bi && act === 'edit') {
      // Move this one into the form; the rest stay in the batch list
      const [inv] = batch.splice(+bi.dataset.bi, 1); selBatch = -1;
      cur = inv; editingId = null; numberTouched = !inv._autoNumber;
      delete cur._include; delete cur._autoNumber; delete cur._fixes; delete cur._format; delete cur._warn;
      fillForm(); onChange(); setMode('form'); renderBatch();
      return;
    }
    // Clicking a card (outside its controls) jumps the preview to that invoice
    if (bi && !e.target.closest('input, label, button, select')) { selectBatch(+bi.dataset.bi); return; }
    const mv = e.target.closest('#batchMode button');
    if (mv) { db.settings.dlMode = mv.dataset.v; save(); renderBatch(); return; }
    if (e.target.id === 'batchQueue' || e.target.id === 'batchDownload') {
      const picked = batch.filter(i => i._include && !problems(i).length);
      const saved = picked.map(inv => {
        if (inv._autoNumber) inv.number = numberFor(findSub(inv.from.name));
        delete inv._include; delete inv._autoNumber; delete inv._fixes; delete inv._format; delete inv._warn;
        return commit(inv, null);
      });
      batch = batch.filter(i => !picked.includes(i)); selBatch = -1;
      renderBatch();
      if (!batch.length) $('#pasteBox').value = '';
      toast(`${saved.length} invoice(s) queued${batch.length ? ` · ${batch.length} left to fix` : ''}`);
      if (e.target.id === 'batchDownload') await downloadInvoices(saved, db.settings.dlMode);
    }
  });
  $('#extractBtn').addEventListener('click', extract);
  $('#pasteBox').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); extract(); } });
  $('#clearPaste').addEventListener('click', () => { $('#pasteBox').value = ''; $('#extractResult').hidden = true; batch = []; selBatch = -1; renderPreview(); });

  /* ---------- Preview ---------- */
  function renderInvoiceHTML(inv) { const t = window.TEMPLATES[inv.template] || window.TEMPLATES.classic; return t.render(inv, H); }
  let previewRaf;
  // With several invoices extracted from one paste, the preview shows all of them in one scrolling column
  const stackMode = () => batch.length > 0 && !$('[data-modebody="paste"]').hidden && !$('[data-panel="details"]').hidden;
  function renderPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      const box = $('#pageScale'), wrap = $('#preview');
      if (stackMode()) {
        const top = wrap.scrollTop;
        wrap.classList.add('stack');
        box.style.transform = 'none'; box.style.height = 'auto'; box.style.width = 'auto'; wrap.style.height = '';
        box.innerHTML = batch.map((inv, i) => `<div class="stack-item${selBatch === i ? ' sel' : ''}${inv._include ? '' : ' off'}" data-stack="${i}">
          <div class="stack-cap"><b>${i + 1} / ${batch.length}</b> ${esc(inv.from.name || 'Unknown')} · £${money(totals(inv).total)}${inv.paid ? ' · Paid' : ''}${inv._include ? '' : ' · not included'}</div>
          <div class="stack-page">${renderInvoiceHTML(inv)}</div></div>`).join('');
        fitStack();
        wrap.scrollTop = top;
        updateStackLabel();
        return;
      }
      wrap.classList.remove('stack');
      box.innerHTML = renderInvoiceHTML(cur);
      fitPreview();
      $('#previewLabel').textContent = (editingId ? 'Editing ' : 'Live preview · ') + (cur.number || '');
    });
  }
  function fitStack() {
    const wrap = $('#preview');
    $$('#pageScale .stack-page').forEach(sp => {
      const page = sp.firstElementChild; if (!page) return;
      const s = (wrap.clientWidth - 32) / page.offsetWidth;
      page.style.transform = `scale(${s})`; page.style.transformOrigin = 'top left';
      sp.style.height = page.offsetHeight * s + 'px';
    });
  }
  function fitPreview() {
    if ($('#preview').classList.contains('stack')) return fitStack();
    const wrap = $('#preview'); const box = $('#pageScale'); const page = box.firstElementChild;
    if (!page || !wrap.clientWidth) return;
    const s = (wrap.clientWidth - 32) / page.offsetWidth;
    box.style.transform = `scale(${s})`;
    box.style.height = page.offsetHeight * s + 'px';
    box.style.width = page.offsetWidth + 'px';
    wrap.style.height = page.offsetHeight * s + 32 + 'px';
  }
  window.addEventListener('resize', fitPreview);
  $('#pageScale').addEventListener('click', e => {
    const it = e.target.closest('[data-stack]'); if (!it) return;
    const i = +it.dataset.stack;
    selBatch = selBatch === i ? -1 : i;
    $$('#pageScale [data-stack]').forEach(c => c.classList.toggle('sel', +c.dataset.stack === selBatch));
    $$('#extractResult [data-bi]').forEach(c => c.classList.toggle('sel', +c.dataset.bi === selBatch));
    const card = $(`#extractResult [data-bi="${i}"]`); if (card && selBatch === i) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateStackLabel();
  });

  let draftTimer;
  function onChange() {
    renderPreview();
    clearTimeout(draftTimer); draftTimer = setTimeout(() => window.Vault.saveDraft({ cur, editingId, numberTouched }), 400);
  }

  /* ---------- Finish step ---------- */
  function problems(inv) {
    const p = [];
    if (!inv.from.name) p.push('Subcontractor name');
    if (!inv.number) p.push('Reference number');
    if (!inv.items.length) p.push('At least one work line');
    if (inv.items.some(i => !+i.price)) p.push('Price on every line');
    return p;
  }
  function renderChecklist() {
    const t = totals(cur);
    const warn = [];
    if (!cur.from.accNo || !cur.from.sort) warn.push('Bank details incomplete');
    if (!cur.from.addr) warn.push('Subcontractor address empty');
    if (!cur.to.name) warn.push('Bill-to company empty');
    const dup = db.invoices.find(i => i.number === cur.number && i.from.name === cur.from.name && i.id !== editingId);
    if (dup) warn.push(`Reference ${cur.number} already used for ${cur.from.name}`);
    const bad = problems(cur);
    $('#checkList').innerHTML = [
      `<div class="ok">${esc(cur.from.name || '?')} → ${esc(cur.to.name || '?')}</div>`,
      `<div class="ok">${esc(cur.number)} · ${longDate(cur.date)} · ${cur.items.length} line(s) · Total £${money(t.total)}${t.vatTotal ? ` incl. VAT £${money(t.vatTotal)}` : ' · No VAT'}</div>`,
      ...bad.map(b => `<div class="warn">Required: ${b}</div>`),
      ...warn.map(w => `<div class="warn">${esc(w)}</div>`)
    ].join('');
    $('#addToQueue').textContent = editingId ? 'Update invoice' : 'Add to queue';
  }

  function remember(inv) {
    let sub = findSub(inv.from.name);
    if (!sub) { sub = { id: uid(), name: inv.from.name, rate: '', vat: '', aliases: [] }; db.subs.push(sub); }
    Object.assign(sub, { addr: inv.from.addr, accName: inv.from.accName, accNo: inv.from.accNo, sort: inv.from.sort });
    if (inv.from.phone) sub.phone = inv.from.phone;
    if (inv.from.email) sub.email = inv.from.email;
    const rate = +(inv.items.find(it => !it.lump) || {}).price;
    if (!sub.rate && rate) sub.rate = rate;
    bumpNumber(inv, sub);
    if (inv.to.name && !db.clients.find(c => c.name === inv.to.name)) db.clients.push({ id: uid(), name: inv.to.name, addr: inv.to.addr });
    const c = db.clients.find(c => c.name === inv.to.name);
    if (c) { c.addr = inv.to.addr; db.settings.clientId = c.id; }
    inv.items.forEach(it => { if (it.site && !db.sites.find(s => s.code === it.site)) db.sites.push({ code: it.site, name: '' }); });
    inv.items.forEach(it => { const p = +it.price; if (p && !it.lump && !db.rates.includes(p)) db.rates.push(p); });
    db.rates.sort((a, b) => a - b);
  }

  function commitCurrent() {
    const bad = problems(cur);
    if (bad.length) { toast('Missing: ' + bad.join(', ')); return null; }
    return commit(cur, editingId);
  }
  function commit(src, editingId) {
    const inv = JSON.parse(JSON.stringify(src));
    inv.items.forEach(it => delete it._priceSet);
    delete inv._fixes; delete inv._format; delete inv._warn;
    remember(inv);
    if (editingId) {
      const i = db.invoices.findIndex(x => x.id === editingId);
      const old = db.invoices[i] || {};
      inv.id = editingId; inv.createdAt = old.createdAt; inv.downloadedAt = null; inv.selected = true; inv.archived = false;
      db.invoices[i] = inv;
    } else {
      inv.id = uid(); inv.createdAt = new Date().toISOString(); inv.selected = true; inv.archived = false; inv.downloadedAt = null;
      db.invoices.push(inv);
    }
    saveNow(); updateBadge();
    return inv;
  }
  $('#addToQueue').addEventListener('click', () => {
    const wasEditing = editingId;
    const inv = commitCurrent(); if (!inv) return;
    toast(`${inv.number} for ${inv.from.name} ${wasEditing ? 'updated' : 'queued'}`);
    resetCurrent(); setMode('paste');
    if (batch.length) { renderBatch(); toast(`${inv.number} queued · ${batch.length} more from your paste below`); }
    else { $('#pasteBox').value = ''; $('#extractResult').hidden = true; }
    if (wasEditing) showTab('queue');
  });
  $('#downloadCurrent').addEventListener('click', async () => {
    const bad = problems(cur); if (bad.length) return toast('Missing: ' + bad.join(', '));
    await downloadInvoices([cur], 'separate');
  });

  /* ---------- Queue ---------- */
  function updateBadge() { $('#queueCount').textContent = db.invoices.filter(i => !i.archived && !i.downloadedAt).length; }
  function queueItems() {
    const st = db.settings.qStatus || 'all';
    return db.invoices.filter(i => ($('#showArchived').checked || !i.archived) && (st === 'all' || (st === 'paid') === !!i.paid)).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
  function renderQueue() {
    const items = queueItems();
    $('#queueEmpty').hidden = items.length > 0;
    $('#queueList').innerHTML = items.map(inv => {
      const t = totals(inv);
      const days = inv.items.map(i => i.date).filter(Boolean).sort();
      return `<li data-id="${inv.id}">
        <label class="toggle" title="Include in download"><input type="checkbox" data-sel${inv.selected ? ' checked' : ''}><span></span></label>
        <div class="q-main"><b>${esc(inv.number)} · ${esc(inv.from.name)}</b>
          <span>${longDate(inv.date)}${days.length ? ` · work ${shortDate(days[0])}–${shortDate(days[days.length - 1])}` : (inv.items.find(i => i.week) ? ` · week of ${shortDate(inv.items.find(i => i.week).week)}` : '')}
          ${inv.downloadedAt ? ' · <span class="pill ok">Downloaded</span>' : ''}${inv.archived ? ' · <span class="pill">Archived</span>' : ''}</span></div>
        <div class="q-amt">£${money(t.total)}</div>
        <div class="q-act">
          ${inv.paid ? `<button class="pill paid pay-btn" data-act="paid" title="Change paid date or mark unpaid">Paid ${inv.paidDate ? shortDate(inv.paidDate) : ''}</button>`
            : `<button class="btn small pay-btn unpaid" data-act="paid" title="Mark as paid">Mark paid</button>`}
          <button class="btn small ghost" data-act="pdf" title="Download">PDF</button>
          <button class="btn small ghost" data-act="edit">Edit</button>
          <button class="btn small ghost" data-act="dup" title="Copy for next week">Copy</button>
          <button class="x" data-act="del" title="Delete">×</button>
        </div></li>`;
    }).join('');
    $('#selectAll').checked = items.length > 0 && items.every(i => i.selected);
    const qs = db.settings.qStatus || 'all'; $$('#qStatus button').forEach(b => b.classList.toggle('active', b.dataset.v === qs));
    const owed = db.invoices.filter(i => !i.paid);
    $('#queueEmpty').textContent = db.invoices.length ? 'Nothing matches this view.' : 'No invoices yet. Make one in Create.';
    $('#markSelPaid').disabled = !items.some(i => i.selected && !i.paid);
    $('#delSel').disabled = !items.some(i => i.selected);
    $('#queueCount').title = `${owed.length} unpaid`;
    const m = db.settings.dlMode; $$('#dlMode button').forEach(b => b.classList.toggle('active', b.dataset.v === m));
    updateBadge();
  }
  $('#showArchived').addEventListener('change', renderQueue);
  $('#qStatus').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { db.settings.qStatus = v; save(); renderQueue(); } });
  // Delete invoices; if the newest numbers are deleted, the next invoice reuses them
  function deleteInvoices(list) {
    const gone = new Set(list);
    db.invoices = db.invoices.filter(i => !gone.has(i));
    const numOf = i => +(String(i.number).match(/(\d+)\s*$/) || [])[1] || 0;
    const top = Math.max(0, ...db.invoices.map(numOf));
    const before = db.settings.nextNo;
    if (list.some(i => numOf(i) === before - 1)) db.settings.nextNo = top + 1;
    saveNow(); renderQueue(); fillForm();
    if (!editingId && !numberTouched) { cur.number = numberFor(); fillForm(); renderPreview(); }
    toast(`${list.length} invoice(s) deleted${db.settings.nextNo !== before ? ` · next number ${numberFor()}` : ''}`, 4000);
  }
  $('#delSel').addEventListener('click', async () => {
    const list = queueItems().filter(i => i.selected);
    if (!list.length) return toast('Toggle on the invoices to delete');
    if (await ask(`Delete ${list.length} invoice(s): ${list.map(i => i.number).join(', ')}? They also leave the dashboard.`, 'Delete')) deleteInvoices(list);
  });
  $('#markSelPaid').addEventListener('click', () => markPaidFlow(queueItems().filter(i => i.selected && !i.paid)));

  // Mark one or several invoices paid (with a date), or back to unpaid
  async function markPaidFlow(list) {
    if (!list.length) return toast('Select at least one unpaid invoice');
    const d = $('#paidDialog'), one = list.length === 1 ? list[0] : null;
    const total = list.reduce((a, i) => a + totals(i).total, 0);
    $('#paidTitle').textContent = one ? `${one.number} · ${one.from.name}` : `Mark ${list.length} invoices paid`;
    $('#paidText').textContent = `£${money(total)}${one ? '' : ' in total'}. The PDF will show PAID and a zero balance.`;
    $('#paidOn').value = (one && one.paidDate) || todayISO();
    $('#paidUndo').hidden = !list.some(i => i.paid);
    d.returnValue = ''; d.showModal();
    const res = await new Promise(r => { d.onclose = () => r(d.returnValue); });
    if (res === 'ok') list.forEach(i => { i.paid = true; i.paidDate = $('#paidOn').value || todayISO(); });
    else if (res === 'unpaid') list.forEach(i => { i.paid = false; delete i.paidDate; });
    else return;
    saveNow(); renderQueue();
    if (!$('[data-view="dash"]').hidden && window.Dashboard) window.Dashboard.render();
    toast(res === 'ok' ? `${list.length} invoice(s) marked paid` : 'Marked unpaid');
  }
  window.IM.markPaidFlow = markPaidFlow;
  $('#queueList').addEventListener('change', e => {
    if (!e.target.hasAttribute('data-sel')) return;
    const inv = db.invoices.find(i => i.id === e.target.closest('li').dataset.id); inv.selected = e.target.checked; save(); renderQueue();
  });
  $('#queueList').addEventListener('click', async e => {
    const act = e.target.dataset.act; if (!act) return;
    const inv = db.invoices.find(i => i.id === e.target.closest('li').dataset.id);
    if (act === 'del') { if (await ask(`Delete ${inv.number} for ${inv.from.name}? It will also leave the dashboard.`, 'Delete')) deleteInvoices([inv]); }
    if (act === 'edit') { loadForEdit(inv); }
    if (act === 'paid') { await markPaidFlow([inv]); }
    if (act === 'pdf') { await downloadInvoices([inv], 'separate'); }
    if (act === 'dup') {
      const sub = findSub(inv.from.name);
      cur = JSON.parse(JSON.stringify(inv)); cur.id = uid(); editingId = null; numberTouched = false;
      cur.number = numberFor(sub); cur.date = todayISO(); cur.due = '';
      cur.weekStart = P.addDays(inv.weekStart || P.mondayOf(inv.items[0]?.date || todayISO()), 7);
      cur.items = cur.items.map(it => ({ ...it, date: it.date ? P.addDays(it.date, 7) : '' }));
      delete cur.createdAt; delete cur.downloadedAt;
      fillForm(); onChange(); showTab('create'); setMode('form'); showStep('details');
      toast('Copied with dates moved +1 week');
    }
  });
  function loadForEdit(inv) {
    cur = JSON.parse(JSON.stringify(inv)); editingId = inv.id; numberTouched = true;
    cur.vatAll = cur.vatAll || cur.items[0]?.vat || 'none';
    fillForm(); onChange(); showTab('create'); setMode('form'); showStep('details');
  }
  window.IM.loadForEdit = loadForEdit;
  $('#selectAll').addEventListener('change', e => { queueItems().forEach(i => (i.selected = e.target.checked)); save(); renderQueue(); });
  $('#dlMode').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { db.settings.dlMode = v; save(); renderQueue(); } });
  $('#archiveDone').addEventListener('click', () => { let n = 0; db.invoices.forEach(i => { if (i.downloadedAt && !i.archived) { i.archived = true; i.selected = false; n++; } }); save(); renderQueue(); toast(n ? `${n} archived (still counted in Dashboard)` : 'Nothing downloaded yet'); });
  $('#downloadBtn').addEventListener('click', async () => {
    const sel = queueItems().filter(i => i.selected);
    if (!sel.length) return toast('Toggle on at least one invoice');
    await downloadInvoices(sel, db.settings.dlMode);
    renderQueue();
  });

  /* ---------- PDF ---------- */
  const fileName = inv => `${inv.number} - ${(inv.from.name || '').trim().split(/\s+/).pop() || 'Invoice'}`.replace(/[\\/:*?"<>|]/g, '') + '.pdf';
  async function invoicePdfBlob(inv) {
    const stage = $('#pdfStage');
    stage.innerHTML = renderInvoiceHTML(inv);
    const page = stage.firstElementChild;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(page, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({ title: `${inv.number} - ${inv.from.name}`, author: inv.from.name, subject: 'Invoice' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 210, 297);
    stage.innerHTML = '';
    return pdf.output('blob');
  }
  // In a claude.ai artifact, files go through the viewer's save prompt; elsewhere a normal download link.
  const dlReady = window.claude && window.claude.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  async function saveBlob(blob, name) {
    const cap = await dlReady;
    if (cap) {
      try { await cap.save({ filename: name, data: blob }); return true; }
      catch (e) { if (e && e.code !== 'declined') toast('Could not save ' + name + ': ' + (e.message || e.code), 5000); return false; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  window.IM.saveBlob = saveBlob;
  async function downloadInvoices(list, mode, opts = {}) {
    if (!window.html2canvas || !window.jspdf) { toast('PDF library did not load. Reload the page and try again.', 5000); return; }
    const btns = $$('#downloadBtn, #downloadCurrent'); btns.forEach(b => (b.disabled = true));
    try {
      if (mode === 'zip' && list.length > 1) {
        if (!window.JSZip) throw new Error('ZIP library not loaded');
        const zip = new JSZip();
        for (const [i, inv] of list.entries()) { toast(`Building ${i + 1}/${list.length}…`, 60000); zip.file(fileName(inv), await invoicePdfBlob(inv)); }
        if (!(await saveBlob(await zip.generateAsync({ type: 'blob' }), `Invoices ${todayISO()}.zip`))) return;
      } else {
        for (const [i, inv] of list.entries()) {
          toast(`Building ${i + 1}/${list.length}…`, 60000);
          await saveBlob(await invoicePdfBlob(inv), fileName(inv));
          if (list.length > 1) await new Promise(r => setTimeout(r, 400));
        }
      }
      const now = new Date().toISOString();
      if (opts.mark !== false) list.forEach(inv => { const s = db.invoices.find(i => i.id === inv.id); if (s) s.downloadedAt = now; });
      saveNow(); updateBadge();
      toast(`Downloaded ${list.length} invoice${list.length > 1 ? 's' : ''}`);
    } catch (err) { console.error(err); toast('PDF failed: ' + err.message, 5000); }
    finally { btns.forEach(b => (b.disabled = false)); }
  }

  /* ---------- Subcontractors tab ---------- */
  function subStats(sub) {
    const inv = db.invoices.filter(i => i.from.name.toLowerCase() === sub.name.toLowerCase());
    return { count: inv.length, total: inv.reduce((s, i) => s + totals(i).total, 0), owed: inv.filter(i => !i.paid).reduce((s, i) => s + totals(i).total, 0), days: inv.reduce((s, i) => s + i.items.reduce((a, it) => a + (+it.qty || 0), 0), 0) };
  }
  function renderSubs() {
    const q = $('#subSearch').value.trim().toLowerCase();
    const list = db.subs.filter(s => !q || JSON.stringify(s).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    $('#subList').innerHTML = list.map(s => {
      const st = subStats(s);
      return `<div class="sub-card" data-id="${s.id}">
        <h4>${esc(s.name)}</h4>
        <div class="meta">${esc((s.addr || 'No address').replace(/\n/g, ', '))}</div>
        <div class="bank">${esc(s.accNo || '—')} · ${esc(s.sort || '—')}</div>
        <div class="meta">Rate £${s.rate ? money(s.rate) : '—'} · ${vatLabel(s.vat || 'none')}${(s.aliases || []).length ? ' · aka ' + esc(s.aliases.join(', ')) : ''}</div>
        <div class="stats"><div><b>${st.count}</b>invoices</div><div><b>${st.days}</b>days</div><div><b>£${money(st.total)}</b>total</div><div class="${st.owed ? 'owed' : ''}"><b>£${money(st.owed)}</b>unpaid</div></div>
        <div class="row"><button class="btn small" data-sact="edit">Edit</button><button class="btn small primary" data-sact="new">New invoice</button></div>
      </div>`;
    }).join('') || '<p class="muted">No subcontractors yet. Add one, or they are saved automatically when you queue an invoice.</p>';
  }
  $('#subSearch').addEventListener('input', renderSubs);

  // Quick add: extract one or many subcontractors from pasted text
  const SUB_FIELDS = ['name', 'addr', 'accName', 'accNo', 'sort', 'rate', 'phone', 'email'];
  function subFromText(text) {
    const r = P.parse(text, { ...db, subs: [] });
    const f = { ...r.from, rate: r.rate || '' };
    if (!f.accName && f.name) f.accName = f.name;
    return f;
  }
  let subBatch = [];
  function renderSubBatch() {
    const box = $('#subExtractResult');
    box.hidden = !subBatch.length;
    if (!subBatch.length) return;
    const n = subBatch.filter(x => x._include).length;
    box.innerHTML = `<div class="small muted">Found ${subBatch.length} subcontractor(s)</div><div class="batch">${subBatch.map((c, i) => {
      const miss = [['Name', c.name], ['Address', c.addr], ['Account no.', c.accNo], ['Sort code', c.sort], ['Rate', c.rate]].filter(x => !x[1]).map(x => x[0]);
      const existing = findSub(c.name);
      return `<div class="batch-item sub-cand" data-si="${i}">
        <label class="toggle"><input type="checkbox" data-sinc${c._include ? ' checked' : ''}${c.name ? '' : ' disabled'}><span></span></label>
        <div><b>${esc(c.name || 'No name found')}</b>${existing ? ' <span class="pill">updates saved</span>' : ' <span class="pill ok">new</span>'}
          <div class="muted">${esc([(c.addr || '').replace(/\n/g, ', '), c.accNo && c.sort ? c.accNo + ' · ' + c.sort : '', c.rate ? '£' + money(c.rate) + '/day' : '', c.phone, c.email].filter(Boolean).join(' · '))}</div>
          ${miss.length ? `<div class="chips">${miss.map(m => `<span class="chip miss">${m}</span>`).join('')}</div>` : ''}</div>
        <button class="btn small ghost" data-sact2="edit">Edit</button>
        <button class="x" data-sact2="del" title="Remove">×</button></div>`;
    }).join('')}</div>
    <div class="batch-bar"><span></span><button class="btn small primary" id="subSaveAll"${n ? '' : ' disabled'}>Save ${n} subcontractor(s)</button></div>`;
  }
  function upsertSub(c) {
    const data = {};
    SUB_FIELDS.forEach(k => { if (c[k] !== undefined && c[k] !== '') data[k] = c[k]; });
    if (data.sort) data.sort = fmtSort(data.sort);
    if (data.rate) data.rate = +data.rate;
    const s = findSub(c.name);
    if (s) Object.assign(s, data); else db.subs.push({ id: uid(), vat: '', aliases: [], notes: '', accName: c.name, ...data });
    if (data.rate && !db.rates.includes(data.rate)) { db.rates.push(data.rate); db.rates.sort((a, b) => a - b); }
  }
  $('#subExtract').addEventListener('click', () => {
    const text = $('#subPaste').value.trim();
    if (!text) return toast('Paste some details first');
    const { header, segments } = P.splitBatch(text, { subs: [] });
    const parts = segments.length > 1 ? segments.map(sg => (header ? header + '\n' + sg : sg)) : [text];
    const found = parts.map(subFromText);
    if (found.length === 1) {
      const c = found[0];
      openSubDialog(findSub(c.name) || null, c);
      return;
    }
    subBatch = found.map(c => ({ ...c, _include: !!c.name }));
    renderSubBatch();
  });
  $('#subPasteClear').addEventListener('click', () => { $('#subPaste').value = ''; subBatch = []; renderSubBatch(); });
  $('#subExtractResult').addEventListener('change', e => { if (e.target.hasAttribute('data-sinc')) { subBatch[e.target.closest('[data-si]').dataset.si]._include = e.target.checked; renderSubBatch(); } });
  $('#subExtractResult').addEventListener('click', e => {
    const row = e.target.closest('[data-si]'), a = e.target.dataset.sact2;
    if (row && a === 'del') { subBatch.splice(+row.dataset.si, 1); renderSubBatch(); }
    if (row && a === 'edit') { const [c] = subBatch.splice(+row.dataset.si, 1); renderSubBatch(); openSubDialog(findSub(c.name) || null, c); }
    if (e.target.id === 'subSaveAll') {
      const picked = subBatch.filter(c => c._include && c.name);
      picked.forEach(upsertSub);
      subBatch = subBatch.filter(c => !picked.includes(c));
      if (!subBatch.length) $('#subPaste').value = '';
      saveNow(); renderSubBatch(); renderSubs(); fillSelects();
      toast(`${picked.length} subcontractor(s) saved`);
    }
  });
  $('#subDlgFill').addEventListener('click', () => {
    const text = $('#subDlgPaste').value.trim(); if (!text) return;
    const c = subFromText(text), f = $('#subForm');
    let n = 0;
    SUB_FIELDS.forEach(k => { if (c[k]) { f[k].value = k === 'sort' ? fmtSort(c[k]) : c[k]; n++; } });
    $('#subDlgPaste').value = ''; f.querySelector('.paste-fill').open = false;
    toast(n ? `Filled ${n} field(s). Check and save.` : 'Nothing recognised');
  });
  $('#addSub').addEventListener('click', () => openSubDialog(null));
  $('#subList').addEventListener('click', e => {
    const a = e.target.dataset.sact; if (!a) return;
    const s = db.subs.find(x => x.id === e.target.closest('.sub-card').dataset.id);
    if (a === 'edit') openSubDialog(s);
    if (a === 'new') {
      cur = blankInvoice({ weekStart: cur.weekStart, to: cur.to, template: cur.template }); editingId = null; numberTouched = false;
      applySub(s); fillForm(); onChange(); showTab('create'); setMode('form'); showStep('details');
    }
  });
  let editingSub = null;
  function openSubDialog(s, prefill) {
    editingSub = s;
    const f = $('#subForm'); f.reset();
    f.querySelector('.paste-fill').open = false;
    f.vat.innerHTML = vatOptionsHtml((s && s.vat) || db.settings.vat);
    $('#subDialogTitle').textContent = s ? 'Edit subcontractor' : 'New subcontractor';
    $('#subDelete').hidden = !s;
    if (s) for (const k of ['name', 'addr', 'accName', 'accNo', 'sort', 'rate', 'phone', 'email', 'notes']) f[k].value = s[k] ?? '';
    f.aliases.value = s ? (s.aliases || []).join(', ') : '';
    if (prefill) SUB_FIELDS.forEach(k => { if (prefill[k]) f[k].value = k === 'sort' ? fmtSort(prefill[k]) : prefill[k]; });
    $('#subDialog').showModal(); f.name.focus();
  }
  $('#subForm').sort.addEventListener('blur', e => (e.target.value = fmtSort(e.target.value)));
  $('#subForm').addEventListener('submit', () => {
    const f = $('#subForm'); const data = {};
    for (const k of ['name', 'addr', 'accName', 'accNo', 'sort', 'rate', 'vat', 'phone', 'email', 'notes']) data[k] = f[k].value.trim();
    data.sort = fmtSort(data.sort); data.rate = data.rate ? +data.rate : '';
    data.aliases = f.aliases.value.split(',').map(x => x.trim()).filter(Boolean);
    if (!data.accName) data.accName = data.name;
    const clash = findSub(data.name);
    if (clash && clash !== editingSub) { toast('A subcontractor with that name exists'); return; }
    if (editingSub) Object.assign(editingSub, data); else db.subs.push({ id: uid(), ...data });
    if (data.rate && !db.rates.includes(data.rate)) { db.rates.push(data.rate); db.rates.sort((a, b) => a - b); }
    saveNow(); renderSubs(); fillSelects(); toast('Saved');
  });
  $('#subCancel').addEventListener('click', () => $('#subDialog').close());
  $('#subDelete').addEventListener('click', async () => {
    if (!editingSub) return;
    $('#subDialog').close();
    if (!(await ask(`Delete ${editingSub.name}? Their invoices stay.`, 'Delete'))) return;
    db.subs = db.subs.filter(s => s !== editingSub); window.IM.db.subs = db.subs; saveNow(); $('#subDialog').close(); renderSubs(); fillSelects();
  });

  /* ---------- Settings tab ---------- */
  let setTab = 'clients';
  $('#setTabs').addEventListener('click', e => { const t = e.target.dataset.set; if (!t) return; setTab = t; $$('#setTabs .mode').forEach(b => b.classList.toggle('active', b.dataset.set === t)); renderSettings(); });
  function renderSettings() {
    const b = $('#setBody');
    if (setTab === 'clients') {
      b.innerHTML = `<p class="hint">Companies you bill. The starred one is the default for new invoices.</p>` + db.clients.map(c => `
        <div class="set-row" data-id="${c.id}">
          <input data-cf="name" value="${esc(c.name)}"><textarea data-cf="addr" rows="3">${esc(c.addr)}</textarea>
          <div><button class="btn small ${db.settings.clientId === c.id ? 'primary' : 'ghost'}" data-cact="def" title="Default">★</button> <button class="x" data-cact="del">×</button></div>
        </div>`).join('') + `<button class="btn small" id="addClient">+ Add client</button>`;
      $('#addClient').onclick = () => { db.clients.push({ id: uid(), name: 'New client', addr: '' }); save(); renderSettings(); };
      b.oninput = e => { const f = e.target.dataset.cf; if (!f) return; db.clients.find(c => c.id === e.target.closest('.set-row').dataset.id)[f] = e.target.value; save(); fillSelects(); };
      b.onclick = async e => {
        const a = e.target.dataset.cact; if (!a) return; const id = e.target.closest('.set-row').dataset.id;
        if (a === 'def') db.settings.clientId = id;
        if (a === 'del' && await ask('Delete this client?', 'Delete')) db.clients = db.clients.filter(c => c.id !== id);
        window.IM.db.clients = db.clients; save(); renderSettings(); fillSelects();
      };
    } else if (setTab === 'sites') {
      b.innerHTML = `<p class="hint">Site codes used on invoice lines. Pasted references are matched to these by code, property name or an “also typed as” spelling, and codes one letter off are corrected (a typo like 5CF is fixed to 5CD when 5CD is saved).</p><div class="set-row site-row set-head"><small>Code</small><small>First line</small><small>Area</small><small>Postcode</small><small>Also typed as</small><span></span></div>` + db.sites.map((s, i) => `
        <div class="set-row site-row" data-i="${i}"><input data-sf="code" value="${esc(s.code)}"><input data-sf="name" value="${esc(s.name || '')}" placeholder="First line"><input data-sf="area" value="${esc(s.area || '')}" placeholder="Area"><input data-sf="postcode" value="${esc(s.postcode || '')}" placeholder="Postcode"><input data-sf="aliases" value="${esc((s.aliases || []).join(', '))}" placeholder="Also typed as, e.g. 5CF"><button class="x" data-sdel>×</button></div>`).join('') + `<button class="btn small" id="addSite">+ Add site</button>`;
      $('#addSite').onclick = () => { db.sites.push({ code: '', name: '' }); renderSettings(); };
      b.oninput = e => { const f = e.target.dataset.sf; if (!f) return; db.sites[e.target.closest('.set-row').dataset.i][f] = f === 'code' ? e.target.value.toUpperCase() : f === 'aliases' ? e.target.value.split(',').map(x => x.trim()).filter(Boolean) : e.target.value; save(); fillSelects(); };
      b.onclick = e => { if (e.target.hasAttribute('data-sdel')) { db.sites.splice(e.target.closest('.set-row').dataset.i, 1); save(); renderSettings(); fillSelects(); } };
    } else if (setTab === 'rates') {
      b.innerHTML = `<p class="hint">Quick-pick day rates.</p><div class="tag-list">${db.rates.map((r, i) => `<span class="tag">£${money(r)}<button class="x" data-rdel="${i}">×</button></span>`).join('')}</div>
        <div class="row gap" style="margin-top:12px"><input type="number" step="0.01" id="newRate" placeholder="e.g. 180"><button class="btn small" id="addRate">Add rate</button></div>`;
      $('#addRate').onclick = () => { const v = +$('#newRate').value; if (v && !db.rates.includes(v)) { db.rates.push(v); db.rates.sort((a, b) => a - b); save(); renderSettings(); fillSelects(); } };
      b.onclick = e => { const i = e.target.dataset.rdel; if (i != null) { db.rates.splice(+i, 1); save(); renderSettings(); fillSelects(); } };
      b.oninput = null;
    } else if (setTab === 'general') {
      b.innerHTML = `<p class="hint">One number sequence for all invoices, whoever the subcontractor is. The next invoice gets the number below.</p>
        <div class="grid3">
          <label>Reference prefix<input id="gPrefix" value="${esc(db.settings.prefix)}"></label>
          <label>Next number<input id="gNext" type="number" min="1" value="${db.settings.nextNo}"></label>
          <label>Default VAT<select id="gVat">${vatOptionsHtml(db.settings.vat)}</select></label>
        </div>`;
      b.oninput = () => { db.settings.prefix = $('#gPrefix').value; db.settings.nextNo = +$('#gNext').value || 1; db.settings.vat = $('#gVat').value; save(); };
      b.onchange = b.oninput; b.onclick = null;
    } else if (setTab === 'security') {
      b.innerHTML = `<p class="hint">Your data is encrypted with AES-256 using a key made from your password. The password itself is never stored, so it can't be recovered if forgotten.</p>
        <form id="pwForm" class="grid3" autocomplete="off">
          <label>Current password<input type="password" id="pwCur" autocomplete="current-password" required></label>
          <label>New password<input type="password" id="pwNew" autocomplete="new-password" minlength="8" required></label>
          <label>Confirm new<input type="password" id="pwNew2" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn primary">Change password</button></div>
        </form>
        <div class="grid3" style="margin-top:14px">
          <label>Lock automatically after<select id="autoLock">${[[5, '5 minutes idle'], [15, '15 minutes idle'], [30, '30 minutes idle'], [60, '1 hour idle'], [0, 'Never']].map(([v, l]) => `<option value="${v}"${+db.settings.autoLock === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>`;
      b.oninput = b.onclick = null;
      b.onchange = e => { if (e.target.id === 'autoLock') { db.settings.autoLock = +e.target.value; save(); window.IM.resetIdle && window.IM.resetIdle(); toast('Auto-lock updated'); } };
      $('#pwForm').onsubmit = async e => {
        e.preventDefault();
        const c = $('#pwCur').value, n = $('#pwNew').value;
        if (n.length < 8) return toast('Use at least 8 characters');
        if (n !== $('#pwNew2').value) return toast('The new passwords don’t match');
        try { await window.Vault.changePassword(c, n, db); autoFile(); e.target.reset(); toast('Password changed. Old backups still need the old password.', 4000); }
        catch (x) { toast(x.message); }
      };
    } else if (setTab === 'backup') {
      b.innerHTML = `<p class="hint">Everything is stored in this browser only, encrypted with your password. Use a setup file as a backup or to load the same data in another browser.</p>
        <div class="row gap"><button class="btn primary" id="exportAllSet">Setup file…</button>
        <label class="btn">Import setup<input type="file" id="importData" hidden></label>
        <button class="btn danger ghost" id="wipeData">Erase all data</button></div>
        <div class="autosave-box" id="autosaveBox"></div>
        <p class="muted small" style="margin-top:12px">App ${APP_VERSION} · ${db.subs.length} subcontractors · ${db.clients.length} clients · ${db.invoices.length} invoices · ${db.sites.length} sites</p>`;
      b.oninput = b.onchange = b.onclick = null;
      $('#exportAllSet').onclick = () => openExport();
      renderAutosave();
      $('#autosaveBox').onclick = async e => {
        const a = e.target.dataset.as; if (!a) return;
        if (a === 'choose') { const ok = await window.AutoFile.choose(fileText); toast(ok ? 'Auto-save is on' : 'Auto-save was not set up'); }
        if (a === 'reconnect') { const ok = await window.AutoFile.reconnect(fileText); toast(ok ? 'Auto-save reconnected' : 'Permission was not given'); }
        if (a === 'now') { autoFile(); await window.AutoFile.flush(); toast('Saved to file'); }
        if (a === 'off') { await window.AutoFile.disable(); toast('Auto-save turned off'); }
        renderAutosave();
      };
      $('#importData').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importSetup(f); };
      $('#wipeData').onclick = async () => {
        if (!(await ask('Erase all subcontractors, invoices and settings from this browser?', 'Erase all'))) return;
        if (window.AutoFile) await window.AutoFile.disable();   // never overwrite the backup file with an empty tool
        window.Vault.eraseAll(); applyData(null);
        document.body.classList.remove('unlocked');
        await window.Vault.open();            // create a new password for the empty tool
        document.body.classList.add('unlocked'); saveNow(); toast('All data erased');
      };
    }
  }

  /* ---------- Auto-save file ---------- */
  const hhmm = d => d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  function renderAutosave() {
    const box = $('#autosaveBox'), af = window.AutoFile; if (!box || !af) return;
    const st = af.state();
    let body;
    if (st.status === 'unsupported') body = '<p class="muted small">This browser can’t write to a file automatically. Use Chrome or Edge for auto-save, or export the setup file by hand after changes.</p>';
    else if (st.status === 'off') body = '<p class="muted small">Keep a file updated after every change. Pick a file once (a OneDrive, Dropbox or Google Drive folder works well); it is rewritten, encrypted with your password, each time you save anything.</p><button class="btn small primary" data-as="choose">Choose file…</button>';
    else if (st.status === 'needs-permission') body = `<p class="muted small">Auto-save to <b>${esc(st.name)}</b> is paused until you allow it again.</p><div class="row gap"><button class="btn small primary" data-as="reconnect">Allow and resume</button><button class="btn small ghost" data-as="off">Turn off</button></div>`;
    else if (st.status === 'error') body = `<p class="muted small">The last write to <b>${esc(st.name)}</b> failed (file moved or locked?).</p><div class="row gap"><button class="btn small primary" data-as="now">Try again</button><button class="btn small" data-as="choose">Choose another file…</button><button class="btn small ghost" data-as="off">Turn off</button></div>`;
    else body = `<p class="small"><span class="pill ok">On</span> Updating <b>${esc(st.name)}</b>${st.last ? ' · last saved ' + hhmm(st.last) : ''}</p><div class="row gap"><button class="btn small" data-as="now">Save now</button><button class="btn small" data-as="choose">Change file…</button><button class="btn small ghost" data-as="off">Turn off</button></div>`;
    box.innerHTML = `<h4>Auto-save to file</h4>${body}`;
  }
  function renderAutosaveBadge() {
    const el = $('#autosaveBadge'), af = window.AutoFile; if (!el || !af) return;
    const st = af.state();
    el.hidden = st.status === 'unsupported' || st.status === 'off';
    el.className = 'as-badge ' + st.status;
    el.textContent = st.status === 'on' ? `Saved to file ${hhmm(st.last)}` : st.status === 'needs-permission' ? 'Auto-save paused' : st.status === 'error' ? 'Auto-save failed' : '';
    el.title = st.name ? 'Auto-save file: ' + st.name : '';
  }

  /* ---------- Setup transfer (export / import) ---------- */
  function openExport() {
    $('#exportForm').reset(); $('#xpOther').hidden = true;
    const paid = db.invoices.filter(i => i.paid).length;
    const total = db.invoices.reduce((t, i) => t + totals(i).total, 0);
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    $('#xpCount').innerHTML = [
      `${pl(db.subs.length, 'subcontractor')} with bank details and rates`,
      `${pl(db.invoices.length, 'invoice')} (${paid} paid) · £${money(total)}`,
      `${(db.sites.length === 1 ? '1 property' : db.sites.length + ' properties')} · ${pl(db.clients.length, 'client')} · ${pl(db.rates.length, 'rate')}`,
      'Numbering and VAT settings'
    ].map(x => `<li>${esc(x)}</li>`).join('');
    $('#exportDialog').showModal();
  }
  window.IM.openExport = openExport;
  $('#exportForm').addEventListener('change', e => { if (e.target.name === 'xp') $('#xpOther').hidden = e.target.value !== 'other'; });
  ['#xpCancel', '#xpClose'].forEach(s => $(s).addEventListener('click', () => $('#exportDialog').close()));
  $('#xpData').addEventListener('click', async () => {
    let text;
    if ($('input[name=xp]:checked').value === 'other') {
      const a = $('#xpPw').value;
      if (a.length < 8) return toast('Use at least 8 characters for the file password');
      if (a !== $('#xpPw2').value) return toast('The file passwords don’t match');
      text = await window.Vault.exportWithPassword(db, a);
    } else text = await window.Vault.exportBackup(db);
    if (await saveBlob(new Blob([text], { type: 'application/json' }), `invoice-maker-setup-${todayISO()}.json`)) toast('Setup file saved');
  });
  $('#xpImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) { $('#exportDialog').close(); importSetup(f); } });

  // Replace all data in place and redraw every view (no page reload, which hosted pages may block)
  function applyData(data) {
    const fresh = normalize(data);
    Object.keys(db).forEach(k => delete db[k]); Object.assign(db, fresh);
    db.settings.template = 'modern';
    cur = blankInvoice(); editingId = null; numberTouched = false; batch = []; selBatch = -1; subBatch = [];
    $('#pasteBox').value = ''; $('#extractResult').hidden = true;
    saveNow(); fillForm(); updateBadge(); renderPreview();
    window.Dashboard && window.Dashboard.reset();
    window.Timesheet && window.Timesheet.reset();
    showTab(currentTab);
  }

  async function importSetup(file) {
    try {
      let data = JSON.parse(await file.text());
      if (window.Vault.isEncrypted(data)) {
        const pw = await askPassword('Enter the password this setup file was exported with.');
        if (pw == null) return toast('Import cancelled');
        toast('Checking password…', 30000);
        try { data = await window.Vault.decryptBackup(data, pw); } catch (x) { throw new Error('wrong password for this file. Nothing was changed.'); }
      }
      if (!Array.isArray(data.subs) || !Array.isArray(data.invoices)) throw new Error('not an Invoice Maker setup file');
      $('#toast').hidden = true;
      if (!(await ask(`Replace all current data with this setup? (${data.subs.length} subcontractors, ${data.invoices.length} invoices)`, 'Replace'))) return toast('Import cancelled');
      Object.keys(db).forEach(k => delete db[k]); Object.assign(db, { ...SEED, ...data, settings: { ...SEED.settings, ...data.settings } });
      toast('Importing…', 30000);
      applyData(data); await window.Vault.flush();
      toast(`Setup imported: ${db.subs.length} subcontractors, ${db.invoices.length} invoices`, 4000);
    } catch (err) { toast('Import failed: ' + err.message, 6000); }
  }

  /* ---------- Step-by-step wizard ---------- */
  const WIZ = [
    { k: 'from.name', label: 'Subcontractor name', list: 'dl-subs', hint: 'Pick a saved one to auto-fill address and bank details.' },
    { k: 'from.addr', label: 'Subcontractor address', type: 'textarea', fmt: v => (v.includes('\n') ? v : v.split(',').map(s => s.trim()).filter(Boolean).join('\n')) },
    { k: 'from.accName', label: 'Account name' },
    { k: 'from.accNo', label: 'Account number' },
    { k: 'from.sort', label: 'Sort code', fmt: fmtSort },
    { k: 'to', label: 'Bill to', type: 'client' },
    { k: 'number', label: 'Reference number' },
    { k: 'date', label: 'Invoice date', type: 'date' },
    { k: 'due', label: 'Due date (optional)', type: 'date' },
    { k: 'weekStart', label: 'Which week?', type: 'week' },
    { k: 'rate', label: 'Day rate (£)', type: 'number', list: 'dl-rates' },
    { k: 'vatAll', label: 'VAT', type: 'vat' },
    { k: 'days', label: 'Days worked and site', type: 'days' }
  ];
  let wi = 0, wizWeek = null;
  function wizRender() {
    const s = WIZ[wi];
    $('#wizBar').style.width = ((wi + 1) / WIZ.length * 100) + '%';
    $('#wizCount').textContent = `Step ${wi + 1} of ${WIZ.length}`;
    $('#wizLabel').textContent = s.label;
    $('#wizBack').disabled = wi === 0;
    $('#wizNext').textContent = wi === WIZ.length - 1 ? 'Finish' : 'Next';
    const box = $('#wizField'); box.onclick = null;
    const v = get(cur, s.k) ?? '';
    if (s.type === 'textarea') box.innerHTML = `<textarea id="wizIn" rows="4">${esc(v)}</textarea>`;
    else if (s.type === 'client') box.innerHTML = `<div class="opt-list">${db.clients.map(c => `<label><input type="radio" name="wc" value="${c.id}"${c.name === cur.to.name ? ' checked' : ''}>${esc(c.name)}</label>`).join('')}
        <label><input type="radio" name="wc" value=""${db.clients.some(c => c.name === cur.to.name) ? '' : ' checked'}>Other…</label></div>
        <div id="wizOther" style="margin-top:8px"><input id="wizToName" placeholder="Company name" value="${esc(cur.to.name)}" style="margin-bottom:6px"><textarea id="wizToAddr" rows="3" placeholder="Address">${esc(cur.to.addr)}</textarea></div>`;
    else if (s.type === 'vat') box.innerHTML = `<div class="opt-list">${VAT_OPTIONS.map(([val, l]) => `<label><input type="radio" name="wv" value="${val}"${(cur.vatAll || 'none') === val ? ' checked' : ''}>${l}</label>`).join('')}</div>`;
    else if (s.type === 'week') {
      wizWeek = cur.weekStart || lastMonday();
      const draw = () => { const l = weekLabel(wizWeek); $('#wizWk').innerHTML = `<b>${l.title}</b><small>${l.sub}</small>`; };
      box.innerHTML = `<div class="weeknav"><button type="button" class="btn ghost" data-ww="-1">‹</button><div class="wk-label" id="wizWk"></div><button type="button" class="btn ghost" data-ww="1">›</button><button type="button" class="btn ghost small" data-ww="0">This week</button></div>`;
      draw();
      box.onclick = e => { const n = e.target.dataset.ww; if (n == null) return; wizWeek = +n === 0 ? P.mondayOf(todayISO()) : P.addDays(wizWeek, 7 * +n); draw(); };
    }
    else if (s.type === 'days') {
      const ws = cur.weekStart || lastMonday();
      const existing = {}; cur.items.forEach(it => { if (it.date) existing[it.date] = it.site; });
      const anyExisting = cur.items.length > 0;
      box.innerHTML = `<p class="muted small">Week commencing ${longDate(ws)}. Tick days worked and set the site code.</p><div class="wiz-days">${DAY_NAMES.map((d, i) => {
        const date = P.addDays(ws, i); const on = anyExisting ? date in existing : i < 5;
        return `<label class="check"><input type="checkbox" data-wd="${i}"${on ? ' checked' : ''}> ${d} ${shortDate(date)}</label><input data-ws="${i}" list="dl-sites" placeholder="Site code" value="${esc(existing[date] || cur.site || '')}">`;
      }).join('')}</div>`;
    } else box.innerHTML = `<input id="wizIn" type="${s.type || 'text'}" ${s.type === 'number' ? 'step="0.01"' : ''} ${s.list ? `list="${s.list}"` : ''} value="${esc(v)}" autocomplete="off">`;
    if (s.hint) box.insertAdjacentHTML('beforeend', `<p class="muted small">${esc(s.hint)}</p>`);
    const first = box.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, input:checked');
    setTimeout(() => first && first.focus(), 30);
  }
  function wizCommit() {
    const s = WIZ[wi];
    if (s.type === 'client') {
      const id = ($('input[name=wc]:checked') || {}).value;
      const c = db.clients.find(x => x.id === id);
      cur.to = c ? { name: c.name, addr: c.addr } : { name: $('#wizToName').value, addr: $('#wizToAddr').value };
    } else if (s.type === 'vat') {
      cur.vatAll = ($('input[name=wv]:checked') || {}).value || 'none'; cur.items.forEach(it => (it.vat = cur.vatAll));
    } else if (s.type === 'week') {
      cur.weekStart = wizWeek;
    } else if (s.type === 'days') {
      const ws = cur.weekStart || lastMonday(); cur.weekStart = ws;
      cur.items = DAY_NAMES.map((_, i) => i).filter(i => $(`[data-wd="${i}"]`).checked).map(i => ({
        date: P.addDays(ws, i), site: $(`[data-ws="${i}"]`).value.toUpperCase(), label: cur.label || 'Labour', qty: 1, price: +cur.rate || 0, vat: cur.vatAll || 'none'
      }));
    } else {
      let v = $('#wizIn').value; if (s.fmt) v = s.fmt(v);
      set(cur, s.k, v);
      if (s.k === 'number') numberTouched = true;
      if (s.k === 'from.name') { const sub = findSub(v); if (sub) applySub(sub); if (!cur.from.accName) cur.from.accName = v; }
      if (s.k === 'rate') cur.items.forEach(it => (it.price = +v || 0));
    }
    fillForm(); onChange();
  }
  $('#startWizard').addEventListener('click', () => { wi = 0; wizRender(); $('#wizard').showModal(); });
  $('#wizForm').addEventListener('submit', e => {
    e.preventDefault(); wizCommit();
    if (wi < WIZ.length - 1) { wi++; wizRender(); } else { $('#wizard').close(); setMode('form'); showStep('finish'); }
  });
  $('#wizForm').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && !e.shiftKey) { e.preventDefault(); $('#wizForm').requestSubmit(); } });
  $('#wizBack').addEventListener('click', () => { wizCommit(); if (wi > 0) { wi--; wizRender(); } });
  $('#wizSkip').addEventListener('click', () => { if (wi < WIZ.length - 1) { wi++; wizRender(); } else { $('#wizard').close(); showStep('finish'); } });
  $('#wizClose').addEventListener('click', () => $('#wizard').close());

  /* ---------- Tooltip (shared with dashboard) ---------- */
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });

  /* ---------- Init ---------- */
  try { sessionStorage.removeItem('im.draft'); } catch (e) {}   // old unencrypted draft
  const d = await window.Vault.loadDraft();
  if (d && d.cur) { cur = d.cur; cur.template = 'modern'; editingId = d.editingId; numberTouched = d.numberTouched; }
  fillForm(); updateBadge();
  let startTab = 'create'; try { startTab = sessionStorage.getItem('im.tab') || 'create'; } catch (e) {}
  $('#autosaveBadge').addEventListener('click', () => { setTab = 'backup'; $$('#setTabs .mode').forEach(b => b.classList.toggle('active', b.dataset.set === 'backup')); showTab('settings'); });
  window.AutoFile && window.AutoFile.init(() => { renderAutosaveBadge(); renderAutosave(); });
  window.initDashboard && window.initDashboard();
  window.initTimesheet && window.initTimesheet();
  showTab(startTab);
  renderPreview();

  /* ---------- Lock & auto-lock ---------- */
  async function lockNow() {
    if (!document.body.classList.contains('unlocked')) return;
    saveNow(); clearTimeout(idle);
    await window.Vault.flush(); window.AutoFile && await window.AutoFile.flush();
    $$('dialog[open]').forEach(d => d.close());
    document.body.classList.remove('unlocked');
    await window.Vault.lock();
    document.body.classList.add('unlocked'); resetIdle();
  }
  $('#lockBtn').addEventListener('click', lockNow);
  let idle;
  const resetIdle = () => {
    clearTimeout(idle);
    const mins = +db.settings.autoLock;
    if (mins > 0) idle = setTimeout(lockNow, mins * 60000);
  };
  ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));
  resetIdle();
  window.IM.resetIdle = resetIdle;
})();
