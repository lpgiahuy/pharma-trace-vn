'use client';

import { useState } from 'react';
import { App, Button, Input } from 'antd';
import { BoxCodesInput } from '@/components/returns/BoxCodesInput';
import { purchaseOrderService, type PurchaseOrderDetail } from '@/services/purchaseOrder.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Item = PurchaseOrderDetail['purchase_order_items'][number];

interface Draft { boxes: string; cartons: string }

const EMPTY: Draft = { boxes: '', cartons: '' };

const codes = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/**
 * The factory scans what it sends, line by line: single boxes and/or whole cartons. The server checks that every line
 * gets exactly the ordered quantity and reserves those boxes for this order until the warehouse receives them.
 */
export function ShipOrderForm({ order, onShipped }: { order: PurchaseOrderDetail; onShipped: () => void }) {
  const { message } = App.useApp();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const draftOf = (item: Item) => drafts[item.id] ?? EMPTY;
  const patch = (item: Item, change: Partial<Draft>) =>
    setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY), ...change } }));
  const empty = order.purchase_order_items.some(item => !codes(draftOf(item).boxes).length && !codes(draftOf(item).cartons).length);

  async function submit() {
    setBusy(true);
    try {
      await purchaseOrderService.ship(order.id, {
        note: note.trim() || undefined,
        lines: order.purchase_order_items.map(item => ({
          poItemId: item.id, boxUids: codes(draftOf(item).boxes), ssccCodes: codes(draftOf(item).cartons),
        })),
      });
      message.success('Purchase order shipped and its boxes reserved');
      onShipped();
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not ship this purchase order.'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {order.purchase_order_items.map((item, index) => {
        const draft = draftOf(item);
        return (
          <section key={item.id} className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold text-slate-900">{item.medicines.medicine_name} ({item.packaging_variants?.unit_name ?? '-'})</p>
              <span className="text-xs tabular-nums text-slate-600">Ordered {item.quantity} · {codes(draft.boxes).length} single boxes scanned</span>
            </div>
            <div>
              <label htmlFor={`ship-boxes-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">Boxes</label>
              <BoxCodesInput id={`ship-boxes-${item.id}`} autoFocus={index === 0} value={draft.boxes} onChange={value => patch(item, { boxes: value })} />
            </div>
            <div>
              <label htmlFor={`ship-cartons-${item.id}`} className="mb-1 block text-xs font-medium text-slate-700">
                Whole cartons (SSCC codes, one per line; every box of a carton is shipped)
              </label>
              <Input.TextArea
                id={`ship-cartons-${item.id}`}
                rows={2}
                value={draft.cartons}
                onChange={event => patch(item, { cartons: event.target.value })}
                placeholder="000000000000000001"
                className="font-mono text-xs"
              />
            </div>
          </section>
        );
      })}
      <Input.TextArea aria-label="Note" placeholder="Note (optional)" maxLength={500} rows={2} value={note} onChange={event => setNote(event.target.value)} />
      <Button type="primary" className="self-start" disabled={empty} loading={busy} onClick={submit}>Ship order</Button>
    </div>
  );
}
