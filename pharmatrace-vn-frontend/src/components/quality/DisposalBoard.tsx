'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Modal, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useHydrated } from '@/hooks/useHydrated';
import {
  disposalService, type DisposalCandidate, type DisposalDetail, type DisposalSource, type DisposalStatus, type DisposalSummary,
} from '@/services/disposal.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDate, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const STATUS_COLORS: Record<DisposalStatus, string> = { DRAFT: 'default', APPROVED: 'blue', COMPLETED: 'green', CANCELLED: 'red' };
const SOURCE_COLORS: Record<DisposalSource, string> = { EXPIRED: 'orange', QUARANTINE: 'gold', RECALL: 'red' };
const UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;

const newDisposalCode = () =>
  `DSP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

const CANDIDATE_COLUMNS: ColumnsType<DisposalCandidate> = [
  { title: 'Box', dataIndex: 'boxUid', render: (value: string) => <span className="font-mono text-xs">{value}</span> },
  { title: 'Medicine', dataIndex: 'medicineName', render: (value: string | null) => value ?? '—' },
  { title: 'Batch', dataIndex: 'batchNumber' },
  { title: 'Expiry', dataIndex: 'expiryDate', render: (value: string) => formatDate(value) },
  { title: 'Source', dataIndex: 'source', render: (value: DisposalSource) => <Tag color={SOURCE_COLORS[value]}>{value}</Tag> },
];

export function DisposalBoard() {
  const { message } = App.useApp();
  const mounted = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const role = ((mounted ? getUser()?.role : '') || '').toUpperCase().replace(/[\s_-]/g, '');
  const isManager = role === 'WAREHOUSEMANAGER' || role === 'SUPERADMIN';

  const [candidates, setCandidates] = useState<DisposalCandidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidatePage, setCandidatePage] = useState(1);
  const [disposals, setDisposals] = useState<DisposalSummary[]>([]);
  const [disposalTotal, setDisposalTotal] = useState(0);
  const [disposalPage, setDisposalPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [scan, setScan] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>();
  const [open, setOpen] = useState<DisposalDetail>();
  const [cancelReason, setCancelReason] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scanInput = useRef<React.ComponentRef<typeof Input>>(null);

  const load = useCallback(() => Promise.all([
    disposalService.candidates({ page: candidatePage, limit: PAGE_SIZE }),
    disposalService.list({ page: disposalPage, limit: PAGE_SIZE }),
  ]).then(([found, done]) => {
    setCandidates(found.items);
    setCandidateTotal(found.pagination.total);
    setDisposals(done.items);
    setDisposalTotal(done.pagination.total);
  }).catch(err => message.error(workflowErrorMessage(err, 'Could not load disposals.'))), [candidatePage, disposalPage, message]);
  useEffect(() => { void load(); }, [load]);

  function addScan() {
    const uid = scan.trim().toLowerCase();
    setScan('');
    if (!UID_PATTERN.test(uid)) setFeedback({ ok: false, text: `${uid || 'Empty scan'} is not a box code.` });
    else if (selected.includes(uid)) setFeedback({ ok: false, text: `Box ${uid} is already in the list.` });
    else {
      setSelected(list => [...list, uid]);
      setFeedback({ ok: true, text: `Box ${uid} added.` });
    }
    scanInput.current?.focus();
  }

  async function run(action: () => Promise<{ data: DisposalDetail }>, done: string) {
    setBusy(true);
    try {
      setOpen((await action()).data);
      message.success(done);
      await load();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'The action failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    setBusy(true);
    try {
      const res = await disposalService.create({ disposalCode: newDisposalCode(), reason: reason.trim(), boxUids: selected });
      setOpen(res.data);
      setSelected([]);
      setReason('');
      setFeedback(undefined);
      await load();
    } catch (err) {
      setFeedback({ ok: false, text: workflowErrorMessage(err, 'Could not draft the disposal.') });
    } finally {
      setBusy(false);
    }
  }

  async function viewAttachment(id: number, attachmentId: number) {
    try {
      window.open(URL.createObjectURL(await disposalService.attachment(id, attachmentId)), '_blank');
    } catch (err) {
      message.error(workflowErrorMessage(err, 'Could not open the attachment.'));
    }
  }

  const disposalColumns: ColumnsType<DisposalSummary> = [
    { title: 'Disposal', dataIndex: 'disposalCode', render: (value: string) => <span className="font-mono font-semibold">{value}</span> },
    { title: 'Status', dataIndex: 'status', render: (value: DisposalStatus) => <Tag color={STATUS_COLORS[value]}>{value}</Tag> },
    { title: 'Boxes', dataIndex: 'itemCount', align: 'right' },
    { title: 'Reason', dataIndex: 'reason' },
    { title: 'Created', dataIndex: 'createdAt', render: (value: string) => formatDateTime(value) },
    { title: '', render: (_, row) => <Button size="small" onClick={() => void run(() => disposalService.detail(row.id), 'Disposal loaded.')}>Open</Button> },
  ];

  const editable = open?.status === 'DRAFT' || open?.status === 'APPROVED';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Disposals</h1>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Boxes to dispose of</h2>
        <Input ref={scanInput} autoFocus value={scan} onChange={event => setScan(event.target.value)} onPressEnter={addScan}
          placeholder="Scan a box code and press Enter" />
        {feedback && <Alert type={feedback.ok ? 'success' : 'error'} showIcon title={feedback.text} />}
        <Table rowKey="boxUid" size="small" columns={CANDIDATE_COLUMNS} dataSource={candidates} scroll={{ x: 'max-content' }}
          rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => setSelected(keys.map(String)) }}
          pagination={{ current: candidatePage, pageSize: PAGE_SIZE, total: candidateTotal, showSizeChanger: false, onChange: setCandidatePage }} />
        <Input.TextArea rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason for the disposal" />
        <Button type="primary" loading={busy} disabled={!selected.length || !reason.trim()} onClick={() => void createDraft()}>
          Draft disposal ({selected.length} boxes)
        </Button>
      </section>

      <Table rowKey="id" size="small" columns={disposalColumns} dataSource={disposals} scroll={{ x: 'max-content' }}
        pagination={{ current: disposalPage, pageSize: PAGE_SIZE, total: disposalTotal, showSizeChanger: false, onChange: setDisposalPage }} />

      <Modal open={!!open} onCancel={() => setOpen(undefined)} footer={null} width={760} title={open?.disposalCode}>
        {open && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tag color={STATUS_COLORS[open.status]}>{open.status}</Tag>
              <span className="text-slate-600">{open.reason}</span>
            </div>
            <Table rowKey="boxUid" size="small" pagination={{ pageSize: 5, showSizeChanger: false }} dataSource={open.items}
              columns={[
                { title: 'Box', dataIndex: 'boxUid', render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                { title: 'Batch', dataIndex: 'batchNumber' },
                { title: 'Source', dataIndex: 'source', render: (value: DisposalSource) => <Tag color={SOURCE_COLORS[value]}>{value}</Tag> },
              ]} />
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900">Disposal record</h3>
              <div className="flex flex-wrap gap-2">
                {open.attachments.map((file, index) => (
                  <Button key={file.id} size="small" onClick={() => void viewAttachment(open.id, file.id)}>Image {index + 1}</Button>
                ))}
                {!open.attachments.length && <span className="text-slate-500">No record attached yet.</span>}
              </div>
              {editable && (
                <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false}
                  beforeUpload={file => { void run(() => disposalService.upload(open.id, file), 'Image attached.'); return false; }}>
                  <Button loading={busy}>Attach image</Button>
                </Upload>
              )}
            </div>
            <ol className="space-y-1 text-sm text-slate-600">
              {open.events.map(event => (
                <li key={`${event.action}-${event.createdAt}`}>{formatDateTime(event.createdAt)} · {event.action}{event.note ? ` · ${event.note}` : ''}</li>
              ))}
            </ol>
            {isManager && editable && (
              <div className="flex flex-wrap gap-2">
                {open.status === 'DRAFT' && <Button type="primary" loading={busy} onClick={() => void run(() => disposalService.approve(open.id), 'Disposal approved.')}>Approve</Button>}
                {open.status === 'APPROVED' && (
                  <Button type="primary" danger loading={busy} disabled={!open.attachments.length}
                    onClick={() => void run(() => disposalService.complete(open.id), 'Disposal completed.')}>
                    Complete and destroy boxes
                  </Button>
                )}
                <Button danger onClick={() => setCancelReason('')}>Cancel disposal</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={cancelReason !== undefined} title="Cancel disposal" okText="Cancel disposal" okButtonProps={{ danger: true, disabled: !cancelReason?.trim() }}
        cancelText="Keep" onCancel={() => setCancelReason(undefined)}
        onOk={() => { if (open && cancelReason) void run(() => disposalService.cancel(open.id, cancelReason), 'Disposal cancelled.').then(() => setCancelReason(undefined)); }}>
        <Input.TextArea rows={3} maxLength={500} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Reason" />
      </Modal>
    </div>
  );
}
