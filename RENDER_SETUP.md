# Deploy FarmTouch on Render (Node.js + PostgreSQL)

This deployment runs the customer shop, owner/packer panel (`/admin`) and delivery panel (`/rider`) on one Node web service with a separate PostgreSQL database. Original Cloudflare/Vinext commands remain available. No Cloudflare account or D1 binding is needed for the Render build.

## Option A: Render Blueprint

1. Merge the Render deployment PR into `main` after review.
2. Sign in at https://dashboard.render.com and connect GitHub. Give Render access to the private `swapnil1288/FarmTouch-App` repository.
3. Choose **New → Blueprint**, select this repository and `main`, and use `render.yaml`.
4. **Review the displayed costs before creating resources.** The Blueprint requests a paid `0.5c-512mb` web service and a paid `0.1c-256mb` PostgreSQL database. It does not use a local disk. Check the region and resource plans in the preview.
5. Enter `WHATSAPP_STORE_NUMBER` (country code + digits, e.g. `91…`). For `SHOP_URL`, use the intended public HTTPS address. Update it after creation if Render assigns a different URL.
6. Apply the Blueprint. Render builds and starts the web service; migrations create tables and starter products automatically. `DATABASE_URL` is linked to the new database.
7. In the web service's **Environment** settings, copy the generated `ADMIN_SETUP_CODE`. Open `https://YOUR-SERVICE.onrender.com/admin` and use that code to create your owner account. Keep the setup code private.
8. Set real prices and stock in **Products**, add packers/delivery staff, and place a small COD test order. Check packing, dispatch, delivery and order history.

## Option B: Manual service or an existing Supabase database

Create a PostgreSQL database first (Render Postgres in the same region, or an existing Supabase PostgreSQL database). For Render, use its **Internal Database URL**. For Supabase, use a Node-compatible IPv4/session-pooler connection string from the dashboard, with its supplied SSL settings; use `sslmode=verify-full` for verified external TLS. URL-encode special characters in passwords. Never paste database passwords into chat or commit them.

Create **New → Web Service**, connect the private repository, choose branch `main` after merging, and set:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build:render` |
| Start command | `npm run start:render` |
| Health check | `/api/health` |
| Node version (`NODE_VERSION`) | `24.22.1` |
| `NODE_ENV` | `production` |
| `FARMTOUCH_RUNTIME` | `node` |
| `DATABASE_URL` | Database connection string (secret) |
| `ADMIN_SETUP_CODE` | A long private random code you choose |
| `WHATSAPP_STORE_NUMBER` | Store number with country code, digits only |
| `SHOP_URL` | Public HTTPS address of this web service |

The startup command runs versioned PostgreSQL migrations transactionally, then listens on `0.0.0.0:$PORT`. Build does not need database access. Failed migrations stop startup instead of serving against a partial schema. Do not use `pnpm start`: that is the original local Cloudflare preview command.

Render may offer free resources with limitations; review current terms in the dashboard, including database expiry. For a real business, use a durable database plan with suitable backups. App data lives in PostgreSQL, not the web service filesystem.

## Optional integrations

- Automatic WhatsApp: add the `WHATSAPP_*` variables described in `WHATSAPP_SETUP.md` to Render Environment. Without API credentials, staff can send prepared messages manually.
- Razorpay: add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and configure the public webhook URL `/api/payments/razorpay/webhook`. Use Test Mode first; validate captured payment, duplicate callbacks, cancellation/refund and late-payment behavior before enabling real payments.
- Node/Render deliberately ignores ChatGPT identity headers. Customers use the existing guest cookie and order tracking; staff use email/mobile and password. `ADMIN_EMAILS` does not grant access from caller-supplied headers.

## Existing data and migrations

This creates a **fresh database**, with starter products. It does not copy an existing D1/local database, orders, staff passwords or stock. If there is live Cloudflare data, export and migrate it separately before switching traffic. Do not point the initial migration at an unrelated database.

PostgreSQL migrations live in `postgres/`. Add a new numbered SQL file for future schema changes; do not edit applied migrations (checksums are checked). Cloudflare migrations under `drizzle/` remain separate, so future schema changes must cover both deployment targets if both are used.

## Local verification of the Render backend

Use Node 24 and a disposable PostgreSQL database. Create `.env.local` (git-ignored) with `DATABASE_URL`, `ADMIN_SETUP_CODE`, `WHATSAPP_STORE_NUMBER` and `FARMTOUCH_RUNTIME=node`.

```sh
npm ci
npm run dev:render
```

Open http://localhost:5173. For a production check:

```sh
npm run build:render
npm run start:render
```

Open http://localhost:10000. `npm run start:render` requires variables in the process environment; Render supplies these automatically. For a local terminal, export them first or use Node's `--env-file=.env.local` with `scripts/start-render.mjs`.

Run `npm test` and, with a disposable database URL set, `npm run test:postgres`. The integration test creates and drops an isolated schema; it does not use the public application schema.

## Automated checks

The Render backend workflow uses an actual PostgreSQL 16 service, runs the 57 existing business checks, isolated PostgreSQL integration checks, a production Next.js build and HTTP workflow checks against a disposable deployment. HTTP checks deliberately reject spoofed platform identity headers and cross-origin writes. Live WhatsApp delivery and Razorpay capture/refund require provider Test Mode credentials and are not exercised by this workflow.
