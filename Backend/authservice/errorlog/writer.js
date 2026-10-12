'use strict';
/**
 * Queue + batch writer. Sinks: pg (ERROR_LOG_DATABASE_URL, separate pool max 2),
 * HTTP ingest (ERROR_LOG_INGEST_URL + X-Internal-Key), memory (tests).
 * Writes every flushIntervalMs or at batchSize rows; drops with a warning past
 * queueMax; flushes on SIGTERM/SIGINT; never throws.
 */
const http = require('http');
const https = require('https');
const { withInternal } = require('./context');

const COLUMNS = [
  'id', 'created_at', 'service_name', 'environment', 'source', 'category', 'severity', 'request_id',
  'user_id', 'user_email', 'ip_address', 'endpoint', 'http_method', 'method', 'action', 'resource_type',
  'resource_id', 'status_code', 'user_message', 'error_type', 'error_message', 'stack_trace',
  'external_provider', 'external_endpoint', 'external_model', 'external_status_code', 'external_error_code',
  'external_response', 'latency_ms', 'payload', 'fingerprint', 'is_resolved', 'resolved_by', 'resolved_at',
  'resolution_note', 'error_summary', 'error_code', 'what_happened', 'suggested_fix',
];

const DDL = [
  `CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_name VARCHAR(100) NOT NULL, environment VARCHAR(20), source VARCHAR(20) NOT NULL,
    category VARCHAR(30) NOT NULL, severity VARCHAR(20) NOT NULL DEFAULT 'ERROR', request_id VARCHAR(64),
    user_id VARCHAR(64), user_email VARCHAR(255), ip_address VARCHAR(45), endpoint VARCHAR(500),
    http_method VARCHAR(10), method VARCHAR(255), action VARCHAR(30), resource_type VARCHAR(50),
    resource_id VARCHAR(100), status_code INTEGER, user_message TEXT, error_type VARCHAR(255),
    error_message TEXT, stack_trace TEXT, external_provider VARCHAR(50), external_endpoint VARCHAR(500),
    external_model VARCHAR(100), external_status_code INTEGER, external_error_code VARCHAR(100),
    external_response TEXT, latency_ms INTEGER, payload JSONB, fingerprint VARCHAR(64),
    is_resolved BOOLEAN NOT NULL DEFAULT false, resolved_by VARCHAR(255), resolved_at TIMESTAMPTZ,
    resolution_note TEXT, error_summary VARCHAR(500), error_code VARCHAR(50), what_happened VARCHAR(500), suggested_fix VARCHAR(1000))`,
  'ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS error_code VARCHAR(50)',
  'ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500)',
  'ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000)',
  'ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500)',
  'CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS error_logs_service_name_idx ON error_logs (service_name)',
  'CREATE INDEX IF NOT EXISTS error_logs_source_idx ON error_logs (source)',
  'CREATE INDEX IF NOT EXISTS error_logs_category_idx ON error_logs (category)',
  'CREATE INDEX IF NOT EXISTS error_logs_request_id_idx ON error_logs (request_id)',
  'CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON error_logs (user_id)',
  'CREATE INDEX IF NOT EXISTS error_logs_user_email_idx ON error_logs (user_email)',
  'CREATE INDEX IF NOT EXISTS error_logs_method_idx ON error_logs (method)',
  'CREATE INDEX IF NOT EXISTS error_logs_resource_type_idx ON error_logs (resource_type)',
  'CREATE INDEX IF NOT EXISTS error_logs_error_type_idx ON error_logs (error_type)',
  'CREATE INDEX IF NOT EXISTS error_logs_external_provider_idx ON error_logs (external_provider)',
  'CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON error_logs (fingerprint)',
  'CREATE INDEX IF NOT EXISTS error_logs_is_resolved_idx ON error_logs (is_resolved)',
  'CREATE INDEX IF NOT EXISTS error_logs_resolved_created_idx ON error_logs (is_resolved, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS error_logs_fingerprint_created_idx ON error_logs (fingerprint, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS error_logs_service_created_idx ON error_logs (service_name, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS error_logs_provider_created_idx ON error_logs (external_provider, created_at DESC)',
];

// api_audit_logs: one row per request (who used which service and API).
const AUDIT_COLUMNS = [
  'id', 'created_at', 'service_name', 'environment', 'request_id', 'user_id', 'user_email', 'ip_address',
  'http_method', 'endpoint', 'route', 'status_code', 'status', 'duration_ms', 'error_log_id', 'user_agent',
  'resource_type', 'resource_id', 'action', 'method', 'error_type', 'error_message', 'user_message', 'stack_trace', 'error_summary', 'error_code', 'what_happened', 'suggested_fix', 'payload',
];
const AUDIT_DDL = [
  `CREATE TABLE IF NOT EXISTS api_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_name VARCHAR(100) NOT NULL, environment VARCHAR(20), request_id VARCHAR(64), user_id VARCHAR(64),
    user_email VARCHAR(255), ip_address VARCHAR(45), http_method VARCHAR(10), endpoint VARCHAR(500),
    route VARCHAR(500), status_code INTEGER, status VARCHAR(10) NOT NULL DEFAULT 'SUCCESS', duration_ms INTEGER,
    error_log_id UUID, user_agent VARCHAR(300), resource_type VARCHAR(50), resource_id VARCHAR(100),
    action VARCHAR(30), method VARCHAR(255), error_type VARCHAR(255), error_message TEXT, user_message TEXT, stack_trace TEXT, error_summary VARCHAR(500), error_code VARCHAR(50), what_happened VARCHAR(500), suggested_fix VARCHAR(1000), payload JSONB)`,
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS stack_trace TEXT',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_summary VARCHAR(500)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_code VARCHAR(50)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS what_happened VARCHAR(500)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(1000)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS method VARCHAR(255)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_type VARCHAR(255)',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT',
  'ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS user_message TEXT',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_error_type_idx ON api_audit_logs (error_type)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_created_at_idx ON api_audit_logs (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_user_created_idx ON api_audit_logs (user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_service_created_idx ON api_audit_logs (service_name, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_endpoint_idx ON api_audit_logs (endpoint)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_status_idx ON api_audit_logs (status)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_request_id_idx ON api_audit_logs (request_id)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_error_log_id_idx ON api_audit_logs (error_log_id)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_action_idx ON api_audit_logs (action)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_method_idx ON api_audit_logs (method)',
  'CREATE INDEX IF NOT EXISTS api_audit_logs_resource_type_idx ON api_audit_logs (resource_type)',
];

const isAudit = (ev) => ev && ev._table === 'audit';
const columnsFor = (ev) => (isAudit(ev) ? AUDIT_COLUMNS : COLUMNS);
const UUID_COLS = new Set(['id', 'error_log_id']);

function rowOf(ev) {
  return columnsFor(ev).map((c) => {
    const v = ev[c];
    if (c === 'payload') return v && Object.keys(v).length ? JSON.stringify(v) : null;
    if (v instanceof Date) return v.toISOString();
    return v === undefined ? null : v;
  });
}

function toJson(ev) {
  const out = {};
  for (const c of columnsFor(ev)) {
    const v = ev[c];
    out[c] = v instanceof Date ? v.toISOString() : (v === undefined ? null : v);
  }
  return out;
}

function warn(msg) { try { process.stderr.write(`[errorlog] ${msg}\n`); } catch (_) { /* ignore */ } }

function split(events) {
  const errors = []; const audits = [];
  for (const ev of events) (isAudit(ev) ? audits : errors).push(ev);
  return [errors, audits];
}

class MemorySink {
  constructor() { this.name = 'memory'; this.rows = []; this.auditRows = []; this.fail = false; }
  async write(events) {
    if (this.fail) throw new Error('memory sink failing on purpose');
    const [errors, audits] = split(events);
    this.rows.push(...errors); this.auditRows.push(...audits);
  }
  async close() {}
}

class PgSink {
  constructor(cfg, pg) {
    this.name = 'db';
    this.cfg = cfg;
    this.pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, allowExitOnIdle: true });
    // An idle-client error must never crash the process.
    this.pool.on('error', (e) => warn(`pg pool error: ${e && e.message}`));
    this.ensured = false;
  }
  async ensure() {
    if (this.ensured) return;
    try { for (const stmt of DDL.concat(AUDIT_DDL)) await this.pool.query(stmt); } catch (e) { warn(`could not ensure error_logs tables (${e.message}); inserts will be attempted anyway`); }
    this.ensured = true;
  }
  async insert(table, columns, events) {
    if (!events.length) return;
    const values = [];
    const tuples = events.map((ev, i) => {
      const row = rowOf(ev);
      const base = i * columns.length;
      values.push(...row);
      return '(' + columns.map((c, j) => (c === 'payload' ? `$${base + j + 1}::jsonb` : UUID_COLS.has(c) ? `$${base + j + 1}::uuid` : `$${base + j + 1}`)).join(', ') + ')';
    });
    await this.pool.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (id) DO NOTHING`, values);
  }
  async write(events) {
    await this.ensure();
    const [errors, audits] = split(events);
    await this.insert('error_logs', COLUMNS, errors);
    await this.insert('api_audit_logs', AUDIT_COLUMNS, audits);
  }
  async close() { try { await this.pool.end(); } catch (_) { /* ignore */ } }
}

function ingestEndpoints(raw) {
  if (!raw) return { url: null, auditUrl: null };
  const { normalizeIngestUrl } = require('./config');
  const u = normalizeIngestUrl(raw);
  return { url: u, auditUrl: u ? u.replace(/\/internal\/error-logs$/i, '/internal/audit-logs') : null };
}

class HttpSink {
  constructor(cfg, originals) {
    this.name = 'http';
    const endpoints = ingestEndpoints(cfg.ingestUrl);
    this.url = endpoints.url;
    this.auditUrl = endpoints.auditUrl;
    this.key = cfg.ingestKey || '';
    this.timeout = cfg.httpTimeoutMs;
    this.originals = originals || {};
    warn(`http ingest ${this.url} (audit ${this.auditUrl})`);
  }
  async write(events) {
    const [errors, audits] = split(events);
    for (let i = 0; i < errors.length; i += 100) await this.post(this.url, JSON.stringify(errors.slice(i, i + 100).map(toJson)));
    for (let i = 0; i < audits.length; i += 100) await this.post(this.auditUrl, JSON.stringify(audits.slice(i, i + 100).map(toJson)));
  }
  post(url, body) {
    const fetchFn = this.originals.fetch;
    if (typeof fetchFn === 'function') {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), this.timeout) : null;
      return fetchFn(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-internal-key': this.key, 'user-agent': 'jurinex-errorlog-node/1.0' }, signal: ac ? ac.signal : undefined })
        .then((res) => { if (res.status >= 300) throw new Error(`ingest returned HTTP ${res.status}`); })
        .finally(() => { if (timer) clearTimeout(timer); });
    }
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const request = (this.originals[u.protocol === 'https:' ? 'httpsRequest' : 'httpRequest'] || mod.request).bind(mod);
      const req = request({ method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-internal-key': this.key }, timeout: this.timeout }, (res) => {
        res.resume();
        res.on('end', () => (res.statusCode >= 300 ? reject(new Error(`ingest returned HTTP ${res.statusCode}`)) : resolve()));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('ingest timeout')));
      req.end(body);
    });
  }
  async close() {}
}

function makeSink(cfg, originals) {
  if (cfg.databaseUrl) {
    try {
      // Resolve pg from the service that vendors us (its node_modules).
      const pg = require('./resolve').resolveFrom(cfg.root, 'pg');
      return new PgSink(cfg, pg);
    } catch (e) {
      warn(`direct DB sink unavailable (${e.message})`);
      if (!cfg.ingestUrl) return null;
    }
  }
  if (cfg.ingestUrl) return new HttpSink(cfg, originals);
  return null;
}

class Writer {
  constructor(cfg, sink, originals) {
    this.cfg = cfg;
    this.sink = sink !== undefined ? sink : makeSink(cfg, originals);
    this.queue = [];
    this.dropped = 0;
    this.written = 0;
    this.failedBatches = 0;
    this.retry = null;
    this.retryCount = 0;
    this.retryAfter = 0;
    this.lastDropWarn = 0;
    this.timer = null;
    this.writing = null;
    this.stopped = false;
    this.warnedNoSink = false;
  }

  start() {
    if (this.timer || !this.sink) {
      if (!this.sink && !this.warnedNoSink) { this.warnedNoSink = true; warn('no sink configured (set ERROR_LOG_DATABASE_URL or ERROR_LOG_INGEST_URL); errors will be counted but not stored'); }
      return;
    }
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, Math.max(100, this.cfg.flushIntervalMs));
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  enqueue(ev) {
    if (!this.sink) { this.dropped += 1; return false; }
    if (!this.timer) this.start();
    if (this.queue.length >= this.cfg.queueMax) {
      this.dropped += 1;
      const now = Date.now();
      if (now - this.lastDropWarn > 60000) { this.lastDropWarn = now; warn(`queue full (${this.cfg.queueMax}), dropping error rows`); }
      return false;
    }
    this.queue.push(ev);
    if (this.queue.length >= this.cfg.batchSize) setImmediate(() => { this.tick().catch(() => {}); });
    return true;
  }

  hasPending() { return this.queue.length > 0 || !!this.retry || !!this.writing; }

  async tick() {
    if (this.writing) return this.writing;
    this.writing = withInternal(() => this.drain()).catch(() => {}).finally(() => { this.writing = null; });
    return this.writing;
  }

  async drain() {
    if (this.retry && Date.now() >= this.retryAfter) {
      const batch = this.retry;
      try { await this.sink.write(batch); this.written += batch.length; this.retry = null; this.retryCount = 0; } catch (e) {
        this.failedBatches += 1; this.retryCount += 1;
        if (this.retryCount >= 3) { warn(`giving up on ${batch.length} rows after 3 attempts (${e.message})`); this.dropped += batch.length; this.retry = null; this.retryCount = 0; } else { this.retryAfter = Date.now() + Math.min(30000, 2000 * (2 ** this.retryCount)); }
      }
    }
    while (this.queue.length) {
      const batch = this.queue.splice(0, Math.max(1, this.cfg.batchSize));
      try { await this.sink.write(batch); this.written += batch.length; } catch (e) {
        this.failedBatches += 1;
        if (!this.retry) { this.retry = batch; this.retryCount = 0; this.retryAfter = Date.now() + 2000; warn(`write failed (${e.message}); will retry ${batch.length} rows`); } else if (this.retry.length + batch.length <= Math.max(100, this.cfg.batchSize * 2)) { this.retry.push(...batch); } else { this.dropped += batch.length; }
        break; // sink is unhealthy: wait for the next tick
      }
    }
  }

  /** Drain what is queued now; resolves when written or after timeoutMs. */
  flush(timeoutMs = 2000) {
    if (!this.sink) return Promise.resolve(true);
    const work = this.tick().then(() => this.tick());
    const timeout = new Promise((resolve) => { const t = setTimeout(() => resolve(false), timeoutMs); if (t.unref) t.unref(); });
    return Promise.race([work.then(() => !this.hasPending()), timeout]);
  }

  async shutdown(timeoutMs = 2000) {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.flush(timeoutMs);
    if (this.sink) await this.sink.close();
  }

  stats() {
    return { sink: this.sink ? this.sink.name : null, queued: this.queue.length, written: this.written, dropped: this.dropped, failed_batches: this.failedBatches, retrying: this.retry ? this.retry.length : 0 };
  }
}

module.exports = { Writer, MemorySink, PgSink, HttpSink, makeSink, COLUMNS, AUDIT_COLUMNS, DDL, AUDIT_DDL, toJson, ingestEndpoints };
