import type { InventoryItem, InventoryItemInput, InventoryUnit } from './types';
import { parseInventoryQuantity } from './inventory';
import { parseCsvRows } from './menuImport';

export type InventoryImportCandidate = { row: number; item: InventoryItemInput; openingQty: number };
export type InventoryImportPreview = { candidates: InventoryImportCandidate[]; duplicates: number; errors: string[] };

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const quantity = (raw: string, label: string, unit: InventoryUnit, row: number) => {
  const parsed = parseInventoryQuantity(raw, unit);
  if (parsed == null || parsed > 1e9) throw new Error(`Row ${row}: ${label} must be a valid quantity in ${unit === 'g' ? 'g or kg' : unit === 'ml' ? 'ml or l' : 'pc or dozen'}.`);
  return parsed;
};

export function parseInventoryCsv(text: string, existing: Pick<InventoryItem, 'name'>[]): InventoryImportPreview {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const headers = rows[0].map(normalizeHeader);
  const col = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const nameCol = col('name', 'item', 'item_name', 'inventory_item');
  const unitCol = col('unit', 'base_unit');
  if (nameCol < 0 || unitCol < 0) throw new Error('Required CSV columns: name and unit (g, ml, or pc).');
  const columns = {
    category: col('category'), packSize: col('pack_size'), packLabel: col('pack_label'),
    reorderLevel: col('reorder_level', 'reorder'), parLevel: col('par_level', 'par'),
    unitCost: col('unit_cost', 'cost'), supplier: col('supplier'), notes: col('notes'),
    openingQty: col('opening_qty', 'opening_stock', 'on_hand'),
  };
  const names = new Set(existing.map(item => normalizeName(item.name)));
  const candidates: InventoryImportCandidate[] = [];
  const errors: string[] = [];
  let duplicates = 0;
  const value = (row: string[], index: number) => index < 0 ? '' : (row[index] || '').trim();
  const numberValue = (raw: string, fallback: number, label: string, rowNum: number) => {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e9) throw new Error(`Row ${rowNum}: ${label} must be a non-negative number.`);
    return parsed;
  };
  for (let index = 1; index < rows.length; index++) {
    const rowNum = index + 1;
    const row = rows[index];
    const name = value(row, nameCol);
    if (!name) { errors.push(`Row ${rowNum}: name is required.`); continue; }
    const key = normalizeName(name);
    if (names.has(key)) { duplicates++; continue; }
    try {
      const rawUnit = value(row, unitCol).toLowerCase();
      if (!['g', 'ml', 'pc'].includes(rawUnit)) throw new Error(`Row ${rowNum} (${name}): unit must be g, ml, or pc.`);
      const unit = rawUnit as InventoryUnit;
      const packSize = numberValue(value(row, columns.packSize), unit === 'pc' ? 1 : 1000, 'pack_size', rowNum);
      if (packSize <= 0) throw new Error(`Row ${rowNum} (${name}): pack_size must be greater than zero.`);
      const reorderLevel = value(row, columns.reorderLevel) ? quantity(value(row, columns.reorderLevel), 'reorder_level', unit, rowNum) : 0;
      const parLevel = value(row, columns.parLevel) ? quantity(value(row, columns.parLevel), 'par_level', unit, rowNum) : 0;
      const rawCost = value(row, columns.unitCost);
      const unitCost = numberValue(rawCost, 0, 'unit_cost', rowNum);
      const openingQty = value(row, columns.openingQty) ? quantity(value(row, columns.openingQty), 'opening_qty', unit, rowNum) : 0;
      candidates.push({
        row: rowNum,
        item: {
          name, unit, packSize, reorderLevel, parLevel, unitCost: rawCost ? unitCost : null,
          category: value(row, columns.category) || null, packLabel: value(row, columns.packLabel) || null,
          supplier: value(row, columns.supplier) || null, notes: value(row, columns.notes) || null,
        },
        openingQty,
      });
      names.add(key);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { candidates, duplicates, errors };
}
