'use client';

import { useCallback, useEffect, useState } from 'react';
import { App, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fraudService, type FraudRadarAlert, type FraudReport } from '@/services/fraud.service';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const REFRESH_MS = 10_000;

function alertDetail(alert: FraudRadarAlert): string {
  if (alert.distanceKm === null || alert.minutes === null || alert.speedKmh === null) return alert.description ?? '—';
  return `${alert.distanceKm.toFixed(0)} km in ${alert.minutes.toFixed(0)} min (${alert.speedKmh.toFixed(0)} km/h)`;
}

const COLUMNS: ColumnsType<FraudRadarAlert> = [
  { title: 'Detected', dataIndex: 'createdAt', render: (value: string | null) => formatDateTime(value) },
  { title: 'Box UID', dataIndex: 'uid', render: (value: string | null) => <span className="font-mono text-xs">{value ?? '—'}</span> },
  { title: 'Type', dataIndex: 'fraudType' },
  { title: 'Severity', dataIndex: 'severity', render: (value: string | null) => <Tag color={value === 'CRITICAL' ? 'red' : 'orange'}>{value}</Tag> },
  { title: 'Detail', render: (_, alert) => alertDetail(alert) },
  {
    title: 'Status', dataIndex: 'resolutionStatus',
    render: (value: FraudRadarAlert['resolutionStatus']) => <Tag color={value === 'RESOLVED' ? 'green' : 'volcano'}>{value === 'RESOLVED' ? 'Resolved' : 'Open'}</Tag>,
  },
];

export default function FraudRadarPage() {
  const { message } = App.useApp();
  const [report, setReport] = useState<FraudReport>();

  const load = useCallback(() => fraudService.report()
    .then(res => setReport(res.data))
    .catch((err: unknown) => message.error(workflowErrorMessage(err, 'Could not load the fraud radar.'))), [message]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Fraud radar</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4"><Statistic title="Scans (24h)" value={report?.scans24h ?? 0} /></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><Statistic title="Flagged scans (24h)" value={report?.suspicious24h ?? 0} /></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><Statistic title="Open alerts" value={report?.openAlerts ?? 0} /></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><Statistic title="Critical alerts" value={report?.criticalAlerts ?? 0} styles={{ content: { color: '#ed1c24' } }} /></div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Table rowKey="id" size="small" columns={COLUMNS} dataSource={report?.alerts ?? []} loading={!report} pagination={false} scroll={{ x: 'max-content' }} />
      </div>
    </div>
  );
}
