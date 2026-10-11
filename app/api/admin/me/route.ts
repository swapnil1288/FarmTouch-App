import { listStaff, requireStaff } from '@/lib/server/staff';
import { countTodo } from '@/lib/whatsapp-server';
import { errorResponse, json } from '@/lib/server/http';

export async function GET() {
  try {
    const me = await requireStaff();
    const partners = me.role === 'admin' ? (await listStaff()).filter((s) => s.active && s.role === 'delivery') : [];
    return json({ me, partners, messagesTodo: me.role === 'admin' ? await countTodo() : 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
