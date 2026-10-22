-- One professional invoice number for every emailed invoice.
-- Plan payments already use app_invoices.payment_id. Top-ups and storage
-- add-ons have no payments row, so they are stored by source_kind + source_id
-- and share the same fiscal-year sequence (JNX/2026-27/000001).

ALTER TABLE app_invoices ALTER COLUMN payment_id DROP NOT NULL;

ALTER TABLE app_invoices
  ADD COLUMN IF NOT EXISTS source_kind VARCHAR(30) NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS source_id INTEGER;

UPDATE app_invoices
   SET source_id = payment_id
 WHERE source_kind = 'payment'
   AND source_id IS NULL
   AND payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_invoices_source
  ON app_invoices (source_kind, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE user_token_topup_purchases
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_token_topup_invoice
  ON user_token_topup_purchases (invoice_number)
  WHERE invoice_number IS NOT NULL;

ALTER TABLE user_storage_addon_purchases
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_storage_addon_invoice
  ON user_storage_addon_purchases (invoice_number)
  WHERE invoice_number IS NOT NULL;
