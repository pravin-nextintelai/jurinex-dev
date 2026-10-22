-- Payment storage, GST breakdown, Razorpay invoice references, order snapshots, webhook
-- idempotency, refunds and application-generated invoices.
--
-- Idempotent: safe to run on every start-up (IF NOT EXISTS guards + guarded backfills).
-- Non-destructive: only ADD COLUMN / CREATE TABLE / CREATE INDEX / guarded UPDATE of NULL columns.
-- The existing `payments.amount` (NUMERIC rupees) keeps its meaning; new *_paise columns are added
-- beside it and the dashboards read rupees via paise / 100.

-- ───────────────────────────── payments ─────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS plan_id                   INTEGER,
  ADD COLUMN IF NOT EXISTS monthly_plan_id           INTEGER,
  ADD COLUMN IF NOT EXISTS plan_source               VARCHAR(30),
  ADD COLUMN IF NOT EXISTS plan_name                 VARCHAR(150),
  ADD COLUMN IF NOT EXISTS user_name                 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS user_email                VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_invoice_id       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_invoice_number   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_receipt          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_status           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS amount_paise              BIGINT,
  ADD COLUMN IF NOT EXISTS amount_refunded_paise     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS basic_amount_paise        BIGINT,
  ADD COLUMN IF NOT EXISTS cgst_rate                 NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS cgst_amount_paise         BIGINT,
  ADD COLUMN IF NOT EXISTS sgst_rate                 NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS sgst_amount_paise         BIGINT,
  ADD COLUMN IF NOT EXISTS igst_rate                 NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS igst_amount_paise         BIGINT,
  ADD COLUMN IF NOT EXISTS total_amount_paise        BIGINT,
  ADD COLUMN IF NOT EXISTS tax_basis                 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tax_type                  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tax_calculated_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tax_metadata              JSONB,
  ADD COLUMN IF NOT EXISTS purchase_date             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS captured_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_source       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subscription_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_invoice_id            INTEGER,
  ADD COLUMN IF NOT EXISTS razorpay_payload          JSONB,
  ADD COLUMN IF NOT EXISTS updated_at                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Unique Razorpay payment id (constraint usually already exists as payments_razorpay_payment_id_key).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'payments'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%(razorpay_payment_id)%'
  ) THEN
    CREATE UNIQUE INDEX idx_payments_razorpay_payment_id ON payments (razorpay_payment_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_user_created     ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order            ON payments (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status_purchase  ON payments (status, purchase_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_invoice_id
  ON payments (razorpay_invoice_id) WHERE razorpay_invoice_id IS NOT NULL;

-- ─────────────────────── payment_orders (server-side order snapshot) ───────────────────────
-- Written when the backend creates a Razorpay order; the tax breakdown is frozen here and reused at
-- verification so the browser can never influence price or tax.
CREATE TABLE IF NOT EXISTS payment_orders (
  id                   SERIAL PRIMARY KEY,
  razorpay_order_id    VARCHAR(100)  NOT NULL UNIQUE,
  user_id              INTEGER       NOT NULL,
  plan_source          VARCHAR(30)   NOT NULL,          -- 'monthly_plans' | 'subscription_plans'
  plan_id              INTEGER       NOT NULL,
  plan_name            VARCHAR(150),
  receipt              VARCHAR(100),
  currency             VARCHAR(10)   NOT NULL DEFAULT 'INR',
  amount_paise         BIGINT        NOT NULL,          -- amount sent to Razorpay (the total)
  basic_amount_paise   BIGINT        NOT NULL,
  cgst_rate            NUMERIC(5, 2),
  cgst_amount_paise    BIGINT        NOT NULL DEFAULT 0,
  sgst_rate            NUMERIC(5, 2),
  sgst_amount_paise    BIGINT        NOT NULL DEFAULT 0,
  igst_rate            NUMERIC(5, 2),
  igst_amount_paise    BIGINT        NOT NULL DEFAULT 0,
  tax_basis            VARCHAR(20),
  tax_type             VARCHAR(20),
  tax_calculated_at    TIMESTAMPTZ,
  tax_metadata         JSONB,
  status               VARCHAR(20)   NOT NULL DEFAULT 'created',  -- created | paid | failed
  razorpay_payment_id  VARCHAR(100),
  notes                JSONB,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders (user_id, created_at DESC);

-- ─────────────────────── payment_webhook_events (idempotent webhook log) ───────────────────────
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                        SERIAL PRIMARY KEY,
  event_id                  VARCHAR(120) NOT NULL UNIQUE,  -- x-razorpay-event-id (or body hash)
  event                     VARCHAR(80)  NOT NULL,
  razorpay_payment_id       VARCHAR(100),
  razorpay_order_id         VARCHAR(100),
  razorpay_subscription_id  VARCHAR(100),
  status                    VARCHAR(20)  NOT NULL DEFAULT 'received', -- received | processed | failed | ignored
  attempts                  INTEGER      NOT NULL DEFAULT 0,
  error                     TEXT,
  payload                   JSONB        NOT NULL,
  received_at               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_payment ON payment_webhook_events (razorpay_payment_id);

-- ─────────────────────────────── payment_refunds ───────────────────────────────
CREATE TABLE IF NOT EXISTS payment_refunds (
  id                   SERIAL PRIMARY KEY,
  razorpay_refund_id   VARCHAR(100) NOT NULL UNIQUE,
  razorpay_payment_id  VARCHAR(100) NOT NULL,
  payment_id           INTEGER REFERENCES payments(id),
  amount_paise         BIGINT       NOT NULL,
  currency             VARCHAR(10),
  status               VARCHAR(30),
  speed                VARCHAR(20),
  notes                JSONB,
  razorpay_created_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds (razorpay_payment_id);

-- ─────────────────── app_invoices (application-generated, NOT Razorpay invoices) ───────────────────
CREATE TABLE IF NOT EXISTS app_invoice_sequences (
  fiscal_year  VARCHAR(9) PRIMARY KEY,   -- e.g. '2026-27' (Indian FY, April–March)
  last_value   INTEGER    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_invoices (
  id                  SERIAL PRIMARY KEY,
  invoice_number      VARCHAR(40)  NOT NULL UNIQUE,     -- e.g. 'NXI/2026-27/000001'
  invoice_kind        VARCHAR(30)  NOT NULL DEFAULT 'application_generated',
  payment_id          INTEGER      NOT NULL UNIQUE REFERENCES payments(id),
  user_id             INTEGER      NOT NULL,
  fiscal_year         VARCHAR(9)   NOT NULL,
  sequence_no         INTEGER      NOT NULL,
  currency            VARCHAR(10)  NOT NULL DEFAULT 'INR',
  basic_amount_paise  BIGINT       NOT NULL,
  cgst_amount_paise   BIGINT       NOT NULL DEFAULT 0,
  sgst_amount_paise   BIGINT       NOT NULL DEFAULT 0,
  igst_amount_paise   BIGINT       NOT NULL DEFAULT 0,
  total_amount_paise  BIGINT       NOT NULL,
  issued_at           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_invoices_user ON app_invoices (user_id, issued_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_app_invoice_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_app_invoice_id_fkey FOREIGN KEY (app_invoice_id) REFERENCES app_invoices(id);
  END IF;
END $$;

-- ───────────────────────────── backfill existing rows ─────────────────────────────
-- Lossless: amount (NUMERIC 10,2 rupees) → integer paise.
UPDATE payments
   SET amount_paise              = ROUND(amount * 100)::BIGINT,
       total_amount_paise        = ROUND(amount * 100)::BIGINT,
       purchase_date             = COALESCE(purchase_date, created_at),
       razorpay_status           = COALESCE(razorpay_status, status),
       captured_at               = COALESCE(captured_at, CASE WHEN status = 'captured' THEN created_at END),
       subscription_activated_at = COALESCE(subscription_activated_at, CASE WHEN status = 'captured' THEN created_at END),
       verification_source       = COALESCE(verification_source, 'legacy')
 WHERE amount_paise IS NULL;

-- Derived: the historical invoices/receipts always showed the charged amount as 18% GST-inclusive
-- split into CGST 9% + SGST 9%. Reproduce exactly that for old rows and mark them as backfilled.
--   basic = round(total * 10000 / 11800) ; cgst = round(total * 900 / 11800) ; sgst = remainder
UPDATE payments
   SET basic_amount_paise = (total_amount_paise * 20000 + 11800) / 23600,
       cgst_rate          = 9.00,
       cgst_amount_paise  = (total_amount_paise * 1800 + 11800) / 23600,
       sgst_rate          = 9.00,
       igst_rate          = 0.00,
       igst_amount_paise  = 0,
       tax_basis          = 'inclusive',
       tax_type           = 'CGST_SGST',
       tax_calculated_at  = CURRENT_TIMESTAMP,
       tax_metadata       = jsonb_build_object(
                              'backfilled', true,
                              'rule', 'legacy_backfill_inclusive_18_cgst_sgst',
                              'basis', 'inclusive',
                              'tax_type', 'CGST_SGST',
                              'gst_rate_percent', 18,
                              'calculated_at', CURRENT_TIMESTAMP)
 WHERE tax_calculated_at IS NULL
   AND total_amount_paise IS NOT NULL
   AND UPPER(COALESCE(currency, 'INR')) = 'INR';

UPDATE payments
   SET basic_amount_paise = total_amount_paise,
       cgst_rate = 0.00, cgst_amount_paise = 0,
       sgst_rate = 0.00, sgst_amount_paise = 0,
       igst_rate = 0.00, igst_amount_paise = 0,
       tax_basis = 'none', tax_type = 'NONE',
       tax_calculated_at = CURRENT_TIMESTAMP,
       tax_metadata = jsonb_build_object('backfilled', true, 'rule', 'legacy_backfill_non_inr_no_gst',
                                         'calculated_at', CURRENT_TIMESTAMP)
 WHERE tax_calculated_at IS NULL
   AND total_amount_paise IS NOT NULL;

UPDATE payments
   SET sgst_amount_paise = total_amount_paise - basic_amount_paise - cgst_amount_paise
 WHERE sgst_amount_paise IS NULL
   AND basic_amount_paise IS NOT NULL
   AND cgst_amount_paise IS NOT NULL;
