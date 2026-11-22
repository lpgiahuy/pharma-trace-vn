'use client';

import React from 'react';
import { Segmented } from 'antd';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Granularity, RevenueBucket } from '@/types/report.types';
import { bucketLabel, formatCompact, formatCount, formatVnd } from '@/utils/report-format';
import { ChartCard } from './ChartCard';

interface RevenueChartProps {
  buckets: RevenueBucket[];
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  dayDisabled: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const tick = { fontSize: 11, fill: '#64748b' };

export function RevenueChart({ buckets, granularity, onGranularityChange, dayDisabled, loading, error, onRetry }: RevenueChartProps) {
  const data = buckets.map(b => ({ ...b, label: bucketLabel(b.bucket, granularity) }));

  return (
    <ChartCard
      title="Revenue & orders"
      extra={
        <Segmented<Granularity>
          size="small"
          value={granularity}
          onChange={onGranularityChange}
          options={[{ label: 'Day', value: 'day', disabled: dayDisabled }, { label: 'Month', value: 'month' }]}
        />
      }
      loading={loading}
      error={error}
      empty={buckets.every(b => b.revenue === 0 && b.orders === 0)}
      onRetry={onRetry}
      height={300}
      className="lg:col-span-2"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis yAxisId="revenue" tickFormatter={v => formatCompact(Number(v))} tick={tick} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="orders" orientation="right" allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={32} />
          <Tooltip formatter={(value, name) => (name === 'Orders' ? formatCount(Number(value)) : formatVnd(Number(value)))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="revenue" dataKey="revenue" name="Revenue" fill="#1e4287" radius={[3, 3, 0, 0]} maxBarSize={32} />
          <Line yAxisId="orders" dataKey="orders" name="Orders" type="monotone" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
