'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import { LockOutlined } from '@ant-design/icons';

export function FinanceAccessDenied() {
  return (
    <div className="bg-white p-8 rounded-md border border-gray-200 text-center space-y-3">
      <LockOutlined className="text-3xl text-amber-500" />
      <h2 className="text-base font-bold text-slate-800 m-0">Access Restricted</h2>
      <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto m-0">
        Debts and the cashbook are available to administrators and finance staff.
      </p>
      <Link href="/admin">
        <Button type="primary" className="bg-[#004996]!" size="small">Back to Dashboard</Button>
      </Link>
    </div>
  );
}
