import { apiClient } from './api.client';
import type {
  Granularity,
  OrderStatusReport,
  ReportRange,
  RevenueSeries,
  SalesOverview,
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
};
