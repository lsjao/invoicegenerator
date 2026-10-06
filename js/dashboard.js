/* Dashboard: pools every saved invoice (queued, downloaded and archived) into totals, charts and a calendar. */
window.initDashboard = function () {
  const $ = s => document.querySelector(s);
  const { db, H, P, esc, money, shortDate, weekdayName } = window.IM;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dm = s => { const [, m, d] = s.split('-'); return `${+d} ${MONTHS[m - 1]}`; };
  let calMonth = null;
  let calSel = null;

  function allRows() {
    const rows = [];
    for (const inv of db.invoices) {
      for (const it of inv.items) {
        const net = (+it.qty || 0) * (+it.price || 0);
        const vat = it.vat !== 'none' && +it.vat > 0 ? net * +it.vat / 100 : 0;
        rows.push({ inv, it, date: it.date || it.week || inv.date, isWeek: !it.date && !!it.week, sub: inv.from.name || '(unnamed)', site: it.site || '(no site)', qty: +it.qty || 0, days: it.lump ? 0 : (+it.qty || 0), net, vat, gross: net + vat });
      }
    }
    return rows;
  }

  function range() {
    const p = $('#fPeriod').value, now = new Date();
    document.querySelectorAll('.f-custom').forEach(el => (el.hidden = p !== 'custom'));
    if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
    if (p === 'lastmonth') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (p === '3m') return [iso(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())), iso(now)];
    if (p === 'year') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
    if (p === 'custom') return [$('#fFrom').value || '0000', $('#fTo').value || '9999'];
    return ['0000', '9999'];
  }

  function filtered() {
    const [a, b] = range(), sub = $('#fSub').value, site = $('#fSite').value, st = $('#fStatus').value;
    return allRows().filter(r => r.date >= a && r.date <= b && (!sub || r.sub === sub) && (!site || r.site === site) && (!st || (st === 'paid') === !!r.inv.paid));
  }

  function fillFilters() {
    const rows = allRows();
    const keep = (sel, opts, label) => {
      const v = sel.value;
      sel.innerHTML = `<option value="">All ${label}</option>` + opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      if (opts.includes(v)) sel.value = v;
    };
    keep($('#fSub'), [...new Set(rows.map(r => r.sub))].sort(), 'subcontractors');
    keep($('#fSite'), [...new Set(rows.map(r => r.site))].sort(), 'sites');
  }

  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) || { key: k, gross: 0, net: 0, vat: 0, days: 0, subs: new Set(), invs: new Set(), rows: [] };
      g.gross += r.gross; g.net += r.net; g.vat += r.vat; g.days += r.days; g.subs.add(r.sub); g.invs.add(r.inv.id); g.rows.push(r);
      m.set(k, g);
    }
    return m;
  };
  const siteName = code => { const x = db.sites.find(s => s.code === code); return x ? [x.name, x.area].filter(Boolean).join(', ') : ''; };

  function kpis(rows) {
    const t = rows.reduce((a, r) => ({ gross: a.gross + r.gross, net: a.net + r.net, vat: a.vat + r.vat, days: a.days + r.days, dayNet: a.dayNet + (r.days ? r.net : 0), paid: a.paid + (r.inv.paid ? r.gross : 0) }), { gross: 0, net: 0, vat: 0, days: 0, dayNet: 0, paid: 0 });
    const invs = new Set(rows.map(r => r.inv.id)).size, subs = new Set(rows.map(r => r.sub)).size;
    const sites = new Set(rows.map(r => r.site)).size;
    // Calendar days with any dated work; whole-week lines have no dates, so they're noted separately
    const workDays = new Set(rows.filter(r => !r.isWeek && r.it.date).map(r => r.it.date)).size;
    const wkOnly = new Set(rows.filter(r => r.isWeek).map(r => r.date)).size;
    $('#kpis').innerHTML = [
      ['Total invoiced', '£' + money(t.gross)],
      ['Paid', '£' + money(t.paid)],
      ['Unpaid', '£' + money(t.gross - t.paid)],
      ['VAT', t.vat ? '£' + money(t.vat) : 'None'],
      ['Invoices', invs],
      ['Days with work', workDays + (wkOnly ? `<small class="kpi-note">+ ${wkOnly} whole week${wkOnly > 1 ? 's' : ''}</small>` : '')],
      ['Subcontractors', subs],
      ['Sites', sites],
      ['Avg per day', t.days ? '£' + money(t.dayNet / t.days) : '—']
    ].map(([l, v]) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`).join('');
  }

  function weekChart(rows) {
    const el = $('#chWeek');
    if (!rows.length) { el.innerHTML = '<div class="nodata">No data for this filter.</div>'; el.nextElementSibling?.classList.contains('vaxis') && el.nextElementSibling.remove(); return; }
    const g = group(rows, r => P.mondayOf(r.date));
    const keys = [...g.keys()].sort();
    const weeks = [];
    for (let w = keys[0]; w <= keys[keys.length - 1]; w = P.addDays(w, 7)) weeks.push(w);
    const max = Math.max(...weeks.map(w => (g.get(w) || {}).gross || 0));
    const last = weeks[weeks.length - 1];
    el.innerHTML = weeks.map(w => {
      const d = g.get(w) || { gross: 0, days: 0, subs: new Set(), invs: new Set() };
      const h = max ? d.gross / max * 100 : 0;
      // Label every bar while they fit; with many weeks keep only the tallest and the latest
      const label = d.gross && (weeks.length <= 16 || d.gross === max || w === last) ? `<em>£${money(d.gross).replace(/\.00$/, '')}</em>` : '';
      const tip = `w/c ${dm(w)} ${w.slice(0, 4)}\n£${money(d.gross)}\n${+d.days.toFixed(1)} days · ${d.subs.size} subcontractor(s) · ${d.invs.size} invoice(s)`;
      return `<div class="vbar" data-tip="${esc(tip)}">${label}<i style="height:${d.gross ? Math.max(h, 1.5) : 0}%"></i></div>`;
    }).join('');
    let axis = el.nextElementSibling;
    if (!axis || !axis.classList.contains('vaxis')) { axis = document.createElement('div'); axis.className = 'vaxis'; el.after(axis); }
    const every = Math.ceil(weeks.length / 14);
    axis.innerHTML = weeks.map((w, i) => `<span>${i % every === 0 ? dm(w) : ''}</span>`).join('');
  }

  function hbarChart(el, rows, key, nameFn) {
    if (!rows.length) { el.innerHTML = '<div class="nodata">No data for this filter.</div>'; return; }
    const g = [...group(rows, key).values()].sort((a, b) => b.gross - a.gross);
    const max = g[0].gross || 1;
    el.innerHTML = g.map(d => {
      const tip = `${d.key}${nameFn ? ' ' + nameFn(d.key) : ''}\n£${money(d.gross)} (net £${money(d.net)})\n${+d.days.toFixed(1)} days · ${d.invs.size} invoice(s) · ${d.subs.size} subcontractor(s)`;
      return `<div class="hbar" data-tip="${esc(tip)}">
        <div class="nm">${esc(d.key)}${nameFn && nameFn(d.key) ? ` <small>${esc(nameFn(d.key))}</small>` : ''}</div>
        <div class="track"><i style="width:${d.gross / max * 100}%"></i></div>
        <div class="val">£${money(d.gross)}</div></div>`;
    }).join('');
  }

  function calendar(rows) {
    const byDay = group(rows.filter(r => !r.isWeek), r => r.date);
    const byWeek = group(rows.filter(r => r.isWeek), r => r.date);   // whole-week lines, keyed by Monday
    if (!calMonth) {
      const latest = rows.map(r => r.date).sort().pop();
      calMonth = (latest || iso(new Date())).slice(0, 7);
    }
    const [y, m] = calMonth.split('-').map(Number);
    $('#calTitle').textContent = `${MONTHS[m - 1]} ${y}`;
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
    const max = Math.max(0, ...[...byDay.values()].filter(d => d.key.startsWith(calMonth)).map(d => d.gross));
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = iso(d), g = byDay.get(key), inMonth = d.getMonth() === m - 1;
      if (i >= 35 && !inMonth) break;
      const lvl = g && max ? Math.min(4, Math.ceil(g.gross / max * 4)) : 0;
      const tip = g ? `${weekdayName(key)} ${shortDate(key)}\n£${money(g.gross)}\n${[...g.subs].join(', ')}\nSites: ${[...new Set(g.rows.map(r => r.site))].join(', ')}` : '';
      html += `<div class="cell${inMonth ? '' : ' out'}${lvl ? ' l' + lvl : ''}${calSel === key ? ' sel' : ''}" data-day="${key}"${tip ? ` data-tip="${esc(tip)}"` : ''}>
        <span class="d">${d.getDate()}</span>${g ? `<span>${g.subs.size} sub${g.subs.size > 1 ? 's' : ''}</span><span class="t">£${money(g.gross).replace(/\.00$/, '')}</span>` : ''}</div>`;
      if (i % 7 === 6) {
        const mon = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6)), w = byWeek.get(mon);
        if (w) html += `<div class="cell weekbar${calSel === 'w' + mon ? ' sel' : ''}" data-day="w${mon}" data-tip="${esc(`Week ${shortDate(mon)} – ${shortDate(P.addDays(mon, 6))}\nNo daily breakdown\n£${money(w.gross)} · ${+w.days.toFixed(1)} days\n${[...w.subs].join(', ')}`)}">
          <span><b>Whole week ${dm(mon)} – ${dm(P.addDays(mon, 6))}</b> · no daily breakdown</span><span>${w.subs.size} sub${w.subs.size > 1 ? 's' : ''} · ${+w.days.toFixed(1)} days</span><span class="t">£${money(w.gross)}</span></div>`;
      }
    }
    $('#calendar').innerHTML = html;
    const isW = calSel && calSel[0] === 'w';
    const sel = calSel && (isW ? byWeek.get(calSel.slice(1)) : byDay.get(calSel));
    const selTitle = !sel ? '' : isW ? `Week ${shortDate(calSel.slice(1))} – ${shortDate(P.addDays(calSel.slice(1), 6))}` : `${weekdayName(calSel)} ${shortDate(calSel)}`;
    $('#calDay').innerHTML = sel
      ? `<b>${selTitle}</b> · £${money(sel.gross)}<table class="data" style="margin-top:6px"><tr><th>Subcontractor</th><th>Site</th>${isW ? '<th class="r">Days</th>' : ''}<th>Invoice</th><th class="r">Amount</th></tr>${sel.rows.map(r => `<tr><td>${esc(r.sub)}</td><td>${esc(r.site)}</td>${isW ? `<td class="r">${r.qty}</td>` : ''}<td>${esc(r.inv.number)}</td><td class="r">£${money(r.gross)}</td></tr>`).join('')}</table>`
      : `<div class="cal-legend">Less <i></i><i style="background:#f1eacb"></i><i style="background:#e0d192"></i><i style="background:#C8B21B"></i><i style="background:#7a6c0f"></i> More · click a day for detail</div>`;
  }

  function lineTable(rows) {
    const sorted = rows.slice().sort((a, b) => b.date.localeCompare(a.date) || a.sub.localeCompare(b.sub));
    $('#lineCount').textContent = `${rows.length} line(s)`;
    $('#lineTable').innerHTML = `<thead><tr><th>Date</th><th>Subcontractor</th><th>Site</th><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th>VAT</th><th class="r">Total</th><th>Invoice</th><th>Status</th></tr></thead><tbody>` +
      sorted.slice(0, 500).map(r => `<tr><td>${r.isWeek ? `w/c ${shortDate(r.date)}` : shortDate(r.date)}</td><td>${esc(r.sub)}</td><td>${esc(r.site)}</td><td>${esc(H.lineDesc(r.it))}</td>
        <td class="r">${r.qty}</td><td class="r">${money(r.it.price)}</td><td>${H.vatLabel(r.it.vat)}</td><td class="r">£${money(r.gross)}</td>
        <td><a href="#" data-edit="${r.inv.id}">${esc(r.inv.number)}</a></td><td>${r.inv.paid ? '<span class="pill paid">Paid</span>' : '<span class="pill">Unpaid</span>'}</td></tr>`).join('') + '</tbody>';
  }

  // Unpaid invoices, oldest first, regardless of the period filter so nothing owed is hidden
  function payments() {
    const sub = $('#fSub').value;
    const owed = db.invoices.filter(i => !i.paid && (!sub || i.from.name === sub)).sort((a, b) => a.date.localeCompare(b.date));
    const today = new Date(iso(new Date()) + 'T00:00:00Z');
    const total = owed.reduce((a, i) => a + H.totals(i).total, 0);
    $('#payCount').textContent = owed.length ? `${owed.length} invoice(s) · £${money(total)} to pay` : '';
    const bySub = {};
    owed.forEach(i => { bySub[i.from.name] = (bySub[i.from.name] || 0) + H.totals(i).total; });
    $('#owedBySub').innerHTML = Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<span class="chip">${esc(n)} <b>£${money(v)}</b></span>`).join('');
    $('#payTable').innerHTML = owed.length ? `<thead><tr><th>Invoice</th><th>Subcontractor</th><th>Invoice date</th><th class="r">Waiting</th><th class="r">Amount</th><th></th></tr></thead><tbody>` +
      owed.map(i => {
        const wait = Math.max(0, Math.round((today - new Date(i.date + 'T00:00:00Z')) / 864e5));
        return `<tr><td><a href="#" data-edit="${i.id}">${esc(i.number)}</a></td><td>${esc(i.from.name)}</td><td>${shortDate(i.date)}</td>
          <td class="r${wait > 14 ? ' late' : ''}">${wait} day${wait === 1 ? '' : 's'}</td><td class="r">£${money(H.totals(i).total)}</td>
          <td class="r"><button class="btn small" data-markpaid="${i.id}">Mark paid</button></td></tr>`;
      }).join('') + '</tbody>'
      : '<tbody><tr><td class="nodata">Everything is paid. New unpaid invoices will appear here.</td></tr></tbody>';
  }

  function render() {
    fillFilters();
    payments();
    const rows = filtered();
    kpis(rows);
    weekChart(rows);
    hbarChart($('#chSub'), rows, r => r.sub);
    hbarChart($('#chSite'), rows, r => r.site, siteName);
    calendar(rows);
    lineTable(rows);
  }

  function csvText(rows) { const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`; return rows.map(r => r.map(q).join(',')).join('\r\n'); }
  function lineRows(rows) {
    rows = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
    return [['Date', 'Week commencing', 'Subcontractor', 'Site', 'Property', 'Description', 'Qty', 'Unit price', 'VAT', 'Net', 'VAT amount', 'Gross', 'Invoice', 'Invoice date', 'Status', 'Paid on', 'Bill to']]
      .concat(rows.map(r => [r.date, P.mondayOf(r.date), r.sub, r.site, siteName(r.site), H.lineDesc(r.it), r.qty, r.it.price, H.vatLabel(r.it.vat), r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2), r.inv.number, r.inv.date, r.inv.paid ? 'Paid' : 'Unpaid', r.inv.paidDate || '', r.inv.to.name]));
  }
  function csv() {
    const blob = new Blob([csvText(lineRows(filtered()))], { type: 'text/csv' });
    window.IM.saveBlob(blob, `invoice-lines-${iso(new Date())}.csv`);
  }

  ['#fPeriod', '#fFrom', '#fTo', '#fSub', '#fSite', '#fStatus'].forEach(s => $(s).addEventListener('change', () => { calMonth = null; render(); }));
  $('#exportCsv').addEventListener('click', csv);
  $('#exportAll').addEventListener('click', () => window.IM.openExport());
  const shift = n => { const [y, m] = calMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; calendar(filtered()); };
  $('#calPrev').addEventListener('click', () => shift(-1));
  $('#calNext').addEventListener('click', () => shift(1));
  $('#calToday').addEventListener('click', () => { calMonth = iso(new Date()).slice(0, 7); calendar(filtered()); });
  $('#calendar').addEventListener('click', e => { const c = e.target.closest('[data-day]'); if (!c) return; calSel = calSel === c.dataset.day ? null : c.dataset.day; calendar(filtered()); });
  $('#payTable').addEventListener('click', e => {
    const m = e.target.dataset.markpaid;
    if (m) { const inv = db.invoices.find(i => i.id === m); if (inv) window.IM.markPaidFlow([inv]); return; }
    const id = e.target.dataset.edit; if (!id) return; e.preventDefault();
    const inv = db.invoices.find(i => i.id === id); if (inv) window.IM.loadForEdit(inv);
  });
  $('#lineTable').addEventListener('click', e => { const id = e.target.dataset.edit; if (!id) return; e.preventDefault(); const inv = db.invoices.find(i => i.id === id); if (inv) window.IM.loadForEdit(inv); });

  window.Dashboard = { render, allRows, reset: () => { calMonth = null; calSel = null; } };
};
