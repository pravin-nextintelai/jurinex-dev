'use strict';
/** Masking and size limits. Same rules as the Python package. */

const MAX_USER_MESSAGE = 1000;
const MAX_ERROR_MESSAGE = 4000;
const MAX_STACK = 10000;
const MAX_EXTERNAL_RESPONSE = 2000;
const PAYLOAD_MAX_STR = 500;
const PAYLOAD_MAX_DEPTH = 3;
const PAYLOAD_MAX_ITEMS = 20;
const MASK = '***';

const SENSITIVE_WORDS = new Set([
  'password', 'passwd', 'pwd', 'token', 'secret', 'otp', 'authorization', 'cookie', 'cookies',
  'apikey', 'credential', 'credentials', 'jwt', 'auth', 'sid', 'pin', 'signature', 'key',
  'privatekey', 'clientsecret', 'bearer', 'passcode',
]);
const NOT_SECRET_WORDS = new Set([
  'count', 'counts', 'usage', 'total', 'used', 'limit', 'limits', 'remaining', 'max', 'min',
  'per', 'chars', 'len', 'length', 'size', 'prompt', 'candidates', 'cached', 'thoughts', 'tokens',
  'input', 'output', 'budget', 'window', 'ms', 'id', 'ids', 'name', 'type', 'kind', 'hash', 'ok',
]);

const INLINE = [
  [/([?&](?:key|api_key|apikey|token|access_token|refresh_token|secret|password|otp|sig|signature)=)[^&\s'"]+/gi, true],
  [/\b((?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|otp|client[_-]?secret)\s*[=:]\s*)[^\s,;'"&]+/gi, true],
  [/(Bearer\s+)[A-Za-z0-9\-_.=]+/gi, true],
  [/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, true],
  [/\bAIza[0-9A-Za-z\-_]{20,}\b/g, false],
  [/\bsk-[A-Za-z0-9\-_]{10,}\b/g, false],
  [/\bxkeysib-[A-Za-z0-9\-_]{10,}\b/g, false],
  [/\bxsmtpsib-[A-Za-z0-9\-_]{10,}\b/g, false],
  [/\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/g, false],
  [/\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{5,}\b/g, false],
];

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const words = new Set(key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!words.size) return false;
  let hit = false;
  for (const w of words) if (SENSITIVE_WORDS.has(w)) { hit = true; break; }
  if (!hit) return false;
  for (const w of words) if (NOT_SECRET_WORDS.has(w)) return false;
  return true;
}

function maskText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const [rx, keepPrefix] of INLINE) {
    out = keepPrefix ? out.replace(rx, (_, p1) => p1 + MASK) : out.replace(rx, MASK);
  }
  return out;
}

function truncate(text, limit) {
  if (text === null || text === undefined) return null;
  if (typeof text !== 'string') text = String(text);
  return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 1)) + '…';
}

function tail(text, limit) {
  if (text === null || text === undefined) return null;
  if (typeof text !== 'string') text = String(text);
  return text.length <= limit ? text : '…' + text.slice(-(limit - 1));
}

function stripQuery(url) {
  if (!url || typeof url !== 'string') return url || null;
  try {
    const u = new URL(url);
    u.search = ''; u.hash = ''; u.username = ''; u.password = '';
    return u.toString().replace(/\/$/, u.pathname === '/' ? '/' : '');
  } catch (_) {
    return url.split('?')[0].split('#')[0];
  }
}

function hostOf(url) {
  if (!url || typeof url !== 'string') return null;
  try { return new URL(url).host.toLowerCase() || null; } catch (_) { return null; }
}

function sanitizePayload(value, depth = 0) {
  if (depth > PAYLOAD_MAX_DEPTH) return '…';
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : String(value);
  if (t === 'bigint') return value.toString();
  if (t === 'string') return truncate(maskText(value), PAYLOAD_MAX_STR);
  if (t === 'function' || t === 'symbol') return undefined;
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return truncate(maskText(`${value.name}: ${value.message}`), PAYLOAD_MAX_STR);
  if (Array.isArray(value) || value instanceof Set) {
    const items = Array.from(value);
    const out = items.slice(0, PAYLOAD_MAX_ITEMS).map((v) => sanitizePayload(v, depth + 1));
    if (items.length > PAYLOAD_MAX_ITEMS) out.push(`+${items.length - PAYLOAD_MAX_ITEMS} more`);
    return out;
  }
  if (value instanceof Map) value = Object.fromEntries(value);
  if (t === 'object') {
    if (typeof value.toJSON === 'function') {
      try { return sanitizePayload(value.toJSON(), depth + 1); } catch (_) { /* fall through */ }
    }
    const out = {};
    const entries = Object.entries(value);
    for (let i = 0; i < entries.length; i += 1) {
      if (i >= PAYLOAD_MAX_ITEMS) { out['…'] = `+${entries.length - PAYLOAD_MAX_ITEMS} more`; break; }
      const [k, v] = entries[i];
      const ks = truncate(String(k), 100);
      out[ks] = isSensitiveKey(ks) ? MASK : sanitizePayload(v, depth + 1);
    }
    return out;
  }
  return truncate(maskText(String(value)), PAYLOAD_MAX_STR);
}

function extractUserMessage(body, contentType) {
  if (!body || !body.length) return null;
  let text;
  try { text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body); } catch (_) { return null; }
  text = text.trim();
  if (!text) return null;
  const ct = String(contentType || '').toLowerCase();
  if (ct.startsWith('application/json') || /^[[{]/.test(text)) {
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of ['detail', 'message', 'error', 'msg', 'description']) {
        if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
          let val = data[key];
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            for (const inner of ['message', 'detail', 'error', 'msg']) {
              if (val[inner] !== undefined && val[inner] !== null && val[inner] !== '') { val = val[inner]; break; }
            }
          }
          if (typeof val !== 'string') { try { val = JSON.stringify(val); } catch (_) { val = String(val); } }
          return truncate(maskText(val), MAX_USER_MESSAGE);
        }
      }
      return truncate(maskText(text), MAX_USER_MESSAGE);
    }
  }
  if (ct.startsWith('text/html')) text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return truncate(maskText(text), MAX_USER_MESSAGE);
}

module.exports = {
  MAX_USER_MESSAGE, MAX_ERROR_MESSAGE, MAX_STACK, MAX_EXTERNAL_RESPONSE, MASK,
  isSensitiveKey, maskText, truncate, tail, stripQuery, hostOf, sanitizePayload, extractUserMessage,
};
