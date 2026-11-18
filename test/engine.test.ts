import test from 'node:test';
import assert from 'node:assert/strict';
import { startBackend, makeEngine, onboard, approve, Backend } from './helpers';
import { PaidRequiredError } from '../src/core/engine';
import { calculate, serviceChargeFor } from '../src/core/calc';
import type { CartLine } from '../src/core/types';

let be: Backend;
test.before(async () => { be = await startBackend(); });
test.after(() => be.close());

const line = (name: string, price: number, qty: number, taxRate = 0): CartLine => ({ key: name, itemId: name, name, price, qty, taxRate });
let cartN = 0; const cart = () => `cart-${Date.now()}-${++cartN}`;

test('onboarding gating: pending subscription has no paid access; approval + device registration unlock billing', async () => {
  const rig = makeEngine(be.base); await rig.eng.init();
  await onboard(be, rig);
  assert.equal(await rig.eng.bootstrap(), 'locked');                        // registered, not subscribed: locked home
  const sub = await rig.eng.requestSubscription({ paymentRef: 'UTR-M1', amount: 999, method: 'upi' });
  assert.equal(sub.status, 'pending');
  assert.equal(await rig.eng.bootstrap(), 'locked');                        // still pending
  await assert.rejects(rig.eng.registerDevice('Phone'), /subscription/i);   // server refuses device registration
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines: [line('Tea', 20, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' }), PaidRequiredError);
  await be.admin('POST', `/subscriptions/${sub.subscriptionId}/verify-payment`, {});
  assert.equal((await be.admin('POST', `/subscriptions/${sub.subscriptionId}/approve`, {})).status, 200);
  assert.equal(await rig.eng.bootstrap(), 'device');                        // paid, device not registered
  const d = await rig.eng.registerDevice('Counter 1');
  assert.equal(d.invoicePrefix, 'D1'); assert.equal(rig.eng.canBill(), true);
  assert.equal(await rig.eng.bootstrap(), 'home');
});

test('billing is local-first, idempotent on double tap, syncs exactly once, and server totals equal local totals', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Sync Cafe'); await approve(be, rig, 'UTR-S1'); await rig.eng.registerDevice('P1');
  await rig.eng.saveProduct(null, { name: 'Latte', price: 100, taxRate: 5, category: 'Coffee', favourite: true, variants: [{ name: 'Large', priceDelta: 20, kind: 'variant' }] });
  const prods = await rig.eng.products(); assert.equal(prods.length, 1); assert.equal(prods[0].variants[0].name, 'Large'); assert.equal(prods[0].taxRate, 5);
  await rig.eng.loadMe();
  const id = cart(); const lines = [line('Latte (Large)', 120, 2, 5), line('Brownie', 60, 1, 18)];
  const b1 = await rig.eng.completeBill({ cartId: id, lines, discount: 30, serviceChargePercent: 5, method: 'upi', customerName: 'Ravi', tableNo: '4' });
  const b2 = await rig.eng.completeBill({ cartId: id, lines, discount: 30, serviceChargePercent: 5, method: 'upi' });   // double tap
  assert.equal(b1.invoiceNo, 'D1-000001'); assert.equal(b2.clientTxnId, b1.clientTxnId); assert.equal((await rig.store.listBills()).length, 1);
  assert.equal(b1.synced, false);                                           // saved locally before any network call
  const s1 = await rig.eng.syncBills(); assert.deepEqual([s1.accepted, s1.rejected], [1, 0]);
  const s2 = await rig.eng.syncBills(); assert.equal(s2.pending, 0);       // nothing left → no duplicate send
  const row = be.db.prepare('SELECT total,tax,discount,service_charge,invoice_no FROM bills WHERE client_txn_id=?').get(id);
  assert.equal(row.total, b1.total); assert.equal(row.tax, b1.tax); assert.equal(row.discount, 30); assert.equal(row.service_charge, b1.serviceCharge); assert.equal(row.invoice_no, 'D1-000001');
  const rep = await rig.eng.report('0000', '9999'); assert.equal(rep.source, 'server'); assert.equal(rep.billCount, 1); assert.equal(rep.total, b1.total); assert.deepEqual(rep.byMethod, { upi: b1.total });
});

test('split payments must add up; invalid inputs are rejected before saving', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Split Cafe'); await approve(be, rig, 'UTR-P1'); await rig.eng.registerDevice('P1');
  const lines = [line('Meal', 250, 1)];
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines, discount: 0, serviceChargePercent: 0, method: 'cash', split: [{ method: 'cash', amount: 100 }, { method: 'upi', amount: 100 }] }), /add up/);
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines: [], discount: 0, serviceChargePercent: 0, method: 'cash' }), /at least one/);
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines, discount: -5, serviceChargePercent: 0, method: 'cash' }), /negative/);
  const ok = await rig.eng.completeBill({ cartId: cart(), lines, discount: 0, serviceChargePercent: 0, method: 'cash', split: [{ method: 'cash', amount: 100 }, { method: 'upi', amount: 150 }] });
  assert.equal(ok.payments.length, 2); assert.equal((await rig.eng.syncBills()).accepted, 1);
  assert.equal((await rig.store.listBills()).length, 1);                    // failed attempts left nothing behind
});

test('OFFLINE: bills are created and kept without network, then sync when back online (no duplicates, in order)', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Offline Cafe'); await approve(be, rig, 'UTR-O1'); await rig.eng.registerDevice('P1');
  rig.net.offline = true;
  const a = await rig.eng.completeBill({ cartId: cart(), lines: [line('A', 10, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' });
  const b = await rig.eng.completeBill({ cartId: cart(), lines: [line('B', 20, 2)], discount: 0, serviceChargePercent: 0, method: 'cash' });
  assert.deepEqual([a.invoiceNo, b.invoiceNo], ['D1-000001', 'D1-000002']);
  await assert.rejects(rig.eng.syncBills(), /No connection/);
  assert.equal((await rig.eng.history()).online, false); assert.equal((await rig.eng.history()).bills.length, 2);
  assert.equal((await rig.eng.report('0000', '9999')).source, 'device');
  assert.equal(await rig.eng.refreshSession(), null);                        // offline refresh keeps the bounded window
  rig.net.offline = false;
  assert.deepEqual(await rig.eng.syncBills().then(r => [r.accepted, r.rejected]), [2, 0]);
  assert.equal(be.db.prepare("SELECT COUNT(*) c FROM bills WHERE invoice_no IN ('D1-000001','D1-000002') AND business_id=(SELECT business_id FROM devices WHERE id=?)").get(rig.eng.deviceId).c, 2);
});

test('bounded offline window and clock-rollback protection', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Clock Cafe'); await approve(be, rig, 'UTR-C1'); await rig.eng.registerDevice('P1');
  assert.equal(rig.eng.canBill(), true);
  rig.clock.offsetMs = 71 * 3600_000; assert.equal(rig.eng.canBill(), true);          // inside 72h window
  rig.clock.offsetMs = 73 * 3600_000; assert.equal(rig.eng.canBill(), false);         // window over → must reconnect
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines: [line('A', 1, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' }), PaidRequiredError);
  const rig2 = makeEngine(be.base); await rig2.eng.init(); await onboard(be, rig2, 'Rollback Cafe'); await approve(be, rig2, 'UTR-C2'); await rig2.eng.registerDevice('P1');
  rig2.clock.offsetMs = 3600_000; assert.equal(rig2.eng.canBill(), true);             // user moves clock forward…
  rig2.clock.offsetMs = 0; assert.equal(rig2.eng.canBill(), false);                   // …then back → locked
});

test('server suspension / revocation propagate: refresh locks billing; pre-suspension offline bills still sync', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Suspend Cafe'); const subId = await approve(be, rig, 'UTR-X1'); await rig.eng.registerDevice('P1');
  await new Promise(r => setTimeout(r, 15));
  const early = await rig.eng.completeBill({ cartId: cart(), lines: [line('A', 50, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' });
  await new Promise(r => setTimeout(r, 15));
  assert.equal((await be.admin('POST', `/subscriptions/${subId}/suspend`, { reason: 'review' })).status, 200);
  const sub = await rig.eng.refreshSession(); assert.equal(sub?.status, 'suspended'); assert.equal(rig.eng.canBill(), false);
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines: [line('B', 1, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' }), PaidRequiredError);
  assert.equal((await rig.eng.syncBills()).accepted, 1); assert.equal((await rig.store.getBill(early.clientTxnId))!.synced, true);
  await be.admin('POST', `/subscriptions/${subId}/reinstate`, { reason: 'ok' });
  await rig.eng.refreshSession(); assert.equal(rig.eng.canBill(), true);
  // admin revokes the device → next refresh clears credentials
  assert.equal((await be.admin('POST', `/devices/${rig.eng.deviceId}/revoke`, { reason: 'lost phone' })).status, 200);
  await assert.rejects(rig.eng.refreshSession());
  assert.equal(rig.eng.deviceToken, null); assert.equal(rig.eng.canBill(), false); assert.ok(rig.lostCount() >= 1);
});

test('device limit: 4th device refused; owner removal frees the slot and new registration gets a NEW invoice prefix', async () => {
  const first = makeEngine(be.base); await first.eng.init(); await onboard(be, first, 'Limit Cafe'); await approve(be, first, 'UTR-D1');
  const account = (await first.eng.loadMe()).user;
  await first.eng.registerDevice('One');
  const extra: ReturnType<typeof makeEngine>[] = [];
  for (const n of [2, 3, 4]) {
    const r = makeEngine(be.base); await r.eng.init(); await r.eng.login(account.email!, 'correct horse battery'); await r.eng.init(); extra.push(r);
    if (n < 4) { const d = await r.eng.registerDevice('Dev' + n); assert.equal(d.invoicePrefix, 'D' + n); }
    else await assert.rejects(r.eng.registerDevice('Dev4'), /limit/i);
  }
  const list = await first.eng.devices(); assert.equal(list.used, 3); assert.equal(list.devices.filter(d => d.current).length, 1);
  await first.eng.removeDevice(extra[0].eng.deviceId!);
  const d4 = await extra[2].eng.registerDevice('Dev4'); assert.equal(d4.invoicePrefix, 'D4'); assert.equal(d4.slot, 2);   // slot reused, prefix never reused
});

test('void and refund sync to the server with reasons; completed-only rule and reason are enforced', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Void Cafe'); await approve(be, rig, 'UTR-V1'); await rig.eng.registerDevice('P1');
  const mk = (p: number) => rig.eng.completeBill({ cartId: cart(), lines: [line('X', p, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' });
  const a = await mk(10), b = await mk(20); await rig.eng.syncBills();
  await assert.rejects(rig.eng.changeStatus(a, 'void', '  '), /reason/i);
  const va = await rig.eng.changeStatus(a, 'void', 'wrong order'); await assert.rejects(rig.eng.changeStatus(va, 'refunded', 'x'), /completed/);
  await rig.eng.changeStatus(b, 'refunded', 'customer returned'); await rig.eng.syncBills();
  const st = (id: string) => be.db.prepare('SELECT status FROM bills WHERE client_txn_id=?').get(id).status;
  assert.equal(st(a.clientTxnId), 'void'); assert.equal(st(b.clientTxnId), 'refunded');
  assert.ok(be.db.prepare("SELECT 1 FROM audit_events WHERE action='bill.refunded' AND reason='customer returned'").get());
  assert.equal((await rig.eng.report('0000', '9999')).billCount, 0);          // voided/refunded excluded from sales
});

test('drafts are local only and never synced; history merges bills from other devices; filters work', async () => {
  const r1 = makeEngine(be.base); await r1.eng.init(); await onboard(be, r1, 'Multi Cafe'); await approve(be, r1, 'UTR-H1'); await r1.eng.registerDevice('P1');
  const account = (await r1.eng.loadMe()).user;
  const dr = await r1.eng.saveDraft({ cartId: 'draft-1', lines: [line('Soup', 90, 1)], discount: 0, serviceChargePercent: 0, tableNo: '2' });
  assert.equal(dr.status, 'draft'); assert.equal((await r1.eng.drafts()).length, 1); assert.equal((await r1.eng.syncBills()).pending, 0);
  await r1.eng.completeBill({ cartId: cart(), lines: [line('Tea', 20, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' }); await r1.eng.syncBills();
  const r2 = makeEngine(be.base); await r2.eng.init(); await r2.eng.login(account.email!, 'correct horse battery'); await r2.eng.init(); await r2.eng.registerDevice('P2');
  await r2.eng.completeBill({ cartId: cart(), lines: [line('Cake', 80, 1)], discount: 0, serviceChargePercent: 0, method: 'card' });
  const h = await r2.eng.history(); assert.equal(h.online, true); assert.equal(h.bills.length, 2);                   // own + other device's
  assert.equal((await r2.eng.history({ method: 'cash' })).bills.length, 1); assert.equal((await r2.eng.history({ q: 'D1-' })).bills.length, 1);
  assert.equal((await r2.eng.history({ status: 'void' })).bills.length, 0);
  await r1.eng.deleteDraft('draft-1'); assert.equal((await r1.eng.drafts()).length, 0);
});

test('tenant isolation on the device: signing in as a different business wipes the previous business data', async () => {
  const shared = { store: undefined as any, secrets: undefined as any };
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Biz A'); await approve(be, rig, 'UTR-T1'); await rig.eng.registerDevice('P1');
  await rig.eng.completeBill({ cartId: cart(), lines: [line('Secret', 1, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' });
  await rig.eng.logout(); assert.equal(rig.eng.token, null); assert.equal((await rig.store.listBills()).length, 1);          // logout keeps local data for the same owner
  await onboard(be, rig, 'Biz B');   // a different account signs in on the same phone
  assert.equal((await rig.store.listBills()).length, 0); assert.equal(rig.eng.invoicePrefix, null); assert.equal(rig.eng.canBill(), false);
  void shared;
});

test('property: client and server compute identical totals for 60 random carts (any divergence would be rejected as PAYMENT_MISMATCH)', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig, 'Parity Cafe'); await approve(be, rig, 'UTR-Q1'); await rig.eng.registerDevice('P1');
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rnd() * 4); const rates = [0, 5, 12, 18, 28];
    const lines = Array.from({ length: n }, (_, k) => line('I' + k, Math.round(rnd() * 99900) / 100, 1 + Math.floor(rnd() * 5), rates[Math.floor(rnd() * rates.length)]));
    const sub = lines.reduce((a, l) => a + l.qty * l.price, 0); const disc = Math.round(rnd() * sub * 0.4 * 100) / 100; const svc = [0, 5, 10][Math.floor(rnd() * 3)];
    const b = await rig.eng.completeBill({ cartId: cart(), lines, discount: disc, serviceChargePercent: svc, method: 'cash' });
    const t = calculate(lines, disc, serviceChargeFor(lines, disc, svc)); assert.equal(b.total, t.total);
  }
  const r = await rig.eng.syncBills(); assert.deepEqual([r.accepted, r.rejected], [60, 0]);
});

// ───────── registered-but-unsubscribed + MPIN ─────────
test('locked state: a registered owner can subscribe and edit the profile, but every paid feature stays blocked', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); await onboard(be, rig);
  assert.equal(await rig.eng.bootstrap(), 'locked');
  assert.equal(rig.eng.canBill(), false);
  await assert.rejects(rig.eng.completeBill({ cartId: cart(), lines: [line('Tea', 20, 1)], discount: 0, serviceChargePercent: 0, method: 'cash' }), PaidRequiredError);
  assert.equal((await rig.eng.subscription()).status, 'none');
  assert.equal((await rig.eng.subscription()).paid, false);
  await assert.rejects(rig.eng.saveProduct(null, { name: 'Tea', price: 20 }));          // catalogue is a paid feature on the server
  assert.equal((await rig.eng.devices()).used, 0);                                      // slot list is readable, but…
  await assert.rejects(rig.eng.registerDevice('Phone'), /subscription/i);               // …a device cannot be registered without a paid plan
  assert.equal((await rig.eng.syncBills()).accepted, 0);                                 // nothing can reach the bill ledger
  const me = await rig.eng.updateBusiness({ address: '2 Brigade Road' }); assert.equal(me.business?.address, '2 Brigade Road');
  await rig.eng.requestSubscription({ paymentRef: 'UTR-LOCK1', amount: 999, method: 'upi' });
  assert.equal(await rig.eng.bootstrap(), 'locked');                                    // pending ≠ unlocked
});

test('MPIN: set / verify / change / remove, weak and malformed values refused', async () => {
  const rig = makeEngine(be.base); await rig.eng.init();
  assert.equal(await rig.eng.hasMpin(), false);
  for (const bad of ['1111', '1234', '4321', '12', '12345', 'abcd', '1234567']) await assert.rejects(rig.eng.setMpin(bad), /MPIN/);
  await rig.eng.setMpin('2580'); assert.equal(await rig.eng.hasMpin(), true); assert.equal(await rig.eng.mpinLength(), 4);
  assert.deepEqual(await rig.eng.verifyMpin('2580'), { ok: true });
  assert.equal((await rig.eng.verifyMpin('0000')).ok, false);
  await assert.rejects(rig.eng.changeMpin('9999', '135790'), /incorrect/);
  await rig.eng.changeMpin('2580', '135790'); assert.equal(await rig.eng.mpinLength(), 6);
  assert.equal((await rig.eng.verifyMpin('2580')).ok, false); assert.equal((await rig.eng.verifyMpin('135790')).ok, true);
  await assert.rejects(rig.eng.removeMpin('000000'), /incorrect/);
  await rig.eng.removeMpin('135790'); assert.equal(await rig.eng.hasMpin(), false);
  // the PIN itself is never stored in the clear
  await rig.eng.setMpin('2580'); for (const k of ['mpinHash', 'mpinSalt']) assert.ok(!(await rig.secrets.get(k))!.includes('2580'));
});

test('MPIN: 5 wrong tries lock for 60s (even with the right PIN, and a clock rollback does not help); 10 erase it and sign the user out', async () => {
  const be2 = await startBackend(); try {
    const rig = makeEngine(be2.base); await rig.eng.init(); await onboard(be2, rig); await approve(be2, rig, 'UTR-MP1'); await rig.eng.registerDevice('P'); await rig.eng.setMpin('2580');
    let r: any; for (let i = 0; i < 4; i++) { r = await rig.eng.verifyMpin('1357'); assert.equal(r.reason, 'wrong'); }
    assert.equal(r.attemptsLeft, 1);
    r = await rig.eng.verifyMpin('1357'); assert.equal(r.reason, 'locked'); assert.equal(r.retryAfterSec, 60);
    assert.equal((await rig.eng.verifyMpin('2580')).ok, false);                          // right PIN refused while locked
    rig.clock.offsetMs -= 3_600_000;                                                     // rolling the clock back must not shorten the lock
    assert.equal((await rig.eng.verifyMpin('2580')).ok, false);
    rig.clock.offsetMs += 3_600_000 + 61_000;                                            // lock expires
    assert.equal((await rig.eng.verifyMpin('2580')).ok, true);                           // success resets the counter
    for (let i = 0; i < 9; i++) { r = await rig.eng.verifyMpin('1357'); if (r.reason === 'locked') rig.clock.offsetMs += 61_000; }
    r = await rig.eng.verifyMpin('1357'); assert.equal(r.reason, 'wiped');
    assert.equal(await rig.eng.hasMpin(), false); assert.equal(rig.eng.token, null);     // erased + signed out (email/password required)
    assert.equal(rig.eng.canBill(), false);
  } finally { be2.close(); }
});

test('MPIN: sign-out erases it; auto-lock setting persists', async () => {
  const rig = makeEngine(be.base); await rig.eng.init(); assert.equal(await rig.eng.autoLockSec(), 30);
  await rig.eng.setAutoLockSec(0); assert.equal(await rig.eng.autoLockSec(), 0);
  await rig.eng.setMpin('2580'); await rig.eng.logout(); assert.equal(await rig.eng.hasMpin(), false);
});
