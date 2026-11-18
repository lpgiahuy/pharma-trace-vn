'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, App, Button, Descriptions, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { purchaseOrderService, type GoodsReceiptDetail } from '@/services/purchaseOrder.service';
import { formatCurrency, formatDate, formatDateTime } from '@/utils';

type Line = GoodsReceiptDetail['goods_receipt_lines'][number];

const COLUMNS: ColumnsType<Line> = [
  { title: 'Medicine', render: (_, line) => line.purchase_order_items.medicines.medicine_name },
  { title: 'Unit', render: (_, line) => line.purchase_order_items.packaging_variants?.unit_name ?? '-' },
  { title: 'Batch', render: (_, line) => line.batches.batch_number },
  { title: 'MFG', render: (_, line) => formatDate(line.batches.production_date) },
  { title: 'EXP', render: (_, line) => formatDate(line.batches.expiry_date) },
  { title: 'Accepted', dataIndex: 'quantity_accepted', align: 'right' },
  { title: 'Rejected', dataIndex: 'quantity_rejected', align: 'right' },
  { title: 'Reject reason', render: (_, line) => line.reject_reason ?? '-' },
];

const boxList = (title: string, list: string[]) => list.length > 0 && (
  <div>
    <p className="m-0 text-xs font-medium text-slate-700">{title}</p>
    <p className="m-0 break-all font-mono text-xs text-slate-600">{list.join(', ')}</p>
  </div>
);

export default function GoodsReceiptDetailPage() {
  const params = useParams<{ id: string; receiptId: string }>();
  const poId = Number(params.id);
  const receiptId = Number(params.receiptId);
  const { message } = App.useApp();
  const [receipt, setReceipt] = useState<GoodsReceiptDetail>();
  const [error, setError] = useState(false);

  useEffect(() => {
    purchaseOrderService.receipt(poId, receiptId).then(res => setReceipt(res.data)).catch(() => setError(true));
  }, [poId, receiptId]);

  const view = (attachmentId: number) => purchaseOrderService.attachment(poId, receiptId, attachmentId)
    .then(blob => window.open(URL.createObjectURL(blob), '_blank'))
    .catch(() => message.error('We could not load this file.'));

  if (error) return <Alert type="error" showIcon title="We could not load this goods receipt." />;
  if (!receipt) return <Spin />;

  const batchName = (batchId: number | null) => receipt.goods_receipt_lines.find(line => line.batches.id === batchId)?.batches.batch_number;

  return (
    <div className="space-y-4">
      <h1 className="m-0 text-lg font-bold text-slate-900">{receipt.receipt_code}</h1>

      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Purchase order">
          <Link href={`/warehouse/purchase-orders/${poId}`}>{receipt.purchase_orders.po_code}</Link>
        </Descriptions.Item>
        <Descriptions.Item label="Received">{`${receipt.received_by?.full_name ?? '-'}, ${formatDateTime(receipt.received_at)}`}</Descriptions.Item>
        <Descriptions.Item label="Payable">
          {receipt.accounts_payable ? `${formatCurrency(receipt.accounts_payable.total_due_amount)} (${receipt.accounts_payable.status ?? '-'})` : '-'}
        </Descriptions.Item>
        {receipt.note && <Descriptions.Item label="Note" span="filled">{receipt.note}</Descriptions.Item>}
      </Descriptions>

      <Table
        rowKey="id"
        dataSource={receipt.goods_receipt_lines}
        columns={COLUMNS}
        pagination={false}
        scroll={{ x: 800 }}
        expandable={{
          expandedRowRender: line => (
            <div className="space-y-2">
              {boxList('Accepted boxes', line.box_uids)}
              {boxList('Rejected boxes', line.rejected_box_uids)}
            </div>
          ),
        }}
      />

      {receipt.goods_receipt_attachments.length > 0 && (
        <>
          <h2 className="text-base font-semibold text-slate-900">Attachments</h2>
          <ul className="m-0 list-none space-y-1 p-0 text-sm">
            {receipt.goods_receipt_attachments.map(attachment => (
              <li key={attachment.id} className="flex flex-wrap items-center gap-2">
                <Button size="small" onClick={() => view(attachment.id)}>View</Button>
                {attachment.kind === 'CO_CQ' ? 'CO/CQ' : attachment.kind.replace(/_/g, ' ')}
                {attachment.batch_id && ` · batch ${batchName(attachment.batch_id) ?? attachment.batch_id}`}
                {` · ${attachment.uploaded_by?.full_name ?? '-'}, ${formatDateTime(attachment.created_at)}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
