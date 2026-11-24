'use client';

import { Tabs } from 'antd';
import { TransfersBoard } from '@/components/logistics/TransfersBoard';
import { StockTransferRequests } from '@/components/logistics/StockTransferRequests';

export default function WarehouseTransfersPage() {
  return <Tabs items={[
    { key: 'transfers', label: 'Transfers', children: <TransfersBoard portal="warehouse" /> },
    { key: 'requests', label: 'Requests', children: <StockTransferRequests /> },
  ]} />;
}
