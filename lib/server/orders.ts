// Order persistence and the fulfilment workflow (server only).
import { database } from '@/lib/database';
import { packsNeeded, type Line } from '@/lib/catalog';
import {
  ACTION_RULES, CUSTOMER_CANCELLABLE, OPEN_STATUSES, STATUS_LABEL, canDo, isOrderStatus,
  type OrderAction, type OrderStatus,
} from '@/lib/workflow';
import { legacyItems, packingRows, slotLabelOf, type OrderEvent, type OrderRecord } from '@/lib/orders';
import { HttpError, nowIso } from './http';
import type { StaffSession } from './staff';
import { findStaff } from './staff';
import { notifyCustomer } from '@/lib/whatsapp-server';
import type { NoticeExtra } from '@/lib/notify-text';

type OrderRow = {
  id: string; owner: string; payload: string; created_at: string; status: string; slot: string; total: number;
  assignee: string | null; packed: string; cash_collected: number | null; updated_at: string;
  staff_name?: string | null; staff_phone?: string | null;
};

const SELECT_ORDER = `SELECT o.*, s.name AS staff_name, s.phone AS staff_phone
  FROM orders o LEFT JOIN staff s ON s.email = o.assignee`;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToOrder(r: OrderRow): OrderRecord | null {
  const p = parseJson<Partial<OrderRecord> | null>(r.payload, null);
  if (!p || !Array.isArray(p.lines) || !p.totals || !p.address) return null;
  const status: OrderStatus = isOrderStatus(r.status) ? r.status : 'placed';
  return {
    id: r.id,
    lines: p.lines,
    items: Array.isArray(p.items) && p.items.length ? p.items : legacyItems(p.lines),
    totals: p.totals,
    coupon: p.coupon ?? '',
    address: p.address,
    slot: r.slot || p.slot || '',
    slotLabel: slotLabelOf({ slot: r.slot || p.slot || '', slotLabel: p.slotLabel ?? '' }),
    payment: p.payment === 'online' ? 'online' : 'cod',
    paymentStatus: p.paymentStatus,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    replacement: p.replacement === 'omit' ? 'omit' : 'ask',
    whatsappUpdates: !!p.whatsappUpdates,
    whatsappOffers: !!p.whatsappOffers,
    createdAt: r.created_at,
    status,
    updatedAt: r.updated_at || r.created_at,
    packed: parseJson<string[]>(r.packed, []),
    cashCollected: r.cash_collected,
    assignee: r.assignee ? { email: r.assignee, name: r.staff_name || r.assignee, phone: r.staff_phone || '' } : null,
  };
}

type EventRow = { order_id: string; status: string; action: string; actor: string; note: string | null; created_at: string };

async function eventsFor(ids: string[]): Promise<Map<string, OrderEvent[]>> {
  const map = new Map<string, OrderEvent[]>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const res = await database()
    .prepare(`SELECT * FROM order_events WHERE order_id IN (${placeholders}) ORDER BY id`)
    .bind(...ids)
    .all<EventRow>();
  for (const e of res.results) {
    const list = map.get(e.order_id) ?? [];
    list.push({ status: isOrderStatus(e.status) ? e.status : 'placed', action: e.action as OrderEvent['action'], actor: e.actor, note: e.note, createdAt: e.created_at });
    map.set(e.order_id, list);
  }
  return map;
}

// ---------------------------------------------------------------- customer side

export type NewOrder = Omit<OrderRecord, 'status' | 'updatedAt' | 'packed' | 'cashCollected' | 'assignee' | 'events'>;

/**
 * Saves an order and reserves stock in ONE atomic batch. The products table has
 * CHECK (stock >= 0), so if two customers race for the last packs, one batch
 * fails and nothing is saved for that customer.
 */
export async function createOrder(owner: string, requestKey: string, order: NewOrder, packs: Record<string, number>) {
  const db = database();
  const key = `${owner}:${requestKey}`;
  const existing = await db.prepare(`${SELECT_ORDER} WHERE o.request_key = ? AND o.owner = ?`).bind(key, owner).first<OrderRow>();
  if (existing) return { order: rowToOrder(existing), created: false };

  const now = order.createdAt;
  const stmts: D1PreparedStatement[] = Object.entries(packs).map(([id, q]) =>
    db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?').bind(q, now, id),
  );
  stmts.push(
    db.prepare('INSERT INTO orders (id, owner, request_key, payload, created_at, status, slot, total, packed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(order.id, owner, key, JSON.stringify(order), now, 'placed', order.slot, order.totals.total, '[]', now),
    db.prepare('INSERT INTO order_events (order_id, status, action, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(order.id, 'placed', 'placed', 'customer', null, now),
  );

  try {
    await db.batch(stmts);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Lost a race with a retry of the same request: return the saved order.
    const again = await db.prepare(`${SELECT_ORDER} WHERE o.request_key = ? AND o.owner = ?`).bind(key, owner).first<OrderRow>();
    if (again) return { order: rowToOrder(again), created: false };
    if (/CHECK constraint failed/i.test(msg)) {
      const short = await shortages(packs);
      throw new HttpError(409, short.length ? `Sorry, ${short.join(', ')} just sold out. Please update your cart.` : 'Some items just sold out. Please update your cart.');
    }
    throw e;
  }
  const saved = await db.prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(order.id).first<OrderRow>();
  return { order: saved ? rowToOrder(saved) : null, created: true };
}

async function shortages(packs: Record<string, number>): Promise<string[]> {
  const ids = Object.keys(packs);
  if (!ids.length) return [];
  const res = await database().prepare(`SELECT id, name, stock FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; name: string; stock: number }>();
  return res.results.filter((r) => r.stock < (packs[r.id] ?? 0)).map((r) => (r.stock > 0 ? `${r.name} (only ${r.stock} left)` : r.name));
}

/** Previously saved order for the same checkout attempt (idempotent retries). */
export async function findOrderByRequest(owner: string, requestKey: string): Promise<OrderRecord | null> {
  const row = await database().prepare(`${SELECT_ORDER} WHERE o.request_key = ? AND o.owner = ?`).bind(`${owner}:${requestKey}`, owner).first<OrderRow>();
  return row ? rowToOrder(row) : null;
}

export async function listCustomerOrders(owner: string): Promise<OrderRecord[]> {
  const res = await database().prepare(`${SELECT_ORDER} WHERE o.owner = ? ORDER BY o.created_at DESC LIMIT 50`).bind(owner).all<OrderRow>();
  const orders = res.results.map(rowToOrder).filter((o): o is OrderRecord => !!o);
  const events = await eventsFor(orders.map((o) => o.id));
  return orders.map((o) => ({
    ...o,
    events: (events.get(o.id) ?? []).filter((e) => !['note', 'toggle_item', 'assign'].includes(e.action)).map((e) => ({ ...e, actor: e.actor === 'customer' ? 'You' : 'Farm’s Touch' })),
    // Only show the delivery partner while they are on the way.
    assignee: o.status === 'out_for_delivery' && o.assignee ? { name: o.assignee.name, phone: o.assignee.phone } : null,
  }));
}

export async function customerCancel(owner: string, id: string, siteUrl?: string): Promise<OrderRecord> {
  const row = await database().prepare(`${SELECT_ORDER} WHERE o.id = ? AND o.owner = ?`).bind(id, owner).first<OrderRow>();
  const order = row && rowToOrder(row);
  if (!order) throw new HttpError(404, 'Order not found.');
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw new HttpError(409, 'This order is already being packed and can no longer be cancelled online. Please contact us on WhatsApp.');
  }
  await transition(order, 'cancelled', 'customer_cancel', 'customer', 'Cancelled by customer', {});
  const updated = (await getOrder(id))!;
  await (await import('./razorpay')).refundPaidOnlineOrder(updated);
  const cancelled = (await getOrder(id))!;
  await notifyCustomer('cancelled', cancelled, { note: 'as you requested', siteUrl });
  return cancelled;
}

// ---------------------------------------------------------------- staff side

export async function getOrder(id: string, withEvents = true): Promise<OrderRecord | null> {
  const row = await database().prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(id).first<OrderRow>();
  const order = row ? rowToOrder(row) : null;
  if (order && withEvents) order.events = (await eventsFor([id])).get(id) ?? [];
  return order;
}

export type OrderFilter = { status?: string; slot?: string; q?: string; assignee?: string; from?: string; to?: string; limit?: number };

export async function listOrders(f: OrderFilter): Promise<OrderRecord[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status === 'open') { where.push(`o.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`); args.push(...OPEN_STATUSES); }
  else if (f.status && isOrderStatus(f.status)) { where.push('o.status = ?'); args.push(f.status); }
  if (f.slot) { where.push('o.slot LIKE ?'); args.push(f.slot.slice(0, 10) + '%'); }
  if (f.assignee) { where.push('o.assignee = ?'); args.push(f.assignee); }
  if (f.from) { where.push('o.created_at >= ?'); args.push(f.from); }
  if (f.to) { where.push('o.created_at < ?'); args.push(f.to); }
  if (f.q) {
    where.push("(o.id LIKE ? OR json_extract(o.payload, '$.address.name') LIKE ? OR json_extract(o.payload, '$.address.phone') LIKE ?)");
    const like = '%' + f.q.replace(/[%_]/g, '') + '%';
    args.push(like, like, like);
  }
  const sql = `${SELECT_ORDER} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT ${Math.min(f.limit ?? 200, 2000)}`;
  const res = await database().prepare(sql).bind(...args).all<OrderRow>();
  return res.results.map(rowToOrder).filter((o): o is OrderRecord => !!o);
}

/**
 * Atomically moves an order from its current status/version to a new one,
 * records an event and (for cancellations) returns stock to the shelf.
 * The update only applies if nobody else changed the order in the meantime.
 */
async function transition(
  order: OrderRecord,
  to: OrderStatus,
  action: OrderEvent['action'],
  actor: string,
  note: string | null,
  set: { assignee?: string | null; packed?: string[]; cashCollected?: number | null },
) {
  const db = database();
  const now = nowIso();
  const cols = ['status = ?', 'updated_at = ?'];
  const vals: unknown[] = [to, now];
  if ('assignee' in set) { cols.push('assignee = ?'); vals.push(set.assignee ?? null); }
  if ('packed' in set) { cols.push('packed = ?'); vals.push(JSON.stringify(set.packed ?? [])); }
  if ('cashCollected' in set) { cols.push('cash_collected = ?'); vals.push(set.cashCollected ?? null); }

  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ? AND status = ? AND updated_at = ?`).bind(...vals, order.id, order.status, order.updatedAt),
    // Only recorded if the update above applied (same new version).
    db.prepare('INSERT INTO order_events (order_id, status, action, actor, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND updated_at = ? AND status = ?)')
      .bind(order.id, to, action, actor, note, now, order.id, now, to),
  ];
  if (to === 'cancelled' && order.status !== 'cancelled') {
    for (const [id, q] of Object.entries(packsNeeded(order.lines as Line[]))) {
      stmts.push(
        db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND updated_at = ? AND status = ?)')
          .bind(q, now, id, order.id, now, 'cancelled'),
      );
    }
  }
  const [result] = await db.batch(stmts);
  if (!result.meta.changes) throw new HttpError(409, 'This order was just updated by someone else. Please refresh.');
}

export type ItemChange = { key: string; qty?: number; remove?: boolean };
export type ActionInput = { action: OrderAction; itemKey?: string; assignee?: string; cash?: number; note?: string; changes?: ItemChange[] };

export async function applyAction(staff: StaffSession, id: string, input: ActionInput, ctx: { siteUrl?: string } = {}): Promise<OrderRecord> {
  const order = await getOrder(id, false);
  if (!order) throw new HttpError(404, 'Order not found.');
  const { action } = input;
  const rule = ACTION_RULES[action];

  if (!canDo(action, staff.role, order.status)) {
    if (!rule.roles.includes(staff.role)) throw new HttpError(403, 'Your role cannot do this.');
    throw new HttpError(409, `Not possible while the order is “${STATUS_LABEL[order.status]}”. Please refresh.`);
  }
  if (action === 'edit_items' && order.payment === 'online' && order.paymentStatus === 'paid') {
    throw new HttpError(409, 'This online-paid order cannot be repriced. Cancel it to request a refund, then place a new order.');
  }
  if (staff.role === 'delivery' && order.assignee?.email !== staff.email) {
    throw new HttpError(403, 'This order is not assigned to you.');
  }

  const actor = `${staff.name} (${staff.role})`;
  const note = (input.note ?? '').trim().slice(0, 300) || null;

  switch (action) {
    case 'toggle_item': {
      const rows = packingRows(order.items);
      if (!input.itemKey || !rows.some((r) => r.key === input.itemKey)) throw new HttpError(400, 'Unknown item.');
      const packed = order.packed.includes(input.itemKey) ? order.packed.filter((k) => k !== input.itemKey) : [...order.packed, input.itemKey];
      // Ticking the first item also starts packing.
      const to = order.status === 'confirmed' ? 'packing' : order.status;
      const now = nowIso();
      const db = database();
      const stmts = [
        db.prepare('UPDATE orders SET packed = ?, status = ?, updated_at = ? WHERE id = ? AND updated_at = ?').bind(JSON.stringify(packed), to, now, order.id, order.updatedAt),
      ];
      if (to !== order.status) {
        stmts.push(db.prepare('INSERT INTO order_events (order_id, status, action, actor, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND updated_at = ?)')
          .bind(order.id, to, 'start_packing', actor, null, now, order.id, now));
      }
      const [r] = await db.batch(stmts);
      if (!r.meta.changes) throw new HttpError(409, 'This order was just updated by someone else. Please refresh.');
      break;
    }
    case 'mark_packed': {
      const rows = packingRows(order.items);
      const missing = rows.filter((r) => !order.packed.includes(r.key));
      if (missing.length) throw new HttpError(409, `Tick all items first (${missing.length} left).`);
      await transition(order, 'packed', action, actor, note, {});
      break;
    }
    case 'assign': {
      const email = (input.assignee ?? '').trim().toLowerCase();
      if (!email) {
        await transition(order, order.status, action, actor, 'Unassigned', { assignee: null });
        break;
      }
      const member = await findStaff(email);
      if (!member || !member.active || (member.role !== 'delivery' && member.role !== 'admin')) throw new HttpError(400, 'Choose an active delivery partner.');
      await transition(order, order.status, action, actor, `Assigned to ${member.name}`, { assignee: member.email });
      break;
    }
    case 'out_for_delivery': {
      if (!order.assignee) throw new HttpError(409, 'Assign a delivery partner first.');
      await transition(order, 'out_for_delivery', action, actor, note, {});
      break;
    }
    case 'delivered': {
      const cash = Number(input.cash);
      if (!Number.isFinite(cash) || cash < 0 || cash > order.totals.total * 2 || !Number.isInteger(cash)) throw new HttpError(400, 'Enter the cash/UPI amount collected (in ₹).');
      if (order.payment === 'online' && order.paymentStatus === 'paid' && cash !== 0) throw new HttpError(400, 'This order was already paid online; do not collect cash.');
      const extra = cash !== order.totals.total ? `Collected ₹${cash} (bill ₹${order.totals.total})` : `Collected ₹${cash}`;
      await transition(order, 'delivered', action, actor, [extra, note].filter(Boolean).join(' · '), { cashCollected: cash });
      break;
    }
    case 'failed': {
      if (!note) throw new HttpError(400, 'Please write why the delivery failed.');
      await transition(order, 'packed', action, actor, note, {});
      break;
    }
    case 'cancel': {
      await transition(order, 'cancelled', action, actor, note, {});
      await (await import('./razorpay')).refundPaidOnlineOrder({ ...order, status: 'cancelled' });
      break;
    }
    case 'note': {
      if (!note) throw new HttpError(400, 'Note is empty.');
      await transition(order, order.status, action, actor, note, {});
      break;
    }
    case 'edit_items': {
      const result = await editItems(order, input.changes ?? [], actor, note);
      const updated = (await getOrder(id))!;
      await notifyCustomer('items_changed', updated, { changes: result.changes, previousTotal: order.totals.total, note, siteUrl: ctx.siteUrl });
      return updated;
    }
    default: {
      const to = rule.to ?? order.status;
      await transition(order, to, action, actor, note, {});
    }
  }
  const updated = (await getOrder(id))!;

  // Tell the customer about the steps that matter to them (never blocks the action).
  const extra: NoticeExtra = { note, siteUrl: ctx.siteUrl };
  if (action === 'confirm') await notifyCustomer('confirmed', updated, extra);
  else if (action === 'out_for_delivery') await notifyCustomer('out_for_delivery', updated, extra);
  else if (action === 'delivered') await notifyCustomer('delivered', updated, { ...extra, note: null, cash: updated.cashCollected });
  else if (action === 'failed') await notifyCustomer('delivery_failed', updated, extra);
  else if (action === 'cancel') await notifyCustomer('cancelled', updated, extra);
  return updated;
}

// ---------------------------------------------------------------- change items (unavailable / quantity)

/**
 * Changes quantities or removes items before packing is finished.
 * Stock is adjusted in the same atomic batch, the bill is recalculated with the
 * prices the customer ordered at, and the customer keeps their coupon and
 * delivery terms (never charged more because the shop changed the order).
 */
async function editItems(order: OrderRecord, changes: ItemChange[], actor: string, reason: string | null) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 40) throw new HttpError(400, 'No changes to save.');
  const lines: Line[] = order.lines.map((l) => ({ ...l, components: l.components ? [...l.components] : undefined }));
  const items = order.items.map((it) => ({ ...it, components: it.components ? it.components.map((c) => ({ ...c })) : undefined }));
  if (items.length !== lines.length) throw new HttpError(409, 'This older order cannot be edited. Cancel it instead and ask the customer to order again.');
  const described: string[] = [];
  const touched = new Set<string>();

  // Component removals first, highest index first so the other indexes stay valid.
  const removals = changes
    .filter((c) => c.remove && c.key.includes(':'))
    .map((c) => ({ lineId: c.key.split(':')[0], index: Number(c.key.split(':')[1]) }))
    .sort((a, b) => b.index - a.index);
  for (const r of removals) {
    const li = lines.findIndex((l) => l.id === r.lineId);
    const it = items[li];
    if (li < 0 || !it?.components || !Number.isInteger(r.index) || r.index < 0 || r.index >= it.components.length) throw new HttpError(400, 'Unknown item.');
    const [gone] = it.components.splice(r.index, 1);
    lines[li].components!.splice(r.index, 1);
    it.price = it.components.reduce((n, c) => n + c.price, 0) * (it.multiplier ?? 1);
    described.push(`${gone.name} removed from ${it.name}`);
    touched.add(r.lineId);
  }

  for (const c of changes.filter((x) => !x.remove || !x.key.includes(':'))) {
    const li = lines.findIndex((l) => l.id === c.key);
    if (li < 0) throw new HttpError(400, 'Unknown item.');
    const qty = c.remove ? 0 : Number(c.qty);
    if (!Number.isInteger(qty) || qty < 0 || qty > 10) throw new HttpError(400, 'Quantity must be between 0 and 10.');
    if (qty === lines[li].qty) continue;
    described.push(qty === 0 ? `${items[li].name} removed` : `${items[li].name} ${lines[li].qty} → ${qty}`);
    lines[li].qty = qty;
    items[li].qty = qty;
    touched.add(c.key);
  }

  // Drop empty lines (qty 0 or a basket with no items left).
  const keep = lines.map((l, i) => l.qty > 0 && (!items[i].components || items[i].components!.length > 0));
  const newLines = lines.filter((_, i) => keep[i]);
  const newItems = items.filter((_, i) => keep[i]);
  if (!described.length) throw new HttpError(400, 'Nothing changed.');
  if (!newLines.length) throw new HttpError(400, 'That would remove every item. Use “Cancel order” instead.');

  const subtotal = newItems.reduce((n, it) => n + it.price * it.qty, 0);
  const discount = Math.min(order.totals.discount, subtotal);
  const totals = { subtotal, discount, delivery: order.totals.delivery, total: subtotal - discount + order.totals.delivery };

  const before = packsNeeded(order.lines);
  const after = packsNeeded(newLines);
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);

  const payload = {
    id: order.id, lines: newLines, items: newItems, totals, coupon: order.coupon, address: order.address, slot: order.slot,
    slotLabel: order.slotLabel, payment: order.payment, replacement: order.replacement, whatsappUpdates: order.whatsappUpdates,
    whatsappOffers: order.whatsappOffers, createdAt: order.createdAt,
  };
  const packed = order.packed.filter((k) => !touched.has(k.split(':')[0]));
  const now = nowIso();
  const note = `${described.join('; ')}${reason ? ` (${reason})` : ''}. New total ₹${totals.total} (was ₹${order.totals.total})`;
  const db = database();
  const stmts: D1PreparedStatement[] = [
    db.prepare('UPDATE orders SET payload = ?, total = ?, packed = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND status = ?')
      .bind(JSON.stringify(payload), totals.total, JSON.stringify(packed), now, order.id, order.updatedAt, order.status),
  ];
  for (const pid of ids) {
    const delta = (after[pid] ?? 0) - (before[pid] ?? 0);
    if (!delta) continue;
    // Only applied if the order update above went through; CHECK (stock >= 0) refuses overselling.
    stmts.push(
      db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND updated_at = ?)')
        .bind(delta, now, pid, order.id, now),
    );
  }
  stmts.push(
    db.prepare('INSERT INTO order_events (order_id, status, action, actor, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND updated_at = ?)')
      .bind(order.id, order.status, 'edit_items', actor, note, now, order.id, now),
  );
  let first: D1Result;
  try {
    [first] = await db.batch(stmts);
  } catch (e) {
    if (/CHECK constraint failed/i.test(String((e as Error)?.message ?? e))) throw new HttpError(409, 'Not enough stock for that increase.');
    throw e;
  }
  if (!first.meta.changes) throw new HttpError(409, 'This order was just updated by someone else. Please refresh.');
  return { changes: described, totals };
}

// ---------------------------------------------------------------- packing & reports

export type PickRow = { productId: string; name: string; unit: string; packs: number; orders: number };

/** Total packs to pick for a delivery day (orders not yet packed). */
export async function pickList(slotDate: string) {
  const orders = (await listOrders({ slot: slotDate, limit: 2000 })).filter((o) => ['placed', 'confirmed', 'packing'].includes(o.status));
  const map = new Map<string, PickRow>();
  for (const o of orders) {
    const seen = new Set<string>();
    for (const r of packingRows(o.items)) {
      const row = map.get(r.productId) ?? { productId: r.productId, name: r.name, unit: r.unit, packs: 0, orders: 0 };
      row.packs += r.packs;
      if (!seen.has(r.productId)) { row.orders += 1; seen.add(r.productId); }
      map.set(r.productId, row);
    }
  }
  return { slot: slotDate, orders: orders.length, rows: [...map.values()].sort((a, b) => b.packs - a.packs) };
}
