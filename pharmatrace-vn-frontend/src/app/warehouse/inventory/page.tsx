'use client';

import { useEffect, useState } from 'react';
import { Alert, Drawer, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { warehouseService, type BatchItem, type InventoryItem, type InventoryLog } from '@/services/warehouse.service';

const PAGE_SIZE = 20;

const COLUMNS: ColumnsType<InventoryItem> = [
  { title: 'Medicine', dataIndex: 'medicineName' },
  { title: 'Unit', dataIndex: 'unitName' },
  { title: 'Stock', dataIndex: 'stock', align: 'right' },
  { title: 'Reserved', dataIndex: 'reserved', align: 'right' },
  { title: 'Available', dataIndex: 'available', align: 'right' },
  { title: 'Quarantine', dataIndex: 'quarantine', align: 'right' },
];

const BATCH_COLUMNS: ColumnsType<BatchItem> = [
  { title: 'Batch', dataIndex: 'batchNumber' },
  { title: 'Expiry', dataIndex: 'expiryDate', render: (value: string) => new Date(value).toLocaleDateString() },
  { title: 'Boxes in stock', dataIndex: 'boxesInStock', align: 'right' },
];

const LOG_COLUMNS: ColumnsType<InventoryLog> = [
  { title: 'Time', dataIndex: 'createdAt', render: (value: string | null) => (value ? new Date(value).toLocaleString() : '-') },
  { title: 'Type', dataIndex: 'type' },
  { title: 'Change', dataIndex: 'quantityChanged', align: 'right' },
  { title: 'After', dataIndex: 'newQuantity', align: 'right' },
  { title: 'Reference', dataIndex: 'referenceCode' },
];

function ProductDrawer({ item, onClose }: { item?: InventoryItem; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ variantId: number; batches: BatchItem[]; logs: InventoryLog[] }>();
  const variantId = item?.variantId;

  useEffect(() => {
    if (!variantId) return;
    Promise.all([warehouseService.inventoryDetail(variantId), warehouseService.logs({ variantId, limit: 50 })])
      .then(([detail, page]) => setLoaded({ variantId, batches: detail.data.batches, logs: page.items }))
      .catch(() => setLoaded({ variantId, batches: [], logs: [] }));
  }, [variantId]);

  const current = loaded?.variantId === variantId ? loaded : undefined;
  const loading = !current;
  const batches = current?.batches ?? [];
  const logs = current?.logs ?? [];

  return (
    <Drawer open={!!item} onClose={onClose} size="large" title={item ? `${item.medicineName} (${item.unitName})` : ''}>
      <h3 className="text-sm font-semibold">Boxes by batch</h3>
      <Table rowKey="id" size="small" loading={loading} dataSource={batches} columns={BATCH_COLUMNS} pagination={false} />
      <h3 className="mt-6 text-sm font-semibold">Latest stock movements</h3>
      <Table rowKey="id" size="small" loading={loading} dataSource={logs} columns={LOG_COLUMNS} pagination={false} scroll={{ x: 560 }} />
    </Drawer>
  );
}

export default function WarehouseInventoryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<InventoryItem>();

  useEffect(() => {
    warehouseService.inventory({ page, limit: PAGE_SIZE, search: search || undefined })
      .then(res => { setRows(res.items); setTotal(res.pagination.total); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page, search]);

  return (
    <div className="space-y-4">
      <h1 className="m-0 text-lg font-bold text-slate-900">Inventory</h1>
      <Input.Search
        allowClear
        placeholder="Search by medicine name"
        aria-label="Search inventory"
        className="w-full sm:w-72"
        onSearch={value => { setLoading(true); setPage(1); setSearch(value.trim()); }}
      />
      {error && <Alert type="error" showIcon title="We could not load inventory. Please try again." />}
      <Table
        rowKey={row => `${row.facilityId}-${row.variantId}`}
        dataSource={rows}
        columns={COLUMNS}
        loading={loading}
        scroll={{ x: 720 }}
        onRow={row => ({ onClick: () => setSelected(row), className: 'cursor-pointer' })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: value => { setLoading(true); setPage(value); } }}
      />
      <ProductDrawer item={selected} onClose={() => setSelected(undefined)} />
    </div>
  );
}
