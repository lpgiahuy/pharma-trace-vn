'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Card, Spin, Statistic } from 'antd';
import { warehouseService, type WarehouseDashboard } from '@/services/warehouse.service';

const CARDS: { key: keyof WarehouseDashboard; title: string; href: string }[] = [
  { key: 'stockUnits', title: 'Units in stock', href: '/warehouse/inventory' },
  { key: 'availableUnits', title: 'Available units', href: '/warehouse/inventory' },
  { key: 'quarantineUnits', title: 'Units in quarantine', href: '/warehouse/inventory' },
  { key: 'expiringBatches', title: 'Batches expiring within 30 days', href: '/warehouse/batches?tab=expiring' },
  { key: 'pendingTransfers', title: 'Transfers awaiting dispatch', href: '/warehouse/transfers' },
  { key: 'ordersToPack', title: 'Orders awaiting packing', href: '/warehouse/orders' },
];

export default function WarehouseDashboardPage() {
  const [data, setData] = useState<WarehouseDashboard>();
  const [error, setError] = useState(false);

  useEffect(() => {
    warehouseService.dashboard().then(res => setData(res.data)).catch(() => setError(true));
  }, []);

  if (error) return <Alert type="error" showIcon title="We could not load the dashboard. Please try again." />;
  if (!data) return <Spin />;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.filter(card => data[card.key] !== null).map(card => (
        <Link key={card.key} href={card.href}>
          <Card hoverable className="shadow-sm rounded-xl">
            <Statistic title={card.title} value={data[card.key] ?? 0} />
          </Card>
        </Link>
      ))}
    </div>
  );
}
