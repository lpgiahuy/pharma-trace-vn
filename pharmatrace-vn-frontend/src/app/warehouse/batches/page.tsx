'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Descriptions, Drawer, Input, Table, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { warehouseService, type BatchDetail, type BatchItem } from '@/services/warehouse.service';

const PAGE_SIZE = 20;
const formatDate = (value: string) => new Date(value).toLocaleDateString();

const COLUMNS: ColumnsType<BatchItem> = [
  { title: 'Batch', dataIndex: 'batchNumber' },
  { title: 'Medicine', dataIndex: 'medicineName' },
  { title: 'Expiry', dataIndex: 'expiryDate', render: formatDate },
  { title: 'Status', dataIndex: 'status' },
  { title: 'Boxes in stock', dataIndex: 'boxesInStock', align: 'right' },
];

function BatchDrawer({ id, onClose }: { id?: number; onClose: () => void }) {
  const [batch, setBatch] = useState<BatchDetail>();

  useEffect(() => {
    if (!id) return;
    warehouseService.batch(id).then(res => setBatch(res.data)).catch(() => setBatch(undefined));
  }, [id]);

  const shown = batch && batch.id === id ? batch : undefined;
  return (
    <Drawer open={!!id} onClose={onClose} loading={!shown} title={shown?.batchNumber}>
      {shown && (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Medicine">{shown.medicineName}</Descriptions.Item>
          <Descriptions.Item label="Production date">{formatDate(shown.productionDate)}</Descriptions.Item>
          <Descriptions.Item label="Expiry date">{formatDate(shown.expiryDate)}</Descriptions.Item>
          <Descriptions.Item label="Status">{shown.status}</Descriptions.Item>
          <Descriptions.Item label="Initial / remaining">{shown.initialQuantity} / {shown.remainingQuantity}</Descriptions.Item>
          {shown.boxes.map(box => (
            <Descriptions.Item key={box.status ?? 'none'} label={`Boxes ${box.status ?? 'without status'}`}>{box.count}</Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </Drawer>
  );
}

function BatchesPage() {
  const [tab, setTab] = useState(useSearchParams().get('tab') === 'expiring' ? 'expiring' : 'all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<number>();

  useEffect(() => {
    warehouseService.batches({ page, limit: PAGE_SIZE, search: search || undefined, expiring: tab === 'expiring' })
      .then(res => { setRows(res.items); setTotal(res.pagination.total); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page, search, tab]);

  return (
    <div className="space-y-4">
      <h1 className="m-0 text-lg font-bold text-slate-900">Batches</h1>
      <Tabs
        activeKey={tab}
        onChange={key => { setLoading(true); setPage(1); setTab(key); }}
        items={[{ key: 'all', label: 'In stock' }, { key: 'expiring', label: 'Expiring within 30 days' }]}
      />
      <Input.Search
        allowClear
        placeholder="Search by batch number or medicine"
        aria-label="Search batches"
        className="w-full sm:w-72"
        onSearch={value => { setLoading(true); setPage(1); setSearch(value.trim()); }}
      />
      {error && <Alert type="error" showIcon title="We could not load batches. Please try again." />}
      <Table
        rowKey="id"
        dataSource={rows}
        columns={COLUMNS}
        loading={loading}
        scroll={{ x: 720 }}
        onRow={row => ({ onClick: () => setSelected(row.id), className: 'cursor-pointer' })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: value => { setLoading(true); setPage(value); } }}
      />
      <BatchDrawer id={selected} onClose={() => setSelected(undefined)} />
    </div>
  );
}

export default function WarehouseBatchesPage() {
  return <Suspense><BatchesPage /></Suspense>;
}
