import { basketTypes } from '@/lib/catalog';
import { listProducts, publicProducts } from '@/lib/server/products';
import { expirePaymentIntents } from '@/lib/server/razorpay';
import { liveStore } from '@/lib/server/store';
import { errorResponse, json } from '@/lib/server/http';

export async function GET() {
  try {
    await expirePaymentIntents();
    const [products, store] = await Promise.all([listProducts(), liveStore()]);
    // coupons: active & unexpired · slots: open days (full ones flagged) · pincodes: null = any 411xxx
    return json({ products: publicProducts(products), basketTypes, coupons: store.coupons, slots: store.slots, pincodes: store.pincodes });
  } catch (e) {
    return errorResponse(e);
  }
}
