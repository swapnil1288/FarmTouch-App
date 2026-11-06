'use client';
// /admin → Store: coupons, delivery-day capacity / closures and delivery pincodes (admins only).

import { useEffect, useState } from 'react';
import { BadgePercent, CalendarDays, Info, LoaderCircle, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { istDate } from '@/lib/catalog';
import { rupee } from '@/lib/orders';
import { api } from './api';

type CouponRow = {
  code: string; title: string; amount: number; min: number; active: boolean; expiresAt: string | null;
  firstOrderOnly: boolean; perCustomer: number; maxUses: number; uses: number;
};
type Day = { date: string; label: string; closed: boolean; note: string; capacity: number | null; effectiveCapacity: number; booked: number };
type Pincode = { pin: string; area: string; active: boolean };
type Snapshot = { coupons: CouponRow[]; settings: { slotCapacity: number; slotDays: number }; days: Day[]; pincodes: Pincode[] };

/** Coupon form: expiry is edited as an India date. */
type CouponForm = Omit<CouponRow, 'uses' | 'expiresAt'> & { expiresOn: string };

const EMPTY_COUPON: CouponForm = { code: '', title: '', amount: 50, min: 499, active: true, expiresOn: '', firstOrderOnly: false, perCustomer: 0, maxUses: 0 };
const num = (v: string) => Number(v.replace(/\D/g, '') || 0);

function couponRules(c: CouponRow): string {
  const r: string[] = [];
  if (c.firstOrderOnly) r.push('first order');
  if (c.perCustomer) r.push(`${c.perCustomer}× per customer`);
  if (c.maxUses) r.push(`max ${c.maxUses} uses`);
  return r.join(' · ') || 'No limits';
}

export function StoreSettingsView() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    api<Snapshot>('/api/admin/store')
      .then((d) => { if (alive) setData(d); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  /** Sends one change; the server answers with the full new state. */
  async function send(key: string, body: Record<string, unknown>, done?: string): Promise<boolean> {
    setBusy(key);
    try {
      setData(await api<Snapshot>('/api/admin/store', body));
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }

  if (error && !data) return <div className="stock-warning" role="alert"><Info size={18} /><strong>{error}</strong></div>;
  if (!data) return <div className="adm-loading"><LoaderCircle className="spin" /> Loading…</div>;

  return (
    <div className="adm-stack">
      <DeliveryDays data={data} busy={busy} send={send} />
      <Coupons coupons={data.coupons} busy={busy} send={send} />
      <Pincodes pincodes={data.pincodes} busy={busy} send={send} />
    </div>
  );
}

type Send = (key: string, body: Record<string, unknown>, done?: string) => Promise<boolean>;

// ---------------------------------------------------------------- delivery days

function DeliveryDays({ data, busy, send }: { data: Snapshot; busy: string; send: Send }) {
  const [cap, setCap] = useState(String(data.settings.slotCapacity));
  const [days, setDays] = useState(String(data.settings.slotDays));
  const [edits, setEdits] = useState<Record<string, { capacity: string; note: string }>>({});

  const editOf = (d: Day) => edits[d.date] ?? { capacity: d.capacity === null ? '' : String(d.capacity), note: d.note };
  const setEdit = (d: Day, patch: Partial<{ capacity: string; note: string }>) => setEdits((e) => ({ ...e, [d.date]: { ...editOf(d), ...patch } }));

  async function saveDay(d: Day, closed: boolean) {
    const e = editOf(d);
    const ok = await send('day:' + d.date, { op: 'day', date: d.date, closed, capacity: e.capacity === '' ? null : num(e.capacity), note: e.note },
      closed ? `${d.label} closed` : `${d.label} saved`);
    if (ok) setEdits((x) => { const n = { ...x }; delete n[d.date]; return n; });
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head"><h2><CalendarDays size={18} /> Delivery days</h2></div>
      <form className="store-inline" onSubmit={(e) => { e.preventDefault(); void send('settings', { op: 'settings', slotCapacity: num(cap), slotDays: num(days) }, 'Delivery settings saved'); }}>
        <label>Orders per day (0 = no limit)<input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
        <label>Days offered to customers (1–7)<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 1))} /></label>
        <button className="btn btn-primary sm" disabled={busy === 'settings'} type="submit">Save</button>
      </form>
      <p className="small muted">Customers see the next open days. When a day reaches its limit it shows as “Fully booked”. Closed days are skipped. Online checkouts in progress also take a place.</p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Day</th><th>Booked</th><th>Limit for this day</th><th>Note (staff only)</th><th /></tr></thead>
          <tbody>
            {data.days.map((d) => {
              const e = editOf(d);
              const dirty = !!edits[d.date];
              const full = d.effectiveCapacity > 0 && d.booked >= d.effectiveCapacity;
              return (
                <tr key={d.date} className={d.closed ? 'inactive' : ''}>
                  <td><strong>{d.label}</strong>{d.closed && <small className="bad-text"> Closed</small>}{!d.closed && full && <small className="bad-text"> Full</small>}</td>
                  <td>{d.booked}{d.effectiveCapacity > 0 ? ` / ${d.effectiveCapacity}` : ''}</td>
                  <td><input className="store-num" inputMode="numeric" placeholder={data.settings.slotCapacity ? `default ${data.settings.slotCapacity}` : 'no limit'} aria-label={`Limit for ${d.label}`}
                    value={e.capacity} onChange={(ev) => setEdit(d, { capacity: ev.target.value.replace(/\D/g, '').slice(0, 5) })} /></td>
                  <td><input value={e.note} maxLength={80} placeholder="e.g. Diwali" aria-label={`Note for ${d.label}`} onChange={(ev) => setEdit(d, { note: ev.target.value })} /></td>
                  <td className="store-actions">
                    {dirty && <button className="btn btn-primary sm" disabled={busy === 'day:' + d.date} onClick={() => void saveDay(d, d.closed)}>Save</button>}
                    <button className="btn btn-outline sm" disabled={busy === 'day:' + d.date} onClick={() => void saveDay(d, !d.closed)}>{d.closed ? 'Open' : 'Close day'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- coupons

function Coupons({ coupons, busy, send }: { coupons: CouponRow[]; busy: string; send: Send }) {
  const [editing, setEditing] = useState<CouponForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const now = new Date().toISOString();

  function open(c?: CouponRow) {
    setIsNew(!c);
    setEditing(c ? { ...c, expiresOn: c.expiresAt ? istDate(new Date(c.expiresAt)) : '' } : { ...EMPTY_COUPON });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (isNew && coupons.some((c) => c.code === editing.code.trim().toUpperCase()) && !confirm(`${editing.code} already exists. Replace it?`)) return;
    const { expiresOn, ...rest } = editing;
    if (await send('coupon', { op: 'coupon', ...rest, expiresOn: expiresOn || null }, 'Coupon saved')) setEditing(null);
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <h2><BadgePercent size={18} /> Coupons</h2>
        <button className="btn btn-primary sm" onClick={() => open()}><Plus size={15} /> Add coupon</button>
      </div>
      <p className="small muted">A flat ₹ amount off the item total. Uses count only orders that were not cancelled. Turn a coupon off instead of deleting it so past orders keep their history.</p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th>Used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {coupons.map((c) => {
              const expired = !!c.expiresAt && c.expiresAt <= now;
              return (
                <tr key={c.code} className={c.active && !expired ? '' : 'inactive'}>
                  <td><strong>{c.code}</strong><small className="muted"> {c.title}</small></td>
                  <td>{rupee(c.amount)} off{c.min ? ` over ${rupee(c.min)}` : ''}</td>
                  <td className="small">{couponRules(c)}{c.expiresAt && <><br />till {istDate(new Date(c.expiresAt))}</>}</td>
                  <td>{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ''}</td>
                  <td>{!c.active ? 'Off' : expired ? <span className="bad-text">Expired</span> : 'Live'}</td>
                  <td><button className="icon-btn" aria-label={'Edit ' + c.code} onClick={() => open(c)}><Pencil size={15} /></button></td>
                </tr>
              );
            })}
            {coupons.length === 0 && <tr><td colSpan={6} className="muted">No coupons yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>{isNew ? 'Add coupon' : `Edit ${editing?.code}`}</DialogTitle>
          <DialogDescription>Customers type the code at checkout, or tap it on the Offers page.</DialogDescription>
          {editing && (
            <form className="address-form" onSubmit={save}>
              <label>Code<input required disabled={!isNew} value={editing.code} placeholder="e.g. WELCOME30" autoCapitalize="characters"
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) })} /></label>
              <label>Title (shown to customers)<input required maxLength={40} value={editing.title} placeholder="A fresh start" onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
              <label>Discount ₹<input required inputMode="numeric" value={editing.amount || ''} onChange={(e) => setEditing({ ...editing, amount: num(e.target.value) })} /></label>
              <label>Minimum item total ₹ (0 = any)<input inputMode="numeric" value={String(editing.min)} onChange={(e) => setEditing({ ...editing, min: num(e.target.value) })} /></label>
              <label>Last day valid (empty = no expiry)<input type="date" value={editing.expiresOn} min={istDate()} onChange={(e) => setEditing({ ...editing, expiresOn: e.target.value })} /></label>
              <label>Uses per customer (0 = unlimited)<input inputMode="numeric" value={String(editing.perCustomer)} onChange={(e) => setEditing({ ...editing, perCustomer: Math.min(100, num(e.target.value)) })} /></label>
              <label>Total uses, all customers (0 = unlimited)<input inputMode="numeric" value={String(editing.maxUses)} onChange={(e) => setEditing({ ...editing, maxUses: num(e.target.value) })} /></label>
              <label className="check"><input type="checkbox" checked={editing.firstOrderOnly} onChange={(e) => setEditing({ ...editing, firstOrderOnly: e.target.checked })} /> Only for a customer’s first order (by mobile number)</label>
              <label className="check"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Live (customers can use it)</label>
              <button className="btn btn-primary block lg" disabled={busy === 'coupon'} type="submit">{busy === 'coupon' ? <LoaderCircle className="spin" size={16} /> : null} Save</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- pincodes

function Pincodes({ pincodes, busy, send }: { pincodes: Pincode[]; busy: string; send: Send }) {
  const [pin, setPin] = useState('');
  const [area, setArea] = useState('');
  const anyActive = pincodes.some((p) => p.active);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await send('pin', { op: 'pincode', pin, area, active: true }, `${pin} added`)) { setPin(''); setArea(''); }
  }

  return (
    <section className="adm-card">
      <div className="adm-card-head"><h2><MapPin size={18} /> Delivery pincodes</h2></div>
      <p className={'small ' + (anyActive ? 'muted' : 'bad-text')}>
        {anyActive
          ? 'Customers can only order to the active pincodes below.'
          : 'No active pincodes yet, so any Pune pincode (411xxx) is accepted. Add the areas you deliver to.'}
      </p>
      <form className="store-inline" onSubmit={add}>
        <label>Pincode<input required inputMode="numeric" value={pin} placeholder="411045" onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label>Area (optional)<input maxLength={40} value={area} placeholder="Baner" onChange={(e) => setArea(e.target.value)} /></label>
        <button className="btn btn-primary sm" disabled={pin.length !== 6 || busy === 'pin'} type="submit"><Plus size={15} /> Add</button>
      </form>
      {pincodes.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Pincode</th><th>Area</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pincodes.map((p) => (
                <tr key={p.pin} className={p.active ? '' : 'inactive'}>
                  <td><strong>{p.pin}</strong></td>
                  <td>{p.area || '—'}</td>
                  <td>{p.active ? 'Delivering' : 'Paused'}</td>
                  <td className="store-actions">
                    <button className="btn btn-outline sm" disabled={busy === 'pin:' + p.pin} onClick={() => void send('pin:' + p.pin, { op: 'pincode', ...p, active: !p.active }, `${p.pin} ${p.active ? 'paused' : 'delivering'}`)}>
                      {p.active ? 'Pause' : 'Resume'}
                    </button>
                    <button className="icon-btn" aria-label={'Remove ' + p.pin} disabled={busy === 'pin:' + p.pin}
                      onClick={() => { if (confirm(`Remove ${p.pin}?`)) void send('pin:' + p.pin, { op: 'pincode_delete', pin: p.pin }, `${p.pin} removed`); }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
