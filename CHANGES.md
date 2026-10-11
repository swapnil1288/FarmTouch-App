# What changed in v4: staff login, WhatsApp updates for every order event

## Fixed: “no option to log in to the admin panel”
The staff panel used to depend on the hosting platform’s sign-in, so on a normal setup there was no way in. Now it has **its own login**:
- First-time **owner setup** at `/admin`, protected by a secret `ADMIN_SETUP_CODE`.
- Staff log in with **email or mobile number + password**.
- **Log out**, **change password**, and the owner can **set or reset** any staff password.
- Passwords are hashed (PBKDF2-SHA256), sessions use HttpOnly cookies, accounts lock after 5 wrong attempts, and disabling someone or resetting their password logs them out everywhere.

## Fixed: “WhatsApp messages not sent to customer”
Customers are now messaged for **every** order event:
- **Order placed**: items, total, slot, address and a tracking link.
- **Confirmed.**
- **Order changed**: unavailable items or quantity changes, with the new total.
- **Out for delivery**: partner name and phone, amount to keep ready.
- **Delivered + payment received**, including any balance due.
- **Delivery missed**, with the reason.
- **Cancelled**, by the customer or the shop, with the reason.
- **Offers**, only to customers who opted in.

How messages go out:
- **Automatic** through the WhatsApp Business Cloud API, once it is set up (WHATSAPP_SETUP.md).
- **One tap** without any setup. After each action a “Tell the customer” box opens WhatsApp with the message ready.

Every message is logged in **/admin → WhatsApp**, with status, failure reason, retry, one-tap send and a “To send” counter.

Customers give separate consent at checkout for order updates and for offers. Admins can switch either off per customer, for example after a STOP reply.

## New: change items in an order
Packers and admins can lower quantities or mark basket items unavailable until the order is packed.
- Stock is adjusted in the same atomic save.
- The bill is recalculated at the prices the customer ordered at. The customer keeps their coupon and delivery terms.
- The change appears in the customer’s timeline and is sent on WhatsApp.

## New: no customer login needed
- Customers can order without any account. Their orders are remembered on their phone through a private cookie.
- **Track an order** with its ID and mobile number from any phone. WhatsApp messages include a `?track=` link.
- Customers can cancel from the same phone until packing starts.

## Fixes found while building v4
- The order drawer was being closed when staff switched to WhatsApp. It now stays open.
- The “tell the customer” prompt only shows messages created by the action just taken.

## Verification (v4)
- `pnpm run typecheck`, `pnpm run lint`: clean.
- `pnpm test`: 53 checks pass.
- `node scripts/smoke-run.mjs`: passes on repeated runs. It covers setup, login, lockout, password change, logout, guest ordering and tracking, item changes with stock and totals, every message type, consent, offers and the full workflow.
- Migrations were tested on a fresh database and on an existing one.
- Browser-tested: staff login (wrong and right password), guest checkout on mobile, confirm → WhatsApp prompt → send, change items, WhatsApp tab, the customer timeline showing the change, tracking by link, and logout.

---

# What changed in v3: business side (staff panel)

## New: staff panel at `/admin`

- **Roles**: Admin, Packer and Delivery. Each person signs in with their own email, and owners are set with `ADMIN_EMAILS`.
- **Order workflow**: Placed → Confirmed → Packing → Packed → Out for delivery → Delivered, or Cancelled. Every step is checked on the server: who is allowed, from which status, and that the order is still the latest version. Every step is recorded in a timeline.
- **Packing**: a day-wise pick list (total packs of each item, baskets included) you can print, a per-order checklist that has to be complete before “Mark packed”, packing slips, and the customer’s replacement preference.
- **Dispatch & delivery**: assign delivery partners. Partners get a mobile screen with call, WhatsApp and Google Maps buttons, record the cash collected, and can return a failed delivery with a reason.
- **Products & stock**: edit prices, MRP and stock, hide or show items, and add new products. Packers can update stock counts.
- **Dashboard & reports**: today’s orders and sales, the pipeline, a sales chart (7/14/30 days, with a table view), top items, low stock, cash per partner, upcoming delivery days, and a CSV export (Excel-safe).
- **Staff management**: add, edit and disable staff. You can’t remove your own admin access.

## Customer app is now connected to the business side

- The catalogue comes from the database, so price and stock changes in `/admin` show in the shop.
- **Live stock**: stock is reserved when an order is placed. The database refuses to let stock go below zero, so two customers can’t both buy the last pack. Shows “Sold out” and “Only N left”, cart warnings, and checkout is blocked if items run short.
- **Order tracking**: a progress tracker, timeline and delivery partner name/phone, refreshing every 20 seconds.
- **Customer cancel** until packing starts. Stock is returned automatically.
- An order stores a snapshot of names and prices, so later price edits don’t change past orders.
- Optional WhatsApp status templates for opted-in customers, and one-tap WhatsApp messages from staff.

## Fixes found while building v3

- POST requests that were rejected early (for example, the wrong content type) answered before reading the request body, which made the server drop the connection with “worker restarted”. Bodies are now always read first.
- Retrying an already-saved order now returns that order, even if the item has since sold out.

## Verification (v3)

- `pnpm run typecheck`, `pnpm run lint`: clean.
- `pnpm test`: 48 checks pass.
- `node scripts/smoke-run.mjs`: passes repeatedly. It covers stock reservation, the last-pack race, cancel + restock, every role permission, the full pack → dispatch → deliver flow, customer tracking, reports, CSV and product management.
- The migration was tested on an existing database (old orders backfilled) and on a fresh one.
- Browser-tested: a customer order on mobile, then confirming, packing, dispatching and delivering it in the desktop admin; the customer tracker; and the delivery partner’s mobile screen.

---

# What changed in v2 (storefront)

## Bugs fixed

| # | Bug | Effect on customers | Fix |
|---|---|---|---|
| 1 | The mobile search box sat inside a `<main key={view}>` that re-mounted when typing switched the page | The keyboard closed after the **first letter** on phones | Search moved to the sticky header, so focus is kept |
| 2 | A coupon stayed "applied" after the cart dropped below its minimum | The order was **rejected at checkout** with a confusing error | Every cart change re-checks the coupon and removes it with a notice |
| 3 | The draft cart was written to storage (empty) before it was restored; in React Strict Mode the restore ran twice | The **saved cart could be wiped** on page load | Draft is read once when the client mounts, and only then saved. Moved from sessionStorage to localStorage so it survives closing the tab |
| 4 | Delivery-slot id used the UTC date while the label used the India date | Between **00:00–05:30 IST** the slot shown was a different day from the slot saved | Slots are calculated on the IST calendar day (with tests for midnight and month-end) |
| 5 | Address fields wrote straight into the saved address while typing | Closing the dialog half-filled still allowed checkout, then the server rejected it | Address is edited as a draft, validated, and saved only on "Save address" |
| 6 | `crypto.randomUUID()` only works on HTTPS or localhost | Testing on a phone over Wi-Fi (`http://192.168…`) **crashed "Place order"** | Safe fallback ID generator |
| 7 | Adding an item at the 10-pack limit showed "added" and "maximum" toasts together | Contradictory messages | The limit is checked before updating |
| 8 | Bulk basket had the same 8 items and price as the Family basket | Bulk option was meaningless | Bulk = double packs (₹710 default), applied in the UI, server pricing and stock checks |
| 9 | "Buy again" replaced the whole cart and didn't check the items still exist | Current cart lost; invalid lines could cause failed orders | Merges into the cart, skips unavailable items, respects the 10-pack limit |
| 10 | `res.json()` on a non-JSON error page threw "Unexpected token…" | Unreadable error messages | Safe JSON reading with clear messages for offline/server errors |
| 11 | Header always said "Hinjawadi, Pune" | Wrong location shown | Shows the saved address area and pincode |
| 12 | Phone accepted any 10 digits (e.g. `0000000000`) | Undeliverable orders | Indian mobile check `[6-9]xxxxxxxxx` on client and server; whitespace-only street rejected |
| 13 | Searching while a category was selected (e.g. Fruits) hid matching vegetables | "No products found" for onion | Searching from the header resets the category to "All" |
| 14 | Product card and stepper components were defined inside the main component | Re-created on every render (flicker, lost focus, slower) | Moved to top-level components |
| 15 | The idempotency key wasn't reset when payment/replacement changed | A retry could return an older order with old preferences | A fresh key whenever anything in the order changes |
| 16 | Generic server error text for every validation problem | Customer didn't know what to fix | Specific messages (phone, pincode, coupon minimum, stock per item, slot expired) |
| 17 | No body-size or content-type limits on the order API | Oversized payloads were parsed | 32 KB limit, JSON content type required, malformed JSON handled |
| 18 | One corrupted order row broke the whole order history | History failed to load | Corrupted rows are skipped |
| 19 | No viewport/theme meta, and the main UI file was minified onto a few lines | Hard to maintain | Viewport + theme colour; all code formatted and commented |
| 20 | React lint errors (state set synchronously inside effects) | Extra renders, possible flicker | Logic moved to event handlers or derived state; `pnpm run lint` is clean |

## New

- **Design**: new storefront look. Brand green, sunny yellow and pastel category tiles, Plus Jakarta Sans, delivery-time header, banners, a trust strip, deal rails, a sticky mobile cart bar, bottom-sheet cart on phones, a desktop category sidebar, ticket-style coupons, step checkout, and a success screen.
- **WhatsApp integration**: chat button, Order on WhatsApp (cart and checkout), send order details after checkout, share product, share past orders, opt-in for updates, and optional Cloud API alerts to the store and customer.
- MRP savings ("You save ₹X"), free-delivery progress bar, coupon suggestions, sort by discount, and "Order again" on the home page.

## Verification

- `pnpm run typecheck`: passes.
- `pnpm run lint`: 0 errors, 0 warnings.
- `pnpm test`: 36 business-rule checks pass.
- `node scripts/smoke-run.mjs`: server integration checks pass (rendering, WhatsApp link, images, auth, save, replay, concurrency, validation messages, origin, content type, malformed JSON, size limit, account isolation).
- Browser flow tested (desktop 1440 px and mobile 390 px): search focus, add/remove, coupon auto-removal, address validation, slot choice, place order, success screen, order history, draft restore after reload, and basket swap.

These tests cover the sample business rules. They can't prove the app has no defects; real-device testing is still recommended before launch (see README).
