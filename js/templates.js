/*
 * Invoice templates.
 * Each template has: name, desc, css (scoped to its class) and render(inv, h) returning the .page HTML.
 * To add a new design, copy one entry, give it a new key and class, and edit the markup/CSS.
 * h = helpers: esc, money, longDate, lineDesc, totals, lines
 */
window.TEMPLATES = {
  classic: {
    name: 'Classic',
    desc: 'Matches your current invoice layout',
    css: `
      .tpl-classic { font-family: 'Inter', Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }
      .tpl-classic .c-title { position: absolute; top: 18mm; left: 10mm; font-size: 16pt; }
      .tpl-classic .c-to { position: absolute; top: 34mm; left: 10mm; display: flex; line-height: 1.55; }
      .tpl-classic .c-to .lbl { width: 13.5mm; }
      .tpl-classic .c-meta { position: absolute; top: 34mm; left: 117mm; line-height: 1.55; }
      .tpl-classic .c-meta b { font-weight: 600; display: block; }
      .tpl-classic .c-meta div { margin-bottom: 2.2mm; }
      .tpl-classic .c-from { position: absolute; top: 34mm; left: 158mm; width: 44mm; line-height: 1.3; }
      .tpl-classic table { position: absolute; top: 89mm; left: 10mm; width: 191mm; border-collapse: collapse; }
      .tpl-classic th { font-weight: 600; text-align: right; padding: 0 2mm 2.2mm 0; border-bottom: 0.3mm solid #444; }
      .tpl-classic td { text-align: right; padding: 2.6mm 2mm 2.6mm 0; border-bottom: 0.2mm solid #ddd; }
      .tpl-classic th:first-child, .tpl-classic td:first-child { text-align: left; padding-left: 0; }
      .tpl-classic .c-items > tbody > tr:last-child > td { border-bottom: 0.3mm solid #444; }
      .tpl-classic .c-tot { margin-left: 82mm; width: 109mm; }
      .tpl-classic .c-tot td { border: 0; padding: 2.6mm 2mm 1.6mm 0; }
      .tpl-classic .c-tot td:first-child { text-align: right; width: 68mm; }
      .tpl-classic .c-tot tr.grand td { border-top: 0.3mm solid #444; font-weight: 700; padding-top: 3mm; }
      .tpl-classic .c-tot tr.due td { font-size: 8pt; }
      .tpl-classic .c-bank { position: absolute; top: 262mm; left: 16mm; font-size: 12.5pt; line-height: 1.3; }
    `,
    render(inv, h) {
      const t = h.totals(inv);
      const rows = inv.items.map(it => `
        <tr><td>${h.esc(h.lineDesc(it))}</td><td>${h.num(it.qty)}</td><td>${h.money(it.price)}</td>
        <td>${h.esc(h.vatLabel(it.vat))}</td><td>${h.money(it.qty * it.price)}</td></tr>`).join('');
      const vatRows = t.vat.map(v => `<tr><td>Total VAT ${v.rate}%</td><td>${h.money(v.amount)}</td></tr>`).join('');
      return `
      <div class="page tpl-classic">
        ${inv.notTax ? '<div class="c-title">This is not a tax invoice</div>' : ''}
        <div class="c-to"><div class="lbl">To:</div><div>${h.esc(inv.to.name)}<br>${h.lines(inv.to.addr)}</div></div>
        <div class="c-meta">
          <b>Invoice Date</b><div>${h.longDate(inv.date)}</div>
          <b>Reference Number</b><div>${h.esc(inv.number)}</div>
        </div>
        <div class="c-from">${h.esc(inv.from.name)}<br>${h.lines(inv.from.addr)}</div>
        <table class="c-items">
          <thead><tr><th style="width:62mm">Description</th><th style="width:20mm">Quantity</th><th style="width:34mm">Unit Price</th><th style="width:34mm">VAT</th><th>Amount ${h.esc(inv.currency)}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="5" style="padding:0;border:0">
            <table class="c-tot" style="position:static">
              <tr><td>Subtotal</td><td>${h.money(t.sub)}</td></tr>
              ${vatRows}
              <tr class="grand"><td>TOTAL ${h.esc(inv.currency)}</td><td>${h.money(t.total)}</td></tr>
              ${inv.paid ? `<tr class="due"><td>PAID${inv.paidDate ? ' ' + h.longDate(inv.paidDate).toUpperCase() : ''}</td><td>${h.money(t.total)}</td></tr><tr class="grand"><td>BALANCE DUE</td><td>0.00</td></tr>` : `<tr class="due"><td>DUE DATE</td><td>${inv.due ? h.longDate(inv.due) : ''}</td></tr>`}
            </table>
          </td></tr></tfoot>
        </table>
        <div class="c-bank">
          Account Name: ${h.esc(inv.from.accName || inv.from.name)}<br>
          Account Number: ${h.esc(inv.from.accNo)}<br>
          Sort Code: ${h.esc(inv.from.sort)}
        </div>
      </div>`;
    }
  },

  modern: {
    name: 'Modern (placeholder)',
    desc: 'Stand-in until your own template is added',
    css: `
      .tpl-modern { font-family: 'Inter', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1b1f24; padding: 0 16mm; }
      .tpl-modern .m-band { margin: 0 -16mm; background: #1A3920; border-bottom: 1.5mm solid #C8B21B; color: #fff; padding: 14mm 16mm 10mm; display: flex; justify-content: space-between; align-items: flex-end; }
      .tpl-modern .m-band h1 { margin: 0; font-size: 26pt; letter-spacing: .08em; font-weight: 700; }
      .tpl-modern .m-band .m-ref { text-align: right; line-height: 1.5; }
      .tpl-modern .m-parties { display: flex; justify-content: space-between; margin: 12mm 0 10mm; line-height: 1.5; }
      .tpl-modern .m-parties small { display: block; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; font-size: 7.5pt; margin-bottom: 1.5mm; }
      .tpl-modern table { width: 100%; border-collapse: collapse; }
      .tpl-modern th { background: #f3eed3; text-align: right; padding: 2.5mm; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #1A3920; }
      .tpl-modern td { text-align: right; padding: 2.8mm 2.5mm; border-bottom: 0.2mm solid #e3e5e9; }
      .tpl-modern th:first-child, .tpl-modern td:first-child { text-align: left; }
      .tpl-modern .m-tot { width: 80mm; margin: 6mm 0 0 auto; }
      .tpl-modern .m-tot div { display: flex; justify-content: space-between; padding: 1.8mm 2.5mm; }
      .tpl-modern .m-tot .grand { background: #1A3920; color: #fff; font-weight: 700; font-size: 11pt; border-radius: 1.5mm; margin-top: 1.5mm; }
      .tpl-modern .m-paid { display: inline-block; margin-top: 3mm; border: 0.6mm solid #C8B21B; color: #e0d192; padding: 1mm 3.5mm; border-radius: 1.5mm; font-weight: 700; letter-spacing: .2em; font-size: 10pt; }
      .tpl-modern .m-tot .paidrow { color: #1A3920; }
      .tpl-modern .m-bank { position: absolute; left: 16mm; right: 16mm; bottom: 18mm; border-top: 0.4mm solid #1A3920; padding-top: 5mm; display: flex; gap: 14mm; }
      .tpl-modern .m-bank small { display: block; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; font-size: 7pt; }
      .tpl-modern .m-bank b { font-size: 11pt; }
    `,
    render(inv, h) {
      const t = h.totals(inv);
      const rows = inv.items.map(it => `
        <tr><td>${h.esc(h.lineDesc(it))}</td><td>${h.num(it.qty)}</td><td>${h.money(it.price)}</td>
        <td>${h.esc(h.vatLabel(it.vat))}</td><td>${h.money(it.qty * it.price)}</td></tr>`).join('');
      const vatRows = t.vat.map(v => `<div><span>VAT ${v.rate}%</span><span>${h.money(v.amount)}</span></div>`).join('');
      return `
      <div class="page tpl-modern">
        <div class="m-band">
          <div><h1>INVOICE</h1>${inv.notTax ? '<div>This is not a tax invoice</div>' : ''}${inv.paid ? '<div class="m-paid">PAID</div>' : ''}</div>
          <div class="m-ref"><b>${h.esc(inv.number)}</b><br>${h.longDate(inv.date)}${inv.paid ? (inv.paidDate ? '<br>Paid ' + h.longDate(inv.paidDate) : '') : inv.due ? '<br>Due ' + h.longDate(inv.due) : ''}</div>
        </div>
        <div class="m-parties">
          <div><small>From</small><b>${h.esc(inv.from.name)}</b><br>${h.lines(inv.from.addr)}</div>
          <div style="text-align:right"><small>Bill to</small><b>${h.esc(inv.to.name)}</b><br>${h.lines(inv.to.addr)}</div>
        </div>
        <table>
          <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>VAT</th><th>Amount ${h.esc(inv.currency)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="m-tot">
          <div><span>Subtotal</span><span>${h.money(t.sub)}</span></div>
          ${vatRows}
          <div class="grand"><span>Total ${h.esc(inv.currency)}</span><span>${h.money(t.total)}</span></div>
          ${inv.paid ? `<div class="paidrow"><span>Paid${inv.paidDate ? ' ' + h.longDate(inv.paidDate) : ''}</span><span>${h.money(t.total)}</span></div><div><b>Balance due</b><b>0.00</b></div>` : ''}
        </div>
        <div class="m-bank">
          <div><small>Account name</small><b>${h.esc(inv.from.accName || inv.from.name)}</b></div>
          <div><small>Account number</small><b>${h.esc(inv.from.accNo)}</b></div>
          <div><small>Sort code</small><b>${h.esc(inv.from.sort)}</b></div>
        </div>
      </div>`;
    }
  }
};

// Inject template CSS once
(function () {
  const s = document.createElement('style');
  s.textContent = `.page { width: 210mm; height: 297mm; position: relative; background: #fff; overflow: hidden; box-sizing: border-box; }`
    + Object.values(window.TEMPLATES).map(t => t.css).join('\n');
  document.head.appendChild(s);
})();
