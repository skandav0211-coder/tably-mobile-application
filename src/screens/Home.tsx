import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp, Tab } from '../AppContext';
import { Banner, Brand, Btn, Card, Chip, Divider, Empty, F, Header, H1, H2, Input, Mark, Pill, Row, Screen, Toggle, Txt, useLayout, useTheme } from '../ui/kit';
import { useThemeMode } from '../ui/theme';
import { NewBill } from './Billing';
import { Menu, SalesReports } from './Manage';
import { InventoryScreen } from './Inventory';
import { DeviceList } from './Device';
import { STATUS_LABEL } from './Onboarding';
import { pairedBluetoothPrinters, printBytes } from '../print/printer';
import { testPageLines, toEscPos } from '../core/receipt';
import type { PrinterConfig } from '../core/types';

const TABS: { k: Tab; label: string; icon: any }[] = [
  { k: 'bill', label: 'Bill', icon: 'cart-outline' }, { k: 'menu', label: 'Menu', icon: 'restaurant-outline' },
  { k: 'sales-reports', label: 'Sales & Reports', icon: 'bar-chart-outline' }, { k: 'inventory', label: 'Inventory', icon: 'cube-outline' },
  { k: 'more', label: 'More', icon: 'menu-outline' }];

/** Notice strip shown above every tab: paused billing and the one-time MPIN suggestion. */
function Notices() {
  const { canBill, me, push, mpinOn, eng } = useApp(); const [dismissed, setDismissed] = useState(true);
  useEffect(() => { eng.store.kv.get('mpinNudge').then(v => setDismissed(v === '1')); }, [eng]);
  const s = me?.subscription; const L = useLayout();
  return (
    <View style={{ paddingHorizontal: L.pad, gap: 8, paddingTop: 4 }}>
      {!canBill ? <Banner tone="bad" action={{ title: 'Open subscription ›', onPress: () => push('subscription') }}>Billing is paused{s ? ` — subscription ${STATUS_LABEL[s.status]?.toLowerCase() || s.status}` : ''}. Your past bills stay available.</Banner>
        : s?.reminder ? <Banner tone="warn" action={{ title: 'Renew now ›', onPress: () => push('subscription') }}>Your subscription ends in {s.daysLeft} day(s).</Banner> : null}
      {!mpinOn && !dismissed ? <Banner tone="info" action={{ title: 'Set up MPIN ›', onPress: () => push('mpin') }}>Protect your sales data — add an MPIN lock.</Banner> : null}
      {!mpinOn && !dismissed ? <Pressable onPress={() => { setDismissed(true); void eng.store.kv.set('mpinNudge', '1'); }}><Txt small mut style={{ textAlign: 'right' }}>Not now</Txt></Pressable> : null}
    </View>
  );
}

export function Home() {
  const { tab, setTab } = useApp(); const L = useLayout(); const t = useTheme(); const ins = useSafeAreaInsets();
  const body = (
    <View style={{ flex: 1 }}>
      <Notices />
      <View style={{ flex: 1 }}>{tab === 'bill' ? <NewBill /> : tab === 'menu' ? <Menu /> : tab === 'sales-reports' ? <SalesReports /> : tab === 'inventory' ? <InventoryScreen embedded /> : <More />}</View>
    </View>);
  if (L.rail) return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      <ScrollView style={{ width: 92, backgroundColor: t.side }} contentContainerStyle={{ alignItems: 'center', paddingTop: ins.top + 16, paddingBottom: Math.max(ins.bottom, 12), gap: 6 }} showsVerticalScrollIndicator={false}>
        <Mark size={44} /><View style={{ height: 14 }} />
        {TABS.map(x => <Pressable key={x.k} onPress={() => setTab(x.k)} style={{ width: 76, minHeight: 58, paddingVertical: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: tab === x.k ? 'rgba(217,115,28,0.22)' : 'transparent' }} accessibilityRole="tab" accessibilityLabel={x.label} accessibilityState={{ selected: tab === x.k }}>
          <Ionicons name={x.icon} size={24} color={tab === x.k ? '#F59A4A' : '#CDBFBF'} /><Txt small numberOfLines={2} style={{ maxWidth: 72, textAlign: 'center', fontSize: 11, lineHeight: 13, color: tab === x.k ? '#F59A4A' : '#CDBFB5', fontFamily: F.bold }}>{x.label}</Txt></Pressable>)}
      </ScrollView>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>{body}</SafeAreaView>
    </View>);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>{body}</SafeAreaView>
      <View style={{ flexDirection: 'row', backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.line, paddingBottom: Math.max(ins.bottom, 6), paddingTop: 6 }}>
        {TABS.map(x => <Pressable key={x.k} onPress={() => setTab(x.k)} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingVertical: 4 }} accessibilityRole="tab" accessibilityLabel={x.label} accessibilityState={{ selected: tab === x.k }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 3, borderRadius: 14, backgroundColor: tab === x.k ? t.priSoft : 'transparent' }}><Ionicons name={x.icon} size={22} color={tab === x.k ? t.pri : t.mut} /></View>
          <Txt small numberOfLines={2} style={{ maxWidth: '100%', textAlign: 'center', fontSize: 10, lineHeight: 12, color: tab === x.k ? t.pri : t.mut, fontFamily: F.bold }}>{x.label}</Txt></Pressable>)}
      </View>
    </View>);
}

export function OfflineRequired() {
  const { refreshAll, startupError, connecting } = useApp(); const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen max={560}>
        <Mark size={52} />
        <H1>Unable to verify Tably</H1>
        <Txt>Tably must reach the server to validate your subscription and sync this device's pending bills before opening. Check your connection, then try again.</Txt>
        {startupError ? <Banner tone="warn">{startupError}</Banner> : null}
        <Btn title="Try again" onPress={() => void refreshAll()} loading={connecting} />
      </Screen>
    </SafeAreaView>
  );
}

// ───────────────────────── Registered, not yet subscribed ─────────────────────────
export function LockedHome() {
  const { me, push, signOut, refreshAll, toast, mpinOn } = useApp(); const t = useTheme(); const [busy, setBusy] = useState(false);
  const s = me?.subscription; const status = s?.status || 'none'; const pending = status === 'pending'; const rejected = status === 'rejected';
  const steps: [string, boolean][] = [['Account created', true], ['Subscribe and pay', pending], ['Owner approves your payment', false], ['Register this device and start billing', false]];
  const feats: [any, string][] = [['cart-outline', 'Billing & receipts'], ['restaurant-outline', 'Menu management'], ['receipt-outline', 'Sales history'], ['bar-chart-outline', 'Reports & exports'], ['print-outline', 'Thermal printing'], ['phone-portrait-outline', 'Up to 3 devices']];
  async function check() { setBusy(true); try { await refreshAll(); toast('Status updated', 'ok'); } finally { setBusy(false); } }
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen max={640}>
        <Row style={{ justifyContent: 'space-between' }}><Row><Mark size={36} /><View><Txt bold>{me?.business?.name || 'Tably'}</Txt><Txt small mut>{me?.user.ownerName || ''}</Txt></View></Row><Pill text={STATUS_LABEL[status] || status} tone={pending ? 'warn' : rejected ? 'bad' : 'info'} /></Row>
        <Card style={{ backgroundColor: t.pri, borderColor: t.pri, gap: 10 }}>
          <Txt style={{ color: t.priInk, fontFamily: F.head, fontSize: 24 }}>{pending ? 'Payment under review' : "You're registered!"}</Txt>
          <Txt style={{ color: t.priInk }}>{pending ? 'The owner is checking your payment. Tably unlocks as soon as it is approved — usually nothing more is needed from you.' : 'Subscribe to unlock billing, menu, sales, reports and printing. You can look around and set up security while you wait.'}</Txt>
          {!pending ? <Pressable onPress={() => push('subscription')} style={{ backgroundColor: t.priInk, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}><Ionicons name="lock-open-outline" size={20} color={t.pri} /><Txt style={{ color: t.pri, fontFamily: F.heavy, fontSize: 16 }}>{rejected ? 'Submit payment again' : 'Subscribe to unlock'}</Txt></Pressable>
            : <Pressable onPress={() => push('subscription')} style={{ borderColor: t.priInk, borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, alignItems: 'center' }}><Txt style={{ color: t.priInk, fontFamily: F.heavy }}>View payment details</Txt></Pressable>}
        </Card>
        {s?.message ? <Banner tone={rejected ? 'bad' : 'info'}>Message from support: {s.message}</Banner> : null}
        <Card><H2>What you unlock</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{feats.map(([ic, l]) => <View key={l} style={{ width: '47%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: t.priSoft }}><Ionicons name="lock-closed" size={16} color={t.pri} /><Txt small bold style={{ flex: 1 }}>{l}</Txt></View>)}</View></Card>
        <Card><H2>How it works</H2>{steps.map(([l, now], i) => <Row key={l}><View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: i === 0 ? t.ok : now ? t.pri : t.line }}>{i === 0 ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Txt small bold style={{ color: now ? t.priInk : t.mut }}>{i + 1}</Txt>}</View><Txt bold={now} mut={!now && i > 0}>{l}</Txt></Row>)}</Card>
        <Btn kind="sec" title="Refresh status" onPress={check} loading={busy} />
        <Card><H2>Account</H2>
          <MenuRow icon="business-outline" label="Business profile" onPress={() => push('business')} />
          <MenuRow icon="shield-checkmark-outline" label="Security · MPIN lock" value={mpinOn ? 'On' : 'Off'} onPress={() => push('mpin')} />
          <MenuRow icon="chatbubbles-outline" label="Contact support" onPress={() => push('support')} />
          <MenuRow icon="log-out-outline" label="Sign out" onPress={signOut} danger />
        </Card>
      </Screen>
    </SafeAreaView>);
}

export function MenuRow({ icon, label, value, onPress, danger, badge }: { icon: any; label: string; value?: string; onPress: () => void; danger?: boolean; badge?: number }) {
  const t = useTheme();
  return <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })} accessibilityRole="button">
    <Ionicons name={icon} size={22} color={danger ? t.bad : t.pri} /><Txt bold style={{ flex: 1, color: danger ? t.bad : t.ink }}>{label}</Txt>
    {badge ? <Pill text={String(badge)} tone="bad" /> : null}{value ? <Txt mut>{value}</Txt> : null}<Ionicons name="chevron-forward" size={18} color={t.mut} /></Pressable>;
}

// ───────────────────────── More ─────────────────────────
export function More() {
  const { me, push, signOut, syncNow, unsynced, mpinOn, versionName, canBill, eng, toast } = useApp(); const [unread, setUnread] = useState(0);
  const { mode, setMode } = useThemeMode();
  const t = useTheme();
  const [changingTheme, setChangingTheme] = useState(false);
  useEffect(() => { eng.notifications().then(n => setUnread(n.filter(x => !x.read).length)).catch(() => null); }, [eng]);
  async function toggleTheme() {
    const nextMode = mode === 'dark' ? 'light' : 'dark';
    setChangingTheme(true);
    try {
      await setMode(nextMode);
      toast(`Switched to ${nextMode} mode`, 'ok');
    } catch (error) {
      console.error('Unable to save appearance preference:', error);
    } finally {
      setChangingTheme(false);
    }
  }
  const s = me?.subscription;
  return (
    <View style={{ flex: 1 }}><Header title="More" />
      <Screen max={640}>
        <Card><Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><H2>{me?.business?.name || 'Business'}</H2><Txt small mut>{me?.user.phone || ''}</Txt><Txt small mut>{me?.user.email || ''}</Txt></View>{s ? <Pill text={STATUS_LABEL[s.status] || s.status} tone={canBill ? 'ok' : 'bad'} /> : null}</Row></Card>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ flex: 1 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.priSoft }}>
                <Ionicons name={mode === 'dark' ? 'moon' : 'sunny'} size={21} color={t.pri} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <H2>Appearance</H2>
                <Txt small mut>{mode === 'dark' ? 'Dark mode is on' : 'Light mode is on'}</Txt>
              </View>
            </Row>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
              accessibilityHint="Changes the app appearance and saves your choice on this device."
              disabled={changingTheme}
              onPress={() => void toggleTheme()}
              style={({ pressed }) => ({
                minHeight: 42,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                paddingHorizontal: 12,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: t.line,
                backgroundColor: t.card,
                opacity: changingTheme ? 0.55 : pressed ? 0.72 : 1,
              })}
            >
              <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={17} color={t.pri} />
              <Txt small bold style={{ color: t.pri }}>{mode === 'dark' ? 'Light' : 'Dark'}</Txt>
            </Pressable>
          </Row>
        </Card>
        <Card>
          <MenuRow icon="card-outline" label="Subscription" value={s?.daysLeft != null ? `${s.daysLeft} days left` : undefined} onPress={() => push('subscription')} />
          {me?.features?.inventory ? <><Divider /><MenuRow icon="cube-outline" label="Inventory" onPress={() => push('inventory')} /></> : null}
          <Divider /><MenuRow icon="business-outline" label="Business profile & tax" onPress={() => push('business')} />
          <Divider /><MenuRow icon="print-outline" label="Printer" onPress={() => push('printer')} />
          <Divider /><MenuRow icon="phone-portrait-outline" label="Devices" value={me ? `${me.deviceSlots.used}/${me.deviceSlots.max}` : undefined} onPress={() => push('devices')} />
          <Divider /><MenuRow icon="notifications-outline" label="Notifications" badge={unread} onPress={() => push('notifications')} />
          <Divider /><MenuRow icon="shield-checkmark-outline" label="Security · MPIN lock" value={mpinOn ? 'On' : 'Off'} onPress={() => push('mpin')} />
          <Divider /><MenuRow icon="sync-outline" label="Sync now" value={unsynced ? `${unsynced} waiting` : 'Up to date'} onPress={syncNow} />
          <Divider /><MenuRow icon="chatbubbles-outline" label="Support" onPress={() => push('support')} />
        </Card>
        <Card><MenuRow icon="log-out-outline" label="Sign out" onPress={signOut} danger /></Card>
        <Txt small mut style={{ textAlign: 'center' }}>Tably {versionName}</Txt>
      </Screen>
    </View>);
}

export function DevicesScreen() { const { back } = useApp(); return <View style={{ flex: 1 }}><Header title="Devices" onBack={back} /><Screen><DeviceList /></Screen></View>; }

export function Printer() {
  const { eng, back, toast } = useApp(); const [cfg, setCfg] = useState<PrinterConfig>({ kind: 'bluetooth', address: '', name: '', paperWidthMm: 58 }); const [found, setFound] = useState<{ name: string; address: string }[] | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { eng.printer().then(p => p && setCfg(p)); }, [eng]);
  const valid = cfg.kind === 'bluetooth' ? !!cfg.address : /^[A-Za-z0-9.\-]+(:\d{2,5})?$/.test(cfg.address.trim());
  async function find() { try { setFound(await pairedBluetoothPrinters()); } catch (e: any) { toast(e.message, 'bad'); } }
  async function save() { await eng.setPrinter({ ...cfg, address: cfg.address.trim(), name: cfg.name || cfg.address.trim() }); toast('Printer saved', 'ok'); }
  async function test() { setBusy(true); try { await printBytes({ ...cfg, address: cfg.address.trim() }, toEscPos(testPageLines(cfg.paperWidthMm))); toast('Test page sent', 'ok'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }
  return (
    <View style={{ flex: 1 }}><Header title="Printer" onBack={back} />
      <Screen>
        <Txt mut>Connect a 58 mm or 80 mm ESC/POS thermal printer. If printing is unavailable you can always share a PDF.</Txt>
        <Row>{(['bluetooth', 'network'] as const).map(k => <Chip key={k} text={k === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi / LAN'} on={cfg.kind === k} onPress={() => setCfg({ ...cfg, kind: k, address: '', name: '' })} />)}</Row>
        {cfg.kind === 'bluetooth' ? <>
          <Txt small mut>Pair the printer in Android Bluetooth settings first, then pick it here.</Txt><Btn kind="sec" title="Find paired printers" onPress={find} />
          {found ? (found.length ? found.map(d => <Card key={d.address} onPress={() => setCfg({ ...cfg, address: d.address, name: d.name })}><Row style={{ justifyContent: 'space-between' }}><View><Txt bold>{d.name}</Txt><Txt small mut>{d.address}</Txt></View>{cfg.address === d.address ? <Pill text="Selected" tone="ok" /> : null}</Row></Card>) : <Empty text="No paired devices found." />) : cfg.address ? <Txt>Selected: <Txt bold>{cfg.name || cfg.address}</Txt></Txt> : null}
        </> : <Input label="Printer address (host or host:port)" value={cfg.address} onChangeText={v => setCfg({ ...cfg, address: v, name: v })} autoCapitalize="none" placeholder="192.168.1.50:9100" error={cfg.address && !valid ? 'Enter an IP or host, e.g. 192.168.1.50:9100' : null} />}
        <Txt small bold>Paper width</Txt><Row>{([58, 80] as const).map(w => <Chip key={w} text={`${w} mm`} on={cfg.paperWidthMm === w} onPress={() => setCfg({ ...cfg, paperWidthMm: w })} />)}</Row>
        <Btn title="Save printer" onPress={save} disabled={!valid} /><Btn kind="sec" title="Print test page" onPress={test} loading={busy} disabled={!valid} />
        <Btn kind="bad" title="Remove printer" onPress={async () => { await eng.setPrinter(null); setCfg({ kind: 'bluetooth', address: '', name: '', paperWidthMm: 58 }); toast('Printer removed'); }} />
      </Screen>
    </View>);
}

export function BusinessSettings() {
  const { eng, me, back, toast, reloadMe } = useApp(); const b = me?.business; const tp = eng.taxProfile();
  const [f, setF] = useState({ name: b?.name || '', address: b?.address || '', contact: b?.contact || '', gstin: b?.gstin || '', footer: b?.receipt_footer || '', svc: String(tp.serviceChargePercent || ''), tax: String(tp.defaultTaxRate || '') }); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const gErr = f.gstin && !/^[0-9A-Z]{15}$/.test(f.gstin) ? 'GSTIN must be 15 letters/digits' : null; const sv = Number(f.svc || 0), tx = Number(f.tax || 0);
  const ok = f.name.trim() && f.address.trim() && f.contact.trim() && !gErr && sv >= 0 && sv <= 100 && tx >= 0 && tx <= 100;
  async function save() {
    setBusy(true);
    try { await eng.updateBusiness({ name: f.name.trim(), address: f.address.trim(), contact: f.contact.trim(), gstin: f.gstin || null, receiptFooter: f.footer.trim() || null, taxProfile: JSON.stringify({ serviceChargePercent: sv, defaultTaxRate: tx }) }); await reloadMe(); toast('Saved', 'ok'); back(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <View style={{ flex: 1 }}><Header title="Business profile" onBack={back} />
      <Screen>
        <Input label="Business name *" value={f.name} onChangeText={set('name')} /><Input label="Address *" value={f.address} onChangeText={set('address')} multiline /><Input label="Contact number *" keyboardType="phone-pad" value={f.contact} onChangeText={set('contact')} />
        <Input label="GSTIN" autoCapitalize="characters" maxLength={15} value={f.gstin} onChangeText={v => set('gstin')(v.toUpperCase())} error={gErr} /><Input label="Receipt footer" value={f.footer} onChangeText={set('footer')} placeholder={me?.defaults?.receiptFooter} />
        <H2>Tax defaults</H2><Row><View style={{ flex: 1 }}><Input label="Service charge %" keyboardType="decimal-pad" value={f.svc} onChangeText={set('svc')} /></View><View style={{ flex: 1 }}><Input label="Default tax % for new items" keyboardType="decimal-pad" value={f.tax} onChangeText={set('tax')} /></View></Row>
        <Btn title="Save changes" onPress={save} loading={busy} disabled={!ok} />
      </Screen>
    </View>);
}

export function Notifications() {
  const { eng, back } = useApp(); const [list, setList] = useState<{ id: number; title: string; body: string; read: number; created_at: string }[] | null>(null);
  useEffect(() => { eng.notifications().then(l => { setList(l); void eng.markNotificationsRead().catch(() => null); }).catch(() => setList([])); }, [eng]);
  return (
    <View style={{ flex: 1 }}><Header title="Notifications" onBack={back} />
      <Screen>{!list ? <Txt mut>Loading…</Txt> : list.length === 0 ? <Empty text="Nothing here yet." /> : list.map(n => <Card key={n.id}><Row style={{ justifyContent: 'space-between' }}><Txt bold style={{ flex: 1 }}>{n.title}</Txt>{!n.read ? <Pill text="New" tone="info" /> : null}</Row><Txt>{n.body}</Txt><Txt small mut>{new Date(n.created_at).toLocaleString()}</Txt></Card>)}</Screen>
    </View>);
}

export function Support() {
  const { eng, back, toast, me } = useApp(); const [subject, setSubject] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function send() { setBusy(true); try { await eng.sendSupport(subject.trim(), msg.trim()); toast('Sent. We will reply on your registered number.', 'ok'); back(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }
  return (
    <View style={{ flex: 1 }}><Header title="Support" onBack={back} />
      <Screen>{me?.subscription.supportContact ? <Banner tone="info">{me.subscription.supportContact}</Banner> : null}
        <Input label="Subject" value={subject} onChangeText={setSubject} maxLength={150} /><Input label="How can we help? *" value={msg} onChangeText={setMsg} multiline maxLength={2000} style={{ minHeight: 120 }} />
        <Btn title="Send to support" onPress={send} loading={busy} disabled={!msg.trim()} /></Screen>
    </View>);
}

export function UpdateRequired() {
  const { updateInfo } = useApp();
  return <Screen><View style={{ alignItems: 'center', gap: 12, marginTop: 40 }}><Mark size={72} /><H1>Update required</H1><Txt mut style={{ textAlign: 'center' }}>This version of Tably is no longer supported. Please install the latest version to continue.{updateInfo?.notes ? `\n\n${updateInfo.notes}` : ''}</Txt></View></Screen>;
}
