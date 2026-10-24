import { spawn } from 'node:child_process';
import { migratePostgres } from './migrate-postgres.mjs';
import { closePostgres } from '../lib/postgres/database.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in Render → Environment.');
if (!process.env.ADMIN_SETUP_CODE?.trim()) throw new Error('Set ADMIN_SETUP_CODE in Render → Environment.');
await migratePostgres();
await closePostgres();
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', process.env.PORT || '10000'], {
  stdio: 'inherit', env: { ...process.env, FARMTOUCH_RUNTIME: 'node' },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
