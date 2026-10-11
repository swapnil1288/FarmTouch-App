'use client';

import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, CircleAlert, LoaderCircle, Megaphone, RefreshCw, Search, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { WhatsAppIcon } from '@/components/store/whatsapp-icon';
import { NOTICE_LABEL, type NoticeKind } from '@/lib/notify-text';
import { whatsappLink } from '@/lib/whatsapp';
import { api } from './api';

export type Notice = {
  id: number; orderId: string | null; phone: string; name: string; kind: string; message: string;
  status: 'queued' | 'sent' | 'failed' | 'pending' | 'manual' | 'skipped' | string;
  error: string | null; createdAt: string; sentAt: string | null; sentBy: string | null;
};

type Config = { storeNumber: string; api: boolean; updateTemplate: string; offerTemplate: string; storeAlertTemplate: string; language: string };

const STATUS_TEXT: Record<string, string> = {
  queued: 'Sending…',
  sent: 'Sent automatically',
  manual: 'Sent by staff',
  pending: 'To send',
  failed: 'Failed',
  skipped: 'Not sent',
};

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const kindLabel = (k: string) => NOTICE_LABEL[k as NoticeKind] ?? k;

function StatusChip({ status }: { status: string }) {
  return <span className={'msg-status m-' + status}>{STATUS_TEXT[status] ?? status}</span>;
}

/** Records a message as sent by hand. */
async function markSent(n: Notice): Promise<boolean> {
  try {
    await api('/api/admin/messages', { op: 'mark_sent', id: n.id });
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

/** Opens WhatsApp with the message ready for the customer (must run inside the click), then records it as sent. */
export async function sendByHand(n: Notice): Promise<boolean> {
  window.open(whatsappLink(n.phone, n.message), '_blank', 'noopener,noreferrer');
  return markSent(n);
}

// ---------------------------------------------------------------- prompt after an action

/** Shown right after an action when the customer still has to be told (no automatic WhatsApp). */
export function SendPrompt({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!notice} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="dialog">
        <DialogTitle><WhatsAppIcon size={20} className="wa-color" /> Tell the customer</DialogTitle>
        <DialogDescription>
          {notice?.status === 'failed' ? 'Automatic WhatsApp failed, so send it from your phone.' : 'Send this update from your WhatsApp. It opens with the message ready, so you just press send.'}
        </DialogDescription>
        {notice && (
          <>
            <p className="small"><b>{notice.name}</b> · {notice.phone} · {kindLabel(notice.kind)}</p>
            <pre className="msg-preview">{notice.message}</pre>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={onClose}>Later</button>
              <button
                className="btn btn-wa"
                disabled={busy}
                onClick={() => {
                  const n = notice;
                  setBusy(true);
                  // Close the dialog before WhatsApp takes focus, so the page underneath stays fully usable.
                  flushSync(() => onClose());
                  window.open(whatsappLink(n.phone, n.message), '_blank', 'noopener,noreferrer');
                  void markSent(n).finally(() => setBusy(false));
                }}
              >
                <WhatsAppIcon size={18} /> Send on WhatsApp
              </button>
            </div>
            <p className="small muted">“Later” keeps it in <b>WhatsApp → To send</b>.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- messages for one order (drawer)

export function OrderMessages({ orderId, version }: { orderId: string; version: number }) {
  const [list, setList] = useState<Notice[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ messages: Notice[] }>('/api/admin/messages?orderId=' + encodeURIComponent(orderId))
      .then((d) => { if (alive) setList(d.messages); })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [orderId, version, tick]);
  if (!list) return null;
  return (
    <section className="adm-card tight">
      <h3><WhatsAppIcon size={16} className="wa-color" /> Customer messages</h3>
      {list.length === 0 ? <p className="small muted">No messages yet.</p> : (
        <ul className="msg-list compact">
          {list.map((n) => (
            <li key={n.id}>
              <div className="msg-head"><b>{kindLabel(n.kind)}</b><StatusChip status={n.status} /><small>{time(n.createdAt)}</small></div>
              {n.error && n.status !== 'skipped' && <small className="bad-text">{n.error}</small>}
              {n.status === 'skipped' && <small className="muted">{n.error}</small>}
              {(n.status === 'pending' || n.status === 'failed') && (
                <button className="btn btn-wa sm" onClick={async () => { if (await sendByHand(n)) setTick((t) => t + 1); }}><WhatsAppIcon size={14} /> Send on WhatsApp</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- WhatsApp tab (admin)

type Customer = { phone: string; name: string; accountType: 'retail' | 'b2b'; businessName: string; updatesOptIn: boolean; offersOptIn: boolean; orders: number; lastOrderAt: string };

export function WhatsAppView({ onTodoChange }: { onTodoChange: (n: number) => void }) {
  const [filter, setFilter] = useState<'todo' | 'all' | 'failed'>('todo');
  const [data, setData] = useState<{ config: Config; todo: number; messages: Notice[] } | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(20);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api<{ config: Config; todo: number; messages: Notice[] }>('/api/admin/messages?status=' + filter)
      .then((d) => { if (alive) { setData(d); setError(''); onTodoChange(d.todo); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [filter, tick, onTodoChange]);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  if (error && !data) return <div className="stock-warning"><CircleAlert size={18} /><div><strong>{error}</strong><button className="link" onClick={reload}>Try again</button></div></div>;
  if (!data) return <div className="adm-loading"><LoaderCircle className="spin" /> Loading…</div>;
  const c = data.config;

  return (
    <div className="adm-stack">
      <SetupCard config={c} />

      <section className="adm-card">
        <div className="adm-card-head">
          <h2>Customer messages</h2>
          <div className="chips">
            <button className={filter === 'todo' ? 'on' : ''} onClick={() => { setFilter('todo'); setShown(20); }}>To send {data.todo ? <b>{data.todo}</b> : null}</button>
            <button className={filter === 'failed' ? 'on' : ''} onClick={() => { setFilter('failed'); setShown(20); }}>Failed</button>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => { setFilter('all'); setShown(20); }}>All</button>
          </div>
        </div>
        {filter === 'todo' && data.messages.length > 0 && !c.api && (
          <p className="small muted">Automatic sending is off, so tap <b>Send on WhatsApp</b> on each message. WhatsApp opens with the text ready.</p>
        )}
        {data.messages.length === 0 ? (
          <p className="small muted"><Check size={14} /> {filter === 'todo' ? 'All customers are up to date.' : 'No messages.'}</p>
        ) : (
          <ul className="msg-list">
            {data.messages.slice(0, shown).map((n) => (
              <li key={n.id}>
                <div className="msg-head">
                  <b>{n.name || n.phone}</b><small>{n.phone}</small>
                  {n.orderId && <small>· {n.orderId}</small>}
                  <span className="msg-kind">{kindLabel(n.kind)}</span>
                  <StatusChip status={n.status} />
                  <small className="msg-time">{time(n.createdAt)}</small>
                </div>
                <details><summary className="small">Message</summary><pre className="msg-preview">{n.message}</pre></details>
                {n.error && n.status === 'failed' && <small className="bad-text">{n.error}</small>}
                {(n.status === 'pending' || n.status === 'failed' || n.status === 'queued') && (
                  <div className="msg-actions">
                    <button className="btn btn-wa sm" onClick={async () => { if (await sendByHand(n)) reload(); }}><WhatsAppIcon size={14} /> Send on WhatsApp</button>
                    {c.api && n.status === 'failed' && (
                      <button className="btn btn-outline sm" onClick={async () => {
                        try { const r = await api<{ message: Notice }>('/api/admin/messages', { op: 'retry', id: n.id }); toast[r.message.status === 'sent' ? 'success' : 'error'](r.message.status === 'sent' ? 'Sent' : r.message.error ?? 'Failed again'); reload(); }
                        catch (e) { toast.error((e as Error).message); }
                      }}><RefreshCw size={14} /> Retry automatically</button>
                    )}
                    <button className="btn btn-outline sm" onClick={async () => {
                      try { await api('/api/admin/messages', { op: 'dismiss', id: n.id }); reload(); } catch (e) { toast.error((e as Error).message); }
                    }}><X size={14} /> Don’t send</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.messages.length > shown && (
          <button className="btn btn-outline sm" style={{ marginTop: 10 }} onClick={() => setShown((v) => v + 30)}>Show more ({data.messages.length - shown} more)</button>
        )}
      </section>

      <OfferComposer apiOn={c.api} onDone={() => { setFilter(c.api ? 'all' : 'todo'); reload(); }} />
      <CustomersCard />
    </div>
  );
}

function SetupCard({ config: c }: { config: Config }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const row = (ok: boolean, label: string, detail: string) => (
    <li className={ok ? 'ok' : 'off'}>{ok ? <Check size={15} /> : <X size={15} />}<span><b>{label}</b><small>{detail}</small></span></li>
  );
  return (
    <section className="adm-card">
      <div className="adm-card-head"><h2>WhatsApp setup</h2><span className={'msg-status ' + (c.api ? 'm-sent' : 'm-pending')}>{c.api ? 'Automatic sending ON' : 'One-tap sending (manual)'}</span></div>
      <ul className="setup-list">
        {row(!!c.storeNumber, 'Store WhatsApp number', c.storeNumber ? '+' + c.storeNumber : 'Set WHATSAPP_STORE_NUMBER (used for “Chat with us” and order buttons)')}
        {row(c.api, 'WhatsApp Business API', c.api ? 'Connected. Messages go out automatically.' : 'Not connected. Every message waits in “To send” for one tap.')}
        {row(!!c.updateTemplate, 'Order update template', c.updateTemplate ? `“${c.updateTemplate}” (${c.language})` : 'Without it, automatic messages only reach customers who messaged you in the last 24 hours')}
        {row(!!c.offerTemplate, 'Offer template', c.offerTemplate ? `“${c.offerTemplate}”` : 'Needed to send offers automatically')}
      </ul>
      {c.api && (
        <form className="inline-form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await api('/api/admin/messages', { op: 'test', phone }); toast.success('Test message sent. Check that phone.'); }
          catch (err) { toast.error((err as Error).message); }
          finally { setBusy(false); }
        }}>
          <label>Send a test to<input inputMode="numeric" maxLength={10} placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
          <button className="btn btn-outline" disabled={busy || phone.length !== 10} type="submit"><Send size={15} /> Send test</button>
        </form>
      )}
      {!c.api && <p className="small muted">To send messages automatically, follow <b>WHATSAPP_SETUP.md</b> (Meta WhatsApp Business API, about 1–3 days for approval).</p>}
    </section>
  );
}

function OfferComposer({ apiOn, onDone }: { apiOn: boolean; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm('Send this offer to every customer who opted in to offers?')) return;
    setBusy(true);
    try {
      const r = await api<{ recipients: number; mode: 'api' | 'manual' }>('/api/admin/messages', { op: 'offer', text });
      if (!r.recipients) { toast.info('No customers have opted in to offers yet.'); return; }
      if (r.mode === 'api') {
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < 200; i++) {
          const p = await api<{ sent: number; failed: number; remaining: number }>('/api/admin/messages', { op: 'process' });
          sent += p.sent; failed += p.failed;
          setProgress(`Sent ${sent} · failed ${failed} · left ${p.remaining}`);
          if (!p.remaining) break;
        }
        toast.success(`Offer sent to ${sent} customer(s)${failed ? `, ${failed} failed` : ''}.`);
      } else {
        toast.success(`${r.recipients} offer message(s) added to “To send”.`);
      }
      setText('');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head"><h2><Megaphone size={18} /> Send an offer</h2></div>
      <p className="small muted">Goes only to customers who ticked “Send me offers on WhatsApp”. {apiOn ? 'Sent automatically in batches.' : 'Added to “To send” for one-tap sending.'}</p>
      <form className="address-form" onSubmit={send}>
        <label>Offer text<textarea required minLength={5} maxLength={600} value={text} placeholder="e.g. This weekend only: 20% off all fruits! Use code FRESH50 on orders above ₹499." onChange={(e) => setText(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy || text.trim().length < 5} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Megaphone size={16} />} Send offer</button>
        {progress && <p className="small">{progress}</p>}
      </form>
    </section>
  );
}

function CustomersCard() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ customers: Customer[]; totals: { total: number; updates: number; offers: number } } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api<{ customers: Customer[]; totals: { total: number; updates: number; offers: number } }>('/api/admin/customers?q=' + encodeURIComponent(q.trim()))
        .then((d) => { if (alive) setData(d); })
        .catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, tick]);

  async function toggle(c: Customer, field: 'updatesOptIn' | 'offersOptIn') {
    try {
      await api('/api/admin/customers', { phone: c.phone, updatesOptIn: field === 'updatesOptIn' ? !c.updatesOptIn : c.updatesOptIn, offersOptIn: field === 'offersOptIn' ? !c.offersOptIn : c.offersOptIn });
      setTick((t) => t + 1);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function saveAccount(c: Customer, accountType: Customer['accountType'], businessName: string) {
    try {
      await api('/api/admin/customers', { phone: c.phone, accountType, businessName });
      setTick((t) => t + 1);
    } catch (e) { toast.error((e as Error).message); }
  }

  function editBusinessName(phone: string, businessName: string) {
    setData((current) => current ? {
      ...current,
      customers: current.customers.map((customer) => customer.phone === phone ? { ...customer, businessName } : customer),
    } : current);
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <h2>Customers</h2>
        {data && <span className="small muted">{data.totals.total} customers · {data.totals.updates} get order updates · {data.totals.offers} get offers</span>}
      </div>
      <p className="small muted">Set customer accounts to B2B to include their orders in B2B settlement totals. If a customer replies STOP, switch off their messages here.</p>
      <label className="adm-search"><Search size={16} /><input type="search" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /></label>
      {!data ? null : data.customers.length === 0 ? <p className="small muted">No customers yet.</p> : (
        <div className="adm-table-wrap" style={{ marginTop: 10 }}>
          <table className="adm-table compact">
            <thead><tr><th>Customer</th><th>Account</th><th>Business name</th><th>Orders</th><th>Order updates</th><th>Offers</th></tr></thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.phone}>
                  <td><strong>{c.name}</strong><br /><small className="muted">{c.phone}</small></td>
                  <td><select aria-label={'Account type for ' + c.name} value={c.accountType} onChange={(e) => {
                    const accountType = e.target.value as Customer['accountType'];
                    void saveAccount(c, accountType, accountType === 'b2b' ? c.businessName || c.name : '');
                  }}><option value="retail">Retail</option><option value="b2b">B2B</option></select></td>
                  <td>{c.accountType === 'b2b' ? <input aria-label={'Business name for ' + c.name} value={c.businessName} placeholder="Business name" onChange={(e) => editBusinessName(c.phone, e.target.value)} onBlur={(e) => void saveAccount(c, 'b2b', e.target.value)} /> : <span className="muted">Retail customer</span>}</td>
                  <td>{c.orders}</td>
                  <td><button className={'toggle' + (c.updatesOptIn ? ' on' : '')} role="switch" aria-checked={c.updatesOptIn} aria-label={'Order updates for ' + c.name} onClick={() => void toggle(c, 'updatesOptIn')}><i /></button></td>
                  <td><button className={'toggle' + (c.offersOptIn ? ' on' : '')} role="switch" aria-checked={c.offersOptIn} aria-label={'Offers for ' + c.name} onClick={() => void toggle(c, 'offersOptIn')}><i /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
