'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Input } from 'antd';
import { BoxCodesInput } from '@/components/returns/BoxCodesInput';
import { purchaseOrderService, type PurchaseOrderDetail } from '@/services/purchaseOrder.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Item = PurchaseOrderDetail['purchase_order_items'][number];

interface Draft { rejected: string; missing: string; reason: string }

const EMPTY: Draft = { rejected: '', missing: '', reason: '' };

const uids = (text: string) => text.split('\n').filter(Boolean);

const newReceiptCode = () =>
  `GR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

/**
 * Receives an order the factory has already shipped. The boxes were scanned and reserved when the factory shipped, so
 * the warehouse does not scan them again: every shipped box counts as received except the damaged ones (quarantined)
 * and the missing ones (they stay reserved until the order is closed).
 */
export function ShipmentReceiptForm({ order }: { order: PurchaseOrderDetail }) {
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

  const counts = (item: Item) => {
    const draft = draftOf(item);
    const remaining = item.quantity - item.received_quantity;
    const rejected = uids(draft.rejected).length;
    const missing = uids(draft.missing).length;
    return { remaining, rejected, missing, accepted: remaining - rejected - missing };
  };
  const lineError = (item: Item): string | undefined => {
    const { accepted, rejected } = counts(item);
    if (accepted < 0) return 'More damaged and missing boxes than were shipped.';
    if (rejected && !draftOf(item).reason.trim()) return 'Enter why the boxes were damaged.';
    return undefined;
  };
  const received = open.reduce((sum, item) => sum + counts(item).accepted + counts(item).rejected, 0);
  const blocked = open.some(item => lineError(item)) || received === 0;

  async function submit() {
    setBusy(true);
    try {
      const { data } = await purchaseOrderService.receive(order.id, {
        receiptCode,
        note: note.trim() || undefined,
        lines: open.map(item => {
          const draft = draftOf(item);
          return {
            poItemId: item.id, shipped: true,
            rejectedBoxUids: uids(draft.rejected), missingBoxUids: uids(draft.missing), rejectReason: draft.reason.trim() || undefined,
          };
        }),
      });
      message.success('Goods received');
      router.push(`/warehouse/purchase-orders/${order.id}/receipts/${data.id}`);
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not record the receipt.'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-slate-600">
        The factory already scanned these boxes. Leave Damaged and Missing empty if everything arrived in good condition;
        otherwise scan only the damaged boxes and the ones that did not arrive.
      </p>
      {open.map((item, index) => {
        const draft = draftOf(item);
        const { remaining, rejected, missing, accepted } = counts(item);
        const error = lineError(item);
        return (
          <section key={item.id} className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold text-slate-900">{item.medicines.medicine_name} ({item.packaging_variants?.unit_name ?? '-'})</p>
              <span className="text-xs tabular-nums text-slate-600" aria-live="polite">
                {remaining} shipped · {Math.max(accepted, 0)} good · {rejected} damaged · {missing} missing
              </span>
            </div>
            <div>
              <label htmlFor={`damaged-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">Damaged boxes (go to quarantine)</label>
              <BoxCodesInput id={`damaged-${item.id}`} autoFocus={index === 0} value={draft.rejected} onChange={value => patch(item, { rejected: value })} />
            </div>
            {rejected > 0 && (
              <Input aria-label="Damage reason" placeholder="Damage reason (required)" maxLength={300} value={draft.reason} onChange={event => patch(item, { reason: event.target.value })} />
            )}
            <div>
              <label htmlFor={`missing-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">Missing boxes (did not arrive)</label>
              <BoxCodesInput id={`missing-${item.id}`} value={draft.missing} onChange={value => patch(item, { missing: value })} />
            </div>
            {error && <p role="alert" className="m-0 text-xs text-red-700">{error}</p>}
          </section>
        );
      })}
      <Input.TextArea aria-label="Note" placeholder="Note (optional)" maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} />
      <Button type="primary" className="self-start" disabled={blocked} loading={busy} onClick={submit}>Receive shipment</Button>
    </div>
  );
}
