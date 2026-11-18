import type { BillItem, CartLine, Totals } from './types';

export const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Must stay identical to the backend's recomputation (backend/src/app.js, /api/bills/sync). */
export function calculate(lines: Pick<BillItem, 'qty' | 'price' | 'taxRate'>[], discount = 0, serviceCharge = 0): Totals {
  let sub = 0; let tax = 0; const byRate = new Map<number, number>();
  for (const l of lines) { const line = l.qty * l.price; sub += line; const t = (line * (l.taxRate || 0)) / 100; tax += t; byRate.set(l.taxRate || 0, (byRate.get(l.taxRate || 0) || 0) + t); }
  const disc = Math.min(Math.max(discount || 0, 0), sub);
  const factor = sub > 0 ? (sub - disc) / sub : 0;           // discount reduces the taxable value, pro-rata
  const taxAfter = tax * factor;
  const total = money(sub - disc + taxAfter + serviceCharge);
  return {
    subtotal: money(sub), discount: money(disc), tax: money(taxAfter), serviceCharge: money(serviceCharge), total,
    taxBreakup: [...byRate.entries()].filter(([r, t]) => r > 0 && t > 0).map(([rate, t]) => ({ rate, tax: money(t * factor) })).sort((a, b) => a.rate - b.rate),
  };
}
export const subtotalOf = (lines: Pick<CartLine, 'qty' | 'price'>[]) => lines.reduce((a, l) => a + l.qty * l.price, 0);
export const discountFromPercent = (lines: Pick<CartLine, 'qty' | 'price'>[], pct: number) => money((subtotalOf(lines) * Math.min(Math.max(pct, 0), 100)) / 100);
/** Service charge is a percentage of the discounted subtotal, converted to a flat amount that the server stores. */
export const serviceChargeFor = (lines: Pick<CartLine, 'qty' | 'price'>[], discount: number, pct: number) =>
  money(Math.max(subtotalOf(lines) - Math.min(Math.max(discount, 0), subtotalOf(lines)), 0) * Math.max(pct, 0) / 100);
export const inr = (v: number) => '₹' + (Math.round(v * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
