import { basketTypes, coupons, getSlots } from '@/lib/catalog';
import { listProducts, publicProducts } from '@/lib/server/products';
import { expirePaymentIntents } from '@/lib/server/razorpay';
import { errorResponse, json } from '@/lib/server/http';

export async function GET() {
  try {
    await expirePaymentIntents();
    const products = publicProducts(await listProducts());
    return json({ products, basketTypes, coupons, slots: getSlots() });
  } catch (e) {
    return errorResponse(e);
  }
}
