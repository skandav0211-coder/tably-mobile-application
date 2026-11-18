import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type { Bill, Product } from '../core/types';
import type { KV, Store } from '../core/store';

/** Local-first storage. With the SQLCipher build option (see app.json) the file is encrypted with a Keystore-held key;
 *  on plain SQLite (e.g. Expo Go) PRAGMA key is a harmless no-op. */
export async function openSqliteStore(secrets: KV): Promise<Store> {
  const db = await SQLite.openDatabaseAsync('billing.db');
  let key = await secrets.get('dbKey');
  if (!key) { key = Array.from(Crypto.getRandomBytes(32)).map(b => b.toString(16).padStart(2, '0')).join(''); await secrets.set('dbKey', key); }
  await db.execAsync(`PRAGMA key = '${key}';`);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bills (clientTxnId TEXT PRIMARY KEY, status TEXT NOT NULL, createdAt TEXT NOT NULL, synced INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_bills_sync ON bills(synced, status);
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  const kv: KV = {
    async get(k) { const r = await db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k=?', [k]); return r ? r.v : null; },
    async set(k, v) { await db.runAsync('INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, v]); },
    async del(k) { await db.runAsync('DELETE FROM kv WHERE k=?', [k]); },
  };
  const parse = (rows: { json: string }[]) => rows.map(r => JSON.parse(r.json) as Bill);
  return {
    kv,
    async replaceProducts(p: Product[]) { await db.withTransactionAsync(async () => { await db.runAsync('DELETE FROM products'); for (const x of p) await db.runAsync('INSERT INTO products(id,json) VALUES (?,?)', [x.id, JSON.stringify(x)]); }); },
    async listProducts() { return (await db.getAllAsync<{ json: string }>('SELECT json FROM products')).map(r => JSON.parse(r.json) as Product); },
    async saveBill(b: Bill) { await db.runAsync('INSERT INTO bills(clientTxnId,status,createdAt,synced,json) VALUES (?,?,?,?,?) ON CONFLICT(clientTxnId) DO UPDATE SET status=excluded.status, synced=excluded.synced, json=excluded.json', [b.clientTxnId, b.status, b.createdAt, b.synced ? 1 : 0, JSON.stringify(b)]); },
    async getBill(id: string) { const r = await db.getFirstAsync<{ json: string }>('SELECT json FROM bills WHERE clientTxnId=?', [id]); return r ? (JSON.parse(r.json) as Bill) : null; },
    async deleteBill(id: string) { await db.runAsync('DELETE FROM bills WHERE clientTxnId=?', [id]); },
    async listBills() { return parse(await db.getAllAsync<{ json: string }>('SELECT json FROM bills ORDER BY createdAt DESC')); },
    async unsynced() { return parse(await db.getAllAsync<{ json: string }>("SELECT json FROM bills WHERE synced=0 AND status<>'draft' ORDER BY createdAt ASC")); },
    async nextCounter(name: string) {
      let n = 0;
      await db.withExclusiveTransactionAsync(async tx => {
        await tx.runAsync('INSERT INTO counters(name,value) VALUES (?,0) ON CONFLICT(name) DO NOTHING', [name]);
        await tx.runAsync('UPDATE counters SET value=value+1 WHERE name=?', [name]);
        n = (await tx.getFirstAsync<{ value: number }>('SELECT value FROM counters WHERE name=?', [name]))!.value;
      });
      return n;
    },
    async clearBusinessData() { await db.withTransactionAsync(async () => { await db.runAsync('DELETE FROM bills'); await db.runAsync('DELETE FROM products'); await db.runAsync('DELETE FROM counters'); }); },
  };
}
