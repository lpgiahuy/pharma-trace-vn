'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Layout, Menu, Dropdown, Grid } from 'antd';
import type { MenuProps } from 'antd';
import { AlertOutlined, DashboardOutlined, DatabaseOutlined, DeleteOutlined, ExperimentOutlined, FileTextOutlined, ShoppingOutlined, SwapOutlined, CarOutlined, SendOutlined, RollbackOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ScanOutlined } from '@ant-design/icons';
import { LogOut, User, Warehouse } from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole, getAvatarColor } from '@/utils';

const { Sider, Header, Content } = Layout;

export const WAREHOUSE_PORTAL_ROLES = ['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'FACTORY_WAREHOUSE_STAFF', 'SUPER_ADMIN'];

const NAV_ITEMS = [
  { key: '/warehouse', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/warehouse/inventory', icon: <DatabaseOutlined />, label: 'Inventory' },
  { key: '/warehouse/batches', icon: <ExperimentOutlined />, label: 'Batches' },
  { key: '/warehouse/purchase-orders', icon: <FileTextOutlined />, label: 'Purchase orders' },
  { key: '/warehouse/orders', icon: <ShoppingOutlined />, label: 'Orders' },
  { key: '/warehouse/handover', icon: <SendOutlined />, label: 'Handover' },
  { key: '/warehouse/transfers', icon: <SwapOutlined />, label: 'Transfers' },
  { key: '/warehouse/shipments', icon: <CarOutlined />, label: 'Shipments' },
  { key: '/warehouse/returns', icon: <RollbackOutlined />, label: 'Returns' },
  { key: '/warehouse/recalls', icon: <AlertOutlined />, label: 'Recalls' },
  { key: '/warehouse/disposals', icon: <DeleteOutlined />, label: 'Disposals' },
  { key: '/warehouse/traceability', icon: <ScanOutlined />, label: 'Traceability' },
];

const FACTORY_NAV_KEYS = ['/warehouse', '/warehouse/inventory', '/warehouse/batches', '/warehouse/transfers'];

export function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useHydrated();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = !Grid.useBreakpoint().md;

  const user = mounted && getIsAuthenticated() ? getUser() : null;
  const allowed = !!user && WAREHOUSE_PORTAL_ROLES.includes(user.role);

  useEffect(() => {
    if (mounted && !allowed) router.replace('/warehouse/login');
  }, [mounted, allowed, router]);

  if (!allowed) return null;

  const navItems = user.role === 'FACTORY_WAREHOUSE_STAFF' ? NAV_ITEMS.filter((item) => FACTORY_NAV_KEYS.includes(item.key)) : NAV_ITEMS;
  const selectedKey = navItems.filter((item) => item.key === '/warehouse' ? pathname === item.key : pathname.startsWith(item.key))
    .at(-1)?.key ?? '';

  const userMenu: MenuProps['items'] = [
    { key: 'profile', icon: <User className="w-4 h-4" />, label: 'My Profile', onClick: () => router.push('/warehouse/profile') },
    { type: 'divider' },
    { key: 'logout', icon: <LogOut className="w-4 h-4" />, label: 'Logout', danger: true, onClick: () => logout() },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" trigger={null} breakpoint="lg" onBreakpoint={setCollapsed} collapsed={collapsed} collapsedWidth={isMobile ? 0 : 80} width={220} className="border-r border-slate-100"
        style={isMobile ? { position: 'fixed', height: '100vh', zIndex: 100 } : undefined}>
        <div className="flex items-center justify-center gap-2 h-16 px-5 border-b border-slate-100 font-bold text-[#1e4287] whitespace-nowrap">
          <Warehouse className="w-5 h-5 shrink-0" /> {!collapsed && 'Warehouse Portal'}
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={navItems} onClick={({ key }) => { router.push(key); if (isMobile) setCollapsed(true); }} className="border-r-0!" />
      </Sider>
      {isMobile && !collapsed && <div className="fixed inset-0 z-99 bg-black/30" onClick={() => setCollapsed(true)} />}
      <Layout>
        <Header className="bg-white! border-b border-slate-100 flex items-center px-6! gap-3">
          <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-[6px] hover:bg-slate-100 text-slate-600 cursor-pointer border-none bg-transparent flex items-center">
            {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />}
          </button>
          <span className="text-sm font-semibold text-slate-600 truncate">{user.facility?.name ?? 'No warehouse assigned'}</span>
          <Dropdown menu={{ items: userMenu }} trigger={['click']} placement="bottomRight">
            <button className="ml-auto flex items-center gap-2.5 py-1 px-2 rounded-[6px] hover:bg-slate-100 border-none bg-transparent cursor-pointer">
              <div style={{ backgroundColor: getAvatarColor(user.fullName) }} className="w-8 h-8 rounded-full text-white font-bold flex items-center justify-center text-xs">
                {user.fullName.charAt(0).toUpperCase()}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <div className="text-sm font-semibold text-slate-800">{user.fullName}</div>
                <div className="text-xs text-slate-500">{formatRole(user.role)}</div>
              </div>
            </button>
          </Dropdown>
        </Header>
        <Content className="p-4 sm:p-6 bg-slate-50">{children}</Content>
      </Layout>
    </Layout>
  );
}
