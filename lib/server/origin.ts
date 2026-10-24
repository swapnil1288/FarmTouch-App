import { env, isPublicNodeRuntime } from '@/lib/runtime-env';

/** The public address, even when a reverse proxy forwards plain HTTP to Next. */
export function publicOrigin(request: Request): string {
  const configured = String(env.SHOP_URL ?? '').trim()
    || (isPublicNodeRuntime ? process.env.RENDER_EXTERNAL_URL?.trim() : '');
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  // Next may construct request.url using its listen address. Use the actual Host
  // for local Node development; Render uses its configured external URL above.
  if (isPublicNodeRuntime && request.headers.get('host')) {
    return new URL(`${url.protocol}//${request.headers.get('host')}`).origin;
  }
  return url.origin;
}
