// Order fulfilment workflow shared by the customer app, admin panel and API.
//
//   placed → confirmed → packing → packed → out_for_delivery → delivered
//      └──────────┴──────────┴────────┴──────────────→ cancelled
//   out_for_delivery → packed   (delivery attempt failed, back to store)

export const ORDER_STATUSES = ['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STAFF_ROLES = ['admin', 'packer', 'delivery'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', packer: 'Packer', delivery: 'Delivery' };

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Order placed',
  confirmed: 'Confirmed',
  packing: 'Packing',
  packed: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Customer-facing explanation of each status. */
export const STATUS_HINT: Record<OrderStatus, string> = {
  placed: 'We have received your order.',
  confirmed: 'Your order is confirmed and will be packed soon.',
  packing: 'We are picking fresh items for you.',
  packed: 'Packed and waiting for the delivery partner.',
  out_for_delivery: 'Your order is on the way.',
  delivered: 'Delivered. Enjoy your fresh food!',
  cancelled: 'This order was cancelled.',
};

/** Steps shown in the customer's progress tracker. */
export const TRACK_STEPS: OrderStatus[] = ['placed', 'confirmed', 'packing', 'out_for_delivery', 'delivered'];

export function trackIndex(status: OrderStatus): number {
  if (status === 'packed') return TRACK_STEPS.indexOf('packing');
  return TRACK_STEPS.indexOf(status);
}

export const OPEN_STATUSES: OrderStatus[] = ['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery'];

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}
export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

export type OrderAction =
  | 'confirm'
  | 'start_packing'
  | 'toggle_item'
  | 'mark_packed'
  | 'assign'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancel'
  | 'edit_items'
  | 'note';

type Rule = { from: OrderStatus[]; to: OrderStatus | null; roles: StaffRole[] };

/** Which statuses each action is allowed from, the new status, and who may do it. */
export const ACTION_RULES: Record<OrderAction, Rule> = {
  confirm: { from: ['placed'], to: 'confirmed', roles: ['admin'] },
  start_packing: { from: ['placed', 'confirmed'], to: 'packing', roles: ['admin', 'packer'] },
  toggle_item: { from: ['confirmed', 'packing'], to: null, roles: ['admin', 'packer'] },
  mark_packed: { from: ['packing'], to: 'packed', roles: ['admin', 'packer'] },
  assign: { from: ['placed', 'confirmed', 'packing', 'packed'], to: null, roles: ['admin'] },
  out_for_delivery: { from: ['packed'], to: 'out_for_delivery', roles: ['admin', 'delivery'] },
  delivered: { from: ['out_for_delivery'], to: 'delivered', roles: ['admin', 'delivery'] },
  failed: { from: ['out_for_delivery'], to: 'packed', roles: ['admin', 'delivery'] },
  cancel: { from: ['placed', 'confirmed', 'packing', 'packed', 'out_for_delivery'], to: 'cancelled', roles: ['admin'] },
  /** Change quantities / remove unavailable items before the order is packed. */
  edit_items: { from: ['placed', 'confirmed', 'packing'], to: null, roles: ['admin', 'packer'] },
  note: { from: [...ORDER_STATUSES], to: null, roles: ['admin', 'packer', 'delivery'] },
};

export const ACTION_LABEL: Record<OrderAction, string> = {
  confirm: 'Confirmed',
  start_packing: 'Packing started',
  toggle_item: 'Item packed',
  mark_packed: 'Packed',
  assign: 'Delivery partner assigned',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Delivery attempt failed',
  cancel: 'Cancelled',
  edit_items: 'Items changed',
  note: 'Note',
};

/** Customers may cancel until packing starts. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['placed', 'confirmed'];

export function canDo(action: OrderAction, role: StaffRole, status: OrderStatus): boolean {
  const rule = ACTION_RULES[action];
  return rule.roles.includes(role) && rule.from.includes(status);
}

export function isOrderAction(v: unknown): v is OrderAction {
  // Own keys only: `in` would also accept inherited names like "toString" or "constructor".
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACTION_RULES, v);
}
