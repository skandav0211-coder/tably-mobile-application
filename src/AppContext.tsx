import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Nunito_400Regular, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import * as Crypto from 'expo-crypto';
import { Api } from './core/api';
import { Engine, AuthLostError } from './core/engine';
import { secureKv } from './data/secureKv';
import { openSqliteStore } from './data/sqliteStore';
import type { Bill, Me, Route } from './core/types';
import { Mark, Tone, useTheme } from './ui/kit';

export type ScreenName = 'bill-detail' | 'devices' | 'printer' | 'business' | 'notifications' | 'support' | 'subscription' | 'drafts' | 'mpin';
export type Tab = 'bill' | 'menu' | 'sales' | 'reports' | 'more';
interface Ctx {
  eng: Engine; route: Route; setRoute: (r: Route) => void; me: Me | null; reloadMe: () => Promise<void>; refreshAll: () => Promise<void>;
  stack: { name: ScreenName; params?: any }[]; push: (name: ScreenName, params?: any) => void; back: () => void; tab: Tab; setTab: (t: Tab) => void;
  toast: (msg: string, tone?: Tone) => void; canBill: boolean; unsynced: number; syncNow: () => Promise<void>; signOut: () => void; busyBoot: boolean; updateInfo: { notes?: string; apk_url?: string } | null;
  uuid: () => string; versionName: string; draft: Bill | null; setDraft: (b: Bill | null) => void;
  locked: boolean; unlock: () => void; lockNow: () => void; mpinOn: boolean; refreshMpin: () => Promise<void>;
}
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [eng, setEng] = useState<Engine | null>(null); const [route, setRoute] = useState<Route>('loading'); const [me, setMe] = useState<Me | null>(null);
  const [stack, setStack] = useState<Ctx['stack']>([]); const [tab, setTab] = useState<Tab>('bill'); const [tick, setTick] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ msg: string; tone: Tone } | null>(null); const [unsynced, setUnsynced] = useState(0); const [updateInfo, setUpdateInfo] = useState<Ctx['updateInfo']>(null);
  const [draft, setDraft] = useState<Bill | null>(null); const [fontsReady] = useFonts({ Nunito_400Regular, Nunito_700Bold, Nunito_800ExtraBold, Fredoka_600SemiBold });
  const [locked, setLocked] = useState(false); const [mpinOn, setMpinOn] = useState(false); const bgAt = useRef(0); const lastRefresh = useRef(0); const toastTimer = useRef<any>();
  const buildCode = Number(Constants.expoConfig?.android?.versionCode ?? 1);

  const toast = useCallback((msg: string, tone: Tone = 'info') => { setToastMsg({ msg, tone }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMsg(null), 4500); }, []);
  const uuid = useCallback(() => Crypto.randomUUID(), []);

  useEffect(() => { // build the engine once
    (async () => {
      const store = await openSqliteStore(secureKv);
      const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || Constants.expoConfig?.extra?.apiBase || 'http://10.0.2.2:3000/');
      let e!: Engine;
      const api = new Api({ baseUrl: apiBase, getToken: () => e.token });
      e = new Engine({ api, secrets: secureKv, store, uuid: () => Crypto.randomUUID(), buildCode, hash: (v: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, v), onAuthLost: () => { setLocked(false); setRoute(r => (r === 'loading' ? r : 'login')); } });
      await e.init();
      const has = await e.hasMpin(); setMpinOn(has); if (has && e.token) setLocked(true);   // cold start = locked
      setEng(e);
    })().catch(err => { toast('Could not open local storage: ' + err.message, 'bad'); });
  }, [buildCode, toast]);

  const refreshAll = useCallback(async () => {
    if (!eng) return;
    try {
      const r = await eng.bootstrap(); setRoute(r); setMe(eng.me); setUnsynced(await eng.unsyncedCount()); lastRefresh.current = Date.now();
      if (r === 'update') { const v = await eng.api.appVersion().catch(() => ({})); setUpdateInfo(v as any); }
    } catch (e: any) { if (!(e instanceof AuthLostError)) toast(e.message, 'bad'); setRoute(eng.token ? 'home' : 'login'); }
  }, [eng, toast]);
  useEffect(() => { if (eng) void refreshAll(); }, [eng, refreshAll]);

  // Re-validate the entitlement and sync when the app returns to the foreground and every 5 minutes while open.
  useEffect(() => {
    if (!eng) return;
    const sub = AppState.addEventListener('change', s => { if (s === 'background') bgAt.current = Date.now();
      if (s === 'active') {
        if (mpinOn && eng.token && bgAt.current) { void eng.autoLockSec().then(sec => { if (Date.now() - bgAt.current >= sec * 1000) setLocked(true); }); }
        if (Date.now() - lastRefresh.current > 60_000 && (route === 'home' || route === 'locked')) void refreshAll();
      } });
    const timer = setInterval(() => { setTick(x => x + 1); if ((route === 'home' || route === 'locked') && Date.now() - lastRefresh.current > (route === 'locked' ? 60_000 : 5 * 60_000)) void refreshAll(); }, 30_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [eng, route, refreshAll, mpinOn]);

  const push = useCallback((name: ScreenName, params?: any) => setStack(s => [...s, { name, params }]), []);
  const back = useCallback(() => setStack(s => s.slice(0, -1)), []);
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => { if (locked) return true; if (stack.length) { back(); return true; } if (route === 'home' && tab !== 'bill') { setTab('bill'); return true; } return false; });
    return () => h.remove();
  }, [stack, tab, route, back, locked]);

  const syncNow = useCallback(async () => {
    if (!eng) return;
    try { const r = await eng.syncBills(); await eng.refreshSession().catch(() => null); setUnsynced(await eng.unsyncedCount()); setMe(await eng.loadMe().catch(() => eng.me));
      toast(r.pending === 0 ? 'Everything is synced' : `Synced ${r.accepted} bill(s)` + (r.rejected ? `, ${r.rejected} need attention` : ''), r.rejected ? 'warn' : 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }, [eng, toast]);

  const signOut = useCallback(() => {
    if (!eng) return;
    void eng.unsyncedCount().then(n => {
      const go = async () => { await eng.logout(); setMpinOn(false); setLocked(false); setMe(null); setStack([]); setTab('bill'); setRoute('login'); };
      Alert.alert('Sign out?', n ? `${n} bill(s) have not been synced to the server yet. They stay on this phone and sync after you sign back in on this device. If you sign in as a different business they will be erased.` : 'You will need your email and password to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: go }]);
    });
  }, [eng]);

  const refreshMpin = useCallback(async () => { if (eng) setMpinOn(await eng.hasMpin()); }, [eng]);
  const unlock = useCallback(() => setLocked(false), []); const lockNow = useCallback(() => setLocked(true), []);
  const value = useMemo<Ctx | null>(() => eng ? {
    eng, route, setRoute, me, reloadMe: async () => { setMe(await eng.loadMe().catch(() => eng.me)); }, refreshAll, stack, push, back, tab, setTab, toast, canBill: eng.canBill(), unsynced, syncNow, signOut, busyBoot: false, updateInfo, uuid,
    versionName: String(Constants.expoConfig?.version || '1.0.0'), draft, setDraft, locked, unlock, lockNow, mpinOn, refreshMpin,
  } : null, [eng, route, me, refreshAll, stack, push, back, tab, toast, unsynced, syncNow, signOut, updateInfo, uuid, tick, draft, locked, mpinOn, unlock, lockNow, refreshMpin]);

  const t = useTheme();
  if (!value || !fontsReady) return <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><Mark size={96} /></View>;
  return (
    <C.Provider value={value}>
      {children}
      {toastMsg && <Pressable onPress={() => setToastMsg(null)} style={{ position: 'absolute', top: 48, left: 16, right: 16, backgroundColor: toastMsg.tone === 'bad' ? t.bad : toastMsg.tone === 'ok' ? t.ok : toastMsg.tone === 'warn' ? t.warn : t.ink, padding: 14, borderRadius: 12, elevation: 8 }}><Text style={{ color: '#fff', fontFamily: 'Nunito_700Bold' }}>{toastMsg.msg}</Text></Pressable>}
    </C.Provider>
  );
}
export type { Bill };
