// Order record types and helpers shared by the customer app, admin panel and API.
import { findBasketType, labelForSlotId, type Catalog, type Line, type Totals } from './catalog';
import type { OrderStatus, OrderAction, StaffRole } from './workflow';

export type OrderItem = {
  id: string;
  name: string;
  unit: string;
  /** Price of one unit (one basket for basket lines). */
  price: number;
  qty: number;
  multiplier?: number;
  components?: { id: string; name: string; unit: string; price: number }[];
};

export type OrderAddress = { name: string; phone: string; street: string; pin: string };

export type OrderEvent = {
  status: OrderStatus;
  action: OrderAction | 'placed' | 'customer_cancel';
  actor: string;
  note: string | null;
  createdAt: string;
};

export type DeliveryPartner = { name: string; phone: string; email?: string };

export type OrderRecord = {
  id: string;
  lines: Line[];
  items: OrderItem[];
  totals: Totals;
  coupon?: string;
  address: OrderAddress;
  slot: string;
  slotLabel: string;
  payment: 'cod' | 'online';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refund_pending' | 'refund_failed' | 'refunded';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  replacement: 'ask' | 'omit';
  whatsappUpdates?: boolean;
  whatsappOffers?: boolean;
  createdAt: string;
  // live workflow fields
  status: OrderStatus;
  updatedAt: string;
  packed: string[];
  cashCollected: number | null;
  assignee: DeliveryPartner | null;
  events?: OrderEvent[];
};

export type StaffMember = { email: string; name: string; phone: string; role: StaffRole; active: boolean; createdAt: string; hasPassword?: boolean };

/** One row on a packing checklist. Baskets are split into their components. */
export type PackRow = { key: string; productId: string; name: string; unit: string; packs: number; group?: string };

export function packingRows(items: OrderItem[]): PackRow[] {
  const rows: PackRow[] = [];
  for (const it of items) {
    if (it.components?.length) {
      it.components.forEach((c, i) =>
        rows.push({ key: `${it.id}:${i}`, productId: c.id, name: c.name, unit: c.unit, packs: it.qty * (it.multiplier ?? 1), group: it.name }),
      );
    } else {
      rows.push({ key: it.id, productId: it.id, name: it.name, unit: it.unit, packs: it.qty });
    }
  }
  return rows;
}

/** Rebuild an item snapshot for orders saved before v3 (no `items` stored). */
export function legacyItems(lines: Line[]): OrderItem[] {
  return lines.map((l) => ({ id: l.id, name: l.id, unit: '', price: 0, qty: l.qty, components: l.components?.map((id) => ({ id, name: id, unit: '', price: 0 })) }));
}

export function slotLabelOf(o: Pick<OrderRecord, 'slot' | 'slotLabel'>): string {
  return o.slotLabel || (o.slot ? labelForSlotId(o.slot) : '');
}

export const rupee = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN');

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Snapshot of cart lines with names and prices at the time of ordering. */
export function snapshotItems(lines: Line[], catalog: Catalog): OrderItem[] {
  return lines.map((l) => {
    const type = findBasketType(l.id);
    if (type) {
      return {
        id: l.id,
        name: type.name,
        unit: `${type.items} items${type.multiplier > 1 ? ` · ${type.multiplier}× packs` : ''}`,
        price: catalog.linePrice(l),
        qty: l.qty,
        multiplier: type.multiplier,
        components: (l.components ?? []).map((id) => {
          const p = catalog.find(id);
          return { id, name: p?.name ?? id, unit: p?.unit ?? '', price: p?.price ?? 0 };
        }),
      };
    }
    const p = catalog.find(l.id);
    return { id: l.id, name: p?.name ?? l.id, unit: p?.unit ?? '', price: p?.price ?? 0, qty: l.qty };
  });
}
