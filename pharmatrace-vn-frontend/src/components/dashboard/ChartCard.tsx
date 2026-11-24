'use client';

import React from 'react';
import { Button, Empty, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

interface ChartCardProps {
  title: string;
  extra?: React.ReactNode;
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  height: number;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, extra, loading, error, empty, onRetry, height, className = '', children }: ChartCardProps) {
  let body = children;
  if (loading) {
    body = <Skeleton active paragraph={{ rows: 6 }} title={false} />;
  } else if (error) {
    body = (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-xs text-slate-500 m-0">{error}</p>
        <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button>
      </div>
    );
  } else if (empty) {
    body = (
      <div className="h-full flex items-center justify-center">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data for this range" />
      </div>
    );
  }

  return (
    <section className={`bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0 ${className}`}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-slate-900 m-0">{title}</h2>
        {extra}
      </header>
      <div style={{ height }}>{body}</div>
    </section>
  );
}
