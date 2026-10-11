// Catalogue types, pricing rules and delivery slots.
// Shared by the browser and the server. Products are LIVE data from the
// database (managed in /admin → Products); every price is recalculated on the
// server from the same rules when an order is placed.

export type Category = 'Vegetables' | 'Fruits' | 'Greens';
export const categories: Category[] = ['Vegetables', 'Fruits', 'Greens'];

export type Product = {
  id: string;
  name: string;
  /** Hindi / Marathi names, used for search. */
  local: string;
  unit: string;
  price: number;
  mrp: number;
  category: Category | string;
  image: string;
  needsPriceReview: boolean;
  /** Live packs in stock. */
  stock: number;
  active: boolean;
  sort: number;
};

/** Starter catalogue – also seeded into the database by the migration. Used by tests. */
export const SAMPLE_PRODUCTS: Product[] = [
  { id: 'tomato', name: 'Tomato', local: 'Tamatar · टोमॅटो', unit: '500 g', price: 40, mrp: 50, category: 'Vegetables', image: 'tomato', needsPriceReview: false, stock: 100, active: true, sort: 1 },
  { id: 'carrot', name: 'Carrot', local: 'Gajar · गाजर', unit: '500 g', price: 32, mrp: 40, category: 'Vegetables', image: 'carrot', needsPriceReview: false, stock: 100, active: true, sort: 2 },
  { id: 'potato', name: 'Potato', local: 'Aloo · बटाटा', unit: '1 kg', price: 35, mrp: 40, category: 'Vegetables', image: 'potato', needsPriceReview: false, stock: 100, active: true, sort: 3 },
  { id: 'onion', name: 'Onion', local: 'Pyaz · Kanda · कांदा', unit: '1 kg', price: 38, mrp: 45, category: 'Vegetables', image: 'onion', needsPriceReview: false, stock: 100, active: true, sort: 4 },
  { id: 'spinach', name: 'Spinach', local: 'Palak · पालक', unit: '1 bunch', price: 25, mrp: 30, category: 'Greens', image: 'spinach', needsPriceReview: false, stock: 60, active: true, sort: 5 },
  { id: 'okra', name: 'Bhindi', local: 'Okra · भेंडी', unit: '500 g', price: 45, mrp: 50, category: 'Vegetables', image: 'okra', needsPriceReview: false, stock: 60, active: true, sort: 6 },
  { id: 'banana', name: 'Banana', local: 'Kela · केळी', unit: '6 pcs', price: 50, mrp: 60, category: 'Fruits', image: 'banana', needsPriceReview: false, stock: 60, active: true, sort: 7 },
  { id: 'apple', name: 'Apple', local: 'Seb · सफरचंद', unit: '500 g', price: 90, mrp: 110, category: 'Fruits', image: 'apple', needsPriceReview: false, stock: 60, active: true, sort: 8 },
];

/** Product photos available in /public/produce. */
export const PRODUCT_IMAGES = [
  'tomato', 'carrot', 'potato', 'onion', 'spinach', 'okra', 'banana', 'apple', 'basket',
  'cauliflower', 'capsicum', 'bitter-gourd', 'radish', 'garlic', 'coriander', 'lemon', 'watermelon', 'mango', 'grapes',
];

const JPEG_PRODUCT_IMAGES = new Set(['capsicum', 'bitter-gourd', 'radish', 'garlic', 'coriander', 'lemon', 'watermelon', 'mango', 'grapes']);

export function productImagePath(image: string): string {
  return `/produce/${image}${JPEG_PRODUCT_IMAGES.has(image) ? '.jpg' : '.webp'}`;
}

export type BasketTypeId = 'mini' | 'family' | 'bulk';
export type BasketType = { id: BasketTypeId; name: string; people: string; items: number; multiplier: number };

export const basketTypes: BasketType[] = [
  { id: 'mini', name: 'Mini basket', people: 'For 1–2 people', items: 4, multiplier: 1 },
  { id: 'family', name: 'Family basket', people: 'For 3–4 people', items: 8, multiplier: 1 },
  { id: 'bulk', name: 'Bulk basket', people: 'For PGs & shared kitchens', items: 8, multiplier: 2 },
];

export const BASKET_PREFIX = 'basket-';
export const MAX_QTY = 10;
export const FREE_DELIVERY_MIN = 699;
export const DELIVERY_FEE = 20;

export type Coupon = { code: string; amount: number; min: number; title: string };
export const coupons: Coupon[] = [
  { code: 'FRESH50', amount: 50, min: 499, title: 'A fresh start' },
  { code: 'BASKET75', amount: 75, min: 799, title: 'Stock up & save' },
];

export type Line = { id: string; qty: number; components?: string[] };
export type Totals = { subtotal: number; discount: number; delivery: number; total: number };

export function isBasketId(id: string): boolean {
  return id.startsWith(BASKET_PREFIX);
}

export function findBasketType(lineId: string): BasketType | undefined {
  return basketTypes.find((b) => BASKET_PREFIX + b.id === lineId);
}

export function couponDiscount(code: string, subtotal: number): number {
  const coupon = coupons.find((c) => c.code === code);
  return coupon && subtotal >= coupon.min ? coupon.amount : 0;
}

export function totalsFor(subtotal: number, coupon = ''): Totals {
  const discount = couponDiscount(coupon, subtotal);
  const delivery = subtotal === 0 ? 0 : subtotal >= FREE_DELIVERY_MIN ? 0 : DELIVERY_FEE;
  return { subtotal, discount, delivery, total: subtotal - discount + delivery };
}

export function discountPercent(p: Pick<Product, 'price' | 'mrp'>): number {
  return p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
}

/** Packs of each product needed for a set of cart lines (baskets expanded). */
export function packsNeeded(lines: Line[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const type = isBasketId(l.id) ? findBasketType(l.id) : undefined;
    if (type) for (const id of l.components ?? []) out[id] = (out[id] || 0) + l.qty * type.multiplier;
    else out[l.id] = (out[l.id] || 0) + l.qty;
  }
  return out;
}

/** All pricing helpers bound to one product list (the live catalogue). */
export function createCatalog(list: Product[]) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const sorted = [...list].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  /** Products a customer can see. */
  const visible = sorted.filter((p) => p.active);
  /** Products a customer can buy right now. */
  const available = visible.filter((p) => p.stock > 0);

  const find = (id: string) => byId.get(id);
  const isBuyable = (id: string) => {
    const p = byId.get(id);
    return !!p && p.active && p.stock > 0;
  };

  function defaultBasket(typeId: string): string[] {
    const type = basketTypes.find((b) => b.id === typeId) ?? basketTypes[1];
    const pool = available.length ? available : visible;
    if (!pool.length) return [];
    return Array.from({ length: type.items }, (_, i) => pool[i % pool.length].id);
  }

  function basketPrice(typeId: string, components: string[]): number {
    const type = basketTypes.find((b) => b.id === typeId);
    return components.reduce((sum, id) => sum + (byId.get(id)?.price ?? 0), 0) * (type?.multiplier ?? 1);
  }

  /** Price of ONE unit of a cart line. */
  function linePrice(line: Line): number {
    if (isBasketId(line.id)) return basketPrice(findBasketType(line.id)?.id ?? '', line.components ?? []);
    return byId.get(line.id)?.price ?? 0;
  }

  function priceCart(lines: Line[], coupon = ''): Totals {
    return totalsFor(lines.reduce((sum, l) => sum + linePrice(l) * l.qty, 0), coupon);
  }

  function mrpSavings(lines: Line[]): number {
    let savings = 0;
    for (const [id, packs] of Object.entries(packsNeeded(lines))) {
      const p = byId.get(id);
      if (p && p.mrp > p.price) savings += (p.mrp - p.price) * packs;
    }
    return savings;
  }

  function search(query: string): Product[] {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((p) => `${p.name} ${p.local} ${p.category}`.toLowerCase().includes(q));
  }

  function lineName(l: Line): string {
    return isBasketId(l.id) ? findBasketType(l.id)?.name ?? 'Basket' : byId.get(l.id)?.name ?? l.id;
  }

  return { products: sorted, visible, available, find, isBuyable, defaultBasket, basketPrice, linePrice, priceCart, mrpSavings, search, lineName };
}

export type Catalog = ReturnType<typeof createCatalog>;

// ---------------------------------------------------------------- delivery slots

const IST_OFFSET_MS = 330 * 60 * 1000;
const slotFormatter = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export type Slot = { id: string; label: string };

/** India calendar date (YYYY-MM-DD) for a moment in time. */
export function istDate(now: Date = new Date(), offsetDays = 0): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
}

export function labelForSlotId(id: string): string {
  const date = id.slice(0, 10);
  const day = new Date(date + 'T06:30:00Z'); // 12:00 IST
  if (Number.isNaN(day.getTime())) return id;
  return `${slotFormatter.format(day)} · 9 AM – 12 PM`;
}

/** Next three morning slots, calculated on the India calendar date. */
export function getSlots(now: Date = new Date()): Slot[] {
  return [1, 2, 3].map((offset) => {
    const id = `${istDate(now, offset)}-morning`;
    return { id, label: labelForSlotId(id) };
  });
}
