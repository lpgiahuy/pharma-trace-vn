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
