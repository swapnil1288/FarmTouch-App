'use client';
/* eslint-disable @next/next/no-img-element -- product photos are small static .webp files served directly by the Worker */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft, BadgePercent, Banknote, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, CreditCard,
  House, Info, LayoutGrid, Phone, Leaf, LoaderCircle, MapPin, Minus, Package, Pencil, Plus, RefreshCw, RotateCcw, Search,
  Share2, ShieldCheck, ShoppingBag, ShoppingBasket, SlidersHorizontal, Sprout, Tag, Trash2, Truck, UserRound, X, Zap,
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster, toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { WhatsAppIcon } from '@/components/store/whatsapp-icon';
import {
  BASKET_PREFIX, FREE_DELIVERY_MIN, MAX_QTY, basketTypes, categories, createCatalog, discountPercent, productImagePath,
  findBasketType, isBasketId, packsNeeded, pinProblem, type Catalog, type Coupon, type Line, type Product, type Slot, type Totals,
} from '@/lib/catalog';

/** Live shop rules from the server: coupons, delivery days and delivery pincodes (null = any 411xxx). */
type StoreInfo = { coupons: Coupon[]; slots: Slot[]; pincodes: string[] | null };
type CatalogResponse = Partial<StoreInfo> & { products?: Product[] };
import { snapshotItems, type OrderRecord } from '@/lib/orders';
import { CUSTOMER_CANCELLABLE, STATUS_HINT, STATUS_LABEL, TRACK_STEPS, trackIndex, type OrderStatus } from '@/lib/workflow';
import { SUPPORT_MESSAGE, buildOrderMessage, productShareMessage, whatsappLink } from '@/lib/whatsapp';

// ---------------------------------------------------------------- types & helpers

type View = 'home' | 'shop' | 'baskets' | 'offers' | 'account' | 'checkout';
type Address = { name: string; phone: string; street: string; pin: string };
type Order = OrderRecord;
type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayFailure = { error?: { description?: string } };
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  timeout: number;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpaySuccess) => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: 'payment.failed', callback: (response: RazorpayFailure) => void) => void;
    };
  }
}

const EMPTY_ADDRESS: Address = { name: '', phone: '', street: '', pin: '' };
const DRAFT_KEY = 'farmtouch-draft-v2';
const PHONE_RE = /^[6-9]\d{9}$/;
const money = (v: number) => '₹' + v.toLocaleString('en-IN');

function addressError(a: Address, pincodes: string[] | null): string | null {
  if (a.name.trim().length < 2) return 'Enter your full name.';
  if (!PHONE_RE.test(a.phone.trim())) return 'Enter a valid 10-digit mobile number.';
  if (a.street.trim().length < 8) return 'Enter your flat, building and street.';
  return pinProblem(a.pin, pincodes);
}

/** Short customer-facing note about a coupon's extra conditions. */
function couponTerms(c: Coupon): string {
  const parts: string[] = [];
  if (c.firstOrderOnly) parts.push('First order only');
  else if (c.perCustomer === 1) parts.push('Once per customer');
  else if (c.perCustomer && c.perCustomer > 1) parts.push(`Up to ${c.perCustomer} times per customer`);
  if (c.expiresAt) parts.push('Valid till ' + new Date(c.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }));
  return parts.join(' · ');
}

/** crypto.randomUUID only exists on HTTPS / localhost – fall back for LAN testing on phones. */
function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isValidLine(l: unknown, cat: Catalog): l is Line {
  if (!l || typeof l !== 'object') return false;
  const line = l as Line;
  if (typeof line.id !== 'string' || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) return false;
  if (isBasketId(line.id)) {
    const type = findBasketType(line.id);
    return !!type && Array.isArray(line.components) && line.components.length === type.items && line.components.every((id) => !!cat.find(id));
  }
  return !!cat.find(line.id) && line.components === undefined;
}

async function readJson<T>(r: Response): Promise<T & { error?: string }> {
  try {
    return (await r.json()) as T & { error?: string };
  } catch {
    return { error: r.ok ? 'Unexpected response from server.' : `Server error (${r.status}). Please try again.` } as T & { error?: string };
  }
}

async function fetchCatalog(): Promise<CatalogResponse | null> {
  try {
    const r = await fetch('/api/catalog', { cache: 'no-store' });
    if (!r.ok) return null;
    return await readJson<CatalogResponse>(r);
  } catch {
    return null;
  }
}

type OrdersResult = { orders?: Order[]; error?: string };

async function fetchOrders(): Promise<OrdersResult> {
  try {
    const r = await fetch('/api/orders', { cache: 'no-store' });
    const d = await readJson<{ orders?: Order[] }>(r);
    if (!r.ok) return { error: d.error || 'Orders could not be loaded.' };
    return { orders: d.orders ?? [] };
  } catch {
    return { error: 'You seem to be offline. Please try again.' };
  }
}

function openWhatsApp(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load secure payment checkout. Please try again.'));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------- small components

function Photo({ name, alt, className = '' }: { name: string; alt?: string; className?: string }) {
  return (
    <img
      className={'produce ' + className}
      src={productImagePath(name)}
      alt={alt ?? (name === 'basket' ? 'Basket of fresh vegetables' : name)}
      loading="lazy"
      decoding="async"
    />
  );
}

function QtyControl({ qty, onAdd, onChange, label, size = 'md', max = MAX_QTY, soldOut = false }: {
  qty: number;
  onAdd: () => void;
  onChange: (delta: number) => void;
  label: string;
  size?: 'md' | 'sm';
  max?: number;
  soldOut?: boolean;
}) {
  if (!qty && soldOut) {
    return <span className={'sold-out ' + size}>Sold out</span>;
  }
  if (!qty) {
    return (
      <button className={'add-btn ' + size} onClick={onAdd} aria-label={'Add ' + label}>
        ADD
      </button>
    );
  }
  return (
    <div className={'stepper ' + size} role="group" aria-label={label + ' quantity'}>
      <button aria-label={'Remove one ' + label} onClick={() => onChange(-1)}><Minus size={14} strokeWidth={3} /></button>
      <span key={qty} aria-live="polite">{qty}</span>
      <button aria-label={'Add one ' + label} disabled={qty >= max} onClick={() => onChange(1)}><Plus size={14} strokeWidth={3} /></button>
    </div>
  );
}

function ProductCard({ p, qty, onAdd, onChange, onOpen }: {
  p: Product;
  qty: number;
  onAdd: () => void;
  onChange: (delta: number) => void;
  onOpen: () => void;
}) {
  const off = discountPercent(p);
  const soldOut = p.stock <= 0;
  return (
    <article className={'product-card' + (soldOut ? ' is-sold-out' : '')}>
      <button className="product-photo" onClick={onOpen} aria-label={'View ' + p.name}>
        <Photo name={p.image} alt={p.name} />
        {off > 0 && <span className="off-badge">{off}%<br />OFF</span>}
      </button>
      <div className="product-body">
        {soldOut ? <span className="eta-chip warn">Out of stock</span> : p.stock <= 5 ? <span className="eta-chip warn">Only {p.stock} left</span> : <span className="eta-chip"><Clock size={11} /> Tomorrow 9–12</span>}
        <button className="product-name" onClick={onOpen}>{p.name}</button>
        <small className="product-local">{p.local}</small>
        <small className="product-unit">{p.unit}</small>
        <div className="product-foot">
          <div className="price">
            <strong>{money(p.price)}</strong>
            {p.mrp > p.price && <del>{money(p.mrp)}</del>}
          </div>
          <QtyControl qty={qty} onAdd={onAdd} onChange={onChange} label={p.name} max={Math.min(MAX_QTY, p.stock)} soldOut={soldOut} />
        </div>
      </div>
    </article>
  );
}

const timeFmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function OrderTracker({ status }: { status: OrderStatus }) {
  if (status === 'cancelled') return <p className="tracker-cancelled"><X size={15} /> {STATUS_HINT.cancelled}</p>;
  const at = trackIndex(status);
  return (
    <ol className="tracker" aria-label={'Order status: ' + STATUS_LABEL[status]}>
      {TRACK_STEPS.map((step, i) => (
        <li key={step} className={i < at ? 'done' : i === at ? 'current' : ''}>
          <span className="dot">{i < at || status === 'delivered' ? <Check size={11} strokeWidth={3} /> : null}</span>
          <small>{step === 'packing' && status === 'packed' ? 'Packed' : STATUS_LABEL[step]}</small>
        </li>
      ))}
    </ol>
  );
}

function OrderCard({ o, onShare, onBuyAgain, onCancel, supportLink, tracking = false }: {
  o: Order;
  onShare: () => void;
  onBuyAgain: () => void;
  onCancel: () => void;
  supportLink: string;
  /** Read-only view from “Track an order”. */
  tracking?: boolean;
}) {
  const [open, setOpen] = useState(tracking);
  const live = o.status !== 'delivered' && o.status !== 'cancelled';
  return (
    <article className={'order-card' + (live ? ' live' : '')}>
      <div className="order-top">
        <Package size={20} />
        <div>
          <h3>{o.id}</h3>
          <small>{timeFmt(o.createdAt)}</small>
        </div>
        <span className={'status s-' + o.status}>{STATUS_LABEL[o.status]}</span>
      </div>
      <OrderTracker status={o.status} />
      <p className="status-hint">{STATUS_HINT[o.status]}</p>
      {o.assignee && (
        <div className="partner">
          <Truck size={18} />
          <span><b>{o.assignee.name}</b> is delivering your order</span>
          {o.assignee.phone && <a className="btn btn-outline sm" href={'tel:+91' + o.assignee.phone}><Phone size={14} /> Call</a>}
        </div>
      )}
      <p className="order-items">{o.items.map((it) => `${it.name} × ${it.qty}`).join(', ')}</p>
      {o.slotLabel && <p className="order-slot"><CalendarDays size={14} /> {o.slotLabel}</p>}
      <p className="order-payment">{o.payment === 'online' && o.paymentStatus === 'paid' ? 'Paid online' : o.payment === 'online' && o.paymentStatus === 'refund_pending' ? 'Refund processing' : o.payment === 'online' && o.paymentStatus === 'refund_failed' ? 'Contact the store about your refund' : o.payment === 'online' ? 'Online payment pending' : 'Cash / UPI on delivery'}</p>
      {open && o.events && o.events.length > 0 && (
        <ul className="timeline">
          {o.events.map((e, i) => (
            <li key={i}><span>{e.action === 'failed' ? 'Delivery attempt missed' : e.action === 'customer_cancel' ? 'Cancelled by you' : e.action === 'edit_items' ? 'Order changed' : STATUS_LABEL[e.status]}{e.note && e.action !== 'customer_cancel' ? ` — ${e.note}` : ''}</span><small>{timeFmt(e.createdAt)}</small></li>
          ))}
        </ul>
      )}
      <div className="order-foot">
        <strong>{money(o.totals.total)}</strong>
        <button className="link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button>
        {!tracking && CUSTOMER_CANCELLABLE.includes(o.status) && <button className="btn btn-outline sm danger" onClick={onCancel}>Cancel</button>}
        {live || tracking ? (
          <a className="btn btn-outline sm" href={supportLink} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={15} /> Help</a>
        ) : (
          <button className="btn btn-outline sm" onClick={onShare}><WhatsAppIcon size={15} /> Share</button>
        )}
        {!tracking && <button className="btn btn-primary sm" onClick={onBuyAgain}>Buy again</button>}
      </div>
    </article>
  );
}

/** Track any order by ID + mobile number (works from any phone, e.g. from a WhatsApp link). */
function TrackOrder({ initialId, initialPhone, supportNumber }: { initialId: string; initialPhone: string; supportNumber: string }) {
  const [id, setId] = useState(initialId);
  const [phone, setPhone] = useState(initialPhone);
  const [result, setResult] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!!initialId);

  async function track(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/orders/track?id=${encodeURIComponent(id.trim())}&phone=${encodeURIComponent(phone.trim())}`, { cache: 'no-store' });
      const d = await readJson<{ order?: Order }>(r);
      if (!r.ok || !d.order) throw new Error(d.error || 'Order not found.');
      setResult(d.order);
    } catch (err) {
      setResult(null);
      setError(err instanceof TypeError ? 'Network problem. Please try again.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className="link track-open" onClick={() => setOpen(true)}><Search size={14} /> Track an order with its ID</button>;
  }
  return (
    <section className="track-card">
      <h2>Track an order</h2>
      <form className="track-form" onSubmit={track}>
        <label>Order ID<input value={id} placeholder="FT-1A2B3C4D" autoCapitalize="characters" onChange={(e) => setId(e.target.value.toUpperCase())} /></label>
        <label>Mobile number<input value={phone} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
        <button className="btn btn-primary" disabled={busy || !id.trim() || phone.length !== 10} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Track</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <OrderCard o={result} onShare={() => {}} onBuyAgain={() => {}} onCancel={() => {}} supportLink={whatsappLink(supportNumber, `Hi Farm’s Touch! About my order ${result.id}: `)} tracking />
      )}
    </section>
  );
}

function BillDetails({ totals, coupon, savings }: { totals: Totals; coupon: string; savings: number }) {
  return (
    <div className="bill">
      <h4>Bill details</h4>
      <div><span>Item total</span><span>{money(totals.subtotal)}</span></div>
      {totals.discount > 0 && <div className="good"><span>Coupon {coupon}</span><span>−{money(totals.discount)}</span></div>}
      <div><span>Delivery fee</span><span className={totals.delivery ? '' : 'good'}>{totals.delivery ? money(totals.delivery) : 'FREE'}</span></div>
      <div className="bill-total"><strong>To pay</strong><strong key={totals.total}>{money(totals.total)}</strong></div>
      {savings + totals.discount > 0 && (
        <p className="savings-note"><BadgePercent size={16} /> You save {money(savings + totals.discount)} on this order</p>
      )}
    </div>
  );
}

function DeliveryProgress({ subtotal }: { subtotal: number }) {
  const pct = Math.min(100, Math.round((subtotal / FREE_DELIVERY_MIN) * 100));
  const free = subtotal >= FREE_DELIVERY_MIN;
  return (
    <div className={'delivery-progress' + (free ? ' done' : '')}>
      <div className="dp-row">
        <Truck size={18} />
        <span>{free ? <>Yay! You get <b>FREE delivery</b></> : <>Add <b>{money(FREE_DELIVERY_MIN - subtotal)}</b> more for FREE delivery</>}</span>
      </div>
      <div className="dp-track"><i style={{ width: pct + '%' }} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- saved draft

type Draft = { cart: Line[]; coupon: string; address: Address; slot: string; replacement: 'ask' | 'omit' };
const EMPTY_DRAFT: Draft = { cart: [], coupon: '', address: EMPTY_ADDRESS, slot: '', replacement: 'ask' };

function readDraft(cat: Catalog): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const d = JSON.parse(raw) as Partial<Record<keyof Draft, unknown>>;
    const cart = Array.isArray(d.cart) ? d.cart.filter((l): l is Line => isValidLine(l, cat)) : [];
    const coupon = typeof d.coupon === 'string' && cat.priceCart(cart, d.coupon).discount > 0 ? d.coupon : '';
    const a = d.address && typeof d.address === 'object' ? (d.address as Partial<Address>) : {};
    const address: Address = {
      name: typeof a.name === 'string' ? a.name : '',
      phone: typeof a.phone === 'string' ? a.phone : '',
      street: typeof a.street === 'string' ? a.street : '',
      pin: typeof a.pin === 'string' ? a.pin : '',
    };
    return {
      cart,
      coupon,
      address,
      slot: typeof d.slot === 'string' ? d.slot : '',
      replacement: d.replacement === 'omit' ? 'omit' : 'ask',
    };
  } catch {
    return EMPTY_DRAFT; // storage blocked or corrupted
  }
}

const noopSubscribe = () => () => {};

/**
 * Renders the shop with an empty cart on the server, then re-mounts it on the
 * client with the saved draft. (Fix: the old code wrote an empty cart to
 * storage before restoring it, so the draft could be lost.)
 */
export default function Shop(props: { userName: string | null; whatsappNumber?: string; products: Product[]; store: StoreInfo }) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const cat = useMemo(() => createCatalog(props.products, props.store.coupons), [props.products, props.store.coupons]);
  const draft = useMemo(() => (isClient ? readDraft(cat) : EMPTY_DRAFT), [isClient, cat]);
  return <ShopApp key={isClient ? 'client' : 'server'} userName={props.userName} whatsappNumber={props.whatsappNumber} cat={cat} store={props.store} draft={draft} hydrated={isClient} />;
}

// ---------------------------------------------------------------- main component

function ShopApp({ userName, whatsappNumber = '', cat: initialCatalog, store, draft, hydrated }: { userName: string | null; whatsappNumber?: string; cat: Catalog; store: StoreInfo; draft: Draft; hydrated: boolean }) {
  const isMobile = useIsMobile();
  // Live catalogue: starts with server-rendered data and refreshes from the API (prices, stock, coupons change in /admin).
  const [liveProducts, setLiveProducts] = useState<Product[] | null>(null);
  const [liveCoupons, setLiveCoupons] = useState<Coupon[] | null>(null);
  const [pincodes, setPincodes] = useState<string[] | null>(store.pincodes);
  const cat = useMemo(
    () => (liveProducts || liveCoupons ? createCatalog(liveProducts ?? initialCatalog.products, liveCoupons ?? initialCatalog.coupons) : initialCatalog),
    [liveProducts, liveCoupons, initialCatalog],
  );

  // navigation / browsing
  // Opened from a WhatsApp tracking link (…/?track=FT-XXXXXXXX)?
  const [trackId] = useState(() => {
    if (!hydrated || typeof window === 'undefined') return '';
    const t = (new URLSearchParams(window.location.search).get('track') ?? '').toUpperCase();
    return /^FT-[A-Z0-9]{8}$/.test(t) ? t : '';
  });
  const [view, setView] = useState<View>(trackId ? 'account' : 'home');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [sort, setSort] = useState('featured');
  const [product, setProduct] = useState<Product | null>(null);

  // cart & checkout (persisted draft)
  const [cart, setCartState] = useState<Line[]>(draft.cart);
  const [coupon, setCoupon] = useState(draft.coupon);
  const couponRef = useRef(coupon); // read by the catalog refresh callback
  useEffect(() => { couponRef.current = coupon; }, [coupon]);
  const [code, setCode] = useState('');
  const [address, setAddress] = useState<Address>(draft.address);
  const [slot, setSlot] = useState(draft.slot);
  const [payment, setPayment] = useState<'cod' | 'online'>('cod');
  const [replacement, setReplacement] = useState<'ask' | 'omit'>(draft.replacement);
  const [whatsappUpdates, setWhatsappUpdates] = useState(true);
  const [whatsappOffers, setWhatsappOffers] = useState(false);
  const [slots, setSlots] = useState<Slot[]>(store.slots);

  // overlays
  const [cartOpen, setCartOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState<Address>(EMPTY_ADDRESS);
  const [addressFormError, setAddressFormError] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);

  // basket builder
  const [basket, setBasket] = useState<string>('family');
  const [components, setComponents] = useState<string[]>(() => cat.defaultBasket('family'));
  const [basketOpen, setBasketOpen] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  // orders
  const [orders, setOrders] = useState<Order[] | null>(null); // null = not loaded yet
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<Order | null>(null);
  /** Whether the “order placed” WhatsApp reached the customer automatically. */
  const [successWa, setSuccessWa] = useState<string | undefined>(undefined);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const requestKey = useRef('');

  const totals = useMemo(() => cat.priceCart(cart, coupon), [cart, coupon, cat]);
  const savings = useMemo(() => cat.mrpSavings(cart), [cart, cat]);
  /** Items in the cart that are now unavailable or short (stock is live). */
  const stockIssues = useMemo(() => {
    const out: string[] = [];
    for (const [id, need] of Object.entries(packsNeeded(cart))) {
      const p = cat.find(id);
      if (!p || !p.active || p.stock <= 0) out.push(`${p?.name ?? 'An item'} is out of stock`);
      else if (need > p.stock) out.push(`Only ${p.stock} packs of ${p.name} left (you have ${need})`);
    }
    return out;
  }, [cart, cat]);
  const count = cart.reduce((n, l) => n + l.qty, 0);
  const qtyOf = (id: string) => cart.find((l) => l.id === id)?.qty ?? 0;
  // A stale saved slot, or one that has since filled up, simply counts as "not chosen".
  const currentSlot = slots.find((s) => s.id === slot && !s.full);
  const addressReady = !addressError(address, pincodes);

  // ---- refresh live prices, stock, coupons, delivery days and area from the server
  const applyCatalog = useCallback((d: CatalogResponse) => {
    if (Array.isArray(d.slots)) setSlots(d.slots);
    if (Array.isArray(d.products)) setLiveProducts(d.products);
    if (Array.isArray(d.coupons)) {
      setLiveCoupons(d.coupons);
      // A coupon that was switched off or expired since it was applied is removed.
      const applied = couponRef.current;
      if (applied && !d.coupons.some((c) => c.code === applied)) {
        setCoupon('');
        toast.info(`${applied} is no longer available and was removed.`);
      }
    }
    if (d.pincodes !== undefined) setPincodes(d.pincodes);
  }, []);
  const refreshCatalog = useCallback(
    () => fetchCatalog().then((d) => { if (d) applyCatalog(d); }),
    [applyCatalog],
  );
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    fetchCatalog().then((d) => {
      if (!alive) return;
      if (d) applyCatalog(d);
      else toast.error('Prices and delivery slots could not refresh. Please check your connection.', { id: 'catalog' });
    });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void fetchCatalog().then((d) => { if (alive && d) applyCatalog(d); }); }, 120_000);
    return () => { alive = false; clearInterval(timer); };
  }, [hydrated, applyCatalog]);

  // ---- persist draft
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, coupon, address, slot, replacement }));
    } catch { /* private mode / quota – ignore */ }
  }, [hydrated, cart, coupon, address, slot, replacement]);

  // ---- a changed order must get a fresh idempotency key
  useEffect(() => { requestKey.current = ''; }, [cart, coupon, address, slot, payment, replacement, whatsappUpdates, whatsappOffers]);

  /**
   * Every cart change goes through here so an applied coupon that is no longer
   * eligible is removed straight away. (Fix: previously the coupon stayed
   * applied and the server rejected the whole order at checkout.)
   */
  function setCart(next: Line[]) {
    setCartState(next);
    if (coupon && cat.priceCart(next, coupon).discount === 0) {
      const min = cat.findCoupon(coupon)?.min ?? 0;
      setCoupon('');
      if (next.length) toast.info(`${coupon} removed — item total is now below ${money(min)}.`);
    }
  }

  // ---- navigation
  const nav = useCallback((v: View, keepQuery = false) => {
    setView(v);
    if (!keepQuery) setQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  function onSearch(value: string) {
    setQuery(value);
    if (view !== 'shop') {
      setCategory('All'); // fix: a previously chosen category hid search results
      setView('shop');
    }
  }

  // ---- cart actions
  function add(id: string) {
    const p = cat.find(id);
    if (!p) return;
    const current = qtyOf(id);
    if (current >= MAX_QTY) {
      toast.error(`Maximum ${MAX_QTY} packs per item.`);
      return;
    }
    if ((packsNeeded(cart)[id] ?? 0) >= p.stock) {
      toast.error(p.stock > 0 ? `Only ${p.stock} packs of ${p.name} are left.` : `${p.name} is out of stock.`);
      return;
    }
    setCart(current ? cart.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l)) : [...cart, { id, qty: 1 }]);
    if (current === 0) toast.success(`${p.name} added to cart`, { duration: 1500 });
  }

  function changeQty(id: string, delta: number) {
    if (delta > 0) {
      const line = cart.find((l) => l.id === id);
      const next = packsNeeded(cart.map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l)));
      const short = Object.keys(packsNeeded(line ? [line] : [{ id, qty: 1 }])).map((pid) => cat.find(pid)).find((p) => !p || next[p.id] > p.stock);
      if (short !== undefined) {
        toast.error(short ? `Only ${short.stock} packs of ${short.name} are left.` : 'This item is no longer available.');
        return;
      }
    }
    setCart(cart.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, l.qty + delta) } : l)).filter((l) => l.qty > 0));
  }

  function removeLine(id: string) {
    setCart(cart.filter((l) => l.id !== id));
  }

  function applyCoupon(value: string) {
    const v = value.trim().toUpperCase();
    const c = cat.findCoupon(v);
    if (!c) { toast.error('This coupon is not valid or has expired.'); return false; }
    if (totals.subtotal < c.min) { toast.error(`Add ${money(c.min - totals.subtotal)} more to use ${v}.`); return false; }
    setCoupon(v);
    setCode('');
    // First-order / once-per-customer limits are checked by the server when the order is placed.
    const terms = couponTerms(c);
    toast.success(`${v} applied — you save ${money(c.amount)}`, terms ? { description: terms } : undefined);
    return true;
  }


  // ---- baskets
  function openBasket(typeId: string, existing?: string[]) {
    setBasket(typeId);
    setComponents(existing && existing.length ? [...existing] : cat.defaultBasket(typeId));
    setBasketOpen(true);
  }

  function switchBasketType(typeId: string) {
    const type = basketTypes.find((b) => b.id === typeId);
    if (!type) return;
    setBasket(typeId);
    // keep the user's swaps where possible instead of resetting everything
    setComponents((c) => (c.length === type.items ? c : cat.defaultBasket(typeId)));
  }

  function saveBasket() {
    const id = BASKET_PREFIX + basket;
    const existing = cart.find((l) => l.id === id);
    const line = { id, qty: existing?.qty ?? 1, components: [...components] };
    setCart(existing ? cart.map((l) => (l.id === id ? line : l)) : [...cart, line]);
    setBasketOpen(false);
    toast.success('Basket added to cart');
  }

  // ---- address
  function openAddress() {
    setAddressDraft(address);
    setAddressFormError('');
    setAddressOpen(true);
  }

  function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = { name: addressDraft.name.trim(), phone: addressDraft.phone.trim(), street: addressDraft.street.trim(), pin: addressDraft.pin.trim() };
    const err = addressError(trimmed, pincodes);
    if (err) { setAddressFormError(err); return; }
    setAddress(trimmed);
    setAddressOpen(false);
    toast.success('Address saved');
  }

  // ---- orders
  const applyOrdersResult = useCallback((res: OrdersResult) => {
    if (res.orders) { setOrders(res.orders); setOrderError(''); }
    else setOrderError(res.error ?? 'Orders could not be loaded.');
    setOrdersLoading(false);
  }, []);

  const loadOrders = useCallback(() => fetchOrders().then(applyOrdersResult), [applyOrdersResult]);

  function refreshOrders() {
    setOrdersLoading(true);
    setOrderError('');
    void loadOrders();
  }

  // Load order history when signed in; while the account page is open, keep
  // live order status fresh (packing → out for delivery → delivered).
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    const load = () => fetchOrders().then((res) => { if (alive) applyOrdersResult(res); });
    void load();
    const timer = view === 'account' ? setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000) : undefined;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [hydrated, applyOrdersResult, view]);

  async function placeOrder() {
    if (busy) return;
    if (!addressReady) { openAddress(); return; }
    if (!currentSlot) { setSlotOpen(true); return; }
    setBusy(true);
    if (!requestKey.current) requestKey.current = newRequestKey();
    try {
      if (payment === 'online') {
        const start = await fetch('/api/payments/razorpay/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: cart, coupon, slot, address, payment, replacement, whatsappUpdates, whatsappOffers, requestKey: requestKey.current }),
        });
        const checkout = await readJson<{
          keyId?: string;
          razorpayOrderId?: string;
          amount?: number;
          currency?: string;
          expiresAt?: string;
          order?: Order;
          whatsapp?: string;
        }>(start);
        if (!start.ok) {
          if (start.status === 409) requestKey.current = '';
          throw new Error(checkout.error || 'Could not start online payment. Please try again.');
        }
        if (checkout.order) {
          setSuccessWa(checkout.whatsapp);
          setSuccess(checkout.order);
          setCartState([]); setCoupon(''); setSlot(''); void loadOrders(); requestKey.current = '';
          return;
        }
        if (!checkout.keyId || !checkout.razorpayOrderId || !checkout.amount || !checkout.currency) throw new Error('Payment checkout response was incomplete. Please try again.');
        await loadRazorpayCheckout();
        if (!window.Razorpay) throw new Error('Secure payment checkout is unavailable. Please try again.');
        // Close the payment window before the server's stock hold runs out (2-minute safety margin).
        const holdLeft = checkout.expiresAt ? Math.floor((Date.parse(checkout.expiresAt) - Date.now()) / 1000) - 120 : 1680;
        if (!(holdLeft >= 60)) {
          requestKey.current = '';
          throw new Error('This payment session has expired. Please tap “Place order” again.');
        }
        let verificationStarted = false;
        const gateway = new window.Razorpay({
          key: checkout.keyId,
          amount: checkout.amount,
          currency: checkout.currency,
          timeout: Math.min(1800, holdLeft),
          name: 'Farm’s Touch',
          description: 'Fresh grocery order',
          order_id: checkout.razorpayOrderId,
          prefill: { name: address.name, contact: '+91' + address.phone },
          theme: { color: '#287047' },
          handler: (response) => {
            verificationStarted = true;
            void (async () => {
              try {
                const verifiedResponse = await fetch('/api/payments/razorpay/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(response),
                });
                const verified = await readJson<{ order?: Order; whatsapp?: string }>(verifiedResponse);
                if (!verifiedResponse.ok || !verified.order) throw new Error(verified.error || 'Payment is still being verified. Check your order history before paying again.');
                setSuccessWa(verified.whatsapp);
                setSuccess(verified.order);
                setCartState([]); setCoupon(''); setSlot(''); void loadOrders(); requestKey.current = '';
              } catch (error) {
                toast.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            })();
          },
          modal: { ondismiss: () => { if (!verificationStarted) setBusy(false); } },
        });
        gateway.on('payment.failed', (response) => {
          toast.error(response.error?.description || 'Payment failed. Your cart is saved; you can retry.');
        });
        gateway.open();
        return;
      }
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: cart, coupon, slot, address, payment, replacement, whatsappUpdates, whatsappOffers, requestKey: requestKey.current }),
      });
      const d = await readJson<{ order?: Order; whatsapp?: string }>(r);
      if (r.status === 409 || r.status === 400) void refreshCatalog(); // stock/price may have changed
      if (!r.ok || !d.order) throw new Error(d.error || 'Could not place your order. Please try again.');
      setSuccessWa(d.whatsapp);
      setSuccess(d.order);
      setCartState([]);
      setCoupon('');
      setSlot('');
      void loadOrders();
      requestKey.current = '';
    } catch (e) {
      toast.error(e instanceof TypeError ? 'Network problem — your cart is saved. Please try again.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!cancelId || cancelling) return;
    setCancelling(true);
    try {
      const r = await fetch('/api/orders/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cancelId }) });
      const d = await readJson<{ order?: Order }>(r);
      if (!r.ok) throw new Error(d.error || 'Could not cancel this order.');
      toast.success('Order cancelled');
      setCancelId(null);
      void loadOrders();
      void refreshCatalog(); // items are back in stock
    } catch (e) {
      toast.error(e instanceof TypeError ? 'Network problem. Please try again.' : (e as Error).message);
      void loadOrders();
    } finally {
      setCancelling(false);
    }
  }

  function buyAgain(o: Order) {
    const valid = o.lines.filter((l): l is Line => isValidLine(l, cat) && Object.keys(packsNeeded([l])).every((id) => cat.isBuyable(id)));
    if (!valid.length) { toast.error('These items are no longer available.'); return; }
    const next = [...cart];
    for (const l of valid) {
      const i = next.findIndex((x) => x.id === l.id);
      if (i === -1) next.push({ ...l });
      else next[i] = { ...next[i], qty: Math.min(MAX_QTY, next[i].qty + l.qty), components: l.components ?? next[i].components };
    }
    setCart(next);
    setCartOpen(true);
    toast.success(valid.length < o.lines.length ? 'Available items added at today’s prices' : 'Items added at today’s prices');
  }

  // ---- WhatsApp
  const waSupport = whatsappLink(whatsappNumber, SUPPORT_MESSAGE);
  function orderOnWhatsApp() {
    if (!cart.length) return;
    const msg = buildOrderMessage({ items: snapshotItems(cart, cat), totals, coupon, slotLabel: currentSlot?.label, replacement, address: addressReady ? address : null });
    openWhatsApp(whatsappLink(whatsappNumber, msg));
  }
  function shareOrderOnWhatsApp(o: Order) {
    const msg = buildOrderMessage({ items: o.items, totals: o.totals, coupon: o.coupon, orderId: o.id, slotLabel: o.slotLabel, replacement: o.replacement, address: o.address });
    openWhatsApp(whatsappLink(whatsappNumber, msg));
  }

  // ---- WebMCP tool (feature-detected); reads the latest catalogue through a ref
  const catRef = useRef(cat);
  useEffect(() => { catRef.current = cat; }, [cat]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: unknown) => unknown } }).modelContext;
    if (!context) return;
    const ac = new AbortController();
    try {
      context.registerTool({
        name: 'search_farmtouch_products',
        title: 'Search groceries',
        description: 'Search the grocery catalogue and show matching products.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          const q = (input as { query?: unknown }).query;
          if (typeof q !== 'string' || q.length > 100) throw new Error('Query must be a string under 100 characters');
          setQuery(q); setCategory('All'); setView('shop');
          return { products: catRef.current.search(q).map((p) => ({ id: p.id, name: p.name, price: p.price, unit: p.unit })) };
        },
      }, { signal: ac.signal });
    } catch { /* unsupported */ }
    return () => ac.abort();
  }, []);

  // ---- derived catalogue
  let filtered = cat.search(query).filter((p) => category === 'All' || p.category === category);
  if (sort === 'low') filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sort === 'high') filtered = [...filtered].sort((a, b) => b.price - a.price);
  if (sort === 'discount') filtered = [...filtered].sort((a, b) => discountPercent(b) - discountPercent(a));

  const card = (p: Product) => (
    <ProductCard key={p.id} p={p} qty={qtyOf(p.id)} onAdd={() => add(p.id)} onChange={(d) => changeQty(p.id, d)} onOpen={() => setProduct(p)} />
  );

  const basketType = basketTypes.find((b) => b.id === basket) ?? basketTypes[1];
  const area = address.pin ? `${address.street.split(',').slice(-1)[0]?.trim() || 'Pune'} ${address.pin}` : 'Select delivery address';
  const recentOrder = orders?.[0];

  const navItems: { v: View; label: string; Icon: typeof House }[] = [
    { v: 'home', label: 'Home', Icon: House },
    { v: 'shop', label: 'Shop', Icon: LayoutGrid },
    { v: 'baskets', label: 'Baskets', Icon: ShoppingBasket },
    { v: 'offers', label: 'Offers', Icon: Tag },
    { v: 'account', label: 'Account', Icon: UserRound },
  ];

  // ================================================================ render
  return (
    <>
      <Toaster position="top-center" richColors closeButton />

      {/* ---------------------------------------------------------- header */}
      <header className="site-header">
        <div className="header-inner">
          <button className="brand" onClick={() => nav('home')} aria-label="Farm’s Touch home">
            <img src="/logo.jpg" alt="" width={44} height={44} />
            <span className="brand-text"><strong>Farm’s Touch</strong><small>HAR DIN TAZA</small></span>
          </button>

          <button className="eta" onClick={openAddress}>
            <span className="eta-title"><Zap size={15} /> Delivery {currentSlot ? currentSlot.label.split(' · ')[0] : 'tomorrow'}, 9–12 AM</span>
            <span className="eta-address"><MapPin size={13} /> <span>{area}</span> <ChevronDown size={14} /></span>
          </button>

          <label className="search">
            <Search size={18} />
            <input
              type="search"
              aria-label="Search groceries"
              value={query}
              placeholder="Search “tomato”, “kanda”, “palak”…"
              onChange={(e) => onSearch(e.target.value)}
            />
            {query && <button className="clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
          </label>

          <button className="header-link" onClick={() => nav('account')}>
            <UserRound size={20} /> <span>My orders</span>
          </button>

          <button className="header-cart" onClick={() => setCartOpen(true)} aria-label={`Cart, ${count} items`}>
            <ShoppingBag size={20} />
            {count ? <span><b>{count} item{count > 1 ? 's' : ''}</b><small>{money(totals.total)}</small></span> : <span><b>My cart</b></span>}
          </button>
        </div>
        <nav className="desktop-nav" aria-label="Sections">
          {navItems.slice(0, 4).map(({ v, label }) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => nav(v)}>{label}</button>
          ))}
          <button className={view === 'account' ? 'active' : ''} onClick={() => nav('account')}>My orders</button>
          <a className="nav-wa" href={waSupport} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={16} /> Chat on WhatsApp</a>
        </nav>
      </header>

      {/* ---------------------------------------------------------- main */}
      <main className={'main view-' + view}>
        {hydrated && cat.visible.length === 0 && (
          <div className="stock-warning" role="status"><Info size={18} /><div><strong>Our shelves are being restocked</strong><span>Please check back in a little while, or message us on WhatsApp.</span></div></div>
        )}
        {/* HOME */}
        {view === 'home' && (
          <div className="fade-in">
            <section className="banners" aria-label="Highlights">
              <div className="banner banner-hero">
                <div className="banner-copy">
                  <span className="kicker">Picked this morning in Pune</span>
                  <h1>Farm-fresh veggies<br />at your door by 12.</h1>
                  <p>Mandi prices. No minimum order. Pay cash on delivery.</p>
                  <div className="banner-actions">
                    <button className="btn btn-white" onClick={() => nav('shop')}>Shop now <ChevronRight size={16} /></button>
                    <button className="btn btn-ghost" onClick={() => nav('baskets')}>Build a basket</button>
                  </div>
                </div>
                <div className="banner-art"><Photo name="basket" alt="" /></div>
              </div>
              <div className="banner banner-coupon">
                <span className="kicker">Use code FRESH50</span>
                <h2>₹50 OFF<br />on ₹499+</h2>
                <button className="btn btn-dark sm" onClick={() => nav('offers')}>View offers</button>
                <Photo name="tomato" alt="" className="banner-img" />
              </div>
              <a className="banner banner-wa" href={waSupport} target="_blank" rel="noopener noreferrer">
                <span className="kicker">New</span>
                <h2>Order on<br />WhatsApp</h2>
                <span className="btn btn-white sm">Chat now</span>
                <WhatsAppIcon size={64} className="banner-wa-icon" />
              </a>
            </section>

            <section className="trust-strip" aria-label="Why Farm’s Touch">
              <span><Sprout size={18} /> Farm fresh daily</span>
              <span><Truck size={18} /> Free delivery over {money(FREE_DELIVERY_MIN)}</span>
              <span><Banknote size={18} /> Cash on delivery</span>
              <span><RotateCcw size={18} /> No-questions replacement</span>
            </section>

            <section>
              <div className="section-head"><h2>Shop by category</h2></div>
              <div className="category-tiles">
                {[
                  { name: 'Vegetables', image: 'tomato', tint: 't1' },
                  { name: 'Fruits', image: 'apple', tint: 't2' },
                  { name: 'Greens', image: 'spinach', tint: 't3' },
                  { name: 'Baskets', image: 'basket', tint: 't4' },
                  { name: 'All items', image: 'basket', tint: 't5' },
                  { name: 'Offers', image: 'banana', tint: 't6' },
                ].map((c) => (
                  <button
                    key={c.name}
                    className={'cat-tile ' + c.tint}
                    onClick={() => {
                      if (c.name === 'Baskets') nav('baskets');
                      else if (c.name === 'Offers') nav('offers');
                      else { setCategory(c.name === 'All items' ? 'All' : c.name); nav('shop'); }
                    }}
                  >
                    <span className={'cat-img' + (c.name === 'Offers' ? ' has-offer-badge' : '')}>
                      <Photo name={c.image} alt="" />
                      {c.name === 'Offers' && <span className="cat-offer-badge" aria-hidden="true"><BadgePercent size={20} /></span>}
                    </span>
                    <span className="cat-name">{c.name}</span>
                  </button>
                ))}
              </div>
            </section>

            {recentOrder && (
              <section className="reorder">
                <RefreshCw size={22} />
                <div><h3>Order again</h3><p>{recentOrder.lines.length} items from {new Date(recentOrder.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p></div>
                <button className="btn btn-primary sm" onClick={() => buyAgain(recentOrder)}>Add all to cart</button>
              </section>
            )}

            <section>
              <div className="section-head"><h2>Today’s fresh deals</h2><button onClick={() => nav('shop')}>See all <ChevronRight size={15} /></button></div>
              <div className="product-rail">{[...cat.visible].sort((a, b) => discountPercent(b) - discountPercent(a)).slice(0, 6).map(card)}</div>
            </section>

            <section>
              <div className="section-head"><h2>Weekly baskets</h2><button onClick={() => nav('baskets')}>See all <ChevronRight size={15} /></button></div>
              <div className="basket-row">
                {basketTypes.map((b, i) => (
                  <article key={b.id} className={'basket-tile bt' + i}>
                    <div>
                      <span className="pill">{b.people}</span>
                      <h3>{b.name}</h3>
                      <p>{b.items} items{b.multiplier > 1 ? ` · ${b.multiplier}× packs` : ''} · you choose</p>
                      <strong>{money(cat.basketPrice(b.id, cat.defaultBasket(b.id)))}</strong>
                      <button className="btn btn-primary sm" onClick={() => openBasket(b.id)}>Customise</button>
                    </div>
                    <Photo name="basket" alt="" />
                  </article>
                ))}
              </div>
            </section>

            <section className="wa-band">
              <span className="wa-band-icon"><WhatsAppIcon size={30} /></span>
              <div><h3>Too busy to browse?</h3><p>Send us your list on WhatsApp — we’ll pack it and confirm the total.</p></div>
              <a className="btn btn-wa" href={waSupport} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={18} /> Send my list</a>
            </section>
          </div>
        )}

        {/* SHOP */}
        {view === 'shop' && (
          <div className="fade-in shop-layout">
            <aside className="cat-rail" aria-label="Categories">
              {['All', ...categories].map((c) => (
                <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                  <span className="rail-img"><Photo name={c === 'All' ? 'basket' : c === 'Fruits' ? 'apple' : c === 'Greens' ? 'spinach' : 'tomato'} alt="" /></span>
                  <span>{c === 'All' ? 'All items' : c}</span>
                </button>
              ))}
            </aside>
            <div>
              <div className="shop-head">
                <div>
                  <h1>{query ? `Results for “${query}”` : category === 'All' ? 'All fresh produce' : category}</h1>
                  <p>{filtered.length} item{filtered.length === 1 ? '' : 's'} · Search in English, Hindi or Marathi</p>
                </div>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="sort-select" aria-label="Sort products"><SlidersHorizontal size={15} /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="featured">Relevance</SelectItem>
                    <SelectItem value="discount">Biggest discount</SelectItem>
                    <SelectItem value="low">Price: low to high</SelectItem>
                    <SelectItem value="high">Price: high to low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {filtered.length ? (
                <div className="product-grid">{filtered.map(card)}</div>
              ) : (
                <div className="empty">
                  <Search size={36} />
                  <h2>No match for “{query}”</h2>
                  <p>Try “onion”, “kanda” or “pyaz” — or ask us on WhatsApp.</p>
                  <div className="empty-actions">
                    <button className="btn btn-primary" onClick={() => { setQuery(''); setCategory('All'); }}>Clear search</button>
                    <a className="btn btn-outline" href={whatsappLink(whatsappNumber, `Hi! Do you have ${query}?`)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={16} /> Ask on WhatsApp</a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BASKETS */}
        {view === 'baskets' && (
          <div className="fade-in">
            <div className="page-head">
              <span className="kicker dark">Less planning, more cooking</span>
              <h1>Weekly baskets</h1>
              <p>Start with a ready basket, swap anything you don’t need, and the price updates instantly.</p>
            </div>
            <div className="basket-cards">
              {basketTypes.map((b, i) => (
                <article key={b.id} className={'basket-card bt' + i}>
                  <Photo name="basket" alt="" />
                  <span className="pill">{b.people}</span>
                  <h2>{b.name}</h2>
                  <ul>
                    <li><Check size={15} /> {b.items} items of your choice</li>
                    <li><Check size={15} /> {b.multiplier > 1 ? `${b.multiplier}× pack size of each item` : 'Standard pack sizes'}</li>
                    <li><Check size={15} /> One-time purchase, no subscription</li>
                  </ul>
                  <div className="basket-card-foot">
                    <strong>{money(cat.basketPrice(b.id, cat.defaultBasket(b.id)))}</strong>
                    <button className="btn btn-primary" onClick={() => openBasket(b.id)}>Choose & customise</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* OFFERS */}
        {view === 'offers' && (
          <div className="fade-in">
            <div className="page-head">
              <span className="kicker dark">More fresh, less spend</span>
              <h1>Offers & savings</h1>
              <p>Simple offers with clear minimums. One coupon per order.</p>
            </div>
            <div className="coupon-grid">
              {cat.coupons.length === 0 && <p>No offers right now. Check back soon!</p>}
              {cat.coupons.map((o, i) => {
                const short = Math.max(0, o.min - totals.subtotal);
                const terms = couponTerms(o);
                return (
                  <article key={o.code} className={'coupon c' + i}>
                    <div className="coupon-left"><span>{money(o.amount)}</span><small>OFF</small></div>
                    <div className="coupon-right">
                      <h3>{o.title}</h3>
                      <p>{o.min > 0 ? `On item total of ${money(o.min)} or more` : 'On any order'}</p>
                      {terms && <small>{terms}</small>}
                      <div className="coupon-code">
                        <code>{o.code}</code>
                        {coupon === o.code ? (
                          <span className="applied"><Check size={15} /> Applied</span>
                        ) : (
                          <button onClick={() => { if (applyCoupon(o.code)) setCartOpen(true); }}>Apply</button>
                        )}
                      </div>
                      {short > 0 && <small>Add {money(short)} more to unlock</small>}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="section-head"><h2>Best discounts today</h2></div>
            <div className="product-grid">{[...cat.visible].sort((a, b) => discountPercent(b) - discountPercent(a)).map(card)}</div>
          </div>
        )}

        {/* ACCOUNT */}
        {view === 'account' && (
          <div className="fade-in narrow">
            <div className="page-head">
              <h1>{userName ? 'Hi, ' + userName.split(/[ @]/)[0] : address.name ? 'Hi, ' + address.name.split(' ')[0] : 'My orders'}</h1>
              <p>Orders placed from this phone, your address and help. No login needed.</p>
            </div>
            {(
              <>
                <TrackOrder initialId={trackId} initialPhone={address.phone} supportNumber={whatsappNumber} />
                <div className="account-cards">
                  <button className="account-card" onClick={openAddress}>
                    <MapPin size={20} />
                    <div><strong>Delivery address</strong><small>{addressReady ? `${address.name} · ${address.street}, ${address.pin}` : 'Not added yet'}</small></div>
                    <Pencil size={16} />
                  </button>
                  <a className="account-card" href={waSupport} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon size={20} className="wa-color" />
                    <div><strong>Help & support</strong><small>Chat with us on WhatsApp</small></div>
                    <ChevronRight size={16} />
                  </a>
                </div>
                <div className="section-head"><h2>Order history</h2><button onClick={refreshOrders}><RefreshCw size={14} /> Refresh</button></div>
                {(ordersLoading || orders === null) && !orderError && !orders?.length ? (
                  <div className="empty"><LoaderCircle className="spin" /><p>Loading your orders…</p></div>
                ) : orderError ? (
                  <div className="empty"><p>{orderError}</p><button className="btn btn-outline" onClick={refreshOrders}>Try again</button></div>
                ) : orders?.length ? (
                  <div className="orders">
                    {orders.map((o) => (
                      <OrderCard
                        key={o.id}
                        o={o}
                        onShare={() => shareOrderOnWhatsApp(o)}
                        onBuyAgain={() => buyAgain(o)}
                        onCancel={() => setCancelId(o.id)}
                        supportLink={whatsappLink(whatsappNumber, `Hi Farm’s Touch! About my order ${o.id}: `)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty"><ShoppingBag size={40} /><h2>No orders yet</h2><p>Your first fresh basket is a tap away.</p><button className="btn btn-primary" onClick={() => nav('home')}>Start shopping</button></div>
                )}
              </>
            )}
          </div>
        )}

        {/* CHECKOUT */}
        {view === 'checkout' && (
          <div className="fade-in">
            <button className="back" onClick={() => { nav('home'); setCartOpen(true); }}><ArrowLeft size={18} /> Back to cart</button>
            <div className="page-head"><h1>Checkout</h1></div>
            {!cart.length ? (
              <div className="empty"><ShoppingBag size={40} /><h2>Your cart is empty</h2><button className="btn btn-primary" onClick={() => nav('shop')}>Shop fresh</button></div>
            ) : (
              <div className="checkout-grid">
                <div className="checkout-steps">
                  <section className={'step-card' + (addressReady ? ' done' : '')}>
                    <h2><span className="step-no">{addressReady ? <Check size={14} /> : 1}</span> Delivery address</h2>
                    {addressReady ? (
                      <div className="saved-address"><strong>{address.name} · {address.phone}</strong><p>{address.street}, Pune {address.pin}</p></div>
                    ) : <p className="muted">Add where we should deliver.</p>}
                    <button className="btn btn-outline sm" onClick={openAddress}>{addressReady ? 'Change' : 'Add address'}</button>
                  </section>

                  <section className={'step-card' + (currentSlot ? ' done' : '')}>
                    <h2><span className="step-no">{currentSlot ? <Check size={14} /> : 2}</span> Delivery slot</h2>
                    <div className="slot-chips" role="radiogroup" aria-label="Delivery slot">
                      {slots.map((s) => {
                        const [day, time] = s.label.split(' · ');
                        const on = slot === s.id && !s.full;
                        return (
                          <button key={s.id} role="radio" aria-checked={on} disabled={s.full} className={on ? 'on' : ''} onClick={() => setSlot(s.id)}
                            aria-label={s.full ? `${s.label} (fully booked)` : undefined}>
                            <strong>{day}</strong><small>{s.full ? 'Fully booked' : time}</small>
                          </button>
                        );
                      })}
                      {slots.length === 0 && <p>No delivery days are open right now. Please check back soon or message us on WhatsApp.</p>}
                    </div>
                  </section>

                  <section className="step-card">
                    <h2><span className="step-no">3</span> Payment</h2>
                    <label className={'choice' + (payment === 'cod' ? ' on' : '')}><input type="radio" name="pay" checked={payment === 'cod'} onChange={() => setPayment('cod')} /><Banknote size={20} /><span><strong>Cash / UPI on delivery</strong><small>Pay when your order arrives</small></span></label>
                    <label className={'choice' + (payment === 'online' ? ' on' : '')}><input type="radio" name="pay" checked={payment === 'online'} onChange={() => setPayment('online')} /><CreditCard size={20} /><span><strong>Pay online</strong><small>UPI, cards and netbanking via Razorpay</small></span></label>
                  </section>

                  <section className="step-card">
                    <h2><span className="step-no">4</span> If an item is unavailable</h2>
                    <label className={'choice' + (replacement === 'ask' ? ' on' : '')}><input type="radio" name="rep" checked={replacement === 'ask'} onChange={() => setReplacement('ask')} /><span><strong>Call / WhatsApp me first</strong></span></label>
                    <label className={'choice' + (replacement === 'omit' ? ' on' : '')}><input type="radio" name="rep" checked={replacement === 'omit'} onChange={() => setReplacement('omit')} /><span><strong>Remove it and adjust the bill</strong></span></label>
                    <label className="wa-optin">
                      <input type="checkbox" checked={whatsappUpdates} onChange={(e) => setWhatsappUpdates(e.target.checked)} />
                      <WhatsAppIcon size={18} className="wa-color" />
                      <span>Send me order updates on WhatsApp <small>(confirmation, changes, delivery, payment)</small></span>
                    </label>
                    <label className="wa-optin">
                      <input type="checkbox" checked={whatsappOffers} onChange={(e) => setWhatsappOffers(e.target.checked)} />
                      <BadgePercent size={18} className="wa-color" />
                      <span>Send me offers & discounts on WhatsApp</span>
                    </label>
                  </section>
                </div>

                <aside className="checkout-summary">
                  <h2>Order summary</h2>
                  {stockIssues.length > 0 && (
                  <div className="stock-warning" role="alert"><Info size={18} /><div><strong>Please update your cart</strong>{stockIssues.map((m) => <span key={m}>{m}</span>)}</div></div>
                )}
                  {cart.map((l) => (
                    <div className="summary-line" key={l.id}>
                      <span>{cat.lineName(l)} × {l.qty}</span>
                      <strong>{money(cat.linePrice(l) * l.qty)}</strong>
                    </div>
                  ))}
                  <BillDetails totals={totals} coupon={coupon} savings={savings} />
                  <button className="btn btn-primary block lg" disabled={busy || stockIssues.length > 0} onClick={() => void placeOrder()}>
                    {busy ? <><LoaderCircle className="spin" size={18} /> {payment === 'online' ? 'Opening secure checkout…' : 'Placing order…'}</> : stockIssues.length ? 'Update your cart to continue' : !addressReady ? 'Add address to continue' : !currentSlot ? 'Choose a delivery slot' : payment === 'online' ? `Pay online · ${money(totals.total)}` : `Place order · ${money(totals.total)}`}
                  </button>
                  <button className="btn btn-wa block" onClick={orderOnWhatsApp}><WhatsAppIcon size={18} /> Or order on WhatsApp</button>
                  <small className="secure"><ShieldCheck size={14} /> Your cart is kept if anything fails.</small>
                </aside>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="brand"><img src="/logo.jpg" alt="" width={40} height={40} /><span className="brand-text"><strong>Farm’s Touch</strong><small>HAR DIN TAZA</small></span></div>
          <p>Fresh vegetables, fruits and weekly baskets for Pune kitchens.</p>
          <a href={waSupport} target="_blank" rel="noopener noreferrer" className="footer-wa"><WhatsAppIcon size={16} /> WhatsApp us</a>
        </div>
        <small className="footer-note">Sample catalogue & prices · © {new Date().getFullYear()} Farm’s Touch</small>
      </footer>

      {/* ---------------------------------------------------------- mobile chrome */}
      {view !== 'checkout' && (
        <>
          {count > 0 && (
            <button className="cart-bar" onClick={() => setCartOpen(true)}>
              <span className="cart-bar-thumbs">
                {cart.slice(0, 3).map((l) => <Photo key={l.id} name={cat.find(l.id)?.image ?? 'basket'} alt="" />)}
              </span>
              <span className="cart-bar-text"><b>{count} item{count > 1 ? 's' : ''} · {money(totals.total)}</b><small>{totals.subtotal >= FREE_DELIVERY_MIN ? 'FREE delivery unlocked' : `${money(FREE_DELIVERY_MIN - totals.subtotal)} to free delivery`}</small></span>
              <span className="cart-bar-cta">View cart <ChevronRight size={16} /></span>
            </button>
          )}
          <nav className="bottom-nav" aria-label="Main navigation">
            {navItems.map(({ v, label, Icon }) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => nav(v)} aria-current={view === v ? 'page' : undefined}>
                <Icon size={21} /><span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <a className={'wa-fab' + (count > 0 && view !== 'checkout' ? ' raised' : '')} href={waSupport} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp">
        <WhatsAppIcon size={28} />
      </a>

      {/* ---------------------------------------------------------- cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className={'cart-sheet' + (isMobile ? ' is-bottom' : '')}>
          <SheetTitle>My cart {count > 0 && <span className="count">{count}</span>}</SheetTitle>
          <SheetDescription className="sr-only">Items in your cart and bill details</SheetDescription>
          <div className="sheet-scroll">
            {!cart.length ? (
              <div className="empty">
                <ShoppingBag size={40} />
                <h2>Your cart is empty</h2>
                <p>Add something fresh to get started.</p>
                <button className="btn btn-primary" onClick={() => { setCartOpen(false); nav('shop'); }}>Browse products</button>
              </div>
            ) : (
              <>
                <DeliveryProgress subtotal={totals.subtotal} />
                {stockIssues.length > 0 && (
                  <div className="stock-warning" role="alert"><Info size={18} /><div><strong>Please update your cart</strong>{stockIssues.map((m) => <span key={m}>{m}</span>)}</div></div>
                )}
                <div className="cart-box">
                  {cart.map((l) => {
                    const p = cat.find(l.id);
                    const b = findBasketType(l.id);
                    return (
                      <div className="cart-line" key={l.id}>
                        <Photo name={p?.image ?? 'basket'} alt="" />
                        <div className="cart-line-info">
                          <h3>{p?.name ?? b?.name}</h3>
                          <small>{p ? p.unit : `${l.components?.length} items${b && b.multiplier > 1 ? ` · ${b.multiplier}× packs` : ''}`}</small>
                          {b && <button className="link" onClick={() => openBasket(b.id, l.components)}>Edit basket</button>}
                        </div>
                        <div className="cart-line-side">
                          <QtyControl size="sm" qty={l.qty} label={cat.lineName(l)} onAdd={() => changeQty(l.id, 1)} onChange={(d) => changeQty(l.id, d)} />
                          <strong>{money(cat.linePrice(l) * l.qty)}</strong>
                        </div>
                        <button className="icon-btn" aria-label={'Remove ' + cat.lineName(l)} onClick={() => removeLine(l.id)}><Trash2 size={15} /></button>
                      </div>
                    );
                  })}
                </div>

                {coupon ? (
                  <div className="coupon-applied"><CheckCircle2 size={18} /><span><b>{coupon}</b> applied · {money(totals.discount)} saved</span><button onClick={() => setCoupon('')}>Remove</button></div>
                ) : (
                  <form className="coupon-form" onSubmit={(e) => { e.preventDefault(); applyCoupon(code); }}>
                    <Tag size={18} />
                    <input aria-label="Coupon code" placeholder="Enter coupon code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
                    <button type="submit" disabled={!code.trim()}>Apply</button>
                  </form>
                )}
                {!coupon && (
                  <div className="coupon-suggest">
                    {cat.coupons.map((c) => (
                      <button key={c.code} onClick={() => applyCoupon(c.code)} disabled={totals.subtotal < c.min}>
                        <BadgePercent size={14} /> {c.code} · {money(c.amount)} off {totals.subtotal < c.min ? `(add ${money(c.min - totals.subtotal)})` : ''}
                      </button>
                    ))}
                  </div>
                )}

                <BillDetails totals={totals} coupon={coupon} savings={savings} />
                <div className="policy"><Leaf size={16} /><p>Not happy with an item? Tell us at delivery and we’ll replace or refund it.</p></div>
              </>
            )}
          </div>
          {cart.length > 0 && (
            <div className="sheet-foot">
              <button className="btn btn-primary block lg" onClick={() => { setCartOpen(false); nav('checkout'); }}>
                <span>{money(totals.total)}<small>TOTAL</small></span>
                <span>Proceed to checkout <ChevronRight size={18} /></span>
              </button>
              <button className="btn btn-wa block" onClick={orderOnWhatsApp}><WhatsAppIcon size={18} /> Order on WhatsApp instead</button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------------------------------------------------- basket builder */}
      <Sheet open={basketOpen} onOpenChange={setBasketOpen}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className={'cart-sheet basket-sheet' + (isMobile ? ' is-bottom' : '')}>
          <SheetTitle>Build your basket</SheetTitle>
          <SheetDescription>Tap “Swap” on any item. Price updates instantly.</SheetDescription>
          <div className="seg" role="tablist">
            {basketTypes.map((b) => (
              <button key={b.id} role="tab" aria-selected={basket === b.id} className={basket === b.id ? 'on' : ''} onClick={() => switchBasketType(b.id)}>
                {b.name.split(' ')[0]}<small>{b.people.replace('For ', '')}</small>
              </button>
            ))}
          </div>
          <div className="sheet-scroll">
            <div className="basket-head">
              <div>
                <h2>{basketType.name}</h2>
                <p>{components.length} items{basketType.multiplier > 1 ? ` · ${basketType.multiplier}× packs of each` : ''}</p>
              </div>
              <Photo name="basket" alt="" />
            </div>
            {components.map((id, i) => {
              const p = cat.find(id);
              if (!p) return null;
              return (
                <div className="basket-item" key={i + '-' + id}>
                  <Photo name={p.image} alt="" />
                  <div><strong>{p.name}</strong><small>{basketType.multiplier > 1 ? `${basketType.multiplier} × ` : ''}{p.unit} · {money(p.price * basketType.multiplier)}</small></div>
                  <button className="btn btn-outline sm" onClick={() => setReplaceIndex(i)}><RotateCcw size={13} /> Swap</button>
                </div>
              );
            })}
          </div>
          <div className="sheet-foot">
            <button className="btn btn-primary block lg" onClick={saveBasket}>
              <span>{money(cat.basketPrice(basket, components))}<small>BASKET</small></span>
              <span>{cart.some((l) => l.id === BASKET_PREFIX + basket) ? 'Update basket' : 'Add to cart'} <ChevronRight size={18} /></span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={replaceIndex !== null} onOpenChange={(v) => { if (!v) setReplaceIndex(null); }}>
        <DialogContent className="dialog replace-dialog">
          <DialogTitle>Swap with</DialogTitle>
          <DialogDescription>Pick any item. Your basket price updates.</DialogDescription>
          <div className="replace-grid">
            {cat.available.map((p) => (
              <button
                key={p.id}
                className={replaceIndex !== null && components[replaceIndex] === p.id ? 'on' : ''}
                onClick={() => { setComponents((c) => c.map((id, i) => (i === replaceIndex ? p.id : id))); setReplaceIndex(null); }}
              >
                <Photo name={p.image} alt="" /><strong>{p.name}</strong><small>{p.unit} · {money(p.price)}</small>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------- address */}
      <Dialog open={addressOpen} onOpenChange={setAddressOpen}>
        <DialogContent className="dialog">
          <DialogTitle>Delivery address</DialogTitle>
          <DialogDescription>We currently deliver across Pune (411xxx).</DialogDescription>
          <form className="address-form" onSubmit={saveAddress} noValidate>
            <label>Full name<input required autoComplete="name" value={addressDraft.name} onChange={(e) => setAddressDraft({ ...addressDraft, name: e.target.value })} /></label>
            <label>Mobile number
              <span className="phone-input"><span>+91</span><input required inputMode="numeric" maxLength={10} autoComplete="tel-national" placeholder="10-digit mobile" value={addressDraft.phone} onChange={(e) => setAddressDraft({ ...addressDraft, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></span>
            </label>
            <label>Flat, building, street & area<textarea required autoComplete="street-address" placeholder="e.g. B-402, Green Meadows, Phase 1, Hinjawadi" value={addressDraft.street} onChange={(e) => setAddressDraft({ ...addressDraft, street: e.target.value })} /></label>
            <label>Pincode<input required inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="411057" value={addressDraft.pin} onChange={(e) => setAddressDraft({ ...addressDraft, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
            {addressFormError && <p className="form-error" role="alert">{addressFormError}</p>}
            <button className="btn btn-primary block lg" type="submit">Save address</button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={slotOpen} onOpenChange={setSlotOpen}>
        <DialogContent className="dialog">
          <DialogTitle>Choose a delivery slot</DialogTitle>
          <DialogDescription>Morning delivery, 9 AM – 12 PM.</DialogDescription>
          <Select value={slot} onValueChange={(v) => { setSlot(v); setSlotOpen(false); }}>
            <SelectTrigger className="slot-select"><SelectValue placeholder="Select a day" /></SelectTrigger>
            <SelectContent>{slots.map((s) => <SelectItem key={s.id} value={s.id} disabled={s.full}>{s.label}{s.full ? ' — fully booked' : ''}</SelectItem>)}</SelectContent>
          </Select>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------- product detail */}
      <Dialog open={!!product} onOpenChange={(v) => { if (!v) setProduct(null); }}>
        <DialogContent className="dialog product-dialog">
          {product && (
            <>
              <div className="pd-photo"><Photo name={product.image} alt={product.name} />{discountPercent(product) > 0 && <span className="off-badge">{discountPercent(product)}%<br />OFF</span>}</div>
              <DialogTitle>{product.name}</DialogTitle>
              <DialogDescription>{product.local} · {product.unit}</DialogDescription>
              <div className="pd-buy">
                <div className="price lg"><strong>{money(product.price)}</strong><del>{money(product.mrp)}</del><span className="save">Save {money(product.mrp - product.price)}</span></div>
                <QtyControl qty={qtyOf(product.id)} label={product.name} onAdd={() => add(product.id)} onChange={(d) => changeQty(product.id, d)} max={Math.min(MAX_QTY, product.stock)} soldOut={product.stock <= 0} />
              </div>
              <ul className="pd-points">
                <li><Sprout size={16} /> Sourced fresh from farms around Pune</li>
                <li><Clock size={16} /> Delivered next morning, 9 AM – 12 PM</li>
                <li><Leaf size={16} /> Store in a cool, dry place</li>
              </ul>
              <a className="btn btn-outline block" href={whatsappLink('', productShareMessage(product.name, product.unit, product.price))} target="_blank" rel="noopener noreferrer"><Share2 size={16} /> Share on WhatsApp</a>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------- cancel confirm */}
      <Dialog open={!!cancelId} onOpenChange={(v) => { if (!v) setCancelId(null); }}>
        <DialogContent className="dialog">
          <DialogTitle>Cancel order {cancelId}?</DialogTitle>
          <DialogDescription>You can cancel until we start packing. Nothing has been charged.</DialogDescription>
          <div className="dialog-actions">
            <button className="btn btn-outline" onClick={() => setCancelId(null)}>Keep order</button>
            <button className="btn btn-danger" disabled={cancelling} onClick={() => void cancelOrder()}>{cancelling ? <LoaderCircle className="spin" size={16} /> : null} Yes, cancel</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------- success */}
      <Dialog open={!!success} onOpenChange={(v) => { if (!v) { setSuccess(null); nav('account'); } }}>
        <DialogContent className="dialog success-dialog">
          <div className="success-icon"><CheckCircle2 size={44} /></div>
          <DialogTitle>Order placed!</DialogTitle>
          <DialogDescription>
            {success?.slotLabel ? `Arriving ${success.slotLabel}.` : 'We’ll deliver in your chosen slot.'} {success?.payment === 'online' && success.paymentStatus === 'paid' ? `Payment of ${money(success.totals.total)} received online.` : `Pay ${money(success?.totals.total ?? 0)} on delivery.`}
          </DialogDescription>
          <div className="order-id">Order ID <strong>{success?.id}</strong></div>
          {success && successWa === 'sent' && (
            <p className="wa-confirm"><WhatsAppIcon size={18} /> Confirmation sent on WhatsApp to <b>+91 {success.address.phone}</b></p>
          )}
          {success && successWa === 'pending' && (
            <p className="wa-confirm muted-wa"><WhatsAppIcon size={18} /> You’ll get the order confirmation on WhatsApp at <b>+91 {success.address.phone}</b> shortly.</p>
          )}
          {success && successWa !== 'sent' && <button className="btn btn-wa block" onClick={() => shareOrderOnWhatsApp(success)}><WhatsAppIcon size={18} /> Send order to Farm’s Touch on WhatsApp</button>}
          <button className="btn btn-primary block" onClick={() => { setSuccess(null); nav('account'); }}>View my orders</button>
        </DialogContent>
      </Dialog>
    </>
  );
}
