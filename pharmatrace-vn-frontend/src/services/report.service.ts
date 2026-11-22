import { apiClient } from './api.client';
import type {
  CashbookFilters,
  CashbookReport,
  ExpiryAlertReport,
  Granularity,
  OrderStatusReport,
  PayablesReport,
  ReceivablesReport,
  ReportRange,
  RevenueSeries,
  SalesOverview,
  StockAlertReport,
} from '../types/report.types';

interface Envelope<T> { success: boolean; data: T }

const BASE = '/admin/reports';

/** Error bodies of a blob request arrive as a Blob; read the API message out of it. */
async function blobError(error: unknown): Promise<unknown> {
  if (!(error instanceof Blob)) return error;
  try {
    const body: unknown = JSON.parse(await error.text());
    return body;
  } catch {
    return error;
  }
}

export const reportService = {
  overview: (range: ReportRange) =>
    apiClient.get<unknown, Envelope<SalesOverview>>(`${BASE}/overview`, { params: range }),
  revenue: (range: ReportRange, granularity: Granularity) =>
    apiClient.get<unknown, Envelope<RevenueSeries>>(`${BASE}/revenue`, { params: { ...range, granularity } }),
  orderStatus: (range: ReportRange) =>
    apiClient.get<unknown, Envelope<OrderStatusReport>>(`${BASE}/order-status`, { params: range }),
  stockAlerts: (facilityId?: number) =>
    apiClient.get<unknown, Envelope<StockAlertReport>>(`${BASE}/stock-alerts`, { params: { facilityId } }),
  expiryAlerts: (facilityId?: number) =>
    apiClient.get<unknown, Envelope<ExpiryAlertReport>>(`${BASE}/expiry-alerts`, { params: { facilityId } }),
  receivables: (asOf?: string) =>
    apiClient.get<unknown, Envelope<ReceivablesReport>>(`${BASE}/receivables`, { params: { asOf } }),
  payables: (asOf?: string) =>
    apiClient.get<unknown, Envelope<PayablesReport>>(`${BASE}/payables`, { params: { asOf } }),
  cashbook: (filters: CashbookFilters, page: number, pageSize: number) =>
    apiClient.get<unknown, Envelope<CashbookReport>>(`${BASE}/cashbook`, { params: { ...filters, page, pageSize } }),
  cashbookCsv: (filters: CashbookFilters) =>
    apiClient
      .get<unknown, Blob>(`${BASE}/cashbook/export`, { params: filters, responseType: 'blob' })
      .catch(async (error: unknown) => { throw await blobError(error); }),
  setDefaultThreshold: (quantity: number) =>
    apiClient.patch(`${BASE}/stock-thresholds/default`, { quantity }),
  setInventoryThreshold: (inventoryId: number, quantity: number | null) =>
    apiClient.patch(`${BASE}/stock-thresholds/${inventoryId}`, { quantity }),
};
