export type SettlementSummary = {
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
  byType: Record<'b2b' | 'retail', SettlementGroup>;
  orders: { id: string; date: string; status: string; total: number; discount: number; cashCollected: number; onlinePaid: number; pendingCollection: number; payment: 'cod' | 'online'; paymentStatus?: string; customerName: string; customerPhone: string; accountType: 'b2b' | 'retail'; businessName: string }[];
  byDay: { date: string; grossSales: number; discounts: number; deliveryRevenue: number; cashCollected: number; onlinePaid: number; pendingCollection: number; cancelledValue: number }[];
};

export type SettlementGroup = {
  orders: number;
  grossSales: number;
  discounts: number;
  deliveryRevenue: number;
  cashCollected: number;
  onlinePaid: number;
  pendingCollection: number;
  cancelledValue: number;
  netSettlement: number;
};

type SettlementOrder = {
  id: string;
  status: string;
  createdAt: string;
  customerPhone: string;
  customerName: string;
  payment: 'cod' | 'online';
  paymentStatus?: string;
  cashCollected?: number | null;
  totals: { total: number; discount?: number; delivery?: number };
};

type CustomerAccount = { accountType: 'retail' | 'b2b'; businessName: string };

function indiaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function settlementSummary(orders: SettlementOrder[], days = 30, customerAccounts: Record<string, CustomerAccount> = {}): SettlementSummary {
  const today = indiaDate(new Date());
  const fromDate = new Date(`${today}T00:00:00+05:30`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const from = indiaDate(fromDate);
  const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString();
  const toIso = new Date(`${today}T23:59:59.999+05:30`).toISOString();
  const window = orders.filter((o) => o.createdAt >= fromIso && o.createdAt <= toIso);

  const grossSales = window.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + o.totals.total, 0);
  const discounts = window.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + (o.totals.discount ?? 0), 0);
  const deliveryRevenue = window.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + (o.totals.delivery ?? 0), 0);
  const cashCollected = window.filter((o) => o.status === 'delivered' && o.payment !== 'online').reduce((n, o) => n + (o.cashCollected ?? 0), 0);
  const onlinePaid = window.filter((o) => o.payment === 'online' && o.paymentStatus === 'paid').reduce((n, o) => n + o.totals.total, 0);
  const pendingCollection = window.filter((o) => o.status !== 'cancelled' && !(o.payment === 'online' && o.paymentStatus === 'paid'))
    .reduce((n, o) => n + Math.max(0, o.totals.total - (o.cashCollected ?? 0)), 0);
  const cancelledValue = window.filter((o) => o.status === 'cancelled').reduce((n, o) => n + o.totals.total, 0);

  const byType: SettlementSummary['byType'] = {
    b2b: { orders: 0, grossSales: 0, discounts: 0, deliveryRevenue: 0, cashCollected: 0, onlinePaid: 0, pendingCollection: 0, cancelledValue: 0, netSettlement: 0 },
    retail: { orders: 0, grossSales: 0, discounts: 0, deliveryRevenue: 0, cashCollected: 0, onlinePaid: 0, pendingCollection: 0, cancelledValue: 0, netSettlement: 0 },
  };
  for (const order of window) {
    const accountType = customerAccounts[order.customerPhone]?.accountType === 'b2b' ? 'b2b' : 'retail';
    const group = byType[accountType];
    group.orders += 1;
    if (order.status === 'cancelled') group.cancelledValue += order.totals.total;
    else {
      group.grossSales += order.totals.total;
      group.discounts += order.totals.discount ?? 0;
      group.deliveryRevenue += order.totals.delivery ?? 0;
      if (order.payment === 'online' && order.paymentStatus === 'paid') group.onlinePaid += order.totals.total;
      else group.pendingCollection += Math.max(0, order.totals.total - (order.cashCollected ?? 0));
    }
    if (order.status === 'delivered' && order.payment !== 'online') group.cashCollected += order.cashCollected ?? 0;
  }
  for (const group of Object.values(byType)) group.netSettlement = group.cashCollected + group.onlinePaid + group.pendingCollection;

  const byDay: SettlementSummary['byDay'] = [];
  const datesWithOrders = new Set(window.map((o) => indiaDate(new Date(o.createdAt))));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00+05:30`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = indiaDate(d);
    if (!datesWithOrders.has(date)) continue;
    const dayOrders = window.filter((o) => indiaDate(new Date(o.createdAt)) === date);
    byDay.push({
      date,
      grossSales: dayOrders.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + o.totals.total, 0),
      discounts: dayOrders.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + (o.totals.discount ?? 0), 0),
      deliveryRevenue: dayOrders.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + (o.totals.delivery ?? 0), 0),
      cashCollected: dayOrders.filter((o) => o.status === 'delivered' && o.payment !== 'online').reduce((n, o) => n + (o.cashCollected ?? 0), 0),
      onlinePaid: dayOrders.filter((o) => o.payment === 'online' && o.paymentStatus === 'paid').reduce((n, o) => n + o.totals.total, 0),
      pendingCollection: dayOrders.filter((o) => o.status !== 'cancelled' && !(o.payment === 'online' && o.paymentStatus === 'paid'))
        .reduce((n, o) => n + Math.max(0, o.totals.total - (o.cashCollected ?? 0)), 0),
      cancelledValue: dayOrders.filter((o) => o.status === 'cancelled').reduce((n, o) => n + o.totals.total, 0),
    });
  }

  return {
    days,
    from: fromIso.slice(0, 10),
    to: toIso.slice(0, 10),
    grossSales,
    discounts,
    deliveryRevenue,
    cashCollected,
    onlinePaid,
    pendingCollection,
    cancelledValue,
    netSettlement: cashCollected + onlinePaid + pendingCollection,
    byType,
    orders: window.map((o) => ({
      id: o.id,
      date: indiaDate(new Date(o.createdAt)),
      status: o.status,
      total: o.totals.total,
      discount: o.status === 'cancelled' ? 0 : (o.totals.discount ?? 0),
      cashCollected: o.status === 'delivered' ? (o.cashCollected ?? 0) : 0,
      onlinePaid: o.payment === 'online' && o.paymentStatus === 'paid' ? o.totals.total : 0,
      pendingCollection: o.status === 'cancelled' || (o.payment === 'online' && o.paymentStatus === 'paid') ? 0 : Math.max(0, o.totals.total - (o.cashCollected ?? 0)),
      payment: o.payment,
      paymentStatus: o.paymentStatus,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      accountType: customerAccounts[o.customerPhone]?.accountType === 'b2b' ? 'b2b' : 'retail',
      businessName: customerAccounts[o.customerPhone]?.businessName ?? '',
    })),
    byDay,
  };
}