import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Api } from '../src/core/api';
import { Engine } from '../src/core/engine';
import { MemoryKV, MemoryStore } from '../src/core/store';

const backendPath = path.resolve(process.env.TABLY_BACKEND_PATH || '../tably-backend');
const req = createRequire(path.join(backendPath, 'package.json'));
const { openDb } = req('./src/db'); const { createApp } = req('./src/app');
const bcrypt = req('bcryptjs');

export interface Backend { base: string; close(): void; admin(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }>; db: any; latestAuthCode(): string }
export async function startBackend(): Promise<Backend> {
  const db = openDb(':memory:'); const outbox: { text: string; subject: string }[] = [];
  db.prepare('INSERT INTO admins(id,email,password_hash,totp_secret) VALUES (?,?,?,?)').run('ADM-T', 'o@x.com', bcrypt.hashSync('correct horse battery', 4), '');
  const app = createApp(db, { noRateLimit: true, mailer: { sendMail: async (m: { text: string; subject: string }) => { outbox.push(m); } } });
  const server: any = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const s1 = await (await fetch(base + '/admin-api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'o@x.com', password: 'correct horse battery' }) })).json();
  const code = /code is (\d{6})/.exec(outbox[outbox.length - 1].text)![1];
  const l = await fetch(base + '/admin-api/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: s1.challenge, code }) });
  const cookie = (l.headers.get('set-cookie') || '').split(';')[0];
  const admin = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + '/admin-api' + p, { method, headers: { 'content-type': 'application/json', cookie, 'x-csrf': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  return { base, close: () => server.close(), admin, db, latestAuthCode: () => {
    const mail = [...outbox].reverse().find(x => x.subject !== 'Your Tably sign-in code');
    const match = mail && /Your code is (\d{6})/.exec(mail.text);
    if (!match) throw new Error('No customer auth code was emailed');
    return match[1];
  } };
}

export interface Rig { eng: Engine; store: MemoryStore; secrets: MemoryKV; net: { offline: boolean }; clock: { offsetMs: number }; lostCount: () => number }
export function makeEngine(base: string, shared?: { store?: MemoryStore; secrets?: MemoryKV }): Rig {
  const store = shared?.store || new MemoryStore(); const secrets = shared?.secrets || new MemoryKV(); const net = { offline: false }; const clock = { offsetMs: 0 }; let lost = 0; let n = 0;
  let eng!: Engine;
  const fetchImpl = async (url: string, init?: any) => { if (net.offline) throw new TypeError('Network request failed'); const r = await fetch(url, init); return { status: r.status, ok: r.ok, text: () => r.text() }; };
  const api = new Api({ baseUrl: base, getToken: () => eng.token, fetchImpl });
  eng = new Engine({ api, secrets, store, uuid: () => `uuid-${Date.now()}-${++n}-${Math.random().toString(16).slice(2)}`, buildCode: 1, hash: async (v: string) => createHash('sha256').update(v).digest('hex'), now: () => Date.now() + clock.offsetMs, onAuthLost: () => { lost++; } });
  return { eng, store, secrets, net, clock, lostCount: () => lost };
}
let mobileN = 0;
export async function onboard(b: Backend, rig: Rig, name = 'Test Cafe') {
  const mobile = '97000' + String(10000 + ++mobileN);
  const email = `customer${mobileN}@example.test`, password = 'correct horse battery';
  const reg = await rig.eng.register(email, password, 'Asha', mobile);
  await rig.eng.verifyRegistration(reg.challenge, b.latestAuthCode());
  await rig.eng.init();
  const r = await rig.eng.createBusiness({ ownerName: 'Asha', businessName: name, businessType: 'cafe', address: '1 MG Road', contact: mobile });
  return { mobile, email, password, businessId: r.businessId };
}
export async function approve(b: Backend, rig: Rig, ref: string) {
  const s = await rig.eng.requestSubscription({ paymentRef: ref, amount: 999, method: 'upi' });
  await b.admin('POST', `/subscriptions/${s.subscriptionId}/verify-payment`, {});
  const a = await b.admin('POST', `/subscriptions/${s.subscriptionId}/approve`, {});
  if (a.status !== 200) throw new Error('approve failed ' + JSON.stringify(a.json));
  return s.subscriptionId;
}
