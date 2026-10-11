import Shop from './shop';
import { getChatGPTUser } from './chatgpt-auth';
import { storeWhatsAppNumber } from '@/lib/whatsapp-server';
import { listProducts, publicProducts } from '@/lib/server/products';
import type { Product } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getChatGPTUser();
  let products: Product[] = [];
  try {
    products = publicProducts(await listProducts());
  } catch (e) {
    console.error('Catalogue unavailable', e); // the shop shows a friendly message
  }
  return <Shop userName={user?.fullName || user?.email || null} whatsappNumber={storeWhatsAppNumber()} products={products} />;
}
