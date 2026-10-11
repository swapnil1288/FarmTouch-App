import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStaff, needsSetup, setupCode } from '@/lib/server/staff';
import { storeWhatsAppNumber } from '@/lib/whatsapp-server';
import AdminApp from './admin-app';
import LoginScreen from './login-screen';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Farm’s Touch — Staff panel', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const staff = await getStaff('admin');
  if (staff) return <AdminApp me={staff} whatsappNumber={storeWhatsAppNumber()} />;

  let setup = false;
  try {
    setup = await needsSetup();
  } catch (e) {
    console.error('Database not ready', e);
  }
  const user = await getChatGPTUser();
  return <LoginScreen needsSetup={setup} setupLocked={!setupCode()} platformEmail={user?.email ?? null} portal="admin" />;
}
