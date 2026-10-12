'use strict';
/** Express: first middleware (context + request id + response hook) and the error handler. */
const { RequestContext, runWith, getContext, newRequestId, userFromHeaders, clientIp } = require('../context');
const { extractUserMessage, truncate } = require('../sanitize');
const { SOURCE } = require('../classify');

const RID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const STREAMING_RE = /text\/event-stream|application\/x-ndjson|application\/stream\+json/i;

function routeMethodName(req) {
  try {
    const route = req.route;
    if (!route || !route.stack || !route.stack.length) return null;
    const handle = route.stack[route.stack.length - 1].handle;
    const name = handle && handle.name && handle.name !== 'anonymous' && !/^bound /.test(handle.name) ? handle.name : null;
    const base = `${req.baseUrl || ''}${route.path || ''}`.replace(/\/+/g, '/');
    return name ? `${base} ${name}` : null;
  } catch (_) { return null; }
}

function resourceFromParams(params) {
  if (!params || typeof params !== 'object') return [null, null];
  const ids = Object.entries(params).filter(([k]) => /(_id|Id|_name)$/.test(k));
  if (!ids.length) return [null, null];
  const preferred = ['folder', 'case', 'file', 'document', 'user', 'ticket', 'session', 'chat'];
  const score = (k) => {
    const base = k.replace(/(_id|Id|_name)$/, '').toLowerCase();
    const idx = preferred.findIndex((t) => base.includes(t));
    return idx === -1 ? 99 : idx;
  };
  ids.sort((a, b) => score(a[0]) - score(b[0]));
  const [k, v] = ids[0];
  const base = k.replace(/(_id|Id|_name)$/, '');
  const type = base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().slice(0, 50) || null;
  return [type, v === undefined || v === null ? null : String(v).slice(0, 100)];
}

function requestMiddleware(recorder, cfg) {
  return function errorlogContext(req, res, next) {
    let ctx;
    try {
      const headers = req.headers || {};
      const incoming = String(headers['x-request-id'] || '').trim();
      const rid = RID_RE.test(incoming) ? incoming : newRequestId();
      ctx = new RequestContext({
        requestId: rid,
        ipAddress: clientIp(headers, req.socket && req.socket.remoteAddress),
        endpoint: String(req.originalUrl || req.url || '').split('?')[0].slice(0, 500),
        httpMethod: String(req.method || '').slice(0, 10) || null,
        userAgent: headers['user-agent'] || null,
        req,
      });
      const u = userFromHeaders(headers);
      ctx.userId = u.userId; ctx.userEmail = u.email;
      req.errorlogContext = ctx;
      if (req.requestId === undefined) req.requestId = rid;
      try { res.setHeader('x-request-id', rid); } catch (_) { /* headers sent */ }

      const origWrite = res.write;
      const origEnd = res.end;
      // Let browser code read x-request-id on cross-origin responses, so the
      // frontend reporter can tell which failures this backend already stored.
      let exposed = false;
      const expose = () => {
        if (exposed || res.headersSent) return;
        exposed = true;
        try {
          const cur = res.getHeader('access-control-expose-headers');
          const list = cur ? String(cur) : '';
          if (!list) res.setHeader('access-control-expose-headers', 'x-request-id');
          else if (!/x-request-id/i.test(list) && list.trim() !== '*') res.setHeader('access-control-expose-headers', `${list}, x-request-id`);
        } catch (_) { /* ignore */ }
      };
      const origWriteHead = res.writeHead;
      res.writeHead = function errorlogWriteHead(...args) { expose(); return origWriteHead.apply(this, args); };
      const peek = (chunk) => {
        if (chunk === null || chunk === undefined || typeof chunk === 'function') return;
        if (ctx.streaming || ctx.bodyPeekLen >= cfg.bodyPeekBytes) return;
        if ((res.statusCode || 200) < 400) return;
        const ct = String(res.getHeader('content-type') || '');
        if (STREAMING_RE.test(ct)) { ctx.streaming = true; return; }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const slice = buf.subarray(0, cfg.bodyPeekBytes - ctx.bodyPeekLen);
        ctx.bodyPeek.push(slice); ctx.bodyPeekLen += slice.length;
      };
      res.write = function errorlogWrite(chunk, ...args) { ctx.responseStarted = true; expose(); try { peek(chunk); } catch (_) { /* ignore */ } return origWrite.call(this, chunk, ...args); };
      res.end = function errorlogEnd(chunk, ...args) { ctx.responseStarted = true; expose(); try { peek(chunk); } catch (_) { /* ignore */ } return origEnd.call(this, chunk, ...args); };

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try {
          ctx.statusCode = res.statusCode || null;
          ctx.contentType = String(res.getHeader('content-type') || '') || null;
          if (STREAMING_RE.test(ctx.contentType || '')) ctx.streaming = true;
          if (ctx.statusCode !== null && ctx.statusCode >= 400 && ctx.bodyPeekLen) ctx.userMessage = extractUserMessage(Buffer.concat(ctx.bodyPeek), ctx.contentType);
          if (req.route && req.route.path) ctx.routeTemplate = `${req.baseUrl || ''}${req.route.path}`.replace(/\/+/g, '/');
          const rm = routeMethodName(req);
          if (rm) ctx.extra.route_method = rm;
          if (ctx.resourceType === null) { const [t, id] = resourceFromParams(req.params); if (t) { ctx.resourceType = t; ctx.resourceId = id; } }
          if (res.headersSent || res.writableEnded || ctx.pending.length) recorder.flushContext(ctx);
          else ctx.statusCode = null; // aborted before any response
          // One audit row per request: who used which API, with the error row linked.
          recorder.auditRequest(ctx);
        } catch (_) { /* never throw */ }
      };
      res.on('finish', finish);
      res.on('close', finish);
    } catch (_) {
      return next();
    }
    return runWith(ctx, () => next());
  };
}

function defaultFormat(err, status, rid) {
  if (status >= 500) return { message: 'Internal server error', request_id: rid };
  return { message: (err && err.message) || 'Request failed', request_id: rid };
}

/**
 * Error middleware. With passThrough=true it records and calls next(err) so the
 * service's own handler keeps producing the response (register it just before
 * that handler). Without, it answers itself using `format`.
 */
function errorHandler(recorder, cfg, opts = {}) {
  const format = typeof opts.format === 'function' ? opts.format : defaultFormat;
  const passThrough = !!opts.passThrough;
  // Four declared parameters: that is how Express recognises an error handler.
  return function errorlogErrorHandler(err, req, res, next) {
    const ctx = (req && req.errorlogContext) || getContext();
    let status = Number(err && (err.status || err.statusCode));
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
    try {
      if (status >= 500) {
        const after = !!(ctx && ctx.responseStarted && (res.statusCode || 500) < 500);
        recorder.recordError(err, { source: SOURCE.HTTP, afterResponseStart: after });
      } else if (ctx) {
        ctx.extra.http_error = truncate((err && err.message) || String(err), 300);
      }
    } catch (_) { /* ignore */ }
    const rid = ctx ? ctx.requestId : newRequestId();
    try { if (!res.headersSent) res.setHeader('x-request-id', rid); } catch (_) { /* ignore */ }
    if (passThrough || res.headersSent) return next(err);
    res.status(status);
    return res.json(format(err, status, rid));
  };
}

module.exports = { requestMiddleware, errorHandler, defaultFormat };
