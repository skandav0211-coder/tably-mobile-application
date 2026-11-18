import type { Bill } from './types';

export interface ReceiptHeader { name: string; address: string; contact: string; gstin: string | null; footer: string }
export interface RLine { text: string; align?: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean }
const f2 = (v: number) => v.toFixed(2);
const ascii = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7E]/g, '?');

function two(l: string, r: string, cols: number): string {
  if (l.length + r.length + 1 > cols) return l.slice(0, Math.max(cols - r.length - 1, 1)) + ' ' + r;
  return l + ' '.repeat(cols - l.length - r.length) + r;
}
function wrap(s: string, cols: number): string[] { const out: string[] = []; for (let i = 0; i < Math.max(s.length, 1); i += cols) out.push(s.slice(i, i + cols)); return out; }

/** One model feeds the on-screen preview, the ESC/POS printer and the tests. */
export function receiptLines(h: ReceiptHeader, b: Bill, widthMm: 58 | 80, reprint: boolean): RLine[] {
  const cols = widthMm === 80 ? 48 : 32; const L: RLine[] = []; const rule = '-'.repeat(cols);
  const add = (text: string, o: Partial<RLine> = {}) => L.push({ text: ascii(text), ...o });
  wrap(h.name, Math.floor(cols / 2)).forEach(t => add(t, { align: 'c', bold: true, big: true }));
  if (h.address) wrap(h.address, cols).forEach(t => add(t, { align: 'c' }));
  if (h.contact) add('Ph: ' + h.contact, { align: 'c' });
  if (h.gstin) add('GSTIN: ' + h.gstin, { align: 'c' });
  if (b.status === 'refunded') add('*** REFUND / CREDIT NOTE ***', { align: 'c', bold: true });
  if (b.status === 'void') add('*** VOID ***', { align: 'c', bold: true });
  if (reprint) add('*** COPY / REPRINT ***', { align: 'c', bold: true });
  add(rule);
  const d = new Date(b.createdAt);
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  add(two('Bill: ' + (b.invoiceNo || 'DRAFT'), date, cols)); add(two('Cashier: ' + (b.cashier || '-'), time, cols));
  if (b.tableNo) add('Table/Order: ' + b.tableNo);
  if (b.customerName) add('Customer: ' + b.customerName);
  add(rule); add(two('Item', 'Amount', cols));
  for (const i of b.items) { wrap(i.name, cols).forEach(t => add(t)); add(two(`  ${i.qty} x ${f2(i.price)}`, f2(i.qty * i.price), cols)); }
  add(rule); add(two('Subtotal', f2(b.subtotal), cols));
  if (b.discount > 0) add(two('Discount', '-' + f2(b.discount), cols));
  // tax breakup by rate (pro-rata after discount, as the server computes it)
  const byRate = new Map<number, number>(); for (const i of b.items) if (i.taxRate > 0) byRate.set(i.taxRate, (byRate.get(i.taxRate) || 0) + (i.qty * i.price * i.taxRate) / 100);
  const raw = [...byRate.values()].reduce((a, v) => a + v, 0); const k = raw > 0 ? b.tax / raw : 0;
  [...byRate.entries()].sort((a, c) => a[0] - c[0]).forEach(([r, t]) => add(two(`Tax @${r}%`, f2(t * k), cols)));
  if (b.tax > 0) add(two('Total tax', f2(b.tax), cols));
  if (b.serviceCharge > 0) add(two('Service charge', f2(b.serviceCharge), cols));
  add(two('TOTAL (Rs)', f2(b.total), cols), { bold: true }); add(rule);
  b.payments.forEach(p => add(two('Paid: ' + p.method.toUpperCase(), f2(p.amount), cols)));
  add(''); add(h.footer || 'Thank you! Visit again.', { align: 'c' });
  return L;
}

/** ESC/POS bytes (CP437/ASCII safe). Width 58 mm = 32 columns, 80 mm = 48 columns. */
export function toEscPos(lines: RLine[]): Uint8Array {
  const out: number[] = [0x1b, 0x40];
  for (const l of lines) {
    out.push(0x1b, 0x61, l.align === 'c' ? 1 : l.align === 'r' ? 2 : 0, 0x1b, 0x45, l.bold ? 1 : 0, 0x1d, 0x21, l.big ? 0x11 : 0);
    for (const ch of l.text) out.push(ch.charCodeAt(0) & 0x7f); out.push(0x0a);
  }
  out.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}
export function testPageLines(widthMm: 58 | 80): RLine[] {
  const cols = widthMm === 80 ? 48 : 32;
  return [{ text: 'PRINTER TEST', align: 'c', bold: true }, { text: `Paper ${widthMm} mm (${cols} columns)`, align: 'c' }, { text: '-'.repeat(cols) }, { text: 'The quick brown fox 0123456789' }, { text: 'Rs 1,234.56' }];
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
/** A4 invoice (Unicode-safe). All user text is HTML-escaped. */
export function invoiceHtml(h: ReceiptHeader, b: Bill, reprint: boolean): string {
  const rows = b.items.map(i => `<tr><td>${esc(i.name)}</td><td class=r>${i.qty}</td><td class=r>${f2(i.price)}</td><td class=r>${i.taxRate}%</td><td class=r>${f2(i.qty * i.price)}</td></tr>`).join('');
  const label = b.status === 'refunded' ? 'CREDIT NOTE (REFUND)' : b.status === 'void' ? 'VOID' : 'TAX INVOICE';
  return `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;padding:32px;color:#111}h1{margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.tot td{border:0}.big{font-size:18px;font-weight:700}.mut{color:#555}</style></head><body>
<h1>${esc(h.name)}</h1><div class=mut>${esc(h.address)}<br>${esc(h.contact)}${h.gstin ? '<br>GSTIN: ' + esc(h.gstin) : ''}</div>
<h2>${label}${reprint ? ' — COPY / REPRINT' : ''}</h2>
<div>Invoice: <b>${esc(b.invoiceNo || 'DRAFT')}</b> · ${esc(new Date(b.createdAt).toLocaleString())} · Cashier: ${esc(b.cashier || '-')}${b.tableNo ? ' · Table ' + esc(b.tableNo) : ''}${b.customerName ? '<br>Customer: ' + esc(b.customerName) + (b.customerMobile ? ' (' + esc(b.customerMobile) + ')' : '') : ''}</div>
<table><tr><th>Item</th><th class=r>Qty</th><th class=r>Price</th><th class=r>Tax</th><th class=r>Amount</th></tr>${rows}</table>
<table class=tot><tr><td></td><td class=r>Subtotal</td><td class=r>${f2(b.subtotal)}</td></tr>${b.discount > 0 ? `<tr><td></td><td class=r>Discount</td><td class=r>-${f2(b.discount)}</td></tr>` : ''}
${b.tax > 0 ? `<tr><td></td><td class=r>Tax</td><td class=r>${f2(b.tax)}</td></tr>` : ''}${b.serviceCharge > 0 ? `<tr><td></td><td class=r>Service charge</td><td class=r>${f2(b.serviceCharge)}</td></tr>` : ''}
<tr class=big><td></td><td class=r>Total</td><td class=r>₹${f2(b.total)}</td></tr>${b.payments.map(p => `<tr><td></td><td class=r>Paid (${esc(p.method)})</td><td class=r>${f2(p.amount)}</td></tr>`).join('')}</table>
<p class=mut>${esc(h.footer || 'Thank you! Visit again.')}</p></body></html>`;
}
export function reportHtml(title: string, r: { billCount: number; total: number; averageBill: number; discounts: number; tax: number; byMethod: Record<string, number>; itemWise: { name: string; qty: number; revenue: number }[] }, source: string): string {
  return `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;padding:32px}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}</style></head><body>
<h1>${esc(title)}</h1><p>Source: ${esc(source)}</p><p>Bills: <b>${r.billCount}</b> · Total: <b>₹${f2(r.total)}</b> · Average: ₹${f2(r.averageBill)} · Discounts: ₹${f2(r.discounts)} · Tax: ₹${f2(r.tax)}</p>
<h3>By payment method</h3><table>${Object.entries(r.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class=r>${f2(v)}</td></tr>`).join('')}</table>
<h3>Item-wise sales</h3><table><tr><th>Item</th><th class=r>Qty</th><th class=r>Revenue</th></tr>${r.itemWise.map(i => `<tr><td>${esc(i.name)}</td><td class=r>${i.qty}</td><td class=r>${f2(i.revenue)}</td></tr>`).join('')}</table></body></html>`;
}
