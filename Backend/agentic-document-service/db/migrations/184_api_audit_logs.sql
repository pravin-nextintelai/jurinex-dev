-- 184_api_audit_logs.sql
-- Audit log of API usage shared by every JuriNex backend service: one row per
-- request with the user, service, endpoint, method, status, duration and, when the
-- request failed, the id of its error_logs row. Written by the vendored `errorlog`
-- module, or via POST /internal/audit-logs. Idempotent; also created on first connect.

CREATE TABLE IF NOT EXISTS api_audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_name  VARCHAR(100) NOT NULL,
    environment   VARCHAR(20),
    request_id    VARCHAR(64),
    user_id       VARCHAR(64),
    user_email    VARCHAR(255),
    ip_address    VARCHAR(45),
    http_method   VARCHAR(10),
    endpoint      VARCHAR(500),
    route         VARCHAR(500),
    status_code   INTEGER,
    status        VARCHAR(10) NOT NULL DEFAULT 'SUCCESS',
    duration_ms   INTEGER,
    error_log_id  UUID,
    user_agent    VARCHAR(300),
    resource_type VARCHAR(50),
    resource_id   VARCHAR(100),
    action        VARCHAR(30),
    payload       JSONB
);

CREATE INDEX IF NOT EXISTS api_audit_logs_created_at_idx ON api_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_user_created_idx ON api_audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_service_created_idx ON api_audit_logs (service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_endpoint_idx ON api_audit_logs (endpoint);
CREATE INDEX IF NOT EXISTS api_audit_logs_status_idx ON api_audit_logs (status);
CREATE INDEX IF NOT EXISTS api_audit_logs_request_id_idx ON api_audit_logs (request_id);
CREATE INDEX IF NOT EXISTS api_audit_logs_error_log_id_idx ON api_audit_logs (error_log_id);
