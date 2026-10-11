import { dashboard } from '@/lib/server/reports';
import { requireStaff } from '@/lib/server/staff';
import { errorResponse, json } from '@/lib/server/http';

export async function GET(request: Request) {
  try {
    await requireStaff(['admin']);
    const days = Number(new URL(request.url).searchParams.get('days') ?? 7);
    return json(await dashboard([7, 14, 30].includes(days) ? days : 7));
  } catch (e) {
    return errorResponse(e);
  }
}
