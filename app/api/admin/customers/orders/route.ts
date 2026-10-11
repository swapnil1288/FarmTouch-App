import { database } from '@/lib/database';
import { istDate } from '@/lib/catalog';
import { listOrders } from '@/lib/server/orders';
import { requireStaff } from '@/lib/server/staff';
import { errorResponse, json } from '@/lib/server/http';

export async function GET(request: Request) {
  try {
    await requireStaff(['admin']);
    const phone = new URL(request.url).searchParams.get('phone') ?? '';
    if (!/^\d{10}$/.test(phone)) return json({ orders: [] });

    const [orders, account] = await Promise.all([
      listOrders({ q: phone, limit: 2000 }),
      database().prepare('SELECT account_type, business_name FROM customers WHERE phone = ?').bind(phone).first<{ account_type: string; business_name: string }>(),
    ]);
    return json({
      orders: orders.filter((order) => order.address.phone === phone).map((order) => ({
        id: order.id,
        date: istDate(new Date(order.createdAt)),
        status: order.status,
        total: order.totals.total,
        payment: order.payment,
        paymentStatus: order.paymentStatus,
        cashCollected: order.status === 'delivered' && order.payment !== 'online' ? (order.cashCollected ?? 0) : 0,
        onlinePaid: order.payment === 'online' && order.paymentStatus === 'paid' ? order.totals.total : 0,
        pendingCollection: order.status === 'cancelled' || (order.payment === 'online' && order.paymentStatus === 'paid') ? 0 : Math.max(0, order.totals.total - (order.cashCollected ?? 0)),
        accountType: account?.account_type === 'b2b' ? 'b2b' : 'retail',
        businessName: account?.business_name ?? '',
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}