import { getOrder } from '@/lib/server/orders';
import { HttpError, errorResponse, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

/**
 * Public order tracking: GET ?id=FT-XXXXXXXX&phone=98XXXXXXXX
 * Both must match, so nobody can look up someone else's order by guessing.
 */
export async function GET(request: Request) {
  try {
    await rateLimit(request, 'track');
    const url = new URL(request.url);
    const id = (url.searchParams.get('id') ?? '').trim().toUpperCase();
    const phone = (url.searchParams.get('phone') ?? '').replace(/\D/g, '').slice(-10);
    if (!/^FT-[A-Z0-9]{8}$/.test(id) || !/^\d{10}$/.test(phone)) throw new HttpError(400, 'Enter your order ID (like FT-1A2B3C4D) and 10-digit mobile number.');
    const o = await getOrder(id);
    if (!o || o.address.phone !== phone) throw new HttpError(404, 'No order found with that ID and mobile number.');
    // Only what the customer needs; no staff details or internal notes.
    return json({
      order: {
        id: o.id, status: o.status, items: o.items, totals: o.totals, coupon: o.coupon, slotLabel: o.slotLabel, createdAt: o.createdAt,
        address: { name: o.address.name, street: o.address.street, pin: o.address.pin, phone: o.address.phone },
        lines: o.lines, packed: [], cashCollected: null, updatedAt: o.updatedAt, slot: o.slot, payment: o.payment, replacement: o.replacement,
        paymentStatus: o.paymentStatus,
        assignee: o.status === 'out_for_delivery' && o.assignee ? { name: o.assignee.name, phone: o.assignee.phone } : null,
        events: (o.events ?? []).filter((e) => !['note', 'toggle_item', 'assign'].includes(e.action)).map((e) => ({ ...e, actor: e.actor === 'customer' ? 'You' : 'Farm’s Touch' })),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
