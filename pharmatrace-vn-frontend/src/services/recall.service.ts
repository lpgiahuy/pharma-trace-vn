import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }

export const RECALL_SEVERITIES = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;
export type RecallSeverity = (typeof RECALL_SEVERITIES)[number];

export interface RecallSummary {
  id: number;
  recallCode: string;
  reason: string;
  severity: RecallSeverity;
  documentUrl: string | null;
  status: 'ACTIVE' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  batchCount: number;
}

export interface RecallDetail extends RecallSummary {
  batches: { batchId: number; batchNumber: string; medicineName: string; expiryDate: string; boxCount: number }[];
  transfers: { id: number; transferCode: string; fromFacilityId: number; toFacilityId: number; status: string }[];
  events: { action: string; facilityId: number | null; boxCount: number; note: string | null; createdAt: string }[];
}

export type RecallLocation = 'FACILITY' | 'IN_TRANSIT' | 'DELIVERED' | 'OTHER';

export interface RecallImpact {
  totalBoxes: number;
  byLocation: Record<RecallLocation, number>;
  boxes: {
    uid: string;
    batchNumber: string;
    boxStatus: string;
    location: RecallLocation;
    facilityName: string | null;
    orderId: number | null;
    orderCode: string | null;
    orderStatus: string | null;
    customerName: string | null;
  }[];
}

export interface RecallTask {
  recallId: number;
  recallCode: string;
  severity: RecallSeverity;
  kind: 'QUARANTINED_STOCK' | 'COLLECTION_TRANSFER' | 'ORDER_TO_RESOLVE';
  facilityId: number;
  batchNumber: string | null;
  quantity: number | null;
  transferId: number | null;
  transferCode: string | null;
  transferStatus: string | null;
  orderId: number | null;
  orderCode: string | null;
}

export interface CollectionDestination {
  facilityId: number;
  facilityName: string;
}

export interface CollectionTransfer {
  transferId: number;
  transferCode: string;
  toFacilityId: number;
  /** False when an open collection transfer from this warehouse already existed. */
  created: boolean;
}

/** Facility types that may receive recalled stock: the factory it came from or a warehouse. */
export const RECALL_DESTINATION_TYPES = ['FACTORY', 'CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'];

export interface CreateRecallInput {
  recallCode: string;
  reason: string;
  severity: RecallSeverity;
  documentUrl?: string;
  batchIds: number[];
}

const BASE = '/admin/recalls';

export const recallService = {
  list: () => apiClient.get<unknown, Envelope<RecallSummary[]>>(BASE),
  detail: (id: number) => apiClient.get<unknown, Envelope<RecallDetail>>(`${BASE}/${id}`),
  impact: (id: number) => apiClient.get<unknown, Envelope<RecallImpact>>(`${BASE}/${id}/impact`),
  create: (input: CreateRecallInput) => apiClient.post<unknown, Envelope<RecallDetail>>(BASE, input),
  collect: (id: number, destinationFacilityId: number) =>
    apiClient.post<unknown, Envelope<RecallDetail>>(`${BASE}/${id}/collect`, { destinationFacilityId }),
  close: (id: number, note: string) => apiClient.post<unknown, Envelope<RecallDetail>>(`${BASE}/${id}/close`, { note }),
  tasks: () => apiClient.get<unknown, Envelope<RecallTask[]>>('/warehouse/recalls'),
  collectionDestination: (id: number) => apiClient.get<unknown, Envelope<CollectionDestination>>(`/warehouse/recalls/${id}/collection-destination`),
  collectFromFacility: (id: number, toFacilityId: number, note?: string) =>
    apiClient.post<unknown, Envelope<CollectionTransfer>>(`/warehouse/recalls/${id}/collect`, { toFacilityId, note }),
};
