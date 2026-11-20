'use client';

import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Modal, Segmented, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { traceabilityService, type FraudAlert, type FraudAlertStatus } from '@/services/traceability.service';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const PAGE_SIZE = 20;
const STATUS_OPTIONS: { label: string; value: FraudAlertStatus | 'ALL' }[] = [
  { label: 'Open', value: 'UNRESOLVED' }, { label: 'Resolved', value: 'RESOLVED' }, { label: 'All', value: 'ALL' },
];

export function FraudAlertTable() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<FraudAlertStatus | 'ALL'>('UNRESOLVED');
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<FraudAlert>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => traceabilityService.alerts({ page, limit: PAGE_SIZE, status: status === 'ALL' ? undefined : status })
    .then(res => {
      setAlerts(res.items);
      setTotal(res.pagination.total);
    }).catch(err => message.error(workflowErrorMessage(err, 'Could not load fraud alerts.'))), [page, status, message]);
  useEffect(() => { void load(); }, [load]);

  async function resolve() {
    if (!resolving) return;
    setBusy(true);
    try {
      await traceabilityService.resolve(resolving.id, note.trim());
      message.success('Alert resolved.');
      setResolving(undefined);
      setNote('');
      await load();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'Could not resolve the alert.'));
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnsType<FraudAlert> = [
    { title: 'Opened', dataIndex: 'createdAt', render: (value: string | null) => formatDateTime(value) },
    { title: 'Scanned code', dataIndex: 'scannedCode', render: (value: string | null) => <span className="font-mono text-xs">{value ?? '—'}</span> },
    { title: 'Reason', dataIndex: 'fraudType' },
    {
      title: 'Status', dataIndex: 'resolutionStatus',
      render: (value: FraudAlertStatus | null) => <Tag color={value === 'RESOLVED' ? 'green' : 'orange'}>{value === 'RESOLVED' ? 'Resolved' : 'Needs investigation'}</Tag>,
    },
    { title: 'Resolution', dataIndex: 'resolutionNote', render: (value: string | null) => value ?? '—' },
    {
      title: '',
      render: (_, row) => row.resolutionStatus === 'RESOLVED' ? null : <Button size="small" onClick={() => setResolving(row)}>Resolve</Button>,
    },
  ];

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Fraud alerts</h2>
        <Segmented value={status} onChange={value => { setStatus(value); setPage(1); }} options={STATUS_OPTIONS} />
      </div>
      <Table rowKey="id" size="small" columns={columns} dataSource={alerts} scroll={{ x: 'max-content' }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }} />
      <Modal open={!!resolving} title="Resolve alert" okText="Resolve" okButtonProps={{ disabled: !note.trim(), loading: busy }}
        onCancel={() => setResolving(undefined)} onOk={() => void resolve()}>
        <Input.TextArea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)}
          placeholder="What did you check and what did you find?" />
      </Modal>
    </section>
  );
}
