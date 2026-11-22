'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { useReport } from '@/hooks/useReport';
import { reportService } from '@/services/report.service';
import type { Granularity } from '@/types/report.types';
import { formatCount, formatVnd, presetRange, rangeDays, vietnamToday } from '@/utils/report-format';
import { DateRangeFilter, type DashboardRange } from '@/components/dashboard/DateRangeFilter';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { OrderStatusDonut } from '@/components/dashboard/OrderStatusDonut';
import { NewCustomersChart } from '@/components/dashboard/NewCustomersChart';

const REPORT_ROLES = ['SUPERADMIN', 'ADMIN', 'STOREMANAGER', 'ACCOUNTANT', 'FINANCEMANAGER'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const mounted = useHydrated();
  const [range, setRange] = useState<DashboardRange>(() => ({ preset: 'last30', ...presetRange('last30', vietnamToday()) }));
  const [granularity, setGranularity] = useState<Granularity>('day');

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;
  const role = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '');
  const canReport = REPORT_ROLES.includes(role);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const { from, to, facilityId } = range;
  const dayDisabled = rangeDays(from, to) > 366;
  const bucketSize: Granularity = dayDisabled ? 'month' : granularity;
  const enabled = isAuthenticated && canReport;

  const overview = useReport(
    useCallback(() => reportService.overview({ from, to, facilityId }).then(res => res.data), [from, to, facilityId]),
    enabled,
  );
  const series = useReport(
    useCallback(() => reportService.revenue({ from, to, facilityId }, bucketSize).then(res => res.data), [from, to, facilityId, bucketSize]),
    enabled,
  );
  const status = useReport(
    useCallback(() => reportService.orderStatus({ from, to, facilityId }).then(res => res.data), [from, to, facilityId]),
    enabled,
  );

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  const current = overview.data?.current;
  const previous = overview.data?.previous;
  const buckets = series.data?.buckets ?? [];
  const kpis = [
    { title: 'Revenue', key: 'revenue', format: formatVnd, spark: buckets.map(b => b.revenue) },
    { title: 'Collected cash', key: 'collectedCash', format: formatVnd },
    { title: 'Orders', key: 'orders', format: formatCount, spark: buckets.map(b => b.orders) },
    { title: 'New customers', key: 'newCustomers', format: formatCount, spark: buckets.map(b => b.newCustomers) },
    { title: 'Avg order value', key: 'avgOrderValue', format: formatVnd },
  ] as const;

  return (
    <div className="space-y-4 animate-fade-in font-sans w-full min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 text-xs m-0 mt-0.5">Sales performance for the selected period</p>
        </div>
        {canReport && (
          <DateRangeFilter value={range} onChange={setRange} showFacility={role === 'SUPERADMIN' || role === 'ADMIN'} />
        )}
      </div>

      {canReport ? (
        <>
          {overview.error && (
            <p className="text-xs text-red-600 m-0">
              {overview.error} <Button type="link" size="small" onClick={overview.reload}>Retry</Button>
            </p>
          )}

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {kpis.map(kpi => (
              <KpiCard
                key={kpi.key}
                title={kpi.title}
                value={kpi.format(current?.[kpi.key] ?? 0)}
                current={current?.[kpi.key] ?? 0}
                previous={previous?.[kpi.key] ?? 0}
                spark={'spark' in kpi && !series.loading ? kpi.spark : undefined}
                loading={overview.loading}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <RevenueChart
              buckets={buckets}
              granularity={bucketSize}
              onGranularityChange={setGranularity}
              dayDisabled={dayDisabled}
              loading={series.loading}
              error={series.error}
              onRetry={series.reload}
            />
            <OrderStatusDonut
              statuses={status.data?.statuses ?? []}
              loading={status.loading}
              error={status.error}
              onRetry={status.reload}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <NewCustomersChart
              buckets={buckets}
              granularity={bucketSize}
              loading={series.loading}
              error={series.error}
              onRetry={series.reload}
            />
            {/* PR 2: StockAlertsPanel */}
          </div>

          {/* PR 3: finance summary */}
        </>
      ) : (
        <p className="text-xs text-slate-500 m-0">Sales reports are available to managers, administrators and finance staff.</p>
      )}
    </div>
  );
}
