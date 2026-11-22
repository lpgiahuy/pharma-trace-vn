'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatVnd } from '@/utils/report-format';
import type { AgingChartData } from '@/utils/finance-report';
import { ChartCard } from './ChartCard';

interface AgingChartProps {
  title: string;
  data: AgingChartData;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}

const COLORS = ['#1e4287', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#94a3b8'];
const tick = { fontSize: 11, fill: '#64748b' };

/** Debt per age bucket, stacked by party (courier or supplier). Shared by receivables and payables. */
export function AgingChart({ title, data, loading, error, onRetry, className }: AgingChartProps) {
  const empty = data.parties.length === 0 || data.rows.every(row => data.parties.every(party => Number(row[party]) === 0));

  return (
    <ChartCard title={title} loading={loading} error={error} empty={empty} onRetry={onRetry} height={300} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="bucket" tick={tick} tickLine={false} axisLine={false} interval={0} />
          <YAxis tickFormatter={value => formatCompact(Number(value))} tick={tick} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={value => formatVnd(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data.parties.map((party, index) => (
            <Bar
              key={party}
              dataKey={party}
              stackId="debt"
              fill={COLORS[index % COLORS.length]}
              maxBarSize={56}
              radius={index === data.parties.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
