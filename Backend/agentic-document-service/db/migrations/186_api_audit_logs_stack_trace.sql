-- 186_api_audit_logs_stack_trace.sql
-- api_audit_logs is the single table that holds both normal activity and errors:
-- successful calls keep the error columns empty; failed calls carry error_type,
-- error_message, user_message and now the stack trace too. Errors that happen with
-- no request of their own (background jobs, browser reports, process crashes) also
-- get a FAILED audit row, linked to their error_logs row through error_log_id.
-- Idempotent; also applied on first connect by the errorlog module.

ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS stack_trace TEXT;
