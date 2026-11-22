'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AppstoreOutlined,
  CarOutlined,
  InfoCircleOutlined,
  MedicineBoxOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { useReport } from '@/hooks/useReport';
import { reportService } from '@/services/report.service';
import type { Granularity, ReportRange } from '@/types/report.types';
import { MAX_DAILY_DAYS, formatCount, formatVnd, rangeDays } from '@/utils/report-format';
import { DateRangeFilter, initialDashboardRange, type DashboardRange } from '@/components/dashboard/DateRangeFilter';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { OrderStatusDonut } from '@/components/dashboard/OrderStatusDonut';
import { NewCustomersChart } from '@/components/dashboard/NewCustomersChart';

/** Mirrors REPORT_READ in the backend (common/report-roles.ts), normalized like the sidebar does. */
const REPORT_ROLES = ['SUPERADMIN', 'ADMIN', 'STOREMANAGER', 'ACCOUNTANT', 'FINANCEMANAGER'];
const FACILITY_PICKER_ROLES = ['SUPERADMIN', 'ADMIN'];
const FINANCE_ROLES = ['ACCOUNTANT', 'FINANCEMANAGER'];

const normalizeRole = (role?: string) => (role || '').toUpperCase().replace(/[\s_-]/g, '');

interface QuickLink { href: string; label: string; icon: React.ReactNode }

function quickLinks(role: string): QuickLink[] {
  if (FINANCE_ROLES.includes(role)) {
    return [
      { href: '/admin/orders', label: 'Order payments', icon: <ShoppingOutlined /> },
      { href: '/admin/logistics/cod', label: 'COD reconciliation', icon: <CarOutlined /> },
    ];
  }
  return [
    { href: '/admin/categories', label: 'Categories', icon: <AppstoreOutlined /> },
    { href: '/admin/products', label: 'Medicines catalog', icon: <MedicineBoxOutlined /> },
    { href: '/admin/orders', label: 'Orders', icon: <ShoppingOutlined /> },
    ...(role === 'SUPERADMIN' ? [{ href: '/admin/staff', label: 'Staff & RBAC', icon: <TeamOutlined /> }] : []),
    { href: '/admin/customers', label: 'Customers', icon: <UserOutlined /> },
  ];
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const mounted = useHydrated();
  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;
  const role = normalizeRole(user?.role);
  const canReport = REPORT_ROLES.includes(role);

  const [range, setRange] = useState<DashboardRange>(initialDashboardRange);
  const [granularity, setGranularity] = useState<Granularity>('day');

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const dayDisabled = rangeDays(range.from, range.to) > MAX_DAILY_DAYS;
  const effectiveGranularity: Granularity = dayDisabled ? 'month' : granularity;
  const enabled = Boolean(mounted && isAuthenticated && user && canReport);

  const { from, to, facilityId } = range;
  const loadOverview = useCallback(() => {
    const query: ReportRange = { from, to, facilityId };
    return reportService.overview(query).then(res => res.data);
  }, [from, to, facilityId]);
  const loadSeries = useCallback(
    () => reportService.revenue({ from, to, facilityId }, effectiveGranularity).then(res => res.data),
    [from, to, facilityId, effectiveGranularity],
  );
  const loadStatus = useCallback(
    () => reportService.orderStatus({ from, to, facilityId }).then(res => res.data),
    [from, to, facilityId],
  );

  const overview = useReport(loadOverview, enabled);
  const series = useReport(loadSeries, enabled);
  const status = useReport(loadStatus, enabled);

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  const links = quickLinks(role);
  const current = overview.data?.current;
  const previous = overview.data?.previous;
  const buckets = series.data?.buckets ?? [];
  const kpis = [
    { title: 'Revenue', key: 'revenue', format: formatVnd, spark: buckets.map(b => b.revenue), color: '#1e4287' },
    { title: 'Collected cash', key: 'collectedCash', format: formatVnd, spark: undefined, color: '#059669' },
    { title: 'Orders', key: 'orders', format: formatCount, spark: buckets.map(b => b.orders), color: '#f59e0b' },
    { title: 'New customers', key: 'newCustomers', format: formatCount, spark: buckets.map(b => b.newCustomers), color: '#0d9488' },
    { title: 'Avg order value', key: 'avgOrderValue', format: formatVnd, spark: undefined, color: '#6366f1' },
  ] as const;

  return (
    <div className="space-y-4 animate-fade-in font-sans w-full min-w-0">
      {/* Header + filter bar */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 text-xs m-0 mt-0.5">Sales performance for the selected period</p>
        </div>
        {canReport && (
          <DateRangeFilter value={range} onChange={setRange} showFacility={FACILITY_PICKER_ROLES.includes(role)} />
        )}
      </div>

      {canReport ? (
        <>
          {overview.error && (
            <div className="flex flex-wrap items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded-[6px] px-3 py-2">
              <span>{overview.error}</span>
              <button type="button" onClick={overview.reload} className="underline bg-transparent border-none text-red-600 cursor-pointer p-0">
                Retry
              </button>
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {kpis.map(kpi => (
              <KpiCard
                key={kpi.key}
                title={kpi.title}
                value={kpi.format(current?.[kpi.key] ?? 0)}
                current={current?.[kpi.key] ?? 0}
                previous={previous?.[kpi.key] ?? 0}
                spark={series.loading ? undefined : kpi.spark}
                loading={overview.loading}
                color={kpi.color}
              />
            ))}
          </div>

          {/* Revenue (2/3) + order status (1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <RevenueChart
              buckets={buckets}
              granularity={effectiveGranularity}
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
              granularity={effectiveGranularity}
              loading={series.loading}
              error={series.error}
              onRetry={series.reload}
            />
            {/* Stock alerts panel slot (PR 2): render <StockAlertsPanel /> here for non-finance roles and switch this row to lg:grid-cols-2. */}
          </div>

          {/* Finance summary slot (PR 3): AR / AP / cashbook summary for finance roles and admins. */}
        </>
      ) : (
        <div className="flex items-start gap-2 bg-white border border-slate-200/80 rounded-[6px] p-4 text-xs text-slate-500">
          <InfoCircleOutlined className="text-slate-400 mt-0.5" />
          <span>Sales reports are available to managers, administrators and finance staff.</span>
        </div>
      )}

      {/* Quick links */}
      <nav aria-label="Quick links" className="flex flex-wrap gap-2 pt-1">
        {links.map(link => (
          <button
            key={link.href}
            type="button"
            onClick={() => router.push(link.href)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-white border border-slate-200/80 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors cursor-pointer"
          >
            {link.icon}
            {link.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
