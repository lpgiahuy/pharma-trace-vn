export type Granularity = 'day' | 'month';

export interface ReportRange {
  from: string;
  to: string;
  facilityId?: number;
}

export interface SalesPeriod {
  from: string;
  to: string;
  revenue: number;
  collectedCash: number;
  orders: number;
  cancelledOrders: number;
  newCustomers: number;
  firstTimeBuyers: number;
  avgOrderValue: number;
}

export interface SalesOverview {
  current: SalesPeriod;
  previous: SalesPeriod;
}

export interface RevenueBucket {
  bucket: string;
  revenue: number;
  refunds: number;
  orders: number;
  newCustomers: number;
}

export interface RevenueSeries {
  from: string;
  to: string;
  granularity: Granularity;
  buckets: RevenueBucket[];
}

export interface OrderStatusRow {
  status: string;
  count: number;
  amount: number;
}

export interface OrderStatusReport {
  from: string;
  to: string;
  statuses: OrderStatusRow[];
}

export type StockLevel = 'OUT_OF_STOCK' | 'LOW_STOCK';
export type ExpiryLevel = 'EXPIRED' | 'LE_30' | 'D31_90' | 'D91_180';

export interface StockAlert {
  inventoryId: number;
  facilityId: number;
  facilityName: string;
  medicineId: number;
  medicineName: string;
  variantId: number;
  unitName: string;
  stockQuantity: number;
  reservedQuantity: number;
  available: number;
  minStockQuantity: number | null;
  threshold: number;
  level: StockLevel;
}

export interface StockAlertReport {
  defaultThreshold: number;
  items: StockAlert[];
}

export interface ExpiryAlert {
  batchId: number;
  batchNumber: string;
  medicineId: number;
  medicineName: string;
  facilityId: number;
  facilityName: string;
  boxes: number;
  expiryDate: string;
  daysLeft: number;
  level: ExpiryLevel;
  belowMinShelfLife: boolean;
}

export interface ExpiryAlertReport {
  items: ExpiryAlert[];
}

export type ReceivableBucket = '0_7' | '8_15' | '16_30' | 'GT_30';
export type PayableBucket = 'NOT_DUE' | '1_30' | '31_60' | 'GT_60' | 'NO_DUE_DATE';

export interface ReceivableSummaryRow {
  party: string;
  bucket: ReceivableBucket;
  count: number;
  amount: number;
}

export interface ReceivableDetail {
  party: string;
  bucket: ReceivableBucket;
  amount: number;
  shipmentId: number | null;
  orderId: number | null;
  orderCode: string | null;
  documentDate: string | null;
  ageDays: number | null;
}

export interface ReceivablesReport {
  asOf: string;
  summary: ReceivableSummaryRow[];
  details: ReceivableDetail[];
}

export interface PayableSummaryRow {
  supplierId: number | null;
  supplierName: string;
  bucket: PayableBucket;
  count: number;
  amount: number;
}

export interface PayableDetail {
  supplierId: number | null;
  supplierName: string;
  bucket: PayableBucket;
  amount: number;
  payableId: number | null;
  poId: number | null;
  poCode: string | null;
  dueDate: string | null;
  daysOverdue: number | null;
}

export interface PayablesReport {
  asOf: string;
  summary: PayableSummaryRow[];
  details: PayableDetail[];
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'DEBIT_CARD' | 'E_WALLET';
export type CashbookType = 'INCOME' | 'EXPENSE';

export interface CashbookFilters {
  from: string;
  to: string;
  paymentMethod?: PaymentMethod;
  type?: CashbookType;
  category?: string;
}

export interface CashbookDay {
  day: string;
  income: number;
  expense: number;
  balance: number;
}

export interface CashbookEntry {
  id: number;
  code: string;
  date: string;
  type: CashbookType;
  category: string;
  amount: number;
  paymentMethod: string;
  partyName: string | null;
  note: string | null;
  orderId: number | null;
  orderCode: string | null;
  poId: number | null;
  poCode: string | null;
}

export interface CashbookReport {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  opening: number;
  totalIncome: number;
  totalExpense: number;
  closing: number;
  total: number;
  categories: string[];
  days: CashbookDay[];
  entries: CashbookEntry[];
}
