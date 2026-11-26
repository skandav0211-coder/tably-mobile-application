import { Api, ApiError, NetworkError, mapProduct } from './api';
import { calculate, money, serviceChargeFor } from './calc';
import type { Bill, BillItem, CartLine, Me, Payment, PayMethod, PrinterConfig, Product, ReportData, Route, Subscription, TaxProfile, InventoryItem, InventoryItemInput, InventoryMovement, InventoryMovementInput, InventoryOrder, InventorySettings, InventoryUsage, RecipeLine } from './types';
import type { KV, LocalSaleUsage, Store } from './store';

export class PaidRequiredError extends Error { constructor() { super('Your subscription does not allow new bills right now. Renew or reconnect to continue.'); } }
export class UnsyncedError extends Error { constructor(public count: number) { super(`${count} bill(s) have not been synced yet.`); } }
export class AuthLostError extends Error { constructor() { super('Your session ended. Please sign in again.'); } }

export interface EngineDeps {
  api: Api; secrets: KV; store: Store; now?: () => number; uuid: () => string; buildCode: number;
  /** SHA-256 hex digest (expo-crypto on device, node:crypto in tests). */
  hash: (s: string) => Promise<string>;
  onAuthLost?: () => void;
}
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60_000;
export const MPIN_SOFT_LIMIT = 5;      // after 5 wrong tries in a row: temporary lock-out
export const MPIN_HARD_LIMIT = 10;     // after 10: the MPIN is erased and a full sign-in is required
export const MPIN_LOCK_SEC = 60;
export type MpinResult = { ok: true } | { ok: false; reason: 'wrong' | 'locked' | 'wiped'; attemptsLeft?: number; retryAfterSec?: number };
export const weakMpin = (p: string) => /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);

export class Engine {
  private now: () => number;
  userToken: string | null = null; deviceToken: string | null = null; me: Me | null = null;
  private entPaid = false; private entUntil = 0; private clockMax = 0;
  deviceId: string | null = null; slot = 0; invoicePrefix: string | null = null; businessId: string | null = null; cashier = 'Owner';

  constructor(private d: EngineDeps) { this.now = d.now || Date.now; }
  get token() { return this.deviceToken || this.userToken; }
  get api() { return this.d.api; }
  get store() { return this.d.store; }

  // ───────── lifecycle ─────────
  async init() {
    const s = this.d.secrets, k = this.d.store.kv;
    this.userToken = await s.get('userToken'); this.deviceToken = await s.get('deviceToken');
    this.entPaid = (await s.get('entPaid')) === '1'; this.entUntil = Number(await s.get('entUntil')) || 0; this.clockMax = Number(await s.get('clockMax')) || 0;
    this.deviceId = await k.get('deviceId'); this.slot = Number(await k.get('slot')) || 0; this.invoicePrefix = await k.get('invoicePrefix');
    this.businessId = await k.get('businessId'); this.cashier = (await k.get('cashier')) || 'Owner';
  }
  async appInstanceId(): Promise<string> {
    let v = await this.d.secrets.get('appInstance'); if (!v) { v = this.d.uuid(); await this.d.secrets.set('appInstance', v); } return v;
  }
  private async setTok(name: 'userToken' | 'deviceToken', v: string | null) {
    this[name] = v; if (v) await this.d.secrets.set(name, v); else await this.d.secrets.del(name);
  }
  private async setEnt(paid: boolean, untilIso: string | null) {
    this.entPaid = paid; this.entUntil = untilIso ? Date.parse(untilIso) : 0;
    await this.d.secrets.set('entPaid', paid ? '1' : '0'); await this.d.secrets.set('entUntil', String(this.entUntil));
    this.tick();
  }
  private tick() { const n = this.now(); if (n > this.clockMax) { this.clockMax = n; void this.d.secrets.set('clockMax', String(n)); } }

  /** Bounded offline entitlement (SRS §6.6). Paid features only inside the server-granted window and never after a clock rollback. */
  canBill(): boolean {
    const n = this.now();
    if (this.clockMax && n < this.clockMax - OFFLINE_CLOCK_SKEW_MS) return false;
    const ok = this.entPaid && n < this.entUntil;
    this.tick(); return ok;
  }
  private lost(): never { this.d.onAuthLost?.(); throw new AuthLostError(); }
  /** Wraps server calls: a dead session/revoked device clears local credentials so access cannot continue on stale state. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (e.code === 'DEVICE_REVOKED') { await this.setTok('deviceToken', null); await this.setEnt(false, null); this.d.onAuthLost?.(); }
        else { await this.setTok('userToken', null); await this.setTok('deviceToken', null); await this.setEnt(false, null); this.lost(); }
      }
      throw e;
    }
  }

  // ───────── auth & onboarding ─────────
  register(email: string, password: string, ownerName: string, phone: string) {
    return this.d.api.register({ email: email.trim().toLowerCase(), password, ownerName: ownerName.trim(), phone: phone.trim() });
  }
  async login(email: string, password: string) {
    return this.acceptAuthSession(await this.d.api.login(email.trim().toLowerCase(), password));
  }
  forgotPassword(email: string) { return this.d.api.forgotPassword(email.trim().toLowerCase()); }
  resendPasswordCode(challenge: string) { return this.d.api.resendPasswordCode(challenge); }
  resetPassword(challenge: string, code: string, password: string) { return this.d.api.resetPassword(challenge, code, password); }
  resendRegistrationCode(challenge: string) { return this.d.api.resendRegistrationCode(challenge); }
  resendSetupInvite(email: string) { return this.d.api.resendSetupInvite(email.trim().toLowerCase()); }
  async verifyRegistration(challenge: string, code: string) {
    return this.acceptAuthSession(await this.d.api.verifyRegistration(challenge, code.trim()));
  }
  async verifySetupInvite(email: string, code: string, password: string) {
    return this.acceptAuthSession(await this.d.api.verifySetupInvite(email.trim().toLowerCase(), code.trim(), password));
  }
  async acceptAuthSession(r: { token: string; businessId: string | null }) {
    // A different business must never see the previous business's local data (tenant isolation on the device).
    if (this.businessId && r.businessId !== this.businessId) {
      await this.d.store.clearBusinessData(); for (const k of ['deviceId', 'slot', 'invoicePrefix', 'businessId']) await this.d.store.kv.del(k);
      for (const k of ['inventoryItems', 'inventoryMovementQueue', 'inventoryRecipes', 'inventorySettings', 'inventoryOrders:open', 'inventoryOrders:received', 'inventoryOrders:all']) await this.d.store.kv.del(k);
      this.deviceId = null; this.slot = 0; this.invoicePrefix = null; this.businessId = null; await this.clearMpin();
      await this.setTok('deviceToken', null); await this.setEnt(false, null);
    }
    await this.setTok('userToken', r.token);
    if (r.businessId) { this.businessId = r.businessId; await this.d.store.kv.set('businessId', r.businessId); }
    return r;
  }
  async createBusiness(b: { ownerName: string; businessName: string; businessType: string; address: string; contact: string; gstin?: string }) {
    const r = await this.call(() => this.d.api.createBusiness(b));
    this.businessId = r.businessId; await this.d.store.kv.set('businessId', r.businessId); await this.setCashier(b.ownerName); return r;
  }
  async setCashier(name: string) { this.cashier = name.trim() || 'Owner'; await this.d.store.kv.set('cashier', this.cashier); }
  async logout() { await this.setTok('userToken', null); await this.setTok('deviceToken', null); await this.setEnt(false, null); await this.clearMpin(); this.me = null; }
  async logoutAllSessions() { await this.call(() => this.d.api.logoutAll()); await this.logout(); }

  // ───────── MPIN (app lock) ─────────
  // The MPIN only gates this phone's UI; it never replaces server authentication. It is salted, hashed, kept in the Keystore-backed
  // secure store, rate-limited (lock-out, then erased) and erased on sign-out. "Forgot MPIN" = sign in again with email/password.
  private async mpinDigest(pin: string, salt: string) { let h = salt + ':' + pin; for (let i = 0; i < 300; i++) h = await this.d.hash(h); return h; }
  private lockNow() { return Math.max(this.now(), this.clockMax); }
  async hasMpin() { return !!(await this.d.secrets.get('mpinHash')); }
  async mpinLength(): Promise<4 | 6> { return (await this.d.secrets.get('mpinLen')) === '6' ? 6 : 4; }
  private async clearMpin() { for (const k of ['mpinHash', 'mpinSalt', 'mpinLen', 'mpinFails', 'mpinLockUntil']) await this.d.secrets.del(k); }
  async setMpin(pin: string) {
    if (!/^\d{4}$|^\d{6}$/.test(pin)) throw new Error('The MPIN must be 4 or 6 digits.');
    if (weakMpin(pin)) throw new Error('That MPIN is too easy to guess (like 1111 or 1234). Choose another.');
    const salt = this.d.uuid(); const s = this.d.secrets;
    await s.set('mpinSalt', salt); await s.set('mpinHash', await this.mpinDigest(pin, salt)); await s.set('mpinLen', String(pin.length)); await s.set('mpinFails', '0'); await s.del('mpinLockUntil');
  }
  async verifyMpin(pin: string): Promise<MpinResult> {
    const s = this.d.secrets; const hash = await s.get('mpinHash'), salt = await s.get('mpinSalt');
    if (!hash || !salt) return { ok: true };
    const until = Number(await s.get('mpinLockUntil')) || 0;
    if (until > this.lockNow()) return { ok: false, reason: 'locked', retryAfterSec: Math.ceil((until - this.lockNow()) / 1000) };
    const got = await this.mpinDigest(pin, salt); let diff = got.length ^ hash.length; for (let i = 0; i < hash.length; i++) diff |= (got.charCodeAt(i) || 0) ^ hash.charCodeAt(i);
    if (diff === 0) { await s.set('mpinFails', '0'); await s.del('mpinLockUntil'); return { ok: true }; }
    const fails = (Number(await s.get('mpinFails')) || 0) + 1; await s.set('mpinFails', String(fails));
    if (fails >= MPIN_HARD_LIMIT) { await this.logout(); return { ok: false, reason: 'wiped' }; }
    if (fails % MPIN_SOFT_LIMIT === 0) { await s.set('mpinLockUntil', String(this.lockNow() + MPIN_LOCK_SEC * 1000)); return { ok: false, reason: 'locked', retryAfterSec: MPIN_LOCK_SEC }; }
    return { ok: false, reason: 'wrong', attemptsLeft: MPIN_SOFT_LIMIT - (fails % MPIN_SOFT_LIMIT) };
  }
  async changeMpin(oldPin: string, newPin: string) { const r = await this.verifyMpin(oldPin); if (!r.ok) throw new Error(r.reason === 'locked' ? `Too many wrong attempts. Try again in ${r.retryAfterSec}s.` : 'Current MPIN is incorrect.'); await this.setMpin(newPin); }
  async removeMpin(pin: string) { const r = await this.verifyMpin(pin); if (!r.ok) throw new Error(r.reason === 'locked' ? `Too many wrong attempts. Try again in ${r.retryAfterSec}s.` : 'MPIN is incorrect.'); await this.clearMpin(); }
  /** Seconds the app may stay in the background before the MPIN is asked again (0 = every time). */
  async autoLockSec(): Promise<number> { const v = await this.d.store.kv.get('autoLockSec'); return v == null ? 30 : Number(v); }
  async setAutoLockSec(n: number) { await this.d.store.kv.set('autoLockSec', String(n)); }
  async unsyncedCount() { return (await this.d.store.unsynced()).length; }

  async loadMe(): Promise<Me> { this.me = await this.call(() => this.d.api.me()); return this.me; }
  async subscription(): Promise<Subscription> { return this.call(() => this.d.api.subscription()); }
  requestSubscription(b: { paymentRef: string; amount?: number; method?: string; evidence?: string }) { return this.call(() => this.d.api.requestSubscription(b)); }

  async registerDevice(label: string) {
    const r = await this.call(async () => this.d.api.registerDevice(await this.appInstanceId(), label));
    await this.setTok('deviceToken', r.token); await this.setEnt(true, r.entitlement.validUntil);
    this.deviceId = r.deviceId; this.slot = r.slot; this.invoicePrefix = r.invoicePrefix;
    const k = this.d.store.kv; await k.set('deviceId', r.deviceId); await k.set('slot', String(r.slot)); await k.set('invoicePrefix', r.invoicePrefix); return r;
  }
  /** Re-validates the device and subscription with the server. */
  async refreshSession(): Promise<Subscription | null> {
    if (!this.deviceToken) return null;
    const r = await this.call(() => this.d.api.refresh());
    await this.setTok('deviceToken', r.token); await this.setEnt(r.subscription.paid, r.entitlement.validUntil); return r.subscription;
  }
  async devices() { return this.call(() => this.d.api.devices()); }
  async removeDevice(id: string) {
    await this.call(() => this.d.api.removeDevice(id));
    if (id === this.deviceId) { await this.setTok('deviceToken', null); await this.setEnt(false, null); this.deviceId = null; this.invoicePrefix = null; await this.d.store.kv.del('deviceId'); await this.d.store.kv.del('invoicePrefix'); }
  }

  /** Server decides where the user belongs; local state alone never grants paid access. */
  async bootstrap(): Promise<Route> {
    const v = await this.d.api.appVersion();
    if (v.min_supported && v.min_supported > this.d.buildCode) return 'update';
    if (!this.userToken && !this.deviceToken) return 'login';
    const me = await this.loadMe();
    if (!me.business) return 'business';
    // Registered but not subscribed: the owner can look around and press Subscribe; every paid feature stays locked.
    if (!this.deviceToken) return me.subscription.paid ? 'device' : 'locked';
    await this.refreshSession();
    this.me = await this.call(() => this.d.api.me());
    await this.syncBills();
    return 'home';
  }

  // ───────── catalogue ─────────
  async products(refresh = true, includeArchived = false): Promise<Product[]> {
    if (refresh && this.token) { try { const r = await this.call(() => this.d.api.products(includeArchived)); await this.d.store.replaceProducts(r.map(mapProduct)); } catch (e) { if (!(e instanceof NetworkError)) throw e; } }
    const local=await this.d.store.listProducts(); return includeArchived?local:local.filter(p=>p.active);
  }
  async archiveProduct(id:string){ await this.call(()=>this.d.api.archiveProduct(id)); return this.products(true); }
  async restoreProduct(id:string){ await this.call(()=>this.d.api.restoreProduct(id)); return this.products(true); }
  async deleteProduct(id: string) {
    if (!this.canBill()) throw new PaidRequiredError();
    await this.call(() => this.d.api.deleteProduct(id));
    return this.products(true, true);
  }
  async saveProduct(id: string | null, p: Partial<Omit<Product, 'id'>>) {
    const body: Record<string, unknown> = { ...p };
    if (id) await this.call(() => this.d.api.updateProduct(id, body)); else await this.call(() => this.d.api.addProduct(body));
    return this.products(true);
  }
  async saveProducts(entries: { id: string | null; product: Partial<Omit<Product, 'id'>> }[]) {
    let saved = 0;
    const failures: { index: number; name: string; error: string }[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      try {
        const body: Record<string, unknown> = { ...entry.product };
        if (entry.id) await this.call(() => this.d.api.updateProduct(entry.id as string, body));
        else await this.call(() => this.d.api.addProduct(body));
        saved++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ index, name: entry.product.name || 'Unnamed item', error: message });
        if (e instanceof NetworkError || e instanceof AuthLostError) {
          for (let remaining = index + 1; remaining < entries.length; remaining++) {
            failures.push({ index: remaining, name: entries[remaining].product.name || 'Unnamed item', error: `Not attempted after the connection failed: ${message}` });
          }
          break;
        }
      }
    }
    const products = await this.products(true);
    return { saved, failures, products };
  }
  taxProfile(): TaxProfile {
    try { const t = JSON.parse(this.me?.business?.tax_profile || '{}'); return { serviceChargePercent: Number(t.serviceChargePercent) || 0, defaultTaxRate: Number(t.defaultTaxRate) || 0 }; } catch { return { serviceChargePercent: 0, defaultTaxRate: 0 }; }
  }
  async updateBusiness(patch: Record<string, unknown>) { await this.call(() => this.d.api.updateBusiness(patch)); return this.loadMe(); }

  // ───────── billing ─────────
  private base(b: Partial<Bill> & { clientTxnId: string }): Bill {
    return { invoiceNo: null, status: 'draft', createdAt: new Date(this.now()).toISOString(), cashier: this.cashier, customerName: null, customerMobile: null, tableNo: null, notes: null,
      items: [], payments: [], subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, total: 0, synced: false, syncError: null, printCount: 0, statusReason: null, ...b };
  }
  private items(lines: CartLine[]): BillItem[] { return lines.map(l => ({ name: l.name, qty: l.qty, price: l.price, taxRate: l.taxRate, productId:l.productId, variantName:l.variantName, addons:l.addons, custom:l.custom })); }

  async saveDraft(a: { cartId: string; lines: CartLine[]; discount: number; serviceChargePercent: number; customerName?: string; customerMobile?: string; tableNo?: string; notes?: string }) {
    if (!a.lines.length) throw new Error('Add at least one item.');
    const svc = serviceChargeFor(a.lines, a.discount, a.serviceChargePercent); const t = calculate(a.lines, a.discount, svc);
    const b = this.base({ clientTxnId: a.cartId, status: 'draft', items: this.items(a.lines), customerName: a.customerName || null, customerMobile: a.customerMobile || null, tableNo: a.tableNo || null, notes: a.notes || null,
      subtotal: t.subtotal, discount: t.discount, tax: t.tax, serviceCharge: t.serviceCharge, total: t.total, synced: true });
    await this.d.store.saveBill(b); return b;
  }
  async drafts() { return (await this.d.store.listBills()).filter(b => b.status === 'draft'); }
  deleteDraft(id: string) { return this.d.store.deleteBill(id); }

  /** Completed bills are written to local storage FIRST. cartId makes a double-tap idempotent (same cart → same bill). */
  async completeBill(a: { cartId: string; lines: CartLine[]; discount: number; serviceChargePercent: number; method: PayMethod; split?: Payment[]; customerName?: string; customerMobile?: string; tableNo?: string; notes?: string }): Promise<Bill> {
    const existing = await this.d.store.getBill(a.cartId); if (existing && existing.status !== 'draft') return existing;
    if (!this.canBill()) throw new PaidRequiredError();
    if (!this.invoicePrefix) throw new Error('This device is not registered yet.');
    const subscription = await this.refreshSession();
    if (!subscription?.paid || !this.canBill()) throw new PaidRequiredError();
    if (!a.lines.length) throw new Error('Add at least one item.');
    if (a.lines.some(l => !(l.qty > 0) || !(l.price >= 0))) throw new Error('Invalid quantity or price.');
    if (!(a.discount >= 0)) throw new Error('Discount cannot be negative.');
    const svc = serviceChargeFor(a.lines, a.discount, a.serviceChargePercent); const t = calculate(a.lines, a.discount, svc);
    let payments: Payment[] = [{ method: a.method, amount: t.total }];
    if (a.split && a.split.length) {
      if (a.split.length > 5 || a.split.some(p => !(p.amount > 0))) throw new Error('Each split payment must be greater than zero.');
      if (Math.abs(a.split.reduce((s, p) => s + p.amount, 0) - t.total) > 0.01) throw new Error(`Split payments must add up to ${t.total.toFixed(2)}.`);
      payments = a.split.map(p => ({ method: p.method, amount: money(p.amount) }));
    }
    const n = await this.d.store.nextCounter('invoice');
    const bill = this.base({ clientTxnId: a.cartId, invoiceNo: `${this.invoicePrefix}-${String(n).padStart(6, '0')}`, status: 'completed', items: this.items(a.lines), payments,
      customerName: a.customerName || null, customerMobile: a.customerMobile || null, tableNo: a.tableNo || null, notes: a.notes || null,
      subtotal: t.subtotal, discount: t.discount, tax: t.tax, serviceCharge: t.serviceCharge, total: t.total });
    await this.d.store.saveBillWithLocalSaleUsage(bill, await this.localSaleUsage(a.lines, a.cartId));
    return bill;
  }
  private async localSaleUsage(lines: CartLine[], clientTxnId: string): Promise<LocalSaleUsage[]> {
    try {
      const recipes = await this.cachedValue<Record<string, RecipeLine[]>>(this.inventoryCacheKey('recipes')) || {};
      const usage = new Map<string, number>();
      for (const line of lines) {
        if (!line.productId) continue;
        const selected = new Set<string>();
        if (!line.custom && line.variantName) selected.add(line.variantName.trim().toLowerCase());
        if (!line.custom) for (const addon of line.addons || []) selected.add(addon.trim().toLowerCase());
        for (const recipe of recipes[line.productId] || []) {
          if (recipe.variantName && !selected.has(recipe.variantName.trim().toLowerCase())) continue;
          const amount = Math.round((recipe.qty * line.qty + Number.EPSILON) * 1000) / 1000;
          if (Number.isFinite(amount) && amount > 0) usage.set(recipe.inventoryItemId, Math.round(((usage.get(recipe.inventoryItemId) || 0) + amount + Number.EPSILON) * 1000) / 1000);
        }
      }
      return [...usage].map(([inventoryItemId, qty]) => ({ clientTxnId, inventoryItemId, qty }));
    } catch (error) {
      console.warn('Could not calculate local inventory usage; the bill will still be saved.', error);
      return [];
    }
  }
  /** Void / refund of a completed bill (audited server-side with the reason). */
  async changeStatus(b: Bill, status: 'void' | 'refunded', reason: string): Promise<Bill> {
    if (b.status !== 'completed') throw new Error('Only completed bills can be voided or refunded.');
    if (!reason.trim()) throw new Error('A reason is required.');
    await this.d.api.appVersion();
    await this.d.api.appVersion();
    if (!this.canBill()) throw new PaidRequiredError();
    const nb = { ...b, status, statusReason: reason.trim().slice(0, 300), synced: false, syncError: null, remote: undefined };
    await this.d.store.saveBill(nb); return nb;
  }
  async markPrinted(b: Bill) { const l = await this.d.store.getBill(b.clientTxnId); if (l) await this.d.store.saveBill({ ...l, printCount: l.printCount + 1 }); }

  /** Idempotent push of unsynced bills (stable clientTxnId; server de-duplicates). Rejections stay visible on the bill. */
  async syncBills(): Promise<{ pending: number; accepted: number; rejected: number }> {
    const list = await this.d.store.unsynced(); let accepted = 0, rejected = 0;
    if (!list.length || !this.deviceToken) return { pending: list.length, accepted, rejected };
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const res = await this.call(() => this.d.api.syncBills(chunk.map(b => ({
        clientTxnId: b.clientTxnId, invoiceNo: b.invoiceNo, status: b.status, createdAt: b.createdAt, cashier: b.cashier, customerName: b.customerName, customerMobile: b.customerMobile,
        tableNo: b.tableNo, notes: b.notes, items: b.items.map(i => ({ name:i.name, qty:i.qty, price:i.price, taxRate:i.taxRate, productId:i.productId, variantName:i.variantName, addons:i.addons, custom:i.custom })), payments: b.payments, discount: b.discount, serviceCharge: b.serviceCharge, reason: b.statusReason || undefined }))));
      for (const r of res.results) {
        const b = chunk.find(x => x.clientTxnId === r.clientTxnId); if (!b) continue;
        const cur = await this.d.store.getBill(b.clientTxnId); if (!cur) continue;
        if (['created', 'duplicate', 'updated'].includes(r.result)) { await this.d.store.saveBill({ ...cur, synced: true, syncError: null }); accepted++; }
        else { await this.d.store.saveBill({ ...cur, syncError: r.reason || 'REJECTED' }); rejected++; }
      }
    }
    await this.d.store.kv.set('lastSyncAt', new Date(this.now()).toISOString());
    return { pending: list.length, accepted, rejected };
  }

  // ───────── inventory ─────────
  private async cachedInventory(): Promise<InventoryItem[]> {
    const raw = await this.d.store.kv.get('inventoryItems');
    return raw ? JSON.parse(raw) as InventoryItem[] : [];
  }
  private async cachedValue<T>(key: string): Promise<T | null> {
    const raw = await this.d.store.kv.get(key);
    return raw ? JSON.parse(raw) as T : null;
  }
  private inventoryCacheKey(key: string) { return `inventory:${this.businessId || 'unbound'}:${key}`; }
  private saveCachedValue(key: string, value: unknown) {
    return this.d.store.kv.set(key, JSON.stringify(value));
  }
  private async estimateInventory(items: InventoryItem[]): Promise<InventoryItem[]> {
    const queue = await this.queuedInventoryMovements();
    const result = items.map(item => ({ ...item }));
    for (const move of queue) {
      const item = result.find(row => row.id === move.inventoryItemId);
      if (!item) continue;
      if (move.type === 'wastage') item.onHand -= move.qty;
      else if (move.type === 'adjustment' || move.type === 'opening') item.onHand = move.qty;
      else item.onHand += move.qty;
      item.onHand = Math.round((item.onHand + Number.EPSILON) * 1000) / 1000;
      item.status = item.onHand <= 0 ? 'out' : item.onHand <= item.reorderLevel ? 'low' : 'ok';
    }
    for (const move of await this.d.store.listPendingLocalSaleUsage()) {
      const item = result.find(row => row.id === move.inventoryItemId);
      if (!item) continue;
      item.onHand = Math.round((item.onHand - move.qty + Number.EPSILON) * 1000) / 1000;
      item.status = item.onHand <= 0 ? 'out' : item.onHand <= item.reorderLevel ? 'low' : 'ok';
    }
    return result;
  }
  async inventoryItems(includeArchived = false): Promise<InventoryItem[]> {
    const cached = await this.cachedInventory();
    try {
      const { items } = await this.call(() => this.d.api.inventoryItems(true));
      await this.saveCachedValue('inventoryItems', items);
      const estimated = await this.estimateInventory(items);
      return includeArchived ? estimated : estimated.filter(item => item.active);
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      if (!cached.length) throw error;
      const estimated = await this.estimateInventory(cached);
      return includeArchived ? estimated : estimated.filter(item => item.active);
    }
  }
  async saveInventoryItem(id: string | null, item: InventoryItemInput, openingQty?: number): Promise<InventoryItem> {
    if (!this.canBill()) throw new PaidRequiredError();
    const saved = await this.call(() => id
      ? this.d.api.updateInventoryItem(id, item)
      : this.d.api.createInventoryItem({ ...item, ...(openingQty == null ? {} : { openingQty }), clientMoveId: this.d.uuid() }));
    await this.upsertInventoryCache(saved);
    return saved;
  }
  async archiveInventoryItem(id: string): Promise<InventoryItem> {
    if (!this.canBill()) throw new PaidRequiredError();
    const item = await this.call(() => this.d.api.archiveInventoryItem(id));
    await this.upsertInventoryCache(item);
    return item;
  }
  async restoreInventoryItem(id: string): Promise<InventoryItem> {
    if (!this.canBill()) throw new PaidRequiredError();
    const item = await this.call(() => this.d.api.restoreInventoryItem(id));
    await this.upsertInventoryCache(item);
    return item;
  }
  private async upsertInventoryCache(item: InventoryItem) {
    const items = await this.cachedInventory();
    const next = items.some(row => row.id === item.id) ? items.map(row => row.id === item.id ? item : row) : [...items, item];
    await this.saveCachedValue('inventoryItems', next);
    return next;
  }
  private async refreshInventoryItems() {
    const { items } = await this.call(() => this.d.api.inventoryItems(true));
    await this.saveCachedValue('inventoryItems', items);
    return items;
  }
  private async queuedInventoryMovements(): Promise<InventoryMovementInput[]> {
    const raw = await this.d.store.kv.get('inventoryMovementQueue');
    return raw ? JSON.parse(raw) as InventoryMovementInput[] : [];
  }
  async queueInventoryMovement(movement: InventoryMovementInput): Promise<'synced' | 'queued'> {
    if (!this.canBill()) throw new PaidRequiredError();
    if (!Number.isFinite(movement.qty) || movement.qty <= 0) throw new Error('Enter a quantity greater than zero.');
    try {
      await this.call(() => this.d.api.createInventoryMovement(movement));
      await this.refreshInventoryItems();
      return 'synced';
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      const queue = await this.queuedInventoryMovements();
      if (!queue.some(entry => entry.clientMoveId === movement.clientMoveId)) queue.push(movement);
      await this.d.store.kv.set('inventoryMovementQueue', JSON.stringify(queue));
      return 'queued';
    }
  }
  async syncInventoryMovements(): Promise<{ pending: number; accepted: number }> {
    const queue = await this.queuedInventoryMovements();
    if (!queue.length || !this.token) return { pending: queue.length, accepted: 0 };
    let accepted = 0;
    for (const movement of queue) {
      try {
        await this.call(() => this.d.api.createInventoryMovement(movement));
        accepted++;
      } catch (error) {
        if (error instanceof NetworkError) break;
        throw error;
      }
    }
    const remaining = queue.slice(accepted);
    await this.d.store.kv.set('inventoryMovementQueue', JSON.stringify(remaining));
    if (accepted) await this.refreshInventoryItems();
    return { pending: remaining.length, accepted };
  }
  inventoryMovementQueueCount() { return this.queuedInventoryMovements().then(rows => rows.length); }
  inventoryMovements(itemId: string, limit = 100): Promise<InventoryMovement[]> {
    const key = this.inventoryCacheKey(`movements:${itemId}`);
    return this.call(() => this.d.api.inventoryMovements({ item: itemId, limit: String(limit) })).then(async r => {
      await this.saveCachedValue(key, r.movements);
      return r.movements;
    }).catch(async error => {
      if (!(error instanceof NetworkError)) throw error;
      const cached = await this.cachedValue<InventoryMovement[]>(key);
      if (!cached) throw error;
      return cached;
    });
  }
  inventoryRecipes(): Promise<Record<string, RecipeLine[]>> {
    const key = this.inventoryCacheKey('recipes');
    return this.call(() => this.d.api.inventoryRecipes()).then(async r => {
      await this.saveCachedValue(key, r.recipes);
      return r.recipes;
    }).catch(async error => {
      if (!(error instanceof NetworkError)) throw error;
      const cached = await this.cachedValue<Record<string, RecipeLine[]>>(key);
      if (!cached) throw error;
      return cached;
    });
  }
  async saveInventoryRecipe(productId: string, lines: RecipeLine[]) {
    if (!this.canBill()) throw new PaidRequiredError();
    const saved = await this.call(() => this.d.api.saveInventoryRecipe(productId, lines));
    const recipes = await this.cachedValue<Record<string, RecipeLine[]>>(this.inventoryCacheKey('recipes')) || {};
    recipes[productId] = saved.lines;
    await this.saveCachedValue(this.inventoryCacheKey('recipes'), recipes);
    return saved.lines;
  }
  inventoryUsage(from: string, to: string): Promise<InventoryUsage> {
    const key = this.inventoryCacheKey(`usage:${from.slice(0, 10)}:${to.slice(0, 10)}`);
    return this.call(() => this.d.api.inventoryUsage(from, to)).then(async usage => {
      await this.saveCachedValue(key, usage);
      return usage;
    }).catch(async error => {
      if (!(error instanceof NetworkError)) throw error;
      const cached = await this.cachedValue<InventoryUsage>(key);
      if (!cached) throw error;
      return cached;
    });
  }
  inventorySettings(): Promise<InventorySettings> {
    const key = this.inventoryCacheKey('settings');
    return this.call(() => this.d.api.inventorySettings()).then(async settings => {
      await this.saveCachedValue(key, settings);
      return settings;
    }).catch(async error => {
      if (!(error instanceof NetworkError)) throw error;
      const cached = await this.cachedValue<InventorySettings>(key);
      if (!cached) throw error;
      return cached;
    });
  }
  async saveInventorySettings(settings: InventorySettings): Promise<InventorySettings> {
    if (!this.canBill()) throw new PaidRequiredError();
    const saved = await this.call(() => this.d.api.saveInventorySettings(settings));
    await this.saveCachedValue(this.inventoryCacheKey('settings'), saved);
    return saved;
  }
  inventoryOrders(status: 'open' | 'received' | 'all' = 'open'): Promise<InventoryOrder[]> {
    const key = this.inventoryCacheKey(`orders:${status}`);
    return this.call(() => this.d.api.inventoryOrders(status)).then(async r => {
      await this.saveCachedValue(key, r.orders);
      return r.orders;
    }).catch(async error => {
      if (!(error instanceof NetworkError)) throw error;
      const cached = await this.cachedValue<InventoryOrder[]>(key);
      if (!cached) throw error;
      return cached;
    });
  }
  createInventoryOrder(order: { supplier?: string; note?: string; lines: { inventoryItemId: string; qty: number }[] }): Promise<InventoryOrder> {
    if (!this.canBill()) throw new PaidRequiredError();
    return this.call(() => this.d.api.createInventoryOrder({ ...order, clientMoveId: this.d.uuid() }));
  }
  receiveInventoryOrder(id: string, lines: { inventoryItemId: string; qty: number; unitCost?: number }[]): Promise<InventoryOrder> {
    if (!this.canBill()) throw new PaidRequiredError();
    return this.call(() => this.d.api.receiveInventoryOrder(id, lines, this.d.uuid()));
  }
  cancelInventoryOrder(id: string): Promise<InventoryOrder> {
    if (!this.canBill()) throw new PaidRequiredError();
    return this.call(() => this.d.api.cancelInventoryOrder(id));
  }

  // ───────── history & reports ─────────
  private fromServer(r: any): Bill {
    return { clientTxnId: r.client_txn_id, invoiceNo: r.invoice_no, status: r.status, createdAt: r.created_at, cashier: r.cashier, customerName: r.customer_name, customerMobile: r.customer_mobile, tableNo: r.table_no, notes: r.notes,
      items: r.items, payments: r.payments, subtotal: r.subtotal, discount: r.discount, tax: r.tax, serviceCharge: r.service_charge, total: r.total, synced: true, syncError: null, printCount: 0, statusReason: null, remote: true };
  }
  /** Local bills (this device, incl. unsynced) merged with the business's synced bills from other devices when online. */
  async history(f: { from?: string; to?: string; q?: string; cashier?: string; method?: string; status?: string } = {}): Promise<{ bills: Bill[]; online: boolean }> {
    const local = (await this.d.store.listBills()).filter(b => b.status !== 'draft'); const map = new Map(local.map(b => [b.clientTxnId, b])); let online = false;
    if (this.token) {
      try {
        const qs = new URLSearchParams({ limit: '500', ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) }).toString();
        for (const r of await this.call(() => this.d.api.bills('?' + qs))) if (!map.has(r.client_txn_id)) map.set(r.client_txn_id, this.fromServer(r));
        online = true;
      } catch (e) { if (!(e instanceof NetworkError)) throw e; }
    }
    const q = (f.q || '').trim().toLowerCase();
    const bills = [...map.values()].filter(b => (!f.from || b.createdAt >= f.from) && (!f.to || b.createdAt <= f.to) && (!f.status || b.status === f.status) && (!f.cashier || (b.cashier || '').toLowerCase().includes(f.cashier.toLowerCase()))
      && (!f.method || b.payments.some(p => p.method === f.method)) && (!q || (b.invoiceNo || '').toLowerCase().includes(q))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { bills, online };
  }
  async report(from: string, to: string): Promise<ReportData> {
    if (this.token) {
      try {
        await this.syncBills().catch(() => null);
        const r = await this.call(() => this.d.api.summary(from, to));
        return { source: 'server', billCount: r.billCount, total: r.total, averageBill: r.averageBill, discounts: r.discounts, tax: r.tax, byMethod: r.byMethod || {}, itemWise: r.itemWise };
      } catch (e) { if (!(e instanceof NetworkError)) throw e; }
    }
    const rows = (await this.d.store.listBills()).filter(b => b.status === 'completed' && b.createdAt >= from && b.createdAt <= to);
    const items = new Map<string, { name: string; qty: number; revenue: number }>(); const byMethod: Record<string, number> = {};
    for (const b of rows) { b.items.forEach(i => { const c = items.get(i.name) || { name: i.name, qty: 0, revenue: 0 }; c.qty += i.qty; c.revenue = money(c.revenue + i.qty * i.price); items.set(i.name, c); }); b.payments.forEach(p => { byMethod[p.method] = money((byMethod[p.method] || 0) + p.amount); }); }
    const total = money(rows.reduce((a, b) => a + b.total, 0));
    return { source: 'device', billCount: rows.length, total, averageBill: rows.length ? money(total / rows.length) : 0, discounts: money(rows.reduce((a, b) => a + b.discount, 0)), tax: money(rows.reduce((a, b) => a + b.tax, 0)), byMethod, itemWise: [...items.values()].sort((a, b) => b.revenue - a.revenue) };
  }
  csv(bills: Bill[]): string {
    const esc = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return ['invoice_no,created_at,status,cashier,payment_methods,subtotal,discount,tax,service_charge,total', ...bills.map(b => [b.invoiceNo, b.createdAt, b.status, b.cashier, b.payments.map(p => p.method).join('+'), b.subtotal, b.discount, b.tax, b.serviceCharge, b.total].map(esc).join(','))].join('\n');
  }

  // ───────── misc ─────────
  notifications() { return this.call(() => this.d.api.notifications()); }
  markNotificationsRead() { return this.call(() => this.d.api.readAll()); }
  sendSupport(subject: string, message: string) { return this.call(() => this.d.api.support(subject, message)); }
  async lastSyncAt() { return this.d.store.kv.get('lastSyncAt'); }
  async printer(): Promise<PrinterConfig | null> { const v = await this.d.store.kv.get('printer'); return v ? JSON.parse(v) : null; }
  async setPrinter(p: PrinterConfig | null) { if (p) await this.d.store.kv.set('printer', JSON.stringify(p)); else await this.d.store.kv.del('printer'); }
}
