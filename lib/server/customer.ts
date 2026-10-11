// Who is the customer on this request? (server only)
// Hosting-platform sign-in is used when present; otherwise a private device
// cookie identifies the customer, so ordering works on any hosting without a login.
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { customerDeviceId, newCustomerDevice } from './auth';

export async function customerOwner(): Promise<string | null> {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  const device = await customerDeviceId();
  return device ? `guest:${device}` : null;
}

/** Owner id for placing an order, creating a device cookie if needed. */
export async function customerOwnerOrCreate(request: Request): Promise<{ owner: string; setCookie?: string }> {
  const existing = await customerOwner();
  if (existing) return { owner: existing };
  const device = newCustomerDevice(request);
  return { owner: `guest:${device.id}`, setCookie: device.setCookie };
}

/** Public shop address for links in messages (SHOP_URL if set, else this request's origin). */
export function siteUrlFrom(request: Request): string {
  const configured = ((env as unknown as { SHOP_URL?: string }).SHOP_URL ?? '').trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, '');
}
