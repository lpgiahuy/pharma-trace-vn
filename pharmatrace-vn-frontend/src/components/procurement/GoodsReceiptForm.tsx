'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Input } from 'antd';
import { BoxCodesInput } from '@/components/returns/BoxCodesInput';
import { purchaseOrderService, type PurchaseOrderDetail } from '@/services/purchaseOrder.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Item = PurchaseOrderDetail['purchase_order_items'][number];

interface Draft {
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  accepted: string;
  rejected: string;
  reason: string;
  certificate?: File;
}

const EMPTY: Draft = { batchNumber: '', productionDate: '', expiryDate: '', accepted: '', rejected: '', reason: '' };

const uids = (text: string) => text.split('\n').filter(Boolean);

const newReceiptCode = () =>
  `GR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

function lineError(item: Item, draft: Draft): string | undefined {
  const accepted = uids(draft.accepted).length;
  const rejected = uids(draft.rejected).length;
  if (!accepted && !rejected) return undefined;
  const remaining = item.quantity - item.received_quantity;
  if (accepted + rejected > remaining) return `Only ${remaining} left to receive on this line.`;
  if (!draft.batchNumber.trim() || !draft.productionDate || !draft.expiryDate) return 'Enter the batch number, MFG and EXP dates.';
  if (draft.productionDate >= draft.expiryDate) return 'MFG date must be before EXP date.';
  if (rejected && !draft.reason.trim()) return 'Enter why the boxes were rejected.';
  return undefined;
}

export function GoodsReceiptForm({ order }: { order: PurchaseOrderDetail }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [receiptCode] = useState(newReceiptCode);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const open = order.purchase_order_items.filter(item => item.quantity > item.received_quantity);
  const draftOf = (item: Item) => drafts[item.id] ?? EMPTY;
  const patch = (item: Item, change: Partial<Draft>) =>
    setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY), ...change } }));
  const filled = open.filter(item => uids(draftOf(item).accepted).length + uids(draftOf(item).rejected).length > 0);
  const blocked = !filled.length || open.some(item => lineError(item, draftOf(item)));

  async function submit() {
    setBusy(true);
    try {
      const { data } = await purchaseOrderService.receive(order.id, {
        receiptCode,
        note: note.trim() || undefined,
        lines: filled.map(item => {
          const draft = draftOf(item);
          return {
            poItemId: item.id,
            batchNumber: draft.batchNumber.trim(),
            productionDate: draft.productionDate,
            expiryDate: draft.expiryDate,
            boxUids: uids(draft.accepted),
            rejectedBoxUids: uids(draft.rejected),
            rejectReason: draft.reason.trim() || undefined,
          };
        }),
      });
      const uploads = filled.flatMap(item => {
        const file = draftOf(item).certificate;
        const line = data.goods_receipt_lines.find(entry => entry.po_item_id === item.id);
        return file && line ? [purchaseOrderService.uploadCertificate(order.id, data.id, line.batches.id, file)] : [];
      });
      const results = await Promise.allSettled(uploads);
      if (results.some(result => result.status === 'rejected')) message.warning('Goods received, but a CO/CQ upload failed.');
      else message.success('Goods received');
      router.push(`/warehouse/purchase-orders/${order.id}/receipts/${data.id}`);
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not record the receipt.'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {open.map((item, index) => {
        const draft = draftOf(item);
        const accepted = uids(draft.accepted).length;
        const rejected = uids(draft.rejected).length;
        const remaining = item.quantity - item.received_quantity;
        const error = lineError(item, draft);
        return (
          <section key={item.id} className="space-y-3 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold text-slate-900">
                {item.medicines.medicine_name} ({item.packaging_variants?.unit_name ?? '-'})
              </p>
              <span className={`text-xs tabular-nums ${accepted + rejected > remaining ? 'text-red-700' : 'text-slate-600'}`} aria-live="polite">
                {accepted} accepted · {rejected} rejected · {remaining} remaining of {item.quantity}
              </span>
            </div>

            <div>
              <label htmlFor={`accepted-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">Accepted boxes</label>
              <BoxCodesInput id={`accepted-${item.id}`} autoFocus={index === 0} value={draft.accepted} onChange={value => patch(item, { accepted: value })} />
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <Input aria-label="Batch number" placeholder="Batch number" maxLength={100} value={draft.batchNumber} onChange={event => patch(item, { batchNumber: event.target.value })} />
              <Input aria-label="MFG date" type="date" prefix="MFG" value={draft.productionDate} onChange={event => patch(item, { productionDate: event.target.value })} />
              <Input aria-label="EXP date" type="date" prefix="EXP" value={draft.expiryDate} onChange={event => patch(item, { expiryDate: event.target.value })} />
            </div>
            <label className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              CO/CQ image
              <input type="file" accept="image/jpeg,image/png,image/webp" className="min-w-0 text-xs" onChange={event => patch(item, { certificate: event.target.files?.[0] })} />
            </label>

            <div>
              <label htmlFor={`rejected-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">Rejected boxes (go to quarantine)</label>
              <BoxCodesInput id={`rejected-${item.id}`} value={draft.rejected} onChange={value => patch(item, { rejected: value })} />
            </div>
            {rejected > 0 && (
              <Input aria-label="Reject reason" placeholder="Reject reason (required)" maxLength={300} value={draft.reason} onChange={event => patch(item, { reason: event.target.value })} />
            )}

            {error && <p role="alert" className="m-0 text-xs text-red-700">{error}</p>}
          </section>
        );
      })}

      <Input.TextArea aria-label="Note" placeholder="Note (optional)" maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} />
      <Button type="primary" disabled={blocked} loading={busy} onClick={submit}>Record receipt</Button>
    </div>
  );
}
