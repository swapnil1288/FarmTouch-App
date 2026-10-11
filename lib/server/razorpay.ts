import { env } from 'cloudflare:workers';
import { database } from '@/lib/database';
import type { NewOrder } from '@/lib/server/orders';
import type { OrderRecord } from '@/lib/orders';
import { getOrder } from '@/lib/server/orders';
import { alertStore, notifyCustomer, upsertCustomer } from '@/lib/whatsapp-server';
import { razorpayHmac, rupeesToPaise, verifyRazorpaySignature } from '@/lib/payment-signature';
import { HttpError, nowIso } from './http';

type GatewayConfig = { keyId: string; keySecret: string; webhookSecret: string };
type GatewayOrder = { id: string; amount: number; currency: string; status: string };
type GatewayPayment = { id: string; order_id: string; amount: number; currency: string; status: string };
export type PaymentIntentRow = {
  id: string; owner: string; request_key: string; payload: string; amount: number; razorpay_order_id: string;
  status: string; payment_id: string | null; created_at: string; expires_at: string;
  inventory_released: number; notifications_sent: number;
};

const HOLD_MINUTES = 30;
const encoder = new TextEncoder();

function gatewayConfig(requireWebhook = false): GatewayConfig {
  const values = env as unknown as { RAZORPAY_KEY_ID?: string; RAZORPAY_KEY_SECRET?: string; RAZORPAY_WEBHOOK_SECRET?: string };
  const keyId = values.RAZORPAY_KEY_ID?.trim() ?? '';
  const keySecret = values.RAZORPAY_KEY_SECRET?.trim() ?? '';
  const webhookSecret = values.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
  if (!keyId || !keySecret || (requireWebhook && !webhookSecret)) {
    throw new HttpError(503, requireWebhook ? 'Razorpay webhook is not configured.' : 'Online payment is not configured yet. Add Razorpay API keys in the server settings.');
  }
  return { keyId, keySecret, webhookSecret };
}

export function razorpayKeyId(): string {
  return gatewayConfig().keyId;
}

async function razorpayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { keyId, keySecret } = gatewayConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new HttpError(502, 'Could not reach the payment provider. Please try again.');
  }
  const data = await response.json().catch(() => null) as (T & { error?: { description?: string } }) | null;
  if (!response.ok || !data) {
    throw new HttpError(502, data?.error?.description || 'The payment provider could not process this request. Please try again.');
  }
  return data;
}

export async function createProviderOrder(amount: number, receipt: string): Promise<GatewayOrder> {
  const order = await razorpayRequest<GatewayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({ amount, currency: 'INR', receipt, notes: { farmtouch_order: receipt } }),
  });
  if (order.amount !== amount || order.currency !== 'INR' || !order.id) throw new HttpError(502, 'Payment provider returned an invalid order.');
  return order;
}

export async function getPaymentIntent(owner: string, requestKey: string): Promise<PaymentIntentRow | null> {
  return database().prepare('SELECT * FROM payment_intents WHERE owner = ? AND request_key = ?').bind(owner, requestKey).first<PaymentIntentRow>();
}

export async function getPaymentIntentByProviderOrder(id: string): Promise<PaymentIntentRow | null> {
  return database().prepare('SELECT * FROM payment_intents WHERE razorpay_order_id = ?').bind(id).first<PaymentIntentRow>();
}

export async function startPaymentIntent(owner: string, requestKey: string, order: NewOrder, packs: Record<string, number>) {
  const db = database();
  const previous = await getPaymentIntent(owner, requestKey);
  const now = nowIso();
  if (previous?.status === 'paid') return { intent: previous, created: false };
  if (previous?.status === 'pending' && previous.expires_at > now) return { intent: previous, created: false };

  const id = 'FT-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const amount = rupeesToPaise(order.totals.total);
  const gatewayOrder = await createProviderOrder(amount, id);
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();
  const payload = JSON.stringify({ ...order, id, payment: 'online', paymentStatus: 'pending', razorpayOrderId: gatewayOrder.id });
  const statements: D1PreparedStatement[] = Object.entries(packs).map(([productId, quantity]) =>
    db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?').bind(quantity, now, productId),
  );

  if (previous) {
    statements.push(db.prepare(`UPDATE payment_intents SET id = ?, payload = ?, amount = ?, razorpay_order_id = ?, status = 'pending', payment_id = NULL,
      created_at = ?, expires_at = ?, inventory_released = 0, notifications_sent = 0 WHERE owner = ? AND request_key = ? AND status != 'paid'`)
      .bind(id, payload, amount, gatewayOrder.id, now, expiresAt, owner, requestKey));
  } else {
    statements.push(db.prepare(`INSERT INTO payment_intents (id, owner, request_key, payload, amount, razorpay_order_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(id, owner, requestKey, payload, amount, gatewayOrder.id, now, expiresAt));
  }
  for (const [productId, quantity] of Object.entries(packs)) {
    statements.push(db.prepare('INSERT INTO payment_stock_holds (payment_intent_id, product_id, quantity) VALUES (?, ?, ?)').bind(id, productId, quantity));
  }

  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await getPaymentIntent(owner, requestKey);
    if (concurrent?.status === 'pending' && concurrent.expires_at > nowIso()) return { intent: concurrent, created: false };
    if (/CHECK constraint failed/i.test(String((error as Error)?.message ?? error))) {
      throw new HttpError(409, 'Some items just sold out. Please refresh your cart and try again.');
    }
    throw error;
  }

  const intent = await getPaymentIntent(owner, requestKey);
  if (!intent || intent.id !== id) throw new HttpError(409, 'Could not reserve this checkout. Please retry.');
  return { intent, created: true };
}

/** Releases inventory for abandoned checkouts; the hold rows make the release once-only. */
export async function expirePaymentIntents(): Promise<void> {
  const db = database();
  const now = nowIso();
  const expired = await db.prepare("SELECT id FROM payment_intents WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at LIMIT 100")
    .bind(now).all<{ id: string }>();
  for (const { id } of expired.results) {
    await db.batch([
      db.prepare("UPDATE payment_intents SET status = 'expired', inventory_released = 1 WHERE id = ? AND status = 'pending' AND expires_at <= ?").bind(id, now),
      db.prepare(`UPDATE products SET stock = stock + (
        SELECT COALESCE(SUM(quantity), 0) FROM payment_stock_holds WHERE payment_intent_id = ? AND product_id = products.id AND released_at IS NULL
      ) WHERE id IN (SELECT product_id FROM payment_stock_holds WHERE payment_intent_id = ? AND released_at IS NULL)
        AND EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'expired' AND inventory_released = 1)`)
        .bind(id, id, id),
      db.prepare('UPDATE payment_stock_holds SET released_at = ? WHERE payment_intent_id = ? AND released_at IS NULL').bind(now, id),
    ]);
  }
}

async function fetchPayment(paymentId: string): Promise<GatewayPayment> {
  return razorpayRequest<GatewayPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

async function capturePayment(payment: GatewayPayment, expectedOrderId: string, expectedAmount: number): Promise<GatewayPayment> {
  if (payment.order_id !== expectedOrderId || payment.amount !== expectedAmount || payment.currency !== 'INR') {
    throw new HttpError(400, 'Payment details do not match this order.');
  }
  if (payment.status === 'authorized') {
    await razorpayRequest<GatewayPayment>(`/payments/${encodeURIComponent(payment.id)}/capture`, {
      method: 'POST',
      body: JSON.stringify({ amount: expectedAmount, currency: 'INR' }),
    });
    return fetchPayment(payment.id);
  }
  if (payment.status !== 'captured') throw new HttpError(409, 'Payment is not captured yet. Please retry or choose another payment method.');
  return payment;
}

async function refundPayment(paymentId: string, amount: number): Promise<{ id: string; status: string }> {
  return razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amount, notes: { farmtouch_refund: paymentId } }),
  });
}

async function markRefunded(intentId: string, paymentId: string): Promise<void> {
  await database().prepare("UPDATE payment_intents SET status = 'refunded', payment_id = ? WHERE id = ? AND status = 'expired'")
    .bind(paymentId, intentId).run();
}

async function finalizePayment(intent: PaymentIntentRow, paymentId: string): Promise<{ order: Awaited<ReturnType<typeof getOrder>>; notify: boolean }> {
  const db = database();
  const now = nowIso();
  const order = JSON.parse(intent.payload) as NewOrder;
  const paidOrder: NewOrder = { ...order, paymentStatus: 'paid', razorpayPaymentId: paymentId };
  const key = `${intent.owner}:${intent.request_key}`;
  const results = await db.batch([
    db.prepare("UPDATE payment_intents SET status = 'paid', payment_id = ?, inventory_released = 1 WHERE id = ? AND status = 'pending' AND expires_at > ? AND inventory_released = 0")
      .bind(paymentId, intent.id, now),
    db.prepare(`INSERT INTO orders (id, owner, request_key, payload, created_at, status, slot, total, packed, updated_at)
      SELECT ?, ?, ?, ?, ?, 'placed', ?, ?, '[]', ? WHERE EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'paid')
      AND NOT EXISTS (SELECT 1 FROM orders WHERE request_key = ?)`)
      .bind(paidOrder.id, intent.owner, key, JSON.stringify(paidOrder), paidOrder.createdAt, paidOrder.slot, paidOrder.totals.total, now, intent.id, key),
    db.prepare(`INSERT INTO order_events (order_id, status, action, actor, note, created_at)
      SELECT ?, 'placed', 'placed', 'customer', 'Paid online with Razorpay', ?
      WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = ? AND action = 'placed')`)
      .bind(paidOrder.id, now, paidOrder.id, paidOrder.id),
    db.prepare('UPDATE payment_stock_holds SET released_at = ? WHERE payment_intent_id = ? AND released_at IS NULL').bind(now, intent.id),
    db.prepare('UPDATE payment_intents SET notifications_sent = 1 WHERE id = ? AND status = \'paid\' AND notifications_sent = 0').bind(intent.id),
  ]);
  const saved = await getOrder(intent.id);
  if (!saved) {
    const current = await getPaymentIntentByProviderOrder(intent.razorpay_order_id);
    if (current?.status === 'expired') {
      await refundPayment(paymentId, intent.amount);
      await markRefunded(intent.id, paymentId);
      throw new HttpError(409, 'This payment arrived after the stock hold expired. A refund has been requested; please place the order again.');
    }
    throw new HttpError(503, 'Payment is captured, but the order is still being confirmed. Please contact support with payment ID ' + paymentId + '.');
  }
  return { order: saved, notify: !!results[4]?.meta.changes };
}

async function sendOrderNotifications(order: NonNullable<Awaited<ReturnType<typeof getOrder>>>): Promise<string | undefined> {
  await upsertCustomer(order.address.phone, order.address.name, !!order.whatsappUpdates, !!order.whatsappOffers, order.createdAt).catch((e: unknown) => console.error(e));
  const whatsapp = await notifyCustomer('order_placed', order);
  await alertStore(order);
  return whatsapp;
}

export async function completePayment(razorpayOrderId: string, paymentId: string, signature: string, owner?: string) {
  const intent = await getPaymentIntentByProviderOrder(razorpayOrderId);
  if (!intent || (owner && intent.owner !== owner)) throw new HttpError(404, 'Payment order not found. Please restart checkout.');
  const { keySecret } = gatewayConfig();
  if (!await verifyRazorpaySignature(razorpayOrderId, paymentId, signature, keySecret)) {
    throw new HttpError(400, 'Payment signature could not be verified. Your order was not placed.');
  }
  const payment = await fetchPayment(paymentId);
  if (payment.order_id !== razorpayOrderId || payment.amount !== intent.amount || payment.currency !== 'INR') {
    throw new HttpError(400, 'Payment amount does not match this order.');
  }
  if (intent.status === 'expired') {
    if (payment.status === 'captured') {
      await refundPayment(paymentId, intent.amount);
      await markRefunded(intent.id, paymentId);
    }
    throw new HttpError(409, 'This checkout expired. Any captured payment will be refunded; please place the order again.');
  }
  if (intent.status === 'refunded') throw new HttpError(409, 'This payment has been refunded. Please place the order again.');
  if (intent.status !== 'paid' && intent.status !== 'pending') throw new HttpError(409, 'This payment cannot be completed. Please restart checkout.');
  const captured = await capturePayment(payment, razorpayOrderId, intent.amount);
  const result = await finalizePayment(intent, captured.id);
  const whatsapp = result.notify ? await sendOrderNotifications(result.order!) : undefined;
  return { order: result.order, whatsapp };
}

export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const { webhookSecret } = gatewayConfig(true);
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = await razorpayHmac(webhookSecret, rawBody);
  const left = encoder.encode(expected);
  const right = encoder.encode(signature.toLowerCase());
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.min(left.length, right.length); i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function processCapturedWebhook(orderId: string, paymentId: string): Promise<void> {
  const intent = await getPaymentIntentByProviderOrder(orderId);
  if (!intent) return;
  try {
    await completePayment(orderId, paymentId, await razorpayHmac(gatewayConfig().keySecret, `${orderId}|${paymentId}`));
  } catch (error) {
    if (intent.status === 'expired') console.error('Late Razorpay payment refund failed or needs review', intent.id, paymentId, error);
    else throw error;
  }
}

export async function refundPaidOnlineOrder(order: OrderRecord): Promise<void> {
  if (order.payment !== 'online' || order.paymentStatus !== 'paid') return;
  const db = database();
  if (!order.razorpayPaymentId) {
    await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', 'refund_failed') WHERE id = ?").bind(order.id).run();
    console.error('Paid online order is missing its Razorpay payment ID; refund needs manual review', order.id);
    return;
  }
  await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', 'refund_pending') WHERE id = ?")
    .bind(order.id).run();
  try {
    const refund = await refundPayment(order.razorpayPaymentId, order.totals.total * 100);
    const status = refund.status === 'processed' ? 'refunded' : 'refund_pending';
    await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', ?) WHERE id = ?")
      .bind(status, order.id).run();
  } catch (error) {
    console.error('Razorpay refund request failed', order.id, error);
    await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', 'refund_failed') WHERE id = ?").bind(order.id).run();
  }
}

export async function markOrderRefundProcessed(paymentId: string): Promise<void> {
  await database().prepare(`UPDATE orders SET payload = json_set(payload, '$.paymentStatus', 'refunded')
    WHERE json_extract(payload, '$.razorpayPaymentId') = ? AND json_extract(payload, '$.paymentStatus') = 'refund_pending'`)
    .bind(paymentId).run();
}