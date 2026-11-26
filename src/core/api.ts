import type { Me, Subscription, DeviceInfo, Product, Business, InventoryItem, InventoryItemInput, InventoryMovement, InventoryMovementInput, InventoryOrder, InventorySettings, InventoryUsage, RecipeLine } from './types';

export class ApiError extends Error { constructor(public status: number, message: string, public code?: string, public extra?: any) { super(message); } }
export class NetworkError extends Error { constructor() { super('No connection to the server. Check your internet and try again.'); } }

export type Fetch = (url: string, init?: any) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
export interface ApiOpts {
  baseUrl: string;
  getToken: () => string | null;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  onConnectionState?: (connecting: boolean) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class Api {
  constructor(private o: ApiOpts) {}
  private async req<T>(method: string, path: string, body?: unknown, token: string | null = this.o.getToken()): Promise<T> {
    const fetchImpl = this.o.fetchImpl || (fetch as any);
    const sleep = this.o.sleep || ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    let response: Awaited<ReturnType<Fetch>> | undefined;
    let responseText: string | undefined;
    this.o.onConnectionState?.(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 30000) : null;
        let retry = false;
        try {
          const attemptResponse = await fetchImpl(this.o.baseUrl.replace(/\/+$/, '') + path, {
            method,
            signal: ctl?.signal,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          if ([502, 503, 504].includes(attemptResponse.status) && attempt < 2) {
            retry = true;
          } else {
            const text = await attemptResponse.text();
            response = attemptResponse;
            responseText = text;
            break;
          }
        } catch {
          if (attempt === 2) throw new NetworkError();
          retry = true;
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (retry) await sleep(500 * (2 ** attempt));
      }
    } finally {
      this.o.onConnectionState?.(false);
    }
    const finalResponse = response;
    if (!finalResponse) throw new NetworkError();
    let j: any = {}; try { j = responseText ? JSON.parse(responseText) : {}; } catch { /* non-JSON error page */ }
    if (!finalResponse.ok) throw new ApiError(finalResponse.status, j.error || `Request failed (${finalResponse.status})`, j.code, j);
    return j as T;
  }
  register = (data: { email: string; password: string; ownerName: string; phone: string }) => this.req<{ challenge: string; email: string; expiresInSec: number; resendAfterSec: number }>('POST', '/api/auth/register', data, null);
  resendRegistrationCode = (challenge: string) => this.req<{ challenge: string; email: string; expiresInSec: number; resendAfterSec: number }>('POST', '/api/auth/register/resend', { challenge }, null);
  verifyRegistration = (challenge: string, code: string) => this.req<AuthSession>('POST', '/api/auth/register/verify', { challenge, code }, null);
  login = (email: string, password: string) => this.req<AuthSession>('POST', '/api/auth/login', { email, password }, null);
  forgotPassword = (email: string) => this.req<{ ok: boolean; challenge: string; message: string }>('POST', '/api/auth/password/forgot', { email }, null);
  resendPasswordCode = (challenge: string) => this.req<{ ok: boolean; challenge: string; email: string; expiresInSec: number; resendAfterSec: number }>('POST', '/api/auth/password/resend', { challenge }, null);
  resetPassword = (challenge: string, code: string, password: string) => this.req<{ ok: boolean }>('POST', '/api/auth/password/reset', { challenge, code, password }, null);
  verifySetupInvite = (email: string, code: string, password: string) => this.req<AuthSession>('POST', '/api/auth/setup/verify', { email, code, password }, null);
  resendSetupInvite = (email: string) => this.req<{ challenge: string; email: string; expiresInSec: number; resendAfterSec: number }>('POST', '/api/auth/setup/resend', { email }, null);
  logoutAll = () => this.req('POST', '/api/auth/logout-all', {});
  createBusiness = (b: Record<string, unknown>) => this.req<{ businessId: string }>('POST', '/api/business', b);
  updateBusiness = (b: Record<string, unknown>) => this.req<Business>('PUT', '/api/business', b);
  me = () => this.req<Me>('GET', '/api/me');
  subscription = () => this.req<Subscription>('GET', '/api/subscription');
  requestSubscription = (b: { paymentRef: string; amount?: number; method?: string; evidence?: string }) => this.req<{ subscriptionId: string; status: string }>('POST', '/api/subscription/request', b);
  registerDevice = (appInstanceId: string, label: string) => this.req<{ deviceId: string; slot: number; invoicePrefix: string; token: string; entitlement: { token: string; validUntil: string } }>('POST', '/api/devices/register', { appInstanceId, label });
  refresh = () => this.req<{ token: string; entitlement: { token: string; validUntil: string }; subscription: Subscription }>('POST', '/api/session/refresh', {});
  devices = () => this.req<{ max: number; used: number; devices: DeviceInfo[] }>('GET', '/api/devices');
  removeDevice = (id: string) => this.req('DELETE', '/api/devices/' + encodeURIComponent(id));
  products = (includeArchived=false) => this.req<any[]>('GET', '/api/products' + (includeArchived?'?includeArchived=1':''));
  addProduct = (p: Record<string, unknown>) => this.req<any>('POST', '/api/products', p);
  updateProduct = (id: string, p: Record<string, unknown>) => this.req<any>('PUT', '/api/products/' + encodeURIComponent(id), p);
  deleteProduct = (id: string) => this.req<{ ok: boolean }>('DELETE', '/api/products/' + encodeURIComponent(id));
  archiveProduct = (id: string) => this.req<any>('POST', '/api/products/' + encodeURIComponent(id) + '/archive', {});
  restoreProduct = (id: string) => this.req<any>('POST', '/api/products/' + encodeURIComponent(id) + '/restore', {});
  inventoryItems = (includeArchived = false, outlet?: string) => this.req<{ items: InventoryItem[] }>('GET', '/api/inventory/items?' + new URLSearchParams({ ...(includeArchived ? { includeArchived: '1' } : {}), ...(outlet ? { outlet } : {}) }).toString());
  createInventoryItem = (item: InventoryItemInput & { openingQty?: number; clientMoveId?: string }, outlet?: string) => this.req<InventoryItem>('POST', '/api/inventory/items' + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), item);
  updateInventoryItem = (id: string, item: Partial<InventoryItemInput>, outlet?: string) => this.req<InventoryItem>('PUT', '/api/inventory/items/' + encodeURIComponent(id) + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), item);
  archiveInventoryItem = (id: string, outlet?: string) => this.req<InventoryItem>('POST', `/api/inventory/items/${encodeURIComponent(id)}/archive` + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), {});
  restoreInventoryItem = (id: string, outlet?: string) => this.req<InventoryItem>('POST', `/api/inventory/items/${encodeURIComponent(id)}/restore` + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), {});
  inventoryMovements = (query: Record<string, string>) => this.req<{ movements: InventoryMovement[] }>('GET', '/api/inventory/movements?' + new URLSearchParams(query).toString());
  createInventoryMovement = (movement: InventoryMovementInput, outlet?: string) => this.req<InventoryMovement>('POST', '/api/inventory/movements' + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), movement);
  inventoryRecipes = () => this.req<{ recipes: Record<string, RecipeLine[]> }>('GET', '/api/inventory/recipes');
  saveInventoryRecipe = (productId: string, lines: RecipeLine[]) => this.req<{ lines: RecipeLine[] }>('PUT', `/api/inventory/recipes/${encodeURIComponent(productId)}`, { lines });
  inventoryUsage = (from: string, to: string, outlet?: string) => this.req<InventoryUsage>('GET', '/api/inventory/usage?' + new URLSearchParams({ from, to, ...(outlet ? { outlet } : {}) }).toString());
  inventorySettings = () => this.req<InventorySettings>('GET', '/api/inventory/settings');
  saveInventorySettings = (settings: InventorySettings) => this.req<InventorySettings>('PUT', '/api/inventory/settings', settings);
  inventoryOrders = (status: 'open' | 'received' | 'all' = 'open', outlet?: string) => this.req<{ orders: InventoryOrder[] }>('GET', '/api/inventory/orders?' + new URLSearchParams({ status, ...(outlet ? { outlet } : {}) }).toString());
  createInventoryOrder = (order: { supplier?: string; note?: string; lines: { inventoryItemId: string; qty: number }[]; clientMoveId: string }, outlet?: string) => this.req<InventoryOrder>('POST', '/api/inventory/orders' + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), order);
  receiveInventoryOrder = (id: string, lines: { inventoryItemId: string; qty: number; unitCost?: number }[], clientMoveId: string, outlet?: string) => this.req<InventoryOrder>('POST', `/api/inventory/orders/${encodeURIComponent(id)}/receive` + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), { lines, clientMoveId });
  cancelInventoryOrder = (id: string, outlet?: string) => this.req<InventoryOrder>('POST', `/api/inventory/orders/${encodeURIComponent(id)}/cancel` + (outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''), {});
  syncBills = (bills: unknown[]) => this.req<{ results: { clientTxnId?: string; result: string; reason?: string }[] }>('POST', '/api/bills/sync', { bills });
  bills = (qs: string) => this.req<any[]>('GET', '/api/bills' + qs);
  summary = (from: string, to: string) => this.req<any>('GET', `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  notifications = () => this.req<{ id: number; title: string; body: string; read: number; created_at: string }[]>('GET', '/api/notifications');
  readAll = () => this.req('POST', '/api/notifications/read-all', {});
  support = (subject: string, message: string) => this.req<{ id: string }>('POST', '/api/support', { subject, message });
  appVersion = () => this.req<{ version?: string; min_supported?: number; notes?: string; apk_url?: string }>('GET', '/api/app/version', undefined, null);
}

export interface AuthSession { token: string; userId: string; businessId: string | null; isNew: boolean }

export function mapProduct(p: any): Product {
  return { id: p.id, category: p.category ?? null, name: p.name, sku: p.sku ?? null, description: p.description ?? null, price: Number(p.price), taxRate: Number(p.tax_rate ?? p.taxRate ?? 0),
    available: !!p.available, active: !!p.active, favourite: !!p.favourite, variants: Array.isArray(p.variants) ? p.variants : [] };
}
