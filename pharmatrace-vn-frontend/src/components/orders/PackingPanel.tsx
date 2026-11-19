'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Input, Modal, QRCode } from 'antd';
import { BoxCodesInput } from '@/components/returns/BoxCodesInput';
import { PackageLabel, PackageSummary, PickLine, warehouseService } from '@/services/warehouse.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCurrency, formatDate, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const newPackageCode = () =>
  `PKG-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

/** The error message plus the rejected box, so the packer knows which one to take out. */
function scanError(error: unknown): string {
  const message = workflowErrorMessage(error, 'Could not pack these boxes.');
  const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
  if (!details || typeof details !== 'object') return message;
  const boxes = 'uid' in details ? [details.uid] : 'uids' in details && Array.isArray(details.uids) ? details.uids : [];
  return boxes.length ? `${message} Box: ${boxes.join(', ')}` : message;
}

export function PackingPanel({ orderId, editable, onCompleted }: { orderId: number; editable: boolean; onCompleted: () => void }) {
  const { message } = App.useApp();
  const role = useAuthStore(state => state.getUser)()?.role;
  const manager = role === 'WAREHOUSE_MANAGER' || role === 'SUPER_ADMIN';
  const [lines, setLines] = useState<PickLine[]>([]);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [scanned, setScanned] = useState('');
  const [packageCode, setPackageCode] = useState(newPackageCode);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<PackageSummary>();
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState<PackageLabel>();

  const load = useCallback(() => Promise.all([warehouseService.pickList(orderId), warehouseService.packages(orderId)])
    .then(([pick, packed]) => { setLines(pick.data); setPackages(packed.data); })
    .catch(err => message.error(workflowErrorMessage(err, 'Could not load the pick list.'))), [orderId, message]);
  useEffect(() => { void load(); }, [load]);

  const uids = scanned.split('\n').filter(Boolean);
  const required = lines.reduce((sum, line) => sum + line.quantity, 0);
  const packed = lines.reduce((sum, line) => sum + line.packedQuantity, 0);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const pack = () => run(async () => {
    try {
      const res = await warehouseService.addPackage(orderId, packageCode, uids);
      setFeedback({ ok: true, text: `Package ${res.data.packageCode} packed with ${res.data.boxUids.length} box(es).` });
      setScanned('');
      setPackageCode(newPackageCode());
      await load();
    } catch (err) {
      setFeedback({ ok: false, text: scanError(err) });
    }
  });

  const complete = () => run(async () => {
    try {
      const res = await warehouseService.completePacking(orderId);
      message.success(`Packing completed. Tracking number ${res.data.trackingNumber}.`);
      onCompleted();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'Could not complete packing.'));
    }
  });

  const voidPackage = () => run(async () => {
    if (!voiding) return;
    try {
      await warehouseService.voidPackage(voiding.id, reason);
      message.success(`Package ${voiding.packageCode} voided. Its boxes can be packed again.`);
      setVoiding(undefined);
      await load();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'Could not void the package.'));
    }
  });

  const printLabel = (pkg: PackageSummary) => warehouseService.packageLabel(pkg.id)
    .then(res => setLabel(res.data))
    .catch(err => message.error(workflowErrorMessage(err, 'Could not load the label.')));

  return (
    <section className="space-y-4 rounded-md border border-gray-200 bg-white p-4" aria-labelledby="packing-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="packing-heading" className="m-0 text-base font-semibold">Packing <span className="tabular-nums text-slate-500">{packed} / {required} boxes</span></h2>
        {editable && (
          <Button type="primary" disabled={required === 0 || packed < required} loading={busy} onClick={complete}>
            Complete packing
          </Button>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Pick list</h3>
        <ul className="m-0 list-none space-y-2 p-0">
          {lines.map(line => (
            <li key={line.orderItemId} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex justify-between gap-2">
                <strong>{line.medicineName}</strong>
                <span className={`tabular-nums ${line.packedQuantity === line.quantity ? 'text-emerald-700' : ''}`}>{line.packedQuantity} / {line.quantity}</span>
              </div>
              {line.suggestions.map(box => (
                <div key={box.uid} className="font-mono text-xs text-slate-600">
                  {box.uid} · batch {box.batchNumber} · exp {formatDate(box.expiryDate)}
                </div>
              ))}
              {line.packedQuantity < line.quantity && line.suggestions.length === 0 && (
                <p className="m-0 text-xs text-red-700">No sellable boxes at this warehouse.</p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {editable && packed < required && (
        <div>
          <h3 className="text-sm font-semibold">New package <span className="font-mono font-normal text-slate-500">{packageCode}</span></h3>
          <BoxCodesInput key={packageCode} value={scanned} onChange={value => { setScanned(value); setFeedback(undefined); }} expected={required - packed} autoFocus />
          <Button className="mt-2" type="primary" disabled={uids.length === 0} loading={busy} onClick={pack}>
            Pack {uids.length} box(es) into package
          </Button>
          {feedback && <Alert className="mt-2" showIcon type={feedback.ok ? 'success' : 'error'} title={feedback.text} />}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">Packages ({packages.length})</h3>
        <ul className="m-0 list-none space-y-2 p-0">
          {packages.map(pkg => (
            <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2 text-sm">
              <span><span className="font-mono font-semibold">{pkg.packageCode}</span> · {pkg.boxUids.length} box(es)</span>
              <span className="flex gap-2">
                <Button size="small" onClick={() => printLabel(pkg)}>Print label</Button>
                {editable && manager && <Button size="small" danger onClick={() => { setReason(''); setVoiding(pkg); }}>Void</Button>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Modal
        title={`Void package ${voiding?.packageCode ?? ''}`}
        open={!!voiding}
        onCancel={() => setVoiding(undefined)}
        onOk={voidPackage}
        okText="Void package"
        okButtonProps={{ danger: true, loading: busy, disabled: !reason.trim() }}
      >
        <Input.TextArea rows={3} placeholder="Reason (required)" value={reason} onChange={event => setReason(event.target.value)} />
      </Modal>

      <Modal title="Package label" open={!!label} onCancel={() => setLabel(undefined)} okText="Print" onOk={() => window.print()}>
        {label && (
          <div className="print-label space-y-1 text-sm">
            <QRCode value={label.packageCode} />
            <p className="m-0 font-mono text-lg font-bold">{label.packageCode}</p>
            <p className="m-0">Order {label.orderCode} · {label.boxCount} box(es) · packed {formatDateTime(label.packedAt)}</p>
            <p className="m-0">From: {label.facilityName}</p>
            <p className="m-0">To: {label.recipientName} · {label.recipientPhone}</p>
            <p className="m-0">{label.shippingAddress}</p>
            {label.trackingNumber && <p className="m-0">{label.courierName} · {label.trackingNumber}</p>}
            {label.codAmount !== null && <p className="m-0">COD: {formatCurrency(label.codAmount)}</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
