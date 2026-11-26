import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NativeSplashScreen from 'expo-splash-screen';
import { AppProvider, useApp } from './src/AppContext';
import { ThemeProvider, useThemeMode } from './src/ui/theme';
import { Login, BusinessSetup, SubscriptionScreen } from './src/screens/Onboarding';
import { DeviceRegister } from './src/screens/Device';
import { BillDetail, Drafts } from './src/screens/Billing';
import { BusinessSettings, DevicesScreen, Home, LockedHome, Notifications, OfflineRequired, Printer, Support, UpdateRequired } from './src/screens/Home';
import { LockScreen, MpinSettings } from './src/screens/Lock';
import { InventoryScreen } from './src/screens/Inventory';
import { useTheme } from './src/ui/kit';
import { SplashScreen } from './src/ui/SplashScreen';

void NativeSplashScreen.preventAutoHideAsync();

/** Pushed screens (bill detail, printer, MPIN…) sit above whichever shell is showing. */
function Stack() {
  const { stack } = useApp(); const top = stack[stack.length - 1]; if (!top) return null; const t = useTheme();
  const body = { 'bill-detail': <BillDetail bill={top.params?.bill} />, devices: <DevicesScreen />, printer: <Printer />, business: <BusinessSettings />, notifications: <Notifications />, support: <Support />,
    subscription: <SubscriptionScreen embedded />, drafts: <Drafts />, mpin: <MpinSettings />, inventory: <InventoryScreen /> }[top.name];
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg }}>{body}</View>;
}

function Root() {
  const { route, locked } = useApp(); const t = useTheme();
  const main = route === 'login' ? <Login /> : route === 'business' ? <BusinessSetup /> : route === 'locked' || route === 'subscription' ? <LockedHome />
    : route === 'device' ? <DeviceRegister /> : route === 'update' ? <UpdateRequired /> : route === 'offline' ? <OfflineRequired /> : route === 'home' ? <Home />
    : <View style={{ flex: 1, backgroundColor: t.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {main}{route === 'home' || route === 'locked' || route === 'subscription' ? <Stack /> : null}
      {locked ? <LockScreen /> : null}
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider><ThemeProvider><Startup /></ThemeProvider></SafeAreaProvider>;
}

function Startup() {
  const { mode } = useThemeMode();
  const t = useTheme();
  const [splashLoaded, setSplashLoaded] = useState(false);
  const [splashTimeElapsed, setSplashTimeElapsed] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const splashReadyHandled = useRef(false);
  const splashVisible = !splashLoaded || !splashTimeElapsed || !appReady;
  const onSplashReady = useCallback(() => {
    if (splashReadyHandled.current) return;
    splashReadyHandled.current = true;
    setSplashLoaded(true);
    requestAnimationFrame(() => { void NativeSplashScreen.hideAsync(); });
  }, []);
  const onAppReady = useCallback(() => setAppReady(true), []);

  useEffect(() => {
    if (!splashLoaded) return;
    const timer = setTimeout(() => setSplashTimeElapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [splashLoaded]);

  return <>
    <StatusBar
      barStyle={splashVisible || mode === 'light' ? 'dark-content' : 'light-content'}
      backgroundColor={splashVisible ? '#FAF9F5' : t.bg}
      translucent={splashVisible}
    />
    <View style={{ flex: 1 }}>
      <AppProvider onReady={onAppReady}><ThemedApp /></AppProvider>
      {splashVisible ? <SplashScreen onReady={onSplashReady} /> : null}
    </View>
  </>;
}

function ThemedApp() {
  const { route, startupError } = useApp();
  const t = useTheme();
  return <Root />;
}
