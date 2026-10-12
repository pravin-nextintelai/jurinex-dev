'use strict';
/** Category / severity classification, own-code frame detection, fingerprint. */
const crypto = require('crypto');
const path = require('path');
const { AI_PROVIDERS } = require('./config');

const SOURCE = { HTTP: 'HTTP', EXTERNAL: 'EXTERNAL_API', JOB: 'JOB', LOGGER: 'LOGGER', PROCESS: 'PROCESS' };
const CAT = {
  INTERNAL: 'INTERNAL', DATABASE: 'DATABASE', TIMEOUT: 'TIMEOUT', AI_PROVIDER: 'AI_PROVIDER',
  AI_SAFETY: 'AI_SAFETY_BLOCK', AI_EMPTY: 'AI_EMPTY_RESPONSE', AI_INVALID: 'AI_INVALID_OUTPUT',
  CITATION: 'CITATION_PROVIDER', EXTERNAL: 'EXTERNAL_API',
};
const SEV = { WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' };
const SEVERITY_RANK = { WARNING: 0, ERROR: 1, CRITICAL: 2 };
const SOURCES = new Set(Object.values(SOURCE));
const CATEGORIES = new Set(Object.values(CAT));
const SEVERITIES = new Set(Object.values(SEV));

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'DEADLINE_EXCEEDED', 'TIMEOUT', 'ERR_CANCELED']);
const CONN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNCLOSED']);
const PG_CONN_CODES = new Set(['57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '53300', '28P01', '28000', '3D000']);
const DB_MSG_RE = /(connection refused|could not connect|server closed the connection|connection terminated|too many connections|timeout exceeded when trying to connect|password authentication failed|the database system is (starting|shutting)|connection timed out|getaddrinfo|ECONNREFUSED .*5432|Connection terminated unexpectedly)/i;
const AI_QUOTA_CODES = new Set(['RESOURCE_EXHAUSTED', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'QUOTA_EXCEEDED', '429', '401', '403']);
const TIMEOUT_HTTP_CODES = new Set(['DEADLINE_EXCEEDED', 'TIMEOUT', '504', '408', 'ETIMEDOUT', 'ECONNABORTED']);

function isTimeout(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  if (TIMEOUT_CODES.has(code)) return true;
  const name = String(err.name || '');
  if (/timeout/i.test(name) || name === 'AbortError') return true;
  return /timed? ?out|timeout/i.test(String(err.message || ''));
}

function isDatabaseError(err) {
  if (!err) return false;
  if (err.code && (PG_CONN_CODES.has(String(err.code)) || /^[0-9A-Z]{5}$/.test(String(err.code)) && err.severity)) return true;
  const name = String(err.name || '');
  if (/DatabaseError|SequelizeError|Sequelize\w+Error|PgError|PoolError|QueryFailedError/i.test(name)) return true;
  if (err.routine || err.severity === 'FATAL' || err.severity === 'ERROR' && err.schema !== undefined) return true;
  return false;
}

function isDatabaseConnectionError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (PG_CONN_CODES.has(code)) return true;
  if (isDatabaseError(err) && (CONN_CODES.has(code.toUpperCase()) || DB_MSG_RE.test(String(err.message || '')))) return true;
  // pg surfaces socket errors with plain ECONNREFUSED and the DB port in the message
  if (CONN_CODES.has(code.toUpperCase()) && /:5432\b|postgres|database/i.test(String(err.message || '') + String(err.address || '') + String(err.port || ''))) return true;
  return false;
}

function classifyError(err) {
  if (!err) return [CAT.INTERNAL, SEV.ERROR];
  if (err instanceof RangeError && /heap|memory|Array buffer allocation/i.test(err.message || '')) return [CAT.INTERNAL, SEV.CRITICAL];
  if (isDatabaseConnectionError(err)) return [CAT.DATABASE, SEV.CRITICAL];
  if (isDatabaseError(err)) return [CAT.DATABASE, SEV.ERROR];
  if (isTimeout(err)) return [CAT.TIMEOUT, SEV.ERROR];
  return [CAT.INTERNAL, SEV.ERROR];
}

function categoryForProvider(provider, timeout = false) {
  if (timeout) return CAT.TIMEOUT;
  if (provider && AI_PROVIDERS.has(provider)) return CAT.AI_PROVIDER;
  if (provider === 'CITATION') return CAT.CITATION;
  return CAT.EXTERNAL;
}

function severityForExternal(provider, status, errorCode, def = SEV.ERROR) {
  const code = String(errorCode || '').toUpperCase();
  if (provider && AI_PROVIDERS.has(provider)) {
    if ([401, 403, 429].includes(status) || AI_QUOTA_CODES.has(code)) return SEV.CRITICAL;
  }
  return def;
}

function isTimeoutCode(status, errorCode) {
  return [408, 504].includes(status) || TIMEOUT_HTTP_CODES.has(String(errorCode || '').toUpperCase());
}

// ── stack frames ───────────────────────────────────────────────────────────

const FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|native)\)?\s*$/;

function parseStack(stack) {
  const out = [];
  if (typeof stack !== 'string') return out;
  for (const line of stack.split('\n')) {
    const m = FRAME_RE.exec(line);
    if (!m) continue;
    let file = m[2] || '';
    const fn = (m[1] || '').replace(/^async\s+/, '').replace(/^Object\.<anonymous>$/, '<module>').replace(/^new\s+/, 'new ');
    if (file.startsWith('file://')) { try { file = decodeURIComponent(new URL(file).pathname).replace(/^\/([A-Za-z]:)/, '$1'); } catch (_) { /* keep */ } }
    out.push({ fn: fn || '<anonymous>', file, line: m[3] ? parseInt(m[3], 10) : 0, col: m[4] ? parseInt(m[4], 10) : 0 });
  }
  return out;
}

function isForeign(file) {
  if (!file) return true;
  const norm = file.replace(/\\/g, '/');
  return norm.startsWith('node:') || norm.includes('/node_modules/') || norm.includes('/errorlog/') || norm.startsWith('internal/') || /^[a-z_]+\.js$/.test(norm) && !norm.includes('/');
}

function isOwn(file, root) {
  if (isForeign(file)) return false;
  const rel = path.relative(root, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function moduleName(file, root) {
  let rel = path.relative(root, file);
  if (!rel || rel.startsWith('..')) rel = path.basename(file);
  return rel.replace(/\\/g, '/').replace(/\.(c|m)?js$|\.ts$/, '').replace(/\/index$/, '').replace(/\//g, '.');
}

/** First own-code frame of an error: { frame: "file:line", method: "module.fn" } */
function firstOwnFrame(err, root) {
  const frames = parseStack(err && err.stack);
  const own = frames.find((f) => isOwn(f.file, root));
  const pick = own || frames.find((f) => f.file && !f.file.startsWith('node:')) || frames[0];
  if (!pick) return { frame: null, method: null };
  const rel = isOwn(pick.file, root) ? path.relative(root, pick.file).replace(/\\/g, '/') : pick.file.replace(/\\/g, '/');
  return { frame: `${rel}:${pick.line}`, method: `${moduleName(pick.file, root)}.${pick.fn}`.slice(0, 255) };
}

/** Own-code frame of the current call stack (for records without an exception). */
function currentOwnFrame(root) {
  const holder = {};
  Error.captureStackTrace(holder, currentOwnFrame);
  return firstOwnFrame(holder, root);
}

function fingerprint(serviceName, errorType, method, frame, externalProvider, externalErrorCode) {
  const raw = [serviceName || '', errorType || '', method || '', frame || '', externalProvider || '', externalErrorCode || ''].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}


// ── plain-language reason ──────────────────────────────────────────────────
const PROVIDER_NAMES = {
  GEMINI: 'the AI model (Gemini)', ANTHROPIC: 'the AI model (Claude)', OPENAI: 'the AI model (OpenAI)',
  DEEPSEEK: 'the AI model (DeepSeek)', CITATION: 'the citation provider (Indian Kanoon)',
  RAZORPAY: 'the payment gateway (Razorpay)', GCS: 'cloud file storage',
  DOCUMENT_AI: 'the document reading service (Google Document AI)', SPEECH: 'the speech service',
  BREVO: 'the email service (Brevo)', ZOHO: 'the Zoho editor', MICROSOFT: 'Microsoft 365',
  PAYMENT_SERVICE: 'the payment service', AUTH_SERVICE: 'the login service',
  FILE_SERVICE: 'the document service', CHAT_SERVICE: 'the chat service',
};
const STATUS_REASONS = {
  400: 'the request sent was invalid', 401: 'the user was not logged in or the session had expired',
  402: 'payment or quota is required to continue', 403: 'the user is not allowed to do this',
  404: 'the requested item does not exist', 405: 'this action is not supported on that address',
  409: 'it conflicts with something that already exists', 413: 'the file or request was too large',
  415: 'the file type is not supported', 422: 'some of the data entered was not valid',
  429: 'too many requests were made in a short time', 500: 'the server hit an internal problem',
  502: 'a service behind the server did not answer correctly', 503: 'the service was temporarily unavailable',
  504: 'a service behind the server took too long to answer',
};
const CLIENT_SUMMARIES = {
  PaymentCancelled: 'The user closed the payment window before paying.',
  PaymentFailed: 'The payment was declined or failed at the payment gateway.',
  PaymentVerifyFailed: 'The payment went through but the server could not confirm it.',
  ClientNetworkError: 'The browser could not reach the server or the file storage.',
  ClientRenderError: 'The page crashed while drawing on screen.',
  ClientUnhandledError: 'A programming error happened inside the browser page.',
  ClientError: 'An error happened in the browser.',
};
const BUG_TYPES = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'KeyError', 'AttributeError', 'ValueError', 'AssertionError']);
const plain = (t, n) => { const s = String(t || '').trim().replace(/\n/g, ' '); return s.length <= n ? s : `${s.slice(0, n - 1)}…`; };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const providerName = (p) => (p ? (PROVIDER_NAMES[p] || `${String(p).replace(/_/g, ' ').toLowerCase()} service`) : 'an outside service');

/** One sentence a non-technical person can read: why did this happen. */
function summarize(ev) {
  const et = ev.error_type || '';
  if (CLIENT_SUMMARIES[et]) return CLIENT_SUMMARIES[et];
  if (ev.external_provider || ev.source === 'EXTERNAL_API') {
    const name = providerName(ev.external_provider);
    const code = String(ev.external_error_code || '').toUpperCase();
    const st = ev.external_status_code;
    if (ev.category === 'TIMEOUT' || code === 'DEADLINE_EXCEEDED' || code === 'ETIMEDOUT') return cap(`${name} took too long to answer, so the request timed out.`);
    if (ev.category === 'AI_SAFETY_BLOCK') return 'The AI model refused to answer because the content tripped its safety rules.';
    if (ev.category === 'AI_EMPTY_RESPONSE') return code === 'MAX_TOKENS' ? 'The AI answer was cut off because it reached the maximum length.' : 'The AI model returned an empty answer.';
    if (ev.category === 'AI_INVALID_OUTPUT') return 'The AI model answered in a format the system could not read.';
    if (st === 401 || st === 403 || ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'API_KEY_INVALID'].includes(code)) return cap(`${name} rejected our credentials (API key or token), so the call was refused.`);
    if (st === 429 || code === 'RESOURCE_EXHAUSTED') return cap(`the quota or rate limit for ${name} was used up.`);
    if (Number.isInteger(st) && st >= 500) return cap(`${name} failed on its own side (HTTP ${st}).`);
    if (Number.isInteger(st) && st >= 400) return cap(`${name} rejected the request (HTTP ${st}).`);
    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN'].includes(code) || /connect|fetch/i.test(ev.error_message || '')) return cap(`${name} could not be reached (it may be down or the address is wrong).`);
    return cap(`the call to ${name} failed.`);
  }
  if (ev.category === 'DATABASE') return ev.severity === 'CRITICAL' ? 'The database could not be reached.' : 'A database operation failed.';
  if (ev.category === 'TIMEOUT') return 'The operation took too long and was stopped.';
  if (/^(HttpErrorResponse|HTTPException|HttpStatus)/.test(et)) {
    const digits = et.replace(/\D/g, '');
    const st = digits ? parseInt(digits, 10) : ev.status_code;
    return STATUS_REASONS[st] ? `The request failed because ${STATUS_REASONS[st]} (HTTP ${st}).` : `The request failed with HTTP ${st}.`;
  }
  if (ev.source === 'PROCESS') return 'The service itself crashed and had to restart.';
  if (ev.source === 'JOB') return 'A background task (not started by a user action) failed.';
  if (BUG_TYPES.has(et)) return `A programming error in the code caused this (${et}): ${plain(ev.error_message, 120)}`;
  if (Number.isInteger(ev.status_code) && STATUS_REASONS[ev.status_code]) return `The request failed because ${STATUS_REASONS[ev.status_code]} (HTTP ${ev.status_code}).`;
  return `An unexpected error occurred (${et || 'Error'}): ${plain(ev.error_message, 120)}`;
}


// ── error code, what happened, suggested fix (for the admin detail view) ────
const RESOURCE_WORDS = { 'STORAGE FOLDER': 'a storage folder', CASE: 'a case', FILE: 'a file', USER: 'the user profile', CHAT: 'a chat', PROMPT: 'a prompt', PLAN: 'a plan', PAYMENT: 'a payment', 'SUPPORT TICKET': 'a support ticket', TEMPLATE: 'a template', DRAFT: 'a draft' };
const ACTION_VERBS = { VIEW: 'open', CREATE: 'create', UPDATE: 'save changes to', DELETE: 'delete' };
const CLIENT_CODES = { PaymentCancelled: 'PAYMENT_CANCELLED', PaymentFailed: 'PAYMENT_FAILED', PaymentVerifyFailed: 'PAYMENT_VERIFY_FAILED', ClientNetworkError: 'BROWSER_NETWORK_ERROR', ClientRenderError: 'BROWSER_RENDER_ERROR', ClientUnhandledError: 'BROWSER_ERROR', ClientError: 'BROWSER_ERROR' };
const CLIENT_WHAT = {
  PaymentCancelled: 'The user was on the payment screen and closed the payment window before paying.',
  PaymentFailed: 'The user tried to pay, but the payment did not go through.',
  PaymentVerifyFailed: 'The user paid, but the server could not confirm the payment.',
  ClientNetworkError: 'The user was using the app, and a request from the browser could not reach the server.',
  ClientRenderError: 'The user opened a page, and it crashed while being displayed.',
  ClientUnhandledError: 'The user was using the app when a programming error happened in the browser.',
};
const BY_STATUS_CODE = { 400: 'BAD_REQUEST', 402: 'PAYMENT_REQUIRED', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_FILE_TYPE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 502: 'UPSTREAM_ERROR', 503: 'SERVICE_UNAVAILABLE', 504: 'UPSTREAM_TIMEOUT' };

function objectWords(resourceType, endpoint) {
  if (resourceType && RESOURCE_WORDS[resourceType]) return RESOURCE_WORDS[resourceType];
  const ep = String(endpoint || '').split('?')[0].replace(/^\/+|\/+$/g, '');
  if (ep.startsWith('client:')) return `the ${ep.slice(7).replace(/-/g, ' ')} screen`;
  const segs = ep.split('/').filter((s) => s && !['api', 'v1', 'files', 'internal'].includes(s) && !/^\d/.test(s) && !s.includes('{') && !s.includes(':'));
  return segs.length ? `the ${segs[segs.length - 1].replace(/[-_]/g, ' ')}` : 'the page';
}

function errorCodeFor(ev) {
  const et = ev.error_type || ''; const msg = String(ev.error_message || '').toLowerCase();
  if (CLIENT_CODES[et]) return CLIENT_CODES[et];
  if (ev.external_provider || ev.source === 'EXTERNAL_API') {
    const code = String(ev.external_error_code || '').toUpperCase(); const st = ev.external_status_code;
    if (ev.category === 'AI_SAFETY_BLOCK') return 'AI_SAFETY_BLOCK';
    if (ev.category === 'AI_EMPTY_RESPONSE') return 'AI_EMPTY_RESPONSE';
    if (ev.category === 'AI_INVALID_OUTPUT') return 'AI_INVALID_OUTPUT';
    if (st === 429 || code === 'RESOURCE_EXHAUSTED') return ev.category === 'AI_PROVIDER' ? 'AI_QUOTA_EXCEEDED' : 'UPSTREAM_RATE_LIMITED';
    if (ev.category === 'TIMEOUT' || code === 'DEADLINE_EXCEEDED' || code === 'ETIMEDOUT') return 'UPSTREAM_TIMEOUT';
    if (st === 401 || st === 403 || ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'API_KEY_INVALID'].includes(code)) return 'UPSTREAM_AUTH_FAILED';
    if (Number.isInteger(st) && st >= 500) return 'UPSTREAM_ERROR';
    if (Number.isInteger(st) && st >= 400) return 'UPSTREAM_REJECTED';
    return 'UPSTREAM_UNREACHABLE';
  }
  if (ev.category === 'DATABASE') return ev.severity === 'CRITICAL' ? 'DATABASE_UNAVAILABLE' : 'DATABASE_ERROR';
  if (ev.category === 'TIMEOUT') return 'TIMEOUT';
  if (ev.source === 'PROCESS') return 'PROCESS_CRASH';
  if (ev.source === 'JOB') return 'JOB_FAILED';
  let st = ev.status_code;
  if (/^(HttpErrorResponse|HTTPException|HttpStatus)/.test(et)) { const d = et.replace(/\D/g, ''); if (d) st = parseInt(d, 10); }
  if (st === 401 || st === 403) { if (msg.includes('expire')) return 'AUTH_EXPIRED'; return st === 401 ? 'AUTH_REQUIRED' : 'PERMISSION_DENIED'; }
  if (BY_STATUS_CODE[st]) return BY_STATUS_CODE[st];
  return 'INTERNAL_ERROR';
}

function whatHappenedFor(ev) {
  const et = ev.error_type || '';
  if (CLIENT_WHAT[et]) return CLIENT_WHAT[et];
  const ep = String(ev.endpoint || '').toLowerCase();
  if (ev.source === 'JOB' || /^(job|thread|task|cron):/.test(ep)) return 'A background task ran on its own (not started by a user action) and failed.';
  if (ev.source === 'PROCESS') return 'The service itself crashed while running.';
  const who = ev.user_id ? 'The user' : 'Someone (not logged in) or another service';
  const m = String(ev.http_method || '').toUpperCase();
  let verb = ACTION_VERBS[String(ev.action || '').toUpperCase()] || { GET: 'open', POST: 'create', PUT: 'save changes to', PATCH: 'save changes to', DELETE: 'delete' }[m] || 'use';
  if (ep.includes('upload')) verb = 'upload'; else if (ep.includes('download') || ep.includes('export')) verb = 'download'; else if (ep.includes('chat') && m === 'POST') verb = 'send a message in'; else if (ep.includes('login') || ep.includes('signin')) verb = 'log in to';
  const obj = objectWords(ev.resource_type, ev.endpoint);
  const st = ev.status_code;
  let outcome;
  if (st === null || st === undefined) outcome = 'but it failed.';
  else if (st === 401 || st === 403) outcome = `but the request was refused (HTTP ${st}).`;
  else if (st === 404) outcome = 'but it could not be found (HTTP 404).';
  else if (st >= 500) outcome = `but the server failed (HTTP ${st}).`;
  else outcome = `but the request failed (HTTP ${st}).`;
  return `${who} tried to ${verb} ${obj}, ${outcome}`;
}

function suggestedFixFor(code, ev) {
  const prov = ev.external_provider ? providerName(ev.external_provider) : 'the outside service';
  const where = ev._frame ? ` at ${ev._frame}` : '';
  const fixes = {
    AUTH_EXPIRED: 'User: log in again. Developers: renew the token before it expires or send the user to the login page automatically.',
    AUTH_REQUIRED: 'User: log in and retry. Developers: make sure the frontend sends the login token with this request.',
    PERMISSION_DENIED: "Check the user's role and plan; if they should have access, correct the permission rule.",
    NOT_FOUND: 'Check that the item still exists and that the link or id the frontend uses is correct.',
    METHOD_NOT_ALLOWED: 'Developers: the frontend is calling this address with the wrong HTTP method.',
    BAD_REQUEST: 'Developers: compare the data the frontend sends with what the API expects (field names, required fields).',
    VALIDATION_ERROR: 'Developers: compare the data the frontend sends with what the API expects; show the user which field is wrong.',
    CONFLICT: 'The item already exists or was changed by someone else; reload and retry.',
    PAYLOAD_TOO_LARGE: 'Ask the user to upload a smaller file, or raise the size limit in the service settings.',
    UNSUPPORTED_FILE_TYPE: 'Ask the user to use a supported file type.',
    PAYMENT_REQUIRED: "The user's quota or plan is used up; they need to upgrade or top up.",
    RATE_LIMITED: 'Ask the user to wait a minute and retry; developers can raise the limit if it is too low.',
    AI_QUOTA_EXCEEDED: `The quota for ${prov} is used up. Raise the quota, add a retry with waiting, or fall back to another model.`,
    AI_SAFETY_BLOCK: 'The content was blocked by the AI safety rules. Rephrase the request or adjust the safety settings if the block is wrong.',
    AI_EMPTY_RESPONSE: 'Retry the request; developers should raise the answer length limit or handle empty answers gracefully.',
    AI_INVALID_OUTPUT: "Developers: make the parser tolerant of the model's output format or tighten the output instructions.",
    UPSTREAM_AUTH_FAILED: `Developers: the API key or token used for ${prov} is wrong, missing or expired; fix it in the service's environment settings.`,
    UPSTREAM_RATE_LIMITED: `Too many calls to ${prov}; add a retry with waiting or reduce the call rate.`,
    UPSTREAM_TIMEOUT: `${cap(prov)} is slow or down; retry later and raise the timeout if it keeps happening.`,
    UPSTREAM_ERROR: `${cap(prov)} failed on its side; retry later and check its status page.`,
    UPSTREAM_REJECTED: `Developers: ${prov} refused the request; check the data sent to it.`,
    UPSTREAM_UNREACHABLE: `Check that ${prov} is running and the address configured for it is correct (network, DNS, firewall).`,
    DATABASE_UNAVAILABLE: 'Check that the database is running and the connection settings and pool size are correct.',
    DATABASE_ERROR: 'Developers: check the failing query and the database logs.',
    TIMEOUT: 'The operation is too slow; retry, and developers should speed it up or raise the timeout.',
    OUT_OF_MEMORY: 'Restart the service and give it more memory; developers should look for large data held in memory.',
    PROCESS_CRASH: 'Restart the service and fix the code in the stack trace.',
    JOB_FAILED: "Check the job's logs and fix the code in the stack trace; rerun the job.",
    SERVICE_UNAVAILABLE: 'The service was down or restarting; retry in a moment.',
    PAYMENT_CANCELLED: 'No action needed. Follow up with the user if it keeps happening.',
    PAYMENT_FAILED: 'Ask the user to retry with another card or payment method; check the Razorpay dashboard for the decline reason.',
    PAYMENT_VERIFY_FAILED: 'Developers: check the payment verification (signature, order id); confirm the payment manually in Razorpay.',
    BROWSER_NETWORK_ERROR: "Check the user's internet connection and that the service address is reachable (CORS, firewall).",
    BROWSER_RENDER_ERROR: 'Developers: fix the frontend component in the stack trace.',
    BROWSER_ERROR: 'Developers: fix the frontend code in the stack trace.',
  };
  if (fixes[code]) return fixes[code];
  const detail = ev.error_type ? ` (${ev.error_type}: ${plain(ev.error_message, 100)})` : '';
  return `Developers: fix the code${where}${detail}; add a check for the missing or invalid value.`;
}

/** { error_code, what_happened, suggested_fix } for an error or audit event. */
function explain(ev) {
  const code = errorCodeFor(ev);
  return { error_code: code, what_happened: whatHappenedFor(ev).slice(0, 500), suggested_fix: suggestedFixFor(code, ev).slice(0, 1000) };
}

module.exports = {
  summarize, explain,
  SOURCE, CAT, SEV, SEVERITY_RANK, SOURCES, CATEGORIES, SEVERITIES,
  isTimeout, isDatabaseError, isDatabaseConnectionError, classifyError,
  categoryForProvider, severityForExternal, isTimeoutCode,
  parseStack, firstOwnFrame, currentOwnFrame, fingerprint, isOwn,
};
