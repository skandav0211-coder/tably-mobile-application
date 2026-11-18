import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { Banner, Btn, Card, Chip, Divider, Empty, F, Header, H2, Input, Pill, Row, Screen, Sheet, Tile, Toggle, Txt, useLayout, useTheme } from '../ui/kit';
import { calculate, discountFromPercent, inr, serviceChargeFor } from '../core/calc';
import { receiptLines } from '../core/receipt';
import type { Bill, CartLine, PayMethod, Product, Variant } from '../core/types';
import { headerOf, pdfBill, printBill } from '../print/actions';

export const statusTone = (s: string) => (s === 'completed' ? 'ok' : s === 'draft' ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad';

export function NewBill() {
  const { eng, toast, canBill, push, draft, setDraft, uuid } = useApp(); const L = useLayout(); const t = useTheme();
  const [products, setProducts] = useState<Product[]>([]); const [q, setQ] = useState(''); const [cat, setCat] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]); const [cartId, setCartId] = useState(() => uuid()); const [pick, setPick] = useState<Product | null>(null); const [opts, setOpts] = useState<Variant[]>([]);
  const [sheet, setSheet] = useState(false); const [saved, setSaved] = useState<Bill | null>(null); const [busy, setBusy] = useState(false);
  const [disc, setDisc] = useState(''); const [pct, setPct] = useState(false); const [svc, setSvc] = useState(String(eng.taxProfile().serviceChargePercent || 0)); const [method, setMethod] = useState<PayMethod>('cash');
  const [split, setSplit] = useState(false); const [sp, setSp] = useState({ cash: '', upi: '', card: '' }); const [cust, setCust] = useState({ name: '', mobile: '', table: '', notes: '' });

  useEffect(() => { eng.products(false).then(setProducts); eng.products(true).then(setProducts).catch(() => null); }, [eng]);
  useEffect(() => { // resume a saved draft
    if (!draft) return; setCart(draft.items.map(i => ({ key: i.name, itemId: i.name, name: i.name, price: i.price, qty: i.qty, taxRate: i.taxRate }))); setCartId(draft.clientTxnId);
    setDisc(draft.discount ? String(draft.discount) : ''); setPct(false); setCust({ name: draft.customerName || '', mobile: draft.customerMobile || '', table: draft.tableNo || '', notes: draft.notes || '' }); setDraft(null); toast('Draft loaded', 'ok');
  }, [draft]);  // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useMemo(() => ['All', ...Array.from(new Set(products.filter(p => p.active && p.category).map(p => p.category as string)))], [products]);
  const shown = useMemo(() => products.filter(p => p.active && p.available && (cat === 'All' || p.category === cat) && (!q || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name)), [products, q, cat]);
  const discNum = Number(disc) || 0; const discountValue = pct ? discountFromPercent(cart, discNum) : discNum; const svcPct = Number(svc) || 0;
  const svcAmt = serviceChargeFor(cart, discountValue, svcPct); const totals = calculate(cart, discountValue, svcAmt); const count = cart.reduce((a, l) => a + l.qty, 0);

  function addLine(p: Product, o: Variant[]) {
    const key = p.id + '|' + o.map(x => x.name).sort().join(','); const price = p.price + o.reduce((a, x) => a + x.priceDelta, 0);
    const name = o.length ? `${p.name} (${o.map(x => x.name).join(', ')})` : p.name;
    setCart(c => (c.some(l => l.key === key) ? c.map(l => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, itemId: p.id, name, price, qty: 1, taxRate: p.taxRate }]));
  }
  const tap = (p: Product) => { if (!canBill) { toast('Billing is paused — see the banner above.', 'warn'); return; } if (p.variants.length) { setOpts([]); setPick(p); } else addLine(p, []); };
  const setQty = (key: string, n: number) => setCart(c => (n <= 0 ? c.filter(l => l.key !== key) : c.map(l => (l.key === key ? { ...l, qty: n } : l))));
  const reset = () => { setCart([]); setCartId(uuid()); setDisc(''); setSplit(false); setSp({ cash: '', upi: '', card: '' }); setCust({ name: '', mobile: '', table: '', notes: '' }); setSheet(false); };

  async function complete() {
    setBusy(true);
    try {
      const splitPays = split ? (['cash', 'upi', 'card'] as PayMethod[]).map(m => ({ method: m, amount: Number(sp[m]) || 0 })).filter(p => p.amount > 0) : undefined;
      const b = await eng.completeBill({ cartId, lines: cart, discount: discountValue, serviceChargePercent: svcPct, method, split: splitPays, customerName: cust.name, customerMobile: cust.mobile, tableNo: cust.table, notes: cust.notes });
      setSaved(b); reset(); void eng.syncBills().catch(() => null);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function saveDraft() {
    try { await eng.saveDraft({ cartId, lines: cart, discount: discountValue, serviceChargePercent: svcPct, customerName: cust.name, customerMobile: cust.mobile, tableNo: cust.table, notes: cust.notes }); toast('Draft saved', 'ok'); reset(); } catch (e: any) { toast(e.message, 'bad'); }
  }
  const printSaved = async () => { if (!saved) return; const r = await printBill(eng, saved); toast(r.message, r.ok ? 'ok' : 'bad'); };

  const cartPanel = (
    <View style={{ gap: 12 }}>
      {cart.length === 0 ? <Empty text="Tap items to add them to the bill" /> : cart.map(l => (
        <Row key={l.key} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt bold numberOfLines={2}>{l.name}</Txt><Txt small mut>{inr(l.price)}{l.taxRate ? ` · ${l.taxRate}% tax` : ''}</Txt></View>
          <Row style={{ gap: 6 }}>
            <Pressable onPress={() => setQty(l.key, l.qty - 1)} style={{ width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={l.qty === 1 ? 'trash-outline' : 'remove'} size={18} color={t.ink} /></Pressable>
            <Txt bold style={{ minWidth: 22, textAlign: 'center' }}>{l.qty}</Txt>
            <Pressable onPress={() => setQty(l.key, l.qty + 1)} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.pri, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={20} color={t.priInk} /></Pressable>
          </Row>
        </Row>))}
      <Divider />
      <Row><View style={{ flex: 1 }}><Input label={pct ? 'Discount %' : 'Discount ₹'} keyboardType="decimal-pad" value={disc} onChangeText={setDisc} /></View><View style={{ flex: 1 }}><Input label="Service charge %" keyboardType="decimal-pad" value={svc} onChangeText={setSvc} /></View></Row>
      <Toggle label="Discount as percentage" value={pct} onChange={setPct} />
      <Row><View style={{ flex: 1 }}><Input label="Table / order" value={cust.table} onChangeText={v => setCust({ ...cust, table: v })} /></View><View style={{ flex: 1 }}><Input label="Customer name" value={cust.name} onChangeText={v => setCust({ ...cust, name: v })} /></View></Row>
      <Input label="Customer mobile" keyboardType="phone-pad" value={cust.mobile} onChangeText={v => setCust({ ...cust, mobile: v })} />
      <Input label="Notes" value={cust.notes} onChangeText={v => setCust({ ...cust, notes: v })} />
      <Divider />
      <Row style={{ justifyContent: 'space-between' }}><Txt mut>Subtotal</Txt><Txt>{inr(totals.subtotal)}</Txt></Row>
      {totals.discount > 0 ? <Row style={{ justifyContent: 'space-between' }}><Txt mut>Discount</Txt><Txt tone="ok">-{inr(totals.discount)}</Txt></Row> : null}
      {totals.taxBreakup.map(x => <Row key={x.rate} style={{ justifyContent: 'space-between' }}><Txt mut>Tax @{x.rate}%</Txt><Txt>{inr(x.tax)}</Txt></Row>)}
      {totals.serviceCharge > 0 ? <Row style={{ justifyContent: 'space-between' }}><Txt mut>Service charge</Txt><Txt>{inr(totals.serviceCharge)}</Txt></Row> : null}
      <Row style={{ justifyContent: 'space-between' }}><H2>Total</H2><Txt bold style={{ fontSize: 24, fontFamily: F.head, color: t.pri }}>{inr(totals.total)}</Txt></Row>
      <Row style={{ flexWrap: 'wrap' }}>{(['cash', 'upi', 'card'] as PayMethod[]).map(m => <Chip key={m} text={m.toUpperCase()} on={!split && method === m} onPress={() => { setSplit(false); setMethod(m); }} />)}<Chip text="SPLIT" on={split} onPress={() => setSplit(true)} /></Row>
      {split ? <Row>{(['cash', 'upi', 'card'] as PayMethod[]).map(m => <View key={m} style={{ flex: 1 }}><Input label={m.toUpperCase()} keyboardType="decimal-pad" value={sp[m]} onChangeText={v => setSp({ ...sp, [m]: v })} /></View>)}</Row> : null}
      <Btn title={`Complete bill · ${inr(totals.total)}`} onPress={complete} loading={busy} disabled={!cart.length || !canBill} />
      <Row><View style={{ flex: 1 }}><Btn kind="sec" small title="Save as draft" onPress={saveDraft} disabled={!cart.length} /></View><View style={{ flex: 1 }}><Btn kind="sec" small title="Clear" onPress={reset} disabled={!cart.length} /></View></Row>
    </View>
  );

  const avail = L.width - (L.rail ? 88 : 0) - (L.twoPane ? 420 : 0); const cols = Math.max(2, Math.floor(avail / 165));
  return (
    <View style={{ flex: 1 }}>
      <Header title="New bill" right={<Pressable onPress={() => push('drafts')} hitSlop={10} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Ionicons name="document-text-outline" size={20} color={t.pri} /><Txt tone="ok" bold>Drafts</Txt></Pressable>} />
      <View style={{ flex: 1, flexDirection: L.twoPane ? 'row' : 'column' }}>
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: L.pad, gap: 10 }}>
            <Input value={q} onChangeText={setQ} placeholder="Search items or SKU" />
            <FlatList horizontal data={cats} keyExtractor={c => c} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} renderItem={({ item }) => <Chip text={item} on={cat === item} onPress={() => setCat(item)} />} />
          </View>
          <FlatList key={cols} numColumns={cols} data={shown} keyExtractor={p => p.id} contentContainerStyle={{ padding: L.pad - 5, paddingBottom: 110 }}
            ListEmptyComponent={<Empty text={products.length ? 'No items match.' : 'Your menu is empty. Add items in the Menu tab.'} />}
            renderItem={({ item }) => <Tile name={item.name} sub={item.variants.length ? `from ${inr(item.price)}` : inr(item.price)} fav={item.favourite} onPress={() => tap(item)} />} />
        </View>
        {L.twoPane ? <View style={{ width: 420, borderLeftWidth: 1, borderLeftColor: t.line }}><Screen pad max={420}><H2>Current bill</H2>{cartPanel}</Screen></View> : null}
      </View>
      {!L.twoPane && cart.length > 0 ? (
        <Pressable onPress={() => setSheet(true)} style={{ position: 'absolute', left: 16, right: 16, bottom: 14, backgroundColor: t.pri, borderRadius: 18, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 6 }}>
          <Row><Ionicons name="cart" size={22} color={t.priInk} /><Txt style={{ color: t.priInk, fontFamily: F.heavy }}>{count} item{count > 1 ? 's' : ''}</Txt></Row><Txt style={{ color: t.priInk, fontFamily: F.head, fontSize: 18 }}>{inr(totals.total)}  ›</Txt>
        </Pressable>) : null}
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Current bill">{cartPanel}</Sheet>
      <Sheet visible={!!pick} onClose={() => setPick(null)} title={pick?.name || ''}>
        {(['variant', 'addon'] as const).map(kind => { const list = pick?.variants.filter(v => v.kind === kind) || []; return list.length ? (
          <View key={kind} style={{ gap: 8 }}><Txt bold>{kind === 'variant' ? 'Choose a size / variant' : 'Add-ons'}</Txt>
            <Row style={{ flexWrap: 'wrap' }}>{list.map(v => { const on = opts.some(o => o.name === v.name); return <Chip key={v.name} text={`${v.name}${v.priceDelta ? (v.priceDelta > 0 ? ' +' : ' ') + v.priceDelta : ''}`} on={on} onPress={() => setOpts(o => (on ? o.filter(x => x.name !== v.name) : kind === 'variant' ? [...o.filter(x => x.kind !== 'variant'), v] : [...o, v]))} />; })}</Row></View>) : null; })}
        <Btn title="Add to bill" onPress={() => { if (pick) addLine(pick, opts); setPick(null); }} />
      </Sheet>
      <Sheet visible={!!saved} onClose={() => setSaved(null)} title="Bill saved ✓">
        {saved ? <><Txt>Invoice <Txt bold>{saved.invoiceNo}</Txt> · {inr(saved.total)}</Txt><Banner tone="ok">Saved on this phone{saved.synced ? '' : ' — it will sync to the server automatically'}.</Banner>
          <Btn title="Print receipt" onPress={printSaved} /><Btn kind="sec" title="Share PDF invoice" onPress={() => pdfBill(eng, saved).catch(e => toast(e.message, 'bad'))} />
          <Btn kind="sec" title="View receipt" onPress={() => { const b = saved; setSaved(null); push('bill-detail', { bill: b }); }} /><Btn kind="ok" title="New bill" onPress={() => setSaved(null)} /></> : null}
      </Sheet>
    </View>
  );
}

export function Drafts() {
  const { eng, back, setDraft, toast } = useApp(); const [list, setList] = useState<Bill[]>([]); const t = useTheme();
  const load = useCallback(() => { eng.drafts().then(setList); }, [eng]); useEffect(load, [load]);
  return (
    <View style={{ flex: 1 }}><Header title="Drafts" onBack={back} />
      <Screen>{list.length === 0 ? <Empty text="No saved drafts." /> : list.map(d => (
        <Card key={d.clientTxnId}><Row style={{ justifyContent: 'space-between' }}><Txt bold>{d.tableNo ? `Table ${d.tableNo}` : 'Draft'} · {d.items.length} item(s)</Txt><Txt bold tone="ok">{inr(d.total)}</Txt></Row>
          <Txt small mut>{new Date(d.createdAt).toLocaleString()}</Txt>
          <Row><View style={{ flex: 1 }}><Btn small title="Resume" onPress={() => { setDraft(d); back(); }} /></View><View style={{ flex: 1 }}><Btn small kind="bad" title="Delete" onPress={async () => { await eng.deleteDraft(d.clientTxnId); toast('Draft deleted'); load(); }} /></View></Row></Card>))}
      </Screen></View>
  );
}

export function BillDetail({ bill: initial }: { bill: Bill }) {
  const { eng, back, toast, canBill, syncNow } = useApp(); const t = useTheme(); const [bill, setBill] = useState(initial); const [width, setWidth] = useState<58 | 80>(58);
  const [act, setAct] = useState<null | 'void' | 'refunded'>(null); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { eng.printer().then(p => p && setWidth(p.paperWidthMm)); }, [eng]);
  const lines = receiptLines(headerOf(eng), bill, width, bill.printCount > 0);
  async function print() { const r = await printBill(eng, bill); toast(r.message, r.ok ? 'ok' : 'bad'); if (r.ok) setBill({ ...bill, printCount: bill.printCount + 1 }); }
  async function change() {
    if (!act) return; setBusy(true);
    try { const nb = await eng.changeStatus(bill, act, why); setBill(nb); setAct(null); setWhy(''); toast(act === 'void' ? 'Bill voided' : 'Refund recorded', 'ok'); void syncNow(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <View style={{ flex: 1 }}><Header title={bill.invoiceNo || 'Bill'} onBack={back} right={<Pill text={bill.status} tone={statusTone(bill.status)} />} />
      <Screen>
        <Card style={{ backgroundColor: '#fff', borderColor: t.line }}>{lines.map((l, i) => <Txt key={i} style={{ fontFamily: 'Courier', fontSize: 12, color: '#222', textAlign: l.align === 'c' ? 'center' : 'left', fontWeight: l.bold ? '700' : '400' }}>{l.text || ' '}</Txt>)}</Card>
        {bill.syncError ? <Banner tone="warn">Not accepted by the server: {bill.syncError}. It stays on this phone.</Banner> : !bill.synced && !bill.remote ? <Banner tone="info">Waiting to sync.</Banner> : null}
        <Txt small mut>Printed {bill.printCount}× · {new Date(bill.createdAt).toLocaleString()} · cashier {bill.cashier || '—'}</Txt>
        <Btn title={bill.printCount > 0 ? 'Reprint (marked COPY)' : 'Print receipt'} onPress={print} /><Btn kind="sec" title="Share PDF invoice" onPress={() => pdfBill(eng, bill).catch(e => toast(e.message, 'bad'))} />
        {bill.status === 'completed' ? <Row><View style={{ flex: 1 }}><Btn kind="sec" small title="Void" onPress={() => setAct('void')} disabled={!canBill} /></View><View style={{ flex: 1 }}><Btn kind="sec" small title="Refund / credit note" onPress={() => setAct('refunded')} disabled={!canBill} /></View></Row> : null}
      </Screen>
      <Sheet visible={!!act} onClose={() => setAct(null)} title={act === 'void' ? 'Void this bill?' : 'Refund this bill?'}>
        <Txt mut>A reason is required. It is saved in the audit history.</Txt><Input label="Reason" value={why} onChangeText={setWhy} multiline /><Btn kind="bad" title={act === 'void' ? 'Void bill' : 'Record refund'} onPress={change} loading={busy} disabled={!why.trim()} />
      </Sheet>
    </View>
  );
}
