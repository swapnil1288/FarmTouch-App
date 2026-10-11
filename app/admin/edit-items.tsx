'use client';

import { useState } from 'react';
import { LoaderCircle, Minus, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { rupee, type OrderRecord } from '@/lib/orders';

type Change = { key: string; qty?: number; remove?: boolean };

/**
 * Change quantities or mark items unavailable before packing is finished.
 * The customer gets a WhatsApp message with the changes and the new total.
 */
export function EditItemsDialog({ order, open, onClose, onSave }: {
  order: OrderRecord;
  open: boolean;
  onClose: () => void;
  onSave: (changes: Change[], note: string) => Promise<boolean>;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('Not available today');
  const [busy, setBusy] = useState(false);

  const q = (id: string, fallback: number) => qty[id] ?? fallback;

  // Live preview with the prices the customer ordered at (same rule as the server).
  const subtotal = order.items.reduce((sum, it) => {
    const n = q(it.id, it.qty);
    if (it.components?.length) {
      const left = it.components.filter((_, i) => !gone[`${it.id}:${i}`]);
      return sum + left.reduce((s, c) => s + c.price, 0) * (it.multiplier ?? 1) * n;
    }
    return sum + it.price * n;
  }, 0);
  const discount = Math.min(order.totals.discount, subtotal);
  const total = subtotal - discount + order.totals.delivery;

  const changes: Change[] = [
    ...order.items.filter((it) => qty[it.id] !== undefined && qty[it.id] !== it.qty).map((it) => ({ key: it.id, qty: qty[it.id] })),
    ...Object.entries(gone).filter(([, v]) => v).map(([key]) => ({ key, remove: true })),
  ];

  function reset() {
    setQty({});
    setGone({});
    setNote('Not available today');
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="dialog edit-items">
        <DialogTitle>Change items in {order.id}</DialogTitle>
        <DialogDescription>Use this when something is unavailable or the customer asked for a change. Stock and the bill update, and the customer is told on WhatsApp.</DialogDescription>
        <ul className="edit-list">
          {order.items.map((it) => {
            const n = q(it.id, it.qty);
            return (
              <li key={it.id} className={n === 0 ? 'removed' : ''}>
                <div className="edit-row">
                  <span><strong>{it.name}</strong><small>{it.unit} · {rupee(it.price)} each</small></span>
                  <div className="stepper sm" role="group" aria-label={it.name + ' quantity'}>
                    <button type="button" aria-label={'Less ' + it.name} disabled={n <= 0} onClick={() => setQty({ ...qty, [it.id]: n - 1 })}><Minus size={13} strokeWidth={3} /></button>
                    <span>{n}</span>
                    <button type="button" aria-label={'More ' + it.name} disabled={n >= 10} onClick={() => setQty({ ...qty, [it.id]: n + 1 })}><Plus size={13} strokeWidth={3} /></button>
                  </div>
                </div>
                {it.components?.length ? (
                  <div className="edit-components">
                    {it.components.map((c, i) => {
                      const key = `${it.id}:${i}`;
                      return (
                        <label key={key} className={gone[key] ? 'gone' : ''}>
                          <input type="checkbox" checked={!!gone[key]} onChange={(e) => setGone({ ...gone, [key]: e.target.checked })} />
                          {c.name} <small>{rupee(c.price * (it.multiplier ?? 1))}</small> — unavailable
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <label className="edit-note">Reason (sent to the customer)
          <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Not available today" />
        </label>
        <div className="edit-total">
          <span>New total <small>(was {rupee(order.totals.total)})</small></span>
          <strong>{rupee(total)}</strong>
        </div>
        {subtotal === 0 && <p className="form-error">That removes every item. Close this and use “Cancel order” instead.</p>}
        <div className="dialog-actions">
          <button className="btn btn-outline" onClick={() => { onClose(); reset(); }}>Close</button>
          <button
            className="btn btn-primary"
            disabled={busy || changes.length === 0 || subtotal === 0}
            onClick={async () => {
              setBusy(true);
              const ok = await onSave(changes, note.trim());
              setBusy(false);
              if (ok) reset();
            }}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : null} Save & tell customer
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
