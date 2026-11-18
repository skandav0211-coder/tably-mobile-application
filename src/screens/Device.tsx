import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useApp } from '../AppContext';
import { Banner, Btn, Card, H1, H2, Input, Pill, Row, Screen, Txt } from '../ui/kit';
import type { DeviceInfo } from '../core/types';
import { ApiError } from '../core/api';

export function DeviceList({ onChanged }: { onChanged?: () => void }) {
  const { eng, toast, push } = useApp(); const [d, setD] = useState<{ max: number; used: number; devices: DeviceInfo[] } | null>(null);
  const load = async () => { try { setD(await eng.devices()); } catch (e: any) { toast(e.message, 'bad'); } };
  useEffect(() => { void load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  async function remove(x: DeviceInfo) { try { await eng.removeDevice(x.id); toast('Device removed', 'ok'); await load(); onChanged?.(); } catch (e: any) { toast(e.message, 'bad'); } }
  if (!d) return <Txt mut>Loading devices…</Txt>;
  const slots = Array.from({ length: d.max }, (_, i) => d.devices.find(x => x.slot === i + 1) || null);
  return (
    <>
      <Txt mut>{d.used} of {d.max} device slots in use. The limit is shared by everyone in your business.</Txt>
      {slots.map((x, i) => <Card key={i}>{x ? <><Row style={{ justifyContent: 'space-between' }}><H2>Slot {x.slot}: {x.label || 'Device'}</H2>{x.current ? <Pill text="This device" tone="ok" /> : null}</Row>
        <Txt small mut>Registered {new Date(x.registered_at).toLocaleDateString()} · last seen {x.last_seen_at ? new Date(x.last_seen_at).toLocaleString() : '—'}</Txt><Btn small kind="bad" title="Remove this device" onPress={() => remove(x)} /></> : <Txt mut>Slot {i + 1}: empty</Txt>}</Card>)}
      <Btn kind="sec" title="Ask support to revoke a lost device" onPress={() => push('support')} />
    </>
  );
}

export function DeviceRegister() {
  const { eng, refreshAll, toast, signOut } = useApp(); const [label, setLabel] = useState(Platform.OS === 'android' ? 'Android counter' : 'Counter device'); const [busy, setBusy] = useState(false); const [full, setFull] = useState(false); const [n, setN] = useState(0);
  async function go() {
    setBusy(true);
    try { await eng.registerDevice(label.trim() || 'Counter'); toast('Device registered', 'ok'); await refreshAll(); }
    catch (e: any) { if (e instanceof ApiError && e.code === 'DEVICE_LIMIT') setFull(true); toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <Screen><H1>Register this device</H1><Txt mut>Your subscription is active. Register this phone to start billing — each business can use up to 3 devices.</Txt>
      <Input label="Device name" value={label} onChangeText={setLabel} />
      <Btn title="Register this device" onPress={go} loading={busy} />
      {full ? <Banner tone="warn">All device slots are in use. Remove one below, then register again.</Banner> : null}
      <H2>Your devices</H2><DeviceList key={n} onChanged={() => setN(n + 1)} />
      <Btn kind="sec" title="Sign out" onPress={signOut} />
    </Screen>
  );
}
