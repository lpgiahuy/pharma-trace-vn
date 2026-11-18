'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert, Spin } from 'antd';
import { PurchaseOrderForm } from '@/components/procurement/PurchaseOrderForm';
import { purchaseOrderService, type PurchaseOrderDetail } from '@/services/purchaseOrder.service';

export default function EditPurchaseOrderPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [order, setOrder] = useState<PurchaseOrderDetail>();
  const [error, setError] = useState(false);

  useEffect(() => {
    purchaseOrderService.detail(id).then(res => setOrder(res.data)).catch(() => setError(true));
  }, [id]);

  if (error) return <Alert type="error" showIcon title="We could not load this purchase order." />;
  if (!order) return <Spin />;
  if (order.status !== 'PENDING') return <Alert type="warning" showIcon title="Only pending purchase orders can be edited." />;
  return <PurchaseOrderForm order={order} />;
}
