import Shop from './shop';
import { getChatGPTUser } from './chatgpt-auth';
import { storeWhatsAppNumber } from '@/lib/whatsapp-server';
import { listProducts, publicProducts } from '@/lib/server/products';
import { liveStore, type LiveStore } from '@/lib/server/store';
import { DEFAULT_COUPONS, getSlots, type Product } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getChatGPTUser();
  let products: Product[] = [];
  // Fallback if the database is unavailable; the shop refreshes from /api/catalog anyway.
  let store: LiveStore = { coupons: DEFAULT_COUPONS, slots: getSlots(), pincodes: null };
  try {
    const [list, live] = await Promise.all([listProducts(), liveStore()]);
    products = publicProducts(list);
    store = live;
  } catch (e) {
    console.error('Catalogue unavailable', e); // the shop shows a friendly message
  }
  return <Shop userName={user?.fullName || user?.email || null} whatsappNumber={storeWhatsAppNumber()} products={products} store={store} />;
}
