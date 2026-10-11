'use client';
/* eslint-disable @next/next/no-img-element -- small static product photos served directly by the Worker */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Banknote, Bike, Box, CalendarDays, Check, ClipboardList, Download, ExternalLink, Info, LoaderCircle,
  KeyRound, LogOut, MapPin, MessageCircle, Navigation, Package, PackageCheck, Pencil, Phone, Plus, Printer, RefreshCw, Search, ShoppingBasket,
  Store, Truck, UserPlus, Users, X,
} from 'lucide-react';
import Link from 'next/link';
import { Toaster, toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { WhatsAppIcon } from '@/components/store/whatsapp-icon';
import { categories, discountPercent, istDate, labelForSlotId, productImagePath, type Product } from '@/lib/catalog';
import { packingRows, rupee, type OrderRecord, type StaffMember } from '@/lib/orders';
import {
  ACTION_LABEL, ROLE_LABEL, STATUS_LABEL, STAFF_ROLES, canDo, type OrderAction, type OrderStatus, type StaffRole,
} from '@/lib/workflow';
import { mapsLink, statusMessage, whatsappLink } from '@/lib/whatsapp';
import { api } from './api';
import { EditItemsDialog } from './edit-items';
import { OrderMessages, SendPrompt, WhatsAppView, type Notice } from './messages';

// ---------------------------------------------------------------- helpers

type Me = { email: string; name: string; role: StaffRole; phone: string; via?: 'password' | 'platform' };
type Tab = 'dashboard' | 'settlement' | 'orders' | 'packing' | 'dispatch' | 'deliveries' | 'whatsapp' | 'products' | 'staff';

const TABS: { id: Tab; label: string; Icon: typeof Box; roles: StaffRole[] }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: BarChart3, roles: ['admin'] },
  { id: 'settlement', label: 'Settlement', Icon: Banknote, roles: ['admin'] },
  { id: 'orders', label: 'Orders', Icon: ClipboardList, roles: ['admin'] },
  { id: 'packing', label: 'Packing', Icon: PackageCheck, roles: ['admin', 'packer'] },
  { id: 'dispatch', label: 'Dispatch', Icon: Truck, roles: ['admin'] },
  { id: 'deliveries', label: 'My deliveries', Icon: Bike, roles: ['delivery'] },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, roles: ['admin'] },
  { id: 'products', label: 'Products', Icon: ShoppingBasket, roles: ['admin', 'packer'] },
  { id: 'staff', label: 'Staff', Icon: Users, roles: ['admin'] },
];


const timeFmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayShort = (date: string) => labelForSlotId(date).split(' · ')[0];
const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** Today and the next three India dates (delivery days). */
function deliveryDates(): string[] {
  return [0, 1, 2, 3].map((d) => istDate(new Date(), d));
}

function usePolling(fn: () => void, ms = 20_000) {
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={'status s-' + status}>{STATUS_LABEL[status]}</span>;
}

function Empty({ icon: Icon = Info, title, text }: { icon?: typeof Info; title: string; text?: string }) {
  return (
    <div className="empty">
      <Icon size={34} />
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function Loading() {
  return <div className="adm-loading"><LoaderCircle className="spin" /> Loading…</div>;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stock-warning" role="alert">
      <Info size={18} />
      <div><strong>{message}</strong><button className="link" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- main shell

export default function AdminApp({ me, whatsappNumber }: { me: Me; whatsappNumber: string }) {
  const tabs = TABS.filter((t) => t.roles.includes(me.role));
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [partners, setPartners] = useState<StaffMember[]>([]);
  const [version, setVersion] = useState(0); // bump to make lists reload after a change

  const [todo, setTodo] = useState(0);
  const [prompt, setPrompt] = useState<Notice[]>([]);

  const loadPartners = useCallback(() => {
    if (me.role !== 'admin') return Promise.resolve();
    return api<{ partners: StaffMember[]; messagesTodo: number }>('/api/admin/me').then((d) => { setPartners(d.partners); setTodo(d.messagesTodo); }).catch(() => {});
  }, [me.role]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (me.role === 'admin') api<{ partners: StaffMember[]; messagesTodo: number }>('/api/admin/me').then((d) => { if (alive) { setPartners(d.partners); setTodo(d.messagesTodo); } }).catch(() => {});
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [me.role]);

  /** After an action: ask staff to send any customer message that could not go out automatically. */
  const isAdmin = me.role === 'admin';
  const onPending = useCallback((list: Notice[] | undefined) => {
    if (list?.length) setPrompt(list);
    if (isAdmin) void api<{ messagesTodo: number }>('/api/admin/me').then((d) => setTodo(d.messagesTodo)).catch(() => {});
  }, [isAdmin, setPrompt, setTodo]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const [pwOpen, setPwOpen] = useState(false);

  async function logout() {
    try { await api('/api/admin/logout', {}); } catch { /* ignore */ }
    window.location.reload();
  }
  const shared = { me, openOrder: setOpenId, version, partners, whatsappNumber, onPending };

  return (
    <>
    <Toaster position="top-center" richColors closeButton />
    <div className="adm">
      <aside className="adm-side">
        <a className="adm-brand" href="/admin">
          <img src="/logo.jpg" alt="" width={40} height={40} />
          <span><strong>Farm’s Touch</strong><small>STAFF PANEL</small></span>
        </a>
        <nav aria-label="Staff sections">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <Icon size={19} /> <span>{label}</span>{id === 'whatsapp' && todo > 0 && <b className="nav-badge" aria-label={`${todo} to send`}>{todo}</b>}
            </button>
          ))}
        </nav>
        <div className="adm-me">
          <span className={'role r-' + me.role}>{ROLE_LABEL[me.role]}</span>
          <strong>{me.name}</strong>
          <small>{me.email}</small>
          {me.role === 'admin' && <Link href="/rider" target="_blank" rel="noreferrer" className="link"><Bike size={14} /> Open rider portal</Link>}
          <Link href="/" className="link"><Store size={14} /> Open shop</Link>
          <button className="link" onClick={() => setPwOpen(true)}><KeyRound size={14} /> Change password</button>
          {me.via !== 'platform' && <button className="link" onClick={() => void logout()}><LogOut size={14} /> Log out</button>}
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-top">
          <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
          <div className="adm-top-actions">
            <span className={'role r-' + me.role}>{ROLE_LABEL[me.role]}</span>
            <button className="btn btn-outline sm" onClick={() => { changed(); void loadPartners(); }}><RefreshCw size={14} /> Refresh</button>
            {me.via !== 'platform' && <button className="btn btn-outline sm adm-logout" onClick={() => void logout()} aria-label="Log out"><LogOut size={14} /></button>}
          </div>
        </header>
        {tab === 'dashboard' && <Dashboard {...shared} goto={setTab} />}
        {tab === 'settlement' && <SettlementReport {...shared} />}
        {tab === 'orders' && <OrdersView {...shared} />}
        {tab === 'packing' && <PackingView {...shared} />}
        {tab === 'dispatch' && <DispatchView {...shared} onChanged={changed} />}
        {tab === 'deliveries' && <MyDeliveries {...shared} />}
        {tab === 'whatsapp' && <WhatsAppView onTodoChange={setTodo} />}
        {tab === 'products' && <ProductsView me={me} />}
        {tab === 'staff' && <StaffView me={me} onChanged={() => void loadPartners()} />}
      </main>

      {tabs.length > 1 && <nav className="adm-bottom" aria-label="Staff sections">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={20} /><span>{label.replace('My d', 'D')}</span>{id === 'whatsapp' && todo > 0 && <b className="nav-badge">{todo}</b>}
          </button>
        ))}
      </nav>}

    </div>
    <OrderDrawer id={openId} onClose={() => setOpenId(null)} me={me} partners={partners} whatsappNumber={whatsappNumber} onChanged={changed} onPending={onPending} />
    <SendPrompt notice={prompt[0] ?? null} onClose={() => { setPrompt((p) => p.slice(1)); onPending(undefined); }} />
    <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

type Shared = { me: Me; openOrder: (id: string) => void; version: number; partners: StaffMember[]; whatsappNumber: string; onPending: (list: Notice[] | undefined) => void };

// ---------------------------------------------------------------- order list hook

function useOrders(query: string, version: number) {
  const [orders, setOrders] = useState<OrderRecord[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    api<{ orders: OrderRecord[] }>('/api/admin/orders?' + query)
      .then((d) => { if (alive) { setOrders(d.orders); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [query, version, tick]);
  usePolling(reload);
  return { orders, error, reload };
}

function OrderRow({ o, onOpen, selectable, selected, onSelect }: {
  o: OrderRecord;
  onOpen: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
}) {
  const rows = packingRows(o.items);
  return (
    <div className={'adm-order' + (selected ? ' selected' : '')}>
      {selectable && <input type="checkbox" aria-label={'Select ' + o.id} checked={!!selected} onChange={(e) => onSelect?.(e.target.checked)} />}
      <button className="adm-order-main" onClick={onOpen}>
        <span className="adm-order-id"><strong>{o.id}</strong><small>{timeFmt(o.createdAt)}</small></span>
        <span className="adm-order-cust"><strong>{o.address.name}</strong><small>{o.address.pin} · {o.address.phone}</small></span>
        <span className="adm-order-slot"><CalendarDays size={13} /> {dayShort(o.slot)}</span>
        <span className="adm-order-items">{items(rows.length)}{o.status === 'packing' ? ` · ${o.packed.length}/${rows.length} packed` : ''}</span>
        <span className="adm-order-total">{rupee(o.totals.total)}</span>
        <span className="adm-order-status"><StatusBadge status={o.status} />{o.assignee && <small><Bike size={12} /> {o.assignee.name}</small>}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

type SettlementSummary = {
  days: number;
  from: string;
  to: string;
  grossSales: number;
  discounts: number;
  deliveryRevenue: number;
  cashCollected: number;
  onlinePaid: number;
  pendingCollection: number;
  cancelledValue: number;
  netSettlement: number;
  byType: Record<'b2b' | 'retail', { orders: number; grossSales: number; discounts: number; deliveryRevenue: number; cashCollected: number; onlinePaid: number; pendingCollection: number; cancelledValue: number; netSettlement: number }>;
  orders: { id: string; date: string; status: string; total: number; discount: number; cashCollected: number; onlinePaid: number; pendingCollection: number; payment: 'cod' | 'online'; paymentStatus?: string; customerName: string; customerPhone: string; accountType: 'b2b' | 'retail'; businessName: string }[];
  byDay: { date: string; grossSales: number; discounts: number; deliveryRevenue: number; cashCollected: number; onlinePaid: number; pendingCollection: number; cancelledValue: number }[];
};

type DashboardData = {
  today: { orders: number; sales: number; cancelled: number };
  range: { days: number; orders: number; sales: number; delivered: number; collected: number };
  byStatus: Record<OrderStatus, number>;
  perDay: { date: string; orders: number; sales: number }[];
  topProducts: { id: string; name: string; packs: number }[];
  cash: { key: string; name: string; delivered: number; collected: number; pending: number }[];
  lowStock: { id: string; name: string; stock: number }[];
  upcoming: { date: string; label: string; count: number }[];
  settlement: SettlementSummary;
};

function Dashboard({ version, goto }: Shared & { goto: (t: Tab) => void }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [from, setFrom] = useState(() => istDate(new Date(), -6));
  const [to, setTo] = useState(() => istDate());
  useEffect(() => {
    let alive = true;
    api<DashboardData>('/api/admin/reports?days=' + days)
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [days, version, tick]);
  usePolling(useCallback(() => setTick((t) => t + 1), []), 60_000);

  if (error && !data) return <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <Loading />;
  const maxSales = Math.max(1, ...data.perDay.map((d) => d.sales));
  const maxPacks = Math.max(1, ...data.topProducts.map((p) => p.packs));
  const onRoad = data.cash.reduce((n, c) => n + c.pending, 0);
  const toPack = data.byStatus.placed + data.byStatus.confirmed + data.byStatus.packing;

  return (
    <div className="adm-stack">
      <section className="kpis">
        <div className="kpi"><small>Today’s orders</small><strong>{data.today.orders}</strong><span>{data.today.cancelled ? `${data.today.cancelled} cancelled` : 'No cancellations'}</span></div>
        <div className="kpi"><small>Today’s sales</small><strong>{rupee(data.today.sales)}</strong><span>Order value, before delivery</span></div>
        <button className="kpi click" onClick={() => goto('packing')}><small>Waiting to pack</small><strong>{toPack}</strong><span>{data.byStatus.placed} new · {data.byStatus.packing} packing</span></button>
        <button className="kpi click" onClick={() => goto('dispatch')}><small>Ready / on the road</small><strong>{data.byStatus.packed + data.byStatus.out_for_delivery}</strong><span>{rupee(onRoad)} cash to collect</span></button>
      </section>

      <section className="adm-card">
        <div className="adm-card-head">
          <h2>Pipeline</h2>
          <button className="link" onClick={() => goto('orders')}>Open orders →</button>
        </div>
        <div className="pipeline">
          {(['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery'] as OrderStatus[]).map((s) => (
            <div key={s} className={'pipe s-' + s}><strong>{data.byStatus[s]}</strong><small>{STATUS_LABEL[s]}</small></div>
          ))}
        </div>
      </section>

      <div className="adm-grid-2">
        <section className="adm-card">
          <div className="adm-card-head">
            <h2>Sales, last {days} days</h2>
            <div className="seg-mini">{[7, 14, 30].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>)}</div>
          </div>
          <p className="muted small">{data.range.orders} orders · {rupee(data.range.sales)} · {data.range.delivered} delivered · {rupee(data.range.collected)} collected</p>
          <div className="bars" role="img" aria-label={`Daily sales for the last ${days} days`}>
            {data.perDay.map((d) => (
              <div key={d.date} className="bar-col" title={`${dayShort(d.date)}: ${d.orders} orders, ${rupee(d.sales)}`}>
                <span className="bar-val">{d.sales ? rupee(d.sales) : ''}</span>
                <span className="bar" style={{ height: `${Math.max(d.sales ? 4 : 0, (d.sales / maxSales) * 100)}%` }} />
                <small>{days > 14 ? d.date.slice(8) : dayShort(d.date).split(',')[0]}</small>
              </div>
            ))}
          </div>
          <details className="table-view"><summary>Show as table</summary>
            <table><thead><tr><th>Date</th><th>Orders</th><th>Sales</th></tr></thead>
              <tbody>{data.perDay.map((d) => <tr key={d.date}><td>{dayShort(d.date)}</td><td>{d.orders}</td><td>{rupee(d.sales)}</td></tr>)}</tbody></table>
          </details>
        </section>

        <section className="adm-card">
          <div className="adm-card-head"><h2>Top items (packs)</h2></div>
          {data.topProducts.length ? (
            <div className="hbars">
              {data.topProducts.map((p) => (
                <div key={p.id} className="hbar" title={`${p.name}: ${p.packs} packs`}>
                  <span>{p.name}</span>
                  <span className="track"><i style={{ width: `${(p.packs / maxPacks) * 100}%` }} /></span>
                  <b>{p.packs}</b>
                </div>
              ))}
            </div>
          ) : <p className="muted small">No sales in this period yet.</p>}
        </section>
      </div>

      <div className="adm-grid-3">
        <section className="adm-card">
          <div className="adm-card-head"><h2>Upcoming deliveries</h2></div>
          {data.upcoming.length ? (
            <ul className="mini-list">{data.upcoming.map((u) => <li key={u.date}><span><CalendarDays size={14} /> {u.label.split(' · ')[0]}</span><b>{u.count} open</b></li>)}</ul>
          ) : <p className="muted small">No open orders.</p>}
        </section>
        <section className="adm-card">
          <div className="adm-card-head"><h2>Cash by delivery partner</h2></div>
          {data.cash.length ? (
            <table className="adm-table compact"><thead><tr><th>Partner</th><th>Delivered</th><th>Collected</th><th>On road</th></tr></thead>
              <tbody>{data.cash.map((c) => <tr key={c.key}><td>{c.name}</td><td>{c.delivered}</td><td>{rupee(c.collected)}</td><td>{rupee(c.pending)}</td></tr>)}</tbody></table>
          ) : <p className="muted small">No deliveries in this period.</p>}
        </section>
        <section className="adm-card">
          <div className="adm-card-head"><h2>Low stock</h2><button className="link" onClick={() => goto('products')}>Update →</button></div>
          {data.lowStock.length ? (
            <ul className="mini-list">{data.lowStock.map((p) => <li key={p.id}><span>{p.name}</span><b className={p.stock === 0 ? 'bad' : 'warn'}>{p.stock === 0 ? 'Sold out' : `${p.stock} left`}</b></li>)}</ul>
          ) : <p className="muted small"><Check size={14} /> All products are well stocked.</p>}
        </section>
      </div>

      <section className="adm-card">
        <div className="adm-card-head"><h2>Export orders (Excel / CSV)</h2></div>
        <div className="export-form">
          <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
          {from && to && from <= to ? (
            <a className="btn btn-primary" href={`/api/admin/export?from=${from}&to=${to}`} download><Download size={16} /> Download CSV</a>
          ) : (
            <span className="small bad-text">“From” must be on or before “To”.</span>
          )}
        </div>
      </section>
    </div>
  );
}

function SettlementReport({ version, openOrder }: Shared) {
  const [days, setDays] = useState(30);
  const [accountType, setAccountType] = useState<'all' | 'b2b' | 'retail'>('all');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Record<string, { id: string; date: string; status: string; total: number; payment: 'cod' | 'online'; paymentStatus?: string; cashCollected: number; onlinePaid: number; pendingCollection: number }[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [expenses, setExpenses] = useState<Array<{ id: number; name: string; amount: number }>>(() => {
    try {
      const raw = localStorage.getItem('farmtouch-settlement-expenses');
      if (!raw) return [
        { id: 1, name: 'Delivery fuel', amount: 0 },
        { id: 2, name: 'Packing materials', amount: 0 },
        { id: 3, name: 'Staff support', amount: 0 },
      ];
      return JSON.parse(raw) as Array<{ id: number; name: string; amount: number }>;
    } catch {
      return [
        { id: 1, name: 'Delivery fuel', amount: 0 },
        { id: 2, name: 'Packing materials', amount: 0 },
        { id: 3, name: 'Staff support', amount: 0 },
      ];
    }
  });

  useEffect(() => {
    localStorage.setItem('farmtouch-settlement-expenses', JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    let alive = true;
    api<DashboardData>('/api/admin/reports?days=' + days)
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [days, version, tick]);
  usePolling(useCallback(() => setTick((t) => t + 1), []), 60_000);

  const customerGroups = useMemo(() => {
    const orders = data
      ? (accountType === 'all' ? data.settlement.orders : data.settlement.orders.filter((order) => order.accountType === accountType))
      : [];
    const groups = new Map<string, { phone: string; name: string; accountType: 'b2b' | 'retail'; businessName: string; orders: DashboardData['settlement']['orders'] }>();
    for (const order of orders) {
      const group = groups.get(order.customerPhone) ?? {
        phone: order.customerPhone,
        name: order.customerName,
        accountType: order.accountType,
        businessName: order.businessName,
        orders: [],
      };
      group.orders.push(order);
      groups.set(order.customerPhone, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [accountType, data]);

  async function loadCustomerHistory(phone: string) {
    setExpandedCustomer(phone);
    if (customerHistory[phone]) return;
    setHistoryLoading(phone);
    setHistoryError('');
    try {
      const result = await api<{ orders: { id: string; date: string; status: string; total: number; payment: 'cod' | 'online'; paymentStatus?: string; cashCollected: number; onlinePaid: number; pendingCollection: number }[] }>(`/api/admin/customers/orders?phone=${encodeURIComponent(phone)}`);
      setCustomerHistory((current) => ({ ...current, [phone]: result.orders }));
    } catch (e) {
      setHistoryError((e as Error).message);
    } finally {
      setHistoryLoading(null);
    }
  }

  if (error && !data) return <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <Loading />;

  const totalExpenses = expenses.reduce((n, row) => n + (Number(row.amount) || 0), 0);
  const estimatedProfit = data.settlement.netSettlement - totalExpenses;
  const selected = accountType === 'all'
    ? { ...data.settlement, orders: data.settlement.orders.length }
    : data.settlement.byType[accountType];

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <div className="adm-card-head">
          <h2>Settlement & P&L</h2>
          <div className="seg-mini">{[7, 14, 30].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}d</button>)}</div>
        </div>
        <div className="seg-mini" role="group" aria-label="Settlement account type">
          {(['all', 'b2b', 'retail'] as const).map((type) => <button key={type} className={accountType === type ? 'on' : ''} onClick={() => setAccountType(type)}>{type === 'all' ? 'All accounts' : type.toUpperCase()}</button>)}
        </div>
        <div className="kpis">
          <div className="kpi"><small>Orders</small><strong>{selected.orders ?? data.settlement.orders.length}</strong><span>{accountType === 'all' ? 'All accounts' : accountType.toUpperCase()}</span></div>
          <div className="kpi"><small>Gross sales</small><strong>{rupee(selected.grossSales)}</strong><span>Revenue booked</span></div>
          <div className="kpi"><small>Paid</small><strong>{rupee(selected.cashCollected + selected.onlinePaid)}</strong><span>COD collected + online</span></div>
          <div className="kpi"><small>Pending collection</small><strong>{rupee(selected.pendingCollection)}</strong><span>Due from riders / customers</span></div>
        </div>
      </section>

      <div className="adm-grid-2">
        <section className="adm-card">
          <div className="adm-card-head"><h2>Settlement snapshot</h2></div>
          <table className="adm-table compact">
            <tbody>
              <tr><td>Gross sales</td><td>{rupee(selected.grossSales)}</td></tr>
              <tr><td>Discounts</td><td>{rupee(selected.discounts)}</td></tr>
              <tr><td>Delivery revenue</td><td>{rupee(selected.deliveryRevenue)}</td></tr>
              <tr><td>Cash collected</td><td>{rupee(selected.cashCollected)}</td></tr>
              <tr><td>Paid online</td><td>{rupee(selected.onlinePaid)}</td></tr>
              <tr><td>Cancelled order value</td><td>{rupee(selected.cancelledValue)}</td></tr>
              <tr><td>Net settlement</td><td>{rupee(selected.netSettlement)}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="adm-card">
          <div className="adm-card-head"><h2>Profit & loss</h2></div>
          <table className="adm-table compact">
            <tbody>
              <tr><td>Operating expenses</td><td>{rupee(totalExpenses)}</td></tr>
              <tr><td>Estimated overall profit</td><td className={estimatedProfit >= 0 ? 'good' : 'bad'}>{rupee(estimatedProfit)}</td></tr>
            </tbody>
          </table>
          <div className="settlement-expenses" style={{ marginTop: '1rem' }}>
            {expenses.map((row) => (
              <div key={row.id} className="settlement-expense-row" style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input value={row.name} onChange={(e) => setExpenses((list) => list.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))} placeholder="Expense name" />
                <input type="number" value={row.amount} min="0" step="1" onChange={(e) => setExpenses((list) => list.map((item) => item.id === row.id ? { ...item, amount: Number(e.target.value || 0) } : item))} />
                <button className="link" onClick={() => setExpenses((list) => list.filter((item) => item.id !== row.id))}>Remove</button>
              </div>
            ))}
            <button className="btn btn-outline sm" onClick={() => setExpenses((list) => [...list, { id: Date.now(), name: 'New expense', amount: 0 }])}>Add expense</button>
          </div>
        </section>
      </div>

      <section className="adm-card">
        <div className="adm-card-head"><h2>Customer settlement</h2></div>
        <table className="adm-table compact">
          <thead><tr><th>Account</th><th>Customer</th><th>Orders</th><th>Order totals</th><th>Paid</th><th>Pending</th></tr></thead>
          <tbody>
            {customerGroups.length ? customerGroups.map((customer) => {
              const isExpanded = expandedCustomer === customer.phone;
              const sales = customer.orders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.total, 0);
              const paid = customer.orders.reduce((sum, order) => sum + order.cashCollected + order.onlinePaid, 0);
              const pending = customer.orders.reduce((sum, order) => sum + order.pendingCollection, 0);
              return (
                <Fragment key={customer.phone}>
                  <tr>
                    <td>{customer.accountType === 'b2b' ? customer.businessName || customer.name : 'Retail'}</td>
                    <td><button className="link" aria-expanded={isExpanded} onClick={() => isExpanded ? setExpandedCustomer(null) : void loadCustomerHistory(customer.phone)}>{customer.name} · {customer.phone}</button></td>
                    <td>{customer.orders.length} in period</td>
                    <td>{rupee(sales)}</td>
                    <td>{rupee(paid)}</td>
                    <td>{rupee(pending)}</td>
                  </tr>
                  {isExpanded && <tr><td colSpan={6}>
                    {historyLoading === customer.phone ? <span className="muted">Loading order history…</span> : historyError ? <><span className="bad-text">{historyError}</span> <button className="link" onClick={() => void loadCustomerHistory(customer.phone)}>Retry</button></> : (
                      <table className="adm-table compact">
                        <thead><tr><th>Date</th><th>Order</th><th>Status</th><th>Total</th><th>Method</th><th>Paid</th><th>Pending</th></tr></thead>
                        <tbody>{(customerHistory[customer.phone] ?? []).map((order) => (
                          <tr key={order.id}>
                            <td>{order.date}</td>
                            <td><button className="link" onClick={() => openOrder(order.id)}>{order.id}</button></td>
                            <td>{order.status}</td>
                            <td>{rupee(order.total)}</td>
                            <td>{order.payment === 'online' ? 'Online' : 'COD'}</td>
                            <td>{rupee(order.cashCollected + order.onlinePaid)}</td>
                            <td>{rupee(order.pendingCollection)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    )}
                  </td></tr>}
                </Fragment>
              );
            }) : <tr><td colSpan={6} className="muted">No orders in this period.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- orders (admin)

const FILTERS: { id: string; label: string }[] = [
  { id: 'open', label: 'All open' },
  { id: 'placed', label: 'New' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'packing', label: 'Packing' },
  { id: 'packed', label: 'Packed' },
  { id: 'out_for_delivery', label: 'Out for delivery' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

function OrdersView({ openOrder, version }: Shared) {
  const [status, setStatus] = useState('open');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const query = new URLSearchParams({ status, ...(date ? { slot: date } : {}), ...(debounced ? { q: debounced } : {}) }).toString();
  const { orders, error, reload } = useOrders(query, version);
  const newOnes = (orders ?? []).filter((o) => o.status === 'placed');

  async function confirmSelected() {
    setBusy(true);
    let ok = 0;
    for (const id of selected) {
      try { await api('/api/admin/orders', { id, action: 'confirm' }); ok++; } catch (e) { toast.error(`${id}: ${(e as Error).message}`); }
    }
    setBusy(false);
    setSelected([]);
    if (ok) toast.success(`${ok} order${ok > 1 ? 's' : ''} confirmed`);
    reload();
  }

  return (
    <div className="adm-stack">
      <div className="adm-filters">
        <div className="chips">{FILTERS.map((f) => <button key={f.id} className={status === f.id ? 'on' : ''} onClick={() => { setStatus(f.id); setSelected([]); }}>{f.label}</button>)}</div>
        <div className="adm-filter-row">
          <label className="adm-search"><Search size={16} /><input type="search" placeholder="Order ID, name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" /></label>
          <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Delivery day">
            <option value="">All delivery days</option>
            {deliveryDates().map((d) => <option key={d} value={d}>{dayShort(d)}</option>)}
          </select>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="bulk-bar">
          <span>{selected.length} selected</span>
          <button className="btn btn-primary sm" disabled={busy} onClick={() => void confirmSelected()}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Confirm selected</button>
          <button className="link" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!orders ? <Loading /> : orders.length === 0 ? <Empty icon={ClipboardList} title="No orders here" text="New orders appear automatically." /> : (
        <div className="adm-list">
          {newOnes.length > 1 && (
            <label className="select-all"><input type="checkbox" checked={newOnes.every((o) => selected.includes(o.id))} onChange={(e) => setSelected(e.target.checked ? newOnes.map((o) => o.id) : [])} /> Select all new orders</label>
          )}
          {orders.map((o) => (
            <OrderRow key={o.id} o={o} onOpen={() => openOrder(o.id)} selectable={o.status === 'placed'} selected={selected.includes(o.id)}
              onSelect={(v) => setSelected((s) => (v ? [...s, o.id] : s.filter((x) => x !== o.id)))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- packing (admin + packer)

type PickData = { slot: string; orders: number; rows: { productId: string; name: string; unit: string; packs: number; orders: number }[] };

function PackingView({ openOrder, version }: Shared) {
  const { orders, error, reload } = useOrders('status=open', version);
  const dates = deliveryDates();
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders ?? []) if (['placed', 'confirmed', 'packing'].includes(o.status)) m[o.slot.slice(0, 10)] = (m[o.slot.slice(0, 10)] ?? 0) + 1;
    return m;
  }, [orders]);
  const [chosen, setChosen] = useState<string | null>(null);
  const date = chosen ?? dates.find((d) => counts[d]) ?? dates[1];
  const [pick, setPick] = useState<PickData | null>(null);
  const [pickError, setPickError] = useState('');
  useEffect(() => {
    let alive = true;
    api<PickData>('/api/admin/picklist?date=' + date)
      .then((d) => { if (alive) { setPick(d); setPickError(''); } })
      .catch((e: Error) => { if (alive) setPickError(e.message); });
    return () => { alive = false; };
  }, [date, orders]);

  const forDay = (orders ?? []).filter((o) => o.slot.startsWith(date));
  const toPack = forDay.filter((o) => ['placed', 'confirmed', 'packing'].includes(o.status));
  const packed = forDay.filter((o) => o.status === 'packed');

  return (
    <div className="adm-stack">
      <div className="chips day-chips">
        {dates.map((d) => (
          <button key={d} className={date === d ? 'on' : ''} onClick={() => setChosen(d)}>
            {d === dates[0] ? 'Today' : d === dates[1] ? 'Tomorrow' : dayShort(d)}{counts[d] ? <b>{counts[d]}</b> : null}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}

      <section className="adm-card print-area">
        <div className="adm-card-head">
          <h2>Pick list · {dayShort(date)}</h2>
          <button className="btn btn-outline sm no-print" onClick={() => window.print()}><Printer size={14} /> Print</button>
        </div>
        <p className="muted small">Total packs to collect from the store for {pick?.orders ?? 0} order(s) not yet packed. Baskets are included.</p>
        {pickError ? <ErrorBox message={pickError} onRetry={reload} /> : !pick ? <Loading /> : pick.rows.length === 0 ? <p className="muted small">Nothing to pick for this day.</p> : (
          <table className="adm-table pick">
            <thead><tr><th>Item</th><th>Pack size</th><th className="num">Packs</th><th className="num">Orders</th><th className="no-print">✓</th></tr></thead>
            <tbody>{pick.rows.map((r) => <tr key={r.productId}><td><strong>{r.name}</strong></td><td>{r.unit}</td><td className="num big">{r.packs}</td><td className="num">{r.orders}</td><td className="no-print"><input type="checkbox" aria-label={'Picked ' + r.name} /></td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section className="adm-card">
        <div className="adm-card-head"><h2>Orders to pack ({toPack.length})</h2></div>
        {!orders ? <Loading /> : toPack.length === 0 ? <p className="muted small">All orders for this day are packed. 🎉</p> : (
          <div className="pack-grid">
            {toPack.map((o) => {
              const rows = packingRows(o.items);
              const pct = Math.round((o.packed.length / Math.max(1, rows.length)) * 100);
              return (
                <button key={o.id} className="pack-card" onClick={() => openOrder(o.id)}>
                  <span className="pack-card-top"><strong>{o.id}</strong><StatusBadge status={o.status} /></span>
                  <span>{o.address.name} · {items(rows.length)}</span>
                  <span className="dp-track"><i style={{ width: pct + '%' }} /></span>
                  <small>{o.packed.length}/{rows.length} packed · {o.replacement === 'ask' ? 'Ask before replacing' : 'Remove if unavailable'}</small>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {packed.length > 0 && (
        <section className="adm-card">
          <div className="adm-card-head"><h2>Packed, waiting for dispatch ({packed.length})</h2></div>
          <div className="adm-list">{packed.map((o) => <OrderRow key={o.id} o={o} onOpen={() => openOrder(o.id)} />)}</div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dispatch (admin)

function DispatchView({ openOrder, version, partners, onChanged, onPending }: Shared & { onChanged: () => void }) {
  const { orders, error, reload } = useOrders('status=open', version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ready = (orders ?? []).filter((o) => o.status === 'packed');
  const onRoad = (orders ?? []).filter((o) => o.status === 'out_for_delivery');

  async function run(id: string, body: Record<string, unknown>, done: string) {
    setBusyId(id);
    try { const d = await api<{ pending?: Notice[] }>('/api/admin/orders', { id, ...body }); toast.success(done); reload(); onChanged(); onPending(d.pending); }
    catch (e) { toast.error((e as Error).message); reload(); }
    finally { setBusyId(null); }
  }

  return (
    <div className="adm-stack">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {partners.length === 0 && (
        <div className="stock-warning"><Info size={18} /><div><strong>No delivery partners yet</strong><span>Add staff with the “Delivery” role in the Staff tab to assign orders.</span></div></div>
      )}
      <section className="adm-card">
        <div className="adm-card-head"><h2>Ready to dispatch ({ready.length})</h2></div>
        {!orders ? <Loading /> : ready.length === 0 ? <p className="muted small">No packed orders waiting.</p> : (
          <div className="adm-list">
            {ready.map((o) => (
              <div key={o.id} className="dispatch-row">
                <button className="adm-order-main" onClick={() => openOrder(o.id)}>
                  <span className="adm-order-id"><strong>{o.id}</strong><small>{dayShort(o.slot)}</small></span>
                  <span className="adm-order-cust"><strong>{o.address.name}</strong><small>{o.address.street.slice(0, 40)}{o.address.street.length > 40 ? '…' : ''} · {o.address.pin}</small></span>
                  <span className="adm-order-total">{rupee(o.totals.total)}</span>
                </button>
                <select
                  aria-label={'Delivery partner for ' + o.id}
                  value={o.assignee?.email ?? ''}
                  disabled={busyId === o.id}
                  onChange={(e) => void run(o.id, { action: 'assign', assignee: e.target.value }, e.target.value ? 'Partner assigned' : 'Unassigned')}
                >
                  <option value="">Assign partner…</option>
                  {partners.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
                </select>
                <button className="btn btn-primary sm" disabled={!o.assignee || busyId === o.id} onClick={() => void run(o.id, { action: 'out_for_delivery' }, 'Marked out for delivery')}>
                  <Truck size={14} /> Send out
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="adm-card">
        <div className="adm-card-head"><h2>On the road ({onRoad.length})</h2></div>
        {!orders ? <Loading /> : onRoad.length === 0 ? <p className="muted small">Nobody is out for delivery right now.</p> : (
          <div className="adm-list">{onRoad.map((o) => <OrderRow key={o.id} o={o} onOpen={() => openOrder(o.id)} />)}</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- my deliveries (delivery partner)

function MyDeliveries({ me, version, onPending }: Shared) {
  const { orders, error, reload } = useOrders('status=all', version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliverFor, setDeliverFor] = useState<OrderRecord | null>(null);
  const [failFor, setFailFor] = useState<OrderRecord | null>(null);
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const today = istDate();
  const mine = (orders ?? []).filter((o) => o.assignee?.email === me.email);
  const active = mine.filter((o) => o.status === 'packed' || o.status === 'out_for_delivery').sort((a, b) => a.slot.localeCompare(b.slot));
  const doneToday = mine.filter((o) => o.status === 'delivered' && istDate(new Date(o.updatedAt)) === today);
  const cashToday = doneToday.filter((o) => o.payment !== 'online').reduce((n, o) => n + (o.cashCollected ?? 0), 0);
  const dueToday = active.reduce((n, o) => n + (o.payment === 'online' && o.paymentStatus === 'paid' ? 0 : o.totals.total), 0);

  async function run(o: OrderRecord, body: Record<string, unknown>, done: string) {
    setBusyId(o.id);
    try { const d = await api<{ pending?: Notice[] }>('/api/admin/orders', { id: o.id, ...body }); toast.success(done); setDeliverFor(null); setFailFor(null); reload(); onPending(d.pending); }
    catch (e) { toast.error((e as Error).message); reload(); }
    finally { setBusyId(null); }
  }

  return (
    <div className="adm-stack">
      <section className="kpis">
        <div className="kpi"><small>To deliver</small><strong>{active.length}</strong><span>{rupee(dueToday)} cash / UPI due</span></div>
        <div className="kpi"><small>Delivered today</small><strong>{doneToday.length}</strong><span>{rupee(cashToday)} collected</span></div>
      </section>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!orders ? <Loading /> : active.length === 0 ? <Empty icon={Bike} title="No deliveries assigned" text="New assignments appear here automatically." /> : (
        <div className="delivery-cards">
          {active.map((o) => (
            <article key={o.id} className={'delivery-card s-' + o.status}>
              <div className="dc-top"><strong>{o.id}</strong><StatusBadge status={o.status} /></div>
              <h3>{o.address.name}</h3>
              <p className="dc-address"><MapPin size={15} /> {o.address.street}, {o.address.pin}</p>
              <p className="dc-meta"><CalendarDays size={14} /> {o.slotLabel} · {items(packingRows(o.items).length)}</p>
              <div className="dc-cash">{o.payment === 'online' && o.paymentStatus === 'paid' ? <><Check size={18} /> Paid online · no cash due</> : <><Banknote size={18} /> Collect <b>{rupee(o.totals.total)}</b> (cash / UPI)</>}</div>
              <div className="dc-contact">
                <a className="btn btn-outline sm" href={'tel:+91' + o.address.phone}><Phone size={14} /> Call</a>
                <a className="btn btn-outline sm" href={whatsappLink(o.address.phone, statusMessage(o.address.name, o.id, 'out_for_delivery', o.totals.total, '', o.payment))} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={14} /> WhatsApp</a>
                <a className="btn btn-outline sm" href={mapsLink(o.address)} target="_blank" rel="noopener noreferrer"><Navigation size={14} /> Map</a>
              </div>
              {o.status === 'packed' ? (
                <button className="btn btn-primary block" disabled={busyId === o.id} onClick={() => void run(o, { action: 'out_for_delivery' }, 'Started delivery')}><Truck size={16} /> Start delivery</button>
              ) : (
                <div className="dc-actions">
                  <button className="btn btn-primary" disabled={busyId === o.id} onClick={() => {
                    if (o.payment === 'online' && o.paymentStatus === 'paid') void run(o, { action: 'delivered', cash: 0 }, 'Delivery marked delivered · paid online');
                    else { setDeliverFor(o); setCash(String(o.totals.total)); setNote(''); }
                  }}><Check size={16} /> Delivered</button>
                  <button className="btn btn-outline danger" disabled={busyId === o.id} onClick={() => { setFailFor(o); setNote(''); }}>Couldn’t deliver</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {doneToday.length > 0 && (
        <section className="adm-card">
          <div className="adm-card-head"><h2>Delivered today</h2></div>
          <ul className="mini-list">{doneToday.map((o) => <li key={o.id}><span>{o.id} · {o.address.name}</span><b>{o.payment === 'online' && o.paymentStatus === 'paid' ? 'Paid online' : rupee(o.cashCollected ?? 0)}</b></li>)}</ul>
        </section>
      )}

      <Dialog open={!!deliverFor} onOpenChange={(v) => { if (!v) setDeliverFor(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>Mark {deliverFor?.id} delivered</DialogTitle>
          <DialogDescription>Bill amount {rupee(deliverFor?.totals.total ?? 0)}. Enter what you actually collected.</DialogDescription>
          <form className="address-form" onSubmit={(e) => { e.preventDefault(); if (deliverFor) void run(deliverFor, { action: 'delivered', cash: Number(cash), note }, 'Delivered'); }}>
            <label>Cash / UPI collected (₹)<input required inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            <label>Note (optional)<input value={note} maxLength={200} placeholder="e.g. Paid by UPI, left with security" onChange={(e) => setNote(e.target.value)} /></label>
            <button className="btn btn-primary block lg" disabled={!cash || busyId === deliverFor?.id} type="submit">Confirm delivery</button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!failFor} onOpenChange={(v) => { if (!v) setFailFor(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>Couldn’t deliver {failFor?.id}?</DialogTitle>
          <DialogDescription>The order goes back to “Packed” so the store can reschedule it.</DialogDescription>
          <form className="address-form" onSubmit={(e) => { e.preventDefault(); if (failFor) void run(failFor, { action: 'failed', note }, 'Returned to store'); }}>
            <label>Reason<input required value={note} maxLength={200} placeholder="e.g. Customer not reachable, gate closed" onChange={(e) => setNote(e.target.value)} /></label>
            <button className="btn btn-danger block lg" disabled={!note.trim() || busyId === failFor?.id} type="submit">Return to store</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- order drawer (all roles)

function OrderDrawer({ id, onClose, me, partners, whatsappNumber, onChanged, onPending }: {
  id: string | null;
  onClose: () => void;
  me: Me;
  partners: StaffMember[];
  whatsappNumber: string;
  onChanged: () => void;
  onPending: (list: Notice[] | undefined) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [msgVersion, setMsgVersion] = useState(0);
  // Prompts are rendered inside the drawer so the stacked dialogs stay accessible.
  const [drawerPrompt, setDrawerPrompt] = useState<Notice[]>([]);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cash, setCash] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    api<{ order: OrderRecord }>('/api/admin/orders?id=' + encodeURIComponent(id))
      .then((d) => { if (alive) { setOrder(d.order); setError(''); setCash(String(d.order.totals.total)); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  async function act(action: OrderAction, extra: Record<string, unknown> = {}, quiet = false): Promise<boolean> {
    if (!order) return false;
    setBusy(action + (extra.itemKey ?? ''));
    try {
      const d = await api<{ order: OrderRecord; pending?: Notice[] }>('/api/admin/orders', { id: order.id, action, ...extra });
      setOrder(d.order);
      setMsgVersion((v) => v + 1);
      if (d.pending?.length) setDrawerPrompt(d.pending);
      onPending(undefined);
      if (!quiet) toast.success(ACTION_LABEL[action]);
      if (action === 'note') setNote('');
      if (action === 'cancel') setConfirmCancel(false);
      onChanged();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      // reload the latest version after a conflict
      api<{ order: OrderRecord }>('/api/admin/orders?id=' + encodeURIComponent(order.id)).then((d) => setOrder(d.order)).catch(() => {});
      return false;
    } finally {
      setBusy(null);
    }
  }

  const show = !!id;
  const o = order && order.id === id ? order : null;
  const rows = o ? packingRows(o.items) : [];
  const can = (a: OrderAction) => !!o && canDo(a, me.role, o.status) && (me.role !== 'delivery' || o.assignee?.email === me.email);
  const allPacked = !!o && rows.every((r) => o.packed.includes(r.key));

  return (
    <Sheet open={show} onOpenChange={(v) => { if (!v) { onClose(); setConfirmCancel(false); } }}>
      <SheetContent
        className="cart-sheet adm-drawer"
        // Keep the order open while staff use WhatsApp (focus leaves the page) or the dialogs/toasts on top of it.
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('[role="dialog"], [role="alertdialog"], [data-sonner-toaster]')) e.preventDefault();
        }}
      >
        <SheetTitle>{id}</SheetTitle>
        <SheetDescription className="sr-only">Order details and actions</SheetDescription>
        <div className="sheet-scroll">
          {error && !o ? <ErrorBox message={error} onRetry={onClose} /> : !o ? <Loading /> : (
            <>
              <div className="drawer-status"><StatusBadge status={o.status} /><small>Placed {timeFmt(o.createdAt)}</small></div>

              <section className="adm-card tight">
                <h3>{o.address.name}</h3>
                <p className="small">{o.address.street}, {o.address.pin}</p>
                <p className="small"><CalendarDays size={13} /> {o.slotLabel}</p>
                <div className="dc-contact">
                  <a className="btn btn-outline sm" href={'tel:+91' + o.address.phone}><Phone size={14} /> {o.address.phone}</a>
                  <a className="btn btn-outline sm" href={whatsappLink(o.address.phone, statusMessage(o.address.name, o.id, o.status, o.totals.total, '', o.payment))} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={14} /> Message</a>
                  <a className="btn btn-outline sm" href={mapsLink(o.address)} target="_blank" rel="noopener noreferrer"><Navigation size={14} /> Map</a>
                </div>
                <p className="small muted">If unavailable: {o.replacement === 'ask' ? 'ask customer first' : 'remove item and adjust bill'}{o.whatsappUpdates ? ' · wants WhatsApp updates' : ''}</p>
              </section>

              <section className="adm-card tight print-area">
                <div className="adm-card-head">
                  <h3>Packing list {rows.length ? `(${o.packed.filter((k) => rows.some((r) => r.key === k)).length}/${rows.length})` : ''}</h3>
                  <button className="btn btn-outline sm no-print" onClick={() => window.print()}><Printer size={14} /> Slip</button>
                </div>
                <p className="print-only"><b>{o.id}</b> · {o.address.name} · {o.address.phone}<br />{o.address.street}, {o.address.pin}<br />{o.slotLabel} · {o.payment === 'online' && o.paymentStatus === 'paid' ? 'Paid online' : `Collect ${rupee(o.totals.total)}`}</p>
                <ul className="checklist">
                  {rows.map((r) => {
                    const done = o.packed.includes(r.key);
                    const canTick = can('toggle_item');
                    return (
                      <li key={r.key} className={done ? 'done' : ''}>
                        <label>
                          <input type="checkbox" checked={done} disabled={!canTick || !!busy} onChange={() => void act('toggle_item', { itemKey: r.key }, true)} />
                          <span><strong>{r.packs} × {r.name}</strong> <small>{r.unit}{r.group ? ` · in ${r.group}` : ''}</small></span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="bill compact-bill">
                  <div><span>Items</span><span>{rupee(o.totals.subtotal)}</span></div>
                  {o.totals.discount > 0 && <div className="good"><span>Coupon {o.coupon}</span><span>−{rupee(o.totals.discount)}</span></div>}
                  <div><span>Delivery</span><span>{o.totals.delivery ? rupee(o.totals.delivery) : 'FREE'}</span></div>
                  <div className="bill-total"><strong>{o.payment === 'online' && o.paymentStatus === 'paid' ? 'Paid online' : o.payment === 'online' && o.paymentStatus === 'refund_pending' ? 'Refund processing' : o.payment === 'online' && o.paymentStatus === 'refund_failed' ? 'Refund needs review' : 'Collect (COD)'}</strong><strong>{rupee(o.totals.total)}</strong></div>
                  {o.cashCollected !== null && o.payment !== 'online' && <div className="good"><span>Collected</span><span>{rupee(o.cashCollected)}</span></div>}
                </div>
              </section>

              <section className="adm-card tight">
                <h3>Actions</h3>
                <div className="action-grid">
                  {can('edit_items') && (
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => setEditOpen(true)}><Pencil size={16} /> Change items / unavailable</button>
                  )}
                  {can('confirm') && <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('confirm')}><Check size={16} /> Confirm order</button>}
                  {can('start_packing') && <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('start_packing')}><Package size={16} /> Start packing</button>}
                  {can('mark_packed') && (
                    <button className="btn btn-primary" disabled={!!busy || !allPacked} onClick={() => void act('mark_packed')} title={allPacked ? '' : 'Tick every item first'}>
                      <PackageCheck size={16} /> {allPacked ? 'Mark packed' : `Tick all items (${rows.length - o.packed.length} left)`}
                    </button>
                  )}
                  {can('assign') && (
                    <label className="assign">
                      <span><Bike size={15} /> Delivery partner</span>
                      <select value={o.assignee?.email ?? ''} disabled={!!busy} onChange={(e) => void act('assign', { assignee: e.target.value })}>
                        <option value="">Not assigned</option>
                        {partners.map((p) => <option key={p.email} value={p.email}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</option>)}
                      </select>
                    </label>
                  )}
                  {!can('assign') && o.assignee && <p className="small"><Bike size={14} /> {o.assignee.name}{o.assignee.phone ? ` · ${o.assignee.phone}` : ''}</p>}
                  {can('out_for_delivery') && <button className="btn btn-primary" disabled={!!busy || !o.assignee} onClick={() => void act('out_for_delivery')}><Truck size={16} /> {o.assignee ? 'Out for delivery' : 'Assign a partner first'}</button>}
                  {can('delivered') && o.payment === 'online' && o.paymentStatus === 'paid' && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('delivered', { cash: 0 })}><Check size={16} /> Mark delivered · paid online</button>
                  )}
                  {can('delivered') && !(o.payment === 'online' && o.paymentStatus === 'paid') && (
                    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void act('delivered', { cash: Number(cash) }); }}>
                      <label>Collected ₹<input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
                      <button className="btn btn-primary" disabled={!!busy || !cash} type="submit"><Check size={16} /> Delivered</button>
                    </form>
                  )}
                  {can('failed') && <button className="btn btn-outline danger" disabled={!!busy || !note.trim()} onClick={() => void act('failed', { note })} title="Write the reason in the note box below">Delivery failed (write reason below)</button>}
                  {can('cancel') && !confirmCancel && <button className="btn btn-outline danger" disabled={!!busy} onClick={() => setConfirmCancel(true)}><X size={16} /> Cancel order</button>}
                  {confirmCancel && (
                    <div className="confirm-box">
                      <p>Cancel {o.id}? Stock is returned to the shelf. Reason (optional) from the note box.</p>
                      <div className="dialog-actions">
                        <button className="btn btn-outline sm" onClick={() => setConfirmCancel(false)}>Keep</button>
                        <button className="btn btn-danger sm" disabled={!!busy} onClick={() => void act('cancel', { note })}>Yes, cancel</button>
                      </div>
                    </div>
                  )}
                  {o.status === 'delivered' && <p className="small good-text"><Check size={14} /> Delivered — nothing more to do.</p>}
                  {o.status === 'cancelled' && <p className="small muted">This order is cancelled.</p>}
                </div>
                <form className="note-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act('note', { note }); }}>
                  <input placeholder="Add a note (visible to staff)…" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
                  <button className="btn btn-outline sm" disabled={!note.trim() || !!busy} type="submit">Add</button>
                </form>
              </section>

              <OrderMessages orderId={o.id} version={msgVersion} />
              <SendPrompt notice={drawerPrompt[0] ?? null} onClose={() => { setDrawerPrompt((p) => p.slice(1)); setMsgVersion((v) => v + 1); onPending(undefined); }} />
              <EditItemsDialog
                order={o}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSave={async (changes, reason) => {
                  const ok = await act('edit_items', { changes, note: reason });
                  if (ok) setEditOpen(false);
                  return ok;
                }}
              />
              {o.events && o.events.length > 0 && (
                <section className="adm-card tight">
                  <h3>History</h3>
                  <ul className="timeline">
                    {[...o.events].reverse().map((e, i) => (
                      <li key={i}>
                        <span><b>{e.action === 'placed' ? 'Order placed' : e.action === 'customer_cancel' ? 'Cancelled by customer' : ACTION_LABEL[e.action as OrderAction] ?? e.action}</b>{e.note ? ` — ${e.note}` : ''}<br /><small>{e.actor}</small></span>
                        <small>{timeFmt(e.createdAt)}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {whatsappNumber && <p className="small muted">Store WhatsApp: +{whatsappNumber}</p>}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- products

const EMPTY_PRODUCT: Product = { id: '', name: '', local: '', unit: '', price: 0, mrp: 0, category: 'Vegetables', image: 'tomato', needsPriceReview: false, stock: 0, active: true, sort: 0 };

function ProductsView({ me }: { me: Me }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = me.role === 'admin';

  useEffect(() => {
    let alive = true;
    api<{ products: Product[]; images: string[] }>('/api/admin/products')
      .then((d) => { if (alive) { setProducts(d.products); setImages(d.images); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [tick]);

  async function saveStock(p: Product) {
    const raw = stockEdits[p.id];
    if (raw === undefined || raw === String(p.stock)) return;
    const stock = Number(raw);
    if (!Number.isInteger(stock) || stock < 0) { toast.error('Stock must be 0 or more.'); return; }
    try {
      const d = await api<{ products: Product[] }>('/api/admin/products', { op: 'stock', id: p.id, stock });
      setProducts(d.products);
      setStockEdits((s) => { const n = { ...s }; delete n[p.id]; return n; });
      toast.success(`${p.name}: stock ${stock}`);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const d = await api<{ products: Product[] }>('/api/admin/products', { op: 'save', product: editing });
      if (isNew && products?.some((p) => p.id === editing.id.trim().toLowerCase())) toast.info('A product with this ID existed and was updated.');
      setProducts(d.products);
      setEditing(null);
      toast.success('Product saved');
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  async function toggleActive(p: Product) {
    try {
      const d = await api<{ products: Product[] }>('/api/admin/products', { op: 'save', product: { ...p, active: !p.active } });
      setProducts(d.products);
      toast.success(p.active ? `${p.name} hidden from shop` : `${p.name} visible in shop`);
    } catch (e) { toast.error((e as Error).message); }
  }

  if (error && !products) return <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!products) return <Loading />;

  return (
    <div className="adm-stack">
      <div className="adm-card-head">
        <p className="muted small">{isAdmin ? 'Changes appear in the customer shop within 2 minutes (immediately on refresh). Stock reduces automatically when customers order and returns when an order is cancelled.' : 'Update stock after counting the shelf. Stock reduces automatically with every order.'}</p>
        {isAdmin && <button className="btn btn-primary sm" onClick={() => { setEditing({ ...EMPTY_PRODUCT, sort: products.length + 1 }); setIsNew(true); }}><Plus size={15} /> Add product</button>}
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table products">
          <thead><tr><th>Product</th><th className="num">Price</th><th className="num">MRP</th><th>Stock</th>{isAdmin && <th>In shop</th>}{isAdmin && <th />}</tr></thead>
          <tbody>
            {products.map((p) => {
              const edit = stockEdits[p.id];
              return (
                <tr key={p.id} className={p.active ? '' : 'inactive'}>
                  <td><span className="prod-cell"><img src={productImagePath(p.image)} alt="" width={40} height={40} /><span><strong>{p.name}</strong><small className={p.needsPriceReview ? 'bad-text' : ''}>{p.unit} · {p.category}{p.needsPriceReview ? ' · Price review needed' : ''}</small></span></span></td>
                  <td className="num">{rupee(p.price)}</td>
                  <td className="num">{rupee(p.mrp)}{discountPercent(p) ? <small className="good-text"> {discountPercent(p)}%</small> : null}</td>
                  <td>
                    <form className="stock-form" onSubmit={(e) => { e.preventDefault(); void saveStock(p); }}>
                      <input aria-label={'Stock for ' + p.name} inputMode="numeric" className={p.stock === 0 ? 'bad' : p.stock < 15 ? 'warn' : ''}
                        value={edit ?? String(p.stock)} onChange={(e) => setStockEdits((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
                      {edit !== undefined && edit !== String(p.stock) && <button className="btn btn-primary sm" type="submit">Save</button>}
                    </form>
                  </td>
                  {isAdmin && <td><button className={'toggle' + (p.active ? ' on' : '')} role="switch" aria-checked={p.active} aria-label={'Show ' + p.name + ' in shop'} onClick={() => void toggleActive(p)}><i /></button></td>}
                  {isAdmin && <td><button className="icon-btn" aria-label={'Edit ' + p.name} onClick={() => { setEditing({ ...p }); setIsNew(false); }}><Pencil size={15} /></button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>{isNew ? 'Add product' : `Edit ${editing?.name}`}</DialogTitle>
          <DialogDescription>Prices in whole rupees. MRP must be at least the selling price.</DialogDescription>
          {editing && (
            <form className="address-form two-col" onSubmit={saveProduct}>
              <label>Product ID<input required disabled={!isNew} value={editing.id} placeholder="e.g. cauliflower" onChange={(e) => setEditing({ ...editing, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></label>
              <label>Name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="span-2">Hindi / Marathi names (for search)<input value={editing.local} placeholder="Phool gobi · फुलकोबी" onChange={(e) => setEditing({ ...editing, local: e.target.value })} /></label>
              <label>Pack size<input required value={editing.unit} placeholder="500 g" onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></label>
              <label>Category<select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Selling price ₹<input required inputMode="numeric" value={editing.price || ''} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value.replace(/\D/g, '')) })} /></label>
              <label>MRP ₹<input required inputMode="numeric" value={editing.mrp || ''} onChange={(e) => setEditing({ ...editing, mrp: Number(e.target.value.replace(/\D/g, '')) })} /></label>
              <label>Stock (packs)<input required inputMode="numeric" value={String(editing.stock)} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value.replace(/\D/g, '')) })} /></label>
              <label>Display order<input inputMode="numeric" value={String(editing.sort)} onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value.replace(/\D/g, '')) })} /></label>
              <label className="check span-2"><input type="checkbox" checked={!editing.needsPriceReview} onChange={(e) => setEditing({ ...editing, needsPriceReview: !e.target.checked })} /> I confirmed the selling price and MRP</label>
              <fieldset className="span-2 image-pick"><legend>Photo</legend>
                {images.map((img) => (
                  <button type="button" key={img} className={editing.image === img ? 'on' : ''} onClick={() => setEditing({ ...editing, image: img })} aria-label={'Use photo ' + img}><img src={productImagePath(img)} alt="" width={44} height={44} /></button>
                ))}
              </fieldset>
              <label className="check span-2"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Show in customer shop</label>
              <button className="btn btn-primary block lg span-2" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={16} /> : null} Save product</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- change own password

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { toast.error('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/api/admin/password', { current, next });
      toast.success('Password changed. Other devices were logged out.');
      setCurrent(''); setNext(''); setConfirm('');
      onClose();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="dialog">
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>At least 8 characters. You stay logged in on this device.</DialogDescription>
        <form className="address-form" onSubmit={save}>
          <label>Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
          <label>New password<input type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label>Repeat new password<input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <button className="btn btn-primary block lg" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : null} Save password</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- staff

const EMPTY_STAFF: StaffMember = { email: '', name: '', phone: '', role: 'packer', active: true, createdAt: '' };

function StaffView({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    let alive = true;
    api<{ staff: StaffMember[] }>('/api/admin/staff')
      .then((d) => { if (alive) { setStaff(d.staff); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [tick]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const d = await api<{ staff: StaffMember[] }>('/api/admin/staff', { email: editing.email, name: editing.name, phone: editing.phone, role: editing.role, active: editing.active, ...(newPassword ? { password: newPassword } : {}) });
      setNewPassword('');
      setStaff(d.staff);
      setEditing(null);
      onChanged();
      toast.success('Staff saved');
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  if (error && !staff) return <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!staff) return <Loading />;

  return (
    <div className="adm-stack">
      <div className="adm-card-head">
        <p className="muted small">Staff log in at <b>/admin</b> with their email or mobile number and the password you set here. Admins see everything, packers see packing & stock, delivery partners see only their own deliveries.</p>
        <button className="btn btn-primary sm" onClick={() => { setEditing({ ...EMPTY_STAFF }); setIsNew(true); setNewPassword(''); }}><UserPlus size={15} /> Add staff</button>
      </div>
      {staff.length === 0 ? <Empty icon={Users} title="No staff added yet" text="Add packers and delivery partners with a password they will use to log in." /> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.email} className={s.active ? '' : 'inactive'}>
                  <td><strong>{s.name}</strong>{s.email === me.email && <small> (you)</small>}</td>
                  <td>{s.email}</td>
                  <td>{s.phone || '—'}</td>
                  <td><span className={'role r-' + s.role}>{ROLE_LABEL[s.role]}</span></td>
                  <td>{s.active ? (s.hasPassword ? 'Active' : <span className="bad-text">No password yet</span>) : 'Disabled'}</td>
                  <td><button className="icon-btn" aria-label={'Edit ' + s.name} onClick={() => { setEditing({ ...s }); setIsNew(false); setNewPassword(''); }}><Pencil size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>{isNew ? 'Add staff member' : `Edit ${editing?.name}`}</DialogTitle>
          <DialogDescription>Use the email they sign in with.</DialogDescription>
          {editing && (
            <form className="address-form" onSubmit={save}>
              <label>Email<input type="email" required disabled={!isNew} value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
              <label>Name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label>Mobile (used to log in; shown to customers for delivery partners)<input inputMode="numeric" maxLength={10} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>
              <fieldset className="role-pick"><legend>Role</legend>
                {STAFF_ROLES.map((r) => (
                  <label key={r} className={'choice' + (editing.role === r ? ' on' : '')}>
                    <input type="radio" name="role" checked={editing.role === r} onChange={() => setEditing({ ...editing, role: r })} />
                    <span><strong>{ROLE_LABEL[r]}</strong><small>{r === 'admin' ? 'Everything: orders, products, staff, reports' : r === 'packer' ? 'Packing lists, packing checklist, stock counts' : 'Own deliveries: start, deliver, collect cash'}</small></span>
                  </label>
                ))}
              </fieldset>
              <label>{isNew || !editing.hasPassword ? 'Password (min 8 characters) — share it with them' : 'New password (leave empty to keep the current one)'}
                <input type="text" autoComplete="new-password" required={isNew || !editing.hasPassword} minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={isNew ? 'e.g. Ravi@2026' : ''} />
              </label>
              <label className="check"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active (can log in)</label>
              <button className="btn btn-primary block lg" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={16} /> : null} Save</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <p className="small muted"><ExternalLink size={12} /> Share the staff link: your shop address followed by <code>/admin</code></p>
    </div>
  );
}
