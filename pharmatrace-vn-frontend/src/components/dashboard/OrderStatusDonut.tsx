'use client';

import React from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { OrderStatusRow } from '@/types/report.types';
import { formatCount } from '@/utils/report-format';
import { ChartCard } from './ChartCard';

const COLORS = ['#1e4287', '#059669', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#94a3b8', '#ec4899', '#84cc16'];

interface OrderStatusDonutProps {
  statuses: OrderStatusRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function OrderStatusDonut({ statuses, loading, error, onRetry }: OrderStatusDonutProps) {
  const data = statuses.map(s => ({ ...s, label: s.status.replace(/_/g, ' ').toLowerCase() }));

  return (
    <ChartCard title="Orders by status" loading={loading} error={error} empty={statuses.length === 0} onRetry={onRetry} height={300}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="label" innerRadius="50%" outerRadius="75%" stroke="none">
            {data.map((d, i) => <Cell key={d.status} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={value => formatCount(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 11, textTransform: 'capitalize' }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
