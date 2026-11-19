'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { QueueOrder, warehouseService } from '@/services/warehouse.service';
import { OrderStatusBadge } from '@/components/ui/Badge';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const COLUMNS: ColumnsType<QueueOrder> = [
  { title: 'Order', render: (_, row) => <Link href={`/warehouse/orders/${row.id}`} className="font-mono font-semibold">{row.orderCode}</Link> },
  { title: 'Placed', dataIndex: 'createdAt', render: (value: string | null) => formatDateTime(value) },
  { title: 'Recipient', dataIndex: 'recipientName' },
  { title: 'Status', dataIndex: 'orderStatus', render: (value: string | null) => <OrderStatusBadge status={value ?? ''} /> },
  { title: 'Packed boxes', render: (_, row) => <span className="tabular-nums">{row.packedBoxes} / {row.requiredBoxes}</span> },
  { title: 'Packages', dataIndex: 'packageCount' },
];

export function PackingQueue() {
  const [rows, setRows] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    warehouseService.packingQueue()
      .then(res => setRows(res.data))
      .catch(err => setError(workflowErrorMessage(err, 'Could not load the packing queue.')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-2">
      <h1 className="text-xl font-bold text-fg">Packing queue</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <Table rowKey="id" columns={COLUMNS} dataSource={rows} loading={loading} pagination={false} size="middle" scroll={{ x: true }} />
      </div>
    </section>
  );
}
