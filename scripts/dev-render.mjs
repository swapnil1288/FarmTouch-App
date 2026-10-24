import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { migratePostgres } from './migrate-postgres.mjs';
import { closePostgres } from '../lib/postgres/database.mjs';
try { loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await migratePostgres();
await closePostgres();
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', process.env.PORT || '5173'], {
  stdio: 'inherit', env: { ...process.env, FARMTOUCH_RUNTIME: 'node' },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { process.exitCode = code ?? 1; });
