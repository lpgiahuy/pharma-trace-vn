import { OrderDetail } from '@/components/orders/OrderDetail';

export default async function WarehouseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrderDetail portal="warehouse" orderId={Number((await params).id)} />;
}
