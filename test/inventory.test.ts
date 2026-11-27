import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReorder, displayInventoryQuantity, parseInventoryQuantity } from '../src/core/inventory';
import { INVENTORY_CSV_TEMPLATE, parseInventoryCsv } from '../src/core/inventoryImport';
import { makeEngine, onboard, approve, startBackend } from './helpers';
import type { InventoryItem, InventoryOrder, InventoryUsage, CartLine } from '../src/core/types';
import { NetworkError } from '../src/core/api';

const item = (patch: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'beans', name: 'Coffee beans', category: null, unit: 'g', packSize: 25, packLabel: 'bag',
  reorderLevel: 50, parLevel: 120, unitCost: null, supplier: 'Roaster', notes: null,
  active: true, onHand: 0, status: 'out', updatedAt: new Date(0).toISOString(), ...patch,
});
const usage: InventoryUsage = {
  from: '2026-11-01T00:00:00.000Z', to: '2026-11-14T23:59:59.999Z',
  byItem: [{ inventoryItemId: 'beans', name: 'Coffee beans', unit: 'g', opening: 0, purchased: 0, purchaseSpend: 0, used: 98, wasted: 0, adjusted: 0, closing: 0, firstMovementAt: '2026-11-01T00:00:00.000Z' }],
  byProduct: [],
};
const openOrder: InventoryOrder = {
  id: 'order-1', outletId: 'outlet-1', supplier: 'Roaster', note: null, status: 'open',
  createdAt: new Date(0).toISOString(), receivedAt: null,
  lines: [{ inventoryItemId: 'beans', name: 'Coffee beans', qtyOrdered: 50, qtyReceived: 0 }],
};

test('reorder suggestions apply cover, lead time, open-order deduction, pack rounding and severity sorting', () => {
  const result = computeReorder([item(), item({ id: 'milk', name: 'Milk', unit: 'ml', onHand: 10, reorderLevel: 0, parLevel: 2, packSize: 1 })], usage, [openOrder], { windowDays: 14, leadDays: 2, coverDays: 3 });
  assert.equal(result[0].item.id, 'beans');
  assert.equal(result[0].avgDailyUse, 7);
  assert.equal(result[0].onOrder, 50);
  assert.equal(result[0].suggestedQty, 75);
  assert.equal(result[0].daysLeft, 0);
  assert.equal(result.some(row => row.item.id === 'milk'), false);
});

test('inventory quantity display and entry conversions preserve base units', () => {
  assert.equal(displayInventoryQuantity(1250, 'g'), '1.25 kg');
  assert.equal(displayInventoryQuantity(1250, 'ml'), '1.25 l');
  assert.equal(displayInventoryQuantity(12, 'pc'), '12 pc');
  assert.equal(parseInventoryQuantity('1.25 kg', 'g'), 1250);
  assert.equal(parseInventoryQuantity('750 ml', 'ml'), 750);
  assert.equal(parseInventoryQuantity('2 dozen', 'pc'), 24);
  assert.equal(parseInventoryQuantity('-2', 'g'), null);
});

test('inventory CSV import converts units and skips existing and repeated item names', () => {
  const parsed = parseInventoryCsv([
    'name,unit,category,pack_size,pack_label,reorder_level,par_level,unit_cost,supplier,notes,opening_qty',
    'Coffee beans,g,Ingredients,1000,bag,0.5 kg,1.25 kg,0.02,Roaster,Arabica,2 kg',
    ' coffee   beans ,g,Other,1000,bag,0,0,,Other,Duplicate,0',
    'Milk,ml,Dairy,1000,carton,500,2 l,0.01,Dairy Co,Whole,750 ml',
    'Milk,ml,Dairy,1000,carton,0,0,,Dairy Co,Repeated,0',
    'Invalid,kg,Other,1000,bag,0,0,,Other,Bad unit,0',
  ].join('\n'), [{ name: 'Existing stock' }]);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.duplicates, 2);
  assert.equal(parsed.candidates[0].item.reorderLevel, 500);
  assert.equal(parsed.candidates[0].item.parLevel, 1250);
  assert.equal(parsed.candidates[0].openingQty, 2000);
  assert.equal(parsed.candidates[1].item.parLevel, 2000);
  assert.equal(parsed.candidates[1].openingQty, 750);
  assert.match(parsed.errors[0], /unit must be g, ml, or pc/);
});

test('inventory CSV template imports custom package sizes, pack thresholds, pack costs, and opening packs', () => {
  const parsed = parseInventoryCsv(INVENTORY_CSV_TEMPLATE, []);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.candidates.length, 1);
  assert.deepEqual(parsed.candidates[0].item, {
    name: 'Coffee beans', unit: 'g', packSize: 1000, reorderLevel: 2000, parLevel: 10000,
    unitCost: 0.3, category: 'Ingredients', packLabel: 'bag', supplier: 'ABC Foods',
    notes: 'Arabica beans',
  });
  assert.equal(parsed.candidates[0].openingQty, 4000);
});

test('cached inventory includes pending offline movements as a visible stock estimate', async () => {
  const rig = makeEngine('https://api.example.test');
  await rig.eng.init();
  await rig.store.kv.set('inventoryItems', JSON.stringify([item({ onHand: 500, status: 'low' })]));
  await rig.store.kv.set('inventoryMovementQueue', JSON.stringify([
    { inventoryItemId: 'beans', type: 'purchase', qty: 1000, clientMoveId: 'purchase-1' },
    { inventoryItemId: 'beans', type: 'wastage', qty: 250, clientMoveId: 'waste-1' },
  ]));
  const api = rig.eng.api;
  const original = api.inventoryItems;
  api.inventoryItems = async () => { throw new NetworkError(); };
  try {
    const cached = await rig.eng.inventoryItems();
    assert.equal(cached[0].onHand, 1250);
    assert.equal(cached[0].status, 'ok');
  } finally { api.inventoryItems = original; }
});

test('inventory APIs, ledger, recipes, bill deduction, orders, offline queue and tenant boundaries work end to end', async () => {
  const backend = await startBackend();
  try {
    const rig = makeEngine(backend.base);
    await rig.eng.init();
    await onboard(backend, rig, 'Inventory Test Cafe');
    await approve(backend, rig, 'UTR-INVENTORY-1');
    await rig.eng.registerDevice('Inventory test device');

    const created = await rig.eng.saveInventoryItem(null, {
      name: 'Coffee beans', unit: 'g', packSize: 1000, packLabel: 'bag', reorderLevel: 250,
      parLevel: 1500, unitCost: 0.3, supplier: 'Roaster',
    }, 5000);
    assert.equal(created.onHand, 5000);
    assert.equal(created.status, 'ok');
    await rig.eng.queueInventoryMovement({ inventoryItemId: created.id, type: 'purchase', qty: 1000, unitCost: 0.3, clientMoveId: 'pack-purchase' });
    const purchaseUsage = await rig.eng.inventoryUsage('0000', '9999');
    assert.equal(purchaseUsage.byItem.find(row => row.inventoryItemId === created.id)?.purchaseSpend, 300);
    await rig.eng.queueInventoryMovement({ inventoryItemId: created.id, type: 'adjustment', qty: 5000, clientMoveId: 'pack-adjustment' });
    await assert.rejects(() => rig.eng.saveInventoryItem(null, { name: 'Coffee beans', unit: 'g' }), /already exists/i);

    const product = (await rig.eng.saveProduct(null, { name: 'Espresso', price: 100, taxRate: 0 })).find(row => row.name === 'Espresso');
    assert.ok(product);
    await rig.eng.saveInventoryRecipe(product.id, [{ inventoryItemId: created.id, qty: 18, variantName: null }]);
    await assert.rejects(() => rig.eng.deleteProduct(product.id), /inventory history/i);
    const disposable = (await rig.eng.saveProduct(null, { name: 'Temporary product', price: 1 })).find(row => row.name === 'Temporary product');
    assert.ok(disposable);
    await rig.eng.deleteProduct(disposable.id);
    assert.equal((await rig.eng.products(true, true)).some(row => row.id === disposable.id), false);
    const cartLine: CartLine = { key: 'espresso', itemId: product.id, productId: product.id, name: 'Espresso', price: 100, qty: 2, taxRate: 0 };
    const bill = await rig.eng.completeBill({ cartId: `inventory-bill-${Date.now()}`, lines: [cartLine], discount: 0, serviceChargePercent: 0, method: 'cash' });
    assert.deepEqual(await rig.store.listPendingLocalSaleUsage(), [{ clientTxnId: bill.clientTxnId, inventoryItemId: created.id, qty: 36 }]);
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 4964);
    assert.equal((await rig.eng.syncBills()).accepted, 1);
    assert.deepEqual(await rig.store.listPendingLocalSaleUsage(), []);
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 4964);
    await rig.eng.syncBills();
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE bill_id=(SELECT id FROM bills WHERE client_txn_id=?) AND type='sale_usage'").get(bill.clientTxnId).n, 1);
    await rig.eng.changeStatus(bill, 'void', 'Incorrect order');
    assert.equal((await rig.eng.syncBills()).accepted, 1);
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 5000);
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE bill_id=(SELECT id FROM bills WHERE client_txn_id=?) AND type='return'").get(bill.clientTxnId).n, 1);

    await rig.eng.saveInventoryRecipe(product.id, [
      { inventoryItemId: created.id, qty: 18, variantName: null },
      { inventoryItemId: created.id, qty: 3, variantName: 'Large' },
      { inventoryItemId: created.id, qty: 2, variantName: 'Oat milk' },
    ]);
    const variantBill = await rig.eng.completeBill({ cartId: `inventory-variant-${Date.now()}`, lines: [{ ...cartLine, key: 'large-oat', variantName: 'Large', addons: ['Oat milk'] }], discount: 0, serviceChargePercent: 0, method: 'cash' });
    assert.equal((await rig.store.listPendingLocalSaleUsage()).find(row => row.clientTxnId === variantBill.clientTxnId)?.qty, 46);
    assert.equal((await rig.eng.syncBills()).accepted, 1);
    const customBill = await rig.eng.completeBill({ cartId: `inventory-custom-${Date.now()}`, lines: [{ ...cartLine, key: 'custom-size', qty: 1, variantName: 'Large', addons: ['Oat milk'], custom: true }], discount: 0, serviceChargePercent: 0, method: 'cash' });
    assert.equal((await rig.store.listPendingLocalSaleUsage()).find(row => row.clientTxnId === customBill.clientTxnId)?.qty, 18);
    assert.equal((await rig.eng.syncBills()).accepted, 1);
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 4936);
    backend.db.exec("CREATE TRIGGER fail_sale_usage BEFORE INSERT ON stock_movements WHEN NEW.type='sale_usage' BEGIN SELECT RAISE(ABORT,'forced inventory failure'); END");
    const failedInventoryBill = await rig.eng.completeBill({ cartId: `inventory-failure-${Date.now()}`, lines: [cartLine], discount: 0, serviceChargePercent: 0, method: 'cash' });
    assert.equal((await rig.eng.syncBills()).accepted, 1);
    assert.ok(backend.db.prepare('SELECT 1 FROM bills WHERE client_txn_id=?').get(failedInventoryBill.clientTxnId));
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM inventory_errors WHERE bill_id=(SELECT id FROM bills WHERE client_txn_id=?)').get(failedInventoryBill.clientTxnId).n, 1);
    backend.db.exec('DROP TRIGGER fail_sale_usage');
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 4936);

    rig.net.offline = true;
    assert.equal(await rig.eng.queueInventoryMovement({ inventoryItemId: created.id, type: 'wastage', qty: 100, reason: 'Expired', clientMoveId: 'offline-loss-1' }), 'queued');
    assert.equal(await rig.eng.inventoryMovementQueueCount(), 1);
    rig.net.offline = false;
    assert.deepEqual(await rig.eng.syncInventoryMovements(), { pending: 0, accepted: 1 });
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 4836);
    assert.equal(backend.db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE client_move_id='offline-loss-1'").get().n, 1);

    const order = await rig.eng.createInventoryOrder({ supplier: 'Roaster', lines: [{ inventoryItemId: created.id, qty: 1000 }] });
    assert.equal(order.status, 'open');
    const received = await rig.eng.receiveInventoryOrder(order.id, [{ inventoryItemId: created.id, qty: 750 }]);
    assert.equal(received.status, 'received');
    assert.equal(received.lines[0].qtyReceived, 750);
    assert.equal((await rig.eng.inventoryItems()).find(row => row.id === created.id)?.onHand, 5586);

    const now = new Date();
    const report = await rig.eng.inventoryUsage(new Date(now.getTime() - 7 * 86400000).toISOString(), new Date(now.getTime() + 86400000).toISOString());
    assert.equal(report.byItem.find(row => row.inventoryItemId === created.id)!.used, 64);
    assert.ok(report.byItem.find(row => row.inventoryItemId === created.id)!.firstMovementAt);
    assert.ok((await rig.eng.inventoryMovements(created.id)).some(row => row.type === 'purchase'));

    await rig.eng.archiveInventoryItem(created.id);
    assert.equal((await rig.eng.inventoryItems()).some(row => row.id === created.id), false);
    assert.equal((await rig.eng.inventoryItems(true)).find(row => row.id === created.id)?.active, false);
    await rig.eng.restoreInventoryItem(created.id);

    const other = makeEngine(backend.base);
    await other.eng.init();
    await onboard(backend, other, 'Different Inventory Tenant');
    await approve(backend, other, 'UTR-INVENTORY-2');
    await other.eng.registerDevice('Other tenant device');
    assert.deepEqual(await other.eng.inventoryItems(), []);
    await assert.rejects(() => other.eng.api.updateInventoryItem(created.id, { name: 'Stolen item' }), /not found/i);
  } finally { backend.close(); }
});
