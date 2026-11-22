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
}

export interface TraceEvent {
  occurredAt: string;
  eventType: 'MANUFACTURED' | 'RECEIVED' | 'TRANSFER_RECEIVED';
  facilityName: string | null;
}

export interface TraceHistory {
  box: TraceBox;
  timeline: TraceEvent[];
}

export interface ScanOutcome {
  scanResult: 'VALID' | 'SUSPICIOUS';
  riskScore: number;
  reasons: ('IMPOSSIBLE_TRAVEL' | 'EXCESSIVE_SCANS')[];
}

export interface ScanLocation { latitude: number; longitude: number }

export const traceService = {
  history: (uid: string) => apiClient.get<unknown, Envelope<TraceHistory>>(`/trace/${uid}`),
  verify: (uid: string, code: string) => apiClient.post<unknown, Envelope<{ uid: string; valid: boolean }>>('/trace/verify', { uid, code }),
  scan: (uid: string, location?: ScanLocation) => apiClient.post<unknown, Envelope<ScanOutcome>>('/trace/scan', { uid, ...location }),
};
