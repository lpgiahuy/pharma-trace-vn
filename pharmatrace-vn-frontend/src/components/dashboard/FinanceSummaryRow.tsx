'use client';

import React, { useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { useReport } from '@/hooks/useReport';
import { reportService } from '@/services/report.service';
import { payableTotals, receivableTotals } from '@/utils/finance-report';
import { formatVnd, vietnamToday } from '@/utils/report-format';
import { FinanceStatCard } from './FinanceStatCard';

interface FinanceSummaryRowProps {
  /** Only admins and finance roles; the API refuses everyone else. */
  enabled: boolean;
}

/** Receivables, payables and the cash balance as of today. They ignore the dashboard date range. */
export function FinanceSummaryRow({ enabled }: FinanceSummaryRowProps) {
  const today = vietnamToday();
  const receivables = useReport(useCallback(() => reportService.receivables(today).then(res => res.data), [today]), enabled);
  const payables = useReport(useCallback(() => reportService.payables(today).then(res => res.data), [today]), enabled);
  const cashbook = useReport(
    useCallback(() => reportService.cashbook({ from: today, to: today }, 1, 1).then(res => res.data), [today]),
    enabled,
  );

  const receivable = useMemo(() => receivableTotals(receivables.data?.summary ?? []), [receivables.data]);
  const payable = useMemo(
    () => payableTotals(payables.data?.summary ?? [], payables.data?.details ?? [], today),
    [payables.data, today],
  );
  const failed = [receivables.error, payables.error, cashbook.error].find(error => error !== null);
  const reloadAll = () => { receivables.reload(); payables.reload(); cashbook.reload(); };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 m-0">Finance</h2>
        {failed && (
          <p className="text-xs text-red-600 m-0">
            {failed} <Button type="link" size="small" onClick={reloadAll}>Retry</Button>
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-3">
        <FinanceStatCard
          title="Receivable"
          value={formatVnd(receivable.total)}
          hint={`${formatVnd(receivable.overdue)} older than 30 days`}
          tone={receivable.overdue > 0 ? 'warning' : 'default'}
          loading={receivables.loading && !receivables.data}
          href="/admin/finance/debts"
        />
        <FinanceStatCard
          title="Payable"
          value={formatVnd(payable.total)}
          hint={`${formatVnd(payable.overdue)} overdue`}
          tone={payable.overdue > 0 ? 'warning' : 'default'}
          loading={payables.loading && !payables.data}
          href="/admin/finance/debts"
        />
        <FinanceStatCard
          title="Cash balance"
          value={formatVnd(cashbook.data?.closing ?? 0)}
          hint={cashbook.data ? `Today: +${formatVnd(cashbook.data.totalIncome)} / -${formatVnd(cashbook.data.totalExpense)}` : undefined}
          loading={cashbook.loading && !cashbook.data}
          href="/admin/finance/cashbook"
        />
      </div>
    </section>
  );
}
