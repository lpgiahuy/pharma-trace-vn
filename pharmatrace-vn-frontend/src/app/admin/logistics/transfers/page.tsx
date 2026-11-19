'use client';

import { Tabs } from 'antd';
import { TransfersBoard } from '@/components/logistics/TransfersBoard';
import { StockTransferRequests } from '@/components/logistics/StockTransferRequests';

export default function InternalTransfersPage() {
  return <Tabs items={[
    { key: 'transfers', label: 'Transfers', children: <TransfersBoard portal="admin" /> },
    { key: 'requests', label: 'Requests', children: <StockTransferRequests /> },
  ]} />;
}
