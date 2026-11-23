'use client';

import { useEffect, useState } from 'react';
import { Alert, Card, Input, Segmented, Statistic, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { warehouseService, type ProductionReport } from '@/services/warehouse.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Grouping = 'day' | 'month';
type Period = ProductionReport['periods'][number];
type Medicine = ProductionReport['medicines'][number];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const periodLabel = (period: string, groupBy: Grouping) => groupBy === 'month' ? period.slice(0, 7) : period;

export default function ProductionReportPage() {
  const [groupBy, setGroupBy] = useState<Grouping>('month');
  const [from, setFrom] = useState(daysAgo(364));
  const [to, setTo] = useState(today());
  const [report, setReport] = useState<ProductionReport>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!from || !to) return;
    let current = true;
    warehouseService.productionReport({ from, to, groupBy })
      .then(res => { if (current) { setReport(res.data); setError(undefined); } })
      .catch(err => { if (current) setError(workflowErrorMessage(err, 'We could not load the production report.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [from, to, groupBy]);

  const periodColumns: ColumnsType<Period> = [
    { title: groupBy === 'month' ? 'Month' : 'Day', dataIndex: 'period', render: (value: string) => periodLabel(value, groupBy) },
    { title: 'Batches', dataIndex: 'batches', align: 'right' },
    { title: 'Boxes', dataIndex: 'boxes', align: 'right', render: (value: number) => value.toLocaleString() },
  ];
  const medicineColumns: ColumnsType<Medicine> = [
    { title: 'Medicine', dataIndex: 'medicineName', render: (value: string | null) => value ?? 'Unknown' },
    { title: 'Batches', dataIndex: 'batches', align: 'right' },
    { title: 'Boxes', dataIndex: 'boxes', align: 'right', render: (value: number) => value.toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <h1 className="m-0 text-lg font-bold text-slate-900">Production report</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">From
          <Input type="date" className="mt-1 block w-40" value={from} max={to} onChange={event => { setLoading(true); setFrom(event.target.value); }} />
        </label>
        <label className="text-sm text-slate-600">To
          <Input type="date" className="mt-1 block w-40" value={to} min={from} onChange={event => { setLoading(true); setTo(event.target.value); }} />
        </label>
        <Segmented<Grouping> options={[{ value: 'month', label: 'By month' }, { value: 'day', label: 'By day' }]} value={groupBy}
          onChange={value => { setLoading(true); setGroupBy(value); }} />
      </div>
      <p className="m-0 text-xs text-slate-500">Counted by production date. Cancelled batches are not production and are shown apart.</p>
      {error && <Alert type="error" showIcon title={error} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card size="small" loading={loading}><Statistic title="Batches produced" value={report?.totals.batches ?? 0} /></Card>
        <Card size="small" loading={loading}><Statistic title="Boxes produced" value={report?.totals.boxes ?? 0} /></Card>
        <Card size="small" loading={loading}><Statistic title="On hold" value={report?.totals.heldBatches ?? 0} /></Card>
        <Card size="small" loading={loading}><Statistic title="Recalled" value={report?.totals.recalledBatches ?? 0} /></Card>
        <Card size="small" loading={loading}><Statistic title="Cancelled" value={report?.totals.voidedBatches ?? 0} /></Card>
      </div>
      <Card size="small" title={groupBy === 'month' ? 'Per month' : 'Per day'}>
        <Table rowKey="period" size="small" loading={loading} dataSource={report?.periods ?? []} columns={periodColumns} pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }} />
      </Card>
      <Card size="small" title="Per medicine">
        <Table rowKey={row => String(row.medicineId)} size="small" loading={loading} dataSource={report?.medicines ?? []} columns={medicineColumns} pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }} />
      </Card>
    </div>
  );
}
