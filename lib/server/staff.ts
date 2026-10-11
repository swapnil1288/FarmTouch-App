// Staff identity and roles (server only).
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database } from '@/lib/database';
import { isStaffRole, type StaffRole } from '@/lib/workflow';
import type { StaffMember } from '@/lib/orders';
import { HttpError, nowIso } from './http';
import { sessionEmail, verifyPassword } from './auth';

export type StaffSession = { email: string; name: string; role: StaffRole; phone: string; via: 'password' | 'platform' };

/** Optional: owner emails that are admins when signed in through the hosting platform. */
function ownerEmails(): string[] {
  const raw = (env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS ?? '';
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Secret code needed to create the very first owner account. */
export function setupCode(): string {
  return ((env as unknown as { ADMIN_SETUP_CODE?: string }).ADMIN_SETUP_CODE ?? '').trim();
}

type StaffRow = {
  email: string; name: string; phone: string; role: string; active: number; created_at: string;
  password_hash: string; failed_logins: number; locked_until: string | null;
};

export function toStaffMember(r: StaffRow): StaffMember {
  return {
    email: r.email, name: r.name, phone: r.phone, role: isStaffRole(r.role) ? r.role : 'packer',
    active: !!r.active, createdAt: r.created_at, hasPassword: !!r.password_hash,
  };
}

async function staffRow(email: string): Promise<StaffRow | null> {
  return database().prepare('SELECT * FROM staff WHERE email = ?').bind(email.toLowerCase()).first<StaffRow>();
}

/** Signed-in staff member for the selected portal, or null. */
export async function getStaff(portal?: 'admin' | 'rider'): Promise<StaffSession | null> {
  const requestHeaders = await headers();
  const selectedPortal = portal ?? (requestHeaders.get('x-staff-portal') === 'rider' ? 'rider' : 'admin');
  try {
    const email = await sessionEmail(selectedPortal);
    if (email) {
      const row = await staffRow(email);
      const portalRole = selectedPortal === 'rider' ? row?.role === 'delivery' : row?.role === 'admin' || row?.role === 'packer';
      if (row && row.active && isStaffRole(row.role) && portalRole) return { email: row.email, name: row.name, role: row.role, phone: row.phone, via: 'password' };
    }
  } catch (e) {
    console.error('session lookup failed', e);
  }
  if (selectedPortal === 'rider') return null;
  const user = await getChatGPTUser();
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  let row: StaffRow | null = null;
  try {
    row = await staffRow(email);
  } catch (e) {
    console.error('staff lookup failed', e);
  }
  if (ownerEmails().includes(email)) {
    return { email, name: row?.name || user.fullName || email.split('@')[0], role: 'admin', phone: row?.phone ?? '', via: 'platform' };
  }
  if (!row || !row.active || !isStaffRole(row.role)) return null;
  return { email, name: row.name, role: row.role, phone: row.phone, via: 'platform' };
}

/** Throws 401/403 unless the user is active staff with one of the roles. */
export async function requireStaff(roles: StaffRole[] = ['admin', 'packer', 'delivery']): Promise<StaffSession> {
  const staff = await getStaff();
  if (!staff) throw new HttpError(401, 'Please log in to the staff panel.');
  if (!roles.includes(staff.role)) throw new HttpError(403, 'You do not have permission for this.');
  return staff;
}

export async function listStaff(): Promise<StaffMember[]> {
  const res = await database().prepare('SELECT * FROM staff ORDER BY active DESC, role, name').all<StaffRow>();
  return res.results.map(toStaffMember);
}

export async function findStaff(email: string): Promise<StaffMember | null> {
  const r = await staffRow(email);
  return r ? toStaffMember(r) : null;
}

/** True when no active admin can log in with a password yet (first-time setup). */
export async function needsSetup(): Promise<boolean> {
  const r = await database()
    .prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND active = 1 AND password_hash != ''")
    .first<{ n: number }>();
  return !r || r.n === 0;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** Checks email-or-phone + password. Returns the staff row or throws a friendly error. */
export async function checkLogin(login: string, password: string): Promise<StaffMember> {
  const id = login.trim().toLowerCase();
  const phone = id.replace(/\D/g, '').slice(-10);
  const db = database();
  const row = id.includes('@')
    ? await staffRow(id)
    : /^[6-9]\d{9}$/.test(phone)
      ? await db.prepare('SELECT * FROM staff WHERE phone = ? ORDER BY active DESC LIMIT 1').bind(phone).first<StaffRow>()
      : null;

  const now = nowIso();
  if (row?.locked_until && row.locked_until > now) {
    throw new HttpError(429, 'Too many wrong passwords. Please wait 15 minutes or ask the owner to reset your password.');
  }
  const ok = await verifyPassword(password, row?.password_hash ?? '');
  if (!row || !ok || !row.active) {
    if (row) {
      const failed = row.failed_logins + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
      await db.prepare('UPDATE staff SET failed_logins = ?, locked_until = ? WHERE email = ?').bind(lock ? 0 : failed, lock, row.email).run();
    }
    if (row && ok && !row.active) throw new HttpError(403, 'This account is disabled. Please contact the owner.');
    throw new HttpError(401, 'Wrong email/phone or password.');
  }
  await db.prepare('UPDATE staff SET failed_logins = 0, locked_until = NULL WHERE email = ?').bind(row.email).run();
  return toStaffMember(row);
}
