'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Layout, Menu, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { DashboardOutlined, ShoppingOutlined, SwapOutlined, CarOutlined, RollbackOutlined } from '@ant-design/icons';
import { LogOut, User, Warehouse } from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole } from '@/utils';

const { Sider, Header, Content } = Layout;

export const WAREHOUSE_PORTAL_ROLES = ['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'FACTORY_WAREHOUSE_STAFF', 'SUPER_ADMIN'];

const NAV_ITEMS = [
  { key: '/warehouse', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/warehouse/orders', icon: <ShoppingOutlined />, label: 'Orders' },
  { key: '/warehouse/transfers', icon: <SwapOutlined />, label: 'Transfers' },
  { key: '/warehouse/shipments', icon: <CarOutlined />, label: 'Shipments' },
  { key: '/warehouse/returns', icon: <RollbackOutlined />, label: 'Returns' },
];

export function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useHydrated();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

  const user = mounted && getIsAuthenticated() ? getUser() : null;
  const allowed = !!user && WAREHOUSE_PORTAL_ROLES.includes(user.role);

  useEffect(() => {
    if (mounted && !allowed) router.replace('/warehouse/login');
  }, [mounted, allowed, router]);

  if (!allowed) return null;

  const selectedKey = NAV_ITEMS.filter((item) => item.key === '/warehouse' ? pathname === item.key : pathname.startsWith(item.key))
    .at(-1)?.key ?? '';

  const userMenu: MenuProps['items'] = [
    { key: 'profile', icon: <User className="w-4 h-4" />, label: 'My Profile', onClick: () => router.push('/warehouse/profile') },
    { type: 'divider' },
    { key: 'logout', icon: <LogOut className="w-4 h-4" />, label: 'Logout', danger: true, onClick: () => logout() },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" breakpoint="lg" collapsedWidth={0} width={220} className="border-r border-slate-100">
        <div className="flex items-center gap-2 h-16 px-5 border-b border-slate-100 font-bold text-[#1e4287]">
          <Warehouse className="w-5 h-5" /> Warehouse Portal
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={NAV_ITEMS} onClick={({ key }) => router.push(key)} className="border-r-0!" />
      </Sider>
      <Layout>
        <Header className="bg-white! border-b border-slate-100 flex items-center justify-between px-6! gap-4">
          <span className="text-sm font-semibold text-slate-600 truncate">{user.facility?.name ?? 'No warehouse assigned'}</span>
          <Dropdown menu={{ items: userMenu }} trigger={['click']} placement="bottomRight">
            <button className="text-right leading-tight border-none bg-transparent cursor-pointer">
              <div className="text-sm font-semibold text-slate-800">{user.fullName}</div>
              <div className="text-xs text-slate-500">{formatRole(user.role)}</div>
            </button>
          </Dropdown>
        </Header>
        <Content className="p-4 sm:p-6 bg-slate-50">{children}</Content>
      </Layout>
    </Layout>
  );
}
