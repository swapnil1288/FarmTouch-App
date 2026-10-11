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

const stockSchema = z.object({ id: z.string(), stock: z.number().int().min(0).max(100000) }).strict();

/**
 * POST { op: 'save', product }  – admin: create or update a product
 * POST { op: 'stock', id, stock } – admin or packer: set stock count after a stock check
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { op?: string; product?: unknown; id?: unknown; stock?: unknown };
    const db = database();
    if (body.op === 'stock') {
      await requireStaff(['admin', 'packer']);
      const s = stockSchema.safeParse({ id: body.id, stock: body.stock });
      if (!s.success) throw new HttpError(400, 'Enter a valid stock number (0 or more).');
      const r = await db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').bind(s.data.stock, nowIso(), s.data.id).run();
      if (!r.meta.changes) throw new HttpError(404, 'Product not found.');
      return json({ products: await listProducts() });
    }
    if (body.op === 'save') {
      await requireStaff(['admin']);
      const parsed = productSchema.safeParse(body.product);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the product details.');
      const p = parsed.data;
      await db
        .prepare(
          `INSERT INTO products (id, name, local, unit, price, mrp, category, image, needs_price_review, stock, active, sort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, local = excluded.local, unit = excluded.unit, price = excluded.price,
             mrp = excluded.mrp, category = excluded.category, image = excluded.image, needs_price_review = excluded.needs_price_review, stock = excluded.stock,
             active = excluded.active, sort = excluded.sort, updated_at = excluded.updated_at`,
        )
        .bind(p.id, p.name, p.local, p.unit, p.price, p.mrp, p.category, p.image, p.needsPriceReview ? 1 : 0, p.stock, p.active ? 1 : 0, p.sort, nowIso())
        .run();
      return json({ products: await listProducts() });
    }
    throw new HttpError(400, 'Unknown operation.');
  } catch (e) {
    return errorResponse(e);
  }
}
