import { Tag } from 'antd';

const COLORS: Record<string, string> = {
  PENDING: 'gold', APPROVED: 'blue', PARTIALLY_RECEIVED: 'cyan', RECEIVED: 'green', CLOSED: 'default', CANCELLED: 'red',
};

export function PurchaseOrderStatusTag({ status }: { status: string | null }) {
  return <Tag color={COLORS[status ?? ''] ?? 'default'}>{(status ?? 'UNKNOWN').replace(/_/g, ' ')}</Tag>;
}

/** Supplier shown on an order: a factory facility or an external manufacturer. */
export function supplierName(order: { supplier: { facility_name: string } | null; supplier_manufacturer: { name: string } | null }): string {
  return order.supplier?.facility_name ?? order.supplier_manufacturer?.name ?? '';
}
