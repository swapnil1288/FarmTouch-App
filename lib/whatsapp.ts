// WhatsApp click-to-chat helpers (safe for browser and server).
// Uses the official https://wa.me/<number>?text=<message> format, which opens
// the WhatsApp app on phones and WhatsApp Web on desktop.

import type { Totals } from './catalog';
import type { OrderAddress, OrderItem } from './orders';
import { STATUS_LABEL, type OrderStatus } from './workflow';

/** Digits only, with country code, e.g. "919876543210". */
export function normaliseWhatsAppNumber(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits; // assume India
  return digits.length >= 11 && digits.length <= 15 ? digits : '';
}

/**
 * Builds a wa.me link. When no number is known, the link opens WhatsApp's
 * "choose a chat" screen with the message pre-filled instead of a wrong number.
 */
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${normaliseWhatsAppNumber(number)}?text=${encodeURIComponent(text)}`;
}

const rupee = (v: number) => '₹' + v.toLocaleString('en-IN');

export function describeItem(it: OrderItem): string {
  if (it.components?.length) {
    const packs = it.multiplier && it.multiplier > 1 ? ` (${it.multiplier}× packs)` : '';
    return `${it.name} × ${it.qty}${packs}: ${it.components.map((c) => c.name).join(', ')}`;
  }
  return `${it.name}${it.unit ? ` (${it.unit})` : ''} × ${it.qty}`;
}

export type WhatsAppOrderDetails = {
  items: OrderItem[];
  totals: Totals;
  coupon?: string;
  orderId?: string;
  slotLabel?: string;
  replacement?: 'ask' | 'omit';
  address?: OrderAddress | null;
  payment?: 'cod' | 'online';
  paymentStatus?: string;
};

export function buildOrderMessage(d: WhatsAppOrderDetails): string {
  const out: string[] = [];
  out.push(d.orderId ? `Hi Farm’s Touch! My order ${d.orderId}:` : 'Hi Farm’s Touch! I’d like to order:');
  out.push('');
  d.items.forEach((it, i) => out.push(`${i + 1}. ${describeItem(it)}`));
  out.push('');
  out.push(`Items: ${rupee(d.totals.subtotal)}`);
  if (d.totals.discount) out.push(`Coupon${d.coupon ? ' ' + d.coupon : ''}: −${rupee(d.totals.discount)}`);
  out.push(`Delivery: ${d.totals.delivery ? rupee(d.totals.delivery) : 'FREE'}`);
  out.push(`*Total: ${rupee(d.totals.total)}* (${d.payment === 'online' && d.paymentStatus === 'paid' ? 'Paid online' : 'Cash on delivery'})`);
  if (d.slotLabel) out.push(`Slot: ${d.slotLabel}`);
  if (d.replacement) out.push(`If unavailable: ${d.replacement === 'ask' ? 'ask me first' : 'remove the item'}`);
  out.push('');
  if (d.address?.street) {
    const city = /pune/i.test(d.address.street) ? '' : ', Pune';
    out.push(`Deliver to: ${d.address.name}, ${d.address.street}${city} ${d.address.pin}`);
    out.push(`Phone: ${d.address.phone}`);
  } else {
    out.push('I’ll share my delivery address here.');
  }
  return out.join('\n');
}

/** Message the shop/delivery partner sends to a customer about their order. */
export function statusMessage(customerName: string, orderId: string, status: OrderStatus, total: number, extra = '', payment: 'cod' | 'online' = 'cod'): string {
  const first = customerName.split(' ')[0] || 'there';
  const lines: Record<OrderStatus, string> = {
    placed: `we have received your order ${orderId}.`,
    confirmed: `your order ${orderId} is confirmed.`,
    packing: `we are packing your order ${orderId} now.`,
    packed: `your order ${orderId} is packed and will leave soon.`,
    out_for_delivery: payment === 'online' ? `your order ${orderId} is out for delivery. It has been paid online; no cash is due.` : `your order ${orderId} is out for delivery. Please keep ${rupee(total)} ready (cash/UPI).`,
    delivered: `your order ${orderId} has been delivered. Thank you for shopping with Farm’s Touch!`,
    cancelled: `your order ${orderId} has been cancelled.`,
  };
  return `Hi ${first}, ${lines[status]}${extra ? ' ' + extra : ''}\n— Farm’s Touch (${STATUS_LABEL[status]})`;
}

export function productShareMessage(name: string, unit: string, price: number): string {
  return `${name} (${unit}) is just ${rupee(price)} at Farm’s Touch — fresh from Pune farms!`;
}

export const SUPPORT_MESSAGE = 'Hi Farm’s Touch! I have a question about my order.';

export function mapsLink(address: OrderAddress): string {
  const city = /pune/i.test(address.street) ? '' : ', Pune';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.street}${city} ${address.pin}`)}`;
}
