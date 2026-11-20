'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, App, Button, Descriptions, Drawer, Form, Input, Modal, Progress, Select, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useHydrated } from '@/hooks/useHydrated';
import { useAuthStore } from '@/store/useAuthStore';
import { RecallTasks, SEVERITY_COLORS } from '@/components/quality/RecallTasks';
import { TransferStatusBadge } from '@/components/logistics/LogisticsBadges';
import {
  recallService, RECALL_SEVERITIES, type CreateRecallInput, type RecallDetail, type RecallImpact, type RecallLocation, type RecallSummary,
} from '@/services/recall.service';
import { warehouseService } from '@/services/warehouse.service';
import { facilityService } from '@/services/facility.service';
import type { Facility } from '@/types/facility.types';
import { formatDate, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const OPEN_TRANSFER_STATUSES = ['REQUESTED', 'DISPATCHED', 'RETURN_REQUESTED'];
const LOCATION_LABELS: Record<RecallLocation, string> = { FACILITY: 'At facilities', IN_TRANSIT: 'In transit', DELIVERED: 'Delivered', OTHER: 'Other' };
const severityTag = (value: RecallSummary['severity']) => <Tag color={SEVERITY_COLORS[value]}>{value}</Tag>;
const statusTag = (value: RecallSummary['status']) => <Tag color={value === 'ACTIVE' ? 'red' : 'default'}>{value}</Tag>;

const IMPACT_COLUMNS: ColumnsType<RecallImpact['boxes'][number]> = [
  { title: 'Box UID', dataIndex: 'uid', render: (uid: string) => <span className="font-mono text-xs">{uid}</span> },
  { title: 'Batch', dataIndex: 'batchNumber' },
  { title: 'Location', dataIndex: 'location', render: (value: RecallLocation) => LOCATION_LABELS[value] },
  { title: 'Box status', dataIndex: 'boxStatus' },
  { title: 'Facility', dataIndex: 'facilityName', render: (value: string | null) => value ?? '—' },
  { title: 'Order', render: (_, box) => box.orderId ? <Link href={`/admin/orders/${box.orderId}`}>{box.orderCode} ({box.orderStatus})</Link> : '—' },
  { title: 'Customer', dataIndex: 'customerName', render: (value: string | null) => value ?? '—' },
];

function CreateRecallModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateRecallInput>();
  const [batchOptions, setBatchOptions] = useState<{ value: number; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const searchBatches = (search: string) => {
    warehouseService.batches({ search, limit: 20 })
      .then(res => setBatchOptions(res.items.map(batch => ({ value: batch.id, label: `${batch.batchNumber} — ${batch.medicineName} (${batch.status})` }))))
      .catch(() => setBatchOptions([]));
  };

  const submit = async (values: CreateRecallInput) => {
    setSaving(true);
    try {
      const res = await recallService.create({ ...values, documentUrl: values.documentUrl || undefined });
      message.success(`Recall ${res.data.recallCode} created`);
      form.resetFields();
      onCreated(res.data.id);
    } catch (err: unknown) {
      message.error(workflowErrorMessage(err, 'Unable to create the recall'));
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} title="New batch recall" okText="Recall batches" okButtonProps={{ danger: true, loading: saving }}
      onOk={() => form.submit()} onCancel={onClose} afterOpenChange={visible => {
        if (!visible) return;
        searchBatches('');
        if (!form.getFieldValue('recallCode')) form.setFieldValue('recallCode', `RCL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now() % 1000}`);
      }}>
      <Alert type="warning" showIcon className="mb-4!" title="Recalled batches are blocked from sale and packing, and their stock is quarantined at every facility." />
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ severity: 'LEVEL_2' }}>
        <Form.Item name="recallCode" label="Recall code" rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{5,29}$/, message: '6-30 letters, digits, dashes or underscores' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="batchIds" label="Batches" rules={[{ required: true }]}>
          <Select mode="multiple" showSearch={{ filterOption: false, onSearch: searchBatches }} options={batchOptions} placeholder="Search by batch number or medicine" />
        </Form.Item>
        <Form.Item name="severity" label="Severity" rules={[{ required: true }]}>
          <Select options={RECALL_SEVERITIES.map(value => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, max: 500 }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="documentUrl" label="Decision document URL" rules={[{ type: 'url', max: 500 }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RecallDrawer({ id, facilities, onClose, onChanged }: { id?: number; facilities: Facility[]; onClose: () => void; onChanged: () => void }) {
  const { message } = App.useApp();
  const [recall, setRecall] = useState<RecallDetail>();
  const [impact, setImpact] = useState<RecallImpact>();
  const [location, setLocation] = useState<RecallLocation>();
  const [destination, setDestination] = useState<number>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const facilityName = (facilityId: number) => facilities.find(f => f.id === facilityId)?.name ?? `#${facilityId}`;

  const load = useCallback((recallId: number) => {
    Promise.all([recallService.detail(recallId), recallService.impact(recallId)])
      .then(([detail, report]) => { setRecall(detail.data); setImpact(report.data); })
      .catch((err: unknown) => message.error(workflowErrorMessage(err, 'Unable to load the recall')));
  }, [message]);

  useEffect(() => { if (id) load(id); }, [id, load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setSaving(true);
    try {
      await action();
      message.success(done);
      onChanged();
      if (id) load(id);
    } catch (err: unknown) {
      message.error(workflowErrorMessage(err, 'The recall could not be updated'));
    } finally { setSaving(false); }
  };

  const shown = recall?.id === id ? recall : undefined;
  const received = shown?.transfers.filter(t => !OPEN_TRANSFER_STATUSES.includes(t.status)).length ?? 0;

  return (
    <Drawer open={!!id} onClose={onClose} loading={!shown} size="large" title={shown?.recallCode}>
      {shown && (
        <div className="space-y-6">
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Status">{statusTag(shown.status)}</Descriptions.Item>
            <Descriptions.Item label="Severity">{severityTag(shown.severity)}</Descriptions.Item>
            <Descriptions.Item label="Reason">{shown.reason}</Descriptions.Item>
            {shown.documentUrl && <Descriptions.Item label="Document"><a href={shown.documentUrl} target="_blank" rel="noreferrer">{shown.documentUrl}</a></Descriptions.Item>}
            <Descriptions.Item label="Created">{formatDateTime(shown.createdAt)}</Descriptions.Item>
            {shown.closedAt && <Descriptions.Item label="Closed">{formatDateTime(shown.closedAt)}</Descriptions.Item>}
          </Descriptions>

          <Table rowKey="batchId" size="small" pagination={false} dataSource={shown.batches} columns={[
            { title: 'Batch', dataIndex: 'batchNumber' },
            { title: 'Medicine', dataIndex: 'medicineName' },
            { title: 'Expiry', dataIndex: 'expiryDate', render: formatDate },
            { title: 'Boxes', dataIndex: 'boxCount', align: 'right' },
          ]} />

          {impact && (
            <section className="space-y-3">
              <h3 className="font-semibold">Impact report</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Statistic title="Total boxes" value={impact.totalBoxes} />
                {(Object.keys(LOCATION_LABELS) as RecallLocation[]).map(key => (
                  <Statistic key={key} title={LOCATION_LABELS[key]} value={impact.byLocation[key]} />
                ))}
              </div>
              <Select allowClear placeholder="All locations" className="w-48" value={location} onChange={setLocation}
                options={(Object.keys(LOCATION_LABELS) as RecallLocation[]).map(value => ({ value, label: LOCATION_LABELS[value] }))} />
              <Table rowKey="uid" size="small" columns={IMPACT_COLUMNS} scroll={{ x: 'max-content' }}
                dataSource={location ? impact.boxes.filter(box => box.location === location) : impact.boxes} />
            </section>
          )}

          <section className="space-y-3">
            <h3 className="font-semibold">Collection</h3>
            {shown.transfers.length > 0 && <Progress percent={Math.round((received / shown.transfers.length) * 100)} format={() => `${received}/${shown.transfers.length} received`} />}
            <Table rowKey="id" size="small" pagination={false} dataSource={shown.transfers} columns={[
              { title: 'Transfer', render: (_, t) => <Link href={`/admin/logistics/transfers?transferId=${t.id}`}>{t.transferCode}</Link> },
              { title: 'From', render: (_, t) => facilityName(t.fromFacilityId) },
              { title: 'To', render: (_, t) => facilityName(t.toFacilityId) },
              { title: 'Status', dataIndex: 'status', render: (status: string) => <TransferStatusBadge status={status} /> },
            ]} />
            {shown.status === 'ACTIVE' && (
              <div className="flex flex-wrap gap-2">
                <Select className="w-64" placeholder="Collect into warehouse" value={destination} onChange={setDestination}
                  options={facilities.filter(f => ['CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'].includes(f.rawType || f.type)).map(f => ({ value: f.id, label: f.name }))} />
                <Button type="primary" disabled={!destination} loading={saving}
                  onClick={() => destination && run(() => recallService.collect(shown.id, destination), 'Collection transfers created')}>
                  Start collection
                </Button>
              </div>
            )}
          </section>

          {shown.status === 'ACTIVE' && (
            <section className="space-y-2">
              <h3 className="font-semibold">Close recall</h3>
              <Input.TextArea rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Closing note" />
              <Button danger disabled={!note.trim()} loading={saving} onClick={() => run(() => recallService.close(shown.id, note.trim()), 'Recall closed')}>
                Close recall
              </Button>
            </section>
          )}

          <Table rowKey={(_, index) => String(index)} size="small" pagination={false} dataSource={shown.events} columns={[
            { title: 'Event', dataIndex: 'action' },
            { title: 'Facility', dataIndex: 'facilityId', render: (value: number | null) => value ? facilityName(value) : '—' },
            { title: 'Boxes', dataIndex: 'boxCount', align: 'right' },
            { title: 'Note', dataIndex: 'note', render: (value: string | null) => value ?? '—' },
            { title: 'At', dataIndex: 'createdAt', render: formatDateTime },
          ]} />
        </div>
      )}
    </Drawer>
  );
}

function RecallManager() {
  const [recalls, setRecalls] = useState<RecallSummary[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number>();

  useEffect(() => {
    recallService.list()
      .then(res => { setRecalls(res.data); setError(''); })
      .catch((err: unknown) => setError(workflowErrorMessage(err, 'Unable to load recalls')))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => { facilityService.getDropdownList().then(res => setFacilities(res.data)).catch(() => setFacilities([])); }, []);

  const refresh = () => setReload(value => value + 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Batch recalls</h1>
        <Button type="primary" danger onClick={() => setCreating(true)}>New recall</Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      <Table rowKey="id" loading={loading} dataSource={recalls} scroll={{ x: 'max-content' }}
        onRow={recall => ({ onClick: () => setSelected(recall.id), className: 'cursor-pointer' })} columns={[
          { title: 'Code', dataIndex: 'recallCode' },
          { title: 'Severity', dataIndex: 'severity', render: severityTag },
          { title: 'Status', dataIndex: 'status', render: statusTag },
          { title: 'Batches', dataIndex: 'batchCount', align: 'right' },
          { title: 'Reason', dataIndex: 'reason', ellipsis: true },
          { title: 'Created', dataIndex: 'createdAt', render: formatDateTime },
        ]} />
      <CreateRecallModal open={creating} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); refresh(); setSelected(id); }} />
      <RecallDrawer id={selected} facilities={facilities} onClose={() => setSelected(undefined)} onChanged={refresh} />
    </div>
  );
}

export default function AdminRecallsPage() {
  const getUser = useAuthStore(state => state.getUser);
  const mounted = useHydrated();
  if (!mounted) return null;
  const role = getUser()?.role;
  if (role === 'SUPER_ADMIN') return <RecallManager />;
  if (role === 'STORE_MANAGER') return <RecallTasks portal="admin" />;
  return <Alert type="warning" showIcon title="Only super administrators and store managers can view recalls." />;
}
