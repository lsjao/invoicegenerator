/* Properties: one place for every site, its details, who worked there, and a dated log of all lines. */
window.initProperties = function () {
  const $ = s => document.querySelector(s);
  const { db, esc, money, shortDate, save } = window.IM;
  const rows = () => window.Dashboard.allRows();
  const dateOf = r => (r.date || '').slice(0, 10);
  let sel = null, q = '', sort = 'code';
  const n1 = v => +(+v).toFixed(1);

  function stats(code) {
    const rs = rows().filter(r => r.site === code);
    const dates = rs.map(dateOf).filter(Boolean).sort();
    const subs = {};
    rs.forEach(r => { const o = subs[r.sub] = subs[r.sub] || { name: r.sub, days: 0, amt: 0, first: '', last: '' }; o.days += r.days; o.amt += r.gross; const d = dateOf(r); if (d) { if (!o.first || d < o.first) o.first = d; if (!o.last || d > o.last) o.last = d; } });
    const unpaid = rs.filter(r => !r.inv.paid).reduce((a, r) => a + r.gross, 0);
    return { rs, subs: Object.values(subs).sort((a, b) => b.days - a.days), days: rs.reduce((a, r) => a + r.days, 0), amt: rs.reduce((a, r) => a + r.gross, 0), unpaid, first: dates[0] || '', last: dates[dates.length - 1] || '', invs: new Set(rs.map(r => r.inv.id)).size };
  }

  function renderList() {
    let list = db.sites.map((s, i) => ({ s, i, st: stats(s.code) }));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(x => JSON.stringify(x.s).toLowerCase().includes(needle));
    const key = { code: x => x.s.code, spend: x => -x.st.amt, days: x => -x.st.days, last: x => x.st.last ? -Date.parse(x.st.last) : 0 }[sort];
    list.sort((a, b) => { const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
    const tot = list.reduce((a, x) => ({ days: a.days + x.st.days, amt: a.amt + x.st.amt, unpaid: a.unpaid + x.st.unpaid }), { days: 0, amt: 0, unpaid: 0 });
    $('#propList').innerHTML = list.length ? `<thead><tr><th>Code</th><th>Property</th><th class="r">Subs</th><th class="r">Days</th><th class="r">Total</th><th class="r">Unpaid</th><th class="r">First</th><th class="r">Last</th></tr></thead>
      <tbody>${list.map(({ s, i, st }) => `<tr class="prop-row${sel === i ? ' sel' : ''}" data-pi="${i}" tabindex="0"><th scope="row">${esc(s.code || '(no code)')}</th><td>${esc([s.name, s.area, s.postcode].filter(Boolean).join(', ') || 'No address yet')}</td><td class="r">${st.subs.length}</td><td class="r">${n1(st.days)}</td><td class="r">£${money(st.amt)}</td><td class="r${st.unpaid ? ' owed-txt' : ''}">£${money(st.unpaid)}</td><td class="r">${st.first ? shortDate(st.first) : ''}</td><td class="r">${st.last ? shortDate(st.last) : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>${list.length} propert${list.length === 1 ? 'y' : 'ies'}</th><td></td><td></td><td class="r"><b>${n1(tot.days)}</b></td><td class="r"><b>£${money(tot.amt)}</b></td><td class="r"><b>£${money(tot.unpaid)}</b></td><td></td><td></td></tr></tfoot>`
      : '<tbody><tr><td class="nodata">No properties yet. Add one, or save new codes from the banner above.</td></tr></tbody>';
  }

  function renderDetail() {
    const s = db.sites[sel], box = $('#propDetail');
    if (!s) { box.hidden = true; box.innerHTML = ''; return; }
    const st = stats(s.code);
    const log = st.rs.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    box.hidden = false;
    box.innerHTML = `<div class="queue-bar"><h3>${esc(s.code || 'New property')}</h3><div class="row gap"><button class="btn small danger ghost" data-pdel>Delete property</button><button class="btn small ghost" data-pclose>Close</button></div></div>
      <div class="kpis prop-kpis"><div class="kpi"><small>Total</small><b>£${money(st.amt)}</b></div><div class="kpi"><small>Unpaid</small><b>£${money(st.unpaid)}</b></div><div class="kpi"><small>Days</small><b>${n1(st.days)}</b></div><div class="kpi"><small>Subcontractors</small><b>${st.subs.length}</b></div><div class="kpi"><small>Invoices</small><b>${st.invs}</b></div><div class="kpi"><small>First to last</small><b>${st.first ? shortDate(st.first) + ' to ' + shortDate(st.last) : '-'}</b></div></div>
      <div class="prop-form">
        <label>Code<input data-pf="code" value="${esc(s.code)}"></label>
        <label>First line<input data-pf="name" value="${esc(s.name || '')}" placeholder="e.g. 26A Lawford Road"></label>
        <label>Area<input data-pf="area" value="${esc(s.area || '')}"></label>
        <label>Postcode<input data-pf="postcode" value="${esc(s.postcode || '')}"></label>
        <label>Also typed as<input data-pf="aliases" value="${esc((s.aliases || []).join(', '))}" placeholder="e.g. 5CF"></label>
        <label class="span-all">Description and notes<textarea data-pf="notes" rows="3" placeholder="Job description, contact on site, access notes, anything useful">${esc(s.notes || '')}</textarea></label>
      </div>
      <h4>Subcontractors on this property</h4>
      ${st.subs.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th class="r">Days</th><th class="r">Total</th><th class="r">First</th><th class="r">Last</th></tr></thead><tbody>${st.subs.map(o => `<tr><th scope="row">${esc(o.name)}</th><td class="r">${n1(o.days)}</td><td class="r">£${money(o.amt)}</td><td class="r">${o.first ? shortDate(o.first) : ''}</td><td class="r">${o.last ? shortDate(o.last) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing invoiced here yet.</p>'}
      <h4>All lines (${log.length})</h4>
      ${log.length ? `<div class="table-wrap prop-log"><table class="data"><thead><tr><th>Date</th><th>Subcontractor</th><th>Invoice</th><th>Type</th><th class="r">Qty</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${log.map(r => `<tr><td>${dateOf(r) ? shortDate(dateOf(r)) : ''}${r.isWeek ? ' <small class="muted">week</small>' : ''}</td><td>${esc(r.sub)}</td><td>${esc(r.inv.number || '')}</td><td>${r.inv.legacy ? 'Past' : 'Invoice'}</td><td class="r">${r.qty}</td><td class="r">£${money(r.gross)}</td><td>${r.inv.paid ? 'Paid' : '<b class="owed-txt">Unpaid</b>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No lines yet.</p>'}`;
  }

  function refresh() { renderList(); renderDetail(); if (window.IM.afterSitesChange) window.IM.afterSitesChange(); }
  function render() { if (sel != null && !db.sites[sel]) sel = null; renderList(); renderDetail(); }

  $('#propSearch').addEventListener('input', e => { q = e.target.value; renderList(); });
  $('#propSort').addEventListener('change', e => { sort = e.target.value; renderList(); });
  $('#propList').addEventListener('click', e => { const tr = e.target.closest('[data-pi]'); if (tr) { sel = +tr.dataset.pi; render(); $('#propDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
  $('#propList').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('[data-pi]'); if (tr) { sel = +tr.dataset.pi; render(); } } });
  $('#addProp').addEventListener('click', () => { db.sites.push({ code: '', name: '', area: '', postcode: '', aliases: [], notes: '' }); sel = db.sites.length - 1; save(); render(); const c = $('[data-pf="code"]'); if (c) c.focus(); });
  $('#propDetail').addEventListener('input', e => {
    const f = e.target.dataset.pf, s = db.sites[sel]; if (!f || !s) return;
    if (f === 'code') { const old = s.code; s.code = e.target.value.toUpperCase().trim(); s._old = s._old || old; }
    else if (f === 'aliases') s.aliases = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
    else s[f] = e.target.value;
    save(); window.IM.fillSelects && window.IM.fillSelects(); renderList();
  });
  // When a code is renamed, the old spelling becomes an alias so existing records stay attached.
  $('#propDetail').addEventListener('change', e => {
    const s = db.sites[sel]; if (!s || e.target.dataset.pf !== 'code') return;
    if (s._old && s._old !== s.code) { s.aliases = [...new Set([...(s.aliases || []), s._old])]; }
    delete s._old; save(); render();
  });
  $('#propDetail').addEventListener('click', async e => {
    if (e.target.closest('[data-pclose]')) { sel = null; render(); }
    if (e.target.closest('[data-pdel]')) {
      const s = db.sites[sel];
      if (await window.IM.ask(`Delete property ${s.code || ''}? Existing invoices keep their lines, they just lose this saved address.`, 'Delete')) { db.sites.splice(sel, 1); sel = null; save(); window.IM.fillSelects && window.IM.fillSelects(); render(); }
    }
  });
  window.Properties = { render };
};
