import type { InventoryItem, InventoryOrder, InventoryUsage } from './types';

export interface ReorderSettings { windowDays: number; leadDays: number; coverDays: number }
export interface ReorderSuggestion {
  item: InventoryItem; avgDailyUse: number; daysLeft: number | null; onOrder: number; suggestedQty: number; needsOrder: boolean;
}

export function computeReorder(items: InventoryItem[], usage: InventoryUsage, orders: InventoryOrder[], settings: ReorderSettings): ReorderSuggestion[] {
  const activeOrders = new Map<string, number>();
  for (const order of orders) if (order.status === 'open') {
    for (const line of order.lines) activeOrders.set(line.inventoryItemId, (activeOrders.get(line.inventoryItemId) || 0) + Math.max(0, line.qtyOrdered - line.qtyReceived));
  }
  const days = Math.max(1, settings.windowDays);
  const suggestions = items.filter(item => item.active).map(item => {
    const stats = usage.byItem.find(row => row.inventoryItemId === item.id);
    const firstMovement = stats?.firstMovementAt ? Date.parse(stats.firstMovementAt) : NaN;
    const rangeEnd = Date.parse(usage.to);
    const elapsedDays = Number.isFinite(firstMovement) && Number.isFinite(rangeEnd) ? Math.ceil(Math.max(0, rangeEnd - firstMovement) / 86400000) + 1 : days;
    const daysObserved = Math.min(days, Math.max(Math.min(3, days), elapsedDays));
    const avgDailyUse = stats ? (Math.max(0, stats.used) + Math.max(0, stats.wasted)) / Math.max(1, daysObserved) : 0;
    const onOrder = activeOrders.get(item.id) || 0;
    const target = Math.max(item.parLevel, avgDailyUse * (settings.leadDays + settings.coverDays));
    const needsOrder = item.onHand <= item.reorderLevel || item.onHand < avgDailyUse * settings.leadDays;
    const raw = needsOrder ? Math.max(0, target - item.onHand - onOrder) : 0;
    const suggestedQty = raw > 0 ? Math.ceil(raw / Math.max(item.packSize, 0.001)) * Math.max(item.packSize, 0.001) : 0;
    return { item, avgDailyUse, daysLeft: avgDailyUse > 0 ? item.onHand / avgDailyUse : null, onOrder, suggestedQty, needsOrder };
  }).filter(x => x.needsOrder && x.suggestedQty > 0);
  const severity = (s: InventoryStatusLike) => s.item.onHand <= 0 ? 0 : s.item.onHand <= s.item.reorderLevel ? 1 : 2;
  return suggestions.sort((a, b) => severity(a) - severity(b) || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.item.name.localeCompare(b.item.name));
}

type InventoryStatusLike = ReorderSuggestion;

export function displayInventoryQuantity(value: number, unit: InventoryItem['unit']): string {
  const abs = Math.abs(value);
  if (unit === 'g' && abs >= 1000) return `${trim(value / 1000)} kg`;
  if (unit === 'ml' && abs >= 1000) return `${trim(value / 1000)} l`;
  return `${trim(value)} ${unit}`;
}

export function parseInventoryQuantity(value: string, unit: InventoryItem['unit']): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|dozen|pcs?|pc)?$/i.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1].replace(',', '.'));
  const suffix = (match[2] || unit).toLowerCase();
  const factors: Record<InventoryItem['unit'], Record<string, number>> = {
    g: { g: 1, kg: 1000 },
    ml: { ml: 1, l: 1000 },
    pc: { pc: 1, pcs: 1, dozen: 12 },
  };
  const factor = factors[unit][suffix];
  if (!Number.isFinite(n) || factor == null) return null;
  return Math.round((n * factor + Number.EPSILON) * 1000) / 1000;
}

function trim(value: number) { return Number(value.toFixed(3)).toString(); }
