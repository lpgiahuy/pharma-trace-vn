'use client';

import React from 'react';
import Link from 'next/link';
import { Skeleton } from 'antd';

interface FinanceStatCardProps {
  title: string;
  value: string;
  hint?: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  loading: boolean;
  href?: string;
}

const TONES = {
  default: 'text-slate-900',
  positive: 'text-emerald-600',
  negative: 'text-red-600',
  warning: 'text-amber-600',
} as const;

export function FinanceStatCard({ title, value, hint, tone = 'default', loading, href }: FinanceStatCardProps) {
  const card = (
    <div className={`bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0 h-full ${href ? 'hover:border-slate-300 transition-colors' : ''}`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide m-0">{title}</p>
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} className="mt-2" />
      ) : (
        <>
          <p className={`text-lg font-bold m-0 mt-1 truncate tabular-nums ${TONES[tone]}`}>{value}</p>
          {hint && <p className="text-[11px] text-slate-400 m-0 mt-0.5">{hint}</p>}
        </>
      )}
    </div>
  );
  return href ? <Link href={href} className="block min-w-0">{card}</Link> : card;
}
