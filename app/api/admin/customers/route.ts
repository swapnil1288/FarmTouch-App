import { z } from 'zod';
import { database } from '@/lib/database';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse, json, nowIso, readJsonBody } from '@/lib/server/http';

type Row = { phone: string; name: string; account_type: string; business_name: string; updates_opt_in: number; offers_opt_in: number; orders_count: number; last_order_at: string };

async function list(q: string) {
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const res = await database()
    .prepare('SELECT * FROM customers WHERE (? = \'\' OR name LIKE ? OR phone LIKE ? OR business_name LIKE ?) ORDER BY last_order_at DESC LIMIT 300')
    .bind(q, like, like, like)
    .all<Row>();
  const counts = await database().prepare('SELECT COUNT(*) AS total, SUM(updates_opt_in) AS updates, SUM(offers_opt_in) AS offers FROM customers').first<{ total: number; updates: number | null; offers: number | null }>();
  return {
    customers: res.results.map((r) => ({ phone: r.phone, name: r.name, accountType: r.account_type === 'b2b' ? 'b2b' : 'retail', businessName: r.business_name, updatesOptIn: !!r.updates_opt_in, offersOptIn: !!r.offers_opt_in, orders: r.orders_count, lastOrderAt: r.last_order_at })),
    totals: { total: counts?.total ?? 0, updates: counts?.updates ?? 0, offers: counts?.offers ?? 0 },
  };
}

export async function GET(request: Request) {
  try {
    await requireStaff(['admin']);
    return json(await list((new URL(request.url).searchParams.get('q') ?? '').slice(0, 40)));
  } catch (e) {
    return errorResponse(e);
  }
}

const schema = z.object({
  phone: z.string().regex(/^\d{10}$/),
  updatesOptIn: z.boolean().optional(),
  offersOptIn: z.boolean().optional(),
  accountType: z.enum(['retail', 'b2b']).optional(),
  businessName: z.string().trim().max(100).optional(),
}).strict();

/** Update messaging consent and/or the customer's account type. */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    await requireStaff(['admin']);
    if (!parsed.success) throw new HttpError(400, 'Invalid customer.');
    const c = parsed.data;
    const r = await database().prepare(`UPDATE customers SET
      updates_opt_in = COALESCE(?, updates_opt_in),
      offers_opt_in = COALESCE(?, offers_opt_in),
      account_type = COALESCE(?, account_type),
      business_name = COALESCE(?, business_name),
      updated_at = ?
      WHERE phone = ?`)
      .bind(c.updatesOptIn === undefined ? null : Number(c.updatesOptIn), c.offersOptIn === undefined ? null : Number(c.offersOptIn), c.accountType ?? null, c.businessName ?? null, nowIso(), c.phone).run();
    if (!r.meta.changes) throw new HttpError(404, 'Customer not found.');
    return json(await list(''));
  } catch (e) {
    return errorResponse(e);
  }
}
