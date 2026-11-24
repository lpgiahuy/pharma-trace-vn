'use client';

import React, { useCallback } from 'react';
import { Drawer, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useReport } from '@/hooks/useReport';
import { reportService } from '@/services/report.service';
import type { SupplierPayment } from '@/types/report.types';
import { formatVietnamDateTime, paymentMethodLabel } from '@/utils/finance-report';
import { formatVnd } from '@/utils/report-format';

interface PaymentHistoryDrawerProps {
  payableId: number;
  title: string;
  onClose: () => void;
}

const columns: ColumnsType<SupplierPayment> = [
  { title: 'Date', dataIndex: 'paidAt', key: 'date', render: (value: string) => formatVietnamDateTime(value) },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (value: number) => <span className="tabular-nums font-semibold text-slate-900">{formatVnd(value)}</span> },
  { title: 'Method', dataIndex: 'paymentMethod', key: 'method', render: (value: string) => paymentMethodLabel(value) },
  { title: 'Reference', dataIndex: 'reference', key: 'reference' },
  { title: 'Paid by', dataIndex: 'paidBy', key: 'paidBy' },
  { title: 'Cashbook', dataIndex: 'cashbookCode', key: 'cashbook', render: (value: string) => <span className="font-mono text-slate-700">{value}</span> },
];

export function PaymentHistoryDrawer({ payableId, title, onClose }: PaymentHistoryDrawerProps) {
  const history = useReport(useCallback(() => reportService.payablePayments(payableId).then(res => res.data), [payableId]), true);

  return (
    <Drawer open title={title} size={640} onClose={onClose}>
      <Table<SupplierPayment>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={history.data ?? []}
        loading={history.loading}
        scroll={{ x: 'max-content' }}
        pagination={false}
        locale={{ emptyText: history.error ?? 'No payments recorded yet' }}
      />
    </Drawer>
  );
}
