// Server integration checks against a locally running build (see smoke-run.mjs).
// Customer shop (guest + signed-in), staff login, the full order workflow,
// item changes, WhatsApp message log, offers and permissions.
import assert from 'node:assert/strict';

const run = Date.now().toString(36);
const base = 'http://127.0.0.1:8787';
const who = (id, email) => ({ 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email });
const buyer = who('qa-buyer-a-' + run, 'qa@example.test');
const buyerB = who('qa-buyer-b-' + run, 'other@example.test');
const platformOwner = who('qa-owner', 'qa-owner@example.test'); // admin via ADMIN_EMAILS (hosting sign-in)
const SETUP_CODE = 'smoke-setup-code';
const OWNER = { email: 'owner@farmtouch.test', password: 'Owner@12345', name: 'QA Owner' };

const get = (path, headers = {}) => fetch(base + path, { headers });
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ok = async (res, status = 200) => { const text = await res.text(); assert.equal(res.status, status, text); return JSON.parse(text); };
const cookieFrom = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

// ---------------------------------------------------------------- staff login
let r = await get('/admin');
assert.equal(r.status, 200);
assert.match(await r.text(), /Staff login|Create the owner account/);

// First-time setup (or log in if a previous run already created the owner)
r = await post('/api/admin/setup', { code: 'wrong', name: OWNER.name, email: OWNER.email, phone: '', password: OWNER.password });
assert.ok([403, 409].includes(r.status), await r.text());
r = await post('/api/admin/setup', { code: SETUP_CODE, name: OWNER.name, email: OWNER.email, phone: '', password: OWNER.password });
if (r.status === 409) r = await post('/api/admin/login', { login: OWNER.email, password: OWNER.password });
assert.equal(r.status, 200, await r.clone().text());
const owner = { cookie: cookieFrom(r) };
assert.match(owner.cookie, /^ft_staff=[0-9a-f]{64}$/);
assert.match(await (await get('/admin', owner)).text(), /STAFF PANEL/);
assert.equal((await post('/api/admin/login', { login: OWNER.email, password: 'nope-nope' })).status, 401);
assert.equal((await get('/api/admin/me')).status, 401);
assert.equal((await get('/api/admin/me', owner)).status, 200);
assert.equal((await get('/api/admin/me', platformOwner)).status, 200); // hosting sign-in still works

// ---------------------------------------------------------------- shop basics
const page = await get('/');
assert.equal(page.status, 200);
const html = await page.text();
assert.match(html, /Farm-fresh veggies/);
assert.match(html, /wa\.me/);

const stock = async () => Object.fromEntries((await ok(await get('/api/catalog'))).products.map((p) => [p.id, p.stock]));
const catalog = await ok(await get('/api/catalog'));
assert.ok(catalog.products.length >= 8);
assert.equal(catalog.slots.length, 3);
for (const p of catalog.products.slice(0, 8)) assert.equal((await get('/produce/' + p.image + '.webp')).status, 200);

for (const id of ['tomato', 'carrot', 'apple', 'onion', 'potato']) await ok(await post('/api/admin/products', { op: 'stock', id, stock: 50 }, owner));

const body = {
  lines: [{ id: 'tomato', qty: 1 }, { id: 'carrot', qty: 1 }],
  coupon: '',
  address: { name: 'QA buyer', street: 'QA test apartment, Pune', phone: '9000000000', pin: '411057' },
  slot: catalog.slots[0].id,
  payment: 'cod',
  replacement: 'ask',
  whatsappUpdates: true,
  whatsappOffers: true,
  requestKey: 'qa-smoke-request-0001-' + run,
};
const order = (payload, headers = buyer) => post('/api/orders', payload, headers);

// ---------------------------------------------------------------- guest ordering (no sign-in at all)
assert.deepEqual((await ok(await get('/api/orders'))).orders, []);
r = await order({ ...body, address: { ...body.address, phone: '9111111111', name: 'Guest Buyer' }, requestKey: 'qa-guest-request-' + run }, {});
const guestOrder = await ok(r, 201);
const guest = { cookie: cookieFrom(r) };
assert.match(guest.cookie, /^ft_cid=[0-9a-f]{32}$/);
assert.equal((await ok(await get('/api/orders', guest))).orders[0].id, guestOrder.order.id);
assert.deepEqual((await ok(await get('/api/orders', { cookie: 'ft_cid=' + 'a'.repeat(32) }))).orders, []);
// Track from any phone with ID + mobile
assert.equal((await ok(await get(`/api/orders/track?id=${guestOrder.order.id}&phone=9111111111`))).order.status, 'placed');
assert.equal((await get(`/api/orders/track?id=${guestOrder.order.id}&phone=9000000000`)).status, 404);
assert.equal((await ok(await post('/api/orders/cancel', { id: guestOrder.order.id }, guest))).order.status, 'cancelled');

// ---------------------------------------------------------------- place order: stock reserved, customer message logged
const one = await ok(await order(body), 201);
assert.equal(one.order.totals.total, 92);
let s = await stock();
assert.equal(s.tomato, 49);
let msgs = (await ok(await get('/api/admin/messages?orderId=' + one.order.id, owner))).messages;
assert.equal(msgs.length, 1);
assert.equal(msgs[0].kind, 'order_placed');
assert.equal(msgs[0].status, 'pending'); // no WhatsApp API in tests → waits for one-tap sending
assert.equal(one.whatsapp, 'pending');
assert.match(msgs[0].message, /has been placed successfully/);
assert.match(msgs[0].message, new RegExp(`your order \\*${one.order.id}\\*`));

// replay & concurrency (no double stock deduction, no duplicate message)
assert.equal((await ok(await order(body))).order.id, one.order.id);
const concurrent = await Promise.all(Array.from({ length: 3 }, () => order({ ...body, requestKey: 'qa-concurrent-request-0001-' + run }).then((x) => x.json())));
assert.equal(new Set(concurrent.map((d) => d.order.id)).size, 1);
assert.equal((await stock()).tomato, 48);
assert.equal((await ok(await get('/api/admin/messages?orderId=' + one.order.id, owner))).messages.length, 1);

// validation & request hygiene
let n = 0;
const fresh = (patch) => ({ ...body, ...patch, requestKey: `qa-invalid-${++n}-request-${run}` });
assert.equal((await order(fresh({ lines: [{ id: 'tomato', qty: -1 }] }))).status, 400);
assert.match((await (await order(fresh({ address: { ...body.address, phone: '0000000000' } }))).json()).error, /mobile/);
assert.match((await (await order(fresh({ coupon: 'FRESH50' }))).json()).error, /FRESH50 needs/);
assert.equal((await order(fresh({}), { ...buyer, origin: 'https://untrusted.example' })).status, 403);
{ const x = await fetch(base + '/api/orders', { method: 'POST', headers: { ...buyer, 'Content-Type': 'text/plain' }, body: 'x' }); assert.equal(x.status, 415, await x.text()); }
assert.equal((await fetch(base + '/api/orders', { method: 'POST', headers: { ...buyer, 'Content-Type': 'application/json' }, body: '{oops' })).status, 400);
assert.equal((await fetch(base + '/api/orders', { method: 'POST', headers: { ...buyer, 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(40000) }) })).status, 413);

// last-pack race
await ok(await post('/api/admin/products', { op: 'stock', id: 'apple', stock: 1 }, owner));
const race = await Promise.all([
  order({ ...body, lines: [{ id: 'apple', qty: 1 }], requestKey: 'qa-race-a-request-' + run }, buyer),
  order({ ...body, lines: [{ id: 'apple', qty: 1 }], requestKey: 'qa-race-b-request-' + run }, buyerB),
]);
assert.equal(race.filter((x) => x.status === 201).length, 1);
const loser = race.find((x) => x.status !== 201);
assert.ok([400, 409].includes(loser.status));
assert.match((await loser.json()).error, /sold out|out of stock/);
assert.equal((await stock()).apple, 0);
await ok(await post('/api/admin/products', { op: 'stock', id: 'apple', stock: 50 }, owner));

// customer cancel returns stock + cancellation message
const carrotsBefore = (await stock()).carrot;
const toCancel = await ok(await order({ ...body, lines: [{ id: 'carrot', qty: 3 }], requestKey: 'qa-cancel-request-' + run }), 201);
assert.equal((await stock()).carrot, carrotsBefore - 3);
assert.equal((await ok(await post('/api/orders/cancel', { id: toCancel.order.id }, buyer))).order.status, 'cancelled');
assert.equal((await stock()).carrot, carrotsBefore);
assert.equal((await post('/api/orders/cancel', { id: toCancel.order.id }, buyer)).status, 409);
assert.equal((await post('/api/orders/cancel', { id: one.order.id }, buyerB)).status, 404);
assert.ok((await ok(await get('/api/admin/messages?orderId=' + toCancel.order.id, owner))).messages.some((m) => m.kind === 'cancelled'));

// ---------------------------------------------------------------- staff accounts & permissions
const packerEmail = `packer-${run}@example.test`;
const riderEmail = `rider-${run}@example.test`;
const riderPhone = '98' + String(Date.now()).slice(-8);
assert.match((await (await post('/api/admin/staff', { email: packerEmail, name: 'QA Packer', phone: '', role: 'packer', active: true }, owner)).json()).error, /password/);
await ok(await post('/api/admin/staff', { email: packerEmail, name: 'QA Packer', phone: '', role: 'packer', active: true, password: 'Packer@123' }, owner));
await ok(await post('/api/admin/staff', { email: riderEmail, name: 'QA Rider', phone: riderPhone, role: 'delivery', active: true, password: 'Rider@1234' }, owner));
assert.match((await (await post('/api/admin/staff', { email: 'x' + riderEmail, name: 'Dup', phone: riderPhone, role: 'delivery', active: true, password: 'Rider@1234' }, owner)).json()).error, /already used/);
assert.equal((await post('/api/admin/staff', { email: OWNER.email, name: 'Me', phone: '', role: 'packer', active: true }, owner)).status, 400);
const loginAs = async (login, password) => { const res = await post('/api/admin/login', { login, password }); assert.equal(res.status, 200, await res.clone().text()); return { cookie: cookieFrom(res) }; };
const packer = await loginAs(packerEmail, 'Packer@123');
const rider = await loginAs(riderPhone, 'Rider@1234'); // phone login
assert.equal((await get('/api/admin/reports', packer)).status, 403);
assert.equal((await get('/api/admin/messages', packer)).status, 403);
assert.equal((await post('/api/admin/products', { op: 'save', product: { id: 'x' } }, packer)).status, 403);

// lockout after 5 wrong passwords (throwaway account)
const lockEmail = `lock-${run}@example.test`;
await ok(await post('/api/admin/staff', { email: lockEmail, name: 'Lock Test', phone: '', role: 'packer', active: true, password: 'Locked@123' }, owner));
for (let i = 0; i < 5; i++) assert.equal((await post('/api/admin/login', { login: lockEmail, password: 'wrong-' + i })).status, 401);
assert.equal((await post('/api/admin/login', { login: lockEmail, password: 'Locked@123' })).status, 429);
// disabling a staff member ends their sessions
const tmp = await loginAs(packerEmail, 'Packer@123');
await ok(await post('/api/admin/staff', { email: packerEmail, name: 'QA Packer', phone: '', role: 'packer', active: false }, owner));
assert.equal((await get('/api/admin/me', tmp)).status, 401);
await ok(await post('/api/admin/staff', { email: packerEmail, name: 'QA Packer', phone: '', role: 'packer', active: true, password: 'Packer@456' }, owner));
const packer2 = await loginAs(packerEmail, 'Packer@456');
// change own password
await ok(await post('/api/admin/password', { current: 'Packer@456', next: 'Packer@789' }, packer2));
assert.equal((await post('/api/admin/login', { login: packerEmail, password: 'Packer@456' })).status, 401);
const packer3 = await loginAs(packerEmail, 'Packer@789');
// logout
await ok(await post('/api/admin/logout', {}, packer3));
assert.equal((await get('/api/admin/me', packer3)).status, 401);
const pk = await loginAs(packerEmail, 'Packer@789');

// ---------------------------------------------------------------- workflow with item change + messages
const big = await ok(await order({ ...body, lines: [{ id: 'tomato', qty: 3 }, { id: 'onion', qty: 1 }, { id: 'basket-mini', qty: 1, components: ['apple', 'carrot', 'potato', 'onion'] }], requestKey: 'qa-big-request-' + run }), 201);
const id = big.order.id;
assert.equal(big.order.totals.total, 120 + 38 + (90 + 32 + 35 + 38) + 20);
const act = (who2, action, extra = {}) => post('/api/admin/orders', { id, action, ...extra }, who2);
assert.equal((await act(pk, 'confirm')).status, 403);
let res = await ok(await act(owner, 'confirm'));
assert.equal(res.order.status, 'confirmed');
assert.equal(res.pending[0].kind, 'confirmed'); // staff panel asks to send it with one tap

// item unavailable: tomato 3 → 2, potato removed from basket
const stockBefore = await stock();
res = await ok(await act(pk, 'edit_items', { changes: [{ key: 'tomato', qty: 2 }, { key: 'basket-mini:2', remove: true }], note: 'Not available today' }));
assert.equal(res.order.totals.subtotal, 80 + 38 + (90 + 32 + 38));
assert.equal(res.order.totals.total, res.order.totals.subtotal + 20);
assert.equal(res.order.items[2].components.length, 3);
assert.equal(res.pending[0].kind, 'items_changed');
assert.match(res.pending[0].message, /Tomato 3 → 2/);
assert.match(res.pending[0].message, /Potato removed from Mini basket/);
const stockAfter = await stock();
assert.equal(stockAfter.tomato, stockBefore.tomato + 1);
assert.equal(stockAfter.potato, stockBefore.potato + 1);
assert.equal((await act(pk, 'edit_items', { changes: [{ key: 'tomato', qty: 0 }, { key: 'onion', qty: 0 }, { key: 'basket-mini', qty: 0 }] })).status, 400); // use cancel instead
assert.equal((await act(pk, 'edit_items', { changes: [{ key: 'nope', qty: 1 }] })).status, 400);

const rows = ['tomato', 'onion', 'basket-mini:0', 'basket-mini:1', 'basket-mini:2'];
for (const key of rows) res = await ok(await act(pk, 'toggle_item', { itemKey: key }));
assert.equal(res.order.status, 'packing');
assert.equal((await act(pk, 'edit_items', { changes: [{ key: 'tomato', qty: 1 }] })).status, 200); // still allowed while packing
res = await ok(await act(pk, 'toggle_item', { itemKey: 'tomato' })); // re-tick changed line
res = await ok(await act(pk, 'mark_packed'));
assert.equal(res.order.status, 'packed');
assert.equal((await act(pk, 'edit_items', { changes: [{ key: 'tomato', qty: 2 }] })).status, 409); // not after packing
res = await ok(await act(owner, 'assign', { assignee: riderEmail }));
res = await ok(await act(rider, 'out_for_delivery'));
assert.equal(res.pending[0].kind, 'out_for_delivery');
assert.match(res.pending[0].message, /out for delivery with QA Rider/);
const total = res.order.totals.total;
res = await ok(await act(rider, 'delivered', { cash: total }));
assert.equal(res.pending[0].kind, 'delivered');
assert.match(res.pending[0].message, new RegExp(`Payment received: ₹${total}`));

// customer view
const final = (await ok(await get('/api/orders', buyer))).orders.find((x) => x.id === id);
assert.equal(final.status, 'delivered');
assert.ok(final.events.some((e) => e.action === 'edit_items' && /Tomato/.test(e.note)));
assert.equal(final.assignee, null);

// message log: one-tap send
msgs = (await ok(await get('/api/admin/messages?orderId=' + id, owner))).messages;
assert.deepEqual(msgs.map((m) => m.kind).sort(), ['confirmed', 'delivered', 'items_changed', 'items_changed', 'order_placed', 'out_for_delivery']);
await ok(await post('/api/admin/messages', { op: 'mark_sent', id: msgs[0].id }, rider));
assert.equal((await post('/api/admin/messages', { op: 'mark_sent', id: msgs[0].id }, owner)).status, 409);
assert.equal((await post('/api/admin/messages', { op: 'dismiss', id: msgs[1].id }, rider)).status, 403);
await ok(await post('/api/admin/messages', { op: 'dismiss', id: msgs[1].id }, owner));
const todoList = (await ok(await get('/api/admin/messages?status=todo', owner))).messages;
assert.ok(todoList.every((m) => ['pending', 'failed', 'queued'].includes(m.status)));

// no consent → message skipped
const quiet = await ok(await order({ ...body, address: { ...body.address, phone: '9222222222' }, whatsappUpdates: false, whatsappOffers: false, requestKey: 'qa-quiet-request-' + run }), 201);
const quietMsgs = (await ok(await get('/api/admin/messages?orderId=' + quiet.order.id, owner))).messages;
assert.equal(quietMsgs[0].status, 'skipped');

// offers go only to opted-in customers
const cust = await ok(await get('/api/admin/customers?q=9000000000', owner));
assert.equal(cust.customers[0].offersOptIn, true);
const offer = await ok(await post('/api/admin/messages', { op: 'offer', text: 'Weekend special: 20% off all fruits! ' + run }, owner));
assert.equal(offer.mode, 'manual');
assert.ok(offer.recipients >= 1);
const offerMsgs = (await ok(await get('/api/admin/messages?status=pending', owner))).messages.filter((m) => m.kind === 'offer' && m.message.includes(run));
assert.ok(offerMsgs.some((m) => m.phone === '9000000000'));
assert.ok(!offerMsgs.some((m) => m.phone === '9222222222'));
await ok(await post('/api/admin/customers', { phone: '9000000000', updatesOptIn: true, offersOptIn: false }, owner));
assert.equal((await ok(await get('/api/admin/customers?q=9000000000', owner))).customers[0].offersOptIn, false);
assert.equal((await post('/api/admin/messages', { op: 'test', phone: '9000000000' }, owner)).status, 502); // API not configured

// ---------------------------------------------------------------- reports, export, products, isolation
const report = await ok(await get('/api/admin/reports?days=7', owner));
assert.ok(report.range.delivered >= 1);
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const csv = await get(`/api/admin/export?from=${today}&to=${today}`, owner);
assert.equal(csv.status, 200);
assert.match(await csv.text(), new RegExp(id));
const saved = await ok(await post('/api/admin/products', { op: 'save', product: { id: 'qa-gobi', name: 'Cauliflower', local: 'Phool gobi', unit: '1 pc', price: 30, mrp: 40, category: 'Vegetables', image: 'basket', stock: 5, active: false, sort: 99 } }, owner));
assert.ok(saved.products.some((p) => p.id === 'qa-gobi'));
assert.ok(!('qa-gobi' in (await stock())));
assert.equal((await ok(await get('/api/orders', who('qa-buyer-c-' + run, 'c@example.test')))).orders.length, 0);

console.log('PASS: staff login/setup/lockout/password/logout, guest ordering + tracking, stock reservation & races, cancel + restock, item changes with stock & new total, full workflow, WhatsApp message log (placed/confirmed/changed/out for delivery/delivered+payment/cancelled), consent, offers, reports, CSV, products and isolation.');
