-- 187_error_summary.sql
-- A plain-language reason on every stored error, written for non-technical readers:
--   "The payment gateway (Razorpay) rejected our credentials (API key or token), so the call was refused."
--   "The request failed because the user was not logged in or the session had expired (HTTP 401)."
-- Filled by the errorlog module from the error's category, provider, status and type.
-- NULL on successful audit rows. Idempotent; also applied on first connect.

ALTER TABLE error_logs     ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500);
