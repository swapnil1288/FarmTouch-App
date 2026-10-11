import { applyAction, getOrder, listOrders } from '@/lib/server/orders';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse, json, readJsonBody } from '@/lib/server/http';
import { isOrderAction, type OrderStatus } from '@/lib/workflow';
import { siteUrlFrom } from '@/lib/server/customer';
import { listNotifications } from '@/lib/whatsapp-server';

const PACKER_STATUSES: OrderStatus[] = ['placed', 'confirmed', 'packing', 'packed'];

/** GET ?id=FT-… for one order with timeline, or a filtered list. */
export async function GET(request: Request) {
  try {
    const staff = await requireStaff();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const order = await getOrder(id);
      if (!order) throw new HttpError(404, 'Order not found.');
      if (staff.role === 'delivery' && order.assignee?.email !== staff.email) throw new HttpError(403, 'This order is not assigned to you.');
      if (staff.role === 'packer' && !PACKER_STATUSES.includes(order.status)) throw new HttpError(403, 'Packers can only open orders that are waiting to be packed.');
      return json({ order });
    }
    const filter = {
      status: url.searchParams.get('status') ?? 'open',
      slot: url.searchParams.get('slot') ?? undefined,
      q: url.searchParams.get('q')?.slice(0, 50) ?? undefined,
      assignee: staff.role === 'delivery' ? staff.email : url.searchParams.get('assignee') ?? undefined,
      limit: 300,
    };
    let orders = await listOrders(filter);
    if (staff.role === 'packer') orders = orders.filter((o) => PACKER_STATUSES.includes(o.status));
    return json({ orders });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST { id, action, itemKey?, assignee?, cash?, note? } */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const staff = await requireStaff();
    if (typeof body.id !== 'string' || !isOrderAction(body.action)) throw new HttpError(400, 'Invalid request.');
    const startedAt = new Date().toISOString();
    const order = await applyAction(staff, body.id, {
      action: body.action,
      itemKey: typeof body.itemKey === 'string' ? body.itemKey : undefined,
      assignee: typeof body.assignee === 'string' ? body.assignee : undefined,
      cash: typeof body.cash === 'number' ? body.cash : typeof body.cash === 'string' && body.cash.trim() !== '' ? Number(body.cash) : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      changes: Array.isArray(body.changes)
        ? body.changes.slice(0, 40).filter((c): c is { key: string; qty?: number; remove?: boolean } => !!c && typeof (c as { key?: unknown }).key === 'string')
        : undefined,
    }, { siteUrl: siteUrlFrom(request) });
    // Customer messages that still need to be sent by hand (WhatsApp API not set up, or it failed).
    // Only messages created by THIS action (older ones stay in WhatsApp → To send).
    const pending = (await listNotifications({ orderId: order.id, status: 'todo', limit: 5 })).filter((m) => m.createdAt >= startedAt);
    return json({ order, pending });
  } catch (e) {
    return errorResponse(e);
  }
}
