/*
 * Loose-text extractor. Turns pasted notes (or text copied from an old invoice)
 * into invoice fields and work lines. Everything it finds is reviewable in the form.
 */
(function () {
  const DAY = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
  const SEP = '\\s*[:\\-–=]?\\s*';
  const STOP = new Set(['MON', 'TUE', 'TUES', 'WED', 'WEDS', 'THU', 'THUR', 'THURS', 'FRI', 'SAT', 'SUN', 'VAT', 'GBP', 'INV',
    'NO', 'AM', 'PM', 'CIS', 'TOTAL', 'DAY', 'DAYS', 'HALF', 'FULL', 'SITE', 'RATE', 'WC', 'OFF', 'AND', 'TO', 'LABOUR', 'UK']);
  const NOT_NAME = /\b(lane|road|rd|street|st|avenue|ave|close|drive|way|court|crescent|grove|place|ltd|limited|united|kingdom|invoice|date|number|reference|description|quantity|price|amount|subtotal|total|due|vat|tax|account|sort|rate|site|week|payment|payments|details|payee|paid|reference|ref)\b/i;
  const SKIP_DAY = /\b(off|no work|didn'?t work|sick|holiday|absent)\b/i;

  const dayIdx = s => DAY_KEYS.indexOf(String(s).slice(0, 3).toLowerCase());
  const pad = n => String(n).padStart(2, '0');

  function toISO(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const fullYear = y => (y ? (+y < 100 ? 2000 + +y : +y) : new Date().getFullYear());

  // Returns {iso, raw} or null
  function parseDate(s) {
    let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) { const iso = toISO(+m[1], +m[2], +m[3]); if (iso) return { iso, raw: m[0] }; }
    m = s.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2}|\d{4}))?\b/);
    if (m) { const iso = toISO(fullYear(m[3]), +m[2], +m[1]); if (iso) return { iso, raw: m[0] }; }
    m = s.match(/\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/);
    if (m) { const iso = toISO(fullYear(m[3]), +m[2], +m[1]); if (iso) return { iso, raw: m[0] }; }
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})?\b/i);
    if (m) { const iso = toISO(fullYear(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]); if (iso) return { iso, raw: m[0] }; }
    // Month first: "September 28, 2026" / "Sep 28 2026"
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i);
    if (m) { const iso = toISO(fullYear(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]); if (iso) return { iso, raw: m[0] }; }
    return null;
  }

  const shortDay = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  function mondayOf(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const weekdayOf = iso => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;

  function findSite(s) {
    const exp = s.match(/\bsite\s*(?:code)?\s*[:\-]?\s*([A-Za-z0-9]{2,10})\b/i);
    if (exp && !STOP.has(exp[1].toUpperCase())) return exp[1].toUpperCase();
    for (let t of s.split(/[\s,;|()\/]+/)) {
      t = t.replace(/^[-–:.]+|[-–:.]+$/g, '');
      if (!t || t.startsWith('£')) continue;
      const up = t.toUpperCase();
      if (STOP.has(up) || new RegExp('^' + DAY + '$', 'i').test(t)) continue;
      if (/^\d+(\.\d+)?$/.test(t) || /^\d+(st|nd|rd|th)$/i.test(t)) continue;
      if (/^(?=.*\d)(?=.*[a-z])[a-z0-9]{2,8}$/i.test(t)) return up;
      if (/^[A-Z]{2,6}$/.test(t)) return up;
    }
    return '';
  }

  function parse(text, db) {
    const out = { from: {}, to: null, items: [], found: [], warnings: [] };
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const used = new Set();
    const note = (label, value) => out.found.push({ label, value });
    const next = i => (lines[i + 1] && !used.has(i + 1) ? (used.add(i + 1), lines[i + 1]) : '');
    let defaultSite = '';
    let addrStart = -1;

    // Payment format: "Payee <name> / Amount £x / Date dd/mm/yyyy / Reference <site>"
    if (lines.some(l => /^payee\s*[:\-–=]?\s*\S/i.test(l))) {
      out.paid = true;
      lines.forEach((l, i) => {
        let m;
        if ((m = l.match(/^payee\s*[:\-–=]?\s*(.+)$/i))) { out.from.name = m[1].trim(); used.add(i); }
        else if ((m = l.match(/^(?:amount|paid|total)\s*[:\-–=]?\s*£?\s*([\d,]+(?:\.\d{1,2})?)/i))) { out.amount = +m[1].replace(/,/g, ''); used.add(i); }
        else if ((m = l.match(/^(?:payment\s*)?date\s*[:\-–=]?\s*(.+)$/i))) { const d = parseDate(m[1]); if (d) out.paidDate = d.iso; used.add(i); }
        else if ((m = l.match(/^ref(?:erence)?\s*[:\-–=]?\s*(.+)$/i))) { out.reference = m[1].trim(); used.add(i); }
        else if (/^payments?(\s+details)?$|^payee$/i.test(l)) used.add(i);
      });
      if (out.paidDate) out.date = out.paidDate;
    }

    lines.forEach((l, i) => {
      if (used.has(i)) return;
      let m, hit = false;
      const hasDay = new RegExp('\\b' + DAY + '\\b', 'i').test(l);
      if ((m = l.match(new RegExp('^(?:account|acc|a\\/c)\\s*name' + SEP + '(.*)$', 'i')))) {
        out.from.accName = (m[1] || next(i)).trim(); hit = true;
      }
      if ((m = l.match(/sort\s*(?:code)?\s*[:\-–=]?\s*(\d{2})\s*[-\s.]?\s*(\d{2})\s*[-\s.]?\s*(\d{2})\b/i))) {
        out.from.sort = `${m[1]}-${m[2]}-${m[3]}`; hit = true;
      }
      if ((m = l.match(/(?:acc(?:ount)?\.?\s*(?:no\.?|number|num|#)?|a\/c\s*(?:no\.?)?)\s*[:\-–=]?\s*(\d{6,10})\b/i))) {
        out.from.accNo = m[1]; hit = true;
      }
      if (!hit && (m = l.match(new RegExp('^(?:name|sub(?:contractor)?|from|worker|operative)' + SEP.replace('?', '') + '(.*)$', 'i')))) {
        const v = m[1] || next(i);
        const parts = v.split(',').map(s => s.trim()).filter(Boolean);
        out.from.name = parts.shift();
        if (parts.length) out.from.addr = parts.join('\n');
        addrStart = i + 1; hit = true;
      }
      if (!hit && (m = l.match(/^(?:address|addr)\s*[:\-–]?\s*(.*)$/i))) {
        const buf = [m[1]];
        let j = i;
        while (!POSTCODE.test(buf.join(' ')) && lines[j + 1] && j - i < 4) { j++; buf.push(lines[j]); used.add(j); }
        out.from.addr = buf.join(',').split(',').map(s => s.trim()).filter(Boolean).join('\n');
        hit = true;
      }
      if (!hit && (m = l.match(/^(?:to|client|bill(?:ed)?\s*to|company)\s*[:\-–]\s*(.*)$/i))) {
        const name = (m[1] || next(i)).trim();
        const saved = (db.clients || []).find(c => c.name.toLowerCase() === name.toLowerCase());
        const buf = [];
        for (let j = lines.indexOf(name, i) + 1; j > i && j < lines.length && buf.length < 6; j++) {
          buf.push(lines[j]); used.add(j);
          if (POSTCODE.test(lines[j])) { if (/^united kingdom|^uk$/i.test(lines[j + 1] || '')) { buf.push(lines[j + 1]); used.add(j + 1); } break; }
        }
        if (!buf.some(b => POSTCODE.test(b))) buf.forEach((_, k) => used.delete(lines.indexOf(name, i) + 1 + k));
        out.to = saved ? { name: saved.name, addr: saved.addr } : { name, addr: buf.some(b => POSTCODE.test(b)) ? buf.join('\n') : '' };
        hit = true;
      }
      if ((m = l.match(/\b(INV-?\d{1,6})\b/i))) { out.number = m[1].toUpperCase(); hit = true; }
      else if ((m = l.match(/\b(?:ref(?:erence)?(?:\s*(?:no|number))?|inv(?:oice)?\s*(?:no\.?|number|#))\s*[:\-–]?\s*([A-Z]{0,4}-?\d{1,6})?\s*$/i))) {
        const v = m[1] || next(i);
        if (v && /\d/.test(v)) { out.number = v.toUpperCase(); hit = true; }
      }
      if ((m = l.match(/^(?:invoice\s*)?date\s*[:\-–]?\s*(.*)$/i))) {
        const d = parseDate(m[1] || next(i));
        if (d) { out.date = d.iso; hit = true; }
      }
      if ((m = l.match(/^due(?:\s*date)?\s*[:\-–]?\s*(.*)$/i))) {
        const d = parseDate(m[1] || '');
        if (d) out.due = d.iso;
        hit = true;
      }
      if ((m = l.match(/\b(?:w\/?c|w\/b|week\s*(?:commencing|beginning|starting|of)?|wk\s*(?:of)?)\s*[:\-–]?\s*(.+)$/i))) {
        const d = parseDate(m[1]);
        if (d) { out.weekStart = mondayOf(d.iso); hit = !hasDay; }
      }
      if ((m = l.match(/\b(?:day\s*)?rate\s*[:\-–=]?\s*£?\s*(\d+(?:\.\d{1,2})?)/i)) ||
          (m = l.match(/£?\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per|a)\s*day\b/i))) {
        out.rate = +m[1]; hit = hit || !hasDay;
      }
      if ((m = l.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/))) { out.from.email = m[0]; hit = true; }
      if ((m = l.match(/(?:\+44\s?\(?0?\)?\s?|\b0)(?:7\d{3}|\d{3,4})[\s-]?\d{3}[\s-]?\d{3,4}\b/)) && !/sort|acc|a\/c/i.test(l)) { out.from.phone = m[0].trim(); hit = true; }
      if (!hit && (m = l.match(/^(?:(?:amount|total|paid)\s*[:\-–=]?\s*£?|£)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:paid)?\s*$/i))) { out.amount = +m[1].replace(/,/g, ''); hit = true; }
      if (!hit && (m = l.match(/^ref(?:erence)?\s*[:\-–=]?\s*([A-Za-z0-9][A-Za-z0-9 ]{1,30})$/i)) && !/^inv/i.test(m[1])) { out.reference = m[1].trim(); hit = true; }
      if (!hit && (m = l.match(/^site\s*(?:code)?\s*[:\-–]\s*([A-Za-z0-9]{2,10})\s*$/i))) {
        defaultSite = m[1].toUpperCase(); hit = true;
      }
      if (hit) used.add(i);
    });

    if (!out.from.accNo) {
      const m = lines.filter((_, i) => !used.has(i)).join('\n').match(/(?:^|\s)(\d{8})(?:\s|$)/);
      if (m) out.from.accNo = m[1];
    }

    // Known subcontractor mentioned anywhere wins; fills bank details that weren't given
    const low = text.toLowerCase();
    const knownSub = (db.subs || []).find(s => s.name && low.includes(s.name.toLowerCase())) ||
      (db.subs || []).find(s => (s.aliases || []).some(a => a && low.includes(a.toLowerCase())));
    if (knownSub && (!out.from.name || (knownSub.aliases || []).some(a => a.toLowerCase() === out.from.name.toLowerCase()))) out.from.name = knownSub.name;
    if (!out.to) {
      const c = (db.clients || []).find(c => c.name && low.includes(c.name.toLowerCase()));
      if (c) out.to = { name: c.name, addr: c.addr };
    }

    const isWork = l => new RegExp('\\b' + DAY + '\\b', 'i').test(l) || (parseDate(l) && !POSTCODE.test(l));
    const free = lines.map((l, i) => ({ l, i })).filter(x => !used.has(x.i));

    // Name fallback: first plain 2-4 word line
    let nameIdx = -1;
    if (!out.from.name) {
      for (const { l, i } of free) {
        if (isWork(l)) continue;
        const first = l.split(',')[0].trim();
        if (/^[A-Za-z][A-Za-z'.\-]+(?:\s+[A-Za-z][A-Za-z'.\-]+){1,3}$/.test(first) && !NOT_NAME.test(first)) {
          out.from.name = first; nameIdx = i; used.add(i);
          const rest = l.split(',').slice(1).map(s => s.trim()).filter(Boolean);
          if (rest.length && !out.from.addr) out.from.addr = rest.join('\n');
          break;
        }
      }
    } else if (knownSub) {
      nameIdx = lines.findIndex(l => l.toLowerCase().includes(knownSub.name.toLowerCase()));
      if (nameIdx >= 0 && !used.has(nameIdx) && !isWork(lines[nameIdx])) used.add(nameIdx);
    }
    if (addrStart < 0 && nameIdx >= 0) addrStart = nameIdx + 1;

    // Address fallback: lines after the name up to the first postcode
    if (!out.from.addr && addrStart >= 0) {
      const buf = [];
      for (let i = addrStart; i < lines.length && buf.length < 5; i++) {
        if (used.has(i) || isWork(lines[i])) break;
        buf.push(lines[i]); used.add(i);
        if (POSTCODE.test(lines[i])) break;
      }
      if (buf.some(b => POSTCODE.test(b))) out.from.addr = buf.join(',').split(',').map(s => s.trim()).filter(Boolean).join('\n');
    }

    if (knownSub) {
      for (const k of ['addr', 'accName', 'accNo', 'sort']) if (!out.from[k] && knownSub[k]) out.from[k] = knownSub[k];
      if (!out.rate && knownSub.rate) out.rate = +knownSub.rate;
    }

    // Work lines
    const entries = [];
    let lastSite = defaultSite;

    // "4 x 12AB (Monday 28/09/26, Tuesday 29/09/26, ...)": one line per listed day.
    // "4 x 12AB" with no days listed becomes a whole-week line for the stated week.
    lines.forEach((l, i) => {
      if (used.has(i)) return;
      const qm = l.match(/^(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*([A-Za-z0-9][A-Za-z0-9 .'-]*?)\s*(?:\((.*)\))?\s*$/i);
      if (!qm) return;
      const qty = +qm[1], site = qm[2].trim();
      const parts = (qm[3] || '').split(/[,;]|\band\b|&/i).map(x => x.trim()).filter(Boolean);
      const days = parts.map(p => {
        const d = parseDate(p), dn = p.match(new RegExp('\\b' + DAY + '\\b', 'i'));
        const day = dn ? dayIdx(dn[1]) : d ? weekdayOf(d.iso) : null;
        if (d && dn && weekdayOf(d.iso) !== dayIdx(dn[1])) out.warnings.push(`${p}: ${shortDay(d.iso)} is not a ${dn[1]}`);
        return { day, date: d ? d.iso : null, raw: p };
      }).filter(x => x.day != null);
      used.add(i);
      if (days.length) {
        if (days.length !== qty) out.warnings.push(`${site}: says ${qty} day${qty === 1 ? '' : 's'} but lists ${days.length}`);
        days.forEach(x => entries.push({ day: x.day, date: x.date, site, qty: 1, price: null, label: 'Labour', named: true }));
      } else entries.push({ wholeWeek: true, day: 0, date: null, site, qty, price: null, label: 'Labour', named: true });
    });
    lines.forEach((l, i) => {
      if (used.has(i) || !isWork(l) || SKIP_DAY.test(l)) return;
      const d = parseDate(l);
      const rest = d ? l.replace(d.raw, ' ') : l;
      let days = [];
      const rng = rest.match(new RegExp('\\b' + DAY + '\\s*(?:-|–|to|till|until)\\s*' + DAY + '\\b', 'i'));
      if (rng) {
        for (let k = dayIdx(rng[1]), n = 0; n < 7; k = (k + 1) % 7, n++) { days.push(k); if (k === dayIdx(rng[2])) break; }
      } else {
        days = [...new Set([...rest.matchAll(new RegExp('\\b' + DAY + '\\b', 'gi'))].map(m => dayIdx(m[1])))];
      }
      const named = days.length > 0 || /^labou?r\b/i.test(l);
      if (!days.length && d) days = [weekdayOf(d.iso)];
      if (!days.length) return;

      // A " - " separated part that isn't the label, a day or a date may be the property written out ("79 Manor Road")
      const written = l.split(/\s+[-–]\s+/).map(x => x.trim()).find(x => /[a-z]{3}/i.test(x) && /\s/.test(x) &&
        !new RegExp('^' + DAY + '$', 'i').test(x) && !/^labou?r$/i.test(x) && !parseDate(x) && !/£/.test(x));
      const site = findSite(rest.replace(/£\s*\d+(\.\d+)?/g, ' ')) || written || lastSite;
      lastSite = site;
      const pound = rest.match(/£\s*(\d+(?:\.\d{1,2})?)/);
      const decimals = [...rest.matchAll(/\b\d+\.\d{2}\b/g)].map(m => +m[0]);
      let qty = /\bhalf\b|½/i.test(rest) ? 0.5 : 1;
      let price = pound ? +pound[1] : null;
      if (!pound && decimals.length >= 2) { qty = decimals[0]; price = decimals[1]; }
      const lm = l.match(/^([A-Za-z][A-Za-z ]{1,30}?)\s+[-–:]\s/);
      const label = lm && dayIdx(lm[1]) < 0 && !/^site$/i.test(lm[1]) ? lm[1].trim() : 'Labour';
      const single = days.length === 1 && d ? d.iso : null;
      days.forEach(day => entries.push({ day, date: single, site, qty, price, label, named }));
      used.add(i);
    });

    // Rate fallback for copied invoices: most common money-looking value
    if (!out.rate) {
      const counts = {};
      lines.forEach(l => { const m = l.match(/^£?(\d+\.\d{2})$/); if (m && +m[1] > 1) counts[m[1]] = (counts[m[1]] || 0) + 1; });
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 1) out.rate = +best[0];
    }

    if (entries.length) {
      let wc = out.weekStart;
      if (!wc) { const dated = entries.find(e => e.date); if (dated) wc = mondayOf(dated.date); }
      if (wc && !out.weekStart) out.weekStart = wc;
      out.items = entries.map(e => ({
        date: e.wholeWeek ? '' : e.date || (wc ? addDays(wc, e.day) : ''),
        ...(e.wholeWeek && wc ? { week: wc } : {}),
        site: e.site, label: e.label, qty: e.qty,
        price: e.price != null ? e.price : (out.rate || 0), vat: 'none'
      }));
      // Dates outside the stated week are likely typos
      if (out.weekStart) out.items.forEach(it => { if (it.date && (it.date < out.weekStart || it.date > addDays(out.weekStart, 6))) out.warnings.push(`${shortDay(it.date)} is outside the week of ${shortDay(out.weekStart)}`); });
      if (!wc && entries.some(e => !e.date)) out.warnings.push('No dates or week given for some days');
      const seen = new Set();
      out.items.forEach(it => { if (!it.date) return; const k = it.date + it.site; if (seen.has(k)) out.warnings.push(`${shortDay(it.date)} at ${it.site} is listed twice`); seen.add(k); });
    }
    if (defaultSite) out.site = defaultSite;
    // Unclear text with a single amount and only bare dates: one line for the amount, dated by the first date
    if (out.amount && !out.paid && entries.length && !entries.some(e => e.named)) {
      const first = out.items.find(it => it.date);
      if (first && !out.date) out.date = first.date;
      if (!out.reference) out.reference = (out.items.find(it => it.site) || {}).site || '';
      out.items = [];
    }
    if (out.amount && !out.items.length && !out.reference && !defaultSite) {
      const code = lines.find((l, i) => !used.has(i) && /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{2,8}$/.test(l) && !POSTCODE.test(l));
      if (code) out.reference = code.toUpperCase();
    }
    if (out.amount && !out.items.length) {
      out.items = [{ date: '', site: out.reference || defaultSite || '', label: 'Labour', qty: 1, price: out.amount, vat: 'none', lump: true }];
    }
    // Which layout the text was in: "payment" (Payee blocks, already paid), "labour" (day-by-day
    // work lines, not yet paid) or "unknown" (couldn't tell, so the UI asks whether it is paid)
    out.format = out.paid ? 'payment' : entries.some(e => e.named) ? 'labour' : 'unknown';

    // Summary for the UI
    if (out.from.name) note('Name', out.from.name + (knownSub ? ' (saved)' : ''));
    if (out.from.addr) note('Address', out.from.addr.replace(/\n/g, ', '));
    if (out.from.accName) note('Account name', out.from.accName);
    if (out.from.accNo) note('Account no.', out.from.accNo);
    if (out.from.sort) note('Sort code', out.from.sort);
    if (out.from.phone) note('Phone', out.from.phone);
    if (out.from.email) note('Email', out.from.email);
    if (out.to) note('Bill to', out.to.name);
    if (out.number) note('Reference', out.number);
    if (out.date) note('Invoice date', out.date);
    if (out.due) note('Due date', out.due);
    if (out.rate) note('Rate', '£' + out.rate);
    if (out.weekStart) note('Week', 'w/c ' + out.weekStart);
    if (out.paid) note('Paid', (out.amount ? '£' + out.amount.toFixed(2) : '') + (out.paidDate ? ' on ' + out.paidDate : ''));
    if (out.items.length) note('Lines', out.items.length + ' day' + (out.items.length > 1 ? 's' : ''));
    return out;
  }

  /*
   * Split a paste that covers several subcontractors into one text block each.
   * A block starts at a "Name:" line, a saved subcontractor's name, or a name-like
   * line after a blank/separator line. Lines before the first block (e.g. w/c, rate,
   * bill-to) are a shared header applied to every block.
   */
  function looksLikeName(l) {
    const first = l.split(',')[0].trim();
    return /^[A-Za-z][A-Za-z'.\-]+(?:\s+[A-Za-z][A-Za-z'.\-]+){1,3}$/.test(first) && !NOT_NAME.test(first) &&
      !new RegExp('\\b' + DAY + '\\b', 'i').test(first);
  }
  function splitBatch(text, db) {
    const header = [], segs = [];
    let cur = null, prevBlank = true;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l || /^[-=_*#~]{3,}$/.test(l)) { prevBlank = true; continue; }
      const low = l.toLowerCase();
      const starts = /^(?:name|sub(?:contractor)?|worker|operative)\s*[:\-–=]/i.test(l) || /^payee\s*[:\-–=]?\s*\S/i.test(l) ||
        (db.subs || []).some(s => [s.name, ...(s.aliases || [])].some(n => n && low.startsWith(n.toLowerCase()) && !cur?.some(x => x.toLowerCase().startsWith(n.toLowerCase())))) ||
        (prevBlank && looksLikeName(l));
      if (starts) { cur = [l]; segs.push(cur); } else if (cur) cur.push(l); else header.push(l);
      prevBlank = false;
    }
    return { header: header.join('\n'), segments: segs.map(s => s.join('\n')) };
  }

  /*
   * Match a typed site reference to a saved site: exact code, an alias, the property
   * name ("5 Elm Street"), or a code one character off ("5CF" -> "5CD").
   * Returns {code, from, how} where how is '', 'alias', 'name' or 'typo'.
   */
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function resolveSite(raw, sites) {
    const from = String(raw || '').trim();
    if (!from) return { code: '', from, how: '' };
    const key = from.toUpperCase().replace(/\s+/g, '');
    const low = from.toLowerCase().replace(/\s+/g, ' ');
    const list = (sites || []).filter(s => s.code);
    const exact = list.find(s => s.code.toUpperCase() === key);
    if (exact) return { code: exact.code, from, how: '' };
    const alias = list.find(s => (s.aliases || []).some(a => a.toUpperCase().replace(/\s+/g, '') === key));
    if (alias) return { code: alias.code, from, how: 'alias' };
    const byName = list.find(s => s.name && (s.name.toLowerCase().replace(/\s+/g, ' ') === low || low.startsWith(s.name.toLowerCase())));
    if (byName) return { code: byName.code, from, how: 'name' };
    if (key.length >= 3) {
      const near = list.filter(s => s.code.length === key.length && lev(s.code.toUpperCase(), key) === 1);
      if (near.length === 1) return { code: near[0].code, from, how: 'typo' };
    }
    return { code: key.length <= 10 && !/\s/.test(from) ? key : from, from, how: 'unknown' };
  }

  window.InvoiceParser = { parse, splitBatch, resolveSite, parseDate, mondayOf, addDays };
})();
