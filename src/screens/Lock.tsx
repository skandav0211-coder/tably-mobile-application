import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { weakMpin } from '../core/engine';
import { Banner, Brand, Btn, Card, Chip, F, Header, H1, H2, Mark, Row, Screen, Toggle, Txt, useTheme } from '../ui/kit';

/** Dot indicator + numeric keypad. Calls onDone(pin) when `length` digits are entered. */
export function PinPad({ length, onDone, disabled, error }: { length: number; onDone: (pin: string) => void; disabled?: boolean; error?: boolean }) {
  const t = useTheme(); const [pin, setPin] = useState('');
  useEffect(() => { if (error) setPin(''); }, [error]);
  const press = (d: string) => { if (disabled) return; const n = (pin + d).slice(0, length); setPin(n); if (n.length === length) { setTimeout(() => { onDone(n); setPin(''); }, 120); } };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return (
    <View style={{ alignItems: 'center', gap: 26 }}>
      <Row style={{ gap: 14 }}>{Array.from({ length }, (_, i) => <View key={i} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: error ? t.bad : t.pri, backgroundColor: i < pin.length ? (error ? t.bad : t.pri) : 'transparent' }} />)}</Row>
      <View style={{ width: 280, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, opacity: disabled ? 0.4 : 1 }}>
        {keys.map((k, i) => k === '' ? <View key={i} style={{ width: 80, height: 64 }} /> : (
          <Pressable key={i} disabled={disabled} accessibilityLabel={k === '⌫' ? 'Delete' : k} onPress={() => (k === '⌫' ? setPin(p => p.slice(0, -1)) : press(k))}
            style={({ pressed }) => ({ width: 80, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.priSoft : t.card, borderWidth: 1, borderColor: t.line })}>
            {k === '⌫' ? <Ionicons name="backspace-outline" size={24} color={t.ink} /> : <Txt style={{ fontFamily: F.head, fontSize: 26, color: t.ink }}>{k}</Txt>}
          </Pressable>))}
      </View>
    </View>
  );
}

/** Full-screen lock. Rendered above the whole app, so nothing underneath is visible or reachable. */
export function LockScreen() {
  const { eng, unlock, toast, setRoute, me } = useApp(); const t = useTheme();
  const [len, setLen] = useState<4 | 6>(4); const [msg, setMsg] = useState(''); const [err, setErr] = useState(false); const [wait, setWait] = useState(0);
  useEffect(() => { void eng.mpinLength().then(setLen); }, [eng]);
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => { setWait(w => w - 1); if (wait === 1) { setMsg(''); setErr(false); } }, 1000); return () => clearTimeout(id); }, [wait]);
  const check = useCallback(async (pin: string) => {
    const r = await eng.verifyMpin(pin);
    if (r.ok) { setErr(false); unlock(); return; }
    setErr(true);
    if (r.reason === 'wiped') { toast('Too many wrong attempts. Please sign in again.', 'bad'); unlock(); setRoute('login'); return; }
    if (r.reason === 'locked') { setWait(r.retryAfterSec || 60); setMsg('Too many wrong attempts.'); return; }
    setMsg(`Wrong MPIN. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? '' : 's'} left before a short lock.`); setTimeout(() => setErr(false), 700);
  }, [eng, unlock, toast, setRoute]);
  function forgot() {
    Alert.alert('Forgot your MPIN?', 'You will be signed out and must sign in with your email and password. Bills that have not synced stay on this phone. You can set a new MPIN afterwards.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: async () => { await eng.logout(); unlock(); setRoute('login'); } }]);
  }
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, zIndex: 100, elevation: 100, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }} accessibilityViewIsModal>
      <Mark size={72} />
      <H1>Enter your MPIN</H1>
      <Txt mut style={{ textAlign: 'center' }}>{me?.business?.name ? `${me.business.name} is locked.` : 'Tably is locked.'}</Txt>
      <PinPad length={len} onDone={check} disabled={wait > 0} error={err} />
      <View style={{ minHeight: 44, alignItems: 'center' }}>{wait > 0 ? <Banner tone="bad">{msg} Try again in {wait}s.</Banner> : msg ? <Txt tone="bad" bold style={{ textAlign: 'center' }}>{msg}</Txt> : null}</View>
      <Pressable onPress={forgot} hitSlop={12}><Txt tone="ok" bold>Forgot MPIN?</Txt></Pressable>
    </View>
  );
}

const LOCK_OPTIONS: [string, number][] = [['Immediately', 0], ['30 sec', 30], ['1 min', 60], ['5 min', 300]];

/** Security settings: set, change or remove the MPIN, and choose when the app locks. */
export function MpinSettings() {
  const { eng, back, toast, mpinOn, refreshMpin, lockNow } = useApp(); const t = useTheme();
  const [step, setStep] = useState<'menu' | 'old' | 'new' | 'confirm' | 'remove'>('menu'); const [len, setLen] = useState<4 | 6>(4); const [oldPin, setOld] = useState(''); const [first, setFirst] = useState(''); const [auto, setAuto] = useState(30); const [err, setErr] = useState(false);
  useEffect(() => { void eng.autoLockSec().then(setAuto); if (mpinOn) void eng.mpinLength().then(setLen); }, [eng, mpinOn]);
  const reset = () => { setStep('menu'); setOld(''); setFirst(''); setErr(false); };
  const startSet = () => setStep(mpinOn ? 'old' : 'new');

  async function gotOld(pin: string) { const r = await eng.verifyMpin(pin); if (!r.ok) { setErr(true); setTimeout(() => setErr(false), 700); toast(r.reason === 'locked' ? `Too many wrong attempts. Try again in ${r.retryAfterSec}s.` : r.reason === 'wiped' ? 'Too many wrong attempts — signed out.' : 'Current MPIN is incorrect.', 'bad'); return; } setOld(pin); setStep('new'); }
  async function gotNew(pin: string) {
    if (weakMpin(pin)) { setErr(true); setTimeout(() => setErr(false), 700); toast('That MPIN is too easy to guess (like 1111 or 1234). Choose another.', 'bad'); return; }
    setFirst(pin); setStep('confirm');
  }
  async function gotConfirm(pin: string) {
    if (pin !== first) { setErr(true); setTimeout(() => setErr(false), 700); toast('The two MPINs do not match. Start again.', 'bad'); setFirst(''); setStep('new'); return; }
    try { if (oldPin) await eng.changeMpin(oldPin, pin); else await eng.setMpin(pin); await refreshMpin(); toast(oldPin ? 'MPIN changed' : 'MPIN is on. The app will lock when you leave it.', 'ok'); reset(); } catch (e: any) { toast(e.message, 'bad'); reset(); }
  }
  async function gotRemove(pin: string) { try { await eng.removeMpin(pin); await refreshMpin(); toast('MPIN removed', 'ok'); reset(); } catch (e: any) { setErr(true); setTimeout(() => setErr(false), 700); toast(e.message, 'bad'); } }

  const pad = (title: string, sub: string, onDone: (p: string) => void) => (
    <View style={{ flex: 1 }}><Header title="MPIN" onBack={reset} /><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 }}><H1>{title}</H1><Txt mut style={{ textAlign: 'center' }}>{sub}</Txt><PinPad key={step} length={step === 'old' || step === 'remove' ? len : len} onDone={onDone} error={err} /></View></View>);
  if (step === 'old') return pad('Current MPIN', 'Enter your current MPIN to continue.', gotOld);
  if (step === 'new') return pad(`Choose a ${len}-digit MPIN`, 'Avoid birthdays and easy patterns.', gotNew);
  if (step === 'confirm') return pad('Confirm your MPIN', 'Enter the same MPIN again.', gotConfirm);
  if (step === 'remove') return pad('Enter MPIN to remove it', 'The app will no longer ask for an MPIN.', gotRemove);
  return (
    <View style={{ flex: 1 }}><Header title="Security" onBack={back} />
      <Screen>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}><H2>MPIN lock</H2><Txt bold tone={mpinOn ? 'ok' : undefined} mut={!mpinOn}>{mpinOn ? 'On' : 'Off'}</Txt></Row>
          <Txt mut>An MPIN keeps your sales and customer data private if someone picks up your phone. It is asked every time you open Tably and after the time you choose below.</Txt>
          {!mpinOn ? <><Txt small bold>MPIN length</Txt><Row>{([4, 6] as const).map(n => <Chip key={n} text={`${n} digits`} on={len === n} onPress={() => setLen(n)} />)}</Row></> : null}
          <Btn title={mpinOn ? 'Change MPIN' : 'Set MPIN'} onPress={startSet} />
          {mpinOn ? <Btn kind="sec" title="Remove MPIN" onPress={() => setStep('remove')} /> : null}
        </Card>
        {mpinOn ? <Card>
          <H2>Lock the app</H2><Txt mut>Ask for the MPIN again after the app has been in the background for:</Txt>
          <Row style={{ flexWrap: 'wrap' }}>{LOCK_OPTIONS.map(([l, v]) => <Chip key={l} text={l} on={auto === v} onPress={async () => { setAuto(v); await eng.setAutoLockSec(v); }} />)}</Row>
          <Btn kind="sec" title="Lock now" onPress={() => { back(); lockNow(); }} />
        </Card> : null}
        <Banner tone="info">Forgot your MPIN? Tap “Forgot MPIN?” on the lock screen and sign in again with your email and password. After 5 wrong tries Tably waits 60 seconds; after 10 it erases the MPIN and signs you out.</Banner>
      </Screen>
    </View>
  );
}
