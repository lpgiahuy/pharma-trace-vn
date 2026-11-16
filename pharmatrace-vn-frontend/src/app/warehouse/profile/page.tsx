'use client';

import React from 'react';
import { Card, Tag, Descriptions } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole } from '@/utils';

export default function WarehouseProfilePage() {
  const user = useAuthStore((state) => state.getUser)();

  return (
    <Card title="My Profile" className="shadow-sm rounded-xl max-w-3xl">
      <Descriptions bordered column={1} size="middle">
        <Descriptions.Item label="Full Name">{user.fullName}</Descriptions.Item>
        <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
        <Descriptions.Item label="Role">
          <Tag color="blue" className="font-semibold">{formatRole(user.role)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Job Title">{user.jobTitle || '—'}</Descriptions.Item>
        <Descriptions.Item label="Assigned Facility">{user.facility?.name || 'No warehouse assigned'}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color="green">{user.status}</Tag>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
