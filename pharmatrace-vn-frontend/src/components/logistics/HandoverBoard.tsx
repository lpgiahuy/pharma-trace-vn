'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Handover, PendingCarrier, PendingPackage, warehouseService } from '@/services/warehouse.service';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const newHandoverCode = () =>
  `HOV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

const HISTORY_COLUMNS = (onOpen: (row: Handover) => void): ColumnsType<Handover> => [
  { title: 'Handover', dataIndex: 'handoverCode', render: (value: string) => <span className="font-mono font-semibold">{value}</span> },
  { title: 'Carrier', dataIndex: 'courierName' },
  { title: 'Driver', render: (_, row) => [row.driverName, row.vehiclePlate].filter(Boolean).join(' · ') },
  { title: 'Packages', render: (_, row) => row.packages.length },
  { title: 'Handed over', dataIndex: 'handedOverAt', render: (value: string) => formatDateTime(value) },
  { title: '', render: (_, row) => <Button size="small" onClick={() => onOpen(row)}>Manifest</Button> },
];

export function HandoverBoard() {
  const { message } = App.useApp();
  const [pending, setPending] = useState<PendingCarrier[]>([]);
  const [history, setHistory] = useState<Handover[]>([]);
  const [carrier, setCarrier] = useState<string>();
  const [scanned, setScanned] = useState<PendingPackage[]>([]);
  const [code, setCode] = useState('');
  const [driver, setDriver] = useState({ driverName: '', driverPhone: '', vehiclePlate: '', note: '' });
  const [handoverCode, setHandoverCode] = useState(newHandoverCode);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<Handover>();
  const scanInput = useRef<React.ComponentRef<typeof Input>>(null);

  const load = useCallback(() => Promise.all([warehouseService.pendingHandovers(), warehouseService.handovers()])
    .then(([waiting, done]) => { setPending(waiting.data); setHistory(done.data); })
    .catch(err => message.error(workflowErrorMessage(err, 'Could not load handovers.'))), [message]);
  useEffect(() => { void load(); }, [load]);

  function scan() {
    const value = code.trim();
    setCode('');
    if (!value) return;
    const owner = pending.find(group => group.packages.some(pkg => pkg.packageCode === value));
    const pkg = owner?.packages.find(item => item.packageCode === value);
    const problem = !owner || !pkg ? `Package ${value} is not waiting for pickup at this warehouse.`
      : carrier && owner.courierName !== carrier ? `Package ${value} belongs to ${owner.courierName}, not ${carrier}.`
      : !pkg.carrierConfirmed ? `Confirm the carrier tracking number of order ${pkg.orderCode} on the Shipments page first.`
      : scanned.some(item => item.packageCode === value) ? `Package ${value} is already scanned.`
      : undefined;
    if (problem || !owner || !pkg) {
      setFeedback({ ok: false, text: problem ?? '' });
    } else {
      setCarrier(owner.courierName);
      setScanned(list => [...list, pkg]);
      setFeedback({ ok: true, text: `Package ${value} added (order ${pkg.orderCode}).` });
    }
    scanInput.current?.focus();
  }

  async function submit() {
    if (!carrier) return;
    setBusy(true);
    try {
      const res = await warehouseService.createHandover({
        handoverCode, courierName: carrier, packageCodes: scanned.map(pkg => pkg.packageCode),
        ...Object.fromEntries(Object.entries(driver).filter(([, value]) => value.trim())),
      });
      setManifest(res.data);
      setScanned([]);
      setCarrier(undefined);
      setFeedback(undefined);
      setHandoverCode(newHandoverCode());
      await load();
    } catch (err) {
      setFeedback({ ok: false, text: workflowErrorMessage(err, 'Could not record the handover.') });
    } finally {
      setBusy(false);
    }
  }

  const waiting = pending.flatMap(group => group.packages).length;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-4" aria-labelledby="handover-heading">
        <h2 id="handover-heading" className="m-0 text-base font-semibold">New handover {carrier && <Tag color="blue">{carrier}</Tag>}</h2>
        <Input ref={scanInput} autoFocus size="large" placeholder="Scan a package code" value={code}
          onChange={event => setCode(event.target.value)} onPressEnter={scan} />
        {feedback && <Alert showIcon type={feedback.ok ? 'success' : 'error'} title={feedback.text} />}
        <ul className="m-0 list-none space-y-1 p-0 text-sm">
          {scanned.map(pkg => (
            <li key={pkg.packageCode} className="flex items-center justify-between rounded border border-slate-200 p-2">
              <span><span className="font-mono font-semibold">{pkg.packageCode}</span> · order {pkg.orderCode} · {pkg.boxCount} box(es)</span>
              <Button size="small" onClick={() => setScanned(list => list.filter(item => item !== pkg))}>Remove</Button>
            </li>
          ))}
        </ul>
        {scanned.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="Driver name" value={driver.driverName} onChange={event => setDriver({ ...driver, driverName: event.target.value })} />
            <Input placeholder="Driver phone" value={driver.driverPhone} onChange={event => setDriver({ ...driver, driverPhone: event.target.value })} />
            <Input placeholder="Vehicle plate" value={driver.vehiclePlate} onChange={event => setDriver({ ...driver, vehiclePlate: event.target.value })} />
            <Input.TextArea className="sm:col-span-3" rows={2} placeholder="Note" value={driver.note} onChange={event => setDriver({ ...driver, note: event.target.value })} />
          </div>
        )}
        <Button type="primary" disabled={scanned.length === 0} loading={busy} onClick={submit}>
          Hand over {scanned.length} package(s)
        </Button>
      </section>

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="m-0 text-base font-semibold">Waiting for pickup ({waiting})</h2>
        {pending.map(group => (
          <div key={group.courierName} className="rounded-md border border-gray-200 bg-white p-3">
            <h3 className="m-0 mb-2 text-sm font-semibold">{group.courierName} · {group.packages.length} package(s)</h3>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {group.packages.map(pkg => (
                <li key={pkg.packageCode}>
                  <span className="font-mono">{pkg.packageCode}</span> · order {pkg.orderCode} · {pkg.recipientName}
                  {!pkg.carrierConfirmed && <Tag className="ml-2" color="orange">Carrier not confirmed</Tag>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="m-0 text-base font-semibold">History</h2>
        <Table rowKey="id" size="small" dataSource={history} columns={HISTORY_COLUMNS(setManifest)} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
      </section>

      <Modal title="Handover manifest" open={!!manifest} onCancel={() => setManifest(undefined)} okText="Print" onOk={() => window.print()}>
        {manifest && (
          <div className="print-label space-y-1 text-sm">
            <p className="m-0 font-mono text-lg font-bold">{manifest.handoverCode}</p>
            <p className="m-0">{manifest.facilityName} → {manifest.courierName}</p>
            <p className="m-0">Handed over {formatDateTime(manifest.handedOverAt)} by {manifest.handedOverBy}</p>
            <p className="m-0">Driver: {[manifest.driverName, manifest.driverPhone, manifest.vehiclePlate].filter(Boolean).join(' · ') || '—'}</p>
            {manifest.note && <p className="m-0">Note: {manifest.note}</p>}
            <table className="mt-2 w-full border-collapse text-left">
              <thead><tr><th>Package</th><th>Order</th><th>Recipient</th><th>Boxes</th></tr></thead>
              <tbody>
                {manifest.packages.map(pkg => (
                  <tr key={pkg.packageCode}><td className="font-mono">{pkg.packageCode}</td><td>{pkg.orderCode}</td><td>{pkg.recipientName}</td><td>{pkg.boxCount}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-8 flex justify-between"><span>Warehouse signature: ________</span><span>Carrier signature: ________</span></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
