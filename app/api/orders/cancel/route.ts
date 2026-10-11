import { customerCancel } from '@/lib/server/orders';
import { customerOwner, siteUrlFrom } from '@/lib/server/customer';
import { HttpError, errorResponse, json, readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { id?: unknown };
    const owner = await customerOwner();
    if (!owner) throw new HttpError(404, 'Order not found on this device.');
    if (typeof body?.id !== 'string' || !/^FT-[A-Z0-9]{8}$/.test(body.id)) throw new HttpError(400, 'Invalid order.');
    return json({ order: await customerCancel(owner, body.id, siteUrlFrom(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
