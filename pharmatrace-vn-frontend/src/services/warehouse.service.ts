import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }
interface Page<T> {
  success: boolean;
  items: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface WarehouseDashboard {
  stockUnits: number;
  availableUnits: number;
  quarantineUnits: number;
  expiringBatches: number;
  pendingTransfers: number | null;
  ordersToPack: number | null;
}

export interface InventoryItem {
  facilityId: number | null;
  variantId: number | null;
  medicineId: number | null;
  medicineName: string;
  unitName: string;
  stock: number;
  reserved: number;
  available: number;
  quarantine: number;
  updatedAt: string | null;
}

export interface BatchItem {
  id: number;
  batchNumber: string;
  medicineId: number | null;
  medicineName: string;
  productionDate: string;
  expiryDate: string;
  status: string | null;
  boxesInStock: number;
}

export interface BatchDetail extends BatchItem {
  initialQuantity: number;
  remainingQuantity: number;
  certificate: string | null;
  holdReason: string | null;
  heldAt: string | null;
  boxes: { status: string | null; count: number }[];
}

export interface InventoryLog {
  id: number;
  type: string;
  stockBucket: string | null;
  quantityChanged: number;
  previousQuantity: number;
  newQuantity: number;
  referenceCode: string | null;
  note: string | null;
  createdAt: string | null;
}

interface PageQuery { page?: number; limit?: number }

export const warehouseService = {
  dashboard: () => apiClient.get<unknown, Envelope<WarehouseDashboard>>('/warehouse/dashboard'),
  inventory: (params: PageQuery & { search?: string }) =>
    apiClient.get<unknown, Page<InventoryItem>>('/warehouse/inventory', { params }),
  inventoryDetail: (variantId: number) =>
    apiClient.get<unknown, Envelope<{ stock: InventoryItem[]; batches: BatchItem[] }>>(`/warehouse/inventory/${variantId}`),
  logs: (params: PageQuery & { variantId?: number }) =>
    apiClient.get<unknown, Page<InventoryLog>>('/warehouse/inventory/logs', { params }),
  batches: (params: PageQuery & { search?: string; expiring?: boolean }) => {
    const { expiring, ...query } = params;
    return apiClient.get<unknown, Page<BatchItem>>(expiring ? '/warehouse/batches/expiring' : '/warehouse/batches', { params: query });
  },
  batch: (id: number) => apiClient.get<unknown, Envelope<BatchDetail>>(`/warehouse/batches/${id}`),
  holdBatch: (id: number, reason: string) =>
    apiClient.patch<unknown, Envelope<{ id: number; status: string }>>(`/warehouse/batches/${id}/hold`, { reason }),
  releaseBatch: (id: number, reason: string) =>
    apiClient.patch<unknown, Envelope<{ id: number; status: string }>>(`/warehouse/batches/${id}/release`, { reason }),
};
