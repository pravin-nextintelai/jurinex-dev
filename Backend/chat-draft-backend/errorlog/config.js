'use strict';
/**
 * Configuration from environment variables with safe defaults.
 * Mirrors the Python package so both stacks behave the same.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PROVIDERS = {
  'generativelanguage.googleapis.com': 'GEMINI',
  'aiplatform.googleapis.com': 'GEMINI',
  'indiankanoon.org': 'CITATION',
  'api.indiankanoon.org': 'CITATION',
  'api.anthropic.com': 'ANTHROPIC',
  'api.openai.com': 'OPENAI',
  'api.deepseek.com': 'DEEPSEEK',
  'documentai.googleapis.com': 'DOCUMENT_AI',
  'translate.googleapis.com': 'GOOGLE_TRANSLATE',
  'translation.googleapis.com': 'GOOGLE_TRANSLATE',
  'speech.googleapis.com': 'SPEECH',
  'storage.googleapis.com': 'GCS',
  'oauth2.googleapis.com': 'GOOGLE_AUTH',
  'www.googleapis.com': 'GOOGLE_API',
  'secretmanager.googleapis.com': 'SECRET_MANAGER',
  'api.brevo.com': 'BREVO',
  'api.razorpay.com': 'RAZORPAY',
  'api.office-integrator.in': 'ZOHO',
  'graph.microsoft.com': 'MICROSOFT',
  'login.microsoftonline.com': 'MICROSOFT',
  'ip-api.com': 'IP_API',
  'smtp.gmail.com': 'GMAIL_SMTP',
};

const AI_PROVIDERS = new Set(['GEMINI', 'ANTHROPIC', 'OPENAI', 'DEEPSEEK']);

const URL_VAR_RE = /^[A-Z][A-Z0-9_]*_(SERVICE_URL|API_URL|BASE_URL|URL)$/;
const URL_SUFFIXES = ['_SERVICE_URL', '_API_URL', '_BASE_URL', '_URL'];
const CITATION_VARS = new Set(['IK', 'INDIAN_KANOON', 'INDIANKANOON', 'CITATION_API']);
const SKIP_VARS = new Set(['DATABASE', 'DB', 'REDIS', 'PAYMENT_DB', 'DRAFT_DATABASE', 'AUTH_DATABASE', 'DOCUMENT_DATABASE', 'FRONTEND', 'PUBLIC_BASE', 'NGROK', 'WEBHOOK_BASE', 'CORS']);

const TRUE = new Set(['1', 'true', 'yes', 'on', 'y']);

function bool(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  return TRUE.has(raw.trim().toLowerCase());
}
function int(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}
function str(name) {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const v = raw.trim().replace(/^"|"$/g, '');
  return v === '' ? null : v;
}

function skipStatuses() {
  const raw = process.env.ERROR_LOG_SKIP_STATUS || '400,401,403,404,409,422';
  const out = new Set();
  for (const part of raw.split(/[,\s;]+/)) if (/^\d+$/.test(part)) out.add(parseInt(part, 10));
  return out;
}

const DEV_INGEST_KEY = 'jurinex-errorlog-dev';
const PROD_ENVS = new Set(['production', 'prod', 'live']);

/**
 * Always POST errors to {origin}/internal/error-logs.
 * FILE_SERVICE_URL may include a path prefix like /api/files — drop it.
 */
function normalizeIngestUrl(raw) {
  if (!raw) return null;
  const u = String(raw).trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const path = (parsed.pathname || '').replace(/\/+$/, '');
    if (/\/internal\/error-logs$/i.test(path)) return `${parsed.protocol}//${parsed.host}${path}`;
    if (/\/internal\/audit-logs$/i.test(path)) {
      return `${parsed.protocol}//${parsed.host}${path.replace(/\/internal\/audit-logs$/i, '/internal/error-logs')}`;
    }
    return `${parsed.protocol}//${parsed.host}/internal/error-logs`;
  } catch (_) {
    let fallback = u.replace(/\/+$/, '');
    if (/\/internal\/audit-logs$/i.test(fallback)) fallback = fallback.replace(/\/internal\/audit-logs$/i, '/internal/error-logs');
    if (!/\/internal\/error-logs$/i.test(fallback)) fallback = `${fallback}/internal/error-logs`;
    return fallback;
  }
}

function parseProviders(raw) {
  const out = {};
  if (!raw || !raw.trim()) return out;
  raw = raw.trim();
  if (raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) out[String(k).toLowerCase().trim()] = String(v).toUpperCase().trim();
    } catch (_) { /* ignore malformed JSON */ }
    return out;
  }
  for (const part of raw.split(/[,;\s]+/)) {
    let host; let name;
    if (part.includes('=')) [host, name] = part.split('=', 2);
    else if (part.includes(':') && !/^\d+$/.test(part.split(':')[1] || '')) [host, name] = part.split(':', 2);
    else continue;
    if (host && name) out[host.toLowerCase().trim()] = name.toUpperCase().trim();
  }
  return out;
}

function providersFromEnv() {
  const out = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!URL_VAR_RE.test(name) || name.startsWith('ERROR_LOG_')) continue;
    const v = (value || '').trim().replace(/^["']|["']$/g, '');
    if (!/^https?:\/\//i.test(v)) continue;
    let host;
    try { host = new URL(v).host.toLowerCase(); } catch (_) { continue; }
    if (!host) continue;
    let provider = name;
    for (const suf of URL_SUFFIXES) if (provider.endsWith(suf)) { provider = provider.slice(0, -suf.length); break; }
    if (CITATION_VARS.has(provider) || provider.includes('KANOON')) provider = 'CITATION';
    if (SKIP_VARS.has(provider)) continue;
    if (!out[host]) out[host] = provider;
    const bare = host.split(':')[0];
    if (!out[bare]) out[bare] = provider;
  }
  return out;
}

function defaultServiceName(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) return pkg.name.trim().replace(/^@[^/]+\//, '');
  } catch (_) { /* no package.json */ }
  return path.basename(root) || 'unknown-service';
}

/**
 * @param {object} opts
 * @param {string} [opts.serviceName]
 * @param {string} [opts.root] service root directory (own-code frames live under it)
 */
function load(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());
  const providers = Object.assign({}, DEFAULT_PROVIDERS, providersFromEnv(), parseProviders(process.env.EXTERNAL_PROVIDERS));
  const environment = (str('ENVIRONMENT') || str('APP_ENV') || str('NODE_ENV') || str('ENV') || 'development');
  // Genuine errors only: 5xx and unhandled failures. 401/404 and recovered
  // internals are not stored unless ERROR_LOG_CAPTURE_ALL=true.
  const captureAll = bool('ERROR_LOG_CAPTURE_ALL', false);
  let ingestUrl = normalizeIngestUrl(str('ERROR_LOG_INGEST_URL'));
  const databaseUrl = str('ERROR_LOG_DATABASE_URL');
  if (!ingestUrl && !databaseUrl) {
    ingestUrl = normalizeIngestUrl(str('FILE_SERVICE_URL') || str('DOCUMENT_SERVICE_URL') || 'http://127.0.0.1:8092');
  }
  const cfg = {
    serviceName: opts.serviceName || str('SERVICE_NAME') || defaultServiceName(root),
    environment,
    enabled: bool('ERROR_LOG_ENABLED', true),
    storeAiContent: bool('ERROR_LOG_STORE_AI_CONTENT', false),
    captureAll,
    skipStatus: (!captureAll || str('ERROR_LOG_SKIP_STATUS') !== null) ? skipStatuses() : new Set(),
    storeRecoveredExternal: bool('ERROR_LOG_STORE_RECOVERED_EXTERNAL', false),
    // Endpoint prefixes whose 4xx answers (except 401/403/404) are stored as WARNING rows:
    // e.g. "/api/payments" keeps "Invalid payment signature" even though it is a 400.
    store4xxPrefixes: (str('ERROR_LOG_STORE_4XX_PREFIXES') || '').split(/[,\s;]+/).map((p) => p.trim()).filter(Boolean),
    // API audit log: one api_audit_logs row per request (who used which service/API).
    auditEnabled: bool('ERROR_LOG_AUDIT_ENABLED', true),
    auditSkipPrefixes: (str('ERROR_LOG_AUDIT_SKIP_PREFIXES') || '/health,/internal,/api/auth/internal,/api/files/client-errors,/api/payments/client-errors,/docs,/openapi.json,/redoc,/favicon.ico').split(/[,\s;]+/).map((p) => p.trim()).filter(Boolean),
    providers,
    databaseUrl,
    ingestUrl,
    ingestKey: str('ERROR_LOG_INGEST_KEY') || (PROD_ENVS.has(String(environment).toLowerCase()) ? null : DEV_INGEST_KEY),
    queueMax: int('ERROR_LOG_QUEUE_MAX', 10000),
    batchSize: int('ERROR_LOG_BATCH_SIZE', 50),
    flushIntervalMs: int('ERROR_LOG_FLUSH_INTERVAL_MS', 2000),
    httpTimeoutMs: int('ERROR_LOG_HTTP_TIMEOUT_MS', 5000),
    bodyPeekBytes: 4096,
    root,
    get isProduction() { return ['production', 'prod', 'live'].includes(String(this.environment).toLowerCase()); },
    providerForHost(host) {
      if (!host) return null;
      host = String(host).toLowerCase().trim();
      const bare = host.split(':')[0];
      if (this.providers[host]) return this.providers[host];
      if (this.providers[bare]) return this.providers[bare];
      for (const [key, value] of Object.entries(this.providers)) {
        if (bare.endsWith('.' + key) || bare.endsWith('-' + key)) return value;
      }
      return null;
    },
  };
  return cfg;
}

module.exports = { load, DEFAULT_PROVIDERS, AI_PROVIDERS, normalizeIngestUrl };
