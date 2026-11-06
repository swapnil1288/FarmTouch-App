import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Orders. `payload` is the immutable snapshot taken at checkout (items, prices,
 * address). The other columns hold the live fulfilment workflow.
 */
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    requestKey: text('request_key').notNull().unique(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    status: text('status').notNull().default('placed'),
    slot: text('slot').notNull().default(''),
    total: integer('total').notNull().default(0),
    assignee: text('assignee'),
    packed: text('packed').notNull().default('[]'),
    cashCollected: integer('cash_collected'),
    updatedAt: text('updated_at').notNull().default(''),
    /** Customer mobile (copy of payload.address.phone) so lookups by phone can use an index. */
    phone: text('phone').notNull().default(''),
    /** Coupon code used ('' = none), copied from the payload for usage limits. */
    coupon: text('coupon').notNull().default(''),
  },
  (t) => [
    index('idx_orders_owner').on(t.owner),
    index('idx_orders_phone').on(t.phone),
    index('idx_orders_coupon').on(t.coupon),
    index('idx_orders_created').on(t.createdAt),
    index('idx_orders_status').on(t.status),
    index('idx_orders_slot').on(t.slot),
    index('idx_orders_assignee').on(t.assignee),
  ],
);

/** Audit trail / customer timeline for every order. */
export const orderEvents = sqliteTable(
  'order_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: text('order_id').notNull(),
    status: text('status').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_order_events_order').on(t.orderId)],
);

/** Live catalogue managed from the admin panel. Stock can never go below zero. */
export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    local: text('local').notNull().default(''),
    unit: text('unit').notNull(),
    price: integer('price').notNull(),
    mrp: integer('mrp').notNull(),
    category: text('category').notNull(),
    image: text('image').notNull(),
    needsPriceReview: integer('needs_price_review', { mode: 'boolean' }).notNull().default(false),
    stock: integer('stock').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sort: integer('sort').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(''),
  },
  (t) => [check('products_stock_non_negative', sql`${t.stock} >= 0`), check('products_price_positive', sql`${t.price} > 0`)],
);

/** Staff who can open /admin. They sign in with email or phone + password. */
export const staff = sqliteTable(
  'staff',
  {
    email: text('email').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    role: text('role').notNull(), // 'admin' | 'packer' | 'delivery'
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    /** PBKDF2-SHA256 hash "iterations:saltHex:hashHex"; empty = no password set yet. */
    passwordHash: text('password_hash').notNull().default(''),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
  },
  (t) => [index('idx_staff_phone').on(t.phone)],
);

/** Staff login sessions. Only a SHA-256 hash of the cookie token is stored. */
export const staffSessions = sqliteTable(
  'staff_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_staff_sessions_email').on(t.email)],
);

/** Server-verified online payment attempts. The client never supplies the amount. */
export const paymentIntents = sqliteTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    requestKey: text('request_key').notNull(),
    payload: text('payload').notNull(),
    amount: integer('amount').notNull(),
    razorpayOrderId: text('razorpay_order_id').notNull(),
    status: text('status').notNull().default('pending'),
    paymentId: text('payment_id'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    inventoryReleased: integer('inventory_released').notNull().default(0),
    notificationsSent: integer('notifications_sent').notNull().default(0),
  },
  (t) => [
    uniqueIndex('idx_payment_intents_owner_request').on(t.owner, t.requestKey),
    uniqueIndex('idx_payment_intents_razorpay_order').on(t.razorpayOrderId),
    index('idx_payment_intents_expiry').on(t.status, t.expiresAt),
  ],
);

/** Inventory reserved by an open online checkout and released exactly once. */
export const paymentStockHolds = sqliteTable(
  'payment_stock_holds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    paymentIntentId: text('payment_intent_id').notNull(),
    productId: text('product_id').notNull(),
    quantity: integer('quantity').notNull(),
    releasedAt: text('released_at'),
  },
  (t) => [index('idx_payment_stock_holds_intent').on(t.paymentIntentId, t.releasedAt)],
);

/** Discount coupons managed in /admin → Store. A flat ₹ amount off the item total. */
export const coupons = sqliteTable(
  'coupons',
  {
    code: text('code').primaryKey(),
    title: text('title').notNull(),
    amount: integer('amount').notNull(),
    min: integer('min').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /** ISO time; null = never expires. */
    expiresAt: text('expires_at'),
    firstOrderOnly: integer('first_order_only', { mode: 'boolean' }).notNull().default(false),
    /** Uses per mobile number (0 = unlimited). */
    perCustomer: integer('per_customer').notNull().default(0),
    /** Total uses across all customers (0 = unlimited). */
    maxUses: integer('max_uses').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [check('coupons_amount_positive', sql`${t.amount} > 0`)],
);

/** Per-date delivery overrides: closed days and capacity. */
export const slotDays = sqliteTable('slot_days', {
  /** India date YYYY-MM-DD. */
  date: text('date').primaryKey(),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  /** Max orders for this date (null = the default from settings). */
  capacity: integer('capacity'),
  note: text('note').notNull().default(''),
});

/** Simple shop-wide settings (key → value). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Pincodes the shop delivers to. Empty list = any Pune postcode (411xxx). */
export const servicePincodes = sqliteTable('service_pincodes', {
  pin: text('pin').primaryKey(),
  area: text('area').notNull().default(''),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

/** Fixed-window request counters for rate limiting (key = action + client IP). */
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('idx_rate_limits_window').on(t.windowStart)],
);

/** Customers (by phone) and their WhatsApp consent. Filled from orders. */
export const customers = sqliteTable('customers', {
  phone: text('phone').primaryKey(),
  name: text('name').notNull(),
  accountType: text('account_type').notNull().default('retail'),
  businessName: text('business_name').notNull().default(''),
  updatesOptIn: integer('updates_opt_in', { mode: 'boolean' }).notNull().default(true),
  offersOptIn: integer('offers_opt_in', { mode: 'boolean' }).notNull().default(false),
  ordersCount: integer('orders_count').notNull().default(0),
  lastOrderAt: text('last_order_at').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(''),
});

/**
 * Every WhatsApp message the shop sends or should send.
 * status: sent (via API) · failed (API error) · pending (send by hand) · manual (sent by hand) · skipped (no consent)
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: text('order_id'),
    phone: text('phone').notNull(),
    name: text('name').notNull().default(''),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    /** One-line version used as a WhatsApp template parameter. */
    summary: text('summary').notNull().default(''),
    status: text('status').notNull(),
    error: text('error'),
    waMessageId: text('wa_message_id'),
    createdAt: text('created_at').notNull(),
    sentAt: text('sent_at'),
    sentBy: text('sent_by'),
  },
  (t) => [index('idx_notifications_order').on(t.orderId), index('idx_notifications_status').on(t.status)],
);
