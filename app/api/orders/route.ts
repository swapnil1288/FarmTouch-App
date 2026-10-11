import { OrderValidationError, validateOrder } from '@/lib/order-validation';
import { alertStore, notifyCustomer, upsertCustomer } from '@/lib/whatsapp-server';
import { createOrder, findOrderByRequest, listCustomerOrders } from '@/lib/server/orders';
import { loadCatalog } from '@/lib/server/products';
import { customerOwner, customerOwnerOrCreate, siteUrlFrom } from '@/lib/server/customer';
import { HttpError, errorResponse, json, nowIso, readJsonBody } from '@/lib/server/http';

/** Orders placed from this device / account. */
export async function GET() {
  try {
    const owner = await customerOwner();
    return json({ orders: owner ? await listCustomerOrders(owner) : [] });
  } catch (e) {
    console.error(e);
    return json({ error: 'Orders could not be loaded. Please try again.' }, 503);
  }
}

function withCookie(res: Response, setCookie?: string): Response {
  if (setCookie) res.headers.append('Set-Cookie', setCookie);
  return res;
}

export async function POST(request: Request) {
  try {
    // Read the body first (replying before the body is drained can drop the connection).
    const input = await readJsonBody(request);
    if (input && typeof input === 'object' && 'payment' in input && input.payment === 'online') {
      throw new HttpError(400, 'Online orders must be confirmed through the secure payment checkout.');
    }
    const { owner, setCookie } = await customerOwnerOrCreate(request);

    // A retry of an order that was already saved returns it, even if stock has since run out.
    const key = (input as { requestKey?: unknown })?.requestKey;
    if (typeof key === 'string' && /^[\w-]{16,60}$/.test(key)) {
      const saved = await findOrderByRequest(owner, key);
      if (saved) return withCookie(json({ order: saved, replay: true }), setCookie);
    }
    const catalog = await loadCatalog();
    let validated: ReturnType<typeof validateOrder>;
    try {
      validated = validateOrder(input, catalog);
    } catch (e) {
      if (e instanceof OrderValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    const { body: b, totals, slotLabel, items, packs } = validated;
    const createdAt = nowIso();
    const { order, created } = await createOrder(
      owner,
      b.requestKey,
      {
        id: 'FT-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
        lines: b.lines,
        items,
        totals,
        coupon: b.coupon,
        address: b.address,
        slot: b.slot,
        slotLabel,
        payment: b.payment,
        replacement: b.replacement,
        whatsappUpdates: b.whatsappUpdates,
        whatsappOffers: b.whatsappOffers,
        createdAt,
      },
      packs,
    );
    if (!order) throw new Error('Order missing after save');
    // Only the request that created the order sends messages (no duplicates on retry). Never blocks the order.
    let whatsapp: string | undefined;
    if (created) {
      await upsertCustomer(b.address.phone, b.address.name, b.whatsappUpdates, b.whatsappOffers, createdAt).catch((e: unknown) => console.error(e));
      // "Your order has been placed successfully" to the customer's own WhatsApp number.
      whatsapp = await notifyCustomer('order_placed', order, { siteUrl: siteUrlFrom(request) });
      await alertStore(order);
    }
    return withCookie(json({ order, replay: !created, whatsapp }, created ? 201 : 200), setCookie);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    console.error(e);
    return json({ error: 'Could not place your order. Your cart is saved — please try again.' }, 503);
  }
}
