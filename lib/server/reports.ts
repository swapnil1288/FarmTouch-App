// Dashboard numbers and CSV export (server only).
import { istDate, labelForSlotId } from '@/lib/catalog';
import { database } from '@/lib/database';
import { paymentBreakdown, settlementSummary } from '@/lib/settlement';
import { csvEscape, packingRows, type OrderRecord } from '@/lib/orders';
import { ORDER_STATUSES, STATUS_LABEL, type OrderStatus } from '@/lib/workflow';
import { listAllOrders } from './orders';
import { listProducts } from './products';

/** ISO timestamp for 00:00 IST on a given India date (YYYY-MM-DD). */
export function istStartIso(date: string): string {
  return new Date(Date.parse(date + 'T00:00:00+05:30')).toISOString();
}

export async function dashboard(days = 7) {
  const today = istDate();
  const from = istDate(new Date(), -(days - 1));
  const orders = await listAllOrders({ from: istStartIso(from) });
  const accountRows = await database().prepare('SELECT phone, account_type, business_name FROM customers').all<{ phone: string; account_type: string; business_name: string }>();
  const customerAccounts = Object.fromEntries(accountRows.results.map((r) => [r.phone, {
    accountType: r.account_type === 'b2b' ? 'b2b' as const : 'retail' as const,
    businessName: r.business_name,
  }]));
  const open = await listAllOrders({ status: 'open' });

  const todayStart = istStartIso(today);
  const todays = orders.filter((o) => o.createdAt >= todayStart);
  const nonCancelled = (o: OrderRecord) => o.status !== 'cancelled';

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const o of open) byStatus[o.status] += 1;

  // Orders & sales per day (by order date, IST)
  const perDay = new Map<string, { date: string; orders: number; sales: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = istDate(new Date(), -i);
    perDay.set(d, { date: d, orders: 0, sales: 0 });
  }
  for (const o of orders.filter(nonCancelled)) {
    const d = istDate(new Date(o.createdAt));
    const row = perDay.get(d);
    if (row) { row.orders += 1; row.sales += o.totals.total; }
  }

  // Top products by packs sold
  const top = new Map<string, { id: string; name: string; packs: number }>();
  for (const o of orders.filter(nonCancelled)) {
    for (const r of packingRows(o.items)) {
      const t = top.get(r.productId) ?? { id: r.productId, name: r.name, packs: 0 };
      t.packs += r.packs;
      top.set(r.productId, t);
    }
  }

  // Cash per delivery partner (delivered in range) and cash still on the road
  const cash = new Map<string, { key: string; name: string; delivered: number; collected: number; pending: number }>();
  for (const o of orders.filter((x) => x.status === 'delivered')) {
    const key = o.assignee?.email ?? 'unassigned';
    const c = cash.get(key) ?? { key, name: o.assignee?.name ?? 'Unassigned', delivered: 0, collected: 0, pending: 0 };
    c.delivered += 1;
    c.collected += o.cashCollected ?? 0;
    cash.set(key, c);
  }
  for (const o of open.filter((x) => x.status === 'out_for_delivery' && !(x.payment === 'online' && x.paymentStatus === 'paid'))) {
    const key = o.assignee?.email ?? 'unassigned';
    const c = cash.get(key) ?? { key, name: o.assignee?.name ?? 'Unassigned', delivered: 0, collected: 0, pending: 0 };
    c.pending += o.totals.total;
    cash.set(key, c);
  }

  const products = await listProducts();
  const lowStock = products.filter((p) => p.active && p.stock < 15).map((p) => ({ id: p.id, name: p.name, stock: p.stock }));

  // Upcoming delivery days with open orders
  const slots = new Map<string, number>();
  for (const o of open) if (o.slot) slots.set(o.slot.slice(0, 10), (slots.get(o.slot.slice(0, 10)) ?? 0) + 1);

  return {
    today: {
      orders: todays.filter(nonCancelled).length,
      sales: todays.filter(nonCancelled).reduce((n, o) => n + o.totals.total, 0),
      cancelled: todays.filter((o) => o.status === 'cancelled').length,
    },
    range: {
      days,
      orders: orders.filter(nonCancelled).length,
      sales: orders.filter(nonCancelled).reduce((n, o) => n + o.totals.total, 0),
      delivered: orders.filter((o) => o.status === 'delivered').length,
      collected: orders.reduce((n, o) => { const m = paymentBreakdown(o); return n + m.cashCollected + m.onlinePaid; }, 0),
    },
    byStatus,
    perDay: [...perDay.values()],
    topProducts: [...top.values()].sort((a, b) => b.packs - a.packs).slice(0, 8),
    cash: [...cash.values()],
    lowStock,
    upcoming: [...slots.entries()].sort().map(([date, count]) => ({ date, label: labelForSlotId(date), count })),
    settlement: settlementSummary(orders.map((o) => ({ ...o, customerPhone: o.address.phone, customerName: o.address.name })), days, customerAccounts),
  };
}

export async function ordersCsv(fromDate: string, toDate: string): Promise<string> {
  const toExclusive = new Date(Date.parse(toDate + 'T00:00:00+05:30') + 86400000).toISOString();
  const orders = await listAllOrders({ from: istStartIso(fromDate), to: toExclusive });
  const header = ['Order ID', 'Placed at (IST)', 'Status', 'Delivery slot', 'Customer', 'Phone', 'Address', 'Pincode', 'Items', 'Item total', 'Discount', 'Delivery fee', 'Total', 'Coupon', 'Delivery partner', 'Cash collected'];
  const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const rows = orders.map((o) => [
    o.id,
    fmt.format(new Date(o.createdAt)),
    STATUS_LABEL[o.status],
    o.slotLabel,
    o.address.name,
    o.address.phone,
    o.address.street,
    o.address.pin,
    o.items.map((it) => `${it.name} x${it.qty}`).join('; '),
    o.totals.subtotal,
    o.totals.discount,
    o.totals.delivery,
    o.totals.total,
    o.coupon ?? '',
    o.assignee?.name ?? '',
    o.cashCollected ?? '',
  ]);
  // BOM so Excel opens ₹ and Devanagari correctly
  return '﻿' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
