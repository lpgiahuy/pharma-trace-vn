'use client';

import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { OrderStatusRow } from '@/types/report.types';
import { formatCount, formatVnd } from '@/utils/report-format';
import { ChartCard } from './ChartCard';

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: '#94a3b8' },
  WAITING_INTERNAL_TRANSFER: { label: 'Awaiting transfer', color: '#a78bfa' },
  PROCESSING: { label: 'Processing', color: '#60a5fa' },
  PENDING_PICKUP: { label: 'Pending pickup', color: '#38bdf8' },
  PICKED_UP: { label: 'Picked up', color: '#22d3ee' },
  SHIPPING: { label: 'Shipping', color: '#2563eb' },
  DELIVERED: { label: 'Delivered', color: '#34d399' },
  COMPLETED: { label: 'Completed', color: '#059669' },
  CANCELLED: { label: 'Cancelled', color: '#ef4444' },
  RETURNED: { label: 'Returned', color: '#f97316' },
  PARTIALLY_RETURNED: { label: 'Partially returned', color: '#fbbf24' },
};

const styleOf = (status: string) =>
  STATUS_STYLE[status] ?? { label: status.replace(/_/g, ' ').toLowerCase(), color: '#cbd5e1' };

interface OrderStatusDonutProps {
  statuses: OrderStatusRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function OrderStatusDonut({ statuses, loading, error, onRetry }: OrderStatusDonutProps) {
  const total = statuses.reduce((sum, s) => sum + s.count, 0);
  const cancelled = statuses.find(s => s.status === 'CANCELLED')?.count ?? 0;
  const data = statuses.filter(s => s.count > 0).map(s => ({ ...s, ...styleOf(s.status) }));

  return (
    <ChartCard
      title="Orders by status"
      subtitle={total > 0 ? `Cancellation rate ${((cancelled / total) * 100).toFixed(1)}%` : undefined}
      loading={loading}
      error={error}
      empty={total === 0}
      onRetry={onRetry}
      height={300}
    >
      <div className="h-full flex flex-col">
        <div className="relative flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius="58%" outerRadius="85%" paddingAngle={1} stroke="none">
                {data.map(d => <Cell key={d.status} fill={d.color} />)}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => {
                  const amount = (item?.payload as OrderStatusRow | undefined)?.amount ?? 0;
                  return `${formatCount(Number(value))} orders · ${formatVnd(amount)}`;
                }}
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-slate-900">{formatCount(total)}</span>
            <span className="text-[11px] text-slate-400">orders</span>
          </div>
        </div>
        <ul className="list-none m-0 p-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 max-h-20 overflow-y-auto">
          {data.map(d => (
            <li key={d.status} className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="truncate">{d.label}</span>
              <span className="ml-auto font-semibold text-slate-800">{formatCount(d.count)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
