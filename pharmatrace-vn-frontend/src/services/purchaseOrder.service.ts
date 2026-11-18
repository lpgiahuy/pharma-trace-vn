import { apiClient } from './api.client';

interface Envelope<T> { success: boolean; data: T }

export interface PurchaseOrderListItem {
  id: number;
  po_code: string;
  status: string | null;
  total_amount: string | null;
  expected_at: string | null;
  created_at: string | null;
  facility: { id: number; facility_name: string } | null;
  supplier: { id: number; facility_name: string } | null;
  supplier_manufacturer: { id: number; name: string } | null;
  _count: { purchase_order_items: number };
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderListItem, '_count'> {
  note: string | null;
  received_at: string | null;
  approved_at: string | null;
  cancel_reason: string | null;
  closed_reason: string | null;
  employees: { id: number; full_name: string } | null;
  approved_by: { id: number; full_name: string } | null;
  purchase_order_items: {
    id: number;
    variant_id: number | null;
    quantity: number;
    received_quantity: number;
    unit_price: string;
    total_price: string | null;
    medicines: { medicine_name: string };
    packaging_variants: { unit_name: string } | null;
  }[];
  purchase_order_events: {
    action: string;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
    actor: { id: number; full_name: string };
  }[];
}

export interface PurchaseOrderOptions {
  warehouses: { id: number; facility_name: string }[];
  manufacturers: { id: number; name: string }[];
  factories: { id: number; facility_name: string }[];
  variants: { id: number; unit_name: string; medicine: { medicine_name: string } }[];
}

export interface PurchaseOrderInput {
  facilityId?: number;
  supplierFacilityId?: number;
  supplierManufacturerId?: number;
  expectedAt?: string;
  note?: string;
  lines: { variantId: number; quantity: number; unitPrice: number }[];
}

const BASE = '/warehouse/purchase-orders';

export const purchaseOrderService = {
  list: (params: { page?: number; limit?: number; status?: string }) =>
    apiClient.get<unknown, {
      success: boolean;
      items: PurchaseOrderListItem[];
      pagination: { total: number; page: number; limit: number; totalPages: number };
    }>(BASE, { params }),
  options: (search?: string) => apiClient.get<unknown, Envelope<PurchaseOrderOptions>>(`${BASE}/options`, { params: { search } }),
  detail: (id: number) => apiClient.get<unknown, Envelope<PurchaseOrderDetail>>(`${BASE}/${id}`),
  create: (input: PurchaseOrderInput) => apiClient.post<unknown, Envelope<PurchaseOrderDetail>>(BASE, input),
  update: (id: number, input: PurchaseOrderInput) => apiClient.patch<unknown, Envelope<PurchaseOrderDetail>>(`${BASE}/${id}`, input),
  approve: (id: number) => apiClient.post<unknown, Envelope<PurchaseOrderDetail>>(`${BASE}/${id}/approve`),
  cancel: (id: number, reason: string) => apiClient.post<unknown, Envelope<PurchaseOrderDetail>>(`${BASE}/${id}/cancel`, { reason }),
};
