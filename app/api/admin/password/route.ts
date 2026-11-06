import { z } from 'zod';
import { database } from '@/lib/database';
import { requireStaff } from '@/lib/server/staff';
import { STAFF_COOKIE, STAFF_COOKIES, endAllSessions, hashPassword, passwordProblem, readCookie, verifyPassword } from '@/lib/server/auth';
import { HttpError, errorResponse, json, readJsonBody } from '@/lib/server/http';

const schema = z.object({ current: z.string().max(100).default(''), next: z.string() }).strict();

/** POST { current, next } – change your own password (signs out your other devices). */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    const me = await requireStaff();
    if (!parsed.success) throw new HttpError(400, 'Enter your current and new password.');
    const row = await database().prepare('SELECT password_hash FROM staff WHERE email = ?').bind(me.email).first<{ password_hash: string }>();
    if (!row) throw new HttpError(404, 'Your staff record was not found. Ask the owner to add you in Staff.');
    if (row.password_hash && !(await verifyPassword(parsed.data.current, row.password_hash))) throw new HttpError(403, 'Current password is wrong.');
    const problem = passwordProblem(parsed.data.next);
    if (problem) throw new HttpError(400, problem);
    await database().prepare('UPDATE staff SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE email = ?').bind(await hashPassword(parsed.data.next), me.email).run();
    // Keep this device signed in: sessions use a per-role cookie (older ones the legacy name).
    const cookies = request.headers.get('cookie');
    const current = readCookie(cookies, STAFF_COOKIES[me.role]) ?? readCookie(cookies, STAFF_COOKIE);
    await endAllSessions(me.email, current);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
