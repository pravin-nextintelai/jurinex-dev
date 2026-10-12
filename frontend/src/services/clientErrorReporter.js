/**
 * Browser-side error capture. Everything the frontend sees go wrong is sent to
 * the central error log (table error_logs) with the signed-in user's id:
 *
 *   - uncaught exceptions          (window "error")
 *   - unhandled promise rejections (window "unhandledrejection")
 *   - axios and fetch requests that failed without a response
 *                                  (offline, DNS, CORS, server down, timeout) — this is
 *                                  the "Network Error" an upload to cloud storage shows
 *   - axios and fetch responses with status >= 400 that no JuriNex backend
 *                                  recorded (no x-request-id header: proxies, cloud
 *                                  storage, third parties)
 *   - console.error calls that carry an Error object
 *   - React render crashes          (error boundaries call reportClientError)
 *
 * Responses that carry x-request-id were already stored by the backend that
 * answered, with the same id, so they are not reported twice.
 *
 * Reports go to agentic-document-service and fall back to payment-service when
 * that one cannot be reached. Fire-and-forget: nothing here can throw into the
 * app, reports are de-duplicated for 10 s and capped at 30 per minute. Without
 * a login token nothing is sent.
 */
import axios from 'axios';
import { DOCUMENT_SERVICE_URL, PAYMENT_SERVICE_URL } from '../config/apiConfig';

const ENDPOINTS = [
  `${String(DOCUMENT_SERVICE_URL || '').replace(/\/$/, '')}/api/files/client-errors`,
  `${String(PAYMENT_SERVICE_URL || '').replace(/\/$/, '')}/api/payments/client-errors`,
];
const DEDUPE_MS = 10000;
const MAX_PER_MINUTE = 30;

let installed = false;
let nativeFetch = null;
const recent = new Map(); // key -> last sent at
let sentTimes = [];
const reportedErrors = new WeakSet(); // Error objects already reported by a transport hook

function token() {
  try {
    return localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || null;
  } catch {
    return null;
  }
}

function allowed(key) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return false;
  sentTimes = sentTimes.filter((t) => now - t < 60000);
  if (sentTimes.length >= MAX_PER_MINUTE) return false;
  recent.set(key, now);
  sentTimes.push(now);
  if (recent.size > 200) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  return true;
}

function describeError(error) {
  if (!error) return null;
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  if (typeof error === 'string') return { name: 'Error', message: error };
  try {
    return { name: error.name || 'Error', message: error.message || JSON.stringify(error).slice(0, 500), stack: error.stack };
  } catch {
    return { name: 'Error', message: String(error) };
  }
}

function isOurs(url) {
  return typeof url === 'string' && url.indexOf('/client-errors') !== -1;
}

function stripQuery(url) {
  try { return String(url).split('?')[0].split('#')[0]; } catch { return url; }
}

async function send(body, jwt) {
  const payload = JSON.stringify(body);
  for (const endpoint of ENDPOINTS) {
    if (!endpoint || endpoint.startsWith('/api')) continue; // base URL missing
    try {
      const res = await nativeFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: payload,
        keepalive: true,
      });
      if (res && res.status < 500) return; // accepted, or refused on purpose (401/429): no retry
    } catch {
      /* unreachable: try the next endpoint */
    }
  }
}

/**
 * @param {object} p
 * @param {string} p.kind     "unhandled" | "render" | "network" | "error" | "cancelled" | "failed" | "verify-failed"
 * @param {string} [p.flow]   feature name ("chat", "upload", "citation-report")
 * @param {string} [p.message] what the user saw
 * @param {*}      [p.error]  Error (or anything thrown)
 * @param {string} [p.url]    failing request URL (network kind)
 * @param {number} [p.status]
 * @param {object} [p.details]
 * @param {string} [p.display] how the user saw it: "toast" | "banner" | "inline" | "modal" | "none"
 */
export function reportClientError({ kind = 'error', flow = 'app', message, error, url, status, details, page, display } = {}) {
  try {
    const jwt = token();
    if (!jwt || !nativeFetch) return;
    if (error && typeof error === 'object') {
      if (reportedErrors.has(error)) return;
      reportedErrors.add(error);
    }
    const err = describeError(error);
    const cleanUrl = url ? stripQuery(url) : undefined;
    const key = `${kind}|${flow}|${message || ''}|${(err && err.message) || ''}|${cleanUrl || ''}|${status || ''}`;
    if (!allowed(key)) return;
    const body = {
      kind,
      flow,
      message: message || (err && err.message) || undefined,
      error: err || undefined,
      url: cleanUrl,
      status: Number.isInteger(status) ? status : undefined,
      page: page || window.location.pathname,
      details: details && typeof details === 'object' ? details : undefined,
      display: display || undefined,
    };
    send(body, jwt).catch(() => {});
  } catch {
    /* never break the app */
  }
}

/** A failed HTTP exchange seen by axios or fetch. */
function reportTransportFailure({ lib, url, method, status, requestId, error }) {
  if (!url || isOurs(url)) return;
  if (status !== null && status !== undefined) {
    // The backend that answered already stored this with the same request id.
    if (requestId) return;
    reportClientError({ kind: 'network', flow: lib, message: `HTTP ${status} from ${stripQuery(url)}`, url, status, error, details: { method } });
    return;
  }
  reportClientError({ kind: 'network', flow: lib, url, error, details: { method, code: error && error.code } });
}

function patchAxios() {
  try {
    const proto = axios && axios.Axios && axios.Axios.prototype;
    if (!proto || proto.request.__errorlogWrapped) return;
    const orig = proto.request;
    proto.request = function errorlogAxiosRequest(configOrUrl, config) {
      const out = orig.apply(this, arguments); // eslint-disable-line prefer-rest-params
      if (!out || typeof out.catch !== 'function') return out;
      return out.catch((err) => {
        try {
          const cfg = (err && err.config) || (typeof configOrUrl === 'object' ? configOrUrl : config) || {};
          const base = cfg.baseURL && !/^https?:/i.test(String(cfg.url || '')) ? String(cfg.baseURL).replace(/\/$/, '') + '/' : '';
          const url = typeof configOrUrl === 'string' && !cfg.url ? configOrUrl : `${base}${String(cfg.url || '').replace(/^\//, base ? '' : '/')}`;
          const method = String(cfg.method || 'GET').toUpperCase();
          const res = err && err.response;
          const requestId = res && res.headers && (res.headers['x-request-id'] || (typeof res.headers.get === 'function' ? res.headers.get('x-request-id') : null));
          reportTransportFailure({ lib: 'axios', url, method, status: res ? res.status : null, requestId, error: err });
        } catch { /* ignore */ }
        throw err;
      });
    };
    proto.request.__errorlogWrapped = true;
  } catch {
    /* axios missing or different shape */
  }
}

/** Call once at startup (main.jsx). */
export function installClientErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  window.__nativeFetch = nativeFetch;

  window.addEventListener('error', (event) => {
    try {
      if (event && event.target && event.target !== window && (event.target.src || event.target.href)) {
        // a script / stylesheet / image failed to load
        const src = event.target.src || event.target.href;
        reportClientError({ kind: 'network', flow: 'asset', message: 'Resource failed to load', url: String(src) });
        return;
      }
      reportClientError({ kind: 'unhandled', flow: 'app', error: event.error || event.message, message: event.message });
    } catch { /* ignore */ }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    try {
      reportClientError({ kind: 'unhandled', flow: 'promise', error: event.reason });
    } catch { /* ignore */ }
  });

  patchAxios();

  if (nativeFetch) {
    window.fetch = async function errorlogFetch(input, init) {
      let url = null;
      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch { url = null; }
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      let res;
      try {
        res = await nativeFetch(input, init);
      } catch (e) {
        reportTransportFailure({ lib: 'fetch', url, method, status: null, requestId: null, error: e });
        throw e;
      }
      try {
        if (res && res.status >= 400) {
          const requestId = res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-request-id') : null;
          reportTransportFailure({ lib: 'fetch', url, method, status: res.status, requestId, error: null });
        }
      } catch { /* ignore */ }
      return res;
    };
  }

  const origConsoleError = console.error.bind(console);
  console.error = (...args) => {
    try {
      const err = args.find((a) => a instanceof Error);
      if (err) {
        const text = args.find((a) => typeof a === 'string');
        reportClientError({ kind: 'error', flow: 'console', error: err, message: text ? String(text).slice(0, 300) : undefined });
      }
    } catch { /* ignore */ }
    origConsoleError(...args);
  };
}

export default reportClientError;
