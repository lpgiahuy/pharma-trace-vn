'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, App, Button, Descriptions, Drawer, Input, Modal, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useHydrated } from '@/hooks/useHydrated';
import { FactoryBatchModal, downloadBatchLabels } from '@/components/warehouse/FactoryBatchModal';
import { warehouseService, type BatchDetail, type BatchItem } from '@/services/warehouse.service';
import { useAuthStore } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';

const PAGE_SIZE = 20;
const formatDate = (value: string) => new Date(value).toLocaleDateString();
const STATUS_COLORS: Record<string, string> = { ACTIVE: 'green', ON_HOLD: 'orange', RECALLED: 'red', EXPIRED: 'default' };
const statusTag = (status: string | null) => <Tag color={STATUS_COLORS[status ?? ''] ?? 'default'}>{status ?? 'UNKNOWN'}</Tag>;

const COLUMNS: ColumnsType<BatchItem> = [
  { title: 'Batch', dataIndex: 'batchNumber' },
  { title: 'Medicine', dataIndex: 'medicineName' },
  { title: 'Expiry', dataIndex: 'expiryDate', render: formatDate },
  { title: 'Status', dataIndex: 'status', render: statusTag },
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
          <Descriptions.Item label="Status">{statusTag(shown.status)}</Descriptions.Item>
          {shown.holdReason && <Descriptions.Item label="Hold reason">{shown.holdReason}</Descriptions.Item>}
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
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<{ batch: BatchItem; release: boolean }>();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const getUser = useAuthStore(state => state.getUser);
  const role = useHydrated() ? String(getUser()?.role ?? '') : '';
  const manager = role === 'WAREHOUSE_MANAGER' || role === 'SUPER_ADMIN';
  // Only the factory registers batches (the backend also limits this to FACTORY facilities); SUPER_ADMIN picks the factory.
  const canCreate = role === 'FACTORY_WAREHOUSE_STAFF' || role === 'SUPER_ADMIN';
  const [createOpen, setCreateOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<BatchItem>();
  const [voidReason, setVoidReason] = useState('');

  const labelsColumn: ColumnsType<BatchItem>[number] = {
    title: 'Labels',
    render: (_, batch) => (
      <Button size="small" onClick={event => {
        event.stopPropagation();
        downloadBatchLabels(batch.id).catch(err => message.error(workflowErrorMessage(err, 'We could not download the labels.')));
      }}>CSV</Button>
    ),
  };

  const columns: ColumnsType<BatchItem> = manager ? [...COLUMNS, {
    title: 'Action',
    render: (_, batch) => (batch.status === 'ACTIVE' || batch.status === 'ON_HOLD') && (
      <Button size="small" danger={batch.status === 'ACTIVE'} onClick={event => {
        event.stopPropagation();
        setReason('');
        setAction({ batch, release: batch.status === 'ON_HOLD' });
      }}>
        {batch.status === 'ACTIVE' ? 'Hold' : 'Release'}
      </Button>
    ),
  }] : COLUMNS;
  const voidColumn: ColumnsType<BatchItem>[number] = {
    title: 'Void',
    render: (_, batch) => batch.status === 'ACTIVE' && (
      <Button size="small" danger onClick={event => {
        event.stopPropagation();
        setVoidReason('');
        setVoidTarget(batch);
      }}>Void</Button>
    ),
  };
  const tableColumns = canCreate ? [...columns, labelsColumn, voidColumn] : columns;

  const submit = async () => {
    if (!action) return;
    setSaving(true);
    try {
      const change = action.release ? warehouseService.releaseBatch : warehouseService.holdBatch;
      await change(action.batch.id, reason.trim());
      message.success(action.release ? 'Batch released' : 'Batch put on hold');
      setAction(undefined);
      setLoading(true);
      setReload(value => value + 1);
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not change the batch status.'));
    } finally {
      setSaving(false);
    }
  };

  const submitVoid = async () => {
    if (!voidTarget) return;
    setSaving(true);
    try {
      await warehouseService.voidFactoryBatch(voidTarget.id, voidReason.trim());
      message.success(`Batch ${voidTarget.batchNumber} voided`);
      setVoidTarget(undefined);
      setLoading(true);
      setReload(value => value + 1);
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not void the batch.'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    warehouseService.batches({ page, limit: PAGE_SIZE, search: search || undefined, expiring: tab === 'expiring' })
      .then(res => { setRows(res.items); setTotal(res.pagination.total); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page, search, tab, reload]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-lg font-bold text-slate-900">Batches</h1>
        {canCreate && <Button type="primary" onClick={() => setCreateOpen(true)}>New batch</Button>}
      </div>
      <Tabs
        activeKey={tab}
        onChange={key => { setLoading(true); setPage(1); setTab(key); }}
        items={[{ key: 'all', label: 'At this warehouse' }, { key: 'expiring', label: 'Expiring within 30 days' }]}
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
        columns={tableColumns}
        loading={loading}
        scroll={{ x: 720 }}
        onRow={row => ({ onClick: () => setSelected(row.id), className: 'cursor-pointer' })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: value => { setLoading(true); setPage(value); } }}
      />
      <FactoryBatchModal open={createOpen} pickFactory={role === 'SUPER_ADMIN'} onClose={() => setCreateOpen(false)} onCreated={() => { setLoading(true); setReload(value => value + 1); }} />
      <Modal
        open={!!voidTarget}
        title={voidTarget && `Void batch ${voidTarget.batchNumber}`}
        okText="Void batch"
        okButtonProps={{ danger: true, disabled: !voidReason.trim(), loading: saving }}
        onOk={submitVoid}
        onCancel={() => setVoidTarget(undefined)}
      >
        <p>
          Use this only for a batch registered by mistake. It is allowed while every box is still in factory stock and untouched.
          The batch is removed from stock, and the labels already printed stop verifying. This cannot be undone.
        </p>
        <Input.TextArea aria-label="Reason" placeholder="Reason (required)" maxLength={500} showCount rows={3} value={voidReason} onChange={event => setVoidReason(event.target.value)} />
      </Modal>
      <BatchDrawer id={selected} onClose={() => setSelected(undefined)} />
      <Modal
        open={!!action}
        title={action && `${action.release ? 'Release' : 'Hold'} batch ${action.batch.batchNumber}`}
        okText={action?.release ? 'Release' : 'Hold'}
        okButtonProps={{ danger: !action?.release, disabled: !reason.trim(), loading: saving }}
        onOk={submit}
        onCancel={() => setAction(undefined)}
      >
        <p>
          {action?.release
            ? 'Boxes of this batch can be reserved, packed and dispatched again.'
            : 'No box of this batch can be reserved, packed or dispatched until it is released.'}
        </p>
        <Input.TextArea
          aria-label="Reason"
          placeholder="Reason (required)"
          maxLength={500}
          showCount
          rows={3}
          value={reason}
          onChange={event => setReason(event.target.value)}
        />
      </Modal>
    </div>
  );
}

export default function WarehouseBatchesPage() {
  return <Suspense><BatchesPage /></Suspense>;
}
