import * as XLSX from '@e965/xlsx';
import type { Variant } from './types';

export interface ImportedMenuProduct {
  name: string;
  category: string | null;
  sku: string | null;
  price: number;
  taxRate: number;
  variants: Variant[];
}

export interface MenuImportResult {
  products: ImportedMenuProduct[];
  errors: string[];
}

export const MENU_CSV_TEMPLATE = 'Item,Category,SKU,Price,Size,Tax\n';

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseXlsxRows(base64: string): unknown[][] {
  const workbook = XLSX.read(base64, { type: 'base64', cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The workbook does not contain a worksheet.');
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: '' }) as unknown[][];
}

export function parseMenuRows(input: unknown[][]): MenuImportResult {
  if (!input.length) return { products: [], errors: ['The file is empty.'] };
  const header = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const headers = input[0].map(header);
  const column = (...names: string[]) => headers.findIndex(h => names.includes(h));
  const nameCol = column('item', 'base item', 'item name', 'product', 'product name', 'name');
  const priceCol = column('price', 'price inr', 'selling price');
  if (nameCol < 0 || priceCol < 0) return { products: [], errors: ['Required columns: Item (or Name) and Price.'] };
  const categoryCol = column('category');
  const skuCol = column('sku', 'code', 'item code');
  const sizeCol = column('size', 'variant', 'size variant');
  const taxCol = column('tax', 'tax rate', 'tax percent', 'gst', 'gst percent');
  const groups = new Map<string, { name: string; category: string | null; sku: string | null; taxRate: number; basePrices: number[]; sizes: Map<string, { name: string; price: number }> }>();
  const errors: string[] = [];
  const invalidGroups = new Set<string>();

  for (let rowIndex = 1; rowIndex < input.length; rowIndex++) {
    const row = input[rowIndex];
    const name = String(row[nameCol] ?? '').trim();
    if (!name) { errors.push(`Row ${rowIndex + 1}: item name is missing.`); continue; }
    const rawPrice = row[priceCol];
    const price = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice ?? '').trim().replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(price) || price < 0) { errors.push(`Row ${rowIndex + 1} (${name}): price must be a non-negative number.`); continue; }
    const category = categoryCol < 0 ? null : String(row[categoryCol] ?? '').trim() || null;
    const sku = skuCol < 0 ? null : String(row[skuCol] ?? '').trim() || null;
    const rawTax = taxCol < 0 || row[taxCol] === '' ? 0 : Number(String(row[taxCol]).replace(/%/g, '').trim());
    if (!Number.isFinite(rawTax) || rawTax < 0 || rawTax > 100) { errors.push(`Row ${rowIndex + 1} (${name}): tax must be between 0 and 100.`); continue; }
    const size = sizeCol < 0 ? '' : String(row[sizeCol] ?? '').trim();
    const key = `${normalize(name)}\u0000${normalize(category || '')}`;
    if (invalidGroups.has(key)) continue;
    let group = groups.get(key);
    if (!group) {
      group = { name, category, sku, taxRate: rawTax, basePrices: [], sizes: new Map() };
      groups.set(key, group);
    } else if (group.sku && sku && normalize(group.sku) !== normalize(sku)) {
      errors.push(`${name}: conflicting SKU values were supplied; this item was excluded.`);
      groups.delete(key); invalidGroups.add(key);
      continue;
    } else if (group.taxRate !== rawTax) {
      errors.push(`${name}: conflicting tax rates were supplied; this item was excluded.`);
      groups.delete(key); invalidGroups.add(key);
      continue;
    } else if (!group.sku && sku) group.sku = sku;

    if (size) {
      const sizeKey = normalize(size);
      const existing = group.sizes.get(sizeKey);
      if (existing && existing.price !== price) {
        errors.push(`${name} (${size}): duplicate size rows have different prices; this item was excluded.`);
        groups.delete(key); invalidGroups.add(key);
        continue;
      }
      group.sizes.set(sizeKey, { name: size, price });
    } else {
      group.basePrices.push(price);
      if (new Set(group.basePrices).size > 1) {
        errors.push(`${name}: duplicate base-item rows have different prices; this item was excluded.`);
        groups.delete(key); invalidGroups.add(key);
      }
    }
  }

  let products = [...groups.values()].map(group => {
    const sizePrices = [...group.sizes.values()].map(size => size.price);
    const price = roundMoney(group.basePrices[0] ?? Math.min(...sizePrices));
    const variants = [...group.sizes.values()].map(size => ({
      name: size.name, priceDelta: roundMoney(size.price - price), kind: 'variant' as const,
    }));
    return { name: group.name, category: group.category, sku: group.sku, price, taxRate: group.taxRate, variants };
  });
  const skuGroups = new Map<string, ImportedMenuProduct[]>();
  for (const product of products) {
    if (!product.sku) continue;
    const key = normalize(product.sku);
    skuGroups.set(key, [...(skuGroups.get(key) || []), product]);
  }
  const duplicateSkus = new Set([...skuGroups].filter(([, matches]) => matches.length > 1).map(([sku]) => sku));
  if (duplicateSkus.size) {
    for (const sku of duplicateSkus) errors.push(`SKU ${skuGroups.get(sku)![0].sku}: used by multiple item groups; those items were excluded.`);
    products = products.filter(product => !product.sku || !duplicateSkus.has(normalize(product.sku)));
  }
  if (!products.length && !errors.length) errors.push('No menu items were found in the file.');
  return { products, errors };
}
