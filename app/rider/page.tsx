import { getStaff } from '@/lib/server/staff';
import { storeWhatsAppNumber } from '@/lib/whatsapp-server';
import AdminApp from '@/app/admin/admin-app';
import LoginScreen from '@/app/admin/login-screen';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Farm’s Touch — Rider portal', robots: { index: false, follow: false } };

export default async function RiderPage() {
  const staff = await getStaff('rider');
  if (staff) return <AdminApp me={staff} whatsappNumber={storeWhatsAppNumber()} />;
  return <LoginScreen needsSetup={false} setupLocked={true} platformEmail={null} portal="rider" />;
}