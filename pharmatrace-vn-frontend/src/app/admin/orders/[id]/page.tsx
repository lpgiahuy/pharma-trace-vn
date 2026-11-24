import { OrderDetail } from '@/components/orders/OrderDetail';

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrderDetail portal="admin" orderId={Number((await params).id)} />;
}
