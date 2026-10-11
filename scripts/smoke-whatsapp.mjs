// Checks the AUTOMATIC WhatsApp path end-to-end against a fake WhatsApp Cloud API.
// Run after `pnpm run build` and `pnpm run db:local`:  node scripts/smoke-whatsapp.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const received = [];
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: 'wamid.TEST' + received.length }] }));
  });
});
await new Promise((r) => fake.listen(8788, '127.0.0.1', r));

const vars = [
  'WHATSAPP_TOKEN:test-token', 'WHATSAPP_PHONE_NUMBER_ID:1234567890', 'WHATSAPP_UPDATE_TEMPLATE:order_update',
  'WHATSAPP_STORE_NUMBER:919800000000', 'WHATSAPP_API_BASE:http://127.0.0.1:8788', 'SHOP_URL:https://farmtouch.example',
].flatMap((v) => ['--var', v]);
const server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '8789', '--inspector-port', '0', ...vars], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const base = 'http://127.0.0.1:8789';
try {
  let ready = false;
  for (let i = 0; i < 45 && !ready; i++) {
    try { ready = (await fetch(base + '/api/catalog')).ok; } catch { /* starting */ }
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error('Server unavailable: ' + log.slice(-2000));
  await new Promise((r) => setTimeout(r, 3000));

  const catalog = await (await fetch(base + '/api/catalog')).json();
  const phone = '97' + String(Date.now()).slice(-8);
  const res = await fetch(base + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lines: [{ id: 'onion', qty: 1 }], coupon: '', slot: catalog.slots[0].id, payment: 'cod', replacement: 'ask',
      address: { name: 'Priya Deshmukh', street: 'Flat 12, Sunrise Society, Baner', phone, pin: '411045' },
      whatsappUpdates: true, whatsappOffers: false, requestKey: 'wa-auto-test-' + Date.now(),
    }),
  });
  const d = await res.json();
  assert.equal(res.status, 201, JSON.stringify(d));
  assert.equal(d.whatsapp, 'sent', 'customer message should be sent automatically');

  const toCustomer = received.find((r) => r.body.to === '91' + phone);
  assert.ok(toCustomer, 'a message must go to the customer’s own number');
  assert.equal(toCustomer.url, '/v23.0/1234567890/messages');
  assert.equal(toCustomer.auth, 'Bearer test-token');
  assert.equal(toCustomer.body.type, 'template');
  assert.equal(toCustomer.body.template.name, 'order_update');
  const params = toCustomer.body.template.components[0].parameters.map((p) => p.text);
  assert.equal(params[0], 'Priya Deshmukh');
  assert.equal(params[1], d.order.id);
  assert.match(params[2], /^your order has been placed successfully: 1 item\(s\), total ₹58/);
  assert.ok(!params[2].includes('\n'));
  const toShop = received.find((r) => r.body.to === '919800000000');
  assert.ok(toShop, 'Farm’s Touch must also get the new-order alert');
  assert.match(toShop.body.text.body, new RegExp(`New order ${d.order.id}`));
  assert.match(toShop.body.text.body, /Onion \(1 kg\) × 1/);
  assert.match(toShop.body.text.body, new RegExp(phone));

  console.log('PASS: on order placement BOTH sides get WhatsApp automatically: customer +91 ' + phone + ' (“order placed successfully”) and Farm’s Touch +91 9800000000 (new-order alert with items, total, address).');
  console.log('Shop alert text:\n' + toShop.body.text.body);
  console.log('Template params sent:', JSON.stringify(params));
} finally {
  server.kill('SIGTERM');
  fake.close();
}
