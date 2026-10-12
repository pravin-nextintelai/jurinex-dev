-- 185_api_audit_logs_method.sql
-- Fill ACTION / RESOURCE TYPE / METHOD on api_audit_logs the way the admin
-- table shows them (VIEW/CREATE/UPDATE/DELETE, STORAGE FOLDER/CASE, FolderService.get…).
-- Adds method (handler label). Existing tables get the column on first connect too.

ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS method VARCHAR(255);

CREATE INDEX IF NOT EXISTS api_audit_logs_action_idx ON api_audit_logs (action);
CREATE INDEX IF NOT EXISTS api_audit_logs_method_idx ON api_audit_logs (method);
CREATE INDEX IF NOT EXISTS api_audit_logs_resource_type_idx ON api_audit_logs (resource_type);
