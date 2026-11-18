import React from 'react';
import { ActivityIndicator, StatusBar, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/AppContext';
import { Login, BusinessSetup, SubscriptionScreen } from './src/screens/Onboarding';
import { DeviceRegister } from './src/screens/Device';
import { BillDetail, Drafts } from './src/screens/Billing';
import { BusinessSettings, DevicesScreen, Home, LockedHome, Notifications, Printer, Support, UpdateRequired } from './src/screens/Home';
import { LockScreen, MpinSettings } from './src/screens/Lock';
import { useTheme } from './src/ui/kit';

/** Pushed screens (bill detail, printer, MPIN…) sit above whichever shell is showing. */
function Stack() {
  const { stack } = useApp(); const top = stack[stack.length - 1]; if (!top) return null; const t = useTheme();
  const body = { 'bill-detail': <BillDetail bill={top.params?.bill} />, devices: <DevicesScreen />, printer: <Printer />, business: <BusinessSettings />, notifications: <Notifications />, support: <Support />,
    subscription: <SubscriptionScreen embedded />, drafts: <Drafts />, mpin: <MpinSettings /> }[top.name];
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg }}>{body}</View>;
}

function Root() {
  const { route, locked } = useApp(); const t = useTheme();
  const main = route === 'login' ? <Login /> : route === 'business' ? <BusinessSetup /> : route === 'locked' || route === 'subscription' ? <LockedHome />
    : route === 'device' ? <DeviceRegister /> : route === 'update' ? <UpdateRequired /> : route === 'home' ? <Home /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.pri} /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {main}{route === 'home' || route === 'locked' || route === 'subscription' ? <Stack /> : null}
      {locked ? <LockScreen /> : null}
    </View>
  );
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  return <SafeAreaProvider><StatusBar barStyle={dark ? 'light-content' : 'dark-content'} /><AppProvider><Root /></AppProvider></SafeAreaProvider>;
}
