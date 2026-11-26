import type { Bill, Product } from './types';

export interface KV { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }
export interface LocalSaleUsage { clientTxnId: string; inventoryItemId: string; qty: number }
/** Local persistence. Implemented by SQLite on device and by memory in tests. */
export interface Store {
  replaceProducts(p: Product[]): Promise<void>;
  listProducts(): Promise<Product[]>;
  saveBill(b: Bill): Promise<void>;
  saveBillWithLocalSaleUsage(b: Bill, usage: LocalSaleUsage[]): Promise<void>;
  listPendingLocalSaleUsage(): Promise<LocalSaleUsage[]>;
  getBill(clientTxnId: string): Promise<Bill | null>;
  deleteBill(clientTxnId: string): Promise<void>;
  listBills(): Promise<Bill[]>;                // newest first
  unsynced(): Promise<Bill[]>;                 // completed/void/refunded with synced=false, oldest first
  nextCounter(name: string): Promise<number>;  // atomic, never repeats
  kv: KV;
  clearBusinessData(): Promise<void>;
}

export class MemoryKV implements KV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async del(k: string) { this.m.delete(k); }
}
export class MemoryStore implements Store {
  products: Product[] = []; bills = new Map<string, Bill>(); counters = new Map<string, number>(); kv = new MemoryKV(); localSaleUsage = new Map<string, LocalSaleUsage>();
  async replaceProducts(p: Product[]) { this.products = p; }
  async listProducts() { return this.products; }
  async saveBill(b: Bill) { this.bills.set(b.clientTxnId, JSON.parse(JSON.stringify(b))); if (b.synced) for (const [key, row] of this.localSaleUsage) if (row.clientTxnId === b.clientTxnId) this.localSaleUsage.delete(key); }
  async saveBillWithLocalSaleUsage(b: Bill, usage: LocalSaleUsage[]) {
    await this.saveBill(b);
    if (!b.synced) for (const row of usage) this.localSaleUsage.set(`${row.clientTxnId}:${row.inventoryItemId}`, { ...row });
  }
  async listPendingLocalSaleUsage() {
    return [...this.localSaleUsage.values()].filter(row => {
      const bill = this.bills.get(row.clientTxnId);
      return bill?.status === 'completed' && !bill.synced;
    }).map(row => ({ ...row }));
  }
  async getBill(id: string) { const b = this.bills.get(id); return b ? JSON.parse(JSON.stringify(b)) : null; }
  async deleteBill(id: string) { this.bills.delete(id); }
  async listBills() { return [...this.bills.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async unsynced() { return [...this.bills.values()].filter(b => b.status !== 'draft' && !b.synced).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async nextCounter(name: string) { const n = (this.counters.get(name) || 0) + 1; this.counters.set(name, n); return n; }
  async clearBusinessData() { this.products = []; this.bills.clear(); this.counters.clear(); this.localSaleUsage.clear(); }
}
