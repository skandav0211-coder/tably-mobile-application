import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../AppContext';
import { Banner, Btn, Card, Chip, Divider, Empty, F, Header, H2, Input, Pill, Row, Screen, Sheet, Tile, Toggle, Txt, useLayout, useTheme } from '../ui/kit';
import { calculate, discountFromPercent, inr, serviceChargeFor } from '../core/calc';
import { receiptLines } from '../core/receipt';
import type { Bill, CartLine, PayMethod, Product, Variant } from '../core/types';
import { headerOf, pdfBill, printBill } from '../print/actions';

const roundMoney = (n:number) => Math.round(n*100)/100;
export const statusTone = (s: string) => (s === 'completed' ? 'ok' : s === 'draft' ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad';

export function NewBill() {
  const { eng, toast, canBill, push, draft, setDraft, uuid } = useApp(); const L = useLayout(); const t = useTheme();
  const { height } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<Product[]>([]); const [q, setQ] = useState(''); const [cat, setCat] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]); const [cartId, setCartId] = useState(() => uuid()); const [pick, setPick] = useState<Product | null>(null); const [opts, setOpts] = useState<Variant[]>([]);
  const [sheet, setSheet] = useState<'cart' | 'saved' | null>(null); const [section, setSection] = useState<'items'|'charges'|'customer'>('items'); const [removed, setRemoved] = useState<{line:CartLine; index:number}|null>(null); const [customName, setCustomName] = useState(''); const [customPrice, setCustomPrice] = useState(''); const [saveCustom, setSaveCustom] = useState(false); const [saved, setSaved] = useState<Bill | null>(null); const [busy, setBusy] = useState(false); const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const touchStartX = useRef<number | null>(null);
  const [disc, setDisc] = useState(''); const [pct, setPct] = useState(false); const [svc, setSvc] = useState(String(eng.taxProfile().serviceChargePercent || 0)); const [method, setMethod] = useState<PayMethod>('cash');
  const [split, setSplit] = useState(false); const [sp, setSp] = useState({ cash: '', upi: '', card: '' }); const [cust, setCust] = useState({ name: '', mobile: '', table: '', notes: '' });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); if (removeTimer.current) clearTimeout(removeTimer.current); };
  }, []);

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

  function commitLine(line: CartLine) {
    if (editingLineKey) {
      const old = cart.find(item => item.key === editingLineKey);
      setCart(current => {
        const remaining = current.filter(item => item.key !== editingLineKey);
        const duplicate = remaining.find(item => item.key === line.key);
        return duplicate
          ? remaining.map(item => item.key === line.key ? { ...item, qty: item.qty + (old?.qty || 1) } : item)
          : [...remaining, { ...line, qty: old?.qty || 1 }];
      });
      setEditingLineKey(null);
      return;
    }
    setCart(current => current.some(item => item.key === line.key)
      ? current.map(item => item.key === line.key ? { ...item, qty: item.qty + line.qty } : item)
      : [...current, line]);
  }
  function addLine(p: Product, o: Variant[]) {
    const variant = o.find(v => v.kind === 'variant'); const addons = o.filter(v => v.kind === 'addon');
    const key = p.id + '|' + o.map(x => x.name).sort().join(','); const price = p.price + o.reduce((a, x) => a + x.priceDelta, 0);
    const name = o.length ? `${p.name} (${o.map(x => x.name).join(', ')})` : p.name;
    commitLine({ key, itemId:p.id, name, price, qty:1, taxRate:p.taxRate, productId:p.id, variantName:variant?.name, addons:addons.map(v=>v.name), custom:false });
  }
  const tap = (p: Product) => { if (!canBill) { toast('Billing is paused — see the banner above.', 'warn'); return; } setEditingLineKey(null); setCustomName(''); setCustomPrice(''); setOpts([]); setPick(p); };
  const editLine = (line: CartLine) => {
    const product = products.find(item => item.id === line.productId);
    if (!product) return;
    setEditingLineKey(line.key);
    setOpts(product.variants.filter(option => line.custom
      ? option.kind === 'addon' && line.addons?.includes(option.name)
      : (option.kind === 'variant' && option.name === line.variantName) || (option.kind === 'addon' && line.addons?.includes(option.name))));
    setCustomName(line.custom ? line.variantName || '' : '');
    setCustomPrice(line.custom ? String(line.price - product.variants.filter(option => option.kind === 'addon' && line.addons?.includes(option.name)).reduce((sum, option) => sum + option.priceDelta, 0)) : '');
    setPick(product);
  };
  const closeOptions = () => { setPick(null); setEditingLineKey(null); setCustomName(''); setCustomPrice(''); setSaveCustom(false); };
  const setQty = (key: string, n: number) => setCart(c => {
    if (n > 0) return c.map(l => l.key === key ? { ...l, qty:n } : l);
    const index=c.findIndex(l=>l.key===key); if(index<0)return c;
    const line=c[index]; setRemoved({line:{...line},index});
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = setTimeout(()=>setRemoved(null),5000);
    return c.filter(l=>l.key!==key);
  });
  const undoRemove = () => { if(!removed)return; if (removeTimer.current) clearTimeout(removeTimer.current); setCart(c=>{const next=[...c];next.splice(Math.min(removed.index,next.length),0,removed.line);return next}); setRemoved(null); };
  const isProductLine = (line: CartLine, p: Product) => line.itemId === p.id
    || (line.itemId === p.name && (line.name === p.name || line.name.startsWith(`${p.name} (`)));
  const quantityFor = (p: Product) => cart.filter(line => isProductLine(line, p)).reduce((sum, line) => sum + line.qty, 0);
  const decreaseProduct = (p: Product) => {
    const line = [...cart].reverse().find(item => isProductLine(item, p));
    if (line) setQty(line.key, line.qty - 1);
  };
  const reset = (closeSheet = true) => { setCart([]); setCartId(uuid()); setDisc(''); setSplit(false); setSp({ cash: '', upi: '', card: '' }); setCust({ name: '', mobile: '', table: '', notes: '' }); setRemoved(null); if (closeSheet) setSheet(null); };
  const clearBill = () => { if(!cart.length)return; Alert.alert('Clear bill?', 'Remove all items and reset charges and customer details.', [{text:'Cancel',style:'cancel'}, {text:'Clear',style:'destructive',onPress:()=>reset(false)}]); };

  async function complete() {
    if (busy) return;
    setBusy(true);
    try {
      const splitPays = split ? (['cash', 'upi', 'card'] as PayMethod[]).map(m => ({ method: m, amount: Number(sp[m]) || 0 })).filter(p => p.amount > 0) : undefined;
      const b = await eng.completeBill({ cartId, lines: cart, discount: discountValue, serviceChargePercent: svcPct, method, split: splitPays, customerName: cust.name, customerMobile: cust.mobile, tableNo: cust.table, notes: cust.notes });
      setSaved(b);
      reset(false);
      setSheet('saved');
      void eng.syncBills().then(async result => {
        const latest = await eng.store.getBill(b.clientTxnId);
        if (latest) setSaved(current => current?.clientTxnId === b.clientTxnId ? latest : current);
        if (latest?.syncError) toast(`Bill saved on this phone, but the server rejected it: ${latest.syncError}`, 'warn');
        else if (result.pending > 0 && result.accepted === 0) toast('Bill saved on this phone and will sync when the connection is available.', 'info');
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        toast(`Bill saved on this phone. Sync is pending: ${message}`, 'warn');
      });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function saveDraft() {
    try { await eng.saveDraft({ cartId, lines: cart, discount: discountValue, serviceChargePercent: svcPct, customerName: cust.name, customerMobile: cust.mobile, tableNo: cust.table, notes: cust.notes }); toast('Draft saved', 'ok'); reset(); } catch (e: any) { toast(e.message, 'bad'); }
  }
  const printSaved = async () => { if (!saved) return; const r = await printBill(eng, saved); toast(r.message, r.ok ? 'ok' : 'bad'); };

  const customerSummary = cust.name || cust.mobile || (cust.table ? `Table ${cust.table}` : 'Add customer details');
  const chargesSummary = [
    discountValue > 0 ? `Discount ${inr(discountValue)}` : '',
    svcAmt > 0 ? `Service ${inr(svcAmt)}` : '',
    split ? 'Split payment' : method.toUpperCase(),
  ].filter(Boolean).join(' · ');
  const sectionHeader = (key: 'items' | 'charges' | 'customer', title: string, summary: string, icon: React.ComponentProps<typeof Ionicons>['name']) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: section === key }}
      onPress={() => setSection(section === key ? 'items' : key)}
      style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.card }}
    >
      <Ionicons name={icon} size={20} color={t.pri} />
      <View style={{ flex: 1 }}><Txt bold>{title}</Txt>{section !== key ? <Txt small mut numberOfLines={1}>{summary}</Txt> : null}</View>
      <Ionicons name={section === key ? 'chevron-up' : 'chevron-down'} size={19} color={t.mut} />
    </Pressable>
  );
  const undoNotice = removed ? <View style={{ backgroundColor: t.priSoft, borderRadius: 12, padding: 12 }}><Row style={{ justifyContent: 'space-between' }}><Txt style={{ flex: 1, color: t.pri }}>Removed {removed.line.name}.</Txt><Pressable accessibilityRole="button" onPress={undoRemove}><Txt bold style={{ color: t.pri }}>Undo</Txt></Pressable></Row></View> : null;
  const cartSections = (
    <View style={{ gap: 12 }}>
      {sectionHeader('items', 'Items', `${count} item${count === 1 ? '' : 's'}`, 'cart-outline')}
      {section === 'items' ? <View style={{ gap: 12 }}>
      <Row style={{justifyContent:'space-between'}}><Txt small mut>{count} item{count === 1 ? '' : 's'} · {inr(totals.subtotal)}</Txt>{cart.length?<Pressable onPress={clearBill} hitSlop={8}><Txt tone="bad" bold>Clear bill</Txt></Pressable>:null}</Row>
      {undoNotice}
      {cart.length === 0 ? <Empty text="Tap items in the menu to add them to this bill." /> : cart.map(l => (
        <View key={l.key} onTouchStart={event => { touchStartX.current = event.nativeEvent.pageX; }} onTouchEnd={event => {
          const startX = touchStartX.current; touchStartX.current = null;
          if (startX != null && startX - event.nativeEvent.pageX > 80) setQty(l.key, 0);
        }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Pressable accessibilityRole={l.productId ? 'button' : undefined} accessibilityLabel={l.productId ? `Edit size and add-ons for ${l.name}` : undefined} onPress={() => editLine(l)} style={{ flex: 1 }}><Txt bold numberOfLines={2}>{l.name}</Txt><Txt small mut>{inr(l.price)}{l.taxRate ? ` · ${l.taxRate}% tax` : ''}</Txt></Pressable>
          <Row style={{ gap: 6 }}>
            <Pressable accessibilityLabel={`Remove ${l.name} from bill`} onPress={() => setQty(l.key, l.qty - 1)} style={{ width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={l.qty === 1 ? 'trash-outline' : 'remove'} size={18} color={t.ink} /></Pressable>
            <Txt bold style={{ minWidth: 22, textAlign: 'center' }}>{l.qty}</Txt>
            <Pressable onPress={() => setQty(l.key, l.qty + 1)} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.pri, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={20} color={t.priInk} /></Pressable>
            <Pressable accessibilityLabel={`Remove line ${l.name}`} onPress={() => setQty(l.key, 0)} style={{ width:38,height:38,borderRadius:12,borderWidth:1,borderColor:t.bad,alignItems:'center',justifyContent:'center' }}><Ionicons name="close" size={18} color={t.bad} /></Pressable>
          </Row>
        </Row>
        </View>))}
      </View> : null}
      {sectionHeader('charges', 'Charges', chargesSummary, 'pricetag-outline')}
      {section === 'charges' ? <View style={{ gap: 12 }}>
      <Row><View style={{ flex: 1 }}><Input label={pct ? 'Discount %' : 'Discount ₹'} keyboardType="decimal-pad" value={disc} onChangeText={setDisc} /></View><View style={{ flex: 1 }}><Input label="Service charge %" keyboardType="decimal-pad" value={svc} onChangeText={setSvc} /></View></Row>
      <Toggle label="Discount as percentage" value={pct} onChange={setPct} />
      <Row style={{ flexWrap: 'wrap' }}>{(['cash', 'upi', 'card'] as PayMethod[]).map(m => <Chip key={m} text={m.toUpperCase()} on={!split && method === m} onPress={() => { setSplit(false); setMethod(m); }} />)}<Chip text="SPLIT" on={split} onPress={() => setSplit(true)} /></Row>
      {split ? <Row>{(['cash', 'upi', 'card'] as PayMethod[]).map(m => <View key={m} style={{ flex: 1 }}><Input label={m.toUpperCase()} keyboardType="decimal-pad" value={sp[m]} onChangeText={v => setSp({ ...sp, [m]: v })} /></View>)}</Row> : null}
      </View> : null}
      {sectionHeader('customer', 'Customer details', customerSummary, 'person-outline')}
      {section === 'customer' ? <View style={{ gap: 12 }}>
        <Row><View style={{ flex: 1 }}><Input label="Table / order" value={cust.table} onChangeText={v => setCust({ ...cust, table: v })} /></View><View style={{ flex: 1 }}><Input label="Customer name" value={cust.name} onChangeText={v => setCust({ ...cust, name: v })} /></View></Row>
        <Input label="Customer mobile" keyboardType="phone-pad" value={cust.mobile} onChangeText={v => setCust({ ...cust, mobile: v })} />
        <Input label="Notes" value={cust.notes} onChangeText={v => setCust({ ...cust, notes: v })} />
      </View> : null}
    </View>
  );
  const cartFooter = (compact: boolean) => (
    <View style={{ borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.card, padding: 14, gap: 7 }}>
      {!compact ? <>
        <Row style={{ justifyContent: 'space-between' }}><Txt small mut>Subtotal</Txt><Txt small>{inr(totals.subtotal)}</Txt></Row>
        {totals.discount > 0 ? <Row style={{ justifyContent: 'space-between' }}><Txt small mut>Discount</Txt><Txt small tone="ok">−{inr(totals.discount)}</Txt></Row> : null}
        {totals.serviceCharge > 0 ? <Row style={{ justifyContent: 'space-between' }}><Txt small mut>Service charge</Txt><Txt small>{inr(totals.serviceCharge)}</Txt></Row> : null}
        {totals.tax > 0 ? <Row style={{ justifyContent: 'space-between' }}><Txt small mut>Tax</Txt><Txt small>{inr(totals.tax)}</Txt></Row> : null}
      </> : null}
      <Row style={{ justifyContent: 'space-between' }}><H2>Total</H2><Txt bold style={{ fontSize: compact ? 22 : 25, fontFamily: F.head, color: t.pri }}>{inr(totals.total)}</Txt></Row>
      <Btn title={compact ? 'Charge' : `Charge · ${inr(totals.total)}`} onPress={complete} loading={busy} disabled={!cart.length || !canBill} />
      {!compact ? <Row><View style={{ flex: 1 }}><Btn kind="sec" small title="Save draft" onPress={saveDraft} disabled={!cart.length} /></View><View style={{ flex: 1 }}><Btn kind="sec" small title="Clear bill" onPress={clearBill} disabled={!cart.length} /></View></Row> : null}
    </View>
  );

  const avail = L.width - (L.rail ? 88 : 0) - (L.twoPane ? L.cartWidth : 0); const cols = Math.max(2, Math.floor(avail / 165));
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
            renderItem={({ item }) => <Tile name={item.name} sub={item.variants.length ? `from ${inr(item.price)}` : inr(item.price)} fav={item.favourite} quantity={quantityFor(item)} onDecrease={() => decreaseProduct(item)} onPress={() => tap(item)} />} />
        </View>
        {L.twoPane ? <View style={{ width: L.cartWidth, borderLeftWidth: 1, borderLeftColor: t.line }}>
          <View style={{ flex: 1, padding: 14 }}><H2>Current bill</H2><ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingVertical: 8 }} keyboardShouldPersistTaps="handled">{cartSections}</ScrollView></View>
          {cartFooter(keyboardOpen || height < 460)}
        </View> : null}
      </View>
      {!L.twoPane && cart.length > 0 ? (
        <Pressable onPress={() => setSheet('cart')} style={{ position: 'absolute', left: 16, right: 16, bottom: 14, backgroundColor: t.pri, borderRadius: 18, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 6 }}>
          <Row><Ionicons name="cart" size={22} color={t.priInk} /><Txt style={{ color: t.priInk, fontFamily: F.heavy }}>{count} item{count > 1 ? 's' : ''}</Txt></Row><Txt style={{ color: t.priInk, fontFamily: F.head, fontSize: 18 }}>{inr(totals.total)}  ›</Txt>
        </Pressable>) : null}
      {removed && sheet !== 'cart' ? <View style={{ position: 'absolute', left: 16, right: 16, bottom: cart.length ? 82 : 16, zIndex: 5 }}>{undoNotice}</View> : null}
      <Modal visible={sheet === 'cart'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,15,30,.55)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheet(null)} accessibilityLabel="Close current bill" />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ maxHeight: height - insets.top - 8, backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 8) }}>
              <Row style={{ justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 8 }}><H2>Current bill</H2><Pressable onPress={() => setSheet(null)} accessibilityLabel="Close current bill"><Ionicons name="close" size={25} color={t.mut} /></Pressable></Row>
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">{cartSections}</ScrollView>
              {cartFooter(keyboardOpen || height < 460)}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <Sheet visible={sheet === 'saved'} onClose={() => setSheet(null)} title="Bill saved ✓">
        {saved ? <><Txt>Invoice <Txt bold>{saved.invoiceNo}</Txt> · {inr(saved.total)}</Txt><Banner tone={saved.syncError ? 'warn' : 'ok'}>{saved.synced ? 'Saved on this phone and synced to the server.' : saved.syncError ? `Saved on this phone, but the server rejected it: ${saved.syncError}` : 'Saved on this phone and queued to sync. It will stay here until sync succeeds.'}</Banner>
          <Btn title="Print receipt" onPress={printSaved} /><Btn kind="sec" title="Share PDF receipt" onPress={() => pdfBill(eng, saved).catch(e => toast(e.message, 'bad'))} />
          <Btn kind="sec" title="View receipt" onPress={() => { const b = saved; setSheet(null); setSaved(null); push('bill-detail', { bill: b }); }} /><Btn kind="ok" title="New bill" onPress={() => { setSheet(null); setSaved(null); }} /></> : null}
      </Sheet>
      <Sheet visible={!!pick} onClose={closeOptions} title={editingLineKey ? 'Size and add-ons' : pick?.name || ''}>
        {(['variant', 'addon'] as const).map(kind => { const list = pick?.variants.filter(v => v.kind === kind) || []; return list.length ? (
          <View key={kind} style={{ gap: 8 }}><Txt bold>{kind === 'variant' ? 'Choose a size / variant' : 'Add-ons'}</Txt>
            <Row style={{ flexWrap: 'wrap' }}>{list.map(v => { const on = opts.some(o => o.name === v.name); return <Chip key={v.name} text={`${v.name}${v.priceDelta ? (v.priceDelta > 0 ? ' +' : ' ') + v.priceDelta : ''}`} on={on} onPress={() => setOpts(o => (on ? o.filter(x => x.name !== v.name) : kind === 'variant' ? [...o.filter(x => x.kind !== 'variant'), v] : [...o, v]))} />; })}</Row></View>) : null; })}
        <Divider /><H2>Custom size</H2>
        <Input label="Size name (max 20)" value={customName} maxLength={20} onChangeText={setCustomName} />
        <Input label="Price ₹ (0–10,000,000)" keyboardType="decimal-pad" value={customPrice} onChangeText={setCustomPrice} />
        {canBill ? <Toggle label="Save this size to the menu" value={saveCustom} onChange={setSaveCustom} /> : null}
        <Btn title="Add custom size" kind="sec" onPress={() => {
          if(!pick)return; const name=customName.trim(), price=Number(customPrice);
          if(!name||!Number.isFinite(price)||price<0||price>10000000)return toast('Enter a valid size name and price.','bad');
          const existingVariant=pick.variants.find(option=>option.kind==='variant'&&option.name.trim().toLowerCase()===name.toLowerCase());
          if(saveCustom&&pick.variants.length>=30&&!existingVariant)return toast('This menu item already has the maximum of 30 options.','bad');
          const customVariant={name,priceDelta:roundMoney(price-pick.price),kind:'variant' as const};
          const addons=opts.filter(v=>v.kind==='addon'); const key=pick.id+'|custom|'+name+'|'+addons.map(addon=>addon.name).sort().join(',');
          const addonPrice=addons.reduce((sum,addon)=>sum+addon.priceDelta,0);
          const display=`${pick.name} (${name}${addons.length ? `, ${addons.map(addon=>addon.name).join(', ')}` : ''})`;
          commitLine({key,itemId:pick.id,name:display,price:roundMoney(price+addonPrice),qty:1,taxRate:pick.taxRate,productId:pick.id,variantName:name,addons:addons.map(addon=>addon.name),custom:true});
          if(saveCustom&&canBill) {
            const variants=existingVariant
              ? pick.variants.map(option=>option===existingVariant?customVariant:option)
              : [...pick.variants,customVariant];
            void eng.saveProduct(pick.id,{...pick,variants}).then(setProducts).catch(e=>toast(e.message,'bad'));
          }
          setCustomName('');setCustomPrice('');setSaveCustom(false);setPick(null);setEditingLineKey(null);
        }} />
        <Btn title={editingLineKey ? 'Update line' : 'Add selected sizes to bill'} onPress={() => { if (pick) addLine(pick, opts); setPick(null); }} />
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
        <Row><Txt small bold>Receipt width</Txt><Chip text="58 mm" on={width === 58} onPress={() => setWidth(58)} /><Chip text="80 mm" on={width === 80} onPress={() => setWidth(80)} /></Row>
        <Card style={{ backgroundColor: '#fff', borderColor: t.line }}>{lines.map((l, i) => <Txt key={i} style={{ fontFamily: 'Courier', fontSize: l.big ? 14 : 11, color: '#222', textAlign: l.align === 'c' ? 'center' : l.align === 'r' ? 'right' : 'left', fontWeight: l.bold ? '700' : '400' }}>{l.text || ' '}</Txt>)}</Card>
        {bill.syncError ? <Banner tone="warn">Not accepted by the server: {bill.syncError}. It stays on this phone.</Banner> : !bill.synced && !bill.remote ? <Banner tone="info">Waiting to sync.</Banner> : null}
        <Txt small mut>Printed {bill.printCount}× · {new Date(bill.createdAt).toLocaleString()} · cashier {bill.cashier || '—'}</Txt>
        <Btn title={bill.printCount > 0 ? 'Reprint (marked COPY)' : 'Print receipt'} onPress={print} /><Btn kind="sec" title={`Share ${width} mm PDF receipt`} onPress={() => pdfBill(eng, bill, width).catch(e => toast(e.message, 'bad'))} />
        {bill.status === 'completed' ? <Row><View style={{ flex: 1 }}><Btn kind="sec" small title="Void" onPress={() => setAct('void')} disabled={!canBill} /></View><View style={{ flex: 1 }}><Btn kind="sec" small title="Refund / credit note" onPress={() => setAct('refunded')} disabled={!canBill} /></View></Row> : null}
      </Screen>
      <Sheet visible={!!act} onClose={() => setAct(null)} title={act === 'void' ? 'Void this bill?' : 'Refund this bill?'}>
        <Txt mut>A reason is required. It is saved in the audit history.</Txt><Input label="Reason" value={why} onChangeText={setWhy} multiline /><Btn kind="bad" title={act === 'void' ? 'Void bill' : 'Record refund'} onPress={change} loading={busy} disabled={!why.trim()} />
      </Sheet>
    </View>
  );
}
