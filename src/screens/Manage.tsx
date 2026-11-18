import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { Banner, Btn, Card, Chip, Empty, F, Header, H2, Input, Pill, Row, Screen, Sheet, Toggle, Txt, useTheme } from '../ui/kit';
import { inr } from '../core/calc';
import { reportHtml } from '../core/receipt';
import type { Bill, Product, ReportData, Variant } from '../core/types';
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
export function Menu() {
  const { eng, toast, canBill } = useApp(); const t = useTheme();
  const [items, setItems] = useState<Product[]>([]); const [q, setQ] = useState(''); const [edit, setEdit] = useState<Product | 'new' | null>(null); const [f, setF] = useState(blank); const [vars, setVars] = useState<Variant[]>([]); const [busy, setBusy] = useState(false); const [showOff, setShowOff] = useState(false);
  const load = useCallback(() => { eng.products(false).then(setItems); eng.products(true).then(setItems).catch(() => null); }, [eng]); useEffect(load, [load]);
  const shown = useMemo(() => items.filter(p => (showOff || p.active) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.category || '').toLowerCase().includes(q.toLowerCase()))), [items, q, showOff]);
  function open(p: Product | 'new') { setEdit(p); if (p === 'new') { setF({ ...blank, taxRate: String(eng.taxProfile().defaultTaxRate || '') }); setVars([]); } else { setF({ name: p.name, category: p.category || '', sku: p.sku || '', price: String(p.price), taxRate: String(p.taxRate), available: p.available, favourite: p.favourite, active: p.active }); setVars(p.variants.map(v => ({ ...v }))); } }
  const price = Number(f.price), tax = Number(f.taxRate || 0);
  const ok = f.name.trim() && f.price !== '' && Number.isFinite(price) && price >= 0 && Number.isFinite(tax) && tax >= 0 && tax <= 100 && vars.every(v => v.name.trim());
  async function save() {
    setBusy(true);
    try { await eng.saveProduct(edit === 'new' ? null : (edit as Product).id, { name: f.name.trim(), category: f.category.trim() || null, sku: f.sku.trim() || null, price, taxRate: tax, available: f.available, favourite: f.favourite, active: f.active, variants: vars.map(v => ({ ...v, name: v.name.trim(), priceDelta: Number(v.priceDelta) || 0 })) } as any); setEdit(null); toast('Saved', 'ok'); load(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const quick = async (p: Product, patch: Partial<Product>) => { try { await eng.saveProduct(p.id, patch); load(); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <View style={{ flex: 1 }}><Header title="Menu" right={<Pressable onPress={() => (canBill ? open('new') : toast('Subscribe to add items.', 'warn'))} hitSlop={10} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Ionicons name="add-circle" size={24} color={t.pri} /><Txt tone="ok" bold>Add item</Txt></Pressable>} />
      <Screen max={760}>
        <Input value={q} onChangeText={setQ} placeholder="Search menu" /><Toggle label="Show archived items" value={showOff} onChange={setShowOff} />
        {!canBill ? <Banner tone="warn">Menu changes need an active subscription.</Banner> : null}
        {shown.length === 0 ? <Empty text={items.length ? 'No items match.' : 'Your menu is empty. Tap “Add item” to start.'} /> : shown.map(p => (
          <Card key={p.id} onPress={() => open(p)}>
            <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><Txt bold>{p.favourite ? '★ ' : ''}{p.name}</Txt><Txt small mut>{p.category || 'Uncategorised'}{p.taxRate ? ` · ${p.taxRate}% tax` : ''}{p.variants.length ? ` · ${p.variants.length} option(s)` : ''}</Txt></View><Txt bold tone="ok">{inr(p.price)}</Txt></Row>
            <Row style={{ flexWrap: 'wrap' }}>{!p.active ? <Pill text="Archived" tone="bad" /> : !p.available ? <Pill text="Sold out" tone="warn" /> : <Pill text="Available" tone="ok" />}
              {p.active ? <Pressable onPress={() => quick(p, { available: !p.available })} hitSlop={8}><Txt small tone="ok" bold>{p.available ? 'Mark sold out' : 'Mark available'}</Txt></Pressable> : null}</Row>
          </Card>))}
      </Screen>
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New item' : 'Edit item'}>
        <Input label="Name *" value={f.name} onChangeText={v => setF({ ...f, name: v })} /><Input label="Category" value={f.category} onChangeText={v => setF({ ...f, category: v })} />
        <Row><View style={{ flex: 1 }}><Input label="Price ₹ *" keyboardType="decimal-pad" value={f.price} onChangeText={v => setF({ ...f, price: v })} /></View><View style={{ flex: 1 }}><Input label="Tax %" keyboardType="decimal-pad" value={f.taxRate} onChangeText={v => setF({ ...f, taxRate: v })} /></View></Row>
        <Input label="SKU / code" autoCapitalize="characters" value={f.sku} onChangeText={v => setF({ ...f, sku: v })} />
        <Toggle label="Available" value={f.available} onChange={v => setF({ ...f, available: v })} /><Toggle label="Favourite (shown first)" value={f.favourite} onChange={v => setF({ ...f, favourite: v })} />
        {edit !== 'new' ? <Toggle label="Active (off = archived)" value={f.active} onChange={v => setF({ ...f, active: v })} /> : null}
        <H2>Sizes &amp; add-ons</H2>
        {vars.map((v, i) => (
          <Row key={i} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 2 }}><Input label={v.kind === 'variant' ? 'Size / variant' : 'Add-on'} value={v.name} onChangeText={x => setVars(a => a.map((y, j) => (j === i ? { ...y, name: x } : y)))} /></View>
            <View style={{ flex: 1 }}><Input label="± ₹" keyboardType="numbers-and-punctuation" value={String(v.priceDelta)} onChangeText={x => setVars(a => a.map((y, j) => (j === i ? { ...y, priceDelta: x as any } : y)))} /></View>
            <Pressable onPress={() => setVars(a => a.filter((_, j) => j !== i))} hitSlop={10} style={{ paddingBottom: 14 }}><Ionicons name="trash-outline" size={22} color={t.bad} /></Pressable>
          </Row>))}
        <Row><View style={{ flex: 1 }}><Btn small kind="sec" title="+ Size" onPress={() => setVars(a => [...a, { name: '', priceDelta: 0, kind: 'variant' }])} /></View><View style={{ flex: 1 }}><Btn small kind="sec" title="+ Add-on" onPress={() => setVars(a => [...a, { name: '', priceDelta: 0, kind: 'addon' }])} /></View></Row>
        <Btn title="Save item" onPress={save} loading={busy} disabled={!ok || !canBill} />
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
