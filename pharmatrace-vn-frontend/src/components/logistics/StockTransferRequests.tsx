'use client';

import { useCallback, useState } from 'react';
import { App, Button, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useHydrated } from '@/hooks/useHydrated';
import { useLogisticsList } from '@/hooks/useLogisticsList';
import { facilityService } from '@/services/facility.service';
import { productService } from '@/services/product.service';
import { logisticsService, type StockTransferAction, type StockTransferRequest } from '@/services/logistics.service';
import { warehouseService } from '@/services/warehouse.service';
import type { Facility } from '@/types/facility.types';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Line = { variantId?: number; quantity: number };
type Option = { value: number; label: string; available?: number };

const STATUS_COLORS: Record<StockTransferRequest['status'], string> = {
  REQUESTED: 'gold', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'default',
};

const newRequestCode = () =>
  `STQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

export function StockTransferRequests() {
  const { message } = App.useApp();
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const user = mounted ? getUser() : null;
  const role = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '');
  const facilityId = user?.facilityId;
  const isManager = (role === 'WAREHOUSEMANAGER' || role === 'STOREMANAGER') && !!facilityId;
  // Factory staff have no manager role: they only answer requests that ask their factory for stock.
  // The factory also starts transfers itself: it picks the receiving warehouse instead of a source.
  const isFactory = role === 'FACTORYWAREHOUSESTAFF' && !!facilityId;
  const isDecider = isManager || (role === 'FACTORYWAREHOUSESTAFF' && !!facilityId);

  const load = useCallback(() => logisticsService.getStockTransferRequests(), []);
  const { result, loading, reload } = useLogisticsList(load, 'Unable to load stock transfer requests');

  const [createOpen, setCreateOpen] = useState(false);
  const [requestCode, setRequestCode] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [sourceId, setSourceId] = useState<number>();
  const [lines, setLines] = useState<Line[]>([{ quantity: 1 }]);
  const [reason, setReason] = useState('');
  const [variantOptions, setVariantOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ request: StockTransferRequest; action: StockTransferAction }>();
  const [note, setNote] = useState('');

  const openCreate = async () => {
    setRequestCode(newRequestCode());
    setSourceId(undefined);
    setLines([{ quantity: 1 }]);
    setReason('');
    setCreateOpen(true);
    // A factory can only send what it holds: offer its in-stock products (minus boxes of batches on hold), not the whole catalog.
    if (isFactory) {
      setVariantOptions([]);
      warehouseService.inventory({ limit: 100 })
        .then(res => setVariantOptions(res.items
          .map(item => ({ item, sendable: item.available - (item.held ?? 0) }))
          .filter(({ item, sendable }) => item.variantId !== null && sendable > 0)
          .map(({ item, sendable }) => ({
            value: item.variantId as number, label: `${item.medicineName} · ${item.unitName} (${sendable} available)`, available: sendable,
          }))))
        .catch((error: unknown) => message.error(workflowErrorMessage(error, 'Unable to load factory stock')));
    }
    try {
      const res = await facilityService.getDropdownList();
      setFacilities(res.data.filter(facility => facility.id !== facilityId && (!isFactory || String(facility.rawType ?? facility.type).toUpperCase().includes('WAREHOUSE'))));
    } catch (error: unknown) {
      message.error(workflowErrorMessage(error, 'Unable to load facilities'));
    }
  };

  const searchVariants = async (search: string) => {
    if (!search.trim()) return;
    const res = await productService.getProducts({ search, limit: 20 });
    const found = res.data.flatMap(product => (product.packagingOptions || [])
      .map(option => ({ value: option.id, label: `${product.medicineName} · ${option.unitName}` })));
    setVariantOptions(current => [...current.filter(o => !found.some(f => f.value === o.value)), ...found]);
  };

  const setLine = (index: number, change: Partial<Line>) =>
    setLines(current => current.map((line, i) => (i === index ? { ...line, ...change } : line)));

  const submitCreate = async () => {
    const filled = lines.filter((line): line is Required<Line> => !!line.variantId && line.quantity > 0);
    if (!sourceId || !filled.length) {
      message.error(isFactory ? 'Choose the receiving warehouse and at least one medicine' : 'Choose the source facility and at least one medicine');
      return;
    }
    setBusy(true);
    try {
      if (isFactory) {
        await logisticsService.sendFactoryTransfer({ requestCode, toFacilityId: sourceId, lines: filled, reason: reason.trim() || undefined });
        message.success('Transfer created and stock reserved. Dispatch it from the Transfers tab.');
      } else {
        await logisticsService.createStockTransferRequest({ requestCode, fromFacilityId: sourceId, lines: filled, reason: reason.trim() || undefined });
        message.success('Stock transfer request created');
      }
      setCreateOpen(false);
      reload();
    } catch (error: unknown) {
      message.error(workflowErrorMessage(error, 'Unable to create the request'));
    } finally { setBusy(false); }
  };

  const submitDecision = async () => {
    if (!decision) return;
    if (decision.action !== 'approve' && !note.trim()) {
      message.error('Enter a note');
      return;
    }
    setBusy(true);
    try {
      await logisticsService.decideStockTransferRequest(decision.request.id, decision.action, note.trim() || undefined);
      message.success(`Request ${decision.action === 'approve' ? 'approved' : decision.action === 'reject' ? 'rejected' : 'cancelled'}`);
      setDecision(undefined);
      reload();
    } catch (error: unknown) {
      message.error(workflowErrorMessage(error, 'Unable to update the request'));
    } finally { setBusy(false); }
  };

  const openDecision = (request: StockTransferRequest, action: StockTransferAction) => {
    setNote('');
    setDecision({ request, action });
  };

  const columns: ColumnsType<StockTransferRequest> = [
    { title: 'Request', key: 'code', render: (_, row) => <div>
      <div className="font-mono font-semibold">{row.request_code}</div>
      <div className="text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
    </div> },
    { title: 'Route', key: 'route', render: (_, row) => `${row.from_facility.facility_name} → ${row.to_facility.facility_name}` },
    { title: 'Lines', key: 'lines', render: (_, row) => row.lines.map(line =>
      <div key={line.variantId} className="text-xs">Variant #{line.variantId}: {line.quantity} {line.unitName}</div>) },
    { title: 'Status', key: 'status', render: (_, row) => <div>
      <Tag color={STATUS_COLORS[row.status]}>{row.status}</Tag>
      {(row.decision_note || row.reason) && <div className="text-xs text-slate-500">{row.decision_note || row.reason}</div>}
    </div> },
    { title: 'Transfer', key: 'transfer', render: (_, row) => row.transfer
      ? <span className="text-xs"><span className="font-mono">{row.transfer.transfer_code}</span> ({row.transfer.status})</span> : '—' },
    { title: 'Action', key: 'action', render: (_, row) => {
      const atSource = isDecider && row.from_facility.id === facilityId;
      const canCancel = isDecider && (atSource || row.to_facility.id === facilityId)
        && (row.status === 'REQUESTED' || (row.status === 'APPROVED' && row.transfer?.status === 'REQUESTED'));
      return <div className="flex gap-1">
        {atSource && row.status === 'REQUESTED' && <>
          <Button size="small" type="primary" onClick={() => openDecision(row, 'approve')}>Approve</Button>
          <Button size="small" danger onClick={() => openDecision(row, 'reject')}>Reject</Button>
        </>}
        {canCancel && <Button size="small" onClick={() => openDecision(row, 'cancel')}>Cancel</Button>}
      </div>;
    } },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>Refresh</Button>
        {(isManager || isFactory) && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{isFactory ? 'New transfer' : 'New request'}</Button>}
      </div>
      <Table rowKey="id" dataSource={result?.data || []} columns={columns} loading={loading} scroll={{ x: 900 }} pagination={{ pageSize: 20 }} />

      <Modal title={isFactory ? 'Send stock to a warehouse' : 'Request stock'} open={createOpen} onOk={submitCreate} onCancel={() => setCreateOpen(false)} confirmLoading={busy} okText={isFactory ? 'Create transfer' : 'Submit request'}>
        <div className="space-y-3 py-2">
          <Select className="w-full" placeholder={isFactory ? 'Receiving warehouse' : 'Source facility'} value={sourceId} onChange={setSourceId} showSearch optionFilterProp="label"
            options={facilities.map(facility => ({ value: facility.id, label: facility.name }))} />
          {lines.map((line, index) => <div key={index} className="flex gap-2">
            <Select className="flex-1" placeholder={isFactory ? 'Choose a medicine in stock' : 'Search medicine'} showSearch
              {...(isFactory ? { optionFilterProp: 'label', notFoundContent: 'No medicine in stock', classNames: { popup: { root: '[&_.ant-select-item-option-content]:whitespace-normal! [&_.ant-select-item-option-content]:text-clip!' } } } : { filterOption: false, onSearch: searchVariants })}
              value={line.variantId} onChange={variantId => setLine(index, { variantId, quantity: Math.min(line.quantity, variantOptions.find(o => o.value === variantId)?.available ?? 100000) })} options={variantOptions} />
            <InputNumber min={1} max={(isFactory && variantOptions.find(o => o.value === line.variantId)?.available) || 100000} precision={0} value={line.quantity} onChange={quantity => setLine(index, { quantity: quantity || 0 })} />
            <Button icon={<DeleteOutlined />} disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))} />
          </div>)}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setLines(current => [...current, { quantity: 1 }])}>Add line</Button>
          <Input.TextArea placeholder="Reason (optional)" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        </div>
      </Modal>

      <Modal title={decision && `${decision.action[0].toUpperCase()}${decision.action.slice(1)} ${decision.request.request_code}`}
        open={!!decision} onOk={submitDecision} onCancel={() => setDecision(undefined)} confirmLoading={busy}>
        <p className="text-sm">{decision?.action === 'approve' ? 'Approving reserves the stock at your facility and creates the transfer.' : 'A note is required.'}</p>
        <Input.TextArea placeholder="Note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
      </Modal>
    </div>
  );
}
