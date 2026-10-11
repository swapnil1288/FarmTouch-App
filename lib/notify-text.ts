// Text of every WhatsApp message a customer receives about their order.
// `full` is used for click-to-send and free-form API messages (multi-line);
// `short` is a single line used inside an approved WhatsApp template
// (template parameters may not contain line breaks).

import type { OrderRecord } from './orders';
import { describeItem } from './whatsapp';

export const NOTICE_KINDS = [
  'order_placed',
  'confirmed',
  'items_changed',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'cancelled',
  'offer',
  'store_alert',
  'test',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  order_placed: 'Order received',
  confirmed: 'Order confirmed',
  items_changed: 'Order changed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered & payment',
  delivery_failed: 'Delivery missed',
  cancelled: 'Cancelled',
  offer: 'Offer',
  store_alert: 'New order alert (to shop)',
  test: 'Test',
};

export type NoticeExtra = {
  /** Reason / note from staff. */
  note?: string | null;
  /** Human-readable list of item changes, e.g. "Tomato 2 → 1". */
  changes?: string[];
  /** Total before an item change. */
  previousTotal?: number;
  /** Cash/UPI collected on delivery. */
  cash?: number | null;
  /** Public shop address, e.g. https://farmtouch.in (for the tracking link). */
  siteUrl?: string;
};

const rupee = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN');
const firstName = (name: string) => (name.trim().split(/\s+/)[0] || 'there');
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 900);

export function trackingLink(siteUrl: string | undefined, orderId: string): string {
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}/?track=${encodeURIComponent(orderId)}` : '';
}

/** Builds the message for an order event. */
export function orderNotice(kind: Exclude<NoticeKind, 'offer' | 'test' | 'store_alert'>, o: OrderRecord, x: NoticeExtra = {}): { full: string; short: string } {
  const hi = `Hi ${firstName(o.address.name)},`;
  const total = rupee(o.totals.total);
  const slot = o.slotLabel || '';
  const link = trackingLink(x.siteUrl, o.id);
  const track = link ? `\n\nTrack your order: ${link}` : '';
  const sign = '\n— Farm’s Touch';
  const reason = x.note?.trim() ? ` (${x.note.trim()})` : '';

  switch (kind) {
    case 'order_placed': {
      const lines = o.items.map((it, i) => `${i + 1}. ${describeItem(it)} — ${rupee(it.price * it.qty)}`);
      const money = [
        `Items: ${rupee(o.totals.subtotal)}`,
        o.totals.discount ? `Coupon${o.coupon ? ' ' + o.coupon : ''}: −${rupee(o.totals.discount)}` : '',
        `Delivery: ${o.totals.delivery ? rupee(o.totals.delivery) : 'FREE'}`,
        `*Total: ${total}* — ${o.payment === 'online' && o.paymentStatus === 'paid' ? 'paid online' : 'pay cash/UPI on delivery'}`,
      ].filter(Boolean);
      const city = /pune/i.test(o.address.street) ? '' : ', Pune';
      return {
        full: `${hi} your order *${o.id}* has been placed successfully ✅\nThank you for shopping with Farm’s Touch! 🧺\n\n${lines.join('\n')}\n\n${money.join('\n')}\nDelivery slot: ${slot}\nAddress: ${o.address.street}${city} ${o.address.pin}${track}${sign}`,
        short: oneLine(`your order has been placed successfully: ${o.items.length} item(s), total ${total} (${o.payment === 'online' && o.paymentStatus === 'paid' ? 'paid online' : 'cash/UPI on delivery'}), delivery ${slot}.`),
      };
    }
    case 'confirmed':
      return {
        full: `${hi} your order *${o.id}* is confirmed ✅\nDelivery: ${slot}\nTotal: ${total} (${o.payment === 'online' && o.paymentStatus === 'paid' ? 'paid online' : 'cash/UPI on delivery'})${track}${sign}`,
        short: oneLine(`your order is confirmed. Delivery ${slot}. Total ${total}, ${o.payment === 'online' && o.paymentStatus === 'paid' ? 'paid online' : 'cash/UPI on delivery'}.`),
      };
    case 'items_changed': {
      const changes = x.changes?.length ? x.changes : ['some items were updated'];
      const was = x.previousTotal !== undefined && x.previousTotal !== o.totals.total ? ` (was ${rupee(x.previousTotal)})` : '';
      return {
        full: `${hi} we had to update your order *${o.id}*${reason}:\n${changes.map((c) => '• ' + c).join('\n')}\n\nNew total: *${total}*${was}. Reply here if you have any questions.${track}${sign}`,
        short: oneLine(`we updated your order: ${changes.join('; ')}${reason}. New total ${total}${was}.`),
      };
    }
    case 'out_for_delivery': {
      const partner = o.assignee ? ` with ${o.assignee.name}${o.assignee.phone ? ` (${o.assignee.phone})` : ''}` : '';
      const paymentLine = o.payment === 'online' && o.paymentStatus === 'paid' ? 'Payment is already complete online; no cash is due.' : `Please keep *${total}* ready (cash or UPI).`;
      return {
        full: `${hi} your order *${o.id}* is out for delivery${partner} 🚚\n${paymentLine}${track}${sign}`,
        short: oneLine(`your order is out for delivery${partner}. ${paymentLine}`),
      };
    }
    case 'delivered': {
      const cash = x.cash ?? null;
      let pay = o.payment === 'online' && o.paymentStatus === 'paid' ? `Payment received online: ${total}.` : `Payment received: ${total}.`;
      if (!(o.payment === 'online' && o.paymentStatus === 'paid') && cash !== null && cash < o.totals.total) pay = `Payment received: ${rupee(cash)}. Balance due: ${rupee(o.totals.total - cash)}.`;
      else if (!(o.payment === 'online' && o.paymentStatus === 'paid') && cash !== null && cash > o.totals.total) pay = `Payment received: ${rupee(cash)} (bill ${total}).`;
      return {
        full: `${hi} your order *${o.id}* has been delivered ✅\n${pay}\nThank you for shopping with Farm’s Touch! 🙏${sign}`,
        short: oneLine(`your order has been delivered. ${pay} Thank you for shopping with us!`),
      };
    }
    case 'delivery_failed':
      return {
        full: `${hi} we could not deliver your order *${o.id}* today${reason}. We will call you to arrange a new time. Reply here to choose a time.${sign}`,
        short: oneLine(`we could not deliver your order today${reason}. We will call you to arrange a new time.`),
      };
    case 'cancelled': {
      const refund = o.payment !== 'online' ? ' No payment is due.'
        : o.paymentStatus === 'refunded' ? ' Your online payment has been refunded.'
          : o.paymentStatus === 'refund_failed' ? ' The store will contact you about your refund.'
            : ' Your online refund is being processed.';
      return {
        full: `${hi} your order *${o.id}* has been cancelled${reason}.${refund} We hope to serve you again soon.${sign}`,
        short: oneLine(`your order has been cancelled${reason}.${refund}`),
      };
    }
  }
}

export function offerNotice(name: string, text: string): { full: string; short: string } {
  return {
    full: `Hi ${firstName(name)}, ${text.trim()}\n\nOrder now on Farm’s Touch 🧺\n(Reply STOP to stop offer messages.)`,
    short: oneLine(text),
  };
}
