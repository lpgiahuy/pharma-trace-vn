import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }

export interface TraceBox {
  uid: string;
  medicineName: string;
  manufacturer: string | null;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  batchStatus: string;
  boxStatus: string;
  activatedAt: string | null;
  verifyCount: number;
  flagged: boolean;
}

export interface TraceEvent {
  occurredAt: string;
  eventType: 'MANUFACTURED' | 'RECEIVED' | 'TRANSFER_DISPATCHED' | 'TRANSFER_RECEIVED' | 'PACKED' | 'HANDED_OVER' | 'DELIVERED' | 'CODE_ACTIVATED';
  facilityName: string | null;
}

export interface TraceHistory {
  box: TraceBox;
  timeline: TraceEvent[];
}

export interface VerifyResult {
  uid: string;
  status: 'FIRST_ACTIVATION' | 'ALREADY_ACTIVATED' | 'INVALID_CODE';
  activatedAt: string | null;
  verifyCount: number;
  flagged: boolean;
}

export interface ScanOutcome {
  scanResult: 'VALID' | 'FLAGGED';
  reasons: ('IMPOSSIBLE_TRAVEL' | 'EXCESSIVE_SCANS')[];
}

export interface ScanLocation { latitude: number; longitude: number }

export const traceService = {
  history: (uid: string) => apiClient.get<unknown, Envelope<TraceHistory>>(`/trace/${uid}`),
  verify: (uid: string, code: string, deviceId?: string) => apiClient.post<unknown, Envelope<VerifyResult>>('/trace/verify', { uid, code, deviceId }),
  scan: (uid: string, location?: ScanLocation) => apiClient.post<unknown, Envelope<ScanOutcome>>('/trace/scan', { uid, ...location }),
};
