import { markOrderRefundProcessed, processCapturedWebhook, verifyWebhookSignature } from '@/lib/server/razorpay';
import { errorResponse, json } from '@/lib/server/http';

type WebhookEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    refund?: { entity?: { payment_id?: string } };
  };
};

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 64_000) return json({ error: 'Webhook payload is too large.' }, 413);
    const signature = request.headers.get('x-razorpay-signature') ?? '';
    if (!await verifyWebhookSignature(raw, signature)) return json({ error: 'Invalid webhook signature.' }, 400);
    let event: WebhookEvent;
    try {
      event = JSON.parse(raw) as WebhookEvent;
    } catch {
      return json({ error: 'Invalid webhook payload.' }, 400);
    }
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (!payment?.id || !payment.order_id) return json({ error: 'Payment event is incomplete.' }, 400);
      await processCapturedWebhook(payment.order_id, payment.id);
    }
    if (event.event === 'refund.processed') {
      const paymentId = event.payload?.refund?.entity?.payment_id;
      if (!paymentId) return json({ error: 'Refund event is incomplete.' }, 400);
      await markOrderRefundProcessed(paymentId);
    }
    return json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}