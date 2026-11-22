import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }

export interface FraudRadarAlert {
  id: number;
  uid: string | null;
  fraudType: string;
  severity: string | null;
  description: string | null;
  distanceKm: number | null;
  minutes: number | null;
  speedKmh: number | null;
  resolutionStatus: 'UNRESOLVED' | 'RESOLVED' | null;
  createdAt: string | null;
}

export interface FraudReport {
  scans24h: number;
  suspicious24h: number;
  openAlerts: number;
  criticalAlerts: number;
  alerts: FraudRadarAlert[];
}

export const fraudService = {
  report: () => apiClient.get<unknown, Envelope<FraudReport>>('/admin/security/fraud'),
};
