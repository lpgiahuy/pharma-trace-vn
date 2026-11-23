'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PurchaseOrderStatusTag, supplierName } from '@/components/procurement/PurchaseOrderStatusTag';
import { useHydrated } from '@/hooks/useHydrated';
import { purchaseOrderService, type PurchaseOrderListItem } from '@/services/purchaseOrder.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCurrency } from '@/utils';

const PAGE_SIZE = 20;
const STATUSES = ['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];

const COLUMNS: ColumnsType<PurchaseOrderListItem> = [
  { title: 'PO code', dataIndex: 'po_code' },
  { title: 'Supplier', render: (_, order) => supplierName(order) },
  { title: 'Products', align: 'right', render: (_, order) => order._count.purchase_order_items },
  { title: 'Total', align: 'right', render: (_, order) => formatCurrency(order.total_amount) },
  { title: 'Expected', dataIndex: 'expected_at', render: (value: string | null) => value?.slice(0, 10) ?? '-' },
  { title: 'Status', dataIndex: 'status', render: (status: string | null) => <PurchaseOrderStatusTag status={status} /> },
];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PurchaseOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const getUser = useAuthStore(state => state.getUser);
  const role = useHydrated() ? String(getUser()?.role ?? '') : '';
  const manager = role === 'WAREHOUSE_MANAGER' || role === 'SUPER_ADMIN';

  useEffect(() => {
    purchaseOrderService.list({ page, limit: PAGE_SIZE, status })
      .then(res => { setRows(res.items); setTotal(res.pagination.total); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="m-0 text-lg font-bold text-slate-900">Purchase orders</h1>
        {manager && <Button type="primary" onClick={() => router.push('/warehouse/purchase-orders/new')}>New purchase order</Button>}
      </div>
      <Select
        allowClear
        placeholder="All statuses"
        aria-label="Filter by status"
        className="w-full sm:w-56"
        options={STATUSES.map(value => ({ value, label: value.replace(/_/g, ' ') }))}
        onChange={value => { setLoading(true); setPage(1); setStatus(value); }}
      />
      {role === 'FACTORY_WAREHOUSE_STAFF' && <Alert type="info" showIcon title="These approved orders ask your factory for stock. Prepare the batches and cartons; the warehouse receives them by scanning, or you can send them from the Transfers tab." />}
      {error && <Alert type="error" showIcon title="We could not load purchase orders. Please try again." />}
      <Table
        rowKey="id"
        dataSource={rows}
        columns={COLUMNS}
        loading={loading}
        scroll={{ x: 720 }}
        onRow={row => ({ onClick: () => router.push(`/warehouse/purchase-orders/${row.id}`), className: 'cursor-pointer' })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: value => { setLoading(true); setPage(value); } }}
      />
    </div>
  );
}
