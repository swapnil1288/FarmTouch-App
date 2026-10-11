import { z } from 'zod';
import { customerOwner } from '@/lib/server/customer';
import { completePayment } from '@/lib/server/razorpay';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';

const schema = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) return json({ error: 'Payment verification details are invalid.' }, 400);
    const owner = await customerOwner();
    if (!owner) return json({ error: 'Checkout session expired. Please place the order again.' }, 401);
    const result = await completePayment(
      parsed.data.razorpay_order_id,
      parsed.data.razorpay_payment_id,
      parsed.data.razorpay_signature,
      owner,
    );
    return json({ order: result.order, whatsapp: result.whatsapp });
  } catch (error) {
    return errorResponse(error);
  }
}