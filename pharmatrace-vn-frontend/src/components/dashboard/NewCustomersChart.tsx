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
}

const tick = { fontSize: 11, fill: '#64748b' };

export function NewCustomersChart({ buckets, granularity, loading, error, onRetry }: NewCustomersChartProps) {
  const data = buckets.map(b => ({ label: bucketLabel(b.bucket, granularity), newCustomers: b.newCustomers }));

  return (
    <ChartCard
      title="New customers"
      loading={loading}
      error={error}
      empty={buckets.every(b => b.newCustomers === 0)}
      onRetry={onRetry}
      height={240}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={40} />
          <Tooltip formatter={value => formatCount(Number(value))} />
          <Bar dataKey="newCustomers" name="New customers" fill="#0d9488" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
