"""DDL for ``error_logs``. The migration file is generated from these statements
(see ``Backend/agentic-document-service/db/migrations/183_error_logs.sql``) and the
direct-DB writer runs them once at startup so the table exists on first use.
"""
from __future__ import annotations

CREATE_TABLE = """
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
    resolution_note      TEXT,
    error_summary        VARCHAR(500),
    error_code           VARCHAR(50),
    what_happened        VARCHAR(500),
    suggested_fix        VARCHAR(1000)
)
"""

INDEXES = (
    "CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS error_logs_service_name_idx ON error_logs (service_name)",
    "CREATE INDEX IF NOT EXISTS error_logs_source_idx ON error_logs (source)",
    "CREATE INDEX IF NOT EXISTS error_logs_category_idx ON error_logs (category)",
    "CREATE INDEX IF NOT EXISTS error_logs_request_id_idx ON error_logs (request_id)",
    "CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON error_logs (user_id)",
    "CREATE INDEX IF NOT EXISTS error_logs_user_email_idx ON error_logs (user_email)",
    "CREATE INDEX IF NOT EXISTS error_logs_method_idx ON error_logs (method)",
    "CREATE INDEX IF NOT EXISTS error_logs_resource_type_idx ON error_logs (resource_type)",
    "CREATE INDEX IF NOT EXISTS error_logs_error_type_idx ON error_logs (error_type)",
    "CREATE INDEX IF NOT EXISTS error_logs_external_provider_idx ON error_logs (external_provider)",
    "CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON error_logs (fingerprint)",
    "CREATE INDEX IF NOT EXISTS error_logs_is_resolved_idx ON error_logs (is_resolved)",
    "CREATE INDEX IF NOT EXISTS error_logs_resolved_created_idx ON error_logs (is_resolved, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS error_logs_fingerprint_created_idx ON error_logs (fingerprint, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS error_logs_service_created_idx ON error_logs (service_name, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS error_logs_provider_created_idx ON error_logs (external_provider, created_at DESC)",
)

ALTERS = (
    "ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500)",
    "ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS error_code VARCHAR(50)",
    "ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500)",
    "ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000)",
)

ALL_STATEMENTS = (CREATE_TABLE,) + ALTERS + INDEXES

INSERT_COLUMNS = (
    "id, created_at, service_name, environment, source, category, severity, request_id, "
    "user_id, user_email, ip_address, endpoint, http_method, method, action, resource_type, "
    "resource_id, status_code, user_message, error_type, error_message, stack_trace, "
    "external_provider, external_endpoint, external_model, external_status_code, "
    "external_error_code, external_response, latency_ms, payload, fingerprint, is_resolved, "
    "resolved_by, resolved_at, resolution_note, error_summary, error_code, what_happened, suggested_fix"
)
INSERT_COLUMN_COUNT = 39

# %s placeholders (psycopg / psycopg2). payload is cast to jsonb.
INSERT_SQL_PSYCOPG = (
    f"INSERT INTO error_logs ({INSERT_COLUMNS}) VALUES ("
    + ", ".join(["%s"] * 29) + ", %s::jsonb, " + ", ".join(["%s"] * 9) + ") ON CONFLICT (id) DO NOTHING"
)
# $n placeholders (asyncpg).
INSERT_SQL_ASYNCPG = (
    f"INSERT INTO error_logs ({INSERT_COLUMNS}) VALUES ("
    + ", ".join(f"${i}" for i in range(1, 30)) + ", $30::jsonb, " + ", ".join(f"${i}" for i in range(31, 40))
    + ") ON CONFLICT (id) DO NOTHING"
)

RETENTION_SQL = (
    "DELETE FROM error_logs WHERE is_resolved = true AND resolved_at IS NOT NULL "
    "AND resolved_at < now() - make_interval(days => %s)"
)
RETENTION_SQL_ASYNCPG = (
    "DELETE FROM error_logs WHERE is_resolved = true AND resolved_at IS NOT NULL "
    "AND resolved_at < now() - make_interval(days => $1::int)"
)


# ── api_audit_logs: one row per request ───────────────────────────────────────

AUDIT_CREATE_TABLE = """
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
    method        VARCHAR(255),
    error_type    VARCHAR(255),
    error_message TEXT,
    user_message  TEXT,
    stack_trace   TEXT,
    error_summary VARCHAR(500),
    error_code    VARCHAR(50),
    what_happened VARCHAR(500),
    suggested_fix VARCHAR(1000),
    payload       JSONB
)
"""

# Columns added after the table first shipped (tables created before migration 185).
AUDIT_ALTERS = (
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS method VARCHAR(255)",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_type VARCHAR(255)",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS user_message TEXT",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS stack_trace TEXT",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500)",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_code VARCHAR(50)",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500)",
    "ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000)",
)

AUDIT_INDEXES = (
    "CREATE INDEX IF NOT EXISTS api_audit_logs_created_at_idx ON api_audit_logs (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_user_created_idx ON api_audit_logs (user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_service_created_idx ON api_audit_logs (service_name, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_endpoint_idx ON api_audit_logs (endpoint)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_status_idx ON api_audit_logs (status)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_request_id_idx ON api_audit_logs (request_id)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_error_log_id_idx ON api_audit_logs (error_log_id)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_error_type_idx ON api_audit_logs (error_type)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_action_idx ON api_audit_logs (action)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_method_idx ON api_audit_logs (method)",
    "CREATE INDEX IF NOT EXISTS api_audit_logs_resource_type_idx ON api_audit_logs (resource_type)",
)

AUDIT_ALTER = AUDIT_ALTERS

AUDIT_ALL_STATEMENTS = (AUDIT_CREATE_TABLE,) + AUDIT_ALTER + AUDIT_INDEXES

AUDIT_INSERT_COLUMNS = (
    "id, created_at, service_name, environment, request_id, user_id, user_email, ip_address, "
    "http_method, endpoint, route, status_code, status, duration_ms, error_log_id, user_agent, "
    "resource_type, resource_id, action, method, error_type, error_message, user_message, stack_trace, error_summary, error_code, what_happened, suggested_fix, payload"
)
AUDIT_INSERT_SQL_PSYCOPG = (
    f"INSERT INTO api_audit_logs ({AUDIT_INSERT_COLUMNS}) VALUES ("
    + ", ".join(["%s"] * 28) + ", %s::jsonb) ON CONFLICT (id) DO NOTHING"
)
AUDIT_INSERT_SQL_ASYNCPG = (
    f"INSERT INTO api_audit_logs ({AUDIT_INSERT_COLUMNS}) VALUES ("
    + ", ".join(f"${i}" for i in range(1, 29)) + ", $29::jsonb) ON CONFLICT (id) DO NOTHING"
)
AUDIT_RETENTION_SQL = "DELETE FROM api_audit_logs WHERE created_at < now() - make_interval(days => %s)"
AUDIT_RETENTION_SQL_ASYNCPG = "DELETE FROM api_audit_logs WHERE created_at < now() - make_interval(days => $1::int)"


def audit_migration_sql() -> str:
    header = (
        "-- 184_api_audit_logs.sql\n"
        "-- Audit log of API usage shared by every JuriNex backend service: one row per\n"
        "-- request with the user, service, endpoint, method, status, duration and, when the\n"
        "-- request failed, the id of its error_logs row. Written by the vendored `errorlog`\n"
        "-- module, or via POST /internal/audit-logs. Idempotent; also created on first connect.\n\n"
    )
    return header + AUDIT_CREATE_TABLE.strip() + ";\n\n" + ";\n".join(AUDIT_INDEXES) + ";\n"


def migration_sql() -> str:
    """Full migration file content (used to generate 183_error_logs.sql)."""
    header = (
        "-- 183_error_logs.sql\n"
        "-- Central error log shared by every JuriNex backend service.\n"
        "-- One row per error a user actually hit (5xx responses, failed Gemini / external\n"
        "-- calls behind them, failed background jobs). Written by the vendored `errorlog`\n"
        "-- package (Python) / `errorlog` module (Node), or via POST /internal/error-logs.\n"
        "-- Idempotent: the direct-DB writer also runs these statements on first connect.\n"
        "-- Requires pgcrypto or PostgreSQL 13+ for gen_random_uuid().\n\n"
    )
    body = CREATE_TABLE.strip() + ";\n\n" + ";\n".join(INDEXES) + ";\n"
    return header + body
