import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }
interface Page<T> {
  success: boolean;
  items: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export type DisposalStatus = 'DRAFT' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
export type DisposalSource = 'EXPIRED' | 'QUARANTINE' | 'RECALL';

export interface DisposalSummary {
  id: number;
  disposalCode: string;
  status: DisposalStatus;
  reason: string;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  itemCount: number;
}

export interface DisposalCandidate {
  boxUid: string;
  batchNumber: string;
  medicineName: string | null;
  expiryDate: string;
  source: DisposalSource;
}

export interface DisposalDetail extends Omit<DisposalSummary, 'itemCount'> {
  items: { boxUid: string; batchNumber: string; medicineName: string | null; source: DisposalSource }[];
  attachments: { id: number; createdAt: string }[];
  events: { action: string; toStatus: DisposalStatus; actorId: number; note: string | null; createdAt: string }[];
}

export interface CreateDisposalInput {
  disposalCode: string;
  reason: string;
  boxUids: string[];
}

const BASE = '/warehouse/disposals';

export const disposalService = {
  candidates: (params: { page: number; limit: number; source?: DisposalSource }) =>
    apiClient.get<unknown, Page<DisposalCandidate>>(`${BASE}/candidates`, { params }),
  list: (params: { page: number; limit: number }) => apiClient.get<unknown, Page<DisposalSummary>>(BASE, { params }),
  detail: (id: number) => apiClient.get<unknown, Envelope<DisposalDetail>>(`${BASE}/${id}`),
  create: (input: CreateDisposalInput) => apiClient.post<unknown, Envelope<DisposalDetail>>(BASE, input),
  approve: (id: number) => apiClient.post<unknown, Envelope<DisposalDetail>>(`${BASE}/${id}/approve`),
  complete: (id: number) => apiClient.post<unknown, Envelope<DisposalDetail>>(`${BASE}/${id}/complete`),
  cancel: (id: number, reason: string) => apiClient.post<unknown, Envelope<DisposalDetail>>(`${BASE}/${id}/cancel`, { reason }),
  upload: (id: number, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return apiClient.post<unknown, Envelope<DisposalDetail>>(`${BASE}/${id}/attachments`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  attachment: (id: number, attachmentId: number) =>
    apiClient.get<unknown, Blob>(`${BASE}/${id}/attachments/${attachmentId}`, { responseType: 'blob' }),
};
