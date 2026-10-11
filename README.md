# Farm’s Touch — grocery web app + staff panel (v4)

A mobile-first online grocery store for Pune (vegetables, fruits, greens and customisable weekly baskets, with WhatsApp ordering) **plus a staff panel at `/admin`** for the business side: orders, packing, dispatch, delivery, products & stock, staff and reports. Both use the same database, so the customer app and the staff panel are always in sync. It runs in any desktop or mobile browser. It is a web app, **not** a native Android/iOS app.

See **CHANGES.md** for what is new and fixed, and **STAFF_GUIDE.md** for a one-page guide to give packers and delivery partners.

## Features

- New storefront design (quick-commerce layout): delivery-time header, sticky search, banners, category tiles, deal rails, sticky mobile cart bar and bottom navigation.
- Search in English, Hindi and Marathi (onion, pyaz, kanda, कांदा).
- Category sidebar (desktop) or category chips (mobile), plus sorting by relevance, discount or price.
- Mini, Family and Bulk baskets. Bulk is double packs. You can swap any item and the price updates.
- Cart with a free-delivery progress bar, MRP savings, coupon suggestions and a bill breakdown.
- Step-by-step checkout: address, slot chips, payment and replacement preference, plus separate opt-ins for WhatsApp order updates and WhatsApp offers.
- The cart, coupon, address and slot are saved on the device, so they survive a refresh or closing the tab.
- Order history with order again, share on WhatsApp, and slot labels.
- **WhatsApp integration**:
  - Floating chat button, a "Chat on WhatsApp" link in the nav, and a support card.
  - **Order on WhatsApp** from the cart and checkout. This sends the items, total, coupon, slot and address as a pre-filled message.
  - After an order is placed, the customer can send the order details on WhatsApp.
  - Share a product on WhatsApp.
  - **Customer messages for every order event**: placed, confirmed, items changed, out for delivery, delivered + payment, delivery missed and cancelled, plus offers for customers who opt in. They are sent automatically through the WhatsApp Cloud API, or with one tap by staff (see WHATSAPP_SETUP.md).
- **No customer login needed**: orders are remembered on the customer’s phone, and anyone can **track an order** with its ID and mobile number. WhatsApp messages include a tracking link.
- **Staff login** at `/admin` with email or mobile + password, with roles Admin, Packer and Delivery.
- Server-side price calculation, validated orders, idempotent saves, and per-device order history.


## Staff panel (`/admin`) — how the business side works

```
Customer places order ──► NEW ──► CONFIRMED ──► PACKING ──► PACKED ──► OUT FOR DELIVERY ──► DELIVERED
   (stock reserved)      admin     admin/packer   tick each item   admin assigns     partner collects cash
                                                                     partner             (amount recorded)
        Customer can cancel until packing starts · Admin can cancel any time before delivery (stock goes back)
        Delivery failed? Partner writes the reason → order returns to PACKED for re-dispatch
```

| Role | Sees | Can do |
|---|---|---|
| **Admin** (owner / manager) | Everything | Dashboard, confirm/cancel orders, packing, assign delivery partners, products & prices, stock, staff, CSV export |
| **Packer** | Packing tab, Products (stock only) | Day-wise **pick list** (total packs of each item), per-order **packing checklist**, print packing slip, mark packed, update stock counts |
| **Delivery** | Only orders assigned to them | Start delivery, call / WhatsApp / Google Maps the customer, mark delivered with **cash collected**, or “couldn’t deliver” with a reason |

**Connected to the customer app:**
- Products, prices, stock and the show/hide switch in `/admin → Products` are what customers see (refreshes every 2 minutes and on reload).
- Stock is **reserved when the order is placed** (atomic, so two people can’t buy the last pack) and **returned when an order is cancelled**. Items with 0 stock show “Sold out”, and items with 5 or fewer show “Only N left”.
- Customers see a **live tracker** in *Account → Order history*: Placed → Confirmed → Packing → Out for delivery → Delivered, with a timeline. While the order is on the way, they also see the delivery partner’s name and a **Call** button. The page refreshes itself every 20 seconds.
- Customers can **cancel** until packing starts.
- Optional WhatsApp template messages go to customers who opted in when the status changes. Staff can also tap **Message** to send a ready-made status text through their own WhatsApp.

**First-time setup (staff login)**
1. Choose a secret setup code and put it in `.dev.vars` as `ADMIN_SETUP_CODE=…`. When hosted, set it as a Worker secret.
2. Open `/admin`. The **Create the owner account** screen appears. Enter the setup code, your name, email, optional mobile number and a password. You are now the admin.
3. In `/admin → Staff`, add packers and delivery partners with an email, mobile and a **password**, and share it with them. They log in at `/admin` with their **email or mobile number + password**. Delivery partners’ mobile numbers are shown to customers.
4. In `/admin → Products`, set real prices and today’s stock.

Security:
- Passwords are stored hashed (PBKDF2-SHA256), and sessions use HttpOnly cookies that last 30 days.
- After 5 wrong passwords, an account is locked for 15 minutes.
- Disabling someone or resetting their password logs them out everywhere.
- Everyone can change their own password, and the owner can reset anyone’s in **Staff**.

**Daily routine:** Orders → confirm new orders → Packing (choose the day) → print the pick list → pack each order using its checklist → Dispatch → assign a partner and send out → partners deliver from their phone → Dashboard shows cash collected per partner.

## Setup on a Windows PC (PowerShell)

Install **Node.js 22.13+ (Node 24 recommended)** and **pnpm 10+**. Extract the ZIP, for example to `C:\Projects\farmtouch`, and open PowerShell in that folder.

```powershell
npm install -g pnpm@10
pnpm install --frozen-lockfile
copy .dev.vars.example .dev.vars      # then edit WHATSAPP_STORE_NUMBER
pnpm run typecheck
pnpm test
pnpm run build
pnpm run db:local
pnpm run dev
```

Open **http://localhost:5173** for the shop. Customers order **without any login**: their orders are remembered on their phone, and any order can be tracked with its ID and mobile number. Open **http://localhost:5173/admin** for the staff panel and create the owner account with your `ADMIN_SETUP_CODE`.

On macOS or Linux, use `cp` instead of `copy`.

## WhatsApp messages

Customers get a WhatsApp message for **order placed, confirmed, items changed (unavailable or quantity), out for delivery, delivered + payment received, delivery missed and cancelled**. Customers who opted in also get **offers**. Every message is logged in **/admin → WhatsApp**.

- **Without any setup:** staff send each message with **one tap**. A “Tell the customer” box appears after each action, and WhatsApp opens with the text ready. Unsent messages wait in **WhatsApp → To send**.
- **Fully automatic:** connect the WhatsApp Business Platform (Cloud API) and two approved templates. Step-by-step instructions are in **WHATSAPP_SETUP.md**.

`WHATSAPP_STORE_NUMBER` (your shop number) powers the “Chat with us” and “Order on WhatsApp” buttons.

## Online payments

Online payments use Razorpay Standard Checkout. Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` on the server; see [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md) for Test Mode setup, webhook events and the production checklist. Online orders are only created after server-side signature, amount and captured-status verification.

## Commands

- `pnpm run dev`: local development server on port 5173.
- `pnpm run build`: compile the frontend and Worker backend.
- `pnpm run db:local`: apply database migrations locally (run after `build`; safe to re-run).
- `pnpm test`: 53 business-rule tests (pricing, live stock, validation, slots, WhatsApp texts, workflow permissions, packing lists, CSV).
- `pnpm run typecheck` / `pnpm run lint`: TypeScript and ESLint checks.
- `pnpm run test:whatsapp`: checks that a new order automatically sends WhatsApp to **both** the customer’s own number and the Farm’s Touch number (against a fake WhatsApp API). Run `build` and `db:local` first.
- `node scripts/smoke-run.mjs`: server integration tests against a local build, including staff login, guest ordering, the full order → pack → dispatch → deliver workflow, item changes, WhatsApp message log, stock races and role permissions. Run `build` and `db:local` first.

## Where to edit

| File | Purpose |
|---|---|
| `app/shop.tsx` | Customer screens and shopping interactions |
| `app/admin/` | Staff panel (page + all staff screens) |
| `lib/workflow.ts` | Order statuses, who can do what, customer cancel rule |
| `lib/server/` | Database access: orders & workflow, products, staff & login, reports |
| `lib/notify-text.ts` | Text of every customer WhatsApp message (edit wording here) |
| `lib/whatsapp-server.ts` | Sending, message log, offers |
| `app/globals.css` | Theme (colour tokens at the top of the storefront section), layout, responsive rules |
| `lib/catalog.ts` | Pricing rules, basket types, coupons, delivery fee, delivery slots (products themselves live in the database) |
| `lib/order-validation.ts` | Server-side order validation |
| `lib/whatsapp.ts` | WhatsApp links and message text |
| `lib/whatsapp-server.ts` | WhatsApp Cloud API notifications |
| `app/api/orders/` | Customer: place order, order history, cancel |
| `app/api/admin/` | Staff APIs: orders/actions, pick list, products, staff, reports, CSV export |
| `components/store/` | Store-specific components |
| `db/schema.ts` / `drizzle/` | Database schema and migrations |

## Architecture

React 19 + TypeScript, Vinext/Vite app routes, Cloudflare Worker API, D1 (SQLite) database, Drizzle migrations, Zod validation and Radix/shadcn primitives.

The server recalculates every price. The client never sends a total.

## Before a real public launch

1. Set real prices, stock and offers in `/admin → Products` (coupons are in `lib/catalog.ts`).
2. Add online payments (Razorpay or a UPI gateway) with server-verified webhooks. Online payment is shown as "coming soon".
3. Add customer login suitable for the public, such as phone OTP. The current sign-in comes from the hosting platform.
4. Slot capacity limits (max orders per morning), GST invoices and product photo upload are not built yet. New products choose from the existing photos.
5. Add privacy, terms and refund pages. Decide how long to keep customer addresses and phone numbers.
6. Test on real devices. Set up monitoring, backups and rate limiting.
