import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { postgresPool, closePostgres } from '../lib/postgres/database.mjs';

export async function migratePostgres() {
  const client = await postgresPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(702401281)');
    await client.query(`CREATE TABLE IF NOT EXISTS farmtouch_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL('../postgres/', import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM farmtouch_migrations WHERE name = $1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} was modified. Add a new migration instead.`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO farmtouch_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      console.log(`Applied PostgreSQL migration: ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await migratePostgres(); } finally { await closePostgres(); }
}
