'use client';

import { useRef, useState } from 'react';
import { Alert, App, Button, Input, Popconfirm, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FraudAlertTable } from '@/components/quality/FraudAlertTable';
import { useHydrated } from '@/hooks/useHydrated';
import { traceabilityService, type BoxTimelineEvent, type CartonDetail, type ScanReason, type ScanResult } from '@/services/traceability.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDate, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASON_TEXT: Record<ScanReason, string> = {
  UNKNOWN_UID: 'This code is not in our records.',
  SIGNATURE_MISMATCH: 'The box signature does not match our records.',
  NOT_AT_WAREHOUSE: 'The box is not recorded at your warehouse.',
  BOX_STATUS_UNEXPECTED: 'The box is recorded as destroyed or missing.',
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Registered',
  RECEIVED: 'Received into stock',
  RECEIPT_REJECTED: 'Rejected at receipt',
  CARTON_UNPACKED: 'Carton unpacked',
  TRANSFER_DISPATCHED: 'Dispatched in a transfer',
  TRANSFER_RECEIVED: 'Received from a transfer',
  PACKED: 'Packed for an order',
  PACKAGE_VOIDED: 'Package voided',
  HANDED_OVER: 'Handed to the carrier',
  RETURNED: 'Returned to the warehouse',
  RECALL_HOLD: 'Held for a recall',
  RECALL_COLLECT: 'Collected for a recall',
  DISPOSAL_CREATED: 'Added to a disposal draft',
  DISPOSAL_APPROVED: 'Disposal approved',
  DISPOSAL_CANCELLED: 'Disposal cancelled',
  DESTROYED: 'Destroyed',
  PUBLIC_SCAN: 'Scanned by a customer',
  FRAUD_ALERT: 'Alert opened for investigation',
  FRAUD_ALERT_RESOLVED: 'Alert resolved',
};

const TIMELINE_COLUMNS: ColumnsType<BoxTimelineEvent> = [
  { title: 'When', dataIndex: 'occurredAt', render: (value: string | null) => formatDateTime(value) },
  { title: 'Event', dataIndex: 'eventType', render: (value: string) => EVENT_LABELS[value] ?? value },
  { title: 'Warehouse', dataIndex: 'facilityId', render: (value: number | null) => value ? `#${value}` : '—' },
  { title: 'Reference', dataIndex: 'reference', render: (value: string | null) => value ?? '—' },
  { title: 'Detail', dataIndex: 'detail', render: (value: string | null) => value ?? '—' },
];

export function TraceBoard() {
  const { message } = App.useApp();
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const role = ((mounted ? getUser()?.role : '') || '').toUpperCase().replace(/[\s_-]/g, '');
  const isManager = role === 'WAREHOUSEMANAGER' || role === 'SUPERADMIN';

  const [scan, setScan] = useState('');
  const [result, setResult] = useState<ScanResult>();
  const [timeline, setTimeline] = useState<BoxTimelineEvent[]>([]);
  const [scanError, setScanError] = useState<string>();
  const [ssccInput, setSsccInput] = useState('');
  const [carton, setCarton] = useState<CartonDetail>();
  const [cartonError, setCartonError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scanInput = useRef<React.ComponentRef<typeof Input>>(null);

  async function checkBox() {
    const uid = scan.trim().toLowerCase();
    setScan('');
    setResult(undefined);
    setTimeline([]);
    if (!UID_PATTERN.test(uid)) setScanError(`${uid || 'Empty scan'} is not a box code.`);
    else {
      setScanError(undefined);
      try {
        const checked = (await traceabilityService.scan(uid)).data;
        setResult(checked);
        if (checked.box) setTimeline((await traceabilityService.history(uid)).data);
      } catch (err) {
        setScanError(workflowErrorMessage(err, 'Could not check the box.'));
      }
    }
    scanInput.current?.focus();
  }

  async function lookUpCarton(run: () => Promise<{ data: CartonDetail }>, done?: string) {
    setBusy(true);
    try {
      setCarton((await run()).data);
      setCartonError(undefined);
      if (done) message.success(done);
    } catch (err) {
      setCarton(undefined);
      setCartonError(workflowErrorMessage(err, 'Could not load the carton.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Traceability</h1>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Check a box</h2>
        <Input ref={scanInput} autoFocus value={scan} onChange={event => setScan(event.target.value)} onPressEnter={() => void checkBox()}
          placeholder="Scan a box code and press Enter" />
        {scanError && <Alert type="error" showIcon title={scanError} />}
        {result?.verdict === 'NEEDS_INVESTIGATION' && (
          <Alert type="warning" showIcon title="Needs investigation"
            description={<ul className="list-disc pl-4">{result.reasons.map(reason => <li key={reason}>{REASON_TEXT[reason]}</li>)}</ul>} />
        )}
        {result?.verdict === 'NO_ANOMALY_FOUND' && <Alert type="info" showIcon title="No anomaly found" description={result.message} />}
        {result?.box && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className="font-mono text-xs">{result.uid}</span>
            <Tag>{result.box.status}</Tag>
            <span>{result.box.medicineName ?? '—'} · batch {result.box.batchNumber ?? '—'}{result.box.batchStatus ? ` (${result.box.batchStatus})` : ''}</span>
            {result.box.expiryDate && <span>expires {formatDate(result.box.expiryDate)}</span>}
          </div>
        )}
        {timeline.length > 0 && (
          <Table rowKey={(_, index) => String(index)} size="small" columns={TIMELINE_COLUMNS} dataSource={timeline} pagination={false} scroll={{ x: 'max-content' }} />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Carton</h2>
        <Input value={ssccInput} onChange={event => setSsccInput(event.target.value)} onPressEnter={() => void lookUpCarton(() => traceabilityService.carton(ssccInput.trim()))}
          placeholder="Scan a carton SSCC and press Enter" />
        {cartonError && <Alert type="error" showIcon title={cartonError} />}
        {carton && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span className="font-mono font-semibold">{carton.sscc}</span>
              <Tag color={carton.status === 'PACKAGED' ? 'blue' : 'default'}>{carton.status}</Tag>
              <span>{carton.medicineName ?? '—'} · batch {carton.batchNumber ?? '—'} · {carton.boxes.length} boxes</span>
              {carton.status === 'PACKAGED' && (
                <Popconfirm title="Unpack this carton?" okText="Unpack" onConfirm={() => void lookUpCarton(() => traceabilityService.unpack(carton.sscc), 'Carton unpacked.')}>
                  <Button size="small" loading={busy}>Unpack</Button>
                </Popconfirm>
              )}
            </div>
            <Table rowKey="uid" size="small" pagination={{ pageSize: 10, showSizeChanger: false }} dataSource={carton.boxes}
              columns={[
                { title: 'Box', dataIndex: 'uid', render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                { title: 'Status', dataIndex: 'status' },
                { title: 'Warehouse', dataIndex: 'facilityId', render: (value: number | null) => value ? `#${value}` : '—' },
              ]} />
          </div>
        )}
      </section>

      {isManager && <FraudAlertTable />}
    </div>
  );
}
