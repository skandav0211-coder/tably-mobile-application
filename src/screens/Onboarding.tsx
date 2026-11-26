import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../AppContext';
import { Banner, Brand, Btn, Card, H1, H2, Input, Pill, Row, Screen, Txt, Chip } from '../ui/kit';
import { Subscription } from '../core/types';

export function Login() {
  const { eng, refreshAll, toast } = useApp();
  const [mode, setMode] = useState<'login' | 'register' | 'register-code' | 'forgot' | 'reset' | 'setup'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [ownerName, setOwnerName] = useState(''); const [phone, setPhone] = useState('');
  const [code, setCode] = useState(''); const [challenge, setChallenge] = useState(''); const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false); const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const normalizedPhone = phone.trim().replace(/[ ()-]/g, '');
  const emailError = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? 'Enter a valid email address.' : null;
  const phoneError = phone && !/^(?:\d{10}|\+[1-9]\d{9,14})$/.test(normalizedPhone) ? 'Use 10 digits, optionally prefixed with a country code.' : null;
  const passwordError = password && (password.length < 10 || password.length > 72) ? 'Use at least 10 characters (maximum 72 characters).' : null;
  function start(modeNext: typeof mode) { setMode(modeNext); setCode(''); setPassword(''); setWait(0); setShowPassword(false); }
  async function submitLogin() {
    setBusy(true); try { await eng.login(email, password); await refreshAll(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function submitRegistration() {
    if (!ownerName.trim() || emailError || phoneError || passwordError || !email || !phone || !password) return;
    setBusy(true);
    try { const r = await eng.register(email, password, ownerName, normalizedPhone); setChallenge(r.challenge); setEmail(r.email); setWait(30); setMode('register-code'); toast('Check your email for the verification code.', 'ok'); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function verifyRegistration() {
    setBusy(true); try { await eng.verifyRegistration(challenge, code); await refreshAll(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function requestReset() {
    if (!email || emailError) return;
    setBusy(true);
    try { const r = await eng.forgotPassword(email); setChallenge(r.challenge); setWait(30); setMode('reset'); toast(r.message, 'info'); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function reset() {
    if (!code || passwordError || password.length < 10) return;
    setBusy(true);
    try { await eng.resetPassword(challenge, code, password); toast('Password updated. Sign in with your new password.', 'ok'); start('login'); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function verifySetup() {
    if (!email || emailError || !code || passwordError || password.length < 10) return;
    setBusy(true);
    try { await eng.verifySetupInvite(email, code, password); await refreshAll(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true);
    try {
      if (mode === 'register-code') await eng.resendRegistrationCode(challenge);
      else if (mode === 'reset') await eng.resendPasswordCode(challenge);
      else if (mode === 'setup') await eng.resendSetupInvite(email);
      setWait(30); toast('If the request is valid, a new code has been emailed.', 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const codeMode = mode === 'register-code' || mode === 'reset' || mode === 'setup';
  const titles = { login: 'Welcome back', register: 'Create your account', 'register-code': 'Verify your email', forgot: 'Forgot password?', reset: 'Reset your password', setup: 'Set up invited account' };
  const passwordField = (label: string, value: string, setValue: (v: string) => void) => (
    <>
      <Input label={label} value={value} onChangeText={setValue} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} error={passwordError} />
      <Pressable onPress={() => setShowPassword(v => !v)} accessibilityRole="button"><Txt small tone="ok">{showPassword ? 'Hide password' : 'Show password'}</Txt></Pressable>
    </>
  );
  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 8 }}><Brand width={190} /></View><H1>{titles[mode]}</H1>
      {mode === 'login' ? <>
        <Txt mut>Sign in with your email and password.</Txt>
        <Input label="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} error={emailError} />
        {passwordField('Password', password, setPassword)}
        <Pressable onPress={() => start('forgot')}><Txt tone="ok">Forgot password?</Txt></Pressable>
        <Btn title="Sign in" onPress={submitLogin} loading={busy} disabled={!email || !password || !!emailError} />
        <Btn kind="sec" title="Create account" onPress={() => start('register')} />
        <Pressable onPress={() => start('setup')}><Txt small mut style={{ textAlign: 'center' }}>Have an admin setup invite? Set up your account</Txt></Pressable>
      </> : null}
      {mode === 'register' ? <>
        <Txt mut>We’ll email a one-time verification code before creating your account.</Txt>
        <Input label="Owner name" value={ownerName} onChangeText={setOwnerName} error={ownerName.trim().length > 100 ? 'Name must be 100 characters or fewer.' : null} />
        <Input label="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} error={emailError} />
        <Input label="Phone number (contact)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} error={phoneError} placeholder="10 digits or +country code" />
        {passwordField('Password (at least 10 characters)', password, setPassword)}
        <Btn title="Email verification code" onPress={submitRegistration} loading={busy} disabled={!ownerName.trim() || !email || !!emailError || !phone || !!phoneError || password.length < 10 || !!passwordError} />
        <Pressable onPress={() => start('login')}><Txt small mut style={{ textAlign: 'center' }}>Already registered? Sign in</Txt></Pressable>
      </> : null}
      {codeMode ? <>
        <Txt mut>{mode === 'register-code' ? `Enter the code sent to ${email}.` : mode === 'reset' ? 'Enter the reset code sent to your email.' : 'Enter the code sent to the email address invited by the Super Admin.'}</Txt>
        {mode !== 'register-code' ? <Input label="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} error={emailError} /> : null}
        <Input label="6-digit email code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} autoFocus />
        {mode !== 'register-code' ? passwordField('New password (at least 10 characters)', password, setPassword) : null}
        <Btn title={mode === 'register-code' ? 'Verify email & continue' : mode === 'reset' ? 'Save new password' : 'Verify & set up account'} onPress={mode === 'register-code' ? verifyRegistration : mode === 'reset' ? reset : verifySetup} loading={busy} disabled={code.length !== 6 || (mode !== 'register-code' && (!email || !!emailError || password.length < 10 || !!passwordError))} />
        {mode !== 'reset' || wait === 0 ? <Pressable disabled={wait > 0 || busy} onPress={resend}><Txt tone={wait > 0 ? undefined : 'ok'} mut={wait > 0}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</Txt></Pressable> : null}
        <Pressable onPress={() => start('login')}><Txt small mut style={{ textAlign: 'center' }}>Back to sign in</Txt></Pressable>
      </> : null}
      {mode === 'forgot' ? <>
        <Txt mut>If an account exists for the email, we’ll send a password reset code.</Txt>
        <Input label="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} error={emailError} />
        <Btn title="Send reset code" onPress={requestReset} loading={busy} disabled={!email || !!emailError} />
        <Pressable onPress={() => start('login')}><Txt small mut style={{ textAlign: 'center' }}>Back to sign in</Txt></Pressable>
      </> : null}
    </Screen>
  );
}

export function BusinessSetup() {
  const { eng, me, refreshAll, toast } = useApp(); const [f, setF] = useState({ ownerName: me?.user.ownerName || '', businessName: '', businessType: 'Cafe', address: '', contact: me?.user.phone || '', gstin: '' }); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const contact = f.contact.trim().replace(/[ ()-]/g, '');
  const errs = { gstin: f.gstin && !/^[0-9A-Z]{15}$/.test(f.gstin) ? 'GSTIN must be 15 letters/digits' : null,
    contact: f.contact && !/^(?:\d{10}|\+[1-9]\d{9,14})$/.test(contact) ? 'Use 10 digits, optionally prefixed with a country code.' : null };
  const ok = f.ownerName.trim() && f.businessName.trim() && f.address.trim() && contact && !errs.gstin && !errs.contact;
  async function go() { setBusy(true); try { await eng.createBusiness({ ...f, contact, gstin: f.gstin || undefined }); await refreshAll(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }
  return (
    <Screen><H1>Your business</H1><Txt mut>These details appear on receipts. You can edit them later.</Txt>
      <Input label="Owner name *" value={f.ownerName} onChangeText={set('ownerName')} />
      <Input label="Business name *" value={f.businessName} onChangeText={set('businessName')} />
      <Txt small bold>Business type *</Txt><Row style={{ flexWrap: 'wrap' }}>{['Cafe', 'Restaurant', 'Retail', 'Bakery', 'Other'].map(x => <Chip key={x} text={x} on={f.businessType === x} onPress={() => set('businessType')(x)} />)}</Row>
      <Input label="Address *" value={f.address} onChangeText={set('address')} multiline />
      <Input label="Business / owner contact phone *" keyboardType="phone-pad" value={f.contact} onChangeText={set('contact')} error={errs.contact} />
      <Input label="GSTIN (optional)" autoCapitalize="characters" maxLength={15} value={f.gstin} onChangeText={v => set('gstin')(v.toUpperCase())} error={errs.gstin} />
      <Btn title="Continue" onPress={go} loading={busy} disabled={!ok} />
    </Screen>
  );
}

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info'> = { active: 'ok', expiring_soon: 'warn', grace: 'warn', pending: 'warn', expired: 'bad', suspended: 'bad', rejected: 'bad', none: 'info' };
export const STATUS_LABEL: Record<string, string> = { none: 'No subscription', pending: 'Pending Approval', active: 'Active', expiring_soon: 'Expiring Soon', expired: 'Expired', suspended: 'Suspended', rejected: 'Rejected', grace: 'Grace period' };

export function SubscriptionScreen({ embedded }: { embedded?: boolean }) {
  const { eng, refreshAll, toast, push, signOut, back } = useApp();
  const [s, setS] = useState<Subscription | null>(null); const [ref, setRef] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState('upi'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { try { setS(await eng.subscription()); } catch (e: any) { toast(e.message, 'bad'); } };
  useEffect(() => { void load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    setBusy(true);
    try { await eng.requestSubscription({ paymentRef: ref.trim(), amount: amount ? Number(amount) : undefined, method, evidence: note.trim() || undefined }); toast('Submitted for approval', 'ok'); setRef(''); setNote(''); await load(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function check() { await load(); await refreshAll(); }
  if (!s) return <Screen><Txt mut>Loading…</Txt></Screen>;
  const canRequest = s.status !== 'pending' && s.status !== 'suspended';
  const renewing = s.paid;
  return (
    <Screen>
      {embedded ? <Pressable onPress={back}><Txt tone="ok" bold>← Back</Txt></Pressable> : null}
      <H1>{s.paid ? 'Subscription' : 'Subscribe to Tably'}</H1>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}><H2>Status</H2><Pill text={STATUS_LABEL[s.status] || s.status} tone={TONE[s.status] || 'info'} /></Row>
        {s.endDate ? <Txt>Valid until <Txt bold>{new Date(s.endDate).toLocaleDateString()}</Txt>{s.daysLeft != null ? ` (${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left)` : ''}</Txt> : null}
        {s.paid && s.currentPlanMonths ? <Txt>{s.currentPlanMonths}-month active term</Txt> : null}
        {s.message ? <Banner tone={s.status === 'rejected' || s.status === 'suspended' ? 'bad' : 'info'}>Message from support: {s.message}</Banner> : null}
        {s.status === 'pending' ? <Txt mut>Your payment is being reviewed. Billing unlocks once it is approved. This usually does not need any action from you.</Txt> : null}
        {s.reminder ? <Banner tone="warn">Your subscription is expiring soon. Submit a renewal below to avoid interruption.</Banner> : null}
        {s.status === 'expired' ? <Banner tone="bad">New bills are blocked until a renewal is approved. Your past bills stay available.</Banner> : null}
      </Card>
      {canRequest ? (
        <Card>
          <H2>{renewing || s.status === 'expired' ? 'Renew' : 'Choose your plan'}</H2>
          <Txt>{s.planMonths || 12}-month plan{s.planPrice ? ` — ₹${s.planPrice}` : ''}</Txt>
          {s.paymentInstructions ? <Banner tone="info">{s.paymentInstructions}</Banner> : null}
          <Input label="Payment reference / UTR *" value={ref} onChangeText={setRef} autoCapitalize="characters" />
          <Input label="Amount paid (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Row style={{ flexWrap: 'wrap' }}>{['upi', 'bank', 'card', 'other'].map(m => <Chip key={m} text={m.toUpperCase()} on={method === m} onPress={() => setMethod(m)} />)}</Row>
          <Input label="Note for the reviewer (optional)" value={note} onChangeText={setNote} multiline />
          <Btn title="Submit for approval" onPress={submit} loading={busy} disabled={!ref.trim()} />
          <Txt small mut>Paying does not unlock the app by itself. The owner reviews every payment before activating.</Txt>
        </Card>
      ) : null}
      <Btn title="Refresh status" kind="sec" onPress={check} />
      {s.supportContact ? <Txt mut>Need help? {s.supportContact}</Txt> : null}
      <Btn title="Contact support" kind="sec" onPress={() => push('support')} />
      {s.history && s.history.length ? <Card><H2>History</H2>{s.history.map(h => <Row key={h.id} style={{ justifyContent: 'space-between' }}><Txt small mut>{new Date(h.created_at).toLocaleDateString()}</Txt><Pill text={STATUS_LABEL[h.status] || h.status} tone={TONE[h.status] || 'info'} /></Row>)}</Card> : null}
      
    </Screen>
  );
}
