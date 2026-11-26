import React, { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TextInputProps, useWindowDimensions, View, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeMode } from './theme';

const light = { bg: '#FAF7F2', card: '#FFFFFF', ink: '#2B2523', mut: '#7A6B62', line: '#EADFD3', pri: '#C96510', priInk: '#FFFFFF', priSoft: '#FFF1E2', brown: '#7A4A2B', side: '#2B2523', ok: '#0B7A43', okSoft: '#E8F6EE', warn: '#A85A00', warnSoft: '#FFF4DC', bad: '#B42318', badSoft: '#FDECEB' };
const dark: typeof light = { bg: '#1B1614', card: '#262020', ink: '#F4EDE6', mut: '#A9998F', line: '#3A312D', pri: '#F59A4A', priInk: '#221A15', priSoft: '#3A2819', brown: '#D6A47C', side: '#14100F', ok: '#5FD394', okSoft: '#14301F', warn: '#F6C35C', warnSoft: '#33270F', bad: '#F58A80', badSoft: '#3A1A18' };
export const F = { body: 'Nunito_400Regular', bold: 'Nunito_700Bold', heavy: 'Nunito_800ExtraBold', head: 'Fredoka_600SemiBold' };
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const rail = width >= 720 || (landscape && width >= 560);
  return {
    width, height, rail,
    twoPane: width >= 960 || (landscape && width >= 800),
    cartWidth: Math.min(420, Math.max(300, width * 0.38)),
    landscape, pad: width >= 720 ? 24 : 16,
  };
}
export const tileColors = ['#E07B1F', '#7A4A2B', '#B5651D', '#C0392B', '#8E6C4A', '#D4A017', '#A0522D'];
export const colorFor = (s: string) => tileColors[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tileColors.length];
export type Theme = typeof light;
export const useTheme = (): Theme => useThemeMode().mode === 'dark' ? dark : light;
export type Tone = 'ok' | 'warn' | 'bad' | 'info';

export function Screen({ children, scroll = true, pad = true, max = 600 }: { children: ReactNode; scroll?: boolean; pad?: boolean; max?: number }) {
  const t = useTheme(); const L = useLayout(); const p = pad ? L.pad : 0;
  const inner = (st: ViewStyle) => <View style={[{ width: '100%', maxWidth: max, gap: 14 }, st]}>{children}</View>;
  const body = scroll
    ? <ScrollView contentContainerStyle={{ padding: p, paddingBottom: 40, alignItems: 'center' }} keyboardShouldPersistTaps="handled">{inner({})}</ScrollView>
    : <View style={{ flex: 1, padding: p, alignItems: 'center' }}>{inner({ flex: 1 })}</View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{body}</KeyboardAvoidingView></SafeAreaView>;
}
export const Txt = ({ children, style, tone, bold, small, mut, ...p }: { children?: ReactNode; style?: any; tone?: Tone; bold?: boolean; small?: boolean; mut?: boolean; numberOfLines?: number }) => {
  const t = useTheme(); const color = tone === 'bad' ? t.bad : tone === 'ok' ? t.ok : tone === 'warn' ? t.warn : mut ? t.mut : t.ink;
  return <Text {...p} style={[{ color, fontSize: small ? 13 : 15, fontFamily: bold ? F.bold : F.body }, style]}>{children}</Text>;
};
export const H1 = ({ children }: { children: ReactNode }) => { const t = useTheme(); return <Text style={{ color: t.ink, fontSize: 26, fontFamily: F.head, letterSpacing: -0.3 }}>{children}</Text>; };
export const H2 = ({ children }: { children: ReactNode }) => { const t = useTheme(); return <Text style={{ color: t.ink, fontSize: 18, fontFamily: F.head }}>{children}</Text>; };

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const t = useTheme(); const s = [{ backgroundColor: t.card, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 16, gap: 8, shadowColor: '#7A4A2B', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, style];
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.85 }]}>{children}</Pressable> : <View style={s}>{children}</View>;
}
export function Btn({ title, onPress, kind = 'pri', loading, disabled, small, style }: { title: string; onPress: () => void; kind?: 'pri' | 'sec' | 'bad' | 'ok'; loading?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle }) {
  const t = useTheme(); const off = disabled || loading;
  const bg = kind === 'pri' ? t.pri : kind === 'bad' ? t.bad : kind === 'ok' ? t.ok : 'transparent'; const fg = kind === 'sec' ? t.ink : kind === 'pri' ? t.priInk : '#fff';
  return (
    <Pressable accessibilityRole="button" disabled={off} onPress={onPress} style={({ pressed }) => [{ minHeight: small ? 42 : 54, paddingHorizontal: 20, borderRadius: 16, backgroundColor: bg, borderWidth: kind === 'sec' ? 1 : 0, borderColor: t.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: off ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      {loading && <ActivityIndicator color={fg} />}<Text style={{ color: fg, fontFamily: F.heavy, fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}
export function Input({ label, error, style, ...p }: TextInputProps & { label?: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: t.ink, fontFamily: F.bold, fontSize: 13 }}>{label}</Text> : null}
      <TextInput placeholderTextColor={t.mut} {...p} style={[{ minHeight: 50, borderWidth: 1, borderColor: error ? t.bad : t.line, borderRadius: 14, paddingHorizontal: 14, color: t.ink, backgroundColor: t.card, fontSize: 16, fontFamily: F.body }, p.multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }, style]} />
      {error ? <Text style={{ color: t.bad, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}
export function Pill({ text, tone = 'info' }: { text: string; tone?: Tone }) {
  const t = useTheme(); const m = { ok: [t.okSoft, t.ok], warn: [t.warnSoft, t.warn], bad: [t.badSoft, t.bad], info: [t.priSoft, t.pri] }[tone];
  return <View style={{ alignSelf: 'flex-start', backgroundColor: m[0], borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}><Text style={{ color: m[1], fontFamily: F.heavy, fontSize: 12 }}>{text}</Text></View>;
}
export function Chip({ text, on, onPress }: { text: string; on?: boolean; onPress: () => void }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: on ? t.pri : t.card, borderWidth: 1, borderColor: on ? t.pri : t.line }}><Text style={{ color: on ? t.priInk : t.ink, fontFamily: F.bold }}>{text}</Text></Pressable>;
}
export function Banner({ tone = 'info', children, action }: { tone?: Tone; children: ReactNode; action?: { title: string; onPress: () => void } }) {
  const t = useTheme(); const m = { ok: [t.okSoft, t.ok], warn: [t.warnSoft, t.warn], bad: [t.badSoft, t.bad], info: [t.priSoft, t.pri] }[tone];
  return <View style={{ backgroundColor: m[0], borderRadius: 12, padding: 12, gap: 6 }}><Text style={{ color: m[1], fontFamily: F.bold }}>{children}</Text>{action ? <Pressable onPress={action.onPress}><Text style={{ color: m[1], fontFamily: F.heavy, textDecorationLine: 'underline' }}>{action.title}</Text></Pressable> : null}</View>;
}
export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]}>{children}</View>;
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme(); return <Row style={{ justifyContent: 'space-between' }}><Text style={{ color: t.ink, fontSize: 15, fontFamily: F.body }}>{label}</Text><Switch value={value} onValueChange={onChange} /></Row>;
}
export function Empty({ text }: { text: string }) { return <View style={{ padding: 32, alignItems: 'center' }}><Txt mut>{text}</Txt></View>; }
export function Divider() { const t = useTheme(); return <View style={{ height: 1, backgroundColor: t.line }} />; }
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const t = useTheme(); const insets = useSafeAreaInsets(); const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,15,30,.55)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: height - insets.top - 12, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) }}>
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 }}><H2>{title}</H2><Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={onClose} hitSlop={12} style={{ padding: 4 }}><Text style={{ color: t.mut, fontSize: 22 }}>✕</Text></Pressable></Row>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
export const styles = StyleSheet.create({ flex: { flex: 1 } });

export function Brand({ width = 200 }: { width?: number }) { return <Image source={require('../../assets/logo-full.png')} style={{ width, height: width * 0.97 }} resizeMode="contain" accessibilityLabel="Tably" />; }
export function Mark({ size = 40 }: { size?: number }) { return <Image source={require('../../assets/mark.png')} style={{ width: size, height: size * 1.07 }} resizeMode="contain" />; }
export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const t = useTheme();
  return <Row style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.bg, justifyContent: 'space-between' }}><Row style={{ flex: 1 }}>{onBack ? <Pressable onPress={onBack} hitSlop={12} style={{ padding: 4 }}><Ionicons name="chevron-back" size={26} color={t.ink} /></Pressable> : null}<H1>{title}</H1></Row>{right}</Row>;
}
export function Tile({ name, sub, onPress, onDecrease, quantity, fav, dim }: { name: string; sub: string; onPress: () => void; onDecrease?: () => void; quantity?: number; fav?: boolean; dim?: boolean }) {
  const t = useTheme(); const c = colorFor(name);
  return (
    <View style={{ flex: 1, margin: 5, minHeight: quantity === undefined ? 112 : 158, borderRadius: 18, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, padding: 12, gap: 8, opacity: dim ? 0.5 : 1, shadowColor: '#7A4A2B', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flex: 1, gap: 6, opacity: pressed ? 0.85 : 1 })}>
        <Row style={{ justifyContent: 'space-between' }}><View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontFamily: F.head, fontSize: 18 }}>{name.trim().charAt(0).toUpperCase()}</Text></View>{fav ? <Ionicons name="star" size={16} color="#D4A017" /> : null}</Row>
        <Text numberOfLines={2} style={{ color: t.ink, fontFamily: F.bold, fontSize: 15 }}>{name}</Text><Text style={{ color: t.pri, fontFamily: F.heavy, fontSize: 15 }}>{sub}</Text>
      </Pressable>
      {quantity !== undefined && onDecrease ? <Row style={{ justifyContent: 'space-between', gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${name}`} disabled={quantity === 0} onPress={onDecrease} style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', opacity: quantity === 0 ? 0.4 : 1 }}>
          <Ionicons name={quantity === 1 ? 'trash-outline' : 'remove'} size={18} color={t.ink} />
        </Pressable>
        <Text accessibilityLabel={`${quantity} ${name} in bill`} style={{ color: t.ink, minWidth: 22, textAlign: 'center', fontFamily: F.heavy, fontSize: 15 }}>{quantity}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add one ${name}`} onPress={onPress} style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: t.pri, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={20} color={t.priInk} />
        </Pressable>
      </Row> : null}
    </View>
  );
}
