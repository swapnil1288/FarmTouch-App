// Server-only WhatsApp sending + message log.
//
// Every customer message is written to the `notifications` table:
//   queued  – waiting to be sent automatically (offers are sent in batches)
//   sent    – sent automatically through the WhatsApp Business Cloud API
//   failed  – the API refused it (error saved; staff can retry or send by hand)
//   pending – API not set up: staff send it with one tap from /admin → WhatsApp
//   manual  – staff sent it by hand
//   skipped – customer did not agree to WhatsApp messages
//
// Variables (see README → "WhatsApp setup"):
//   WHATSAPP_STORE_NUMBER    – store number with country code (click-to-chat + store alerts)
//   WHATSAPP_TOKEN           – Cloud API permanent access token (secret)
//   WHATSAPP_PHONE_NUMBER_ID – Cloud API sender phone-number ID
//   WHATSAPP_UPDATE_TEMPLATE – approved UTILITY template for order messages: {{1}} name, {{2}} order id, {{3}} message
//   WHATSAPP_OFFER_TEMPLATE  – approved MARKETING template for offers:      {{1}} name, {{2}} offer text
//   WHATSAPP_ORDER_TEMPLATE  – (optional) store alert template:            {{1}} order id, {{2}} customer, {{3}} total, {{4}} slot
//   WHATSAPP_TEMPLATE_LANG   – template language code, default "en"

import { env } from '@/lib/runtime-env';
import { database } from './database';
import { normaliseWhatsAppNumber, describeItem } from './whatsapp';
import { offerNotice, orderNotice, type NoticeExtra, type NoticeKind } from './notify-text';
import type { OrderRecord } from './orders';

const GRAPH_VERSION = 'v23.0';

type WaEnv = {
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_STORE_NUMBER?: string;
  WHATSAPP_UPDATE_TEMPLATE?: string;
  WHATSAPP_OFFER_TEMPLATE?: string;
  WHATSAPP_ORDER_TEMPLATE?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
  /** Only for automated tests: send to a fake API instead of graph.facebook.com. */
  WHATSAPP_API_BASE?: string;
};

function config(): WaEnv {
  return env as unknown as WaEnv;
}

/** Store number for click-to-chat links (public, not secret). */
export function storeWhatsAppNumber(): string {
  return normaliseWhatsAppNumber(config().WHATSAPP_STORE_NUMBER);
}

export function apiEnabled(): boolean {
  const c = config();
  return !!(c.WHATSAPP_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID);
}

/** What is configured (shown in /admin → WhatsApp). Never exposes secrets. */
export function whatsappStatus() {
  const c = config();
  return {
    storeNumber: storeWhatsAppNumber(),
    api: apiEnabled(),
    updateTemplate: c.WHATSAPP_UPDATE_TEMPLATE || '',
    offerTemplate: c.WHATSAPP_OFFER_TEMPLATE || '',
    storeAlertTemplate: c.WHATSAPP_ORDER_TEMPLATE || '',
    language: c.WHATSAPP_TEMPLATE_LANG || 'en',
  };
}

type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

async function callApi(payload: Record<string, unknown>): Promise<SendResult> {
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId } = config();
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp API is not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const base = (config().WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
    const res = await fetch(`${base}/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
    if (!res.ok) return { ok: false, error: `${body?.error?.message ?? 'WhatsApp API error'} (HTTP ${res.status}${body?.error?.code ? `, code ${body.error.code}` : ''})` };
    return { ok: true, id: body?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).name === 'AbortError' ? 'WhatsApp API timed out' : String((e as Error).message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

function template(to: string, name: string, params: string[]) {
  return {
    to,
    type: 'template',
    template: {
      name,
      language: { code: config().WHATSAPP_TEMPLATE_LANG || 'en' },
      components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) }],
    },
  };
}

const textMessage = (to: string, body: string) => ({ to, type: 'text', text: { preview_url: true, body } });

// ---------------------------------------------------------------- consent

async function consent(phone: string): Promise<{ updates: boolean; offers: boolean } | null> {
  const r = await database().prepare('SELECT updates_opt_in, offers_opt_in FROM customers WHERE phone = ?').bind(phone).first<{ updates_opt_in: number; offers_opt_in: number }>();
  return r ? { updates: !!r.updates_opt_in, offers: !!r.offers_opt_in } : null;
}

/** Records a customer's WhatsApp choices from checkout. */
export async function upsertCustomer(phone: string, name: string, updates: boolean, offers: boolean, at: string) {
  await database()
    .prepare(
      `INSERT INTO customers (phone, name, updates_opt_in, offers_opt_in, orders_count, last_order_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, updates_opt_in = excluded.updates_opt_in, offers_opt_in = excluded.offers_opt_in,
         orders_count = customers.orders_count + 1, last_order_at = excluded.last_order_at, updated_at = excluded.updated_at`,
    )
    .bind(phone, name, updates ? 1 : 0, offers ? 1 : 0, at, at)
    .run();
}

// ---------------------------------------------------------------- log + send

type Row = { id: number; order_id: string | null; phone: string; name: string; kind: string; message: string; summary: string; status: string; error: string | null };

async function insertLog(n: { orderId: string | null; phone: string; name: string; kind: NoticeKind; message: string; summary: string; status: string; error?: string | null; waId?: string | null; sentBy?: string | null }) {
  const now = new Date().toISOString();
  const sent = n.status === 'sent' || n.status === 'manual';
  const r = await database()
    .prepare('INSERT INTO notifications (order_id, phone, name, kind, message, summary, status, error, wa_message_id, created_at, sent_at, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(n.orderId, n.phone, n.name, n.kind, n.message, n.summary, n.status, n.error ?? null, n.waId ?? null, now, sent ? now : null, sent ? n.sentBy ?? 'system' : null)
    .run();
  return r.meta.last_row_id;
}

/** Sends one customer message through the API (template if configured, else free text). */
async function deliver(kind: NoticeKind, phone: string, name: string, orderId: string | null, text: { full: string; short: string }): Promise<SendResult> {
  const c = config();
  const to = normaliseWhatsAppNumber(phone);
  if (!to) return { ok: false, error: 'Invalid phone number' };
  if (kind === 'offer') {
    return c.WHATSAPP_OFFER_TEMPLATE ? callApi(template(to, c.WHATSAPP_OFFER_TEMPLATE, [name || 'there', text.short])) : callApi(textMessage(to, text.full));
  }
  if (c.WHATSAPP_UPDATE_TEMPLATE) return callApi(template(to, c.WHATSAPP_UPDATE_TEMPLATE, [name || 'there', orderId ?? '-', text.short]));
  // Free-form text only reaches customers who messaged the shop in the last 24 hours.
  return callApi(textMessage(to, text.full));
}

/**
 * Sends (or queues for manual sending) a customer message about an order event.
 * Never throws – messaging must not break order processing.
 */
export type NoticeResult = 'sent' | 'failed' | 'pending' | 'skipped' | 'error';

export async function notifyCustomer(kind: Exclude<NoticeKind, 'offer' | 'test' | 'store_alert'>, order: OrderRecord, extra: NoticeExtra = {}): Promise<NoticeResult> {
  try {
    const phone = order.address.phone;
    const name = order.address.name;
    const text = orderNotice(kind, order, extra);
    const c = await consent(phone);
    const allowed = c ? c.updates : !!order.whatsappUpdates;
    if (!allowed) {
      await insertLog({ orderId: order.id, phone, name, kind, message: text.full, summary: text.short, status: 'skipped', error: 'Customer did not opt in to WhatsApp updates' });
      return 'skipped';
    }
    if (!apiEnabled()) {
      await insertLog({ orderId: order.id, phone, name, kind, message: text.full, summary: text.short, status: 'pending' });
      return 'pending';
    }
    const r = await deliver(kind, phone, name, order.id, text);
    await insertLog({ orderId: order.id, phone, name, kind, message: text.full, summary: text.short, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, waId: r.ok ? r.id : null });
    return r.ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('notifyCustomer failed', e);
    return 'error';
  }
}

/** New order alert to the store's own WhatsApp (API only). Never throws. */
export async function alertStore(order: OrderRecord): Promise<void> {
  try {
    const c = config();
    const store = storeWhatsAppNumber();
    if (!apiEnabled() || !store) return;
    const full = [
      `🧺 New order ${order.id}`,
      ...order.items.map((it) => '• ' + describeItem(it)),
      `Total: ₹${order.totals.total} (COD)`,
      `Slot: ${order.slotLabel}`,
      `${order.address.name} · ${order.address.phone}`,
      `${order.address.street}, ${order.address.pin}`,
    ].join('\n');
    const short = `New order ${order.id} from ${order.address.name} (${order.address.phone}), total ₹${order.totals.total}, ${order.slotLabel}`;
    const r = c.WHATSAPP_ORDER_TEMPLATE
      ? await callApi(template(store, c.WHATSAPP_ORDER_TEMPLATE, [order.id, order.address.name, '₹' + order.totals.total, order.slotLabel]))
      : await callApi(textMessage(store, full));
    if (!r.ok) console.error('Store alert failed', r.error);
    // Logged in /admin → WhatsApp so the shop can see both sides of every order.
    await insertLog({ orderId: order.id, phone: store.slice(-10), name: 'Farm’s Touch (shop)', kind: 'store_alert', message: full, summary: short, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, waId: r.ok ? r.id : null });
  } catch (e) {
    console.error('alertStore failed', e);
  }
}

// ---------------------------------------------------------------- staff tools

export type NotificationRow = {
  id: number; orderId: string | null; phone: string; name: string; kind: string; message: string;
  status: string; error: string | null; createdAt: string; sentAt: string | null; sentBy: string | null;
};

type DbRow = Row & { created_at: string; sent_at: string | null; sent_by: string | null };
const toRow = (r: DbRow): NotificationRow => ({
  id: r.id, orderId: r.order_id, phone: r.phone, name: r.name, kind: r.kind, message: r.message,
  status: r.status, error: r.error, createdAt: r.created_at, sentAt: r.sent_at, sentBy: r.sent_by,
});

export async function listNotifications(f: { status?: string; orderId?: string; limit?: number }): Promise<NotificationRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.orderId) { where.push('order_id = ?'); args.push(f.orderId); }
  if (f.status === 'todo') where.push("status IN ('pending', 'failed', 'queued')");
  else if (f.status && f.status !== 'all') { where.push('status = ?'); args.push(f.status); }
  const res = await database()
    .prepare(`SELECT * FROM notifications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(f.limit ?? 100, 500)}`)
    .bind(...args)
    .all<DbRow>();
  return res.results.map(toRow);
}

export async function countTodo(): Promise<number> {
  const r = await database().prepare("SELECT COUNT(*) AS n FROM notifications WHERE status IN ('pending', 'failed')").first<{ n: number }>();
  return r?.n ?? 0;
}

export async function markManual(id: number, by: string): Promise<boolean> {
  const r = await database()
    .prepare("UPDATE notifications SET status = 'manual', sent_at = ?, sent_by = ?, error = NULL WHERE id = ? AND status IN ('pending', 'failed', 'queued')")
    .bind(new Date().toISOString(), by, id)
    .run();
  return !!r.meta.changes;
}

export async function dismiss(id: number, by: string): Promise<boolean> {
  const r = await database()
    .prepare("UPDATE notifications SET status = 'skipped', error = ?, sent_by = ? WHERE id = ? AND status IN ('pending', 'failed', 'queued')")
    .bind('Dismissed by staff', by, id)
    .run();
  return !!r.meta.changes;
}

/** Retries one failed/pending message through the API. */
export async function retry(id: number): Promise<NotificationRow | null> {
  const db = database();
  const r = await db.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first<DbRow>();
  if (!r) return null;
  if (!apiEnabled()) return toRow(r);
  const short = r.summary || r.message.replace(/\s*\n+\s*/g, ' ').slice(0, 900);
  const res = await deliver(r.kind as NoticeKind, r.phone, r.name, r.order_id, { full: r.message, short });
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE notifications SET status = ?, error = ?, wa_message_id = ?, sent_at = ?, sent_by = ? WHERE id = ?')
    .bind(res.ok ? 'sent' : 'failed', res.ok ? null : res.error, res.ok ? res.id : null, res.ok ? now : null, res.ok ? 'system' : null, id)
    .run();
  const after = await db.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first<DbRow>();
  return after ? toRow(after) : null;
}

/** Creates one offer message per opted-in customer. API → queued (sent in batches), otherwise pending (send by hand). */
export async function createOfferBroadcast(text: string): Promise<{ recipients: number; mode: 'api' | 'manual' }> {
  const db = database();
  const res = await db.prepare('SELECT phone, name FROM customers WHERE offers_opt_in = 1 ORDER BY last_order_at DESC LIMIT 2000').all<{ phone: string; name: string }>();
  const status = apiEnabled() ? 'queued' : 'pending';
  const now = new Date().toISOString();
  const stmts = res.results.map((c) => {
    const msg = offerNotice(c.name, text);
    return db.prepare('INSERT INTO notifications (order_id, phone, name, kind, message, summary, status, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.phone, c.name, 'offer', msg.full, msg.short, status, now);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { recipients: stmts.length, mode: status === 'queued' ? 'api' : 'manual' };
}

/** Sends up to `limit` queued messages (keeps each request within platform limits). */
export async function processQueue(limit = 25): Promise<{ sent: number; failed: number; remaining: number }> {
  const db = database();
  const res = await db.prepare("SELECT * FROM notifications WHERE status = 'queued' ORDER BY id LIMIT ?").bind(limit).all<DbRow>();
  let sent = 0;
  let failed = 0;
  for (const r of res.results) {
    const out = await retry(r.id);
    if (out?.status === 'sent') sent++;
    else failed++;
  }
  const left = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status = 'queued'").first<{ n: number }>();
  return { sent, failed, remaining: left?.n ?? 0 };
}

/** Sends a test message to a number (API only). */
export async function sendTest(phone: string): Promise<SendResult> {
  const text = { full: 'Test message from Farm’s Touch ✅ WhatsApp messages are working.', short: 'this is a test message. WhatsApp messages are working.' };
  const r = await deliver('test', phone, 'there', 'TEST', text);
  await insertLog({ orderId: null, phone, name: '', kind: 'test', message: text.full, summary: text.short, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, waId: r.ok ? r.id : null });
  return r;
}
