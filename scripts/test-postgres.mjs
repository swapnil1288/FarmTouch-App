// Run only with a PostgreSQL URL where the test role can create/drop a schema.
// All app tables and test data are isolated from the public application schema.
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresDatabase, postgresSql, closePostgres } from '../lib/postgres/database.mjs';
import { migratePostgres } from './migrate-postgres.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set a disposable PostgreSQL DATABASE_URL to run these integration checks.');
const original = process.env.DATABASE_URL;
const admin = new pg.Pool({ connectionString: original, max: 1 });
const schema = `farmtouch_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(original);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  await migratePostgres();
  const db = postgresDatabase();
  await check('migrations re-run without overwriting catalogue edits', async () => {
    await db.prepare('UPDATE products SET stock = ? WHERE id = ?').bind(7, 'tomato').run();
    await migratePostgres();
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n, 18);
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id = ?').bind('tomato').first()).stock, 7);
  });
  await check('placeholder values and question marks inside SQL literals stay separate', async () => {
    assert.equal(postgresSql("SELECT '?' AS literal, ? AS value -- ?\n"), "SELECT '?' AS literal, $1 AS value -- ?\n");
    const row = await db.prepare("SELECT '?' AS literal, ?::text AS value").bind("x'); DROP TABLE products; --").first();
    assert.equal(row.literal, '?'); assert.equal(row.value, "x'); DROP TABLE products; --");
  });
  await check('failed stock reservation rolls back the complete batch', async () => {
    await assert.rejects(db.batch([
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(1, 'tomato'),
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(10000, 'carrot'),
    ]), /CHECK constraint failed/);
    assert.equal(await db.prepare('SELECT stock FROM products WHERE id = ?').bind('tomato').first('stock'), 7);
  });
  await check('concurrent reservations cannot sell the last pack twice', async () => {
    await db.prepare('UPDATE products SET stock = 1 WHERE id = ?').bind('tomato').run();
    const reserve = () => db.batch([db.prepare('UPDATE products SET stock = stock - 1 WHERE id = ?').bind('tomato')]);
    const results = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.prepare('SELECT stock FROM products WHERE id = ?').bind('tomato').first('stock'), 0);
  });
  const now = new Date().toISOString();
  await check('orders preserve JSON strings, searches and refund status updates', async () => {
    const payload = JSON.stringify({ address: { name: 'QA Buyer', phone: '9000000000' }, paymentStatus: 'paid', razorpayPaymentId: 'pay_qa' });
    await db.prepare('INSERT INTO orders (id, owner, request_key, payload, created_at) VALUES (?, ?, ?, ?, ?)').bind('QA-1', 'guest:qa', 'request-qa', payload, now).run();
    const rows = await db.prepare("SELECT payload FROM orders WHERE json_extract(payload, '$.address.name') LIKE ?").bind('%qa buyer%').all();
    assert.equal(rows.results.length, 1); assert.equal(typeof rows.results[0].payload, 'string');
    await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', ?) WHERE id = ?").bind('refund_pending', 'QA-1').run();
    await db.prepare("UPDATE orders SET payload = json_set(payload, '$.paymentStatus', 'refunded') WHERE json_extract(payload, '$.razorpayPaymentId') = ?").bind('pay_qa').run();
    assert.equal(JSON.parse(await db.prepare('SELECT payload FROM orders WHERE id = ?').bind('QA-1').first('payload')).paymentStatus, 'refunded');
  });
  await check('duplicate checkout key rolls inventory changes back', async () => {
    const before = await db.prepare('SELECT stock FROM products WHERE id = ?').bind('carrot').first('stock');
    await assert.rejects(db.batch([
      db.prepare('UPDATE products SET stock = stock - 1 WHERE id = ?').bind('carrot'),
      db.prepare('INSERT INTO orders (id, owner, request_key, payload, created_at) VALUES (?, ?, ?, ?, ?)').bind('QA-2', 'guest:qa', 'request-qa', '{}', now),
    ]));
    assert.equal(await db.prepare('SELECT stock FROM products WHERE id = ?').bind('carrot').first('stock'), before);
  });
  await check('conditional workflow update and event insertion share a transaction', async () => {
    const results = await db.batch([
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind('confirmed', now, 'QA-1', 'placed'),
      db.prepare('INSERT INTO order_events (order_id, status, action, actor, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ?)').bind('QA-1', 'confirmed', 'confirm', 'owner', now, 'QA-1', 'confirmed'),
    ]);
    assert.equal(results[0].meta.changes, 1); assert.equal(results[1].meta.changes, 1);
  });
  await check('notification identities and numeric aggregates match the existing API', async () => {
    const result = await db.prepare('INSERT INTO notifications (phone, kind, message, status, created_at) VALUES (?, ?, ?, ?, ?)').bind('9000000000', 'order_placed', 'QA', 'pending', now).run();
    assert.equal(typeof result.meta.last_row_id, 'number'); assert.ok(result.meta.last_row_id > 0);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM notifications').first('n'); assert.equal(count, 1);
  });
  console.log(`${passed} PostgreSQL integration checks passed.`);
} finally {
  await closePostgres(); process.env.DATABASE_URL = original;
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
