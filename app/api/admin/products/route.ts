import { z } from 'zod';
import { database } from '@/lib/database';
import { PRODUCT_IMAGES, categories } from '@/lib/catalog';
import { listProducts } from '@/lib/server/products';
import { requireStaff } from '@/lib/server/staff';
import { HttpError, errorResponse, json, nowIso, readJsonBody } from '@/lib/server/http';

export async function GET() {
  try {
    await requireStaff(['admin', 'packer']);
    return json({ products: await listProducts(), images: PRODUCT_IMAGES, categories });
  } catch (e) {
    return errorResponse(e);
  }
}

const productSchema = z
  .object({
    id: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, 'ID: 2–30 lowercase letters, numbers or dashes'),
    name: z.string().trim().min(2, 'Name is too short').max(40),
    local: z.string().trim().max(80).default(''),
    unit: z.string().trim().min(1, 'Enter the pack size, e.g. 500 g').max(20),
    price: z.number().int().min(1, 'Price must be at least ₹1').max(100000),
    mrp: z.number().int().min(1).max(100000),
    category: z.enum(categories as [string, ...string[]]),
    image: z.enum(PRODUCT_IMAGES as [string, ...string[]]),
    needsPriceReview: z.boolean().default(false),
    stock: z.number().int().min(0, 'Stock cannot be negative').max(100000),
    active: z.boolean(),
    sort: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
  .refine((p) => p.mrp >= p.price, { message: 'MRP must be equal to or higher than the selling price' })
  .refine((p) => !p.active || !p.needsPriceReview, { message: 'Confirm the product price before publishing it.' });

const stockNumber = z.number().int().min(0).max(100000);
/** `expected` = the stock the staff member saw; the update is refused if orders changed it since. */
const stockSchema = z.object({ id: z.string(), stock: stockNumber, expected: stockNumber.optional() }).strict();

const stockChanged = (live: number) =>
  new HttpError(409, `Stock changed to ${live} since you opened this page (orders reserve stock). Check the shelf count and save again.`);

/**
 * POST { op: 'save', product }  – admin: create or update a product
 * POST { op: 'stock', id, stock } – admin or packer: set stock count after a stock check
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { op?: string; product?: unknown; id?: unknown; stock?: unknown; expected?: unknown; expectedStock?: unknown };
    const db = database();
    if (body.op === 'stock') {
      await requireStaff(['admin', 'packer']);
      const s = stockSchema.safeParse({ id: body.id, stock: body.stock, expected: body.expected });
      if (!s.success) throw new HttpError(400, 'Enter a valid stock number (0 or more).');
      const { id, stock, expected } = s.data;
      const r = expected === undefined
        ? await db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').bind(stock, nowIso(), id).run()
        : await db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ? AND stock = ?').bind(stock, nowIso(), id, expected).run();
      if (!r.meta.changes) {
        const live = await db.prepare('SELECT stock FROM products WHERE id = ?').bind(id).first<{ stock: number }>();
        if (!live) throw new HttpError(404, 'Product not found.');
        throw stockChanged(live.stock);
      }
      return json({ products: await listProducts() });
    }
    if (body.op === 'save') {
      await requireStaff(['admin']);
      const parsed = productSchema.safeParse(body.product);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the product details.');
      const p = parsed.data;
      const expected = stockNumber.optional().safeParse(body.expectedStock);
      if (!expected.success) throw new HttpError(400, 'Invalid stock.');
      const expectedStock = expected.data ?? null;
      // Editing an existing product: if the stock field was left alone, keep the LIVE stock
      // (orders may have reserved some meanwhile). If it was changed, only apply it when the
      // live stock is still what the form showed.
      const keepLive = expectedStock !== null && p.stock === expectedStock ? 1 : 0;
      const r = await db
        .prepare(
          `INSERT INTO products (id, name, local, unit, price, mrp, category, image, needs_price_review, stock, active, sort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, local = excluded.local, unit = excluded.unit, price = excluded.price,
             mrp = excluded.mrp, category = excluded.category, image = excluded.image, needs_price_review = excluded.needs_price_review,
             stock = CASE WHEN ?14 = 1 THEN products.stock ELSE excluded.stock END,
             active = excluded.active, sort = excluded.sort, updated_at = excluded.updated_at
           WHERE ?14 = 1 OR ?15 IS NULL OR products.stock = ?15`,
        )
        .bind(p.id, p.name, p.local, p.unit, p.price, p.mrp, p.category, p.image, p.needsPriceReview ? 1 : 0, p.stock, p.active ? 1 : 0, p.sort, nowIso(), keepLive, expectedStock)
        .run();
      if (!r.meta.changes) {
        const live = await db.prepare('SELECT stock FROM products WHERE id = ?').bind(p.id).first<{ stock: number }>();
        throw stockChanged(live?.stock ?? 0);
      }
      return json({ products: await listProducts() });
    }
    throw new HttpError(400, 'Unknown operation.');
  } catch (e) {
    return errorResponse(e);
  }
}
