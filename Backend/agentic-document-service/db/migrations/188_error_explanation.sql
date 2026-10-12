-- 188_error_explanation.sql
-- Three fields the admin "error detail" view shows, on both tables:
--   error_code     stable machine code: AUTH_EXPIRED, PERMISSION_DENIED, NOT_FOUND, VALIDATION_ERROR,
--                  INTERNAL_ERROR, AI_QUOTA_EXCEEDED, AI_SAFETY_BLOCK, UPSTREAM_AUTH_FAILED, UPSTREAM_TIMEOUT,
--                  DATABASE_UNAVAILABLE, PAYMENT_CANCELLED, BROWSER_NETWORK_ERROR, JOB_FAILED, PROCESS_CRASH …
--   what_happened  "The user tried to open the plan details, but the request was refused (HTTP 403)."
--   suggested_fix  "User: log in again. Developers: renew the token before it expires …"
-- Together with error_summary ("why it happened"), user_message ("what the user saw") and
-- error_message / stack_trace ("exact error"). NULL on successful audit rows.
-- Idempotent; also applied on first connect by the errorlog module.

ALTER TABLE error_logs     ADD COLUMN IF NOT EXISTS error_code    VARCHAR(50);
ALTER TABLE error_logs     ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500);
ALTER TABLE error_logs     ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_code    VARCHAR(50);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000);
CREATE INDEX IF NOT EXISTS error_logs_error_code_idx ON error_logs (error_code);
