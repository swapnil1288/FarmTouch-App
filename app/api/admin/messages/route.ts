import { z } from 'zod';
import { requireStaff, type StaffSession } from '@/lib/server/staff';
import { getOrder, staffAccessProblem } from '@/lib/server/orders';
import { HttpError, errorResponse, json, readJsonBody } from '@/lib/server/http';
import {
  countTodo, createOfferBroadcast, dismiss, listNotifications, markManual, notificationOrderId, processQueue, retry, sendTest, whatsappStatus,
} from '@/lib/whatsapp-server';

async function requireOrderAccess(me: StaffSession, orderId: string): Promise<void> {
  const o = await getOrder(orderId, false);
  if (!o) throw new HttpError(404, 'Order not found.');
  const problem = staffAccessProblem(me, o);
  if (problem) throw new HttpError(403, problem);
}

/** GET ?status=todo|all|sent|failed|pending&orderId=FT-… */
export async function GET(request: Request) {
  try {
    const me = await requireStaff();
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId') ?? undefined;
    if (me.role !== 'admin') {
      // Packers / delivery partners only see messages for an order they can open.
      if (!orderId) throw new HttpError(403, 'Only admins can see all messages.');
      await requireOrderAccess(me, orderId);
    }
    return json({
      config: whatsappStatus(),
      todo: await countTodo(),
      messages: await listNotifications({ status: url.searchParams.get('status') ?? 'all', orderId, limit: orderId ? 50 : 200 }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('mark_sent'), id: z.number().int() }),
  z.object({ op: z.literal('dismiss'), id: z.number().int() }),
  z.object({ op: z.literal('retry'), id: z.number().int() }),
  z.object({ op: z.literal('process') }),
  z.object({ op: z.literal('offer'), text: z.string().trim().min(5, 'Write the offer text').max(600) }),
  z.object({ op: z.literal('test'), phone: z.string().trim().regex(/^(91)?[6-9]\d{9}$/, 'Enter a 10-digit mobile number') }),
]);

export async function POST(request: Request) {
  try {
    const parsed = opSchema.safeParse(await readJsonBody(request));
    const me = await requireStaff();
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid request.');
    const body = parsed.data;
    const by = `${me.name} (${me.role})`;
    switch (body.op) {
      case 'mark_sent':
        // Staff may confirm they sent a message by hand — non-admins only for orders they can open.
        if (me.role !== 'admin') {
          const orderId = await notificationOrderId(body.id);
          if (!orderId) throw new HttpError(403, 'Only admins can handle this message.');
          await requireOrderAccess(me, orderId);
        }
        if (!(await markManual(body.id, by))) throw new HttpError(409, 'This message was already handled.');
        return json({ ok: true });
      case 'dismiss':
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can dismiss messages.');
        if (!(await dismiss(body.id, by))) throw new HttpError(409, 'This message was already handled.');
        return json({ ok: true });
      case 'retry': {
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can retry messages.');
        const row = await retry(body.id);
        if (!row) throw new HttpError(404, 'Message not found.');
        return json({ message: row });
      }
      case 'process':
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can send offers.');
        return json(await processQueue(25));
      case 'offer':
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can send offers.');
        return json(await createOfferBroadcast(body.text));
      case 'test': {
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can send a test.');
        const r = await sendTest(body.phone.slice(-10));
        if (!r.ok) throw new HttpError(502, `WhatsApp did not accept the message: ${r.error}`);
        return json({ ok: true });
      }
    }
  } catch (e) {
    return errorResponse(e);
  }
}
