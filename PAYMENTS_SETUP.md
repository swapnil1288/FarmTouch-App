# Razorpay payments

The shop uses Razorpay Standard Checkout for online payments. The customer browser receives only the public Key ID. The server creates the Razorpay order from server-calculated prices, captures an authorized payment if needed, verifies the payment signature and exact INR amount, and only then creates the fulfillment order.

## Test Mode setup

1. Create or sign in to your Razorpay account and switch the Dashboard to **Test Mode**.
2. Open **Account & Settings → API Keys** and generate a Test Key ID and Key Secret.
3. Copy `.dev.vars.example` to `.dev.vars` if you have not already done so. Set these values in `.dev.vars`:

   ```dotenv
   RAZORPAY_KEY_ID=rzp_test_your_key_id
   RAZORPAY_KEY_SECRET=your_test_key_secret
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
   ```

   Keep the Key Secret and webhook secret private. Do not paste them in chat, commit them, or add them to client code.

4. In the Razorpay Dashboard, create a webhook pointing to `https://YOUR_PUBLIC_DOMAIN/api/payments/razorpay/webhook`. For local testing, expose the local server through a secure tunnel and use that HTTPS URL.
5. Subscribe to `payment.captured` and `refund.processed`. Set the webhook secret to the same value as `RAZORPAY_WEBHOOK_SECRET`.
6. Apply the database migration and start the app:

   ```powershell
   pnpm build
   pnpm run db:local
   pnpm run dev
   ```

7. Place a small test order with Pay online. Use Razorpay's official [Standard Checkout test instructions](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/) for test payment details. Verify the order is placed only after checkout reports a captured payment, then test failure, cancellation and refund behavior.

Open order history or tracking to confirm a paid order says **Paid online**. Rider screens should show no cash due for it. Cancelling a captured online order requests a full refund; if the request fails, the order is marked for store follow-up. Razorpay's `refund.processed` webhook updates the order when processing completes.

Unfinished online checkouts hold inventory for up to 30 minutes. Expired holds are released on catalog refresh. A captured payment arriving after its hold expires is sent for refund instead of creating an unreserved order.

## Production go-live

- Complete Razorpay account activation and required business verification.
- Switch the Razorpay Dashboard to **Live Mode** and generate live keys.
- Configure `RAZORPAY_KEY_ID` as a Worker variable, and configure `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` as Worker secrets. Never reuse Test Mode credentials in production.
- Set the production webhook URL and verify both webhook events are enabled in Live Mode.
- Apply all D1 migrations to the production database and test successful payment, failed payment, late payment, order cancellation and refund before accepting customers.
- Enable automatic capture in Razorpay if available. The app also captures an authorized payment server-side before creating the order.

Razorpay processing fees and settlement timing depend on your account and current provider terms. Check the Razorpay Dashboard before accepting live payments.