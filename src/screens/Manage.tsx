import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useApp } from '../AppContext';
import { Banner, Btn, Card, Chip, Empty, F, Header, H2, Input, Pill, Row, Screen, Sheet, Toggle, Txt, useTheme } from '../ui/kit';
import { inr } from '../core/calc';
import { reportHtml } from '../core/receipt';
import type { Bill, InventoryItem, Product, RecipeLine, ReportData, Variant } from '../core/types';
import { parseCsvRows, parseMenuRows, parseXlsxRows, type ImportedMenuProduct } from '../core/menuImport';
import { sharePdf, shareCsv } from '../print/share';
import { statusTone } from './Billing';

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export type Period = 'today' | 'yesterday' | '7d' | '30d' | 'month';
export const PERIODS: [Period, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']];
export function rangeOf(p: Period, now = new Date()): { from: string; to: string } {
  const t0 = startOfDay(now);
  const r = { today: [t0, endOfDay(now)], yesterday: [addDays(t0, -1), endOfDay(addDays(now, -1))], '7d': [addDays(t0, -6), endOfDay(now)], '30d': [addDays(t0, -29), endOfDay(now)], month: [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)] }[p];
  return { from: r[0].toISOString(), to: r[1].toISOString() };
}

// ───────────────────────── Menu ─────────────────────────
const blank = { name: '', category: '', sku: '', price: '', taxRate: '', available: true, favourite: false, active: true };
type ImportPreviewRow = { item: ImportedMenuProduct; existing: Product | null; action: 'create' | 'skip' | 'update' };
const normalized = (value: string | null | undefined) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function Menu() {
  const { eng, toast, canBill } = useApp(); const t = useTheme();
  const [items, setItems] = useState<Product[]>([]); const [q, setQ] = useState(''); const [edit, setEdit] = useState<Product | 'new' | null>(null); const [f, setF] = useState(blank); const [vars, setVars] = useState<Variant[]>([]); const [busy, setBusy] = useState(false); const [availabilityBusy, setAvailabilityBusy] = useState<string | null>(null); const [showOff, setShowOff] = useState(false);
  const [importBusy, setImportBusy] = useState(false); const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]); const [importErrors, setImportErrors] = useState<string[]>([]); const [showImport, setShowImport] = useState(false); const [archived, setArchived] = useState(false);
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null); const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]); const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const load = useCallback(() => { eng.products(false, true).then(setItems); eng.products(true, true).then(setItems).catch(() => null); }, [eng]); useEffect(load, [load]);
  const shown = useMemo(() => items.filter(p => (archived ? !p.active : p.active) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.category || '').toLowerCase().includes(q.toLowerCase()))), [items, q, archived]);
  function open(p: Product | 'new') { setEdit(p); if (p === 'new') { setF({ ...blank, taxRate: String(eng.taxProfile().defaultTaxRate || '') }); setVars([]); } else { setF({ name: p.name, category: p.category || '', sku: p.sku || '', price: String(p.price), taxRate: String(p.taxRate), available: p.available, favourite: p.favourite, active: p.active }); setVars(p.variants.map(v => ({ ...v }))); } }
  const price = Number(f.price), tax = Number(f.taxRate || 0);
  const ok = f.name.trim() && f.price !== '' && Number.isFinite(price) && price >= 0 && Number.isFinite(tax) && tax >= 0 && tax <= 100 && vars.every(v => v.name.trim());
  async function save() {
    setBusy(true);
    try { await eng.saveProduct(edit === 'new' ? null : (edit as Product).id, { name: f.name.trim(), category: f.category.trim() || null, sku: f.sku.trim() || null, price, taxRate: tax, available: f.available, favourite: f.favourite, active: f.active, variants: vars.map(v => ({ ...v, name: v.name.trim(), priceDelta: Number(v.priceDelta) || 0 })) } as any); setEdit(null); toast('Saved', 'ok'); load(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const quick = async (p: Product, patch: Partial<Product>) => {
    setAvailabilityBusy(p.id);
    try { await eng.saveProduct(p.id, patch); load(); }
    catch (e: any) { toast(e.message, 'bad'); }
    finally { setAvailabilityBusy(null); }
  };
  async function editRecipe(product: Product) {
    try {
      const [availableItems, allRecipes] = await Promise.all([eng.inventoryItems(true), eng.inventoryRecipes()]);
      setInventoryItems(availableItems);
      setRecipeLines((allRecipes[product.id] || []).map(line => ({ ...line })));
      setRecipeProduct(product);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'bad');
    }
  }
  async function saveRecipe() {
    if (!recipeProduct) return;
    try {
      if (recipeLines.some(line => !line.inventoryItemId || !Number.isFinite(line.qty) || line.qty <= 0)) throw new Error('Choose an ingredient and enter a quantity greater than zero for every recipe row.');
      await eng.saveInventoryRecipe(recipeProduct.id, recipeLines.map(line => ({ ...line, variantName: line.variantName?.trim() || null })));
      setRecipeProduct(null);
      toast('Recipe saved. Future synced sales will use these quantities.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'bad');
    }
  }
  function moveOption(index: number, direction: -1 | 1) {
    setVars(current => {
      const siblings = current.map((option, optionIndex) => option.kind === 'variant' ? optionIndex : -1).filter(optionIndex => optionIndex >= 0);
      const position = siblings.indexOf(index);
      const other = siblings[position + direction];
      if (position < 0 || other == null) return current;
      const next = [...current];
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  }
  async function pickMenuFile() {
    setImportBusy(true);
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (selected.canceled) return;
      const file = selected.assets[0];
      const extension = file.name.toLowerCase().split('.').pop();
      const rows = extension === 'csv'
        ? parseCsvRows(await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 }))
        : extension === 'xlsx' || extension === 'xls'
          ? parseXlsxRows(await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }))
          : null;
      if (!rows) throw new Error('Choose a CSV, XLSX, or XLS file.');
      const parsed = parseMenuRows(rows);
      if (!parsed.products.length && parsed.errors.length) {
        setImportErrors(parsed.errors); setImportRows([]); setShowImport(true); return;
      }
      const current = await eng.products(true);
      setItems(current);
      setImportRows(parsed.products.map(item => {
        const bySku = item.sku ? current.find(p => normalized(p.sku) === normalized(item.sku)) : undefined;
        const duplicate = bySku || current.find(p => normalized(p.name) === normalized(item.name) && normalized(p.category) === normalized(item.category));
        return { item, existing: duplicate || null, action: duplicate ? 'skip' : 'create' };
      }));
      setImportErrors(parsed.errors);
      setShowImport(true);
    } catch (error: any) {
      toast(error instanceof Error ? error.message : String(error), 'bad');
    } finally { setImportBusy(false); }
  }
  async function applyImport() {
    const selected = importRows.filter(row => row.action !== 'skip');
    if (!selected.length) { setShowImport(false); toast('No menu items selected for import.', 'warn'); return; }
    setImportBusy(true);
    try {
      const result = await eng.saveProducts(selected.map(({ item, existing }) => ({
        id: existing?.id || null,
        product: {
          ...item,
          description: existing?.description || null,
          available: existing?.available ?? true,
          active: existing?.active ?? true,
          favourite: existing?.favourite ?? false,
        },
      })));
      setItems(result.products);
      const skipped = importRows.length - selected.length;
      const messages = [`Imported ${result.saved} item(s)`, skipped ? `${skipped} duplicate(s) skipped` : '', result.failures.length ? `${result.failures.length} item(s) failed` : ''].filter(Boolean);
      toast(messages.join(' · '), result.failures.length ? 'warn' : 'ok');
      const failedIndexes = new Set(result.failures.map(failure => failure.index));
      setImportRows(selected.filter((_, index) => failedIndexes.has(index)));
      setImportErrors([...importErrors, ...result.failures.map(failure => `${failure.name}: ${failure.error}`)]);
      setShowImport(result.failures.length > 0 || importErrors.length > 0);
    } catch (error: any) {
      toast(error instanceof Error ? error.message : String(error), 'bad');
    } finally { setImportBusy(false); }
  }
  return (
    <View style={{ flex: 1 }}><Header title="Menu" right={<Pressable onPress={() => (canBill ? open('new') : toast('Subscribe to add items.', 'warn'))} hitSlop={10} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Ionicons name="add-circle" size={24} color={t.pri} /><Txt tone="ok" bold>Add item</Txt></Pressable>} />
      <Screen max={760}>
        <Input value={q} onChangeText={setQ} placeholder={archived?'Search archived items':'Search menu'} />
        <Row><View style={{flex:1}}><Btn kind={!archived?'pri':'sec'} small title="Menu" onPress={()=>setArchived(false)} /></View><View style={{flex:1}}><Btn kind={archived?'pri':'sec'} small title={`Archived items (${items.filter(p=>!p.active).length})`} onPress={()=>setArchived(true)} /></View></Row>
        <Btn title="Import CSV / Excel" kind="sec" small onPress={() => canBill ? void pickMenuFile() : toast('An active subscription is required to import menu items.', 'warn')} loading={importBusy} disabled={!canBill} style={{ alignSelf: 'flex-start' }} />
        {!canBill ? <Banner tone="warn">Menu changes need an active subscription.</Banner> : null}
        {shown.length === 0 ? <Empty text={archived?'Nothing archived. Items you archive will appear here.':items.length?'No items match.':'Your menu is empty. Tap “Add item” to start.'} /> : shown.map(p => (
          <Card key={p.id} onPress={() => archived ? toast('Use Restore to put this item back on the menu.','info') : open(p)}>
            <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><Txt bold>{p.favourite ? '★ ' : ''}{p.name}</Txt><Txt small mut>{p.category || 'Uncategorised'}{p.taxRate ? ` · ${p.taxRate}% tax` : ''}{p.variants.length ? ` · ${p.variants.length} option(s)` : ''}</Txt></View><Txt bold tone="ok">{inr(p.price)}</Txt>{p.active && canBill ? <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${p.name}`} hitSlop={8} onPress={() => Alert.alert(p.name, undefined, [{ text: 'Edit', onPress: () => open(p) }, { text: 'Archive', style: 'destructive', onPress: () => Alert.alert('Archive item?', `Archive ${p.name}? It disappears from new bills. Past bills and reports keep it. You can restore it any time.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', style: 'destructive', onPress: () => void (async () => { try { await eng.archiveProduct(p.id); toast('Item archived', 'ok'); load(); } catch (error) { toast(error instanceof Error ? error.message : String(error), 'bad'); } })() }]) }, { text: 'Cancel', style: 'cancel' }])}><Ionicons name="ellipsis-vertical" size={20} color={t.mut} /></Pressable> : null}</Row>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {!p.active ? <><Pill text="Archived" tone="bad" /><Btn small kind="ok" title="Restore" disabled={!canBill} onPress={async()=>{try{await eng.restoreProduct(p.id);toast('Item restored','ok');load()}catch(e:any){toast(e.message,'bad')}}} /></> : null}
              {p.active ? <Row style={{ gap: 6 }}>
                {([true, false] as const).map(available => {
                  const selected = p.available === available;
                  return <Pressable key={String(available)} accessibilityRole="button" accessibilityState={{ selected, disabled: availabilityBusy === p.id }} accessibilityLabel={`Set ${p.name} ${available ? 'available' : 'sold out'}`}
                    disabled={availabilityBusy === p.id} onPress={() => { if (!selected) void quick(p, { available }); }}
                    style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: selected ? (available ? t.ok : t.warn) : t.line, backgroundColor: selected ? (available ? t.okSoft : t.warnSoft) : t.card, alignItems: 'center', justifyContent: 'center', opacity: availabilityBusy === p.id ? 0.6 : 1 }}>
                    <Txt small bold tone={available ? 'ok' : 'warn'}>{available ? 'Available' : 'Sold out'}</Txt>
                  </Pressable>;
                })}
              </Row> : <Pill text={!p.available ? 'Sold out' : 'Available'} tone={!p.available ? 'warn' : 'ok'} />}
            </Row>
          </Card>))}
      </Screen>
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New item' : 'Edit item'}>
        <Input label="Name *" value={f.name} onChangeText={v => setF({ ...f, name: v })} /><Input label="Category" value={f.category} onChangeText={v => setF({ ...f, category: v })} />
        <Row><View style={{ flex: 1 }}><Input label="Price ₹ *" keyboardType="decimal-pad" value={f.price} onChangeText={v => setF({ ...f, price: v })} /></View><View style={{ flex: 1 }}><Input label="Tax %" keyboardType="decimal-pad" value={f.taxRate} onChangeText={v => setF({ ...f, taxRate: v })} /></View></Row>
        <Input label="SKU / code" autoCapitalize="characters" value={f.sku} onChangeText={v => setF({ ...f, sku: v })} />
        <Toggle label="Available" value={f.available} onChange={v => setF({ ...f, available: v })} /><Toggle label="Favourite (shown first)" value={f.favourite} onChange={v => setF({ ...f, favourite: v })} />
        {edit !== 'new' ? <><Toggle label="Active (off = archived)" value={f.active} onChange={v => setF({ ...f, active: v })} />{canBill ? <Btn kind="bad" small title="Archive item" onPress={()=>{const product=edit as Product;Alert.alert('Archive item?',`Archive ${product.name}? It disappears from new bills. Past bills and reports keep it. You can restore it any time.`,[{text:'Cancel',style:'cancel'},{text:'Archive',style:'destructive',onPress:()=>void (async()=>{try{await eng.archiveProduct(product.id);setEdit(null);toast('Item archived','ok');load()}catch(e:any){toast(e.message,'bad')}})()}])}} /> : null}</> : null}
        <H2>Sizes &amp; add-ons</H2>
        {vars.map((v, i) => (
          <Row key={i} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 2 }}><Input label={v.kind === 'variant' ? 'Size / variant' : 'Add-on'} value={v.name} onChangeText={x => setVars(a => a.map((y, j) => (j === i ? { ...y, name: x } : y)))} /></View>
            <View style={{ flex: 1 }}><Input label="± ₹" keyboardType="numbers-and-punctuation" value={String(v.priceDelta)} onChangeText={x => setVars(a => a.map((y, j) => (j === i ? { ...y, priceDelta: x as any } : y)))} /></View>
            <Pressable onPress={() => setVars(a => a.filter((_, j) => j !== i))} hitSlop={10} style={{ paddingBottom: 14 }}><Ionicons name="trash-outline" size={22} color={t.bad} /></Pressable>
            {v.kind === 'variant' ? <View style={{ paddingBottom: 14, gap: 8 }}><Pressable accessibilityLabel={`Move ${v.name || 'size'} up`} disabled={!vars.slice(0, i).some(option => option.kind === 'variant')} onPress={() => moveOption(i, -1)}><Ionicons name="arrow-up" size={20} color={t.pri} /></Pressable><Pressable accessibilityLabel={`Move ${v.name || 'size'} down`} disabled={!vars.slice(i + 1).some(option => option.kind === 'variant')} onPress={() => moveOption(i, 1)}><Ionicons name="arrow-down" size={20} color={t.pri} /></Pressable></View> : null}
          </Row>))}
        <Row><View style={{ flex: 1 }}><Btn small kind="sec" title="+ Size" onPress={() => setVars(a => [...a, { name: '', priceDelta: 0, kind: 'variant' }])} disabled={vars.length >= 30} /></View><View style={{ flex: 1 }}><Btn small kind="sec" title="+ Add-on" onPress={() => setVars(a => [...a, { name: '', priceDelta: 0, kind: 'addon' }])} disabled={vars.length >= 30} /></View></Row>
        {edit !== 'new' ? <Btn kind="sec" title="Ingredients used per serving" onPress={() => void editRecipe(edit as Product)} disabled={!canBill} /> : null}
        <Btn title="Save item" onPress={save} loading={busy} disabled={!ok || !canBill} />
      </Sheet>
      <Sheet visible={!!recipeProduct} onClose={() => setRecipeProduct(null)} title={`Recipe · ${recipeProduct?.name || ''}`}>
        <Txt small mut>Base ingredients apply to every size. Optional size and add-on rows add to the base recipe.</Txt>
        {recipeLines.map((line, index) => (
          <Card key={`${recipeProduct?.id}-${index}`}>
            <Txt small bold>Ingredient {index + 1}</Txt>
            <View style={{ gap: 6 }}>{inventoryItems.filter(item => item.active).map(item => <Chip key={item.id} text={`${item.name} (${item.unit})`} on={line.inventoryItemId === item.id} onPress={() => setRecipeLines(rows => rows.map((row, i) => i === index ? { ...row, inventoryItemId: item.id } : row))} />)}</View>
            <Input label="Quantity per serving (base units)" value={String(line.qty || '')} onChangeText={value => setRecipeLines(rows => rows.map((row, i) => i === index ? { ...row, qty: Number(value) } : row))} keyboardType="decimal-pad" />
            <Txt small bold>Applies to</Txt>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip text="Base (all sizes)" on={!line.variantName} onPress={() => setRecipeLines(rows => rows.map((row, i) => i === index ? { ...row, variantName: null } : row))} />
              {(recipeProduct?.variants || []).map(option => <Chip key={option.name} text={option.name} on={line.variantName === option.name} onPress={() => setRecipeLines(rows => rows.map((row, i) => i === index ? { ...row, variantName: option.name } : row))} />)}
            </Row>
            <Btn kind="bad" small title="Remove ingredient" onPress={() => setRecipeLines(rows => rows.filter((_, i) => i !== index))} />
          </Card>
        ))}
        <Btn kind="sec" title="＋ Add ingredient" onPress={() => {
          const first = inventoryItems.find(item => item.active);
          if (!first) { toast('Add an active inventory item before creating a recipe.', 'warn'); return; }
          setRecipeLines(rows => [...rows, { inventoryItemId: first.id, qty: 0, variantName: null }]);
        }} disabled={recipeLines.length >= 40 || !canBill} />
        <Btn title="Save recipe" onPress={() => void saveRecipe()} disabled={!canBill} />
      </Sheet>
      <Sheet visible={showImport} onClose={() => setShowImport(false)} title="Review menu import">
        <Txt small mut>Required columns: Item and Price. Optional: Category, SKU, Size, Tax. Rows with the same item and category are grouped; size prices become variants.</Txt>
        {importErrors.map((error, index) => <Banner key={`${index}-${error}`} tone="warn">{error}</Banner>)}
        {importRows.length ? <Txt bold>{importRows.length} item group(s) found</Txt> : null}
        {importRows.map((row, index) => (
          <Card key={`${row.item.name}-${row.item.category}-${index}`}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}><Txt bold>{row.item.name}</Txt><Txt small mut>{row.item.category || 'Uncategorised'} · {inr(row.item.price)}{row.item.variants.length ? ` · ${row.item.variants.length} size(s)` : ''}</Txt></View>
              {row.existing ? <Pill text="Duplicate" tone="warn" /> : <Pill text="New" tone="ok" />}
            </Row>
            {row.existing ? <Row>
              <View style={{ flex: 1 }}><Btn title="Skip" kind={row.action === 'skip' ? 'pri' : 'sec'} small onPress={() => setImportRows(current => current.map((item, i) => i === index ? { ...item, action: 'skip' } : item))} /></View>
              <View style={{ flex: 1 }}><Btn title="Update existing" kind={row.action === 'update' ? 'pri' : 'sec'} small onPress={() => setImportRows(current => current.map((item, i) => i === index ? { ...item, action: 'update' } : item))} /></View>
            </Row> : null}
          </Card>
        ))}
        <Btn title="Import selected items" onPress={() => void applyImport()} loading={importBusy} disabled={!importRows.some(row => row.action !== 'skip')} />
      </Sheet>
    </View>
  );
}

// ───────────────────────── Sales ─────────────────────────
export function Sales() {
  const { eng, push, toast } = useApp(); const [p, setP] = useState<Period | 'all'>('today'); const [q, setQ] = useState(''); const [method, setMethod] = useState(''); const [status, setStatus] = useState(''); const [cashier, setCashier] = useState('');
  const [bills, setBills] = useState<Bill[]>([]); const [online, setOnline] = useState(true); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = p === 'all' ? {} : rangeOf(p); const h = await eng.history({ ...r, q, method: method || undefined, status: status || undefined, cashier: cashier || undefined }); setBills(h.bills); setOnline(h.online); } catch (e: any) { toast(e.message, 'bad'); } finally { setLoading(false); }
  }, [eng, p, q, method, status, cashier, toast]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  const done = bills.filter(b => b.status === 'completed'); const total = done.reduce((a, b) => a + b.total, 0);
  return (
    <View style={{ flex: 1 }}><Header title="Sales" right={<Pressable onPress={() => shareCsv(eng.csv(bills), 'tably-sales.csv').catch(e => toast(e.message, 'bad'))} hitSlop={10} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Ionicons name="download-outline" size={20} color="#C96510" /><Txt tone="ok" bold>CSV</Txt></Pressable>} />
      <Screen max={760}>
        <Row style={{ flexWrap: 'wrap' }}>{[...PERIODS, ['all', 'All'] as [string, string]].map(([k, l]) => <Chip key={k} text={l} on={p === k} onPress={() => setP(k as any)} />)}</Row>
        <Input value={q} onChangeText={setQ} placeholder="Search bill number" autoCapitalize="characters" /><Input value={cashier} onChangeText={setCashier} placeholder="Filter by cashier" />
        <Row style={{ flexWrap: 'wrap' }}>{['', 'cash', 'upi', 'card'].map(m => <Chip key={m || 'any'} text={m ? m.toUpperCase() : 'Any payment'} on={method === m} onPress={() => setMethod(m)} />)}</Row>
        <Row style={{ flexWrap: 'wrap' }}>{['', 'completed', 'void', 'refunded'].map(m => <Chip key={m || 'any'} text={m || 'Any status'} on={status === m} onPress={() => setStatus(m)} />)}</Row>
        <Card><Row style={{ justifyContent: 'space-between' }}><View><Txt small mut>{done.length} completed bill(s)</Txt><Txt bold style={{ fontFamily: F.head, fontSize: 24 }}>{inr(total)}</Txt></View>{!online ? <Pill text="Offline: this phone only" tone="warn" /> : null}</Row></Card>
        {loading && !bills.length ? <Txt mut>Loading…</Txt> : bills.length === 0 ? <Empty text="No bills match these filters." /> : bills.map(b => (
          <Card key={b.clientTxnId} onPress={() => push('bill-detail', { bill: b })}>
            <Row style={{ justifyContent: 'space-between' }}><Txt bold>{b.invoiceNo || 'Draft'}</Txt><Txt bold>{inr(b.total)}</Txt></Row>
            <Row style={{ justifyContent: 'space-between' }}><Txt small mut>{new Date(b.createdAt).toLocaleString()} · {b.payments.map(x => x.method).join('+') || '—'}</Txt><Row style={{ gap: 6 }}>{!b.synced && !b.remote ? <Pill text="Not synced" tone="warn" /> : null}<Pill text={b.status} tone={statusTone(b.status)} /></Row></Row>
          </Card>))}
      </Screen>
    </View>
  );
}

// ───────────────────────── Reports ─────────────────────────
export function Reports() {
  const { eng, toast } = useApp(); const [p, setP] = useState<Period>('today'); const [r, setR] = useState<ReportData | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { const x = rangeOf(p); setR(await eng.report(x.from, x.to)); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }, [eng, p, toast]);
  useEffect(() => { void load(); }, [load]);
  const label = PERIODS.find(x => x[0] === p)![1];
  const itemsCsv = () => ['item,qty,revenue', ...(r?.itemWise || []).map(i => `"${i.name.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}",${i.qty},${i.revenue}`)].join('\n');
  const kpi = (l: string, v: string) => <Card style={{ flex: 1, minWidth: 140 }}><Txt small mut>{l}</Txt><Txt bold style={{ fontFamily: F.head, fontSize: 22 }}>{v}</Txt></Card>;
  return (
    <View style={{ flex: 1 }}><Header title="Reports" />
      <Screen max={760}>
        <Row style={{ flexWrap: 'wrap' }}>{PERIODS.map(([k, l]) => <Chip key={k} text={l} on={p === k} onPress={() => setP(k)} />)}</Row>
        {busy && !r ? <Txt mut>Loading…</Txt> : r ? <>
          <Row style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>{kpi('Sales', inr(r.total))}{kpi('Bills', String(r.billCount))}{kpi('Average bill', inr(r.averageBill))}{kpi('Discounts', inr(r.discounts))}{kpi('Tax collected', inr(r.tax))}</Row>
          {r.source === 'device' ? <Banner tone="warn">Offline — these figures come from this phone only.</Banner> : null}
          <Card><H2>By payment method</H2>{Object.keys(r.byMethod).length ? Object.entries(r.byMethod).map(([m, v]) => <Row key={m} style={{ justifyContent: 'space-between' }}><Txt>{m.toUpperCase()}</Txt><Txt bold>{inr(v)}</Txt></Row>) : <Txt mut>No sales in this period.</Txt>}</Card>
          <Card><H2>Item-wise sales</H2>{r.itemWise.length ? r.itemWise.map(i => <Row key={i.name} style={{ justifyContent: 'space-between' }}><Txt style={{ flex: 1 }} numberOfLines={1}>{i.name}</Txt><Txt mut>×{i.qty}</Txt><Txt bold style={{ minWidth: 90, textAlign: 'right' }}>{inr(i.revenue)}</Txt></Row>) : <Txt mut>No items sold.</Txt>}</Card>
          <Row><View style={{ flex: 1 }}><Btn kind="sec" small title="Share PDF" onPress={() => sharePdf(reportHtml(`Sales report — ${label}`, r, r.source), 'tably-report').catch(e => toast(e.message, 'bad'))} /></View><View style={{ flex: 1 }}><Btn kind="sec" small title="Items CSV" onPress={() => shareCsv(itemsCsv(), 'tably-items.csv').catch(e => toast(e.message, 'bad'))} /></View></Row>
        </> : null}
      </Screen>
    </View>
  );
}
