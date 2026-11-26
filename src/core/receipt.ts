import type { Bill } from './types';

export interface ReceiptHeader { name: string; address: string; contact: string; gstin: string | null; footer: string }
export interface RLine { text: string; align?: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean; kind?: 'text' | 'rule' | 'columns'; cols?: string[]; size?: 'normal' | 'large' }
export interface ReceiptOptions { width: 32 | 48; format?: 'thermal' | 'display'; reprint?: boolean }
const f2 = (v: number) => v.toFixed(2);
const ascii = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7E]/g, '?');
const wrap = (value: string, width: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
    } else if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
};
const fitLeft = (s: string, n: number) => s.slice(0, n).padEnd(n);
const fitRight = (s: string, n: number) => s.slice(-n).padStart(n);
const pair = (left: string, right: string, width: number) => {
  if (left.length + right.length + 1 > width) left = left.slice(0, Math.max(1, width - right.length - 1));
  return left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right;
};

/** Structured receipt source shared by preview, PDF and thermal output. */
export function buildReceipt(b: Bill, h: ReceiptHeader, options: ReceiptOptions): RLine[] {
  const width = options.width;
  const thermal = options.format !== 'display';
  const cols: [number, number, number, number] = width === 48 ? [20, 4, 9, 12] : [10, 3, 8, 8];
  const [nameWidth, qtyWidth, rateWidth, amountWidth] = cols;
  const lineWidth = cols.reduce((sum, value) => sum + value, 0) + 3;
  const clean = (value: string) => thermal ? ascii(value) : value;
  const result: RLine[] = [];
  const add = (text: string, opts: Partial<RLine> = {}) => result.push({ text: clean(text), kind: opts.kind || 'text', ...opts });
  const centered = (text: string, opts: Partial<RLine> = {}) => wrap(clean(text), width).forEach(line => add(line, { align: 'c', ...opts }));
  const rule = () => add('-'.repeat(width), { kind: 'rule' });
  const amount = (value: number) => `${thermal ? 'Rs ' : '₹'}${f2(value)}`;
  const rightTotal = (label: string, value: string) => add(pair(label, value, width));

  centered(h.name, { bold: true, big: true, size: 'large' });
  if (h.address) centered(h.address);
  if (h.contact) centered(`Ph ${h.contact}`);
  if (h.gstin) centered(`GSTIN ${h.gstin}`);
  if (b.status === 'refunded') centered('*** REFUND / CREDIT NOTE ***', { bold: true });
  if (b.status === 'void') centered('*** VOID ***', { bold: true });
  if (options.reprint) centered('*** COPY / REPRINT ***', { bold: true });
  rule();
  const date = new Date(b.createdAt);
  const dateText = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  const timeText = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const billLabel = `Bill No : ${b.invoiceNo || 'DRAFT'}`;
  const dateLabel = `${dateText} ${timeText}`;
  if (billLabel.length + dateLabel.length + 1 <= width) add(pair(billLabel, dateLabel, width));
  else { wrap(billLabel, width).forEach(line => add(line)); wrap(dateLabel, width).forEach(line => add(line)); }
  if (b.cashier) wrap(`Cashier: ${b.cashier}`, width).forEach(line => add(line));
  if (b.tableNo) wrap(`Table   : ${b.tableNo}`, width).forEach(line => add(line));
  if (b.customerName || b.customerMobile) wrap(`Customer: ${[b.customerName, b.customerMobile].filter(Boolean).join('  ')}`, width).forEach(line => add(line));
  rule();
  const columns = ['Item', 'Qty', 'Rate', 'Amount'];
  const head = `${fitLeft(columns[0], nameWidth)} ${fitRight(columns[1], qtyWidth)} ${fitRight(columns[2], rateWidth)} ${fitRight(columns[3], amountWidth)}`;
  add(head, { kind: 'columns', cols: columns });
  rule();
  for (const item of b.items) {
    const nameLines = wrap(clean(item.name), nameWidth);
    nameLines.forEach((name, index) => {
      const line = index === 0
        ? `${fitLeft(name, nameWidth)} ${fitRight(String(item.qty), qtyWidth)} ${fitRight(f2(item.price), rateWidth)} ${fitRight(f2(item.qty * item.price), amountWidth)}`
        : fitLeft(name, lineWidth);
      add(line, { kind: 'columns', cols: index === 0 ? [name, String(item.qty), f2(item.price), f2(item.qty * item.price)] : [name] });
    });
  }
  rule();
  rightTotal('Subtotal', f2(b.subtotal));
  if (b.discount > 0) rightTotal('Discount', `-${f2(b.discount)}`);
  if (b.serviceCharge > 0) rightTotal('Service charge', f2(b.serviceCharge));
  const byRate = new Map<number, number>();
  for (const item of b.items) if (item.taxRate > 0) byRate.set(item.taxRate, (byRate.get(item.taxRate) || 0) + (item.qty * item.price * item.taxRate) / 100);
  const rawTax = [...byRate.values()].reduce((sum, value) => sum + value, 0);
  const taxScale = rawTax > 0 ? b.tax / rawTax : 0;
  [...byRate.entries()].sort((a, c) => a[0] - c[0]).forEach(([rate, value]) => rightTotal(`Tax @${rate}%`, f2(value * taxScale)));
  if (b.tax > 0) rightTotal('Tax', f2(b.tax));
  rule();
  rightTotal('TOTAL', amount(b.total));
  result[result.length - 1] = { ...result[result.length - 1], bold: true, big: true, size: 'large' };
  rule();
  const qtyTotal = b.items.reduce((sum, item) => sum + item.qty, 0);
  add(`Items: ${b.items.length}  Qty: ${qtyTotal}`);
  if (b.payments.length) add(`Paid by: ${b.payments.map(payment => payment.method.toUpperCase()).join(' + ')}`);
  centered('Thank you! Visit again.');
  if (h.footer) centered(h.footer);
  return result;
}

/** One model feeds the on-screen preview, ESC/POS output and receipt-PDF tests. */
export function receiptLines(h: ReceiptHeader, b: Bill, widthMm: 58 | 80, reprint: boolean): RLine[] {
  return buildReceipt(b, h, { width: widthMm === 80 ? 48 : 32, format: 'thermal', reprint });
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
/** Receipt-width PDF rendered from the same structured lines as preview and printer. */
export function receiptHtml(h: ReceiptHeader, b: Bill, widthMm: 58 | 80, reprint: boolean): string {
  const width = widthMm === 80 ? 48 : 32;
  const lines = buildReceipt(b, h, { width, format: 'display', reprint });
  const rows = lines.map(line => `<div class="${line.align === 'c' ? 'center' : line.align === 'r' ? 'right' : 'left'}${line.bold ? ' bold' : ''}${line.big ? ' big' : ''}">${esc(line.text || ' ')}</div>`).join('');
  return `<html><head><meta charset="utf-8"><style>@page{size:${widthMm}mm auto;margin:3mm}body{font-family:monospace;color:#111;margin:0 auto;width:${widthMm - 6}mm;font-size:10pt}.left{text-align:left}.center{text-align:center}.right{text-align:right}.bold{font-weight:700}.big{font-size:14pt;font-weight:700}div{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}</style></head><body>${rows}</body></html>`;
}
/** Retained export name for callers; PDF invoices now use the shared receipt model. */
export function invoiceHtml(h: ReceiptHeader, b: Bill, reprint: boolean): string {
  return receiptHtml(h, b, 80, reprint);
}
export function reportHtml(title: string, r: { billCount: number; total: number; averageBill: number; discounts: number; tax: number; byMethod: Record<string, number>; itemWise: { name: string; qty: number; revenue: number }[] }, source: string): string {
  return `<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial,sans-serif;padding:32px}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}</style></head><body>
<h1>${esc(title)}</h1><p>Source: ${esc(source)}</p><p>Bills: <b>${r.billCount}</b> · Total: <b>₹${f2(r.total)}</b> · Average: ₹${f2(r.averageBill)} · Discounts: ₹${f2(r.discounts)} · Tax: ₹${f2(r.tax)}</p>
<h3>By payment method</h3><table>${Object.entries(r.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class=r>${f2(v)}</td></tr>`).join('')}</table>
<h3>Item-wise sales</h3><table><tr><th>Item</th><th class=r>Qty</th><th class=r>Revenue</th></tr>${r.itemWise.map(i => `<tr><td>${esc(i.name)}</td><td class=r>${i.qty}</td><td class=r>${f2(i.revenue)}</td></tr>`).join('')}</table></body></html>`;
}
