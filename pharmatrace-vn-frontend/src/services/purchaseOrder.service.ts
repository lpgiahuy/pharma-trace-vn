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
    actor: { id: number; full_name: string } | null;
  }[];
  goods_receipts: {
    id: number;
    receipt_code: string;
    received_at: string;
    received_by: { id: number; full_name: string } | null;
    _count: { goods_receipt_lines: number };
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

export interface GoodsReceiptLineInput {
  poItemId: number;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  boxUids: string[];
  rejectedBoxUids: string[];
  rejectReason?: string;
}

export interface GoodsReceiptDetail {
  id: number;
  receipt_code: string;
  po_id: number;
  received_at: string;
  note: string | null;
  received_by: { id: number; full_name: string } | null;
  purchase_orders: { po_code: string; status: string | null };
  goods_receipt_lines: {
    id: number;
    po_item_id: number;
    quantity_accepted: number;
    quantity_rejected: number;
    reject_reason: string | null;
    box_uids: string[];
    rejected_box_uids: string[];
    batches: { id: number; batch_number: string; production_date: string | null; expiry_date: string | null; status: string | null };
    purchase_order_items: {
      quantity: number;
      received_quantity: number;
      unit_price: string;
      medicines: { medicine_name: string };
      packaging_variants: { unit_name: string } | null;
    };
  }[];
  goods_receipt_attachments: { id: number; kind: string; batch_id: number | null; created_at: string; uploaded_by: { id: number; full_name: string } | null }[];
  accounts_payable: { id: number; total_due_amount: string; paid_amount: string | null; status: string | null } | null;
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
  close: (id: number, reason: string) => apiClient.post<unknown, Envelope<PurchaseOrderDetail>>(`${BASE}/${id}/close`, { reason }),
  receive: (id: number, input: { receiptCode: string; note?: string; lines: GoodsReceiptLineInput[] }) =>
    apiClient.post<unknown, Envelope<GoodsReceiptDetail>>(`${BASE}/${id}/receipts`, input),
  receipt: (id: number, receiptId: number) => apiClient.get<unknown, Envelope<GoodsReceiptDetail>>(`${BASE}/${id}/receipts/${receiptId}`),
  uploadCertificate: (id: number, receiptId: number, batchId: number, file: File) => {
    const data = new FormData();
    data.append('file', file);
    data.append('kind', 'CO_CQ');
    data.append('batchId', String(batchId));
    return apiClient.post<unknown, Envelope<{ id: number }>>(`${BASE}/${id}/receipts/${receiptId}/attachments`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  attachment: (id: number, receiptId: number, attachmentId: number) =>
    apiClient.get<unknown, Blob>(`${BASE}/${id}/receipts/${receiptId}/attachments/${attachmentId}`, { responseType: 'blob' }),
};
