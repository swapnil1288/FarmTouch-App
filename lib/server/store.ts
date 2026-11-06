// Shop rules managed in /admin → Store (server only):
// coupons, delivery-day capacity / closures, and the delivery pincode list.
import { database } from '@/lib/database';
import { DEFAULT_SLOT_DAYS, getSlots, istDate, labelForSlotId, type Coupon, type Slot } from '@/lib/catalog';
import type { StoreRules } from '@/lib/order-validation';
import { HttpError, nowIso } from './http';

// ---------------------------------------------------------------- coupons

type CouponRow = {
  code: string; title: string; amount: number; min: number; active: number; expires_at: string | null;
  first_order_only: number; per_customer: number; max_uses: number; created_at: string; updated_at: string;
};

/** Everything staff see about a coupon, including how often it was used (non-cancelled orders). */
export type CouponAdmin = Required<Coupon> & { active: boolean; maxUses: number; uses: number; createdAt: string; updatedAt: string };

const toCoupon = (r: CouponRow): Coupon => ({
  code: r.code, title: r.title, amount: r.amount, min: r.min, expiresAt: r.expires_at,
  firstOrderOnly: !!r.first_order_only, perCustomer: r.per_customer,
});

/** Coupons customers can use right now (active and not expired). */
export async function liveCoupons(now = nowIso()): Promise<Coupon[]> {
  const res = await database()
    .prepare('SELECT * FROM coupons WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY min, code')
    .bind(now)
    .all<CouponRow>();
  return res.results.map(toCoupon);
}

export async function listCouponsAdmin(): Promise<CouponAdmin[]> {
  const res = await database()
    .prepare(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.coupon = c.code AND o.status != 'cancelled') AS uses
      FROM coupons c ORDER BY c.active DESC, c.code`)
    .all<CouponRow & { uses: number }>();
  return res.results.map((r) => ({
    ...(toCoupon(r) as Required<Coupon>), active: !!r.active, maxUses: r.max_uses, uses: r.uses,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export type CouponInput = {
  code: string; title: string; amount: number; min: number; active: boolean; expiresAt: string | null;
  firstOrderOnly: boolean; perCustomer: number; maxUses: number;
};

export async function saveCoupon(c: CouponInput): Promise<void> {
  const now = nowIso();
  await database()
    .prepare(`INSERT INTO coupons (code, title, amount, min, active, expires_at, first_order_only, per_customer, max_uses, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET title = excluded.title, amount = excluded.amount, min = excluded.min, active = excluded.active,
        expires_at = excluded.expires_at, first_order_only = excluded.first_order_only, per_customer = excluded.per_customer,
        max_uses = excluded.max_uses, updated_at = excluded.updated_at`)
    .bind(c.code, c.title, c.amount, c.min, c.active ? 1 : 0, c.expiresAt, c.firstOrderOnly ? 1 : 0, c.perCustomer, c.maxUses, now, now)
    .run();
}

/**
 * Checks the limits that depend on order history (first order, uses per customer, total uses).
 * Only non-cancelled orders count, so a cancelled order gives the coupon back.
 * Note: two orders placed at the very same moment could both pass; the amounts are small,
 * so this is accepted rather than locking.
 */
export async function checkCouponUse(code: string, phone: string): Promise<void> {
  if (!code) return;
  const db = database();
  const c = await db.prepare('SELECT * FROM coupons WHERE code = ?').bind(code).first<CouponRow>();
  if (!c) throw new HttpError(400, 'This coupon is not valid or has expired.');
  const counts = await db
    .prepare(`SELECT
        (SELECT COUNT(*) FROM orders WHERE coupon = ?1 AND status != 'cancelled') AS total,
        (SELECT COUNT(*) FROM orders WHERE coupon = ?1 AND phone = ?2 AND status != 'cancelled') AS mine,
        (SELECT COUNT(*) FROM orders WHERE phone = ?2 AND status != 'cancelled') AS orders`)
    .bind(code, phone)
    .first<{ total: number; mine: number; orders: number }>();
  const n = counts ?? { total: 0, mine: 0, orders: 0 };
  if (c.first_order_only && n.orders > 0) throw new HttpError(409, `${code} is only for your first order.`);
  if (c.per_customer > 0 && n.mine >= c.per_customer) {
    throw new HttpError(409, c.per_customer === 1 ? `You have already used ${code}.` : `You have already used ${code} ${c.per_customer} times.`);
  }
  if (c.max_uses > 0 && n.total >= c.max_uses) throw new HttpError(409, `${code} has been fully claimed. Please try another offer.`);
}

// ---------------------------------------------------------------- settings

export type StoreSettings = {
  /** Max orders per delivery day (0 = no limit). */
  slotCapacity: number;
  /** Delivery days offered to customers. */
  slotDays: number;
};

const SETTING_DEFAULTS: StoreSettings = { slotCapacity: 0, slotDays: DEFAULT_SLOT_DAYS };

export async function getSettings(): Promise<StoreSettings> {
  const res = await database().prepare("SELECT key, value FROM settings WHERE key IN ('slot_capacity', 'slot_days')").all<{ key: string; value: string }>();
  const map = new Map(res.results.map((r) => [r.key, Number(r.value)]));
  const pick = (k: string, d: number, max: number) => {
    const v = map.get(k);
    return v !== undefined && Number.isInteger(v) && v >= 0 && v <= max ? v : d;
  };
  return { slotCapacity: pick('slot_capacity', SETTING_DEFAULTS.slotCapacity, 10_000), slotDays: Math.max(1, pick('slot_days', SETTING_DEFAULTS.slotDays, 7)) };
}

export async function saveSettings(s: StoreSettings): Promise<void> {
  const db = database();
  const up = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
  await db.batch([
    db.prepare(up).bind('slot_capacity', String(s.slotCapacity)),
    db.prepare(up).bind('slot_days', String(s.slotDays)),
  ]);
}

// ---------------------------------------------------------------- delivery days

type SlotDayRow = { date: string; closed: number; capacity: number | null; note: string };

/** One delivery date as staff see it in /admin → Store. */
export type SlotDay = {
  date: string; label: string; closed: boolean; note: string;
  /** Override for this date (null = the default). */
  capacity: number | null;
  /** Limit that applies (0 = no limit). */
  effectiveCapacity: number;
  booked: number;
};

/** Orders (non-cancelled) plus open online checkouts per slot id. */
async function bookedBySlot(slotIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!slotIds.length) return out;
  const db = database();
  const marks = slotIds.map(() => '?').join(',');
  const [orders, holds] = await db.batch<{ slot: string; n: number }>([
    db.prepare(`SELECT slot, COUNT(*) AS n FROM orders WHERE slot IN (${marks}) AND status != 'cancelled' GROUP BY slot`).bind(...slotIds),
    // An online checkout in progress also takes a place (its stock is already held).
    db.prepare(`SELECT json_extract(payload, '$.slot') AS slot, COUNT(*) AS n FROM payment_intents
      WHERE status = 'pending' AND expires_at > ? AND json_extract(payload, '$.slot') IN (${marks}) GROUP BY 1`).bind(nowIso(), ...slotIds),
  ]);
  for (const r of [...orders.results, ...holds.results]) out.set(r.slot, (out.get(r.slot) ?? 0) + r.n);
  return out;
}

async function slotDayRows(fromDate: string): Promise<Map<string, SlotDayRow>> {
  const res = await database().prepare('SELECT * FROM slot_days WHERE date >= ?').bind(fromDate).all<SlotDayRow>();
  return new Map(res.results.map((r) => [r.date, r]));
}

/** Delivery slots offered to customers right now, with fully booked days marked. */
export async function liveSlots(now = new Date()): Promise<Slot[]> {
  const [settings, days] = await Promise.all([getSettings(), slotDayRows(istDate(now, 1))]);
  const closed = [...days.values()].filter((d) => d.closed).map((d) => d.date);
  const slots = getSlots(now, { days: settings.slotDays, closed });
  const booked = await bookedBySlot(slots.map((s) => s.id));
  return slots.map((s) => {
    const cap = days.get(s.id.slice(0, 10))?.capacity ?? settings.slotCapacity;
    return cap > 0 && (booked.get(s.id) ?? 0) >= cap ? { ...s, full: true } : s;
  });
}

/** The next two weeks of delivery dates for the admin calendar. */
export async function slotCalendar(now = new Date()): Promise<{ settings: StoreSettings; days: SlotDay[] }> {
  const [settings, rows] = await Promise.all([getSettings(), slotDayRows(istDate(now, 1))]);
  const dates = Array.from({ length: 14 }, (_, i) => istDate(now, i + 1));
  const booked = await bookedBySlot(dates.map((d) => `${d}-morning`));
  return {
    settings,
    days: dates.map((date) => {
      const r = rows.get(date);
      return {
        date, label: labelForSlotId(`${date}-morning`).split(' · ')[0], closed: !!r?.closed, note: r?.note ?? '',
        capacity: r?.capacity ?? null, effectiveCapacity: r?.capacity ?? settings.slotCapacity, booked: booked.get(`${date}-morning`) ?? 0,
      };
    }),
  };
}

export async function saveSlotDay(d: { date: string; closed: boolean; capacity: number | null; note: string }): Promise<void> {
  const db = database();
  // Nothing special about this date any more: remove the override.
  if (!d.closed && d.capacity === null && !d.note) {
    await db.prepare('DELETE FROM slot_days WHERE date = ?').bind(d.date).run();
    return;
  }
  await db
    .prepare(`INSERT INTO slot_days (date, closed, capacity, note) VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET closed = excluded.closed, capacity = excluded.capacity, note = excluded.note`)
    .bind(d.date, d.closed ? 1 : 0, d.capacity, d.note)
    .run();
}

// ---------------------------------------------------------------- pincodes

export type Pincode = { pin: string; area: string; active: boolean };

/** Active delivery pincodes, or null when no list is set up (any 411xxx is accepted). */
export async function activePincodes(): Promise<string[] | null> {
  const res = await database().prepare('SELECT pin FROM service_pincodes WHERE active = 1 ORDER BY pin').all<{ pin: string }>();
  return res.results.length ? res.results.map((r) => r.pin) : null;
}

export async function listPincodes(): Promise<Pincode[]> {
  const res = await database().prepare('SELECT * FROM service_pincodes ORDER BY active DESC, pin').all<{ pin: string; area: string; active: number }>();
  return res.results.map((r) => ({ pin: r.pin, area: r.area, active: !!r.active }));
}

export async function savePincode(p: Pincode): Promise<void> {
  await database()
    .prepare('INSERT INTO service_pincodes (pin, area, active) VALUES (?, ?, ?) ON CONFLICT(pin) DO UPDATE SET area = excluded.area, active = excluded.active')
    .bind(p.pin, p.area, p.active ? 1 : 0)
    .run();
}

export async function deletePincode(pin: string): Promise<void> {
  await database().prepare('DELETE FROM service_pincodes WHERE pin = ?').bind(pin).run();
}

// ---------------------------------------------------------------- everything the shop needs

export type LiveStore = StoreRules & { coupons: Coupon[] };

export async function liveStore(): Promise<LiveStore> {
  const [coupons, slots, pincodes] = await Promise.all([liveCoupons(), liveSlots(), activePincodes()]);
  return { coupons, slots, pincodes };
}
