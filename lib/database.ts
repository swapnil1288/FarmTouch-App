import { env } from 'cloudflare:workers';

export function database() {
  const db = env.DB;
  if (!db) {
    throw new Error(
      'Order storage is unavailable. For local development, run `pnpm run db:local` after `pnpm run build` and make sure the D1 `DB` binding is configured.',
    );
  }
  return db;
}
