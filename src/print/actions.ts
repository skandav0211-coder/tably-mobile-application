import type { Engine } from '../core/engine';
import type { Bill } from '../core/types';
import { invoiceHtml, receiptLines, toEscPos, ReceiptHeader } from '../core/receipt';
import { printBytes } from './printer';
import { sharePdf } from './share';

export function headerOf(eng: Engine): ReceiptHeader {
  const b = eng.me?.business;
  return { name: b?.name || 'Business', address: b?.address || '', contact: b?.contact || '', gstin: b?.gstin || null, footer: b?.receipt_footer || eng.me?.defaults?.receiptFooter || '' };
}
/** A printer failure never deletes the bill and never marks it printed. */
export async function printBill(eng: Engine, bill: Bill, reprint = false): Promise<{ ok: boolean; message: string }> {
  try {
    const cfg = await eng.printer();
    await printBytes(cfg, toEscPos(receiptLines(headerOf(eng), bill, cfg?.paperWidthMm || 58, reprint || bill.printCount > 0)));
    await eng.markPrinted(bill); return { ok: true, message: 'Sent to the printer.' };
  } catch (e: any) { return { ok: false, message: `${e.message} The bill is saved — retry, or share it as a PDF.` }; }
}
export const pdfBill = (eng: Engine, bill: Bill) => sharePdf(invoiceHtml(headerOf(eng), bill, bill.printCount > 0), bill.invoiceNo || 'invoice');
