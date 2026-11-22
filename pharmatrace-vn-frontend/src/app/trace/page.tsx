'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, App, Button, Descriptions, Input, Timeline } from 'antd';
import { Navbar } from '@/components/common/Navbar';
import { traceService, type ScanLocation, type ScanOutcome, type TraceHistory } from '@/services/trace.service';
import { formatDate, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const EVENT_LABELS = { MANUFACTURED: 'Manufactured', RECEIVED: 'Received at', TRANSFER_RECEIVED: 'Transferred to' } as const;

function currentLocation(): Promise<ScanLocation | undefined> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(undefined),
      { timeout: 5000 },
    );
  });
}

function TraceLookup() {
  const params = useSearchParams();
  const { message } = App.useApp();
  const [uid, setUid] = useState(params.get('uid') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [history, setHistory] = useState<TraceHistory>();
  const [codeValid, setCodeValid] = useState<boolean>();
  const [scan, setScan] = useState<ScanOutcome>();
  const [busy, setBusy] = useState(params.has('uid'));

  const lookup = useCallback((boxUid: string, secret: string) => traceService.history(boxUid)
    .then(async res => {
      setHistory(res.data);
      const [scanned, verified] = await Promise.all([
        currentLocation().then(location => traceService.scan(boxUid, location)),
        secret ? traceService.verify(boxUid, secret) : undefined,
      ]);
      setScan(scanned.data);
      setCodeValid(verified?.data.valid);
    })
    .catch((err: unknown) => message.error(workflowErrorMessage(err, 'Could not look up this code.')))
    .finally(() => setBusy(false)), [message]);

  useEffect(() => {
    const queryUid = params.get('uid');
    if (queryUid) void lookup(queryUid, params.get('code') ?? '');
  }, [params, lookup]);

  const submit = () => {
    setBusy(true);
    setHistory(undefined);
    setCodeValid(undefined);
    setScan(undefined);
    void lookup(uid.trim(), code.trim());
  };

  const box = history?.box;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <Input value={uid} onChange={event => setUid(event.target.value)} placeholder="Box code (UID)" />
        <Input value={code} onChange={event => setCode(event.target.value)} placeholder="Secret code (optional)" />
        <Button type="primary" loading={busy} disabled={!uid.trim()} onClick={submit}>
          Look up
        </Button>
      </div>

      {box && (
        <>
          {box.batchStatus === 'RECALLED' && <Alert type="error" showIcon title="This batch has been recalled. Do not use this medicine." />}
          {new Date(box.expiryDate) < new Date() && <Alert type="error" showIcon title="This medicine is past its expiry date." />}
          {codeValid === true && <Alert type="success" showIcon title="The secret code matches this box." />}
          {codeValid === false && <Alert type="error" showIcon title="The secret code does not match. This box may be counterfeit." />}
          {scan?.scanResult === 'SUSPICIOUS' && (
            <Alert type="warning" showIcon title="This code has been scanned in an unusual pattern. It may have been copied." />
          )}
          <Descriptions bordered size="small" column={1} className="bg-white">
            <Descriptions.Item label="Medicine">{box.medicineName}</Descriptions.Item>
            <Descriptions.Item label="Manufacturer">{box.manufacturer ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Batch">{box.batchNumber}</Descriptions.Item>
            <Descriptions.Item label="Manufactured">{formatDate(box.productionDate)}</Descriptions.Item>
            <Descriptions.Item label="Expires">{formatDate(box.expiryDate)}</Descriptions.Item>
          </Descriptions>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <Timeline
              items={history.timeline.map(event => ({
                content: `${EVENT_LABELS[event.eventType]}${event.facilityName ? ` ${event.facilityName}` : ''} — ${formatDateTime(event.occurredAt)}`,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function TracePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Trace a medicine</h1>
        <Suspense>
          <TraceLookup />
        </Suspense>
      </main>
    </div>
  );
}
