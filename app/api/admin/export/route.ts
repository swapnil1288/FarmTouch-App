import { ordersCsv } from '@/lib/server/reports';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse } from '@/lib/server/http';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    await requireStaff(['admin']);
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!DATE.test(from) || !DATE.test(to) || from > to) throw new HttpError(400, 'Choose a valid date range.');
    const csv = await ordersCsv(from, to);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="farmtouch-orders-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
