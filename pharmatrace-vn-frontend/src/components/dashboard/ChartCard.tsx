'use client';

import React from 'react';
import { Button, Empty, Skeleton } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  /** Height of the body area so the card does not jump between states. */
  height?: number;
  className?: string;
  children?: React.ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  extra,
  loading = false,
  error = null,
  empty = false,
  emptyText = 'No data for this range',
  onRetry,
  height = 280,
  className = '',
  children,
}: ChartCardProps) {
  let body: React.ReactNode = children;
  if (loading) {
    body = <Skeleton active paragraph={{ rows: 6 }} title={false} />;
  } else if (error) {
    body = (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
        <WarningOutlined className="text-2xl text-red-400" />
        <p className="text-xs text-slate-500 m-0">{error}</p>
        {onRetry && (
          <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  } else if (empty) {
    body = (
      <div className="h-full flex items-center justify-center">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-slate-400">{emptyText}</span>} />
      </div>
    );
  }

  return (
    <section className={`bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 m-0">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-400 m-0 mt-0.5">{subtitle}</p>}
        </div>
        {extra}
      </header>
      <div style={{ height }}>{body}</div>
    </section>
  );
}
