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

type MoneyFields = Pick<SettlementOrder, 'status' | 'payment' | 'paymentStatus' | 'cashCollected' | 'totals'>;

/**
 * Where one order's money stands. The single source of truth for settlement,
 * the dashboard and the customer ledger.
 *   cashCollected     – cash/UPI the rider recorded on delivery (COD only)
 *   onlinePaid        – captured online payment not yet refunded
 *   pendingCollection – still owed by the customer (never for cancelled or paid-online orders)
 */
export function paymentBreakdown(o: MoneyFields): { cashCollected: number; onlinePaid: number; pendingCollection: number } {
  const paidOnline = o.payment === 'online' && o.paymentStatus === 'paid';
  return {
    cashCollected: o.status === 'delivered' && o.payment !== 'online' ? (o.cashCollected ?? 0) : 0,
    onlinePaid: paidOnline ? o.totals.total : 0,
    pendingCollection: o.status === 'cancelled' || paidOnline ? 0 : Math.max(0, o.totals.total - (o.cashCollected ?? 0)),
  };
}

/** Totals for a group of orders. */
function sumUp(list: SettlementOrder[]) {
  const live = list.filter((o) => o.status !== 'cancelled');
  const money = list.map(paymentBreakdown);
  const sum = (pick: (m: ReturnType<typeof paymentBreakdown>) => number) => money.reduce((n, m) => n + pick(m), 0);
  return {
    grossSales: live.reduce((n, o) => n + o.totals.total, 0),
    discounts: live.reduce((n, o) => n + (o.totals.discount ?? 0), 0),
    deliveryRevenue: live.reduce((n, o) => n + (o.totals.delivery ?? 0), 0),
    cashCollected: sum((m) => m.cashCollected),
    onlinePaid: sum((m) => m.onlinePaid),
    pendingCollection: sum((m) => m.pendingCollection),
    cancelledValue: list.filter((o) => o.status === 'cancelled').reduce((n, o) => n + o.totals.total, 0),
  };
}

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

  const accountOf = (o: SettlementOrder) => customerAccounts[o.customerPhone];
  const typeOf = (o: SettlementOrder): 'b2b' | 'retail' => (accountOf(o)?.accountType === 'b2b' ? 'b2b' : 'retail');
  const group = (list: SettlementOrder[]): SettlementGroup => {
    const t = sumUp(list);
    return { orders: list.length, ...t, netSettlement: t.cashCollected + t.onlinePaid + t.pendingCollection };
  };

  const totals = sumUp(window);
  const byType: SettlementSummary['byType'] = {
    b2b: group(window.filter((o) => typeOf(o) === 'b2b')),
    retail: group(window.filter((o) => typeOf(o) === 'retail')),
  };

  // One row per India date that has orders, oldest first.
  const byDate = new Map<string, SettlementOrder[]>();
  for (const o of window) {
    const date = indiaDate(new Date(o.createdAt));
    byDate.set(date, [...(byDate.get(date) ?? []), o]);
  }
  const byDay: SettlementSummary['byDay'] = [...byDate.keys()].sort().map((date) => ({ date, ...sumUp(byDate.get(date)!) }));

  return {
    days,
    from: fromIso.slice(0, 10),
    to: toIso.slice(0, 10),
    ...totals,
    netSettlement: totals.cashCollected + totals.onlinePaid + totals.pendingCollection,
    byType,
    orders: window.map((o) => ({
      id: o.id,
      date: indiaDate(new Date(o.createdAt)),
      status: o.status,
      total: o.totals.total,
      discount: o.status === 'cancelled' ? 0 : (o.totals.discount ?? 0),
      ...paymentBreakdown(o),
      payment: o.payment,
      paymentStatus: o.paymentStatus,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      accountType: typeOf(o),
      businessName: accountOf(o)?.businessName ?? '',
    })),
    byDay,
  };
}