-- 185_api_audit_logs_error_columns.sql
-- The audit row of a failed request carries the error itself, not only a link:
-- error_type / error_message (the exact internal error) and user_message (what the
-- user saw). All three stay NULL when the request succeeded. `method` holds the
-- handler name shown by the admin console (FolderService.list_folders).
-- Idempotent; also applied on first connect by the errorlog module.

ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS method        VARCHAR(255);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_type    VARCHAR(255);
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS user_message  TEXT;
CREATE INDEX IF NOT EXISTS api_audit_logs_error_type_idx ON api_audit_logs (error_type);
