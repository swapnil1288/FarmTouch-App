const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function rupeesToPaise(amount: number): number {
  const paise = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(paise)) {
    throw new Error('Invalid payment amount.');
  }
  return paise;
}

export async function razorpayHmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

export async function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret: string): Promise<boolean> {
  if (!/^[\w-]{1,64}$/.test(orderId) || !/^[\w-]{1,64}$/.test(paymentId) || !/^[0-9a-f]{64}$/i.test(signature) || !secret) return false;
  const expected = fromHex(await razorpayHmac(secret, `${orderId}|${paymentId}`));
  const actual = fromHex(signature.toLowerCase());
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}