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

  const cellTxt = rs => rs.map(r => esc(r.site) + (r.qty !== 1 ? ` ×${+r.qty.toFixed(2)}` : '')).join('<br>');
  const invLink = inv => inv.legacy
    ? `<span class="sh-past" title="Past record, no PDF">${esc(inv.number || 'Past record')}</span>`
    : `<a href="#" class="sh-inv" data-inv="${esc(inv.id)}" title="Download ${esc(inv.number)} as PDF">${esc(inv.number)}</a>`;

  function block(wk) {
    const dates = DAYS.map((_, i) => P.addDays(wk.w, i));
    const head = `<thead><tr><th rowspan="2" class="l">Subcontractor</th>${DAYS.map(d => `<th>${d.slice(0, 3)}</th>`).join('')}<th rowspan="2">Days</th><th rowspan="2">Invoice</th><th rowspan="2" class="r">Amount</th><th rowspan="2" class="r">Week total</th></tr>
      <tr>${dates.map(d => `<th class="sh-num">${+d.slice(8)}${+d.slice(8) === 1 || d === dates[0] ? `<small>${MON[+d.slice(5, 7) - 1]}</small>` : ''}</th>`).join('')}</tr></thead>`;
    const rows = wk.list.map((x, i) => {
      const onlyWhole = !x.dated.length && x.whole.length;
      const cells = onlyWhole
        ? `<td colspan="7" class="sh-on sh-whole">${cellTxt(x.whole)} <small>whole week</small></td>`
        : dates.map(d => { const l = x.dated.filter(r => r.date === d); return `<td class="${l.length ? 'sh-on' : 'sh-off'}">${cellTxt(l)}</td>`; }).join('');
      const note = [x.whole.length && !onlyWhole ? 'whole-week line' : '', x.lump.length ? 'adjustment' : ''].filter(Boolean).join(', ');
      return `<tr><th scope="row" class="l">${esc(x.name)}</th>${cells}<td class="sh-days">${n1(x.days)}</td><td class="sh-invs">${x.invs.map(invLink).join('<br>')}${note ? `<small>${note}</small>` : ''}</td><td class="r">£${money(x.amt)}</td>${i === 0 ? `<td class="r sh-total" rowspan="${wk.list.length}">£${money(wk.total)}</td>` : ''}</tr>`;
    }).join('');
    return `<table class="sheet-table" data-week="${wk.w}">${head}<tbody>${rows}</tbody></table>`;
  }

  const bandHtml = () => '<div class="sheet-band">From Invoices</div>';
  function render() {
    const ws = weeks();
    $('#sheetWrap').innerHTML = ws.length ? `<div class="sheet-sheet">${bandHtml()}${ws.map(block).join('')}</div>` : '<p class="muted">No work recorded in this period.</p>';
    $('#shPdf').disabled = !ws.length;
  }
  $('#shPeriod').addEventListener('change', render);
  $('#shPast').addEventListener('change', render);
  $('#sheetWrap').addEventListener('click', async e => {
    const a = e.target.closest('[data-inv]'); if (!a) return; e.preventDefault();
    const inv = db.invoices.find(i => i.id === a.dataset.inv); if (inv) await window.IM.downloadInvoices([inv], 'separate', { mark: false });
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
        const probe = document.createElement('div'); probe.className = 'sheet-sheet sheet-export'; probe.innerHTML = block(wk); stage.appendChild(probe);
        const h = probe.offsetHeight; stage.removeChild(probe);
        if (!cur || used + h > PH - 2 * PAD - 40) { cur = []; pages.push(cur); used = 0; }
        cur.push(wk); used += h + 10;
      }
      const invList = []; if (attach) ws.forEach(wk => wk.list.forEach(x => x.invs.forEach(i => { if (!i.legacy && !invList.includes(i)) invList.push(i); })));
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
      const linksPerPage = [];
      for (const [pi, grp] of pages.entries()) {
        toast(`Building sheet ${pi + 1}/${pages.length}…`, 60000);
        stage.innerHTML = `<div class="sheet-sheet sheet-export" style="padding:${PAD}px">${bandHtml()}${grp.map(block).join('')}</div>`;
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
      const name = `Weekly sheet ${ws[0].w} to ${P.addDays(ws[ws.length - 1].w, 6)}.pdf`;
      await window.IM.saveBlob(pdf.output('blob'), name);
      toast(`Downloaded ${name}`, 4000);
    } catch (err) { console.error(err); (window.IM.toast || alert)('PDF failed: ' + err.message); }
    finally { stage.remove(); btn.disabled = false; }
  });
  window.Sheet = { render };
};
