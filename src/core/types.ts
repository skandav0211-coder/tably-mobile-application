export type PayMethod = 'cash' | 'upi' | 'card';
export interface Variant { name: string; priceDelta: number; kind: 'variant' | 'addon' }
export interface Product {
  id: string; category: string | null; name: string; sku: string | null; description: string | null;
  price: number; taxRate: number; available: boolean; active: boolean; favourite: boolean; variants: Variant[];
}
export interface CartLine { key: string; itemId: string; name: string; price: number; qty: number; taxRate: number }
export interface BillItem { name: string; qty: number; price: number; taxRate: number }
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
  history?: { id: string; status: string; start_date: string | null; end_date: string | null; created_at: string; admin_message: string | null }[];
}
export interface Business { id: string; name: string; type: string | null; address: string | null; contact: string | null; gstin: string | null; tax_profile: string | null; receipt_footer: string | null }
export interface Me { user: { id: string; phone: string | null; email: string | null; ownerName: string | null }; business: Business | null; subscription: Subscription; deviceSlots: { used: number; max: number }; defaults?: { receiptFooter: string } }
export interface DeviceInfo { id: string; slot: number; label: string | null; registered_at: string; last_seen_at: string | null; current: boolean }
export interface TaxProfile { serviceChargePercent: number; defaultTaxRate: number }
export interface PrinterConfig { kind: 'bluetooth' | 'network'; address: string; name: string; paperWidthMm: 58 | 80 }
export interface ReportData {
  source: 'server' | 'device'; billCount: number; total: number; averageBill: number; discounts: number; tax: number;
  byMethod: Record<string, number>; itemWise: { name: string; qty: number; revenue: number }[];
}
export type Route = 'loading' | 'login' | 'business' | 'locked' | 'subscription' | 'device' | 'home' | 'update';
