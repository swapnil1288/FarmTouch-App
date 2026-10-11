import { z } from 'zod';
import { BASKET_PREFIX, MAX_QTY, coupons, findBasketType, getSlots, packsNeeded, type Catalog } from './catalog';
import { snapshotItems } from './orders';

const line = z
  .object({
    id: z.string().max(40),
    qty: z.number().int().min(1).max(MAX_QTY),
    components: z.array(z.string().max(40)).min(1).max(8).optional(),
  })
  .strict();

const couponCodes = ['', ...coupons.map((c) => c.code)] as [string, ...string[]];

export const PHONE_PATTERN = /^[6-9]\d{9}$/;
export const PIN_PATTERN = /^411\d{3}$/;

export const addressSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(100),
    street: z.string().trim().min(8, 'Enter your flat, building and street').max(300),
    phone: z.string().trim().regex(PHONE_PATTERN, 'Enter a valid 10-digit Indian mobile number'),
    pin: z.string().trim().regex(PIN_PATTERN, 'We deliver to Pune postcodes (411xxx) only'),
  })
  .strict();

export type Address = z.infer<typeof addressSchema>;

export const orderSchema = z
  .object({
    lines: z.array(line).min(1, 'Your cart is empty').max(30),
    coupon: z.enum(couponCodes).default(''),
    address: addressSchema,
    slot: z.string().max(40),
    payment: z.enum(['cod', 'online']),
    replacement: z.enum(['ask', 'omit']),
    whatsappUpdates: z.boolean().default(false),
    whatsappOffers: z.boolean().default(false),
    requestKey: z.string().regex(/^[\w-]{16,60}$/),
  })
  .strict();

export type OrderInput = z.infer<typeof orderSchema>;

export class OrderValidationError extends Error {}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Please check your order details.';
  const path = issue.path[0];
  if (path === 'address') return issue.message.startsWith('Expected') || issue.message === 'Required' ? 'Please complete your delivery address.' : issue.message;
  if (path === 'payment') return 'Choose a valid payment method.';
  if (path === 'coupon') return 'This coupon is not valid.';
  if (path === 'lines') return issue.message === 'Your cart is empty' ? issue.message : 'Some items in your cart are invalid. Please review your cart.';
  return 'Please check your cart, address and delivery slot.';
}

/**
 * Validates an order against the LIVE catalogue and returns authoritative
 * totals plus an item snapshot (names/prices at the time of ordering).
 * Final stock is enforced again atomically in the database.
 */
export function validateOrder(input: unknown, catalog: Catalog) {
  const result = orderSchema.safeParse(input);
  if (!result.success) throw new OrderValidationError(firstIssueMessage(result.error));
  const b = result.data;

  const seen = new Set<string>();
  for (const l of b.lines) {
    if (seen.has(l.id)) throw new OrderValidationError('Duplicate cart lines are not allowed.');
    seen.add(l.id);
    if (l.id.startsWith(BASKET_PREFIX)) {
      const type = findBasketType(l.id);
      if (!type || !l.components || l.components.length !== type.items) throw new OrderValidationError('Basket has an invalid number of items.');
    } else if (l.components) {
      throw new OrderValidationError('Product data is invalid.');
    }
  }

  const needed = packsNeeded(b.lines);
  for (const [id, q] of Object.entries(needed)) {
    const p = catalog.find(id);
    if (!p || !p.active) throw new OrderValidationError('One or more products are no longer available. Please review your cart.');
    if (p.stock <= 0) throw new OrderValidationError(`${p.name} is out of stock. Please remove it from your cart.`);
    if (q > p.stock) throw new OrderValidationError(`Only ${p.stock} packs of ${p.name} are left.`);
  }

  const slot = getSlots().find((s) => s.id === b.slot);
  if (!slot) throw new OrderValidationError('That delivery slot is no longer available. Please choose another.');

  const totals = catalog.priceCart(b.lines, b.coupon);
  if (b.coupon && totals.discount === 0) {
    const min = coupons.find((c) => c.code === b.coupon)?.min ?? 0;
    throw new OrderValidationError(`${b.coupon} needs an item subtotal of ₹${min} or more.`);
  }

  return { body: b, totals, slotLabel: slot.label, items: snapshotItems(b.lines, catalog), packs: needed };
}
