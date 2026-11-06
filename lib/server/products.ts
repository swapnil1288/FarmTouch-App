// Live catalogue stored in D1 (server only).
import { database } from '@/lib/database';
import { createCatalog, type Coupon, type Product } from '@/lib/catalog';

type ProductRow = {
  id: string; name: string; local: string; unit: string; price: number; mrp: number;
  category: string; image: string; needs_price_review: number; stock: number; active: number; sort: number;
};

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id, name: r.name, local: r.local, unit: r.unit, price: r.price, mrp: r.mrp,
    category: r.category, image: r.image, needsPriceReview: !!r.needs_price_review, stock: r.stock, active: !!r.active, sort: r.sort,
  };
}

export async function listProducts(): Promise<Product[]> {
  const res = await database().prepare('SELECT * FROM products ORDER BY sort, name').all<ProductRow>();
  return res.results.map(toProduct);
}

/** Catalogue for pricing/validation, including inactive products (so old lines still resolve). */
export async function loadCatalog(coupons: Coupon[]) {
  return createCatalog(await listProducts(), coupons);
}

/** What a customer may see: active products only, without internal fields. */
export function publicProducts(list: Product[]): Product[] {
  return list.filter((p) => p.active);
}
