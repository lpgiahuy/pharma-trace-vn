'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { WarehouseLayout } from '@/components/layout/WarehouseLayout';

export default function WarehouseRootLayout({ children }: { children: React.ReactNode }) {
  if (usePathname() === '/warehouse/login') return <>{children}</>;
  return <WarehouseLayout>{children}</WarehouseLayout>;
}
