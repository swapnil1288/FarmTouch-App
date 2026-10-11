// Business-rule tests. Run with `pnpm test`.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const rootRequire = createRequire(import.meta.url);
const cache = {};
function resolveModuleName(name, parent = '') {
  if (name.startsWith('@/')) {
    const mapped = name.slice(2).replace(/^lib\//, '');
    return mapped.startsWith('lib/') ? mapped : mapped;
  }
  if (name.startsWith('./') || name.startsWith('../')) {
    const base = parent ? parent.split('/') : [];
    const stack = base.slice(0, -1);
    for (const token of name.split('/')) {
      if (!token || token === '.') continue;
      if (token === '..') {
        if (stack.length) stack.pop();
        continue;
      }
      stack.push(token);
    }
    return stack.join('/');
  }
  return name;
}
function load(name) {
  const parent = arguments.length > 1 ? arguments[1] : '';
  const resolvedName = resolveModuleName(name, parent);
  const moduleName = resolvedName.startsWith('lib/') ? resolvedName : `lib/${resolvedName}`;
  if (cache[moduleName]) return cache[moduleName];
  const source = readFileSync(new URL('../' + moduleName + '.ts', import.meta.url), 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  cache[moduleName] = mod.exports;
  new Function('require', 'module', 'exports', out)((n) => {
    if (n.startsWith('@/')) return load(n.slice(2).replace(/^lib\//, ''), moduleName);
    if (n.startsWith('./') || n.startsWith('../')) return load(n, moduleName);
    return rootRequire(n);
  }, mod, mod.exports);
  cache[moduleName] = mod.exports;
  return mod.exports;
}

const { getSlots, createCatalog, SAMPLE_PRODUCTS, packsNeeded, labelForSlotId } = load('catalog');
const cat = createCatalog(SAMPLE_PRODUCTS);
const { priceCart, linePrice, mrpSavings, basketPrice, defaultBasket } = cat;
const { validateOrder: validateWith } = load('order-validation');
const validateOrder = (input, c = cat) => validateWith(input, c);
const { buildOrderMessage, whatsappLink, normaliseWhatsAppNumber, statusMessage, mapsLink } = load('whatsapp');
const { packingRows, snapshotItems, csvEscape } = load('orders');
const { canDo, ACTION_RULES, trackIndex } = load('workflow');
const { orderNotice, offerNotice, trackingLink } = load('notify-text');
const { settlementSummary } = load('settlement');
const { razorpayHmac, verifyRazorpaySignature, rupeesToPaise } = load('payment-signature');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
async function testAsync(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const base = () => ({
  lines: [{ id: 'tomato', qty: 1 }, { id: 'carrot', qty: 1 }],
  coupon: '',
  address: { name: 'Test Buyer', street: 'Test apartment, Pune', phone: '9000000000', pin: '411057' },
  slot: getSlots()[0].id,
  payment: 'cod',
  replacement: 'ask',
  requestKey: 'test-request-0001',
});
const withProduct = (id, patch) => createCatalog(SAMPLE_PRODUCTS.map((p) => (p.id === id ? { ...p, ...patch } : p)));

// --- pricing
test('cart arithmetic with delivery', () => assert.deepEqual(priceCart(base().lines), { subtotal: 72, discount: 0, delivery: 20, total: 92 }));
test('coupon exact boundary 499', () => assert.equal(priceCart([{ id: 'tomato', qty: 1 }, { id: 'onion', qty: 3 }, { id: 'banana', qty: 3 }, { id: 'okra', qty: 1 }, { id: 'apple', qty: 1 }, { id: 'spinach', qty: 1 }, { id: 'potato', qty: 1 }], 'FRESH50').discount, 50));
test('coupon one rupee below minimum gives no discount', () => assert.equal(priceCart([{ id: 'tomato', qty: 1 }, { id: 'onion', qty: 3 }, { id: 'banana', qty: 3 }, { id: 'okra', qty: 1 }, { id: 'apple', qty: 1 }, { id: 'spinach', qty: 1 }, { id: 'carrot', qty: 1 }], 'FRESH50').discount, 0));
test('free delivery threshold', () => { assert.equal(priceCart([{ id: 'apple', qty: 8 }]).delivery, 0); assert.equal(priceCart([{ id: 'apple', qty: 7 }]).delivery, 20); });
test('empty cart no delivery fee', () => assert.equal(priceCart([]).total, 0));
test('basket replacement uses current catalogue prices', () => assert.equal(priceCart([{ id: 'basket-mini', qty: 1, components: ['apple', 'apple', 'apple', 'apple'] }]).subtotal, 360));
test('bulk basket is double packs (not identical to family)', () => {
  assert.equal(basketPrice('family', defaultBasket('family')), 355);
  assert.equal(basketPrice('bulk', defaultBasket('bulk')), 710);
  assert.equal(linePrice({ id: 'basket-bulk', qty: 1, components: defaultBasket('bulk') }), 710);
});
test('MRP savings counted', () => assert.equal(mrpSavings([{ id: 'tomato', qty: 2 }]), 20));

// --- validation
test('valid request returns authoritative totals', () => assert.equal(validateOrder(base()).totals.total, 92));
test('online payment request returns server-calculated totals', () => {
  const validated = validateOrder({ ...base(), payment: 'online' });
  assert.equal(validated.body.payment, 'online');
  assert.equal(validated.totals.total, 92);
});
test('valid request returns slot label', () => assert.match(validateOrder(base()).slotLabel, /9 AM – 12 PM/));
test('coupon rejected below minimum with clear message', () => assert.throws(() => validateOrder({ ...base(), coupon: 'FRESH50' }), /FRESH50 needs/));
test('negative quantities rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'tomato', qty: -1 }] })));
test('more than 10 packs rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'tomato', qty: 11 }] })));
test('unknown product rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'unknown', qty: 1 }] })));
test('invalid basket length rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'basket-family', qty: 1, components: ['tomato'] }] })));
test('unknown basket type rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'basket-giant', qty: 1, components: Array(8).fill('tomato') }] })));
test('stock checked across basket components', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'basket-family', qty: 10, components: Array(8).fill('spinach') }] })));
test('bulk multiplier counts towards stock', () => {
  // spinach stock 60: 4 slots × 10 baskets = 40 OK for family, × 2 packs = 80 too many for bulk
  const four = ['spinach', 'spinach', 'spinach', 'spinach', 'tomato', 'carrot', 'potato', 'onion'];
  assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'basket-bulk', qty: 10, components: four }] }), /Spinach/);
  assert.doesNotThrow(() => validateOrder({ ...base(), lines: [{ id: 'basket-family', qty: 10, components: four }] }));
});
test('live stock: out of stock and hidden products rejected', () => {
  assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'tomato', qty: 1 }] }, withProduct('tomato', { stock: 0 })), /out of stock/);
  assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'carrot', qty: 1 }] }, withProduct('carrot', { active: false })), /no longer available/);
  assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'apple', qty: 4 }] }, withProduct('apple', { stock: 3 })), /Only 3 packs of Apple/);
});
test('live price changes are used for totals', () => assert.equal(validateOrder(base(), withProduct('tomato', { price: 60 })).totals.subtotal, 92));
test('order snapshot stores names, prices and packs', () => {
  const v = validateOrder({ ...base(), lines: [{ id: 'tomato', qty: 2 }, { id: 'basket-mini', qty: 1, components: ['apple', 'apple', 'carrot', 'onion'] }] });
  assert.deepEqual(v.items[0], { id: 'tomato', name: 'Tomato', unit: '500 g', price: 40, qty: 2 });
  assert.equal(v.items[1].price, 250);
  assert.equal(v.items[1].components.length, 4);
  assert.deepEqual(v.packs, { tomato: 2, apple: 2, carrot: 1, onion: 1 });
});
test('default basket uses in-stock items only', () => {
  const c = withProduct('tomato', { stock: 0 });
  assert.ok(!c.defaultBasket('mini').includes('tomato'));
  assert.equal(c.defaultBasket('family').length, 8);
});
test('duplicate lines rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [{ id: 'tomato', qty: 1 }, { id: 'tomato', qty: 1 }] })));
test('stale slot rejected', () => assert.throws(() => validateOrder({ ...base(), slot: '2020-01-01-morning' })));
test('invalid address rejected', () => assert.throws(() => validateOrder({ ...base(), address: { name: 'X', street: 'x', phone: '123', pin: '000000' } })));
test('whitespace-only street rejected', () => assert.throws(() => validateOrder({ ...base(), address: { ...base().address, street: '          ' } })));
test('phone must be a valid Indian mobile', () => {
  assert.throws(() => validateOrder({ ...base(), address: { ...base().address, phone: '0000000000' } }), /mobile/);
  assert.throws(() => validateOrder({ ...base(), address: { ...base().address, phone: '1234567890' } }));
});
test('non-Pune pincode rejected', () => assert.throws(() => validateOrder({ ...base(), address: { ...base().address, pin: '400001' } }), /Pune/));
test('unconnected UPI rejected', () => assert.throws(() => validateOrder({ ...base(), payment: 'upi' })));
test('client supplied total rejected', () => assert.throws(() => validateOrder({ ...base(), total: 1 })));
test('invalid coupon rejected', () => assert.throws(() => validateOrder({ ...base(), coupon: 'FAKE' })));
test('empty cart rejected', () => assert.throws(() => validateOrder({ ...base(), lines: [] }), /empty/));
test('whatsappUpdates is optional and boolean', () => {
  assert.equal(validateOrder({ ...base(), whatsappUpdates: true }).body.whatsappUpdates, true);
  assert.equal(validateOrder(base()).body.whatsappUpdates, false);
  assert.throws(() => validateOrder({ ...base(), whatsappUpdates: 'yes' }));
});

// --- slots (India time zone)
test('slot id and label agree just after midnight IST', () => {
  const s = getSlots(new Date('2026-10-07T19:00:00Z')); // 00:30 IST on 8 Oct
  assert.equal(s[0].id, '2026-10-09-morning');
  assert.match(s[0].label, /9 Oct/);
});
test('slot id and label agree late evening IST', () => {
  const s = getSlots(new Date('2026-10-07T17:00:00Z')); // 22:30 IST on 7 Oct
  assert.equal(s[0].id, '2026-10-08-morning');
  assert.match(s[0].label, /8 Oct/);
});
test('slots roll over month end', () => assert.deepEqual(getSlots(new Date('2026-10-31T06:00:00Z')).map((s) => s.id), ['2026-11-01-morning', '2026-11-02-morning', '2026-11-03-morning']));
test('slot label from id', () => assert.match(labelForSlotId('2026-10-08-morning'), /8 Oct · 9 AM – 12 PM/));

// --- WhatsApp
test('WhatsApp numbers are normalised', () => {
  assert.equal(normaliseWhatsAppNumber('98765 43210'), '919876543210');
  assert.equal(normaliseWhatsAppNumber('+91 98765-43210'), '919876543210');
  assert.equal(normaliseWhatsAppNumber('123'), '');
  assert.equal(normaliseWhatsAppNumber(undefined), '');
});
test('WhatsApp link encodes the message', () => {
  assert.equal(whatsappLink('9876543210', 'Hi & bye'), 'https://wa.me/919876543210?text=Hi%20%26%20bye');
  assert.equal(whatsappLink('', 'x'), 'https://wa.me/?text=x');
});
test('WhatsApp order message lists items, totals and address', () => {
  const lines = [{ id: 'tomato', qty: 3 }, { id: 'basket-bulk', qty: 1, components: defaultBasket('bulk') }];
  const msg = buildOrderMessage({ items: snapshotItems(lines, cat), totals: priceCart(lines, 'BASKET75'), coupon: 'BASKET75', orderId: 'FT-1', slotLabel: 'Thu · 9 AM', address: base().address });
  assert.match(msg, /FT-1/);
  assert.match(msg, /Tomato \(500 g\) × 3/);
  assert.match(msg, /Bulk basket × 1 \(2× packs\)/);
  assert.match(msg, /Coupon BASKET75: −₹75/);
  assert.match(msg, /\*Total: ₹755\*/);
  assert.match(msg, /411057/);
});
test('WhatsApp message without address asks to share it', () => assert.match(buildOrderMessage({ items: snapshotItems([{ id: 'apple', qty: 1 }], cat), totals: priceCart([{ id: 'apple', qty: 1 }]) }), /share my delivery address/));
test('WhatsApp status message and maps link', () => {
  assert.match(statusMessage('Asha Patil', 'FT-1', 'out_for_delivery', 410), /Hi Asha, your order FT-1 is out for delivery\. Please keep ₹410 ready/);
  assert.equal(mapsLink(base().address), 'https://www.google.com/maps/search/?api=1&query=Test%20apartment%2C%20Pune%20411057');
});

// --- workflow & packing
test('workflow: packer can pack but not confirm or cancel', () => {
  assert.equal(canDo('start_packing', 'packer', 'confirmed'), true);
  assert.equal(canDo('mark_packed', 'packer', 'packing'), true);
  assert.equal(canDo('confirm', 'packer', 'placed'), false);
  assert.equal(canDo('cancel', 'packer', 'placed'), false);
});
test('workflow: delivery partner only handles packed / on-the-road orders', () => {
  assert.equal(canDo('out_for_delivery', 'delivery', 'packed'), true);
  assert.equal(canDo('delivered', 'delivery', 'out_for_delivery'), true);
  assert.equal(canDo('delivered', 'delivery', 'packed'), false);
  assert.equal(canDo('mark_packed', 'delivery', 'packing'), false);
  assert.equal(canDo('cancel', 'delivery', 'out_for_delivery'), false);
});
test('workflow: delivered and cancelled orders are final', () => {
  for (const [action, rule] of Object.entries(ACTION_RULES)) {
    if (action === 'note') continue;
    assert.ok(!rule.from.includes('delivered') && !rule.from.includes('cancelled'), action);
  }
});
test('tracker step for packed shows packing', () => assert.equal(trackIndex('packed'), trackIndex('packing')));
test('packing rows split baskets into components', () => {
  const lines = [{ id: 'tomato', qty: 2 }, { id: 'basket-bulk', qty: 1, components: defaultBasket('bulk') }];
  const rows = packingRows(snapshotItems(lines, cat));
  assert.equal(rows.length, 9);
  assert.equal(rows[0].packs, 2);
  assert.equal(rows[1].packs, 2); // bulk = double packs
  assert.equal(rows[1].key, 'basket-bulk:0');
  assert.equal(packsNeeded(lines).tomato, 4);
});
test('CSV escaping protects against formulas and commas', () => {
  assert.equal(csvEscape('=HYPERLINK(1)'), "'=HYPERLINK(1)");
  assert.equal(csvEscape('a, b'), '"a, b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape(-5), '-5');
  assert.equal(csvEscape(null), '');
});
test('settlement summary totals revenue, collection and pending dues', () => {
  const now = new Date();
  const day1 = new Date(now); day1.setDate(now.getDate() - 1); day1.setHours(12, 0, 0, 0);
  const day2 = new Date(now); day2.setDate(now.getDate() - 2); day2.setHours(9, 0, 0, 0);
  const day3 = new Date(now); day3.setDate(now.getDate() - 3); day3.setHours(12, 0, 0, 0);
  const summary = settlementSummary([
    { id: 'FT-1', status: 'delivered', cashCollected: 200, customerPhone: '9000000001', customerName: 'Cafe Buyer', totals: { subtotal: 200, discount: 0, delivery: 20, total: 220 }, createdAt: day1.toISOString() },
    { id: 'FT-2', status: 'delivered', cashCollected: 120, customerPhone: '9000000002', customerName: 'Retail Buyer', totals: { subtotal: 120, discount: 10, delivery: 10, total: 120 }, createdAt: day1.toISOString() },
    { id: 'FT-3', status: 'out_for_delivery', cashCollected: null, customerPhone: '9000000001', customerName: 'Cafe Buyer', totals: { subtotal: 150, discount: 0, delivery: 20, total: 170 }, createdAt: day2.toISOString() },
    { id: 'FT-4', status: 'cancelled', cashCollected: null, customerPhone: '9000000002', customerName: 'Retail Buyer', totals: { subtotal: 80, discount: 0, delivery: 10, total: 90 }, createdAt: day3.toISOString() },
    { id: 'FT-5', status: 'placed', payment: 'online', paymentStatus: 'paid', cashCollected: null, customerPhone: '9000000002', customerName: 'Retail Buyer', totals: { subtotal: 95, discount: 0, delivery: 0, total: 95 }, createdAt: day2.toISOString() },
  ], 7, { '9000000001': { accountType: 'b2b', businessName: 'Green Cafe' } });
  assert.equal(summary.grossSales, 605);
  assert.equal(summary.discounts, 10);
  assert.equal(summary.deliveryRevenue, 50);
  assert.equal(summary.cashCollected, 320);
  assert.equal(summary.pendingCollection, 190);
  assert.equal(summary.cancelledValue, 90);
  assert.equal(summary.onlinePaid, 95);
  assert.equal(summary.netSettlement, 605);
  assert.equal(summary.orders.length, 5);
  assert.equal(summary.orders.find((order) => order.id === 'FT-3').pendingCollection, 170);
  assert.equal(summary.orders.find((order) => order.id === 'FT-4').pendingCollection, 0);
  assert.equal(summary.byDay.length, 3);
  assert.equal(summary.byType.b2b.grossSales, 390);
  assert.equal(summary.byType.b2b.orders, 2);
  assert.equal(summary.byType.retail.grossSales, 215);
  assert.equal(summary.byType.retail.onlinePaid, 95);
  assert.equal(summary.orders.find((order) => order.id === 'FT-5').pendingCollection, 0);
  assert.equal(summary.orders.find((order) => order.id === 'FT-1').businessName, 'Green Cafe');
});
await testAsync('Razorpay payment signature validates and rejects tampering', async () => {
  const signature = await razorpayHmac('test-secret', 'order_test|pay_test');
  assert.equal(await verifyRazorpaySignature('order_test', 'pay_test', signature, 'test-secret'), true);
  assert.equal(await verifyRazorpaySignature('order_test', 'pay_other', signature, 'test-secret'), false);
  assert.equal(rupeesToPaise(125), 12500);
  assert.throws(() => rupeesToPaise(-1), /Invalid payment amount/);
});


// --- customer WhatsApp messages
const sampleOrder = () => {
  const lines = [{ id: 'tomato', qty: 2 }, { id: 'basket-mini', qty: 1, components: ['apple', 'carrot', 'onion', 'potato'] }];
  const items = snapshotItems(lines, cat);
  return {
    id: 'FT-1A2B3C4D', lines, items, totals: priceCart(lines, 'FRESH50'), coupon: 'FRESH50',
    address: { name: 'Asha Patil', phone: '9876543210', street: 'B-402, Green Meadows, Hinjawadi', pin: '411057' },
    slot: '2026-10-09-morning', slotLabel: 'Fri, 9 Oct · 9 AM – 12 PM', payment: 'cod', replacement: 'ask', whatsappUpdates: true,
    createdAt: '2026-10-08T05:00:00.000Z', status: 'placed', updatedAt: '', packed: [], cashCollected: null,
    assignee: { name: 'Ravi Shinde', phone: '9822012345', email: 'ravi@x.test' },
  };
};
test('order placed message lists items, total, slot, address and tracking link', () => {
  const m = orderNotice('order_placed', sampleOrder(), { siteUrl: 'https://farmtouch.in/' });
  assert.match(m.full, /^Hi Asha, your order \*FT-1A2B3C4D\* has been placed successfully ✅\nThank you for shopping with Farm’s Touch!/);
  assert.match(m.short, /^your order has been placed successfully: 2 item\(s\), total ₹295/);
  assert.match(m.full, /1\. Tomato \(500 g\) × 2 — ₹80/);
  assert.match(m.full, /Mini basket × 1: Apple, Carrot, Onion, Potato — ₹195/);
  assert.match(m.full, /\*Total: ₹295\* — pay cash\/UPI on delivery/);
  assert.match(m.full, /Delivery slot: Fri, 9 Oct · 9 AM – 12 PM/);
  assert.match(m.full, /Track your order: https:\/\/farmtouch\.in\/\?track=FT-1A2B3C4D/);
  assert.ok(!m.short.includes('\n'));
});
test('delivered message confirms payment, including short or extra cash', () => {
  const o = { ...sampleOrder(), status: 'delivered' };
  assert.match(orderNotice('delivered', o, { cash: 295 }).full, /Payment received: ₹295\./);
  assert.match(orderNotice('delivered', o, { cash: 270 }).full, /Payment received: ₹270\. Balance due: ₹25\./);
  assert.match(orderNotice('delivered', o, { cash: 320 }).short, /Payment received: ₹320 \(bill ₹295\)/);
});
test('online-paid order messages do not request cash', () => {
  const o = { ...sampleOrder(), payment: 'online', paymentStatus: 'paid', status: 'out_for_delivery' };
  assert.match(orderNotice('order_placed', o).full, /paid online/);
  assert.match(orderNotice('out_for_delivery', o).full, /no cash is due/);
  assert.match(orderNotice('delivered', { ...o, status: 'delivered' }, { cash: 0 }).full, /Payment received online: ₹295/);
  assert.doesNotMatch(orderNotice('delivered', { ...o, status: 'delivered' }, { cash: 0 }).full, /Balance due/);
  assert.match(orderNotice('cancelled', { ...o, paymentStatus: 'refund_pending', status: 'cancelled' }).full, /online refund is being processed/);
  assert.match(orderNotice('cancelled', { ...o, paymentStatus: 'refund_failed', status: 'cancelled' }).short, /store will contact you about your refund/);
});
test('change, delivery, failed and cancel messages', () => {
  const o = sampleOrder();
  const ch = orderNotice('items_changed', o, { changes: ['Tomato 2 → 1', 'Onion removed from Mini basket'], previousTotal: 300, note: 'Not available today' });
  assert.match(ch.full, /• Tomato 2 → 1\n• Onion removed from Mini basket/);
  assert.match(ch.full, /New total: \*₹295\* \(was ₹300\)/);
  assert.ok(!ch.short.includes('\n'));
  assert.match(orderNotice('out_for_delivery', o).full, /out for delivery with Ravi Shinde \(9822012345\).*\nPlease keep \*₹295\* ready/);
  assert.match(orderNotice('delivery_failed', o, { note: 'gate closed' }).full, /could not deliver.*\(gate closed\)/);
  assert.match(orderNotice('cancelled', o, { note: 'as you requested' }).full, /cancelled \(as you requested\)\. No payment is due/);
  assert.match(orderNotice('confirmed', o).short, /confirmed\. Delivery Fri, 9 Oct/);
});
test('offer message and tracking link', () => {
  const m = offerNotice('Asha Patil', '20% off fruits\nthis weekend');
  assert.match(m.full, /^Hi Asha, 20% off fruits/);
  assert.match(m.full, /Reply STOP/);
  assert.equal(m.short, '20% off fruits this weekend');
  assert.equal(trackingLink(undefined, 'FT-1'), '');
});
test('workflow: packers and admins can change items before packing is done', () => {
  assert.equal(canDo('edit_items', 'packer', 'packing'), true);
  assert.equal(canDo('edit_items', 'admin', 'placed'), true);
  assert.equal(canDo('edit_items', 'delivery', 'packing'), false);
  assert.equal(canDo('edit_items', 'admin', 'packed'), false);
});

console.log(`${passed} checks passed.`);
