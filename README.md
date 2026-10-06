# Invoice Maker

Static invoice tool for subcontractor labour invoices. Open `index.html` in a browser; no server or install needed, works offline.

## Tabs
- **Create**: fill details by quick paste (one or many subcontractors, auto-extracted), full form with a week calendar, or step-by-step dialogs. Review, then add to the PDF queue.
- **Paid invoices**: paste payment notes (`Payee`, `Amount`, `Date`, `Reference`) to create invoices already marked paid.
- **Site references**: typed codes are matched to saved sites by code, property name or alias; one-letter typos are corrected (5CF → 5CD).
- **Payment tracking**: mark invoices paid (with a date) or back to unpaid from the Queue, one at a time or in bulk; the Dashboard lists everything waiting to be paid, oldest first, with totals per subcontractor.
- **Queue**: toggle which invoices to include, download as separate PDFs or one ZIP. Edit, copy to next week, archive.
- **Subcontractors**: quick add from pasted text (one or many), plus saved contacts with address, bank account, sort code, base day rate, VAT and numbering.
- **Timesheet**: a week grid of who worked which day and at which property, plus total days per subcontractor split by property.
- **Dashboard**: totals per week, per subcontractor, per property/site, calendar, line detail, CSV export.
- **Settings**: clients, site codes with property names, rates, numbering, default VAT, backup/restore.

## Data and security
Stored only in this browser, encrypted with AES-256-GCM using a key derived from your password (PBKDF2-SHA256, 310,000 iterations). The password is never stored and can't be recovered. The app locks after inactivity (Settings → Password) or with the Lock button. **Setup file** (Dashboard or Settings → Backup) exports or imports one encrypted file with all contacts, properties, invoice records, rates and settings, protected by your password or a different one.

## Templates
Invoices use the Modern template. Templates are defined in `js/templates.js`. Each entry has a name, CSS and a `render()` function; add a new entry to add a design.

## Libraries
Vendored in `vendor/`: html2canvas 1.4.1, jsPDF 2.5.1, JSZip 3.10.1.

## Security
- **No server, no network:** the page makes no requests to any site. Libraries (html2canvas, jsPDF, JSZip) and the Inter font are bundled in this repo. A Content Security Policy in `index.html` blocks outside connections, other websites' scripts and form posts, so data has nowhere to be sent.
- **Data stays in the browser:** saved data is encrypted (AES-256-GCM, key from your password via PBKDF2-SHA256, 600,000 rounds) before it is written to browser storage. The password is never stored and can't be recovered. Older files are upgraded to the current round count at the next unlock.
- **Imported files are cleaned:** ids, dates, numbers and text are validated on load and import, and all text is escaped when shown.
- **Auto-save file (optional):** on Chromium browsers (Chrome, Edge) Settings → Backup can keep an encrypted setup file updated after every change. Only the file you choose is written.
- **The repo holds code only.** Never commit a setup file; it contains bank details (encrypted, but still private).

## Hosting on GitHub Pages
Settings → Pages → Deploy from a branch → pick the branch and the `/ (root)` folder. The site is static, so it is live within a minute or two. Each person who opens it has their own empty tool and their own browser storage; share data with a setup file.
