import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { computeReorder, displayInventoryQuantity, parseInventoryQuantity } from '../core/inventory';
import type { InventoryItem, InventoryItemInput, InventoryMovementInput, InventoryOrder, InventorySettings, InventoryUsage, InventoryUnit, RecipeLine, Product } from '../core/types';
import { Banner, Btn, Card, Chip, Divider, Empty, F, Header, H2, Input, Pill, Row, Screen, Sheet, Txt, useLayout, useTheme } from '../ui/kit';
import { inr } from '../core/calc';
import { shareCsv } from '../print/share';

type ViewMode = 'list' | 'detail' | 'usage' | 'orders';
type Filter = 'all' | 'low' | 'out' | 'archived';
type DraftItem = { name: string; category: string; unit: InventoryUnit; packSize: string; packLabel: string; reorderLevel: string; parLevel: string; unitCost: string; supplier: string; notes: string; openingQty: string };
const emptyDraft: DraftItem = { name: '', category: '', unit: 'g', packSize: '1000', packLabel: 'bag', reorderLevel: '0', parLevel: '0', unitCost: '', supplier: '', notes: '', openingQty: '0' };
const nowRange = (days: number) => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
};
const rangeFromDates = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end
    || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to) throw new Error('Enter a valid date range using YYYY-MM-DD.');
  return { from: start.toISOString(), to: end.toISOString() };
};
const quantity = (value: string, label: string) => {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e9) throw new Error(`${label} must be a valid non-negative number.`);
  return parsed;
};
const quantityIn = (value: string, label: string, unit: InventoryUnit) => {
  const parsed = parseInventoryQuantity(value, unit);
  if (parsed == null || parsed > 1e9) throw new Error(`${label} must be a valid quantity in ${unit === 'g' ? 'g or kg' : unit === 'ml' ? 'ml or l' : 'pc or dozen'}.`);
  return parsed;
};

function ActionIcon({ name, label, onPress }: { name: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={name} size={22} color={t.pri} /></Pressable>;
}

export function InventoryScreen() {
  const { eng, back, toast, canBill, me, uuid } = useApp();
  const t = useTheme();
  const L = useLayout();
  const [mode, setMode] = useState<ViewMode>('list');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortLowFirst, setSortLowFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [queuedMoves, setQueuedMoves] = useState(0);
  const [form, setForm] = useState<DraftItem>(emptyDraft);
  const [itemSheet, setItemSheet] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [movement, setMovement] = useState<InventoryMovementInput['type'] | null>(null);
  const [moveQty, setMoveQty] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [moveNote, setMoveNote] = useState('');
  const [moveCost, setMoveCost] = useState('');
  const [activeDetailTab, setActiveDetailTab] = useState<'activity' | 'used'>('activity');
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof eng.inventoryMovements>>>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof eng.products>>>([]);
  const [recipes, setRecipes] = useState<Record<string, { inventoryItemId: string; qty: number; variantName: string | null }[]>>({});
  const [recipePicker, setRecipePicker] = useState(false);
  const [recipeQuery, setRecipeQuery] = useState('');
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeLine[]>([]);
  const [usage, setUsage] = useState<InventoryUsage | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [orders, setOrders] = useState<InventoryOrder[]>([]);
  const [settings, setSettings] = useState<InventorySettings>({ windowDays: 14, leadDays: 2, coverDays: 3 });
  const [settingsSheet, setSettingsSheet] = useState(false);
  const [orderQty, setOrderQty] = useState<Record<string, string>>({});
  const [orderChecked, setOrderChecked] = useState<Record<string, boolean>>({});
  const [receiving, setReceiving] = useState<InventoryOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [usageRange, setUsageRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const todayText = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(todayText);
  const [customTo, setCustomTo] = useState(todayText);

  const loadItems = useCallback(async () => {
    setBusy(true);
    try {
      const pending = await eng.inventoryMovementQueueCount();
      if (pending) {
        try {
          const replay = await eng.syncInventoryMovements();
          setOffline(replay.pending > 0);
          setQueuedMoves(replay.pending);
          if (replay.accepted) toast(`${replay.accepted} queued stock change(s) synced.`, 'ok');
        } catch (error) {
          setOffline(true);
          toast(error instanceof Error ? error.message : String(error), 'warn');
        }
      }
      setItems(await eng.inventoryItems(true));
      setOffline(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'bad');
    } finally { setBusy(false); }
  }, [eng, toast]);
  const refreshQueueCount = useCallback(() => eng.inventoryMovementQueueCount().then(setQueuedMoves), [eng]);
  useEffect(() => { void loadItems(); void refreshQueueCount(); }, [loadItems, refreshQueueCount]);

  const visible = useMemo(() => items.filter(item => {
    const matchesFilter = filter === 'archived' ? !item.active : item.active && (filter === 'all' || item.status === filter);
    return matchesFilter && (!query || `${item.name} ${item.category || ''} ${item.supplier || ''}`.toLowerCase().includes(query.toLowerCase()));
  }).sort((a, b) => sortLowFirst ? (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'out' ? -1 : b.status === 'out' ? 1 : a.status === 'low' ? -1 : 1) : a.name.localeCompare(b.name)), [items, filter, query, sortLowFirst]);
  const lowCount = items.filter(item => item.active && item.status !== 'ok').length;
  const chosen = selected ? items.find(item => item.id === selected.id) || selected : null;

  async function openItem(item: InventoryItem) {
    setSelected(item); setMode('detail'); setActiveDetailTab('activity');
    try {
      const [rows, p, r] = await Promise.all([eng.inventoryMovements(item.id), eng.products(), eng.inventoryRecipes()]);
      setActivity(rows); setProducts(p); setRecipes(r);
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  function startCreate() { setEditItem(null); setForm(emptyDraft); setItemSheet(true); }
  function startEdit(item: InventoryItem) {
    setEditItem(item);
    setForm({ name: item.name, category: item.category || '', unit: item.unit, packSize: String(item.packSize), packLabel: item.packLabel || '', reorderLevel: String(item.reorderLevel), parLevel: String(item.parLevel), unitCost: item.unitCost == null ? '' : String(item.unitCost), supplier: item.supplier || '', notes: item.notes || '', openingQty: '0' });
    setItemSheet(true);
  }
  async function saveItem() {
    try {
      if (!form.name.trim()) throw new Error('Enter an item name.');
      const packSize = Number(form.packSize);
      if (!Number.isFinite(packSize) || packSize <= 0) throw new Error('Pack size must be greater than zero.');
      const data: InventoryItemInput = {
        name: form.name.trim(), unit: form.unit, packSize, packLabel: form.packLabel.trim() || null,
        category: form.category.trim() || null, reorderLevel: quantityIn(form.reorderLevel, 'Reorder level', form.unit),
        parLevel: quantityIn(form.parLevel, 'Par level', form.unit), unitCost: form.unitCost.trim() ? quantity(form.unitCost, 'Unit cost') : null,
        supplier: form.supplier.trim() || null, notes: form.notes.trim() || null,
      };
      const saved = await eng.saveInventoryItem(editItem?.id || null, data, editItem ? undefined : quantityIn(form.openingQty || '0', 'Opening stock', form.unit));
      setItems(old => old.some(item => item.id === saved.id) ? old.map(item => item.id === saved.id ? saved : item) : [...old, saved]);
      setItemSheet(false); toast(editItem ? 'Inventory item updated.' : 'Inventory item added.', 'ok');
      setSelected(saved);
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  function openMovement(type: InventoryMovementInput['type']) {
    setMovement(type); setMoveQty(''); setMoveReason(type === 'purchase' ? 'Delivery' : ''); setMoveNote(''); setMoveCost('');
  }
  async function saveMovement() {
    if (!chosen || !movement) return;
    try {
      const qty = quantityIn(moveQty, 'Quantity', chosen.unit);
      if (movement !== 'adjustment' && qty <= 0) throw new Error('Quantity must be greater than zero.');
      const result = await eng.queueInventoryMovement({
        inventoryItemId: chosen.id, type: movement, qty,
        reason: moveReason.trim() || undefined, note: moveNote.trim() || undefined,
        unitCost: movement === 'purchase' && moveCost.trim() ? quantity(moveCost, 'Unit cost') : undefined,
        clientMoveId: uuid(),
      });
      setMovement(null);
      await loadItems(); await refreshQueueCount();
      if (result === 'queued') { setOffline(true); toast('Connection interrupted. Movement saved on this device and will retry when you sync.', 'warn'); }
      else toast('Stock movement saved.', 'ok');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function archiveOrRestore(item: InventoryItem) {
    const action = item.active ? eng.archiveInventoryItem(item.id) : eng.restoreInventoryItem(item.id);
    try { const saved = await action; setItems(old => old.map(row => row.id === saved.id ? saved : row)); setSelected(saved); toast(item.active ? 'Item archived.' : 'Item restored.', 'ok'); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  function editRecipe(product: Product) {
    setRecipePicker(false);
    setRecipeQuery('');
    setRecipeProduct(product);
    setRecipeDraft((recipes[product.id] || []).map(line => ({ ...line })));
  }
  async function saveRecipe() {
    if (!recipeProduct) return;
    try {
      const lines = recipeDraft.map(line => ({ ...line, variantName: line.variantName?.trim() || null }));
      if (lines.some(line => !line.inventoryItemId || !Number.isFinite(line.qty) || line.qty <= 0)) throw new Error('Choose an ingredient and enter a quantity greater than zero for every recipe row.');
      const saved = await eng.saveInventoryRecipe(recipeProduct.id, lines);
      setRecipes(current => ({ ...current, [recipeProduct.id]: saved }));
      setRecipeProduct(null);
      toast('Recipe saved. Future synced sales will use these quantities.', 'ok');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function loadUsage(days = usageDays, custom?: { from: string; to: string }) {
    let range: { from: string; to: string };
    try { range = custom || nowRange(days); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); return; }
    try { setUsage(await eng.inventoryUsage(range.from, range.to)); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function openUsage() {
    setMode('usage');
    if (usageRange === 'custom') {
      try { await loadUsage(usageDays, rangeFromDates(customFrom, customTo)); }
      catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
      return;
    }
    const days = usageRange === 'today' ? 1 : usageRange === '7d' ? 7 : 30;
    setUsageDays(days);
    await loadUsage(days);
  }
  async function openOrders() {
    setMode('orders');
    try {
      const [allOrders, s] = await Promise.all([eng.inventoryOrders('all'), eng.inventorySettings()]);
        const range = nowRange(s.windowDays);
        const u = await eng.inventoryUsage(range.from, range.to);
        setOrders(allOrders); setSettings(s); setUsage(u); setUsageDays(s.windowDays);
      const rec = computeReorder(items, u, allOrders, s);
      setOrderQty(Object.fromEntries(rec.map(row => [row.item.id, String(row.suggestedQty)])));
      setOrderChecked(Object.fromEntries(rec.map(row => [row.item.id, true])));
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  const reorder = useMemo(() => usage ? computeReorder(items, usage, orders, settings) : [], [items, usage, orders, settings]);
  async function markOrdered() {
    const selectedRows = reorder.filter(row => orderChecked[row.item.id]);
    const groups = new Map<string, typeof selectedRows>();
    for (const row of selectedRows) {
      const key = row.item.supplier || '';
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    if (!groups.size) { toast('Select at least one item to order.', 'warn'); return; }
    const ordersToCreate = [...groups].map(([supplier, rows]) => ({
      supplier: supplier || undefined,
      lines: rows.map(row => ({ inventoryItemId: row.item.id, qty: Number(orderQty[row.item.id] || 0) })).filter(line => Number.isFinite(line.qty) && line.qty > 0),
    })).filter(order => order.lines.length);
    try {
      if (!ordersToCreate.length) { toast('Enter a quantity greater than zero for at least one selected item.', 'warn'); return; }
      for (const order of ordersToCreate) await eng.createInventoryOrder(order);
      setOrders(await eng.inventoryOrders('all')); toast(`Created ${ordersToCreate.length} supplier order(s). On-order stock is excluded from new suggestions.`, 'ok');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  function selectedOrderText() {
    return reorder.filter(row => orderChecked[row.item.id]).map(row => `${row.item.name}: ${orderQty[row.item.id] || row.suggestedQty} ${row.item.unit}${row.item.supplier ? ` (${row.item.supplier})` : ''}`).join('\n');
  }
  async function shareOrderList() {
    const message = selectedOrderText();
    if (!message) { toast('Select at least one item to share.', 'warn'); return; }
    try { await Share.share({ message }); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function copyOrderList() {
    const message = selectedOrderText();
    if (!message) { toast('Select at least one item to copy.', 'warn'); return; }
    try { await Clipboard.setStringAsync(message); toast('Order list copied.', 'ok'); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function receiveOrder(order: InventoryOrder) {
    setReceiving(order);
    setReceiveQty(Object.fromEntries(order.lines.map(line => [line.inventoryItemId, String(Math.max(0, line.qtyOrdered - line.qtyReceived))])));
  }
  async function submitReceive() {
    if (!receiving) return;
    const lines = receiving.lines.map(line => ({ inventoryItemId: line.inventoryItemId, qty: Number(receiveQty[line.inventoryItemId] || 0) })).filter(line => Number.isFinite(line.qty) && line.qty > 0);
    if (!lines.length) { toast('Enter received quantities before saving.', 'warn'); return; }
    try {
      await eng.receiveInventoryOrder(receiving.id, lines); setReceiving(null);
      setOrders(await eng.inventoryOrders('all')); await loadItems(); toast('Order received and stock updated.', 'ok');
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  async function saveSettings() {
    try {
      const next = { windowDays: settings.windowDays, leadDays: settings.leadDays, coverDays: settings.coverDays };
      if (Object.values(next).some(value => !Number.isInteger(value) || value < 0 || value > 365) || next.windowDays < 1) throw new Error('Look-back must be 1–365 days; lead and cover times must be 0–365 days.');
      const saved = await eng.saveInventorySettings(next); setSettings(saved); setSettingsSheet(false); await openOrders();
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
  }
  const backToList = () => { setSelected(null); setMode('list'); void loadItems(); };
  const statusTone = (item: InventoryItem) => item.status === 'out' ? 'bad' : item.status === 'low' ? 'warn' : 'ok';
  const rightActions = <Row style={{ gap: 0 }}>
    <ActionIcon name="stats-chart-outline" label="Usage report" onPress={() => void openUsage()} />
    <View style={{ position: 'relative' }}><ActionIcon name="cart-outline" label={`To order, ${lowCount} low or out`} onPress={() => void openOrders()} />{lowCount ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: t.bad, alignItems: 'center', justifyContent: 'center' }}><Txt small bold style={{ color: '#fff', fontSize: 10, lineHeight: 14 }}>{lowCount > 9 ? '9+' : lowCount}</Txt></View> : null}</View>
    <ActionIcon name="add" label="Add inventory item" onPress={startCreate} />
  </Row>;

  if (mode === 'detail' && chosen) return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Header title="Item details" onBack={backToList} right={<ActionIcon name="create-outline" label="Edit item" onPress={() => startEdit(chosen)} />} />
      <Screen max={760}>
        <Card>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 3 }}><H2>{chosen.name}</H2><Txt small mut>{chosen.category || 'Uncategorized'} · {chosen.supplier || 'No supplier'}</Txt></View><Pill text={chosen.status.toUpperCase()} tone={statusTone(chosen)} /></Row>
          <Txt style={{ fontFamily: F.head, fontSize: 30 }}>{displayInventoryQuantity(chosen.onHand, chosen.unit)}</Txt>
          {chosen.onHand < 0 ? <Txt small tone="warn">Stock is below zero. Check your physical count.</Txt> : null}
          <View style={{ height: 7, borderRadius: 99, backgroundColor: t.line, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, chosen.parLevel > 0 ? Math.max(0, chosen.onHand / chosen.parLevel * 100) : chosen.onHand > 0 ? 100 : 0)}%`, height: '100%', backgroundColor: t.pri }} /></View>
          <Txt small mut>Reorder at {displayInventoryQuantity(chosen.reorderLevel, chosen.unit)} · Par {displayInventoryQuantity(chosen.parLevel, chosen.unit)}</Txt>
        </Card>
        <Row style={{ flexWrap: 'wrap' }}>{[
          ['add-circle-outline', 'Stock in', () => openMovement('purchase')],
          ['remove-circle-outline', 'Wastage', () => openMovement('wastage')],
          ['calculator-outline', 'Count', () => openMovement('adjustment')],
        ].map(([icon, label, callback]) => <View key={String(label)} style={{ flex: 1, minWidth: 92 }}><Btn kind="sec" small title={String(label)} onPress={callback as () => void} /></View>)}</Row>
        <Row style={{ flexWrap: 'wrap' }}><Chip text="Activity" on={activeDetailTab === 'activity'} onPress={() => setActiveDetailTab('activity')} /><Chip text="Used in" on={activeDetailTab === 'used'} onPress={() => setActiveDetailTab('used')} /></Row>
        {activeDetailTab === 'activity' ? activity.length ? activity.map(row => <Card key={row.id}><Row style={{ justifyContent: 'space-between' }}><Txt bold>{row.type.replace('_', ' ')}</Txt><Txt bold tone={row.qtyDelta < 0 ? 'bad' : 'ok'}>{row.qtyDelta > 0 ? '+' : ''}{displayInventoryQuantity(row.qtyDelta, chosen.unit)}</Txt></Row><Txt small mut>{new Date(row.createdAt).toLocaleString()} · Balance {displayInventoryQuantity(row.balanceAfter, chosen.unit)}</Txt>{row.reason ? <Txt small>{row.reason}</Txt> : null}{row.note ? <Txt small mut>{row.note}</Txt> : null}</Card>) : <Empty text="No stock activity yet. Stock in, record wastage, or enter a count to begin the ledger." />
          : <View style={{ gap: 8 }}>
            <Btn kind="sec" small title="Link a menu item to ingredients" onPress={() => setRecipePicker(true)} disabled={!products.some(product => product.active) || !canBill} />
            {products.filter(product => (recipes[product.id] || []).some(line => line.inventoryItemId === chosen.id)).map(product => <Card key={product.id}>
              <Row style={{ justifyContent: 'space-between' }}><Txt bold style={{ flex: 1 }}>{product.name}</Txt><Pressable onPress={() => editRecipe(product)}><Txt small bold tone="info">Edit recipe</Txt></Pressable></Row>
              {recipes[product.id].filter(line => line.inventoryItemId === chosen.id).map((line, index) => <Txt small mut key={`${product.id}-${index}`}>{line.variantName || 'Base'} · {displayInventoryQuantity(line.qty, chosen.unit)} per serving</Txt>)}
            </Card>)}
            {!products.some(product => (recipes[product.id] || []).some(line => line.inventoryItemId === chosen.id)) ? <Empty text="No menu item uses this ingredient yet. Link a menu item and enter its base quantity." /> : null}
          </View>}
        <Btn kind="sec" title={chosen.active ? 'Archive item' : 'Restore item'} onPress={() => Alert.alert(chosen.active ? 'Archive item?' : 'Restore item?', chosen.active ? `${chosen.name} will no longer appear in active inventory. Its history will be kept.` : `${chosen.name} will return to active inventory.`, [{ text: 'Cancel', style: 'cancel' }, { text: chosen.active ? 'Archive' : 'Restore', onPress: () => void archiveOrRestore(chosen) }])} disabled={!canBill} />
      </Screen>
      <Sheet visible={!!movement} onClose={() => setMovement(null)} title={movement === 'purchase' ? 'Stock in' : movement === 'wastage' ? 'Record wastage' : movement === 'adjustment' ? 'Physical count' : 'Opening stock'}>
        {movement === 'adjustment' ? <Banner>Enter the quantity physically counted. Tably records the difference as an adjustment.</Banner> : null}
        <Input label={movement === 'adjustment' ? `Counted quantity (${chosen.unit}${chosen.unit === 'g' ? ' / kg' : chosen.unit === 'ml' ? ' / l' : ' / dozen'})` : `Quantity (${chosen.unit}${chosen.unit === 'g' ? ' / kg' : chosen.unit === 'ml' ? ' / l' : ' / dozen'})`} value={moveQty} onChangeText={setMoveQty} keyboardType="decimal-pad" placeholder="0" />
        {movement === 'purchase' ? <Input label="Cost per base unit (optional)" value={moveCost} onChangeText={setMoveCost} keyboardType="decimal-pad" placeholder="₹" /> : null}
        <Input label={movement === 'wastage' ? 'Reason' : 'Reason (optional)'} value={moveReason} onChangeText={setMoveReason} placeholder={movement === 'wastage' ? 'Expired, damaged…' : 'e.g. delivery'} />
        <Input label="Note (optional)" value={moveNote} onChangeText={setMoveNote} placeholder="Add a note" multiline />
        <Btn title="Save movement" onPress={() => void saveMovement()} />
      </Sheet>
      <Sheet visible={recipePicker} onClose={() => setRecipePicker(false)} title="Choose a menu item">
        <Input label="Search menu" value={recipeQuery} onChangeText={setRecipeQuery} placeholder="Search by item name" autoCapitalize="none" />
        {products.filter(product => product.active && product.name.toLowerCase().includes(recipeQuery.trim().toLowerCase())).map(product => (
          <Card key={product.id} onPress={() => editRecipe(product)}>
            <Txt bold>{product.name}</Txt>
            <Txt small mut>{(recipes[product.id] || []).length ? 'Edit existing recipe' : 'No recipe yet'}</Txt>
          </Card>
        ))}
        {!products.some(product => product.active && product.name.toLowerCase().includes(recipeQuery.trim().toLowerCase())) ? <Empty text={products.some(product => product.active) ? 'No menu items match your search.' : 'Add an active menu item before linking a recipe.'} /> : null}
      </Sheet>
      <Sheet visible={!!recipeProduct} onClose={() => setRecipeProduct(null)} title={`Recipe · ${recipeProduct?.name || ''}`}>
        <Txt small mut>Each row is a base amount. Enter a size or add-on name for extra quantity; leave it blank for the base recipe.</Txt>
        {recipeDraft.map((line, index) => <Card key={`${recipeProduct?.id}-${index}`}>
          <Txt small bold>Ingredient {index + 1}</Txt>
          <View style={{ gap: 6 }}>{items.filter(item => item.active).map(item => <Chip key={item.id} text={`${item.name} (${item.unit})`} on={line.inventoryItemId === item.id} onPress={() => setRecipeDraft(old => old.map((row, i) => i === index ? { ...row, inventoryItemId: item.id } : row))} />)}</View>
          <Input label="Quantity per serving (base units)" value={String(line.qty || '')} onChangeText={value => setRecipeDraft(old => old.map((row, i) => i === index ? { ...row, qty: Number(value) } : row))} keyboardType="decimal-pad" />
          <Txt small bold>Applies to</Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip text="Base (all sizes)" on={!line.variantName} onPress={() => setRecipeDraft(old => old.map((row, i) => i === index ? { ...row, variantName: null } : row))} />
            {(recipeProduct?.variants || []).map(option => <Chip key={option.name} text={option.name} on={line.variantName === option.name} onPress={() => setRecipeDraft(old => old.map((row, i) => i === index ? { ...row, variantName: option.name } : row))} />)}
          </Row>
          <Btn kind="bad" small title="Remove ingredient" onPress={() => setRecipeDraft(old => old.filter((_, i) => i !== index))} />
        </Card>)}
        <Btn kind="sec" title="＋ Add ingredient" onPress={() => {
          const first = items.find(item => item.active);
          if (!first) { toast('Add an active inventory item before creating a recipe.', 'warn'); return; }
          setRecipeDraft(old => [...old, { inventoryItemId: first.id, qty: 0, variantName: null }]);
        }} disabled={recipeDraft.length >= 40 || !canBill} />
        <Btn title="Save recipe" onPress={() => void saveRecipe()} disabled={!canBill} />
      </Sheet>
    </View>
  );

  if (mode === 'usage') return (
    <View style={{ flex: 1, backgroundColor: t.bg }}><Header title="Inventory usage" onBack={backToList} />
      <Screen max={760}>
        <Row style={{ flexWrap: 'wrap' }}>{([['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Custom']] as const).map(([key, label]) => <Chip key={key} text={label} on={usageRange === key} onPress={() => {
          setUsageRange(key);
          if (key !== 'custom') { const days = key === 'today' ? 1 : key === '7d' ? 7 : 30; setUsageDays(days); void loadUsage(days); }
        }} />)}</Row>
        {usageRange === 'custom' ? <>
          <Row><View style={{ flex: 1 }}><Input label="From (YYYY-MM-DD)" value={customFrom} onChangeText={setCustomFrom} placeholder="2026-01-31" /></View><View style={{ flex: 1 }}><Input label="To (YYYY-MM-DD)" value={customTo} onChangeText={setCustomTo} placeholder="2026-01-31" /></View></Row>
          <Btn kind="sec" small title="Apply date range" onPress={() => {
            try { void loadUsage(usageDays, rangeFromDates(customFrom, customTo)); }
            catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
          }} />
        </> : null}
        {usage ? <>
          <H2>By ingredient</H2>
          <Btn kind="sec" small title="Export usage CSV" onPress={() => {
            const cell = (value: unknown) => {
              const text = String(value ?? '');
              const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
              return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
            };
            const csv = ['item,unit,opening,purchased,used,wasted,adjusted,closing', ...usage.byItem.map(row => [row.name, row.unit, row.opening, row.purchased, row.used, row.wasted, row.adjusted, row.closing].map(cell).join(','))].join('\n');
            shareCsv(csv, 'tably-inventory-usage.csv').catch(error => toast(error.message, 'bad'));
          }} />
          {usage.byItem.length ? usage.byItem.map(row => <Card key={row.inventoryItemId}>
            <Row style={{ justifyContent: 'space-between' }}><Txt bold style={{ flex: 1 }}>{row.name}</Txt><Txt bold>{displayInventoryQuantity(row.used, row.unit)} used</Txt></Row>
            <Txt small mut>Opening {displayInventoryQuantity(row.opening, row.unit)} · Purchased {displayInventoryQuantity(row.purchased, row.unit)} · Wasted {displayInventoryQuantity(row.wasted, row.unit)} · Closing {displayInventoryQuantity(row.closing, row.unit)}</Txt>
          </Card>) : <Empty text="No inventory usage in this period." />}
          <H2>By menu item</H2>
          {usage.byProduct.length ? usage.byProduct.map(row => <Card key={row.productId}><Row style={{ justifyContent: 'space-between' }}><Txt bold>{row.name}</Txt><Txt mut>Sold {row.sold}</Txt></Row>{row.ingredients.length ? row.ingredients.map(ingredient => <Txt small mut key={ingredient.inventoryItemId}>{ingredient.name} · {displayInventoryQuantity(ingredient.qty, items.find(item => item.id === ingredient.inventoryItemId)?.unit || 'pc')}</Txt>) : <Txt small mut>No recipe configured</Txt>}</Card>) : <Empty text="No menu-item usage was recorded for this period." />}
        </> : <Empty text="Loading usage…" />}
      </Screen>
    </View>
  );

  if (mode === 'orders') return (
    <View style={{ flex: 1, backgroundColor: t.bg }}><Header title={`To order${lowCount ? ` · ${lowCount}` : ''}`} onBack={backToList} right={<ActionIcon name="settings-outline" label="Reorder settings" onPress={() => setSettingsSheet(true)} />} />
      <Screen max={760}>
        {queuedMoves ? <Banner tone="warn">{queuedMoves} stock movement(s) are saved on this device and still need to sync.</Banner> : null}
        {reorder.length ? <>
          <Txt small mut>Suggestions based on the last {settings.windowDays} days of stock use. Existing open orders are deducted.</Txt>
          {Object.entries(reorder.reduce<Record<string, typeof reorder>>((groups, row) => {
            const supplier = row.item.supplier || 'No supplier';
            groups[supplier] = [...(groups[supplier] || []), row];
            return groups;
          }, {})).map(([supplier, rows]) => <View key={supplier} style={{ gap: 8 }}><H2>{supplier}</H2>{rows.map(row => <Card key={row.item.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!orderChecked[row.item.id] }} accessibilityLabel={`Select ${row.item.name} to order`} onPress={() => setOrderChecked(old => ({ ...old, [row.item.id]: !old[row.item.id] }))} style={{ padding: 5 }}><Ionicons name={orderChecked[row.item.id] ? 'checkbox' : 'square-outline'} size={22} color={t.pri} /></Pressable>
              <View style={{ flex: 1 }}><Txt bold>{row.item.name}</Txt><Txt small mut>On hand {displayInventoryQuantity(row.item.onHand, row.item.unit)}{row.daysLeft == null ? '' : ` · ${row.daysLeft.toFixed(1)} days left`}</Txt></View><Pill text={row.item.status.toUpperCase()} tone={statusTone(row.item)} />
            </Row>
            <Row><Txt small mut style={{ flex: 1 }}>Avg use {displayInventoryQuantity(row.avgDailyUse, row.item.unit)}/day · On order {displayInventoryQuantity(row.onOrder, row.item.unit)}</Txt><View style={{ width: 116 }}><Txt small mut>Order qty ({row.item.unit})</Txt><Input value={orderQty[row.item.id] ?? String(row.suggestedQty)} onChangeText={value => setOrderQty(old => ({ ...old, [row.item.id]: value }))} keyboardType="decimal-pad" style={{ minHeight: 42 }} /></View></Row>
          </Card>)}</View>)}
          <Btn title="Mark selected as ordered" onPress={() => void markOrdered()} disabled={!canBill} />
          <Row><View style={{ flex: 1 }}><Btn kind="sec" title="Share list" onPress={() => void shareOrderList()} /></View><View style={{ flex: 1 }}><Btn kind="sec" title="Copy" onPress={() => void copyOrderList()} /></View></Row>
        </> : <Empty text="Nothing to order. All items are above their reorder level." />}
        <H2>Open orders</H2>
        {orders.filter(order => order.status === 'open').length ? orders.filter(order => order.status === 'open').map(order => <Card key={order.id}>
          <Row style={{ justifyContent: 'space-between' }}><Txt bold>{order.supplier || 'Supplier not set'}</Txt><Pill text="OPEN" tone="warn" /></Row>
          {order.lines.map(line => <Txt small mut key={line.inventoryItemId}>{line.name} · {displayInventoryQuantity(line.qtyReceived, items.find(item => item.id === line.inventoryItemId)?.unit || 'pc')} / {displayInventoryQuantity(line.qtyOrdered, items.find(item => item.id === line.inventoryItemId)?.unit || 'pc')}</Txt>)}
          <Row><View style={{ flex: 1 }}><Btn title="Receive" small onPress={() => void receiveOrder(order)} disabled={!canBill} /></View><View style={{ flex: 1 }}><Btn title="Cancel" kind="sec" small onPress={() => Alert.alert('Cancel this order?', 'On-order quantities will no longer be included in suggestions.', [{ text: 'Keep', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => void eng.cancelInventoryOrder(order.id).then(() => eng.inventoryOrders('all')).then(setOrders).catch(error => toast(error.message, 'bad')) }])} disabled={!canBill} /></View></Row>
        </Card>) : <Empty text="No open orders. Mark a suggestion as ordered to track an upcoming delivery." />}
        <Sheet visible={!!receiving} onClose={() => setReceiving(null)} title="Receive order">
          {receiving?.lines.map(line => <Input key={line.inventoryItemId} label={`${line.name} · ordered ${displayInventoryQuantity(line.qtyOrdered, items.find(item => item.id === line.inventoryItemId)?.unit || 'pc')}`} value={receiveQty[line.inventoryItemId] || ''} onChangeText={value => setReceiveQty(old => ({ ...old, [line.inventoryItemId]: value }))} keyboardType="decimal-pad" />)}
          <Btn title="Receive stock" onPress={() => void submitReceive()} disabled={!canBill} />
        </Sheet>
      </Screen>
      <Sheet visible={settingsSheet} onClose={() => setSettingsSheet(false)} title="Reorder settings">
        <Input label="Usage look-back (days)" value={String(settings.windowDays)} onChangeText={value => setSettings(old => ({ ...old, windowDays: Number(value) }))} keyboardType="number-pad" />
        <Input label="Supplier lead time (days)" value={String(settings.leadDays)} onChangeText={value => setSettings(old => ({ ...old, leadDays: Number(value) }))} keyboardType="number-pad" />
        <Input label="Extra cover (days)" value={String(settings.coverDays)} onChangeText={value => setSettings(old => ({ ...old, coverDays: Number(value) }))} keyboardType="number-pad" />
        <Btn title="Save settings" onPress={() => void saveSettings()} disabled={!canBill} />
      </Sheet>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Header title="Inventory" onBack={back} right={rightActions} />
      <Screen max={L.twoPane ? 960 : 700}>
        {offline ? <Banner tone="warn">A movement is queued on this device. It will be replayed with the same ID when the connection returns.</Banner> : null}
        {queuedMoves ? <Banner tone="warn">{queuedMoves} movement(s) waiting to sync.</Banner> : null}
        {!canBill ? <Banner tone="warn">Inventory changes require an active subscription. Reading cached inventory remains available.</Banner> : null}
        <Row style={{ flexWrap: 'wrap' }}>{([
          ['all', 'All'], ['low', `Low${lowCount ? ` · ${items.filter(item => item.active && item.status === 'low').length}` : ''}`],
          ['out', `Out${items.some(item => item.active && item.status === 'out') ? ` · ${items.filter(item => item.active && item.status === 'out').length}` : ''}`], ['archived', 'Archived'],
        ] as [Filter, string][]).map(([key, label]) => <Chip key={key} text={label} on={filter === key} onPress={() => setFilter(key)} />)}</Row>
        <Input value={query} onChangeText={setQuery} placeholder="Search inventory or supplier" returnKeyType="search" />
        <Row style={{ justifyContent: 'space-between' }}><Txt small mut>{visible.length} item(s){me?.business?.name ? ` · ${me.business.name}` : ''}</Txt><Pressable onPress={() => setSortLowFirst(value => !value)}><Txt small bold tone="info">Sort: {sortLowFirst ? 'Lowest first' : 'Name'} ↕</Txt></Pressable></Row>
        {busy && !items.length ? <Empty text="Loading inventory…" /> : visible.length ? visible.map(item => <InventoryRow key={item.id} item={item} onPress={() => void openItem(item)} statusTone={statusTone(item)} />)
          : <Empty text={filter === 'archived' ? 'Nothing archived. Archived inventory items can be restored here.' : 'No inventory items yet. Add your first item to start tracking stock.'} />}
        <Btn title="＋ Add inventory item" onPress={startCreate} disabled={!canBill} />
        <Btn kind="sec" title="Sync queued stock changes" onPress={async () => {
          try { const result = await eng.syncInventoryMovements(); await refreshQueueCount(); await loadItems(); toast(result.pending ? `${result.accepted} synced; ${result.pending} still waiting.` : `${result.accepted} stock change(s) synced.`, result.pending ? 'warn' : 'ok'); }
          catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); }
        }} disabled={!queuedMoves} />
      </Screen>
      <Sheet visible={itemSheet} onClose={() => setItemSheet(false)} title={editItem ? 'Edit inventory item' : 'Add inventory item'}>
        <Input label="Name" value={form.name} onChangeText={name => setForm(old => ({ ...old, name }))} placeholder="e.g. Coffee beans" maxLength={150} />
        <Input label="Category (optional)" value={form.category} onChangeText={category => setForm(old => ({ ...old, category }))} placeholder="e.g. Ingredients" />
        <Txt small bold>Base unit</Txt><Row>{(['g', 'ml', 'pc'] as InventoryUnit[]).map(unit => <Chip key={unit} text={unit} on={form.unit === unit} onPress={() => setForm(old => ({ ...old, unit }))} />)}</Row>
        <Row><View style={{ flex: 1 }}><Input label="Pack size (base units)" value={form.packSize} onChangeText={packSize => setForm(old => ({ ...old, packSize }))} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Pack label" value={form.packLabel} onChangeText={packLabel => setForm(old => ({ ...old, packLabel }))} placeholder="bag" maxLength={40} /></View></Row>
        <Row><View style={{ flex: 1 }}><Input label={`Warn me at (${form.unit}${form.unit === 'g' ? ' / kg' : form.unit === 'ml' ? ' / l' : ' / dozen'})`} value={form.reorderLevel} onChangeText={reorderLevel => setForm(old => ({ ...old, reorderLevel }))} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label={`Par level (${form.unit}${form.unit === 'g' ? ' / kg' : form.unit === 'ml' ? ' / l' : ' / dozen'})`} value={form.parLevel} onChangeText={parLevel => setForm(old => ({ ...old, parLevel }))} keyboardType="decimal-pad" /></View></Row>
        <Input label="Unit cost (optional)" value={form.unitCost} onChangeText={unitCost => setForm(old => ({ ...old, unitCost }))} keyboardType="decimal-pad" placeholder="₹ per base unit" />
        <Input label="Supplier (optional)" value={form.supplier} onChangeText={supplier => setForm(old => ({ ...old, supplier }))} />
        <Input label="Notes (optional)" value={form.notes} onChangeText={notes => setForm(old => ({ ...old, notes }))} multiline />
        {!editItem ? <Input label={`Opening stock (${form.unit}${form.unit === 'g' ? ' / kg' : form.unit === 'ml' ? ' / l' : ' / dozen'})`} value={form.openingQty} onChangeText={openingQty => setForm(old => ({ ...old, openingQty }))} keyboardType="decimal-pad" /> : null}
        <Btn title={editItem ? 'Save changes' : 'Add item'} onPress={() => void saveItem()} disabled={!canBill} />
      </Sheet>
    </View>
  );
}

function InventoryRow({ item, onPress, statusTone }: { item: InventoryItem; onPress: () => void; statusTone: 'ok' | 'warn' | 'bad' }) {
  const t = useTheme();
  const fraction = item.parLevel > 0 ? Math.max(0, Math.min(1, item.onHand / item.parLevel)) : item.onHand > 0 ? 1 : 0;
  return <Card onPress={onPress}>
    <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1, gap: 3 }}><Txt bold>{item.name}</Txt><Txt small mut>{item.category || 'Uncategorized'}{item.supplier ? ` · ${item.supplier}` : ''}</Txt></View><View style={{ alignItems: 'flex-end', gap: 5 }}><Txt bold>{displayInventoryQuantity(item.onHand, item.unit)}</Txt><Pill text={item.active ? item.status.toUpperCase() : 'ARCHIVED'} tone={item.active ? statusTone : 'info'} /></View></Row>
    <View style={{ height: 6, borderRadius: 99, backgroundColor: t.line, overflow: 'hidden' }}><View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: item.status === 'out' ? t.bad : item.status === 'low' ? t.warn : t.ok }} /></View>
    <Txt small mut>Reorder {displayInventoryQuantity(item.reorderLevel, item.unit)} · Par {displayInventoryQuantity(item.parLevel, item.unit)}</Txt>
  </Card>;
}
