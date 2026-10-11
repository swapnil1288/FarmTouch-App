import { z } from 'zod';
import { database } from '@/lib/database';
import { STAFF_ROLES } from '@/lib/workflow';
import { listStaff, requireStaff } from '@/lib/server/staff';
import { endAllSessions, hashPassword, passwordProblem } from '@/lib/server/auth';
import { HttpError, errorResponse, json, nowIso, readJsonBody } from '@/lib/server/http';

export async function GET() {
  try {
    await requireStaff(['admin']);
    return json({ staff: await listStaff() });
  } catch (e) {
    return errorResponse(e);
  }
}

const staffSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
    name: z.string().trim().min(2, 'Enter the staff member’s name').max(60),
    phone: z.string().trim().regex(/^([6-9]\d{9})?$/, 'Enter a 10-digit mobile number (or leave empty)').default(''),
    role: z.enum(STAFF_ROLES),
    active: z.boolean(),
    /** Optional: set or reset this person's password. */
    password: z.string().max(100).optional(),
  })
  .strict();

/** POST { email, name, phone, role, active, password? } – create or update a staff member (admin only). */
export async function POST(request: Request) {
  try {
    const input = await readJsonBody(request);
    const me = await requireStaff(['admin']);
    const parsed = staffSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the staff details.');
    const s = parsed.data;
    if (s.email === me.email && (!s.active || s.role !== 'admin')) throw new HttpError(400, 'You cannot remove your own admin access.');
    const db = database();
    if (s.phone) {
      const clash = await db.prepare('SELECT name FROM staff WHERE phone = ? AND email != ?').bind(s.phone, s.email).first<{ name: string }>();
      if (clash) throw new HttpError(400, `This mobile number is already used by ${clash.name}.`);
    }
    const existing = await db.prepare('SELECT password_hash FROM staff WHERE email = ?').bind(s.email).first<{ password_hash: string }>();
    const newPassword = s.password?.trim() ? s.password : '';
    if (newPassword) {
      const problem = passwordProblem(newPassword);
      if (problem) throw new HttpError(400, problem);
    } else if (!existing?.password_hash) {
      throw new HttpError(400, 'Set a password so this person can log in (at least 8 characters).');
    }
    const hash = newPassword ? await hashPassword(newPassword) : existing!.password_hash;
    await db
      .prepare(
        `INSERT INTO staff (email, name, phone, role, active, created_at, password_hash, failed_logins) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = excluded.phone, role = excluded.role, active = excluded.active,
           password_hash = excluded.password_hash, failed_logins = CASE WHEN excluded.password_hash != staff.password_hash THEN 0 ELSE staff.failed_logins END,
           locked_until = CASE WHEN excluded.password_hash != staff.password_hash THEN NULL ELSE staff.locked_until END`,
      )
      .bind(s.email, s.name, s.phone, s.role, s.active ? 1 : 0, nowIso(), hash)
      .run();
    // Disabled or password reset → sign them out everywhere.
    if (!s.active || newPassword) await endAllSessions(s.email);
    return json({ staff: await listStaff() });
  } catch (e) {
    return errorResponse(e);
  }
}
