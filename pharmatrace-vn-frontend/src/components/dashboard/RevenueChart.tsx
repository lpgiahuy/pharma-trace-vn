'use client';

import React from 'react';
import { Segmented, Tooltip as AntTooltip } from 'antd';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Granularity, RevenueBucket } from '@/types/report.types';
import { bucketLabel, formatCompact, formatCount, formatVnd } from '@/utils/report-format';
import { ChartCard } from './ChartCard';

interface RevenueChartProps {
  buckets: RevenueBucket[];
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  /** Daily series are capped by the API, so long ranges are monthly only. */
  dayDisabled: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function GranularityToggle({ value, onChange, dayDisabled }: {
  value: Granularity; onChange: (value: Granularity) => void; dayDisabled: boolean;
}) {
  return (
    <AntTooltip title={dayDisabled ? 'Daily view covers at most 366 days' : undefined}>
      <Segmented<Granularity>
        size="small"
        value={value}
        onChange={onChange}
        options={[
          { label: 'Day', value: 'day', disabled: dayDisabled },
          { label: 'Month', value: 'month' },
        ]}
      />
    </AntTooltip>
  );
}

export function RevenueChart({ buckets, granularity, onGranularityChange, dayDisabled, loading, error, onRetry }: RevenueChartProps) {
  const data = buckets.map(b => ({ ...b, label: bucketLabel(b.bucket, granularity) }));
  const empty = buckets.every(b => b.revenue === 0 && b.orders === 0);

  return (
    <ChartCard
      title="Revenue & orders"
      subtitle="Delivered and completed orders, net of refunds"
      extra={<GranularityToggle value={granularity} onChange={onGranularityChange} dayDisabled={dayDisabled} />}
      loading={loading}
      error={error}
      empty={empty}
      onRetry={onRetry}
      height={300}
      className="lg:col-span-2"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis yAxisId="revenue" tickFormatter={v => formatCompact(Number(v))} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="orders" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={32} />
          <Tooltip
            formatter={(value, name) => (name === 'Orders' ? formatCount(Number(value)) : formatVnd(Number(value)))}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="revenue" dataKey="revenue" name="Revenue" fill="#1e4287" radius={[3, 3, 0, 0]} maxBarSize={32} />
          <Line yAxisId="orders" dataKey="orders" name="Orders" type="monotone" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
