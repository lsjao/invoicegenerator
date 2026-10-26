/* Weekly sheet: a shareable week-by-week breakdown (who worked where each day, days, invoice, amount, week total). */
window.initSheet = function () {
  const $ = s => document.querySelector(s);
  const { db, P, esc, money } = window.IM;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sunOf = d => P.addDays(d, -new Date(d + 'T00:00:00Z').getUTCDay());
  const n1 = v => +(+v).toFixed(1);
  const long = d => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;

  function weeks() {
    const incPast = $('#shPast').checked;
    const rs = window.Dashboard.allRows().filter(r => incPast || !r.inv.legacy);
    const by = {};
    rs.forEach(r => { const w = sunOf(r.date); (by[w] = by[w] || []).push(r); });
    let keys = Object.keys(by).sort();
    const per = $('#shPeriod').value;
    if (per !== 'all') keys = keys.slice(-+per);
    return keys.map(w => {
      const subs = {};
      by[w].forEach(r => { (subs[r.sub] = subs[r.sub] || []).push(r); });
      const list = Object.keys(subs).sort().map(name => {
        const mine = subs[name], dated = mine.filter(r => !r.isWeek && r.days > 0), whole = mine.filter(r => r.isWeek), lump = mine.filter(r => !r.isWeek && r.days === 0);
        const invs = []; mine.forEach(r => { if (!invs.includes(r.inv)) invs.push(r.inv); });
        return { name, dated, whole, lump, invs, days: mine.reduce((a, r) => a + r.days, 0), amt: mine.reduce((a, r) => a + r.gross, 0) };
      });
      return { w, list, total: list.reduce((a, x) => a + x.amt, 0) };
    });
  }

  const chips = rs => rs.map(r => `<span class="ts-site">${esc(r.site)}${r.qty !== 1 ? ' ×' + +r.qty.toFixed(2) : ''}</span>`).join('');
  const invLink = inv => inv.legacy
    ? `<span class="sh-past" title="Past record, no PDF">${esc(inv.number || 'Past record')}</span>`
    : `<a href="#" class="sh-inv" data-inv="${esc(inv.id)}" title="Open ${esc(inv.number)}">${esc(inv.number)}</a>`;

  function block(wk) {
    const dates = DAYS.map((_, i) => P.addDays(wk.w, i)), end = dates[6];
    const hasWhole = wk.list.some(x => x.whole.length && !x.dated.length);
    const perDay = dates.map(d => new Set(wk.list.filter(x => x.dated.some(r => r.date === d)).map(x => x.name)).size);
    const totDays = wk.list.reduce((a, x) => a + x.days, 0);
    const head = `<thead><tr><th class="l">Subcontractor</th>${dates.map((d, i) => `<th class="c">${DAYS[i].slice(0, 3)}<small>${+d.slice(8)}</small></th>`).join('')}<th class="r">Days</th><th class="c">Invoice</th><th class="r">Amount</th></tr></thead>`;
    const rows = wk.list.map(x => {
      const onlyWhole = !x.dated.length && x.whole.length;
      const cells = onlyWhole
        ? `<td colspan="7" class="on wk">${chips(x.whole)} <span class="sh-note">whole week</span></td>`
        : dates.map(d => { const l = x.dated.filter(r => r.date === d); return `<td class="${l.length ? 'on' : ''}">${chips(l)}</td>`; }).join('');
      const note = [x.whole.length && !onlyWhole ? 'plus whole-week line' : '', x.lump.length ? 'adjustment' : ''].filter(Boolean).join(', ');
      return `<tr><th scope="row" class="l">${esc(x.name)}</th>${cells}<td class="r"><b>${n1(x.days)}</b></td><td class="c sh-invs">${x.invs.map(invLink).join('<br>')}${note ? `<span class="sh-note">${note}</span>` : ''}</td><td class="r">£${money(x.amt)}</td></tr>`;
    }).join('');
    const foot = `<tfoot><tr><th class="l">On site</th>${perDay.map(n => `<td class="c">${n || ''}</td>`).join('')}<td class="r"><b>${n1(totDays)}</b></td><td></td><td class="r"><b>£${money(wk.total)}</b></td></tr></tfoot>`;
    return `<section class="sheet-week"><header class="sheet-head"><h3>${long(wk.w)} – ${long(end)} ${end.slice(0, 4)}</h3><span class="sh-sum">${wk.list.length} subcontractor${wk.list.length === 1 ? '' : 's'} · ${n1(totDays)} days · <b>£${money(wk.total)}</b></span></header><div class="table-wrap"><table class="data ts-grid sheet-table"><colgroup><col style="width:16%">${'<col style="width:7.5%">'.repeat(7)}<col style="width:6%"><col style="width:15%"><col style="width:11.5%"></colgroup>${head}<tbody>${rows}</tbody>${foot}</table></div></section>`;
  }

  function render() {
    const ws = weeks();
    $('#sheetWrap').innerHTML = ws.length ? ws.map(block).join('') : '<p class="muted">No work recorded in this period.</p>';
    $('#shPdf').disabled = !ws.length;
  }
  $('#shPeriod').addEventListener('change', render);
  $('#shPast').addEventListener('change', render);
  $('#sheetWrap').addEventListener('click', async e => {
    const a = e.target.closest('[data-inv]'); if (!a) return; e.preventDefault();
    const inv = db.invoices.find(i => i.id === a.dataset.inv); if (inv) window.IM.viewInvoice(inv);
  });

  // Downloadable sheet: landscape pages of the table, then (optionally) every invoice, with the invoice numbers linking to their pages
  $('#shPdf').addEventListener('click', async () => {
    const btn = $('#shPdf'); btn.disabled = true;
    const toast = window.IM.toast || (() => {});
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-12000px;top:0;width:1100px;background:#fff;';
    document.body.appendChild(stage);
    try {
      const ws = weeks(), attach = $('#shAttach').checked;
      const PW = 1100, PH = Math.round(PW * 210 / 297), PAD = 18, mm = 297 / PW;
      // pack week blocks onto pages
      const pages = []; let cur = null, used = 0;
      for (const wk of ws) {
        const probe = document.createElement('div'); probe.className = 'sheet-export'; probe.innerHTML = block(wk); stage.appendChild(probe);
        const h = probe.offsetHeight; stage.removeChild(probe);
        if (!cur || used + h > PH - 2 * PAD) { cur = []; pages.push(cur); used = 0; }
        cur.push(wk); used += h + 10;
      }
      const invList = []; if (attach) ws.forEach(wk => wk.list.forEach(x => x.invs.forEach(i => { if (!i.legacy && !invList.includes(i)) invList.push(i); })));
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
      const linksPerPage = [];
      for (const [pi, grp] of pages.entries()) {
        toast(`Building sheet ${pi + 1}/${pages.length}…`, 60000);
        stage.innerHTML = `<div class="sheet-export" style="padding:${PAD}px">${grp.map(block).join('')}</div>`;
        const el = stage.firstElementChild;
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const box = el.getBoundingClientRect();
        const links = [...el.querySelectorAll('[data-inv]')].map(a => { const r = a.getBoundingClientRect(); return { id: a.dataset.inv, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }; });
        const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        if (pi) pdf.addPage('a4', 'landscape');
        const k = Math.min(1, 210 / (box.height * mm));   // shrink to fit if a week block is taller than the page
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, box.width * mm * k, box.height * mm * k);
        linksPerPage.push({ links, k });
      }
      stage.remove();
      for (const [ii, inv] of invList.entries()) {
        toast(`Adding invoice ${ii + 1}/${invList.length}…`, 60000);
        const c = await window.IM.invoiceCanvas(inv, 2);
        pdf.addPage('a4', 'portrait'); pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      const pageOf = id => { const i = invList.findIndex(x => x.id === id); return i < 0 ? 0 : pages.length + 1 + i; };
      linksPerPage.forEach(({ links, k }, pi) => { pdf.setPage(pi + 1); links.forEach(l => { const pn = pageOf(l.id); if (pn) pdf.link(l.x * mm * k, l.y * mm * k, l.w * mm * k, l.h * mm * k, { pageNumber: pn }); }); });
      const name = `Weekly Sheet ${ws[0].w} to ${P.addDays(ws[ws.length - 1].w, 6)}.pdf`;
      await window.IM.saveBlob(pdf.output('blob'), name);
      toast(`Downloaded ${name}`, 4000);
    } catch (err) { console.error(err); (window.IM.toast || alert)('PDF failed: ' + err.message); }
    finally { stage.remove(); btn.disabled = false; }
  });
  window.Sheet = { render };
};
