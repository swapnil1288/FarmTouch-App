import { validateOrder, OrderValidationError } from '@/lib/order-validation';
import { customerOwnerOrCreate } from '@/lib/server/customer';
import { expirePaymentIntents, getPaymentIntent, razorpayKeyId, startPaymentIntent } from '@/lib/server/razorpay';
import { HttpError, errorResponse, json, nowIso, readJsonBody } from '@/lib/server/http';
import { loadCatalog } from '@/lib/server/products';
import { checkCouponUse, liveStore } from '@/lib/server/store';
import { rateLimit } from '@/lib/server/rate-limit';
import type { NewOrder } from '@/lib/server/orders';
import { getOrder } from '@/lib/server/orders';

function withCookie(response: Response, cookie?: string): Response {
  if (cookie) response.headers.append('Set-Cookie', cookie);
  return response;
}

export async function POST(request: Request) {
  try {
    const input = await readJsonBody(request);
    const { owner, setCookie } = await customerOwnerOrCreate(request);
    await expirePaymentIntents();
    const requestKey = input && typeof input === 'object' ? (input as { requestKey?: unknown }).requestKey : null;
    if (typeof requestKey !== 'string' || !/^[\w-]{16,60}$/.test(requestKey)) throw new HttpError(400, 'Checkout session is invalid. Please retry your order.');
    const previous = await getPaymentIntent(owner, requestKey);
    if (previous?.status === 'paid') {
      const saved = await getOrder(previous.id);
      if (saved) return withCookie(json({ order: saved, paid: true, replay: true }), setCookie);
    }
    if (previous?.status === 'expired' || previous?.status === 'refunded') {
      throw new HttpError(409, 'This payment session expired. Start a fresh online payment attempt.');
    }
    if (previous?.status === 'pending' && previous.expires_at > nowIso()) {
      return withCookie(json({
        keyId: razorpayKeyId(),
        razorpayOrderId: previous.razorpay_order_id,
        amount: previous.amount,
        currency: 'INR',
        internalOrderId: previous.id,
        expiresAt: previous.expires_at,
      }), setCookie);
    }
    // Only new checkouts count (resuming an open one above is free).
    await rateLimit(request, 'checkout');
    let validated: ReturnType<typeof validateOrder>;
    const store = await liveStore();
    try {
      validated = validateOrder(input, await loadCatalog(store.coupons), store);
    } catch (error) {
      if (error instanceof OrderValidationError) throw new HttpError(400, error.message);
      throw error;
    }
    const { body, totals, slotLabel, items, packs } = validated;
    if (body.payment !== 'online') throw new HttpError(400, 'Choose online payment to continue.');
    await checkCouponUse(body.coupon, body.address.phone);

    const order: NewOrder = {
      id: 'FT-PENDING',
      lines: body.lines,
      items,
      totals,
      coupon: body.coupon,
      address: body.address,
      slot: body.slot,
      slotLabel,
      payment: 'online',
      paymentStatus: 'pending',
      replacement: body.replacement,
      whatsappUpdates: body.whatsappUpdates,
      whatsappOffers: body.whatsappOffers,
      createdAt: nowIso(),
    };
    const { intent } = await startPaymentIntent(owner, body.requestKey, order, packs);
    if (intent.status === 'paid') {
      const saved = await getOrder(intent.id);
      if (saved) return withCookie(json({ order: saved, paid: true, replay: true }), setCookie);
      throw new HttpError(409, 'This payment is already being finalized. Check your order history before retrying.');
    }
    return withCookie(json({
      keyId: razorpayKeyId(),
      razorpayOrderId: intent.razorpay_order_id,
      amount: intent.amount,
      currency: 'INR',
      internalOrderId: intent.id,
      expiresAt: intent.expires_at,
    }), setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}