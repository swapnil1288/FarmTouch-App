import { database } from '@/lib/database';
import { istDate } from '@/lib/catalog';
import { listAllOrders } from '@/lib/server/orders';
import { paymentBreakdown } from '@/lib/settlement';
import { requireStaff } from '@/lib/server/staff';
import { errorResponse, json } from '@/lib/server/http';

export async function GET(request: Request) {
  try {
    await requireStaff(['admin']);
    const phone = new URL(request.url).searchParams.get('phone') ?? '';
    if (!/^\d{10}$/.test(phone)) return json({ orders: [] });

    const [orders, account] = await Promise.all([
      listAllOrders({ phone }),
      database().prepare('SELECT account_type, business_name FROM customers WHERE phone = ?').bind(phone).first<{ account_type: string; business_name: string }>(),
    ]);
    return json({
      orders: orders.map((order) => ({
        id: order.id,
        date: istDate(new Date(order.createdAt)),
        status: order.status,
        total: order.totals.total,
        payment: order.payment,
        paymentStatus: order.paymentStatus,
        ...paymentBreakdown(order),
        accountType: account?.account_type === 'b2b' ? 'b2b' : 'retail',
        businessName: account?.business_name ?? '',
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}