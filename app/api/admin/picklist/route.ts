import { pickList } from '@/lib/server/orders';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse, json } from '@/lib/server/http';

export async function GET(request: Request) {
  try {
    await requireStaff(['admin', 'packer']);
    const date = new URL(request.url).searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose a delivery date.');
    return json(await pickList(date));
  } catch (e) {
    return errorResponse(e);
  }
}
