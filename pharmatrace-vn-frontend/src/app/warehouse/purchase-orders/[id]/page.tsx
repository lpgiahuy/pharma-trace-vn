'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Alert, App, Button, Descriptions, Input, Modal, Spin, Table, Timeline } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PurchaseOrderStatusTag, supplierName } from '@/components/procurement/PurchaseOrderStatusTag';
import { useHydrated } from '@/hooks/useHydrated';
import { purchaseOrderService, type PurchaseOrderDetail } from '@/services/purchaseOrder.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCurrency } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Line = PurchaseOrderDetail['purchase_order_items'][number];

const COLUMNS: ColumnsType<Line> = [
  { title: 'Medicine', render: (_, line) => line.medicines.medicine_name },
  { title: 'Unit', render: (_, line) => line.packaging_variants?.unit_name ?? '-' },
  { title: 'Ordered', dataIndex: 'quantity', align: 'right' },
  { title: 'Received', dataIndex: 'received_quantity', align: 'right' },
  { title: 'Unit price', dataIndex: 'unit_price', align: 'right', render: formatCurrency },
  { title: 'Total', dataIndex: 'total_price', align: 'right', render: formatCurrency },
];

const formatTime = (value: string) => new Date(value).toLocaleString();

export default function PurchaseOrderDetailPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { message } = App.useApp();
  const [order, setOrder] = useState<PurchaseOrderDetail>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const getUser = useAuthStore(state => state.getUser);
  const role = useHydrated() ? String(getUser()?.role ?? '') : '';
  const manager = role === 'WAREHOUSE_MANAGER' || role === 'SUPER_ADMIN';

  const load = useCallback(() => purchaseOrderService.detail(id).then(res => setOrder(res.data)).catch(() => setError(true)), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      message.success(done);
      setCancelling(false);
      await load();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not update the purchase order.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert type="error" showIcon title="We could not load this purchase order." />;
  if (!order) return <Spin />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="m-0 text-lg font-bold text-slate-900">{order.po_code} <PurchaseOrderStatusTag status={order.status} /></h1>
        {manager && (
          <div className="flex gap-2">
            {order.status === 'PENDING' && <Button onClick={() => router.push(`/warehouse/purchase-orders/${id}/edit`)}>Edit</Button>}
            {order.status === 'PENDING' && (
              <Button type="primary" loading={busy} onClick={() => run(() => purchaseOrderService.approve(id), 'Purchase order approved')}>Approve</Button>
            )}
            {(order.status === 'PENDING' || order.status === 'APPROVED') && (
              <Button danger onClick={() => { setReason(''); setCancelling(true); }}>Cancel order</Button>
            )}
          </div>
        )}
      </div>

      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Supplier">{supplierName(order)}</Descriptions.Item>
        <Descriptions.Item label="Receiving warehouse">{order.facility?.facility_name ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Total">{formatCurrency(order.total_amount)}</Descriptions.Item>
        <Descriptions.Item label="Expected delivery">{order.expected_at?.slice(0, 10) ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Created by">{order.employees?.full_name ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Approved by">{order.approved_by ? `${order.approved_by.full_name}, ${formatTime(order.approved_at ?? '')}` : '-'}</Descriptions.Item>
        {order.note && <Descriptions.Item label="Note" span="filled">{order.note}</Descriptions.Item>}
        {order.cancel_reason && <Descriptions.Item label="Cancel reason" span="filled">{order.cancel_reason}</Descriptions.Item>}
      </Descriptions>

      <Table rowKey="id" dataSource={order.purchase_order_items} columns={COLUMNS} pagination={false} scroll={{ x: 640 }} />

      <h2 className="text-base font-semibold text-slate-900">History</h2>
      <Timeline
        items={order.purchase_order_events.map(event => ({
          title: formatTime(event.created_at),
          content: `${event.action.replace(/_/g, ' ')} by ${event.actor.full_name}${event.note ? `: ${event.note}` : ''}`,
        }))}
      />

      <Modal
        open={cancelling}
        title={`Cancel ${order.po_code}`}
        okText="Cancel order"
        cancelText="Keep order"
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: busy }}
        onOk={() => run(() => purchaseOrderService.cancel(id, reason.trim()), 'Purchase order cancelled')}
        onCancel={() => setCancelling(false)}
      >
        <Input.TextArea aria-label="Reason" placeholder="Reason (required)" maxLength={500} showCount rows={3} value={reason} onChange={event => setReason(event.target.value)} />
      </Modal>
    </div>
  );
}
