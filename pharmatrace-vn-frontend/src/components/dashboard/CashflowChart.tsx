'use client';

import React from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketLabel, formatCompact, formatVnd } from '@/utils/report-format';
import type { CashflowPoint } from '@/utils/finance-report';
import { ChartCard } from './ChartCard';

interface CashflowChartProps {
  points: CashflowPoint[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}

const tick = { fontSize: 11, fill: '#64748b' };

/** Daily income and expense bars with the running balance as a line on the right axis. */
export function CashflowChart({ points, loading, error, onRetry, className }: CashflowChartProps) {
  const data = points.map(point => ({ ...point, label: bucketLabel(point.day, 'day') }));

  return (
    <ChartCard
      title="Cash flow"
      loading={loading}
      error={error}
      empty={points.length === 0}
      onRetry={onRetry}
      height={300}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis yAxisId="flow" tickFormatter={value => formatCompact(Number(value))} tick={tick} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="balance" orientation="right" tickFormatter={value => formatCompact(Number(value))} tick={tick} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={value => formatVnd(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="flow" dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={24} />
          <Bar yAxisId="flow" dataKey="expense" name="Expense" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={24} />
          <Line yAxisId="balance" dataKey="balance" name="Balance" type="monotone" stroke="#1e4287" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
