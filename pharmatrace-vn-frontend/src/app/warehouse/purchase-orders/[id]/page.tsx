'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DownOutlined } from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Dropdown, Input, Modal, Spin, Table, Timeline } from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GoodsReceiptForm } from '@/components/procurement/GoodsReceiptForm';
import { ShipmentReceiptForm } from '@/components/procurement/ShipmentReceiptForm';
import { PurchaseOrderStatusTag, supplierName } from '@/components/procurement/PurchaseOrderStatusTag';
import { ShipOrderForm } from '@/components/procurement/ShipOrderForm';
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
  const [ending, setEnding] = useState<'cancel' | 'close' | 'reject'>();
  const [reason, setReason] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const getUser = useAuthStore(state => state.getUser);
  const role = useHydrated() ? String(getUser()?.role ?? '') : '';
  const manager = role === 'WAREHOUSE_MANAGER' || role === 'SUPER_ADMIN';
  const supplierStaff = role === 'FACTORY_WAREHOUSE_STAFF';

  const load = useCallback(() => purchaseOrderService.detail(id).then(res => setOrder(res.data)).catch(() => setError(true)), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      message.success(done);
      setEnding(undefined);
      await load();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not update the purchase order.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const menuItems: MenuProps['items'] = [];
  if (manager && order?.status === 'PENDING') {
    menuItems.push(
      { key: 'edit', label: 'Edit', onClick: () => router.push(`/warehouse/purchase-orders/${id}/edit`) },
      { key: 'approve', label: 'Approve', onClick: () => run(() => purchaseOrderService.approve(id), 'Purchase order approved') },
    );
  }
  if (manager && (order?.status === 'PENDING' || order?.status === 'APPROVED' || order?.status === 'SHIPPED')) {
    menuItems.push({ key: 'cancel', label: 'Cancel order', danger: true, onClick: () => { setReason(''); setEnding('cancel'); } });
  }
  if (manager && order?.status === 'PARTIALLY_RECEIVED') {
    menuItems.push({ key: 'close', label: 'Close short order', danger: true, onClick: () => { setReason(''); setEnding('close'); } });
  }

  if (error) return <Alert type="error" showIcon title="We could not load this purchase order." />;
  if (!order) return <Spin />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="m-0 text-lg font-bold text-slate-900">{order.po_code} <PurchaseOrderStatusTag status={order.status} /></h1>
        {menuItems.length > 0 && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button loading={busy}>Actions <DownOutlined /></Button>
          </Dropdown>
        )}
      </div>

      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Supplier">{supplierName(order)}{order.supplier ? ' (our factory)' : ' (outside manufacturer)'}</Descriptions.Item>
        <Descriptions.Item label="Receiving warehouse">{order.facility?.facility_name ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Total">{formatCurrency(order.total_amount)}</Descriptions.Item>
        <Descriptions.Item label="Expected delivery">{order.expected_at?.slice(0, 10) ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Created by">{order.employees?.full_name ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Approved by">{order.approved_by ? `${order.approved_by.full_name}, ${formatTime(order.approved_at ?? '')}` : '-'}</Descriptions.Item>
        {order.note && <Descriptions.Item label="Note" span="filled">{order.note}</Descriptions.Item>}
        {order.cancel_reason && <Descriptions.Item label="Cancel reason" span="filled">{order.cancel_reason}</Descriptions.Item>}
        {order.closed_reason && <Descriptions.Item label="Closed reason" span="filled">{order.closed_reason}</Descriptions.Item>}
        {order.rejected_reason && <Descriptions.Item label="Rejected by supplier" span="filled">{order.rejected_reason}</Descriptions.Item>}
      </Descriptions>

      {/* The supplying factory answers an approved order: ship it or reject it. */}
      {supplierStaff && order.status === 'APPROVED' && (
        <Alert
          type="info"
          showIcon
          title="This warehouse is waiting for your answer."
          description="Scan the boxes you send for every line (they are reserved for this order), or reject the order with a reason. The warehouse can receive the goods only after you ship."
          action={(
            <div className="flex gap-2">
              <Button type="primary" onClick={() => setShipping(open => !open)}>{shipping ? 'Hide shipment' : 'Ship order'}</Button>
              <Button danger onClick={() => { setReason(''); setEnding('reject'); }}>Reject order</Button>
            </div>
          )}
        />
      )}
      {supplierStaff && order.status === 'APPROVED' && shipping && <ShipOrderForm order={order} onShipped={() => { setShipping(false); void load(); }} />}

      <Table rowKey="id" dataSource={order.purchase_order_items} columns={COLUMNS} pagination={false} scroll={{ x: 640 }} />

      {/* A factory supplier must ship first; a manufacturer has no account here, so its approved order is receivable. */}
      {!supplierStaff && (order.status === 'SHIPPED' || order.status === 'PARTIALLY_RECEIVED' || (order.status === 'APPROVED' && !order.supplier)) && (receiving
        ? (order.supplier ? <ShipmentReceiptForm order={order} /> : <GoodsReceiptForm order={order} />)
        : <Button type="primary" className="self-start" onClick={() => setReceiving(true)}>Receive goods</Button>)}

      {order.goods_receipts.length > 0 && (
        <>
          <h2 className="text-base font-semibold text-slate-900">Goods receipts</h2>
          <ul className="m-0 list-none space-y-1 p-0 text-sm">
            {order.goods_receipts.map(receipt => (
              <li key={receipt.id}>
                <Link href={`/warehouse/purchase-orders/${id}/receipts/${receipt.id}`}>{receipt.receipt_code}</Link>
                {` · ${formatTime(receipt.received_at)} · ${receipt.received_by.full_name} · ${receipt._count.goods_receipt_lines} line(s)`}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="text-base font-semibold text-slate-900">History</h2>
      <Timeline
        items={order.purchase_order_events.map(event => ({
          title: formatTime(event.created_at),
          content: `${event.action.replace(/_/g, ' ')} by ${event.actor.full_name}${event.note ? `: ${event.note}` : ''}`,
        }))}
      />

      <Modal
        open={!!ending}
        title={`${{ close: 'Close', reject: 'Reject', cancel: 'Cancel' }[ending ?? 'cancel']} ${order.po_code}`}
        okText={{ close: 'Close order', reject: 'Reject order', cancel: 'Cancel order' }[ending ?? 'cancel']}
        cancelText="Keep order"
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: busy }}
        onOk={() => ending === 'close'
          ? run(() => purchaseOrderService.close(id, reason.trim()), 'Purchase order closed')
          : ending === 'reject'
            ? run(() => purchaseOrderService.reject(id, reason.trim()), 'Purchase order rejected')
            : run(() => purchaseOrderService.cancel(id, reason.trim()), 'Purchase order cancelled')}
        onCancel={() => setEnding(undefined)}
      >
        <Input.TextArea aria-label="Reason" placeholder="Reason (required)" maxLength={500} showCount rows={3} value={reason} onChange={event => setReason(event.target.value)} />
      </Modal>
    </div>
  );
}
