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

export interface QueueOrder {
  id: number;
  orderCode: string;
  orderStatus: string | null;
  recipientName: string | null;
  createdAt: string | null;
  requiredBoxes: number;
  packedBoxes: number;
  packageCount: number;
}

export interface PickLine {
  orderItemId: number;
  medicineName: string | null;
  quantity: number;
  packedQuantity: number;
  suggestions: { uid: string; batchNumber: string; expiryDate: string }[];
}

export interface PackageSummary {
  id: number;
  packageCode: string;
  orderId: number;
  status: string;
  boxUids: string[];
}

export interface PackageLabel {
  packageCode: string;
  orderCode: string;
  facilityName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  shippingAddress: string | null;
  boxCount: number;
  packedAt: string;
  trackingNumber: string | null;
  courierName: string | null;
  codAmount: number | null;
}

export interface PendingPackage {
  packageCode: string;
  orderCode: string;
  recipientName: string | null;
  boxCount: number;
  carrierConfirmed: boolean;
}

export interface PendingCarrier {
  courierName: string;
  packages: PendingPackage[];
}

export interface Handover {
  id: number;
  handoverCode: string;
  courierName: string;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  note: string | null;
  handedOverAt: string;
  handedOverBy: string | null;
  facilityName: string | null;
  packages: { packageCode: string; orderCode: string; recipientName: string | null; boxCount: number }[];
}

export interface HandoverInput {
  handoverCode: string;
  courierName: string;
  packageCodes: string[];
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  note?: string;
}

export interface FactoryBatchInput {
  facilityId?: number;
  variantId: number;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  boxCount: number;
  boxesPerCarton: number;
  certificateCoCq?: string;
}

export interface FactoryBatchSummary { id: number; batchNumber: string; boxCount: number; cartonCount: number }

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
  createFactoryBatch: (input: FactoryBatchInput) => apiClient.post<unknown, Envelope<FactoryBatchSummary>>('/warehouse/batches', input),
  batchLabels: (id: number, facilityId?: number) =>
    apiClient.get<unknown, Blob>(`/warehouse/batches/${id}/labels`, { params: facilityId ? { facilityId } : undefined, responseType: 'blob' }),
  holdBatch: (id: number, reason: string) =>
    apiClient.patch<unknown, Envelope<{ id: number; status: string }>>(`/warehouse/batches/${id}/hold`, { reason }),
  releaseBatch: (id: number, reason: string) =>
    apiClient.patch<unknown, Envelope<{ id: number; status: string }>>(`/warehouse/batches/${id}/release`, { reason }),
  packingQueue: () => apiClient.get<unknown, Envelope<QueueOrder[]>>('/warehouse/fulfillment/queue'),
  pickList: (orderId: number) => apiClient.get<unknown, Envelope<PickLine[]>>(`/warehouse/orders/${orderId}/pick-list`),
  packages: (orderId: number) => apiClient.get<unknown, Envelope<PackageSummary[]>>(`/warehouse/orders/${orderId}/packages`),
  addPackage: (orderId: number, packageCode: string, boxUids: string[]) =>
    apiClient.post<unknown, Envelope<PackageSummary>>(`/warehouse/orders/${orderId}/packages`, { packageCode, boxUids }),
  completePacking: (orderId: number) =>
    apiClient.post<unknown, Envelope<{ orderId: number; trackingNumber: string }>>(`/warehouse/orders/${orderId}/packing/complete`, {}),
  voidPackage: (id: number, reason: string) =>
    apiClient.post<unknown, Envelope<PackageSummary>>(`/warehouse/packages/${id}/void`, { reason }),
  pendingHandovers: () => apiClient.get<unknown, Envelope<PendingCarrier[]>>('/warehouse/handover/pending'),
  handovers: () => apiClient.get<unknown, Envelope<Handover[]>>('/warehouse/handovers'),
  createHandover: (input: HandoverInput) => apiClient.post<unknown, Envelope<Handover>>('/warehouse/handovers', input),
  packageLabel: (id: number) => apiClient.get<unknown, Envelope<PackageLabel>>(`/warehouse/packages/${id}/label`),
};
