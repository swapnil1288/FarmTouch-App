import { z } from 'zod';
import { database } from '@/lib/database';
import { needsSetup, setupCode } from '@/lib/server/staff';
import { createStaffSession, hashPassword, passwordProblem } from '@/lib/server/auth';
import { rateLimit } from '@/lib/server/rate-limit';
import { HttpError, errorResponse, nowIso, readJsonBody } from '@/lib/server/http';

const schema = z
  .object({
    code: z.string().trim().max(200),
    name: z.string().trim().min(2, 'Enter your name').max(60),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
    phone: z.string().trim().regex(/^([6-9]\d{9})?$/, 'Enter a 10-digit mobile number (or leave empty)'),
    password: z.string(),
  })
  .strict();

/** Creates the first owner (admin) account. Only works while no admin has a password, and needs ADMIN_SETUP_CODE. */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    await rateLimit(request, 'setup');
    if (!(await needsSetup())) throw new HttpError(409, 'The owner account already exists. Please log in.');
    const expected = setupCode();
    if (!expected) throw new HttpError(503, 'Setup is locked. Set the ADMIN_SETUP_CODE variable first (see README).');
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the details.');
    const s = parsed.data;
    if (s.code !== expected) throw new HttpError(403, 'Wrong setup code.');
    const problem = passwordProblem(s.password);
    if (problem) throw new HttpError(400, problem);
    await database()
      .prepare(
        `INSERT INTO staff (email, name, phone, role, active, created_at, password_hash, failed_logins) VALUES (?, ?, ?, 'admin', 1, ?, ?, 0)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = excluded.phone, role = 'admin', active = 1, password_hash = excluded.password_hash, failed_logins = 0, locked_until = NULL`,
      )
      .bind(s.email, s.name, s.phone, nowIso(), await hashPassword(s.password))
      .run();
    const setCookie = await createStaffSession(s.email, request, 'admin');
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': setCookie } });
  } catch (e) {
    return errorResponse(e);
  }
}
