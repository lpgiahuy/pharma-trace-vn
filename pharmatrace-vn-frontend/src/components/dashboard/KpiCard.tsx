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
  spark?: number[];
  loading: boolean;
}

export function KpiCard({ title, value, current, previous, spark, loading }: KpiCardProps) {
  const change = percentChange(current, previous);

  return (
    <div className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide m-0">{title}</p>
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} className="mt-2" />
      ) : (
        <>
          <p className="text-lg font-bold text-slate-900 m-0 mt-1 truncate">{value}</p>
          <p className="text-[11px] text-slate-400 m-0 mt-0.5">
            {change === null ? 'No data in previous period' : (
              <>
                <span className={change >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
                </span>{' '}
                vs previous period
              </>
            )}
          </p>
          <div className="h-8 mt-2">
            {spark && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark.map(v => ({ v }))}>
                  <Area type="monotone" dataKey="v" stroke="#1e4287" fill="#1e4287" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
