'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { App, Button, InputNumber, Modal, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined } from '@ant-design/icons';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReport } from '@/hooks/useReport';
import { reportService } from '@/services/report.service';
import type { ExpiryAlert, ExpiryLevel, StockAlert } from '@/types/report.types';
import { workflowErrorMessage } from '@/utils/workflow-error';
import { formatCount } from '@/utils/report-format';

const EXPIRY_LEVELS: { level: ExpiryLevel; label: string; color: string }[] = [
  { level: 'LE_30', label: '30 days or less', color: '#f97316' },
  { level: 'D31_90', label: '31-90 days', color: '#f59e0b' },
  { level: 'D91_180', label: '91-180 days', color: '#0ea5e9' },
];

interface ThresholdEdit {
  title: string;
  value: number;
  canReset: boolean;
  save: (quantity: number | null) => Promise<unknown>;
}

interface StockAlertsPanelProps {
  facilityId?: number;
  canEditInventory: boolean;
  canEditDefault: boolean;
}

const medicineColumn = { title: 'Medicine', render: (_: unknown, row: { medicineId: number; medicineName: string }) => (
  <Link href={`/admin/products/${row.medicineId}/edit`} className="text-slate-900 hover:underline">{row.medicineName}</Link>
) };

export function StockAlertsPanel({ facilityId, canEditInventory, canEditDefault }: StockAlertsPanelProps) {
  const { message } = App.useApp();
  const stock = useReport(useCallback(() => reportService.stockAlerts(facilityId).then(res => res.data), [facilityId]), true);
  const expiry = useReport(useCallback(() => reportService.expiryAlerts(facilityId).then(res => res.data), [facilityId]), true);
  const [editing, setEditing] = useState<ThresholdEdit | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const stockItems = stock.data?.items ?? [];
  const expiryItems = expiry.data?.items ?? [];
  const outOfStock = stockItems.filter(item => item.level === 'OUT_OF_STOCK');
  const lowStock = stockItems.filter(item => item.level === 'LOW_STOCK');
  const expiring = expiryItems.filter(item => item.level !== 'EXPIRED');
  const expired = expiryItems.filter(item => item.level === 'EXPIRED');
  const levelBoxes = EXPIRY_LEVELS.map(({ level, label, color }) => ({
    label,
    color,
    boxes: expiring.filter(item => item.level === level).reduce((sum, item) => sum + item.boxes, 0),
  }));

  const edit = (next: ThresholdEdit) => {
    setDraft(next.value);
    setEditing(next);
  };

  const submit = async (quantity: number | null) => {
    if (!editing) return;
    setSaving(true);
    try {
      await editing.save(quantity);
      message.success('Threshold saved');
      setEditing(null);
      stock.reload();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'Could not save the threshold'));
    } finally {
      setSaving(false);
    }
  };

  const stockColumns: ColumnsType<StockAlert> = [
    medicineColumn,
    { title: 'Unit', dataIndex: 'unitName' },
    { title: 'Facility', dataIndex: 'facilityName' },
    { title: 'Available', dataIndex: 'available', align: 'right', render: formatCount },
    {
      title: 'Threshold',
      align: 'right',
      render: (_, row) => (
        <span>
          {formatCount(row.threshold)}
          {row.minStockQuantity === null && <span className="text-slate-400"> (default)</span>}
          {canEditInventory && (
            <Button
              type="text"
              size="small"
              aria-label="Edit threshold"
              icon={<EditOutlined />}
              onClick={() => edit({
                title: `${row.medicineName} (${row.unitName}) at ${row.facilityName}`,
                value: row.threshold,
                canReset: row.minStockQuantity !== null,
                save: quantity => reportService.setInventoryThreshold(row.inventoryId, quantity),
              })}
            />
          )}
        </span>
      ),
    },
  ];

  const expiryColumns: ColumnsType<ExpiryAlert> = [
    medicineColumn,
    { title: 'Batch', dataIndex: 'batchNumber' },
    { title: 'Facility', dataIndex: 'facilityName' },
    { title: 'Boxes', dataIndex: 'boxes', align: 'right', render: formatCount },
    { title: 'Expiry', dataIndex: 'expiryDate', render: (value: string) => new Date(value).toLocaleDateString('vi-VN') },
    {
      title: 'Days left',
      dataIndex: 'daysLeft',
      align: 'right',
      render: (value: number) => (value < 0 ? `${-value} overdue` : value),
    },
    {
      title: '',
      dataIndex: 'belowMinShelfLife',
      render: (below: boolean) => below && <Tag color="orange" className="m-0">Below minimum shelf life</Tag>,
    },
  ];

  const stockTable = (rows: StockAlert[]) => (
    <Table rowKey="inventoryId" size="small" loading={stock.loading} dataSource={rows} columns={stockColumns} scroll={{ x: 560 }} locale={{ emptyText: 'Nothing to report' }} />
  );
  const expiryTable = (rows: ExpiryAlert[]) => (
    <Table rowKey={row => `${row.batchId}-${row.facilityId}`} size="small" loading={expiry.loading} dataSource={rows} columns={expiryColumns} scroll={{ x: 720 }} locale={{ emptyText: 'Nothing to report' }} />
  );
  const failure = (error: string | null, retry: () => void) => error && (
    <p className="text-xs text-red-600 m-0 mb-2">{error} <Button type="link" size="small" onClick={retry}>Retry</Button></p>
  );

  return (
    <section className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs p-4 min-w-0">
      <h2 className="text-sm font-semibold text-slate-900 m-0 mb-1">Stock alerts</h2>
      <Tabs
        size="small"
        items={[
          {
            key: 'out',
            label: `Out of stock (${outOfStock.length})`,
            children: <>{failure(stock.error, stock.reload)}{stockTable(outOfStock)}</>,
          },
          {
            key: 'low',
            label: `Low stock (${lowStock.length})`,
            children: (
              <>
                {failure(stock.error, stock.reload)}
                {stock.data && (
                  <p className="text-xs text-slate-500 m-0 mb-2">
                    Default threshold: {formatCount(stock.data.defaultThreshold)}
                    {canEditDefault && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => edit({
                          title: 'Default threshold',
                          value: stock.data?.defaultThreshold ?? 0,
                          canReset: false,
                          save: quantity => reportService.setDefaultThreshold(quantity ?? 0),
                        })}
                      >
                        Change
                      </Button>
                    )}
                  </p>
                )}
                {stockTable(lowStock)}
              </>
            ),
          },
          {
            key: 'expiring',
            label: `Expiring (${expiring.length})`,
            children: (
              <>
                {failure(expiry.error, expiry.reload)}
                <div className="h-[110px] mb-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={levelBoxes} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <XAxis type="number" allowDecimals={false} hide />
                      <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={value => `${formatCount(Number(value))} boxes`} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="boxes" name="Boxes in stock" radius={[0, 3, 3, 0]} maxBarSize={18}>
                        {levelBoxes.map(entry => <Cell key={entry.label} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {expiryTable(expiring)}
              </>
            ),
          },
          {
            key: 'expired',
            label: `Expired (${expired.length})`,
            children: <>{failure(expiry.error, expiry.reload)}{expiryTable(expired)}</>,
          },
        ]}
      />
      <Modal
        open={editing !== null}
        title={editing?.title}
        onCancel={() => setEditing(null)}
        footer={[
          <Button key="cancel" onClick={() => setEditing(null)}>Cancel</Button>,
          editing?.canReset && <Button key="reset" loading={saving} onClick={() => submit(null)}>Use default</Button>,
          <Button key="save" type="primary" loading={saving} disabled={draft === null} onClick={() => submit(draft)}>Save</Button>,
        ]}
      >
        <p className="text-xs text-slate-500 mt-0">Items show as low stock when the available quantity is at or below this value.</p>
        <InputNumber min={0} precision={0} value={draft} onChange={setDraft} className="w-full" aria-label="Minimum stock quantity" />
      </Modal>
    </section>
  );
}
