'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Granularity, RevenueBucket } from '@/types/report.types';
import { bucketLabel, formatCount } from '@/utils/report-format';
import { ChartCard } from './ChartCard';

interface NewCustomersChartProps {
  buckets: RevenueBucket[];
  granularity: Granularity;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}

export function NewCustomersChart({ buckets, granularity, loading, error, onRetry, className }: NewCustomersChartProps) {
  const data = buckets.map(b => ({ label: bucketLabel(b.bucket, granularity), newCustomers: b.newCustomers }));
  const empty = buckets.every(b => b.newCustomers === 0);

  return (
    <ChartCard
      title="New customers"
      subtitle={granularity === 'month' ? 'Accounts created per month' : 'Accounts created per day'}
      loading={loading}
      error={error}
      empty={empty}
      onRetry={onRetry}
      height={240}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={40} />
          <Tooltip formatter={value => formatCount(Number(value))} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Bar dataKey="newCustomers" name="New customers" fill="#0d9488" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
