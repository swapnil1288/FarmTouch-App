// Server-only replacement used by the Render/Next.js build.
import { postgresDatabase } from './postgres/database.mjs';

export const env = new Proxy(process.env, {
  get(target, name) {
    if (name === 'DB') return postgresDatabase();
    return Reflect.get(target, name);
  },
}) as unknown as { DB: D1Database; [key: string]: unknown };

export const isPublicNodeRuntime = true;
