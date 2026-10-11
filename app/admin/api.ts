// Small fetch helper for the staff panel (browser).

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    const portal = window.location.pathname.startsWith('/rider') ? 'rider' : 'admin';
    const headers = new Headers({ 'X-Staff-Portal': portal });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    r = await fetch(path, body === undefined
      ? { cache: 'no-store', headers }
      : { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Network problem. Check your internet and try again.');
  }
  let d: (T & { error?: string }) | null = null;
  try {
    d = (await r.json()) as T & { error?: string };
  } catch {
    /* non-JSON */
  }
  if (!r.ok || !d) throw new Error(d?.error || `Server error (${r.status}). Please try again.`);
  return d;
}
