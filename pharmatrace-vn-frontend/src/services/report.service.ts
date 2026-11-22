import { apiClient } from './api.client';
import type {
  ExpiryAlertReport,
  Granularity,
  OrderStatusReport,
  ReportRange,
  RevenueSeries,
  SalesOverview,
  StockAlertReport,
} from '../types/report.types';

interface Envelope<T> { success: boolean; data: T }

const BASE = '/admin/reports';

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
  setDefaultThreshold: (quantity: number) =>
    apiClient.patch(`${BASE}/stock-thresholds/default`, { quantity }),
  setInventoryThreshold: (inventoryId: number, quantity: number | null) =>
    apiClient.patch(`${BASE}/stock-thresholds/${inventoryId}`, { quantity }),
};
