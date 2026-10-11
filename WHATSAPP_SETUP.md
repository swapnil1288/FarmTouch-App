# WhatsApp messages to customers: setup

The app sends a WhatsApp message to the customer when:

| Event | Example message |
|---|---|
| Order placed | “Your order FT-… has been placed successfully ✅” with items, total, delivery slot, address and a tracking link. Sent to the **customer’s own number** (the one typed at checkout) |
| Order confirmed | “Your order FT-… is confirmed. Delivery Fri 9 Oct, 9 AM – 12 PM. Total ₹…” |
| **Order changed** (item unavailable / quantity changed) | “Tomato 3 → 2; Spinach removed. New total ₹… (was ₹…)” |
| Out for delivery | Delivery partner’s name and phone, amount to keep ready |
| **Delivered + payment** | “Delivered. Payment received ₹…”. If less was paid, it also shows the balance due |
| Delivery missed | Reason, and that the shop will call to reschedule |
| **Cancelled** | By the customer or the shop, with the reason |
| **Offers** | Only to customers who ticked “Send me offers on WhatsApp” |

Every message is saved in **/admin → WhatsApp**, with its status: sent automatically, waiting to be sent, sent by staff, failed (with the reason), or not sent (no consent).

There are two ways to send them.

---

## Option A: One-tap sending (works today, free, no setup)

If the WhatsApp Business API is not set up, nothing is sent automatically. Instead:

1. After a staff action (Confirm, Change items, Start delivery, Delivered…), a **“Tell the customer”** box appears with the message ready.
2. Tap **Send on WhatsApp**. WhatsApp (app or WhatsApp Web) opens with the customer’s number and the text filled in. Press **Send**.
3. Messages you skip (**Later**) and new-order messages wait in **/admin → WhatsApp → To send**, with a counter on the menu.

Use the shop’s WhatsApp (ideally WhatsApp Business) on the phone or computer that runs the staff panel.

---

## Option B: Fully automatic (WhatsApp Business Platform / Cloud API)

Messages go out on their own the moment something happens. Meta charges per delivered **template** message: marketing templates (offers) and utility templates (order updates) outside a 24-hour chat window. Utility templates sent within 24 hours of the customer messaging you are free. Check Meta’s current rates for India before going live: https://developers.facebook.com/docs/whatsapp/pricing

### 1. Create the Meta app and number (about 1 hour, plus business verification)
1. Go to https://developers.facebook.com/apps → **Create app** → choose **“Connect with customers through WhatsApp”** → select or create your **business portfolio**.
2. Open **WhatsApp → API Setup**. Add your shop’s phone number and verify it by SMS or call. That number then can’t be used in the normal WhatsApp app, so use a separate SIM if you want to keep chatting by phone.
3. Copy the **Phone number ID** shown there.
4. Create a **permanent token**: Business Settings → **System users** → Add (Admin) → **Assign assets**: your app and WhatsApp account (full control) → **Generate token** with the permissions `whatsapp_business_messaging`, `whatsapp_business_management` and `business_management`. Copy the token and keep it secret.
5. Complete **Business verification** in Meta Business Settings. This is needed to message more customers per day.

### 2. Create two message templates (WhatsApp Manager → Message templates)

**Template 1: order updates**
- Name: `order_update` · Category: **Utility** · Language: **English**
- Body:
  ```
  Hi {{1}}, update on your Farm's Touch order {{2}}: {{3}}
  ```
- Example values: `Asha` · `FT-1A2B3C4D` · `your order is out for delivery with Ravi (9822012345). Please keep ₹410 ready (cash or UPI).`

**Template 2: offers**
- Name: `offer_update` · Category: **Marketing** · Language: **English**
- Body:
  ```
  Hi {{1}}, {{2}} Order now on Farm's Touch. Reply STOP to stop offers.
  ```
- Example values: `Asha` · `This weekend: 20% off all fruits!`

Approval usually takes from a few minutes to a day.

### 3. Add the settings
Locally, add these to `.dev.vars`. When hosted, set them as Worker variables or secrets (the token must be a **secret**):

```
WHATSAPP_STORE_NUMBER=919876543210
WHATSAPP_TOKEN=EAAG...                 # secret
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_UPDATE_TEMPLATE=order_update
WHATSAPP_OFFER_TEMPLATE=offer_update
WHATSAPP_TEMPLATE_LANG=en
SHOP_URL=https://your-shop-address      # used for the “Track your order” link
```

Restart the app. In **/admin → WhatsApp**, the setup card should show **Automatic sending ON**. Use **Send test** to message your own phone.

### Good to know
- If sending fails (template not approved, wrong number, Meta limit), the message shows **Failed** with Meta’s reason. You can **Retry automatically** or **Send on WhatsApp** by hand.
- Without `WHATSAPP_UPDATE_TEMPLATE`, automatic messages only reach customers who messaged your number in the last 24 hours. That’s Meta’s rule.
- Customers choose at checkout: **order updates** (on by default) and **offers** (off by default). If someone replies STOP, switch them off in **/admin → WhatsApp → Customers**.
- **Both sides on every new order:** the customer gets “order placed successfully” on their own number, and **Farm’s Touch** (`WHATSAPP_STORE_NUMBER`) gets a “🧺 New order” alert with items, total, customer name, phone and address. Both appear in **/admin → WhatsApp**.
- The shop alert is a free-form message, so it only reaches the store number if that number messaged your business number in the last 24 hours (send it a “hi” once a day), or if you set an approved `WHATSAPP_ORDER_TEMPLATE` (`{{1}}` order id, `{{2}}` customer, `{{3}}` total, `{{4}}` slot). The store number must be **different** from the API sender number.
- Without the API, the success screen shows the customer a **“Send order to Farm’s Touch on WhatsApp”** button, and the shop sends the customer’s confirmation with one tap from /admin → WhatsApp.
