import { publicOrigin } from './origin';
// Passwords, staff sessions and customer device identity (server only).
import { headers } from 'next/headers';
import { database } from '@/lib/database';
import { nowIso } from './http';

// ---------------------------------------------------------------- passwords

// PBKDF2 iterations: 100,000 is the maximum supported by the Workers runtime.
const ITERATIONS = 100_000;
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${ITERATIONS}:${toHex(salt)}:${toHex(await derive(password, salt, ITERATIONS))}`;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const DUMMY = `${ITERATIONS}:${'00'.repeat(16)}:${'00'.repeat(32)}`;

/** Constant-time check. Pass '' as stored to burn the same time for unknown users. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iter, saltHex, hashHex] = (stored || DUMMY).split(':');
  const iterations = Number(iter);
  if (!iterations || !saltHex || !hashHex) return false;
  const actual = await derive(password, fromHex(saltHex), Math.min(iterations, ITERATIONS));
  return equal(actual, fromHex(hashHex)) && !!stored;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 100) return 'Password is too long.';
  if (/^\d+$/.test(pw) && pw.length < 10) return 'Use letters and numbers, not only digits.';
  return null;
}

// ---------------------------------------------------------------- cookies

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function isSecure(request: Request): boolean {
  return new URL(publicOrigin(request)).protocol === 'https:';
}

async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------------------------------------------------------------- staff sessions

export const STAFF_COOKIE = 'ft_staff';
export const STAFF_COOKIES = {
  admin: 'ft_staff_admin',
  packer: 'ft_staff_packer',
  delivery: 'ft_staff_delivery',
} as const;
const SESSION_DAYS = 30;

/** Creates a session and returns the Set-Cookie header value. */
export async function createStaffSession(email: string, request: Request, role: keyof typeof STAFF_COOKIES = 'admin'): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  const db = database();
  await db.batch([
    db.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').bind(now.toISOString()),
    db.prepare('INSERT INTO staff_sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), email, now.toISOString(), expires.toISOString()),
  ]);
  return cookie(STAFF_COOKIES[role], token, SESSION_DAYS * 86400, isSecure(request));
}

/** Email of the staff member signed in on this request (valid, unexpired session), or null. */
export async function sessionEmail(portal?: 'admin' | 'rider'): Promise<string | null> {
  const requestHeaders = await headers();
  const selectedPortal = portal ?? (requestHeaders.get('x-staff-portal') === 'rider' ? 'rider' : 'admin');
  const cookieHeader = requestHeaders.get('cookie');
  const cookieNames = selectedPortal === 'rider'
    ? [STAFF_COOKIES.delivery, STAFF_COOKIE]
    : [STAFF_COOKIES.admin, STAFF_COOKIES.packer, STAFF_COOKIE];
  const db = database();
  for (const name of cookieNames) {
    const token = readCookie(cookieHeader, name);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) continue;
    const row = await db
      .prepare('SELECT email FROM staff_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(await sha256(token), nowIso())
      .first<{ email: string }>();
    if (row?.email) return row.email;
  }
  return null;
}

export async function destroyStaffSession(request: Request): Promise<string> {
  const portal = request.headers.get('x-staff-portal') === 'rider' ? 'rider' : 'admin';
  const cookieHeader = request.headers.get('cookie');
  const cookieNames = portal === 'rider'
    ? [STAFF_COOKIES.delivery, STAFF_COOKIE]
    : [STAFF_COOKIES.admin, STAFF_COOKIES.packer, STAFF_COOKIE];
  const cookieName = cookieNames.find((name) => readCookie(cookieHeader, name)) ?? cookieNames[0];
  const token = readCookie(cookieHeader, cookieName);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await database().prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return cookie(cookieName, '', 0, isSecure(request));
}

/** Signs a staff member out everywhere (after a password change or when disabled). */
export async function endAllSessions(email: string, keepCookieToken?: string | null): Promise<void> {
  const db = database();
  if (keepCookieToken && /^[0-9a-f]{64}$/.test(keepCookieToken)) {
    await db.prepare('DELETE FROM staff_sessions WHERE email = ? AND token_hash != ?').bind(email, await sha256(keepCookieToken)).run();
  } else {
    await db.prepare('DELETE FROM staff_sessions WHERE email = ?').bind(email).run();
  }
}

// ---------------------------------------------------------------- customer identity (no sign-in needed)

export const CUSTOMER_COOKIE = 'ft_cid';

/** Device id cookie for customers who are not signed in to the hosting platform. */
export async function customerDeviceId(): Promise<string | null> {
  const id = readCookie((await headers()).get('cookie'), CUSTOMER_COOKIE);
  return id && /^[0-9a-f]{32}$/.test(id) ? id : null;
}

export function newCustomerDevice(request: Request): { id: string; setCookie: string } {
  const id = randomToken(16);
  return { id, setCookie: cookie(CUSTOMER_COOKIE, id, 400 * 86400, isSecure(request)) };
}
