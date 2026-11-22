'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Input, Select, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useHydrated } from '@/hooks/useHydrated';
import { useReport } from '@/hooks/useReport';
import { useAuthStore } from '@/store/useAuthStore';
import { reportService } from '@/services/report.service';
import type { PayableBucket, PayableDetail, ReceivableBucket, ReceivableDetail } from '@/types/report.types';
import {
  PAYABLE_BUCKETS,
  RECEIVABLE_BUCKETS,
  agingChartData,
  canViewFinance,
  filterPayables,
  filterReceivables,
  payableTotals,
  receivableTotals,
} from '@/utils/finance-report';
import { formatCount, formatVnd } from '@/utils/report-format';
import { AgingChart } from '@/components/dashboard/AgingChart';
import { FinanceAccessDenied } from '@/components/dashboard/FinanceAccessDenied';
import { FinanceStatCard } from '@/components/dashboard/FinanceStatCard';

type DebtTab = 'receivables' | 'payables';

const money = (amount: number) => <span className="tabular-nums font-semibold text-slate-900">{formatVnd(amount)}</span>;
const dash = <span className="text-slate-400">-</span>;

export default function FinanceDebtsPage() {
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const user = mounted ? getUser() : null;
  const allowed = canViewFinance(user?.role);
  const canOpenPurchaseOrders = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '') === 'SUPERADMIN';

  const [tab, setTab] = useState<DebtTab>('receivables');
  const [receivableFilters, setReceivableFilters] = useState<{ party?: string; bucket?: ReceivableBucket; search?: string }>({});
  const [payableFilters, setPayableFilters] = useState<{ party?: string; bucket?: PayableBucket; search?: string }>({});

  const receivables = useReport(useCallback(() => reportService.receivables().then(res => res.data), []), mounted && allowed);
  const payables = useReport(useCallback(() => reportService.payables().then(res => res.data), []), mounted && allowed);

  const receivableData = receivables.data;
  const payableData = payables.data;

  const receivableSum = useMemo(() => receivableTotals(receivableData?.summary ?? []), [receivableData]);
  const payableSum = useMemo(
    () => payableTotals(payableData?.summary ?? [], payableData?.details ?? [], payableData?.asOf ?? ''),
    [payableData],
  );
  const receivableChart = useMemo(() => agingChartData(receivableData?.summary ?? [], RECEIVABLE_BUCKETS), [receivableData]);
  const payableChart = useMemo(
    () => agingChartData((payableData?.summary ?? []).map(row => ({ party: row.supplierName, bucket: row.bucket, amount: row.amount })), PAYABLE_BUCKETS),
    [payableData],
  );
  const receivableRows = useMemo(() => filterReceivables(receivableData?.details ?? [], receivableFilters), [receivableData, receivableFilters]);
  const payableRows = useMemo(() => filterPayables(payableData?.details ?? [], payableFilters), [payableData, payableFilters]);

  if (!mounted) return null;
  if (!allowed) return <FinanceAccessDenied />;

  const receivableParties = [...new Set((receivableData?.details ?? []).map(row => row.party))];
  const payableParties = [...new Set((payableData?.details ?? []).map(row => row.supplierName))];
  const receivableBucketLabel = (bucket: string) => RECEIVABLE_BUCKETS.find(item => item.key === bucket)?.label ?? bucket;
  const payableBucketLabel = (bucket: string) => PAYABLE_BUCKETS.find(item => item.key === bucket)?.label ?? bucket;

  const receivableColumns: ColumnsType<ReceivableDetail> = [
    { title: 'Party', dataIndex: 'party', key: 'party' },
    {
      title: 'Order',
      key: 'order',
      render: (_, row) => row.orderId === null
        ? dash
        : <Link href={`/admin/orders/${row.orderId}`} className="font-mono text-[#004996] hover:underline">#{row.orderCode ?? row.orderId}</Link>,
    },
    { title: 'Date', dataIndex: 'documentDate', key: 'date', render: (value: string | null) => value ?? dash },
    { title: 'Age', dataIndex: 'ageDays', key: 'age', align: 'right', render: (value: number | null) => (value === null ? dash : `${formatCount(value)} d`) },
    { title: 'Bucket', dataIndex: 'bucket', key: 'bucket', render: (bucket: string) => <Tag color={bucket === 'GT_30' ? 'red' : 'default'}>{receivableBucketLabel(bucket)}</Tag> },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (value: number) => money(value) },
  ];

  const payableColumns: ColumnsType<PayableDetail> = [
    { title: 'Supplier', dataIndex: 'supplierName', key: 'supplier' },
    {
      title: 'Purchase order',
      key: 'po',
      render: (_, row) => {
        if (row.poCode === null) return dash;
        return canOpenPurchaseOrders && row.poId !== null
          ? <Link href={`/warehouse/purchase-orders/${row.poId}`} className="font-mono text-[#004996] hover:underline">{row.poCode}</Link>
          : <span className="font-mono text-slate-700">{row.poCode}</span>;
      },
    },
    { title: 'Due date', dataIndex: 'dueDate', key: 'due', render: (value: string | null) => value ?? <span className="text-slate-400">Not set</span> },
    {
      title: 'Days overdue',
      dataIndex: 'daysOverdue',
      key: 'overdue',
      align: 'right',
      render: (value: number | null) => (value === null ? dash : value > 0 ? <span className="text-red-600">{formatCount(value)}</span> : 'Not due'),
    },
    { title: 'Bucket', dataIndex: 'bucket', key: 'bucket', render: (bucket: string) => <Tag color={['1_30', '31_60', 'GT_60'].includes(bucket) ? 'red' : 'default'}>{payableBucketLabel(bucket)}</Tag> },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (value: number) => money(value) },
  ];

  const filterBar = (children: React.ReactNode) => <div className="flex flex-wrap items-center gap-2 mb-3">{children}</div>;

  return (
    <div className="space-y-4 animate-fade-in font-sans w-full min-w-0">
      <div>
        <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">Debts</h1>
        <p className="text-slate-500 text-xs m-0 mt-0.5">
          Money owed to the business and to suppliers{receivableData ? `, as of ${receivableData.asOf}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
        <FinanceStatCard
          title="Total receivable"
          value={formatVnd(receivableSum.total)}
          hint="Courier COD and unpaid online orders"
          loading={receivables.loading && !receivableData}
        />
        <FinanceStatCard
          title="Overdue receivable"
          value={formatVnd(receivableSum.overdue)}
          hint="Older than 30 days"
          tone={receivableSum.overdue > 0 ? 'negative' : 'default'}
          loading={receivables.loading && !receivableData}
        />
        <FinanceStatCard
          title="Total payable"
          value={formatVnd(payableSum.total)}
          hint={`${formatVnd(payableSum.overdue)} overdue`}
          loading={payables.loading && !payableData}
        />
        <FinanceStatCard
          title="Due in next 7 days"
          value={formatVnd(payableSum.dueNext7Days)}
          hint="Supplier payments not yet overdue"
          tone={payableSum.dueNext7Days > 0 ? 'warning' : 'default'}
          loading={payables.loading && !payableData}
        />
      </div>

      <Tabs
        activeKey={tab}
        onChange={key => setTab(key as DebtTab)}
        items={[
          {
            key: 'receivables',
            label: 'Receivables',
            children: (
              <div className="space-y-4">
                <AgingChart
                  title="Receivables by age"
                  data={receivableChart}
                  loading={receivables.loading && !receivableData}
                  error={receivables.error}
                  onRetry={receivables.reload}
                />
                <section className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 m-0 mb-3">Receivable details</h2>
                  {filterBar(
                    <>
                      <Select
                        allowClear
                        placeholder="All parties"
                        value={receivableFilters.party}
                        onChange={party => setReceivableFilters(current => ({ ...current, party }))}
                        options={receivableParties.map(party => ({ value: party, label: party }))}
                        className="w-full sm:w-48"
                      />
                      <Select<ReceivableBucket>
                        allowClear
                        placeholder="All ages"
                        value={receivableFilters.bucket}
                        onChange={bucket => setReceivableFilters(current => ({ ...current, bucket }))}
                        options={RECEIVABLE_BUCKETS.map(item => ({ value: item.key, label: item.label }))}
                        className="w-full sm:w-44"
                      />
                      <Input.Search
                        allowClear
                        placeholder="Search order code"
                        onSearch={search => setReceivableFilters(current => ({ ...current, search }))}
                        className="w-full sm:w-56"
                      />
                    </>,
                  )}
                  <Table<ReceivableDetail>
                    size="small"
                    rowKey={row => `${row.shipmentId ?? 'o'}-${row.orderId ?? 'x'}`}
                    columns={receivableColumns}
                    dataSource={receivableRows}
                    loading={receivables.loading}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
                    locale={{ emptyText: receivables.error ?? 'No open receivables' }}
                  />
                </section>
              </div>
            ),
          },
          {
            key: 'payables',
            label: 'Payables',
            children: (
              <div className="space-y-4">
                <AgingChart
                  title="Payables by due date"
                  data={payableChart}
                  loading={payables.loading && !payableData}
                  error={payables.error}
                  onRetry={payables.reload}
                />
                <section className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 m-0 mb-3">Payable details</h2>
                  {filterBar(
                    <>
                      <Select
                        allowClear
                        placeholder="All suppliers"
                        value={payableFilters.party}
                        onChange={party => setPayableFilters(current => ({ ...current, party }))}
                        options={payableParties.map(party => ({ value: party, label: party }))}
                        className="w-full sm:w-48"
                      />
                      <Select<PayableBucket>
                        allowClear
                        placeholder="All due dates"
                        value={payableFilters.bucket}
                        onChange={bucket => setPayableFilters(current => ({ ...current, bucket }))}
                        options={PAYABLE_BUCKETS.map(item => ({ value: item.key, label: item.label }))}
                        className="w-full sm:w-52"
                      />
                      <Input.Search
                        allowClear
                        placeholder="Search PO code"
                        onSearch={search => setPayableFilters(current => ({ ...current, search }))}
                        className="w-full sm:w-56"
                      />
                    </>,
                  )}
                  <Table<PayableDetail>
                    size="small"
                    rowKey={row => String(row.payableId)}
                    columns={payableColumns}
                    dataSource={payableRows}
                    loading={payables.loading}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
                    locale={{ emptyText: payables.error ?? 'No open payables' }}
                  />
                </section>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
