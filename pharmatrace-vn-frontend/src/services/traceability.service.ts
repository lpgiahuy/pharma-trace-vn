import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }
interface Page<T> {
  success: boolean;
  items: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export type ScanReason = 'UNKNOWN_UID' | 'SIGNATURE_MISMATCH' | 'NOT_AT_WAREHOUSE' | 'BOX_STATUS_UNEXPECTED';

export interface ScanResult {
  uid: string;
  verdict: 'NO_ANOMALY_FOUND' | 'NEEDS_INVESTIGATION';
  reasons: ScanReason[];
  box: {
    uid: string;
    batchNumber: string | null;
    status: string;
    facilityId: number | null;
    batchStatus: string | null;
    expiryDate: string | null;
    medicineName: string | null;
    ssccCode: string | null;
  } | null;
  message: string;
}

export interface BoxTimelineEvent {
  occurredAt: string | null;
  eventType: string;
  facilityId: number | null;
  actorId: number | null;
  reference: string | null;
  detail: string | null;
}

export interface CartonDetail {
  id: number;
  sscc: string;
  status: string;
  facilityId: number | null;
  batchNumber: string | null;
  medicineName: string | null;
  boxes: { uid: string; status: string; facilityId: number | null }[];
}

export type FraudAlertStatus = 'UNRESOLVED' | 'RESOLVED';

export interface FraudAlert {
  id: number;
  uid: string | null;
  scannedCode: string | null;
  fraudType: string;
  facilityId: number | null;
  resolutionStatus: FraudAlertStatus | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export const traceabilityService = {
  scan: (uid: string) => apiClient.post<unknown, Envelope<ScanResult>>('/warehouse/scan', { uid }),
  history: (uid: string) => apiClient.get<unknown, Envelope<BoxTimelineEvent[]>>(`/warehouse/boxes/${uid}/history`),
  carton: (sscc: string) => apiClient.get<unknown, Envelope<CartonDetail>>(`/warehouse/cartons/${encodeURIComponent(sscc)}`),
  unpack: (sscc: string) => apiClient.post<unknown, Envelope<CartonDetail>>(`/warehouse/cartons/${encodeURIComponent(sscc)}/unpack`),
  alerts: (params: { page: number; limit: number; status?: FraudAlertStatus }) =>
    apiClient.get<unknown, Page<FraudAlert>>('/warehouse/fraud-alerts', { params }),
  resolve: (id: number, note: string) => apiClient.patch<unknown, Envelope<FraudAlert>>(`/warehouse/fraud-alerts/${id}/resolve`, { note }),
};
