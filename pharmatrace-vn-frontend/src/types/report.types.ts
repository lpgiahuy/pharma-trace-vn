export type Granularity = 'day' | 'month';

/** Days are YYYY-MM-DD in Vietnam time; `to` is inclusive. */
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

/** `previous` is the period of the same length right before `current`. */
export interface SalesOverview {
  current: SalesPeriod;
  previous: SalesPeriod;
}

export interface RevenueBucket {
  /** First day of the bucket (YYYY-MM-DD). */
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
