import type { InventoryItem, InventoryItemInput, InventoryUnit } from './types';
import { parseInventoryQuantity } from './inventory';
import { parseCsvRows } from './menuImport';

export type InventoryImportCandidate = { row: number; item: InventoryItemInput; openingQty: number };
export type InventoryImportPreview = { candidates: InventoryImportCandidate[]; duplicates: number; errors: string[] };

export const INVENTORY_CSV_TEMPLATE = 'name,unit,category,pack_size,pack_label,reorder_packs,par_packs,pack_cost,supplier,notes,opening_packs\nCoffee beans,g,Ingredients,1000,bag,2,10,300,ABC Foods,Arabica beans,4';

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
    reorderPacks: col('reorder_packs'), parPacks: col('par_packs'),
    unitCost: col('unit_cost', 'cost'), packCost: col('pack_cost'), supplier: col('supplier'), notes: col('notes'),
    openingQty: col('opening_qty', 'opening_stock', 'on_hand'), openingPacks: col('opening_packs'),
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
      const rawPackSize = value(row, columns.packSize);
      const packSize = rawPackSize ? quantity(rawPackSize, 'pack_size', unit, rowNum) : unit === 'pc' ? 1 : 1000;
      if (packSize <= 0) throw new Error(`Row ${rowNum} (${name}): pack_size must be greater than zero.`);
      const reorderLevel = value(row, columns.reorderPacks)
        ? numberValue(value(row, columns.reorderPacks), 0, 'reorder_packs', rowNum) * packSize
        : value(row, columns.reorderLevel) ? quantity(value(row, columns.reorderLevel), 'reorder_level', unit, rowNum) : 0;
      const parLevel = value(row, columns.parPacks)
        ? numberValue(value(row, columns.parPacks), 0, 'par_packs', rowNum) * packSize
        : value(row, columns.parLevel) ? quantity(value(row, columns.parLevel), 'par_level', unit, rowNum) : 0;
      const rawPackCost = value(row, columns.packCost);
      const rawUnitCost = value(row, columns.unitCost);
      const unitCost = rawPackCost
        ? numberValue(rawPackCost, 0, 'pack_cost', rowNum) / packSize
        : rawUnitCost ? numberValue(rawUnitCost, 0, 'unit_cost', rowNum) : null;
      const openingQty = value(row, columns.openingPacks)
        ? numberValue(value(row, columns.openingPacks), 0, 'opening_packs', rowNum) * packSize
        : value(row, columns.openingQty) ? quantity(value(row, columns.openingQty), 'opening_qty', unit, rowNum) : 0;
      candidates.push({
        row: rowNum,
        item: {
          name, unit, packSize, reorderLevel, parLevel, unitCost,
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
