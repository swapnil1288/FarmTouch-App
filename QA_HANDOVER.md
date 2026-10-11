# QA handover — v4 (8 October 2026)

## Automated checks run
- `pnpm run typecheck`: pass
- `pnpm run lint`: pass (0 errors, 0 warnings)
- `pnpm test`: 53/53 pass
- `pnpm run build` + `pnpm run db:local` + `node scripts/smoke-run.mjs`: pass on repeated runs
- Migrations 0000–0002 on a fresh database and on an existing one with orders

## Browser checks run (Chromium; desktop 1440 px, mobile 390 px)
- Staff login: wrong password shows an error, right password opens the panel, log out returns to the login screen.
- Guest checkout on mobile without any sign-in, with the offers opt-in. The order appears under “My orders”.
- Admin confirm → “Tell the customer” box → Send on WhatsApp opens wa.me with the customer number and message.
- Change items (Tomato 3 → 2): the new total shows in the dialog, the customer is messaged, and the customer’s timeline shows “Order changed”.
- WhatsApp tab: setup status, To send list with counter, one-tap send, offers and customers.
- Tracking link `/?track=FT-…` + mobile number shows live status.

## Please also check
- WhatsApp opening from the staff phone (WhatsApp app vs WhatsApp Web).
- Automatic sending with your own Meta account and approved templates (WHATSAPP_SETUP.md).
- First-time owner setup on your real deployment with your own `ADMIN_SETUP_CODE`.
