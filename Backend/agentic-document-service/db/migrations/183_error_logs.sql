-- 183_error_logs.sql
-- Central error log shared by every JuriNex backend service.
-- One row per error a user actually hit (5xx responses, failed Gemini / external
-- calls behind them, failed background jobs). Written by the vendored `errorlog`
-- package (Python) / `errorlog` module (Node), or via POST /internal/error-logs.
-- Idempotent: the direct-DB writer also runs these statements on first connect.
-- Requires pgcrypto or PostgreSQL 13+ for gen_random_uuid().

CREATE TABLE IF NOT EXISTS error_logs (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_name         VARCHAR(100) NOT NULL,
    environment          VARCHAR(20),
    source               VARCHAR(20) NOT NULL,
    category             VARCHAR(30) NOT NULL,
    severity             VARCHAR(20) NOT NULL DEFAULT 'ERROR',
    request_id           VARCHAR(64),
    user_id              VARCHAR(64),
    user_email           VARCHAR(255),
    ip_address           VARCHAR(45),
    endpoint             VARCHAR(500),
    http_method          VARCHAR(10),
    method               VARCHAR(255),
    action               VARCHAR(30),
    resource_type        VARCHAR(50),
    resource_id          VARCHAR(100),
    status_code          INTEGER,
    user_message         TEXT,
    error_type           VARCHAR(255),
    error_message        TEXT,
    stack_trace          TEXT,
    external_provider    VARCHAR(50),
    external_endpoint    VARCHAR(500),
    external_model       VARCHAR(100),
    external_status_code INTEGER,
    external_error_code  VARCHAR(100),
    external_response    TEXT,
    latency_ms           INTEGER,
    payload              JSONB,
    fingerprint          VARCHAR(64),
    is_resolved          BOOLEAN NOT NULL DEFAULT false,
    resolved_by          VARCHAR(255),
    resolved_at          TIMESTAMPTZ,
    resolution_note      TEXT
);

CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_service_name_idx ON error_logs (service_name);
CREATE INDEX IF NOT EXISTS error_logs_source_idx ON error_logs (source);
CREATE INDEX IF NOT EXISTS error_logs_category_idx ON error_logs (category);
CREATE INDEX IF NOT EXISTS error_logs_request_id_idx ON error_logs (request_id);
CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON error_logs (user_id);
CREATE INDEX IF NOT EXISTS error_logs_user_email_idx ON error_logs (user_email);
CREATE INDEX IF NOT EXISTS error_logs_method_idx ON error_logs (method);
CREATE INDEX IF NOT EXISTS error_logs_resource_type_idx ON error_logs (resource_type);
CREATE INDEX IF NOT EXISTS error_logs_error_type_idx ON error_logs (error_type);
CREATE INDEX IF NOT EXISTS error_logs_external_provider_idx ON error_logs (external_provider);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON error_logs (fingerprint);
CREATE INDEX IF NOT EXISTS error_logs_is_resolved_idx ON error_logs (is_resolved);
CREATE INDEX IF NOT EXISTS error_logs_resolved_created_idx ON error_logs (is_resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_created_idx ON error_logs (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_service_created_idx ON error_logs (service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_provider_created_idx ON error_logs (external_provider, created_at DESC);
