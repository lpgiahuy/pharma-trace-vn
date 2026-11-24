'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, App, Button, Descriptions, Input, Modal, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useHydrated } from '@/hooks/useHydrated';
import { useAuthStore } from '@/store/useAuthStore';
import { recallService, type CollectionDestination, type RecallTask } from '@/services/recall.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

export const SEVERITY_COLORS: Record<RecallTask['severity'], string> = { LEVEL_1: 'red', LEVEL_2: 'orange', LEVEL_3: 'gold' };

const KIND_LABELS: Record<RecallTask['kind'], string> = {
  QUARANTINED_STOCK: 'Stock held in quarantine until collection',
  COLLECTION_TRANSFER: 'Dispatch or receive the collection transfer',
  ORDER_TO_RESOLVE: 'Replace the recalled boxes or cancel the order',
};

/**
 * A warehouse manager sends the recalled stock held at their warehouse back to the facility that started the recall.
 * The destination is fixed by the server; it is shown here, never chosen.
 */
function CollectionModal({ task, onClose, onCreated }: { task?: RecallTask; onClose: () => void; onCreated: () => void }) {
  const { message } = App.useApp();
  const [destination, setDestination] = useState<CollectionDestination>();
  const [loadError, setLoadError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const recallId = task?.recallId;

  useEffect(() => {
    if (!recallId) return;
    let current = true;
    recallService.collectionDestination(recallId)
      .then(res => { if (current) setDestination(res.data); })
      .catch((err: unknown) => { if (current) setLoadError(workflowErrorMessage(err, 'Unable to find where this stock goes back to')); });
    return () => { current = false; };
  }, [recallId]);

  const close = () => { setDestination(undefined); setLoadError(''); setNote(''); onClose(); };

  const submit = async () => {
    if (!task || !destination) return;
    setSaving(true);
    try {
      const res = await recallService.collectFromFacility(task.recallId, destination.facilityId, note.trim() || undefined);
      message.success(res.data.created
        ? `Collection transfer ${res.data.transferCode} created`
        : `Collection transfer ${res.data.transferCode} is already open for this recall`);
      setDestination(undefined); setNote('');
      onCreated();
    } catch (err: unknown) {
      message.error(workflowErrorMessage(err, 'Unable to create the collection transfer'));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={!!task} title={`Collect recall ${task?.recallCode ?? ''}`} okText="Create transfer"
      okButtonProps={{ loading: saving, disabled: !destination }} onOk={submit} onCancel={close}>
      <Alert type="info" showIcon className="mb-4!"
        title="Every box of this recall held in quarantine at your warehouse goes on one collection transfer back to the facility that started the recall. Dispatch it from Transfers; the boxes stay quarantined there." />
      {loadError ? <Alert type="warning" showIcon title={loadError} /> : !destination ? <Spin /> : (
        <div className="space-y-3">
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Destination">{destination.facilityName}</Descriptions.Item>
          </Descriptions>
          <div>
            <div className="mb-1">Note</div>
            <Input.TextArea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function RecallTasks({ portal }: { portal: 'admin' | 'warehouse' }) {
  const [tasks, setTasks] = useState<RecallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [collecting, setCollecting] = useState<RecallTask>();
  const transfersPath = portal === 'admin' ? '/admin/logistics/transfers' : '/warehouse/transfers';
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const user = mounted ? getUser() : null;
  const ownFacility = Number(user?.facilityId) || 0;
  // Matches the backend: only a warehouse manager collects, and only the stock of their own warehouse.
  const canCollect = portal === 'warehouse' && user?.role === 'WAREHOUSE_MANAGER' && ownFacility > 0;
  const refresh = () => { setLoading(true); setReload(value => value + 1); };

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
        : task.orderId ? <Link href={`/${portal}/orders/${task.orderId}`}>{task.orderCode}</Link>
          : canCollect && task.kind === 'QUARANTINED_STOCK' && task.facilityId === ownFacility
            ? <Button size="small" type="primary" onClick={() => setCollecting(task)}>Create collection transfer</Button>
            : '—',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Recall tasks</h1>
        <Button onClick={refresh}>Refresh</Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      <Table rowKey={task => `${task.recallId}-${task.kind}-${task.facilityId}-${task.batchNumber}-${task.transferId}-${task.orderId}`}
        columns={columns} dataSource={tasks} loading={loading} pagination={false} scroll={{ x: 'max-content' }} />
      {canCollect && (
        <CollectionModal task={collecting}
          onClose={() => setCollecting(undefined)} onCreated={() => { setCollecting(undefined); refresh(); }} />
      )}
    </div>
  );
}
