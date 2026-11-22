'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { App, Button, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined } from '@ant-design/icons';
import { useHydrated } from '@/hooks/useHydrated';
import { useReport } from '@/hooks/useReport';
import { useAuthStore } from '@/store/useAuthStore';
import { reportService } from '@/services/report.service';
import type { CashbookEntry, CashbookFilters, CashbookType, PaymentMethod } from '@/types/report.types';
import {
  PAYMENT_METHODS,
  canViewFinance,
  cashbookFilename,
  cashflowData,
  categoryLabel,
  formatVietnamDateTime,
  paymentMethodLabel,
} from '@/utils/finance-report';
import { formatVnd, presetRange, rangeDays, vietnamToday } from '@/utils/report-format';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { CashflowChart } from '@/components/dashboard/CashflowChart';
import { DateRangeFilter, type DashboardRange } from '@/components/dashboard/DateRangeFilter';
import { FinanceAccessDenied } from '@/components/dashboard/FinanceAccessDenied';
import { FinanceStatCard } from '@/components/dashboard/FinanceStatCard';

const PAGE_SIZE = 20;
const MAX_DAYS = 366;

interface EntryFilters {
  paymentMethod?: PaymentMethod;
  type?: CashbookType;
  category?: string;
}

export default function FinanceCashbookPage() {
  const { message } = App.useApp();
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const user = mounted ? getUser() : null;
  const allowed = canViewFinance(user?.role);
  const canOpenPurchaseOrders = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '') === 'SUPERADMIN';

  const [range, setRange] = useState<DashboardRange>(() => ({ preset: 'thisMonth', ...presetRange('thisMonth', vietnamToday()) }));
  const [entryFilters, setEntryFilters] = useState<EntryFilters>({});
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { from, to } = range;
  const { paymentMethod, type, category } = entryFilters;
  const filters = useMemo<CashbookFilters>(() => ({ from, to, paymentMethod, type, category }), [from, to, paymentMethod, type, category]);
  const tooLong = rangeDays(from, to) > MAX_DAYS;

  const cashbook = useReport(
    useCallback(() => reportService.cashbook(filters, page, PAGE_SIZE).then(res => res.data), [filters, page]),
    mounted && allowed && !tooLong,
  );
  const report = cashbook.data;
  const points = useMemo(() => cashflowData(report?.days ?? []), [report]);

  if (!mounted) return null;
  if (!allowed) return <FinanceAccessDenied />;

  const changeRange = (next: DashboardRange) => { setRange(next); setPage(1); };
  const changeFilters = (patch: EntryFilters) => { setEntryFilters(current => ({ ...current, ...patch })); setPage(1); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await reportService.cashbookCsv(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cashbookFilename(filters);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(workflowErrorMessage(error, 'Could not export the cashbook'));
    } finally {
      setExporting(false);
    }
  };

  const firstLoad = cashbook.loading && !report;

  const columns: ColumnsType<CashbookEntry> = [
    { title: 'Date', dataIndex: 'date', key: 'date', width: 150, render: (value: string) => <span className="tabular-nums whitespace-nowrap">{formatVietnamDateTime(value)}</span> },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (value: string) => <span className="font-mono text-xs">{value}</span> },
    { title: 'Type', dataIndex: 'type', key: 'type', render: (value: CashbookType) => <Tag color={value === 'INCOME' ? 'green' : 'red'}>{value === 'INCOME' ? 'Income' : 'Expense'}</Tag> },
    { title: 'Category', dataIndex: 'category', key: 'category', render: (value: string) => categoryLabel(value) },
    { title: 'Method', dataIndex: 'paymentMethod', key: 'method', render: (value: string) => paymentMethodLabel(value) },
    { title: 'Party', dataIndex: 'partyName', key: 'party', render: (value: string | null) => value ?? <span className="text-slate-400">-</span> },
    {
      title: 'Reference',
      key: 'reference',
      render: (_, row) => (
        <span className="flex flex-col gap-0.5">
          {row.orderId !== null && (
            <Link href={`/admin/orders/${row.orderId}`} className="font-mono text-xs text-[#004996] hover:underline">Order #{row.orderCode ?? row.orderId}</Link>
          )}
          {row.poCode !== null && (canOpenPurchaseOrders && row.poId !== null
            ? <Link href={`/warehouse/purchase-orders/${row.poId}`} className="font-mono text-xs text-[#004996] hover:underline">PO {row.poCode}</Link>
            : <span className="font-mono text-xs text-slate-700">PO {row.poCode}</span>)}
          {row.orderId === null && row.poCode === null && <span className="text-slate-400">-</span>}
        </span>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (value: number, row) => (
        <span className={`tabular-nums font-semibold whitespace-nowrap ${row.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
          {row.type === 'INCOME' ? '+' : '-'}{formatVnd(value)}
        </span>
      ),
    },
    { title: 'Note', dataIndex: 'note', key: 'note', ellipsis: true, width: 200, render: (value: string | null) => value ?? <span className="text-slate-400">-</span> },
  ];

  return (
    <div className="space-y-4 animate-fade-in font-sans w-full min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">Cashbook</h1>
          <p className="text-slate-500 text-xs m-0 mt-0.5">Income, expenses and the running cash balance</p>
        </div>
        <DateRangeFilter value={range} onChange={changeRange} showFacility={false} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select<PaymentMethod>
          allowClear
          placeholder="All payment methods"
          value={paymentMethod}
          onChange={value => changeFilters({ paymentMethod: value })}
          options={PAYMENT_METHODS.map(item => ({ value: item.value, label: item.label }))}
          className="w-full sm:w-48"
        />
        <Select<CashbookType>
          allowClear
          placeholder="Income and expense"
          value={type}
          onChange={value => changeFilters({ type: value })}
          options={[{ value: 'INCOME', label: 'Income' }, { value: 'EXPENSE', label: 'Expense' }]}
          className="w-full sm:w-44"
        />
        <Select
          allowClear
          placeholder="All categories"
          value={category}
          onChange={value => changeFilters({ category: value })}
          options={(report?.categories ?? []).map(item => ({ value: item, label: categoryLabel(item) }))}
          className="w-full sm:w-52"
        />
        <Button icon={<DownloadOutlined />} loading={exporting} disabled={tooLong} onClick={exportCsv} className="sm:ml-auto">
          Export CSV
        </Button>
      </div>

      {tooLong && <p className="text-xs text-red-600 m-0">The cashbook covers at most {MAX_DAYS} days. Choose a shorter range.</p>}

      <div className={`space-y-4 transition-opacity ${cashbook.loading && report ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
          <FinanceStatCard title="Opening balance" value={formatVnd(report?.opening ?? 0)} hint="Start of the range" loading={firstLoad} />
          <FinanceStatCard title="Total income" value={formatVnd(report?.totalIncome ?? 0)} tone="positive" loading={firstLoad} />
          <FinanceStatCard title="Total expense" value={formatVnd(report?.totalExpense ?? 0)} tone="negative" loading={firstLoad} />
          <FinanceStatCard title="Closing balance" value={formatVnd(report?.closing ?? 0)} hint="End of the range" loading={firstLoad} />
        </div>

        <CashflowChart points={points} loading={firstLoad} error={cashbook.error} onRetry={cashbook.reload} />

        <section className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 m-0 mb-1">Entries</h2>
          <p className="text-[11px] text-slate-400 m-0 mb-3">
            The balances follow the payment method. The type and category filters only narrow this list.
          </p>
          <Table<CashbookEntry>
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={report?.entries ?? []}
            loading={cashbook.loading}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: report?.total ?? 0,
              showSizeChanger: false,
              hideOnSinglePage: true,
              onChange: setPage,
            }}
            locale={{ emptyText: cashbook.error ?? 'No cashbook entries in this range' }}
          />
        </section>
      </div>
    </div>
  );
}
