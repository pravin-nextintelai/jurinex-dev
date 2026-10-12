'use strict';
/**
 * Outgoing HTTP: http/https.request (covers axios, node-fetch, got, googleapis,
 * http-proxy-middleware, raw http) and globalThis.fetch (undici). Observes
 * events through `emit` so no listeners are added and unhandled-error semantics
 * stay unchanged. Records non-2xx, timeouts and connection errors; forwards
 * x-request-id; strips query strings.
 */
const http = require('http');
const https = require('https');
const { AsyncLocalStorage } = require('async_hooks');
const { getContext, isInternal } = require('../context');
const { hostOf, stripQuery } = require('../sanitize');

const sdkAls = new AsyncLocalStorage(); // true while a Gemini SDK call runs
const originals = { fetch: null, httpRequest: null, httpsRequest: null };

function inSdkCall() { return sdkAls.getStore() === true; }
function runInSdk(fn) { return sdkAls.run(true, fn); }

class HttpHook {
  constructor(recorder, cfg) { this.recorder = recorder; this.cfg = cfg; }
  provider(url) {
    const host = hostOf(url);
    const name = this.cfg.providerForHost(host);
    if (name) return name;
    return host ? host.split(':')[0].slice(0, 50).toUpperCase() : null;
  }
  shouldSkip(url) {
    if (isInternal()) return true;
    if (url && /\/internal\/(error-logs|audit-logs)(\/|$|\?)/i.test(String(url))) return true;
    if (inSdkCall() && this.provider(url) === 'GEMINI') return true;
    return false;
  }
  requestId() { const ctx = getContext(); return ctx ? ctx.requestId : null; }
  record({ url, method, status, err, started, reason, responseText }) {
    try {
      if (!err && (status === undefined || status === null || status < 400)) return;
      if (this.shouldSkip(url)) return;
      const ev = this.recorder.eventExternal({
        provider: this.provider(url), url: stripQuery(url), status, err,
        latencyMs: Date.now() - started, responseText: responseText || reason || null,
        errorCode: (!err && reason && (status === undefined || status === null)) ? String(reason).slice(0, 100) : (err && err.code ? String(err.code).slice(0, 100) : null),
        payload: { http_method: String(method || '').toUpperCase().slice(0, 10) },
      });
      this.recorder.record(ev);
    } catch (_) { /* never throw */ }
  }
}

function describeArgs(args, protocol) {
  let url = null; let options = null;
  if (typeof args[0] === 'string') { url = args[0]; options = args[1] && typeof args[1] === 'object' ? args[1] : null; }
  else if (args[0] instanceof URL) { url = args[0].toString(); options = args[1] && typeof args[1] === 'object' ? args[1] : null; }
  else if (args[0] && typeof args[0] === 'object') options = args[0];
  let method = 'GET';
  if (options) {
    if (options.method) method = String(options.method).toUpperCase();
    if (!url) {
      const proto = options.protocol || protocol;
      const host = options.hostname || options.host || 'localhost';
      const port = options.port && !String(host).includes(':') ? `:${options.port}` : '';
      url = `${proto}//${host}${port}${options.path || '/'}`;
    }
  }
  return { url, method };
}

function patchModule(mod, protocol, hook, key) {
  if (mod.request.__errorlogWrapped) return false;
  const origRequest = mod.request;
  originals[key] = origRequest;
  function request(...args) {
    const { url, method } = describeArgs(args, protocol);
    const req = origRequest.apply(this, args);
    if (!url || hook.shouldSkip(url)) return req;
    try {
      const rid = hook.requestId();
      if (rid && !req.headersSent && !req.getHeader('x-request-id')) req.setHeader('x-request-id', rid);
    } catch (_) { /* headers already flushed */ }
    const started = Date.now();
    let done = false; let timedOut = false;
    const origEmit = req.emit;
    req.emit = function errorlogEmit(event, ...rest) {
      try {
        if (event === 'response' && !done) {
          done = true;
          const res = rest[0];
          if (res && res.statusCode >= 400) hook.record({ url, method, status: res.statusCode, reason: res.statusMessage, started });
        } else if (event === 'timeout') {
          timedOut = true;
        } else if (event === 'error' && !done) {
          done = true;
          const err = rest[0];
          if (timedOut && err && !err.code) { try { err.code = 'ETIMEDOUT'; } catch (_) { /* frozen */ } }
          hook.record({ url, method, err, started });
        }
      } catch (_) { /* ignore */ }
      return origEmit.call(this, event, ...rest);
    };
    return req;
  }
  request.__errorlogWrapped = true;
  mod.request = request;
  mod.get = function get(...args) { const req = mod.request(...args); req.end(); return req; };
  mod.get.__errorlogWrapped = true;
  return true;
}

function patchFetch(hook) {
  if (typeof globalThis.fetch !== 'function' || globalThis.fetch.__errorlogWrapped) return false;
  const orig = globalThis.fetch;
  originals.fetch = orig;
  async function errorlogFetch(input, init) {
    let url;
    try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (_) { url = null; }
    if (!url || hook.shouldSkip(url)) return orig.call(this, input, init);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    try {
      const rid = hook.requestId();
      if (rid) {
        if (init && init.headers !== undefined) {
          const h = new Headers(init.headers);
          if (!h.has('x-request-id')) h.set('x-request-id', rid);
          init = Object.assign({}, init, { headers: h });
        } else if (typeof Request === 'function' && input instanceof Request) {
          if (!input.headers.has('x-request-id')) {
            const h = new Headers(input.headers); h.set('x-request-id', rid);
            input = new Request(input, { headers: h });
          }
        } else {
          init = Object.assign({}, init || {}, { headers: { 'x-request-id': rid } });
        }
      }
    } catch (_) { /* leave the request untouched */ }
    const started = Date.now();
    let res;
    try { res = await orig.call(this, input, init); } catch (err) { hook.record({ url, method, err, started }); throw err; }
    if (res && res.status >= 400) hook.record({ url, method, status: res.status, reason: res.statusText, started });
    return res;
  }
  errorlogFetch.__errorlogWrapped = true;
  globalThis.fetch = errorlogFetch;
  return true;
}

function install(recorder, cfg) {
  const hook = new HttpHook(recorder, cfg);
  const patched = [];
  try { if (patchModule(http, 'http:', hook, 'httpRequest')) patched.push('http.request'); } catch (_) { /* ignore */ }
  try { if (patchModule(https, 'https:', hook, 'httpsRequest')) patched.push('https.request'); } catch (_) { /* ignore */ }
  try { if (patchFetch(hook)) patched.push('globalThis.fetch'); } catch (_) { /* ignore */ }
  return patched;
}

module.exports = { install, HttpHook, originals, inSdkCall, runInSdk };
