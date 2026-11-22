'use client';

import React from 'react';
import { Skeleton } from 'antd';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { percentChange } from '@/utils/report-format';

interface KpiCardProps {
  title: string;
  value: string;
  current: number;
  previous: number;
  /** Optional trend points for the sparkline, oldest first. */
  spark?: number[];
  loading?: boolean;
  color?: string;
}

export function KpiCard({ title, value, current, previous, spark, loading = false, color = '#1e4287' }: KpiCardProps) {
  const change = percentChange(current, previous);
  const gradientId = `kpi-${title.replace(/\W/g, '')}`;

  return (
    <div className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0 flex flex-col">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide m-0">{title}</p>
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: '70%' }} className="mt-2" />
      ) : (
        <>
          <p className="text-lg font-bold text-slate-900 m-0 mt-1 truncate" title={value}>{value}</p>
          <p className="text-[11px] m-0 mt-0.5">
            {change === null ? (
              <span className="text-slate-400">No data in previous period</span>
            ) : (
              <>
                <span className={change >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
                </span>
                <span className="text-slate-400"> vs previous period</span>
              </>
            )}
          </p>
          <div className="h-8 mt-2">
            {spark && spark.length > 1 && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
