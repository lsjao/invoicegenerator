/* Timesheet: days worked per subcontractor, as a week grid (who worked which day, where) and period totals. */
window.initTimesheet = function () {
  const $ = s => document.querySelector(s);
  const { db, P, esc, money, shortDate } = window.IM;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dm = s => { const [, m, d] = s.split('-'); return `${+d} ${MONTHS[m - 1]}`; };
  const rows = () => window.Dashboard.allRows().filter(r => r.days > 0);
  let week = null;

  function latestWeek() {
    const today = iso(new Date());
    const ws = rows().map(r => P.mondayOf(r.date)).filter(w => w <= today).sort();
    return ws.length ? ws[ws.length - 1] : P.mondayOf(today);
  }

  function renderWeek() {
    if (!week) week = latestWeek();
    const end = P.addDays(week, 6);
    $('#tsTitle').textContent = `${dm(week)} – ${dm(end)} ${end.slice(0, 4)}`;
    const wr = rows().filter(r => (r.isWeek ? r.date === week : r.date >= week && r.date <= end));
    const subs = [...new Set(wr.map(r => r.sub))].sort();
    const hasWhole = wr.some(r => r.isWeek);
    const dates = DAYS.map((_, i) => P.addDays(week, i));
    const perDay = dates.map(() => new Set());
    const cell = list => list.length ? list.map(r => `<span class="ts-site" title="${esc(r.inv.number)}">${esc(r.site)}${r.qty !== 1 ? ' ×' + r.qty : ''}</span>`).join('') : '';
    const body = subs.map(name => {
      const mine = wr.filter(r => r.sub === name);
      const days = mine.reduce((a, r) => a + r.days, 0), amt = mine.reduce((a, r) => a + r.gross, 0);
      const tds = dates.map((d, i) => { const l = mine.filter(r => !r.isWeek && r.date === d); if (l.length) perDay[i].add(name); return `<td class="${l.length ? 'on' : ''}">${cell(l)}</td>`; }).join('');
      return `<tr><th scope="row">${esc(name)}</th>${tds}${hasWhole ? `<td class="${mine.some(r => r.isWeek) ? 'on wk' : ''}">${cell(mine.filter(r => r.isWeek))}</td>` : ''}<td class="r"><b>${+days.toFixed(1)}</b></td><td class="r">£${money(amt)}</td></tr>`;
    }).join('');
    const tot = wr.reduce((a, r) => a + r.days, 0), amt = wr.reduce((a, r) => a + r.gross, 0);
    $('#tsWeek').innerHTML = subs.length ? `<thead><tr><th>Subcontractor</th>${dates.map((d, i) => `<th class="c">${DAYS[i]}<small>${+d.slice(8)}</small></th>`).join('')}${hasWhole ? '<th class="c">Whole week<small>no daily split</small></th>' : ''}<th class="r">Days</th><th class="r">Amount</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><th>On site</th>${perDay.map(s => `<td class="c">${s.size || ''}</td>`).join('')}${hasWhole ? '<td></td>' : ''}<td class="r"><b>${+tot.toFixed(1)}</b></td><td class="r"><b>£${money(amt)}</b></td></tr></tfoot>`
      : '<tbody><tr><td class="nodata">No work recorded this week.</td></tr></tbody>';
  }

  function range() {
    const p = $('#tsPeriod').value, now = new Date();
    if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
    if (p === 'lastmonth') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (p === '4w') return [P.addDays(P.mondayOf(iso(now)), -21), iso(now)];
    if (p === 'year') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
    return ['0000', '9999'];
  }

  function renderTotals() {
    const [a, b] = range();
    const rs = rows().filter(r => r.date >= a && r.date <= b);
    const sites = [...new Set(rs.map(r => r.site))].sort();
    const subs = [...new Set(rs.map(r => r.sub))];
    const data = subs.map(name => {
      const mine = rs.filter(r => r.sub === name);
      const bySite = {}; mine.forEach(r => { bySite[r.site] = (bySite[r.site] || 0) + r.days; });
      return { name, mine, bySite, days: mine.reduce((x, r) => x + r.days, 0), amt: mine.reduce((x, r) => x + r.gross, 0),
        weeks: new Set(mine.map(r => P.mondayOf(r.date))).size, invs: new Set(mine.map(r => r.inv.id)).size,
        last: mine.map(r => r.date).sort().pop() };
    }).sort((x, y) => y.days - x.days);
    const n = v => (v ? +v.toFixed(1) : '');
    $('#tsTotals').innerHTML = data.length ? `<thead><tr><th>Subcontractor</th><th class="r">Days</th>${sites.map(s => `<th class="r">${esc(s)}</th>`).join('')}<th class="r">Weeks</th><th class="r">Invoices</th><th class="r">Amount</th><th class="r">Last worked</th></tr></thead>
      <tbody>${data.map(d => `<tr><th scope="row">${esc(d.name)}</th><td class="r"><b>${n(d.days)}</b></td>${sites.map(s => `<td class="r">${n(d.bySite[s])}</td>`).join('')}<td class="r">${d.weeks}</td><td class="r">${d.invs}</td><td class="r">£${money(d.amt)}</td><td class="r">${d.last ? shortDate(d.last) : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><td class="r"><b>${n(data.reduce((x, d) => x + d.days, 0))}</b></td>${sites.map(s => `<td class="r">${n(data.reduce((x, d) => x + (d.bySite[s] || 0), 0))}</td>`).join('')}<td></td><td class="r">${new Set(rs.map(r => r.inv.id)).size}</td><td class="r"><b>£${money(data.reduce((x, d) => x + d.amt, 0))}</b></td><td></td></tr></tfoot>`
      : '<tbody><tr><td class="nodata">No work recorded in this period.</td></tr></tbody>';
  }

  function render() { renderWeek(); renderTotals(); }
  const move = n => { week = n === 0 ? P.mondayOf(iso(new Date())) : P.addDays(week || latestWeek(), 7 * n); renderWeek(); };
  $('#tsPrev').addEventListener('click', () => move(-1));
  $('#tsNext').addEventListener('click', () => move(1));
  $('#tsThis').addEventListener('click', () => move(0));
  $('#tsPeriod').addEventListener('change', renderTotals);
  window.Timesheet = { render, reset: () => { week = null; } };
};
