// Per-client-IP request limits stored in D1 (server only).
//
// Fixed windows: at most `limit` requests per `windowSeconds` for each action + IP.
// The client IP comes from CF-Connecting-IP (set by Cloudflare, cannot be forged by
// the browser). If your hosting puts the real visitor IP in a different header, set
// CLIENT_IP_HEADER. Requests without that header (e.g. local development) are not limited.
import { env } from 'cloudflare:workers';
import { database } from '@/lib/database';
import { HttpError } from './http';

export const LIMITS = {
  /** Staff password logins. Also slows down attempts to lock accounts by guessing. */
  login: { limit: 20, windowSeconds: 15 * 60 },
  /** First-owner setup (guards the setup code). */
  setup: { limit: 10, windowSeconds: 60 * 60 },
  /** Public order tracking by order ID + phone. */
  track: { limit: 30, windowSeconds: 10 * 60 },
  /** New cash-on-delivery orders (each one reserves stock). */
  order: { limit: 15, windowSeconds: 60 * 60 },
  /** New online checkouts (each one reserves stock for 30 minutes). */
  checkout: { limit: 15, windowSeconds: 10 * 60 },
} as const;

export type LimitedAction = keyof typeof LIMITS;

function clientIp(request: Request): string | null {
  const header = ((env as unknown as { CLIENT_IP_HEADER?: string }).CLIENT_IP_HEADER ?? '').trim() || 'cf-connecting-ip';
  const raw = request.headers.get(header)?.split(',')[0]?.trim();
  return raw ? raw.slice(0, 64) : null;
}

/** Throws 429 when this client has used up the action's allowance. Fails open if storage is unavailable. */
export async function rateLimit(request: Request, action: LimitedAction): Promise<void> {
  const ip = clientIp(request);
  if (!ip) return;
  const { limit, windowSeconds } = LIMITS[action];
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  let count = 0;
  try {
    const db = database();
    const row = await db
      .prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
          window_start = excluded.window_start
        RETURNING count`)
      .bind(`${action}:${ip}`, windowStart)
      .first<{ count: number }>();
    count = row?.count ?? 0;
    // Occasionally clear counters from old windows so the table stays small.
    if (Math.random() < 0.01) await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(nowMs - 86_400_000).run();
  } catch (e) {
    console.error('rate limit check failed', e);
    return;
  }
  if (count > limit) {
    const minutes = Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - nowMs) / 60_000));
    throw new HttpError(429, `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
  }
}
