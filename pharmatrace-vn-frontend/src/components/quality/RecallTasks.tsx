'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { recallService, type RecallTask } from '@/services/recall.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

export const SEVERITY_COLORS: Record<RecallTask['severity'], string> = { LEVEL_1: 'red', LEVEL_2: 'orange', LEVEL_3: 'gold' };

const KIND_LABELS: Record<RecallTask['kind'], string> = {
  QUARANTINED_STOCK: 'Stock held in quarantine until collection',
  COLLECTION_TRANSFER: 'Dispatch or receive the collection transfer',
  ORDER_TO_RESOLVE: 'Replace the recalled boxes or cancel the order',
};

export function RecallTasks({ portal }: { portal: 'admin' | 'warehouse' }) {
  const [tasks, setTasks] = useState<RecallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const transfersPath = portal === 'admin' ? '/admin/logistics/transfers' : '/warehouse/transfers';

  useEffect(() => {
    recallService.tasks()
      .then(res => { setTasks(res.data); setError(''); })
      .catch((err: unknown) => setError(workflowErrorMessage(err, 'Unable to load recall tasks')))
      .finally(() => setLoading(false));
  }, [reload]);

  const columns: ColumnsType<RecallTask> = [
    { title: 'Recall', dataIndex: 'recallCode' },
    { title: 'Severity', dataIndex: 'severity', render: (value: RecallTask['severity']) => <Tag color={SEVERITY_COLORS[value]}>{value}</Tag> },
    { title: 'Task', dataIndex: 'kind', render: (value: RecallTask['kind']) => KIND_LABELS[value] },
    { title: 'Batch', dataIndex: 'batchNumber', render: (value: string | null) => value ?? '—' },
    { title: 'Boxes', dataIndex: 'quantity', align: 'right', render: (value: number | null) => value ?? '—' },
    {
      title: 'Document',
      render: (_, task) => task.transferId
        ? <Link href={`${transfersPath}?transferId=${task.transferId}`}>{task.transferCode} ({task.transferStatus})</Link>
        : task.orderId ? <Link href={`/${portal}/orders/${task.orderId}`}>{task.orderCode}</Link> : '—',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Recall tasks</h1>
        <Button onClick={() => { setLoading(true); setReload(value => value + 1); }}>Refresh</Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      <Table rowKey={task => `${task.recallId}-${task.kind}-${task.facilityId}-${task.batchNumber}-${task.transferId}-${task.orderId}`}
        columns={columns} dataSource={tasks} loading={loading} pagination={false} scroll={{ x: 'max-content' }} />
    </div>
  );
}
