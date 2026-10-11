// Small HTTP helpers for API routes (server only).

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const noStore = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: 'Something went wrong. Please try again.' }, 503);
}

const MAX_BODY_BYTES = 32 * 1024;

/** Reads a same-origin JSON POST body with a size limit. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES * 4) throw new HttpError(413, 'Request is too large.');
  // Always drain the body before answering; replying with an unread body can
  // make the runtime drop the connection.
  const raw = await request.text();
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Request origin rejected.');
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Expected JSON.');
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid data.');
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
