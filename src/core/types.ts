export type PayMethod = 'cash' | 'upi' | 'card';
export interface Variant { name: string; priceDelta: number; kind: 'variant' | 'addon' }
export interface Product {
  id: string; category: string | null; name: string; sku: string | null; description: string | null;
  price: number; taxRate: number; available: boolean; active: boolean; favourite: boolean; variants: Variant[];
}
export interface CartLine { key: string; itemId: string; name: string; price: number; qty: number; taxRate: number; productId?: string; variantName?: string; addons?: string[]; custom?: boolean }
export interface BillItem { name: string; qty: number; price: number; taxRate: number; productId?: string; variantName?: string; addons?: string[]; custom?: boolean }
export interface Payment { method: PayMethod; amount: number }
export type BillStatus = 'draft' | 'completed' | 'void' | 'refunded';
export interface Bill {
  clientTxnId: string; invoiceNo: string | null; status: BillStatus; createdAt: string; cashier: string | null;
  customerName: string | null; customerMobile: string | null; tableNo: string | null; notes: string | null;
  items: BillItem[]; payments: Payment[]; subtotal: number; discount: number; tax: number; serviceCharge: number; total: number;
  synced: boolean; syncError: string | null; printCount: number; statusReason: string | null; remote?: boolean;
}
export interface Totals { subtotal: number; discount: number; tax: number; serviceCharge: number; total: number; taxBreakup: { rate: number; tax: number }[] }
export interface Subscription {
  status: 'none' | 'pending' | 'active' | 'expiring_soon' | 'expired' | 'suspended' | 'rejected' | 'grace';
  paid: boolean; daysLeft: number | null; message: string | null; subscriptionId: string | null; startDate: string | null; endDate: string | null; reminder: boolean;
  planMonths?: number; planPrice?: number; paymentInstructions?: string; supportContact?: string;
  currentPlanMonths?: number;
  history?: { id: string; plan: string; status: string; start_date: string | null; end_date: string | null; created_at: string; admin_message: string | null }[];
}
export interface Business { id: string; name: string; type: string | null; address: string | null; contact: string | null; gstin: string | null; tax_profile: string | null; receipt_footer: string | null }
export interface Me { user: { id: string; phone: string | null; email: string | null; ownerName: string | null }; business: Business | null; subscription: Subscription; deviceSlots: { used: number; max: number }; defaults?: { receiptFooter: string }; features?: { inventory: boolean }; inventoryVersion?: number }
export interface DeviceInfo { id: string; slot: number; label: string | null; registered_at: string; last_seen_at: string | null; current: boolean }
export interface TaxProfile { serviceChargePercent: number; defaultTaxRate: number }
export interface PrinterConfig { kind: 'bluetooth' | 'network'; address: string; name: string; paperWidthMm: 58 | 80 }
export interface ReportData {
  source: 'server' | 'device'; billCount: number; total: number; averageBill: number; discounts: number; tax: number;
  byMethod: Record<string, number>; itemWise: { name: string; qty: number; revenue: number }[];
}
export type InventoryUnit = 'g' | 'ml' | 'pc';
export type InventoryStatus = 'ok' | 'low' | 'out';
export interface InventoryItem {
  id: string; name: string; category: string | null; unit: InventoryUnit; packSize: number; packLabel: string | null;
  reorderLevel: number; parLevel: number; unitCost: number | null; supplier: string | null; notes: string | null;
  active: boolean; onHand: number; status: InventoryStatus; updatedAt: string;
}
export interface InventoryItemInput {
  name: string; category?: string | null; unit: InventoryUnit; packSize?: number; packLabel?: string | null;
  reorderLevel?: number; parLevel?: number; unitCost?: number | null; supplier?: string | null; notes?: string | null;
}
export type InventoryMovementType = 'opening' | 'purchase' | 'sale_usage' | 'wastage' | 'adjustment' | 'return';
export interface InventoryMovement {
  id: string; inventoryItemId: string; outletId: string; type: InventoryMovementType; qtyDelta: number; balanceAfter: number;
  productId: string | null; billId: string | null; unitCost: number | null; reason: string | null; note: string | null;
  actor: string; deviceLabel: string | null; createdAt: string;
}
export interface InventoryMovementInput {
  inventoryItemId: string; type: 'purchase' | 'wastage' | 'adjustment' | 'opening'; qty: number;
  reason?: string; note?: string; unitCost?: number; clientMoveId: string;
}
export interface RecipeLine { inventoryItemId: string; qty: number; variantName: string | null }
export interface InventoryUsage {
  from: string; to: string;
  byItem: { inventoryItemId: string; name: string; unit: InventoryUnit; opening: number; purchased: number; used: number; wasted: number; adjusted: number; closing: number; firstMovementAt?: string | null }[];
  byProduct: { productId: string; name: string; sold: number; ingredients: { inventoryItemId: string; name: string; qty: number }[] }[];
}
export interface InventoryOrder {
  id: string; outletId: string; supplier: string | null; note: string | null; status: 'open' | 'received' | 'cancelled';
  createdAt: string; receivedAt: string | null;
  lines: { inventoryItemId: string; name: string; qtyOrdered: number; qtyReceived: number }[];
}
export interface InventorySettings { windowDays: number; leadDays: number; coverDays: number }
export type Route = 'loading' | 'login' | 'business' | 'locked' | 'subscription' | 'device' | 'home' | 'update' | 'offline';
