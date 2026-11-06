import { z } from 'zod';
import { COUPON_CODE_PATTERN } from '@/lib/catalog';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse, json, readJsonBody } from '@/lib/server/http';
import {
  deletePincode, listCouponsAdmin, listPincodes, saveCoupon, savePincode, saveSettings, saveSlotDay, slotCalendar,
} from '@/lib/server/store';

async function snapshot() {
  const [coupons, calendar, pincodes] = await Promise.all([listCouponsAdmin(), slotCalendar(), listPincodes()]);
  return { coupons, ...calendar, pincodes };
}

/** GET → coupons (with usage), store settings, the next 14 delivery days, delivery pincodes. */
export async function GET() {
  try {
    await requireStaff(['admin']);
    return json(await snapshot());
  } catch (e) {
    return errorResponse(e);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const count = (max: number) => z.number().int().min(0).max(max);

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('coupon'),
    code: z.string().trim().toUpperCase().regex(COUPON_CODE_PATTERN, 'Code: 3–20 letters or numbers, e.g. FRESH50'),
    title: z.string().trim().min(2, 'Give the offer a short title').max(40),
    amount: z.number().int().min(1, 'Discount must be at least ₹1').max(5000),
    min: count(100_000),
    active: z.boolean(),
    /** Last valid India date (YYYY-MM-DD), or null for no expiry. */
    expiresOn: z.string().regex(DATE).nullable(),
    firstOrderOnly: z.boolean(),
    perCustomer: count(100),
    maxUses: count(1_000_000),
  }).strict(),
  z.object({ op: z.literal('settings'), slotCapacity: count(10_000), slotDays: z.number().int().min(1).max(7) }).strict(),
  z.object({
    op: z.literal('day'),
    date: z.string().regex(DATE),
    closed: z.boolean(),
    capacity: count(10_000).nullable(),
    note: z.string().trim().max(80).default(''),
  }).strict(),
  z.object({
    op: z.literal('pincode'),
    pin: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
    area: z.string().trim().max(40).default(''),
    active: z.boolean(),
  }).strict(),
  z.object({ op: z.literal('pincode_delete'), pin: z.string().trim().regex(/^\d{6}$/) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const parsed = opSchema.safeParse(await readJsonBody(request));
    await requireStaff(['admin']);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the details.');
    const b = parsed.data;
    switch (b.op) {
      case 'coupon': {
        if (b.min > 0 && b.amount >= b.min) throw new HttpError(400, 'The discount must be smaller than the minimum item total.');
        // Valid until the end of that day in India.
        const expiresAt = b.expiresOn ? new Date(`${b.expiresOn}T23:59:59.999+05:30`).toISOString() : null;
        await saveCoupon({ ...b, expiresAt });
        break;
      }
      case 'settings':
        await saveSettings({ slotCapacity: b.slotCapacity, slotDays: b.slotDays });
        break;
      case 'day':
        await saveSlotDay(b);
        break;
      case 'pincode':
        await savePincode(b);
        break;
      case 'pincode_delete':
        await deletePincode(b.pin);
        break;
    }
    return json(await snapshot());
  } catch (e) {
    return errorResponse(e);
  }
}
