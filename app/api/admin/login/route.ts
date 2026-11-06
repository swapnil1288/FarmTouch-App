import { z } from 'zod';
import { checkLogin } from '@/lib/server/staff';
import { createStaffSession } from '@/lib/server/auth';
import { rateLimit } from '@/lib/server/rate-limit';
import { HttpError, errorResponse, readJsonBody } from '@/lib/server/http';

const schema = z.object({
  login: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(100),
  portal: z.enum(['admin', 'rider']).default('admin'),
}).strict();

/** POST { login: email or 10-digit phone, password } → sets the staff session cookie. */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    await rateLimit(request, 'login');
    if (!parsed.success) throw new HttpError(400, 'Enter your email (or phone) and password.');
    const member = await checkLogin(parsed.data.login, parsed.data.password);
    if (parsed.data.portal === 'rider' && member.role !== 'delivery') throw new HttpError(403, 'Use delivery staff credentials to sign in to the rider portal.');
    if (parsed.data.portal === 'admin' && member.role === 'delivery') throw new HttpError(403, 'Use the rider portal to sign in with delivery staff credentials.');
    const setCookie = await createStaffSession(member.email, request, member.role);
    return new Response(JSON.stringify({ ok: true, name: member.name, role: member.role }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': setCookie },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
