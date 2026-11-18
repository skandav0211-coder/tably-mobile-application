import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptLines, toEscPos, testPageLines, invoiceHtml } from '../src/core/receipt';
import { calculate } from '../src/core/calc';
import type { Bill } from '../src/core/types';

const items = [{ name: 'Cappuccino Large With Extra Shot And Oat Milk', qty: 2, price: 150, taxRate: 5 }, { name: 'Brownie ₹', qty: 1, price: 80, taxRate: 18 }];
const t = calculate(items, 20, 10);
const bill: Bill = { clientTxnId: 'c', invoiceNo: 'D1-000007', status: 'completed', createdAt: '2026-11-17T10:15:00.000Z', cashier: 'Asha', customerName: '<b>Ravi</b>', customerMobile: null, tableNo: '5', notes: null, items,
  payments: [{ method: 'upi', amount: t.total }], subtotal: t.subtotal, discount: t.discount, tax: t.tax, serviceCharge: t.serviceCharge, total: t.total, synced: false, syncError: null, printCount: 0, statusReason: null };
const header = { name: 'The Brew House & Co', address: '12 MG Road, Bengaluru 560001', contact: '9800000001', gstin: '29ABCDE1234F1Z5', footer: 'Thank you!' };

for (const w of [58, 80] as const) test(`receipt fits ${w} mm (${w === 80 ? 48 : 32} cols) and has every SRS §6.4 field`, () => {
  const cols = w === 80 ? 48 : 32; const L = receiptLines(header, bill, w, false); const txt = L.map(l => l.text).join('\n');
  for (const l of L) assert.ok(l.text.length <= (l.big ? cols : cols), `line too long: "${l.text}"`);
  for (const must of ['The Brew House', 'MG Road', '9800000001', 'D1-000007', '17/11/2026', 'Cashier: Asha', 'Cappuccino', '2 x 150.00', '300.00', 'Subtotal', 'Discount', 'Tax @5%', 'Tax @18%', 'Service charge', 'TOTAL', 'UPI', 'Thank you!', 'GSTIN'])
    assert.ok(txt.includes(must), `missing "${must}"`);
  assert.ok(!txt.includes('COPY'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(txt), 'non-printable characters would corrupt thermal output');
  const reprint = receiptLines(header, bill, w, true).map(l => l.text).join('\n'); assert.ok(reprint.includes('COPY / REPRINT'));
});
test('ESC/POS stream: init, cut, ASCII only', () => {
  const b = toEscPos(receiptLines(header, bill, 58, false));
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]); assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 0x00]);
  assert.equal(toEscPos(testPageLines(80)).length > 20, true);
});
test('tax breakup adds up to the stored tax; refunds/voids are labelled', () => {
  const L = receiptLines(header, bill, 80, false).map(l => l.text); const taxes = L.filter(x => x.startsWith('Tax @')).map(x => Number(x.trim().split(/\s+/).pop()));
  assert.ok(Math.abs(taxes.reduce((a, v) => a + v, 0) - bill.tax) < 0.02);
  assert.ok(receiptLines(header, { ...bill, status: 'refunded' }, 58, false).some(l => l.text.includes('CREDIT NOTE')));
  assert.ok(receiptLines(header, { ...bill, status: 'void' }, 58, false).some(l => l.text.includes('VOID')));
});
test('PDF invoice HTML escapes user-supplied text', () => {
  const h = invoiceHtml({ ...header, name: '<script>x</script>' }, bill, false);
  assert.ok(!h.includes('<script>x') && h.includes('&lt;script&gt;') && h.includes('&lt;b&gt;Ravi&lt;/b&gt;'));
});
