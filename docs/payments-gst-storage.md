# Razorpay payment storage, GST breakdown and invoices

**Date:** 2026-10-15 · **Service:** `Backend/payment-service` (Node, raw `pg`) · **Database:** Payment DB (`DATABASE_URL`)

This change makes every successful plan purchase land in PostgreSQL with the user, plan, Razorpay
identifiers, integer-paise amounts, a GST split (CGST+SGST or IGST) and invoice references, through one
trusted server-side path shared by checkout verification and Razorpay webhooks.

## 1. What the existing integration does (inspection results)

| Question | Answer |
| --- | --- |
| Which Razorpay APIs are used? | Orders + Payments (monthly plans, legacy one-time plans), Subscriptions (plans with `razorpay_plan_id`). The Razorpay **Invoices API is never called**. |
| Are plan prices tax-inclusive? | Yes. Checkout charges `plan.price` as-is and both the backend PDF and the frontend invoice template split it as 18 % inclusive. Default basis is therefore `inclusive`. |
| Does Razorpay create invoices for these payments? | Only for Razorpay-managed subscription charges (`payment.invoice_id = inv_…`). Plain order payments have no invoice, so the Razorpay invoice fields stay NULL. |
| Where are payments stored? | `payments` (one row per Razorpay payment, `razorpay_payment_id` UNIQUE), `user_subscriptions` (one row per user). Top-ups and storage add-ons have their own tables and are unchanged. |
| Migrations | The service has no Sequelize; schema changes run from `src/utils/applyMigrations.js` at start-up (idempotent SQL). The new migration follows that mechanism (single SQL file loaded by the runner). |
| Webhooks | `routes/webhookRoutes.js` existed but was **never mounted**, and the handler signed `JSON.stringify(req.body)` instead of the raw body. Fixed. |
| Transactions | Verify handlers ran `BEGIN`/`COMMIT` through the pool (different connections), so nothing was transactional. Replaced by `withTransaction(pool, fn)` on one client. |
| Admin dashboard | The super-admin panel is a separate project. No admin code lives in this service; §6 lists the Payment DB columns that panel should read. |

## 2. Modified / new files

### Backend (`Backend/payment-service`)

| File | Change |
| --- | --- |
| `db/migrations/2026-10-15_payment_tax_invoice_webhooks.sql` | **New.** Columns on `payments`; tables `payment_orders`, `payment_webhook_events`, `payment_refunds`, `app_invoices`, `app_invoice_sequences`; indexes; guarded backfill. |
| `src/utils/applyMigrations.js` | Loads the SQL file above as migration `payment_tax_invoice_webhooks_2026_10_15`. |
| `src/utils/gst.js` | **New.** Integer-paise GST arithmetic (BigInt, half-up rounding, remainder absorbed by SGST/IGST), rupee↔paise conversions without floats. |
| `src/services/taxService.js` | **New.** Tax config from env, Indian GST state codes, place-of-supply resolution (CGST+SGST vs IGST), breakdown + metadata builder. |
| `src/services/customerProfileService.js` | **New.** Reads name/email/state (firm state or user location) from the auth DB for the purchase snapshot. |
| `src/utils/withTransaction.js` | **New.** Real transaction helper on a dedicated pooled client. |
| `src/services/paymentFinalizeService.js` | **New.** The single trusted path: order snapshot, Razorpay re-fetch, amount/currency/user cross-checks, capture of authorized payments, payments upsert, once-only activation gate, Razorpay invoice fetch, app invoice issue, refunds, failed payments. |
| `src/services/razorpayWebhookService.js` | **New.** Raw-body HMAC (constant-time), idempotent event log (`x-razorpay-event-id`), dispatch for payment/refund/subscription events. |
| `src/services/purchasePostCommitService.js` | **New.** Post-commit token reset, auth plan sync, confirmation e-mail. |
| `src/controllers/paymentController.js` | `createOneTimeOrder` prices from `subscription_plans` (browser amount ignored) and snapshots the order; `verifySubscription`, `verifyOneTimePayment`, `handleWebhook` use the shared path; `getUserPaymentHistory` returns the GST split and invoice numbers. Old webhook handlers removed. |
| `src/controllers/monthlyPlansController.js` | Order creation snapshots price + GST in `payment_orders`; `verifyMonthlySubscription` uses the shared path. |
| `src/routes/webhookRoutes.js`, `index.js` | Webhook router mounted **before** `express.json()` with the raw body. |
| `src/services/proformaPdf.js` | Prints stored BASIC / CGST / SGST / IGST lines, the application invoice number, the Razorpay invoice number when present. No more `INV-<payment id>`. |
| `src/services/purchaseEmailService.js` | Passes the breakdown and invoice numbers to the mail and PDFs. |
| `package.json` | `npm test` runs `node --test "test/*.test.js"`. |
| `test/gst.test.js`, `test/paymentFinalize.test.js`, `test/razorpayWebhook.test.js` | **New.** 57 tests in total with the existing error-log suite; all pass. |

### Frontend (`frontend/src`)

| File | Change |
| --- | --- |
| `pages/SubscriptionPlanPage.jsx` | Checkout uses the server-created order amount/currency instead of the plan card price. |
| `utils/billingProformaTemplate.js` | Invoice number = `app_invoice_number` (never derived from the payment id); BASIC / CGST / SGST / IGST from the stored breakdown; legacy rows keep the old indicative split. |
| `pages/BillingAndUsagePage.jsx` | CSV export adds Basic, CGST, SGST, IGST, Total, Order ID, Invoice No, Razorpay Invoice No. |

## 3. Schema

### `payments` (existing table, columns added — nothing removed or re-typed)

| Column | Type | Meaning |
| --- | --- | --- |
| `plan_id` / `monthly_plan_id` / `plan_source` / `plan_name` | int / int / varchar / varchar | Which plan table and row was bought; name snapshot. |
| `user_name`, `user_email` | varchar | Snapshot from the auth DB at purchase time. |
| `razorpay_subscription_id` | varchar | For Razorpay-managed subscription charges. |
| `razorpay_invoice_id`, `razorpay_invoice_number` | varchar | **Genuine Razorpay invoice only** (`payment.invoice_id` → `invoices.fetch`). NULL for order payments. Unique partial index on the id. |
| `razorpay_receipt` | varchar | The `receipt` we sent when creating the order ("Receipt ID"). |
| `razorpay_status` | varchar | Raw Razorpay status (`captured`, `authorized`, `failed`…). `status` adds `refunded` / `partially_refunded`. |
| `amount_paise`, `total_amount_paise`, `amount_refunded_paise` | bigint | Integer paise as reported by Razorpay. `amount` (NUMERIC rupees) is kept and still written. |
| `basic_amount_paise`, `cgst_rate`, `cgst_amount_paise`, `sgst_rate`, `sgst_amount_paise`, `igst_rate`, `igst_amount_paise` | bigint / numeric(5,2) | GST split. Rates are percentages (9.00). |
| `tax_basis`, `tax_type`, `tax_calculated_at`, `tax_metadata` | varchar / varchar / timestamptz / jsonb | `inclusive`/`exclusive`/`none`; `CGST_SGST`/`IGST`/`NONE`; timestamp; rule, states, rounding note. |
| `purchase_date`, `captured_at`, `verification_source` | timestamptz / timestamptz / varchar | Razorpay creation time; capture time; `checkout`, `webhook` or `legacy`. |
| `subscription_activated_at` | timestamptz | Once-only activation gate. |
| `app_invoice_id` | int → `app_invoices.id` | Application-generated invoice. |
| `razorpay_payload` | jsonb | Sanitised payment entity for reconciliation (no card/bank/contact data). |
| `refund_status`, `updated_at` | | |

Indexes: `(user_id, created_at DESC)`, `(razorpay_order_id)`, `(status, purchase_date DESC)`, unique partial on `razorpay_invoice_id`; the existing unique `razorpay_payment_id` constraint is kept (created only if missing).

### New tables

- **`payment_orders`** — server-side snapshot per Razorpay order: user, plan, receipt, amount and the frozen GST split, `status` `created`/`paid`/`failed`. The verify step and the webhook read the breakdown from here, so the browser cannot influence price or tax.
- **`payment_webhook_events`** — one row per `x-razorpay-event-id` (or body hash), status `received`/`processed`/`failed`/`ignored`, attempts, error, payload. Duplicate deliveries are acknowledged without reprocessing.
- **`payment_refunds`** — one row per Razorpay refund id; `payments.amount_refunded_paise` / `refund_status` / `status` are updated from them.
- **`app_invoices`** + **`app_invoice_sequences`** — application-generated invoices, `invoice_kind = 'application_generated'`, number `NXI/2026-27/000001` (prefix `APP_INVOICE_PREFIX`, Indian fiscal year, per-year sequence allocated atomically inside the payment transaction). One per captured payment.

### Backfill of the 49 existing rows (verified on the dev DB inside a rolled-back transaction)

- `amount_paise = total_amount_paise = ROUND(amount × 100)` — lossless for every row.
- GST split reproduces what the historical invoices showed (18 % inclusive, CGST 9 % + SGST 9 %), marked `tax_metadata.backfilled = true`, rule `legacy_backfill_inclusive_18_cgst_sgst`. Parts sum to the total on every row.
- `purchase_date = created_at`, `verification_source = 'legacy'`, `subscription_activated_at = created_at` for captured rows.
- Nothing is dropped, renamed or re-typed. The migration ran twice in a row without error (idempotent).

## 4. GST calculation

`src/utils/gst.js`, integer paise only (BigInt), half-up rounding:

```
inclusive:  basic = round(total × 10000 / (10000 + rate_bp))
            CGST  = round(total × (rate_bp / 2) / (10000 + rate_bp))   ← from the unrounded basic
            SGST  = total − basic − CGST                                ← absorbs rounding
            IGST  = total − basic
exclusive:  CGST = SGST = round(basic × (rate_bp / 2) / 10000) ; total = basic + CGST + SGST
```

₹100 inclusive → basic 84.75, CGST 7.63, SGST 7.62, total 100.00. A test sweeps every paise value from 1 to 200 000 and checks `basic + CGST + SGST + IGST = total`.

Tax treatment (`taxService.resolveTaxTreatment`):

| Situation | Result |
| --- | --- |
| customer state = `BUSINESS_STATE` | intra-state → CGST + SGST (rate / 2 each) |
| customer state ≠ `BUSINESS_STATE` | inter-state → IGST (full rate) |
| customer state unknown, or `BUSINESS_STATE` unset | `GST_DEFAULT_SUPPLY_TYPE` (default `intra`, matching current invoices) |
| currency ≠ INR | no GST split (`tax_type = NONE`, rule recorded) |
| `GST_ENABLED=false` | no GST split |

Customer state comes from `firms.state` (firm admin or member) or `users.location` in the auth DB; the source is recorded in `tax_metadata.customer_state_source`. State names and GST codes are normalised (`"Mumbai, Maharashtra"` → 27).

## 5. Payment flow

1. **Order creation** (`/monthly-plans/subscribe/start`, `/order/create`): plan loaded by id, price → paise, breakdown computed with the customer's state, Razorpay order created with that amount, `payment_orders` row written with the frozen breakdown. Response includes `order.amount` (which the checkout now uses) and `tax`.
2. **Checkout verify** (`/monthly-plans/subscribe/verify`, `/order/verify`, `/subscription/verify`): HMAC of `order_id|payment_id` (or `payment_id|subscription_id`) checked in constant time, then `finalizePayment` inside one transaction:
   - `payment_orders` row locked (`FOR UPDATE`); the order must belong to the authenticated user;
   - payment re-fetched from Razorpay (`payments.fetch`). If Razorpay is unreachable the request fails with 502 and nothing is written — the webhook completes the purchase later;
   - `order_id`, currency, amount (must equal the snapshot) and `notes.app_user_id` are cross-checked; the plan id/name from the body is only a fallback for pre-existing orders;
   - `authorized` payments are captured with the expected amount; if capture fails the row is stored as `authorized`, nothing is activated and the API answers `202 pending`;
   - `payments` upsert on `razorpay_payment_id` (status never downgrades from captured/refunded);
   - activation runs only if `UPDATE payments SET subscription_activated_at … WHERE subscription_activated_at IS NULL` returns the row — exactly once per payment, even with concurrent checkout + webhook;
   - `app_invoices` row issued; `payment_orders.status = 'paid'`.
   After COMMIT: token reset, auth plan sync, e-mail (best effort).
3. **Webhook** (`POST /api/payments/webhooks/razorpay`, raw body): signature over the exact bytes with `RAZORPAY_WEBHOOK_SECRET`; event row inserted (`ON CONFLICT` → duplicate acknowledged with 200); `payment.captured`/`payment.authorized` → the same `finalizePayment`; `payment.failed` → failed row; `refund.*` → `payment_refunds` + refunded amount/status; `subscription.*` → status updates / `subscription.charged` → `finalizePayment`. A processing error answers 500 (row marked `failed`) so Razorpay retries; the retry re-processes it.

Nothing from the browser decides user, price, tax, status or invoice number.

## 6. Columns for the separate admin panel

The admin panel is its own project and reads the Payment DB directly. Filter `payments.status = 'captured'`
for successful purchases; `authorized`, `failed`, `refunded` and `partially_refunded` rows are not purchases.

| Dashboard column | Payment DB source |
| --- | --- |
| Username / Email | `payments.user_name` / `payments.user_email` (snapshot at purchase; fall back to auth `users` by `payments.user_id`) |
| Sales Owner / Owner Type / Referral Code / User Status | auth DB (`user_referrals` or `tenant_referrals` → `referral_codes` → `sales_owners`, `users`) joined on `payments.user_id` |
| Plan | `payments.plan_name` (older rows: join `monthly_plans` / `subscription_plans` via `user_subscriptions`) |
| Basic Amount (INR) | `basic_amount_paise / 100` |
| CGST 9% (INR) | `cgst_amount_paise / 100` (`cgst_rate` holds the percentage) |
| SGST 9% (INR) | `sgst_amount_paise / 100` (`sgst_rate`) |
| IGST (INR) | `igst_amount_paise / 100` (`igst_rate`) |
| Total Amount (INR) | `total_amount_paise / 100` (amount charged) |
| Purchase Date | `purchase_date` |
| Invoice No | `razorpay_invoice_number` — **empty unless Razorpay created an invoice** (only subscription charges) |
| App Invoice No | `app_invoices.invoice_number` via `payments.app_invoice_id` (application-generated) |
| Receipt ID | `razorpay_receipt` |
| Order ID | `razorpay_order_id` |
| Payment ID | `razorpay_payment_id` (unique; use for reconciliation) |
| Refunds | `amount_refunded_paise`, `refund_status`, `payment_refunds` |

User-side: `GET /api/payments/history` now also returns `basic_amount`, `cgst_rate`, `cgst_amount`, `sgst_rate`, `sgst_amount`, `igst_rate`, `igst_amount`, `total_amount`, `amount_refunded`, `tax_type`, `tax_basis`, `razorpay_invoice_number`, `razorpay_receipt`, `app_invoice_number`; `amount` is unchanged.

## 7. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_SECRET` | yes (existing) | | Razorpay API; secret never leaves the backend. |
| `RAZORPAY_WEBHOOK_SECRET` | yes (existing) | | Webhook HMAC secret from the Razorpay dashboard. |
| `AUTH_DATABASE_URL` | recommended (existing) | | Name/email/state snapshot on each payment. Without it those fields are NULL; payments still work. |
| `BUSINESS_STATE` | recommended | unset | Supplier state name or GST code (e.g. `Maharashtra` / `27`). Needed for IGST decisions. |
| `GST_ENABLED` | no | `true` | `false` stores no tax split. |
| `GST_RATE_PERCENT` | no | `18` | Total GST rate. |
| `GST_PRICE_BASIS` | no | `inclusive` | `inclusive` (plan prices contain GST — current behaviour) or `exclusive` (GST added on top; the charged amount changes). |
| `GST_DEFAULT_SUPPLY_TYPE` | no | `intra` | Used when the customer's state is unknown or `BUSINESS_STATE` is unset: `intra` → CGST+SGST, `inter` → IGST. |
| `APP_INVOICE_ENABLED` | no | `true` | Issue application invoices. |
| `APP_INVOICE_PREFIX` | no | `NXI` | Invoice number prefix. |

## 8. Migration and deployment

1. **Back up** the Payment DB (`pg_dump`). The migration only adds columns/tables and updates NULL columns, but back up anyway.
2. Set the new env vars (at least `BUSINESS_STATE`).
3. Deploy `Backend/payment-service`; the migration runs at start-up (`[Migration] ✅ payment_tax_invoice_webhooks_2026_10_15` in the log). To run it by hand instead:
   ```bash
   psql "$DATABASE_URL" -f Backend/payment-service/db/migrations/2026-10-15_payment_tax_invoice_webhooks.sql
   ```
   It is safe to run repeatedly.
4. In the Razorpay dashboard → Webhooks, point the webhook at the payment-service's public URL
   `https://<payment-service>/api/payments/webhooks/razorpay` (not the gateway, which requires a user JWT), with the same secret as `RAZORPAY_WEBHOOK_SECRET`, and enable `payment.captured`, `payment.authorized`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.completed`.
5. Deploy the frontend (checkout amount from the order; invoice template reads the stored split).
6. Verify: make a test purchase, then
   ```sql
   SELECT razorpay_payment_id, razorpay_order_id, razorpay_receipt, amount_paise, basic_amount_paise,
          cgst_amount_paise, sgst_amount_paise, igst_amount_paise, tax_type, razorpay_invoice_number,
          app_invoice_id, subscription_activated_at FROM payments ORDER BY id DESC LIMIT 1;
   SELECT * FROM payment_webhook_events ORDER BY id DESC LIMIT 5;
   ```

Tests: `cd Backend/payment-service && npm test` (57 tests: GST rounding incl. the ₹100 example and a 1–200 000 paise sweep; successful, duplicate, mismatched, failed, authorized, subscription-with-invoice, inter-state and refunded payments; webhook signature, duplicate delivery, retry after failure, event dispatch).

## 9. Notes and assumptions

- **Sequelize** was requested but the service does not use an ORM; adding one for a single migration would create a parallel schema system, so the existing SQL migration runner is used.
- **Backfilled GST** on historical rows is derived (not what Razorpay reported — Razorpay never reported a tax split); it is flagged in `tax_metadata.backfilled`.
- **Top-up and storage add-on** purchases keep their own tables and verify handlers; webhook `payment.captured` events for them are logged as `ignored` (no plan context). The GST utility can be reused there later.
- `express.json()` still parses every other route; only `/api/payments/webhooks` receives the raw body.
