import { OrderList } from '@/components/orders/OrderList';
import { PackingQueue } from '@/components/orders/PackingQueue';

export default function WarehouseOrdersPage() {
  return (
    <div className="space-y-8">
      <PackingQueue />
      <OrderList portal="warehouse" />
    </div>
  );
}
