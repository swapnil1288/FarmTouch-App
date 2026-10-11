import { destroyStaffSession } from '@/lib/server/auth';
import { errorResponse, readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    await readJsonBody(request);
    const setCookie = await destroyStaffSession(request);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': setCookie } });
  } catch (e) {
    return errorResponse(e);
  }
}
