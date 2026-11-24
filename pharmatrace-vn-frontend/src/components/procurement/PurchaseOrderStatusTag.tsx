import { Tag } from 'antd';

const COLORS: Record<string, string> = {
  PENDING: 'gold', APPROVED: 'blue', SHIPPED: 'geekblue', REJECTED: 'volcano',PARTIALLY_RECEIVED: 'cyan', RECEIVED: 'green', CLOSED: 'default', CANCELLED: 'red',
};

export function PurchaseOrderStatusTag({ status }: { status: string | null }) {
  // Only the text keeps the status colour; the tag background and border are dropped.
  return <Tag color={COLORS[status ?? ''] ?? 'default'} style={{ background: 'transparent', border: 'none', paddingInline: 0 }}>{(status ?? 'UNKNOWN').replace(/_/g, ' ')}</Tag>;
}

/** Supplier shown on an order: a factory facility or an external manufacturer. */
export function supplierName(order: { supplier: { facility_name: string } | null; supplier_manufacturer: { name: string } | null }): string {
  return order.supplier?.facility_name ?? order.supplier_manufacturer?.name ?? '';
}
