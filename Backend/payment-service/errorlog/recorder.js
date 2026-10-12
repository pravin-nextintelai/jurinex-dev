'use strict';
/** Build events, collect them per request, merge and hand them to the writer. */
const crypto = require('crypto');
const classify = require('./classify');
const auditmeta = require('./auditmeta');
const { getContext, isInternal } = require('./context');
const S = require('./sanitize');

const { SOURCE, CAT, SEV, SEVERITY_RANK } = classify;
const SEEN = Symbol.for('errorlog.recorded');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function isSeen(err) { return !!(err && typeof err === 'object' && err[SEEN]); }
function markSeen(err) { try { if (err && typeof err === 'object') Object.defineProperty(err, SEEN, { value: true, enumerable: false, configurable: true }); } catch (_) { /* frozen */ } }

function errText(err) {
  if (err === null || err === undefined) return 'Error';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) return err.message;
  try { return String(err); } catch (_) { return 'Error'; }
}

class Recorder {
  constructor(cfg, writer) {
    this.cfg = cfg;
    this.writer = writer;
    this.recordedTotal = 0;
  }

  base(fields = {}) {
    return Object.assign({
      id: uuid(),
      created_at: new Date(),
      service_name: this.cfg.serviceName,
      environment: this.cfg.environment,
      source: SOURCE.HTTP,
      category: CAT.INTERNAL,
      severity: SEV.ERROR,
      request_id: null, user_id: null, user_email: null, ip_address: null, endpoint: null,
      http_method: null, method: null, action: null, resource_type: null, resource_id: null,
      status_code: null, user_message: null, error_type: 'Error', error_message: '',
      stack_trace: null, external_provider: null, external_endpoint: null, external_model: null,
      external_status_code: null, external_error_code: null, external_response: null,
      latency_ms: null, payload: {}, fingerprint: null, is_resolved: false, resolved_by: null,
      resolved_at: null, resolution_note: null, error_summary: null, error_code: null, what_happened: null, suggested_fix: null,
      // internal (not stored)
      _frame: null, _err: null, _afterResponseStart: false,
    }, fields);
  }

  eventFromError(err, opts = {}) {
    const isErr = err instanceof Error || (err && typeof err === 'object' && typeof err.stack === 'string');
    const [cat, sev] = classify.classifyError(isErr ? err : null);
    const own = isErr ? classify.firstOwnFrame(err, this.cfg.root) : classify.currentOwnFrame(this.cfg.root);
    let message = errText(err);
    if (opts.message) message = message && message !== (err && err.name) ? `${opts.message} | ${message}` : opts.message;
    const ev = this.base({
      source: opts.source || SOURCE.HTTP,
      category: opts.category || cat,
      severity: opts.severity || sev,
      error_type: String((isErr && (err.name || (err.constructor && err.constructor.name))) || (typeof err === 'string' ? 'Error' : (err && err.constructor && err.constructor.name) || 'Error')).slice(0, 255),
      error_message: S.truncate(S.maskText(message), S.MAX_ERROR_MESSAGE) || '',
      stack_trace: isErr && err.stack ? S.tail(S.maskText(String(err.stack)), S.MAX_STACK) : null,
      method: opts.method || own.method,
      endpoint: opts.endpoint || null,
      payload: Object.assign({}, opts.payload || {}),
      _frame: own.frame,
      _err: isErr ? err : null,
      _afterResponseStart: !!opts.afterResponseStart,
    });
    if (isErr) {
      if (err.code !== undefined && err.code !== null && typeof err.code !== 'object') ev.payload.code = String(err.code).slice(0, 100);
      const cause = err.cause;
      if (cause && cause !== err) ev.payload.cause = S.truncate(S.maskText(`${cause.name || 'Error'}: ${errText(cause)}`), 300);
    }
    return ev;
  }

  eventExternal(opts) {
    const { provider, url, methodName, status, errorCode, responseText, err, model, latencyMs, category, severity, payload, errorType, message } = opts;
    const timeout = (err && classify.isTimeout(err)) || classify.isTimeoutCode(status, errorCode);
    const cat = category || classify.categoryForProvider(provider, timeout);
    const sev = severity || classify.severityForExternal(provider, status, errorCode);
    let ev;
    if (err) {
      ev = this.eventFromError(err, { source: SOURCE.EXTERNAL, category: cat, severity: sev, payload });
      if (message) ev.error_message = S.truncate(S.maskText(`${message} | ${ev.error_message}`), S.MAX_ERROR_MESSAGE);
    } else {
      const own = classify.currentOwnFrame(this.cfg.root);
      let msg = message || `${provider || 'external'} call failed`;
      if (status !== undefined && status !== null) msg += ` (HTTP ${status})`;
      if (errorCode) msg += ` [${errorCode}]`;
      ev = this.base({
        source: SOURCE.EXTERNAL, category: cat, severity: sev,
        error_type: String(errorType || (status ? `HttpStatus${status}` : 'ExternalError')).slice(0, 255),
        error_message: S.truncate(S.maskText(msg), S.MAX_ERROR_MESSAGE) || '',
        method: own.method, _frame: own.frame, payload: Object.assign({}, payload || {}),
      });
    }
    if (errorType) ev.error_type = String(errorType).slice(0, 255);
    ev.external_provider = provider ? String(provider).slice(0, 50) : null;
    ev.external_endpoint = (S.stripQuery(url) || methodName || null);
    if (ev.external_endpoint) ev.external_endpoint = String(ev.external_endpoint).slice(0, 500);
    if (methodName && url) ev.payload.sdk_method = methodName;
    ev.external_model = model ? String(model).slice(0, 100) : null;
    ev.external_status_code = Number.isInteger(status) ? status : null;
    ev.external_error_code = errorCode ? String(errorCode).slice(0, 100) : null;
    ev.external_response = responseText ? S.truncate(S.maskText(String(responseText)), S.MAX_EXTERNAL_RESPONSE) : null;
    ev.latency_ms = Number.isFinite(latencyMs) ? Math.round(latencyMs) : null;
    return ev;
  }

  /** Queue on the current request, or write now when outside one. */
  record(ev) {
    if (!this.cfg.enabled || isInternal()) return null;
    try {
      const err = ev._err;
      if (err) {
        if (isSeen(err)) return null;
        markSeen(err);
      }
      const ctx = getContext();
      if (ctx) {
        if (!ctx.flushed) { ctx.pending.push(ev); return ev; }
        this.applyContext(ev, ctx);
        this.finalizeAndWrite([ev]);
        return ev;
      }
      this.finalizeAndWrite([ev]);
      return ev;
    } catch (_) {
      return null;
    }
  }

  recordError(err, opts = {}) {
    if (!this.cfg.enabled || isInternal()) return null;
    if (err === null || err === undefined) return null;
    try { return this.record(this.eventFromError(err, opts)); } catch (_) { return null; }
  }

  /** Write now, whatever the current request ends with (client reports, audit-style events). Returns the request id. */
  recordNow(ev) {
    if (!this.cfg.enabled) return null;
    try {
      const ctx = getContext();
      if (ctx) this.applyContext(ev, ctx);
      const before = ctx ? ctx.writtenIds.length : 0;
      this.finalizeAndWrite([ev]);
      if (ctx) { ctx.writtenIds.length = before; ctx.writtenEvents.length = before; } // the carrier POST did not fail
      // A client report is its own activity (client:token-topup …), not the POST that carried it.
      this.auditFromError(ev);
      return ev.request_id || null;
    } catch (_) {
      return null;
    }
  }

  /** Audit row for an error with no request of its own (job, process, browser report). */
  auditFromError(ev) {
    if (!this.cfg.auditEnabled) return;
    try {
      const payload = { source: ev.source, category: ev.category, severity: ev.severity };
      if (ev.external_provider) payload.external_provider = ev.external_provider;
      this.writer.enqueue({
        _table: 'audit',
        id: uuid(),
        created_at: new Date(),
        service_name: this.cfg.serviceName,
        environment: this.cfg.environment,
        request_id: ev.request_id || null,
        user_id: ev.user_id || null,
        user_email: ev.user_email || null,
        ip_address: ev.ip_address || null,
        http_method: ev.http_method || null,
        endpoint: String(ev.endpoint || `${String(ev.source || 'job').toLowerCase()}:${ev.method || 'unknown'}`).slice(0, 500),
        route: null,
        status_code: ev.status_code === undefined ? null : ev.status_code,
        status: 'FAILED',
        duration_ms: null,
        error_log_id: ev.id,
        user_agent: null,
        resource_type: ev.resource_type || null,
        resource_id: ev.resource_id || null,
        action: ev.action || null,
        method: ev.method ? String(ev.method).slice(0, 255) : null,
        error_type: ev.error_type || null,
        error_message: S.truncate(ev.error_message, S.MAX_ERROR_MESSAGE),
        user_message: ev.user_message || null,
        stack_trace: ev.stack_trace || null,
        error_summary: ev.error_summary || null,
        error_code: ev.error_code || null,
        what_happened: ev.what_happened || null,
        suggested_fix: ev.suggested_fix || null,
        payload: S.sanitizePayload(payload),
      });
    } catch (_) { /* never throw */ }
  }

  seen(err) { return isSeen(err); }

  /** req.user set by the service's own auth middleware wins over the JWT peek. */
  resolveUser(ctx) {
    const u = ctx.req && ctx.req.user;
    if (u && typeof u === 'object') {
      const uid = u.id !== undefined ? u.id : (u.user_id !== undefined ? u.user_id : (u.userId !== undefined ? u.userId : (u.uid !== undefined ? u.uid : u.sub)));
      if (uid !== undefined && uid !== null && String(uid)) ctx.userId = String(uid).slice(0, 64);
      if (typeof u.email === 'string' && u.email.includes('@')) ctx.userEmail = u.email.slice(0, 255);
    } else if (ctx.req && ctx.req.userId !== undefined && ctx.req.userId !== null) {
      ctx.userId = String(ctx.req.userId).slice(0, 64);
    }
    const headers = (ctx.req && ctx.req.headers) || {};
    if (!ctx.userEmail && typeof headers['x-user-email'] === 'string' && headers['x-user-email'].includes('@')) {
      ctx.userEmail = headers['x-user-email'].slice(0, 255);
    }
  }

  applyContext(ev, ctx) {
    ev.request_id = ev.request_id || ctx.requestId;
    this.resolveUser(ctx);
    ev.user_id = ev.user_id || ctx.userId;
    ev.user_email = ev.user_email || ctx.userEmail;
    ev.ip_address = ev.ip_address || ctx.ipAddress;
    ev.endpoint = ev.endpoint || ctx.endpoint;
    ev.http_method = ev.http_method || ctx.httpMethod;
    ev.status_code = ctx.statusCode !== null ? ctx.statusCode : ev.status_code;
    if (ctx.userMessage && ctx.statusCode !== null && ctx.statusCode >= 400) ev.user_message = ctx.userMessage;
    ev.action = ev.action || ctx.action;
    ev.resource_type = ev.resource_type || ctx.resourceType;
    ev.resource_id = ev.resource_id || ctx.resourceId;
    const hadMethod = !!ev.method;
    if (!ev.method) ev.method = ctx.methodOverride || ctx.extra.route_method || null;
    const meta = auditmeta.enrich({
      httpMethod: ctx.httpMethod,
      endpoint: ctx.endpoint,
      route: ctx.routeTemplate,
      resourceType: ev.resource_type,
      resourceId: ev.resource_id,
      action: ev.action,
      routeMethod: ev.method,
      serviceName: this.cfg.serviceName,
    });
    ev.action = meta.action;
    ev.resource_type = meta.resource_type;
    ev.resource_id = meta.resource_id;
    if (!hadMethod && meta.method) ev.method = meta.method;
    if (ctx.routeTemplate && ev.payload.route === undefined) ev.payload.route = ctx.routeTemplate;
    if (ctx.userAgent && ev.payload.user_agent === undefined) ev.payload.user_agent = S.truncate(ctx.userAgent, 300);
    if (ctx.streaming && ev.payload.streaming === undefined) ev.payload.streaming = true;
    if (ev._afterResponseStart && ev.payload.after_response_start === undefined) ev.payload.after_response_start = true;
    for (const [k, v] of Object.entries(ctx.extra)) if (k !== 'route_method' && ev.payload[k] === undefined) ev.payload[k] = v;
    if (ev.payload.duration_ms === undefined) ev.payload.duration_ms = Date.now() - ctx.startedAt;
  }

  syntheticHttpError(ctx) {
    return this.base({
      source: SOURCE.HTTP, category: CAT.INTERNAL,
      severity: ctx.statusCode >= 500 ? SEV.ERROR : SEV.WARNING,
      error_type: `HttpErrorResponse${ctx.statusCode}`,
      error_message: S.truncate(ctx.userMessage || `HTTP ${ctx.statusCode} returned by the route`, S.MAX_ERROR_MESSAGE),
      method: ctx.methodOverride || ctx.extra.route_method || null,
    });
  }

  /** 4xx on an endpoint under ERROR_LOG_STORE_4XX_PREFIXES (never 401/403/404) is a user-facing failure worth a row. */
  storedByPrefix(ctx, status) {
    if (status < 400 || status >= 500 || [401, 403, 404].includes(status)) return false;
    const ep = ctx.endpoint || '';
    return this.cfg.store4xxPrefixes.some((p) => ep.startsWith(p));
  }

  flushContext(ctx) {
    if (ctx.flushed) return 0;
    ctx.flushed = true;
    if (!this.cfg.enabled) return 0;
    try { return this.flush(ctx); } catch (_) { return 0; }
  }

  flush(ctx) {
    const status = ctx.statusCode;
    let events = ctx.pending.slice();
    ctx.pending.length = 0;
    if (ctx.suppress) return 0;
    const hasStatus = status !== null && status !== undefined;

    if (this.cfg.captureAll) {
      // Everything is kept. A request that still answered < 400 recovered from
      // its errors: they are stored as WARNING with payload.recovered.
      const skipped = hasStatus && this.cfg.skipStatus.has(status);
      if (!events.length && hasStatus && status >= 400 && !skipped) events.push(this.syntheticHttpError(ctx));
      if (hasStatus && status < 400) {
        for (const e of events) {
          if (!e._afterResponseStart) { e.payload.recovered = true; if (e.severity !== SEV.CRITICAL) e.severity = SEV.WARNING; }
        }
      }
      if (skipped) events = events.filter((e) => e._afterResponseStart || e.source !== SOURCE.HTTP || e._err);
    } else {
      let storedStatus;
      if (!hasStatus) storedStatus = events.some((e) => e.source !== SOURCE.EXTERNAL);
      else storedStatus = status >= 500 || (status >= 400 && !this.cfg.skipStatus.has(status)) || this.storedByPrefix(ctx, status);

      // A route that answered 5xx (or a 4xx on a stored prefix) without any error
      // reaching us still gets a row. Other 4xx only ride along with recorded errors.
      if (!events.length && hasStatus && (status >= 500 || this.storedByPrefix(ctx, status))) {
        events.push(this.syntheticHttpError(ctx));
      }
      if (!storedStatus) {
        const kept = events.filter((e) => e._afterResponseStart);
        if (this.cfg.storeRecoveredExternal) {
          for (const e of events) {
            if (e.source === SOURCE.EXTERNAL && !kept.includes(e)) { e.severity = SEV.WARNING; e.payload.recovered = true; kept.push(e); }
          }
        }
        events = kept;
      }
    }
    if (!events.length) return 0;
    for (const e of events) this.applyContext(e, ctx);

    const groups = new Map();
    for (const e of events) {
      this.fingerprintOf(e);
      const key = e.fingerprint || e.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const primaries = [];
    for (const grp of groups.values()) {
      const head = grp[0];
      if (grp.length > 1) {
        head.payload.attempts = grp.length;
        const last = grp[grp.length - 1];
        if (last.latency_ms !== null) head.latency_ms = last.latency_ms;
      }
      primaries.push(head);
    }
    const externals = primaries.filter((e) => e.source === SOURCE.EXTERNAL);
    if (externals.length && status >= 500) {
      externals.sort((a, b) => (SEVERITY_RANK[b.severity] || 1) - (SEVERITY_RANK[a.severity] || 1) || a.created_at - b.created_at);
      const primary = externals[0];
      const others = primaries.filter((e) => e !== primary);
      if (others.length) {
        primary.payload.related = others.slice(0, 10).map((o) => ({ error_type: o.error_type, category: o.category, method: o.method, message: S.truncate(o.error_message, 200) }));
        const internal = others.find((o) => o.source !== SOURCE.EXTERNAL);
        if (internal && internal.stack_trace) {
          primary.payload.internal_error = `${internal.error_type}: ${S.truncate(internal.error_message, 500)}`;
          primary.payload.internal_stack = S.tail(internal.stack_trace, 3000);
        }
      }
      primary.status_code = status;
      primary.user_message = ctx.userMessage;
      return this.finalizeAndWrite([primary]);
    }
    return this.finalizeAndWrite(primaries);
  }

  fingerprintOf(ev) {
    if (!ev.fingerprint) ev.fingerprint = classify.fingerprint(this.cfg.serviceName, ev.error_type, ev.method, ev._frame, ev.external_provider, ev.external_error_code);
  }

  finalizeAndWrite(events) {
    let n = 0;
    const ctx = getContext();
    for (const ev of events) {
      try {
        this.fingerprintOf(ev);
        if (!ev.error_summary) ev.error_summary = String(classify.summarize(ev)).slice(0, 500);
        if (!ev.error_code) Object.assign(ev, classify.explain(ev));
        ev.payload = ev.payload && Object.keys(ev.payload).length ? S.sanitizePayload(ev.payload) : null;
        if (ev.user_message) ev.user_message = S.truncate(S.maskText(ev.user_message), S.MAX_USER_MESSAGE);
        if (this.writer.enqueue(ev)) {
          n += 1; this.recordedTotal += 1;
          if (ctx) { ctx.writtenIds.push(ev.id); ctx.writtenEvents.push(ev); } else this.auditFromError(ev); // no request: the error is the activity
        }
      } catch (_) { /* never throw */ }
    }
    return n;
  }

  // ── API audit log ───────────────────────────────────────────────────────

  shouldAudit(ctx) {
    if (!this.cfg.enabled || !this.cfg.auditEnabled || ctx.suppress) return false;
    const m = String(ctx.httpMethod || '').toUpperCase();
    if (m === 'OPTIONS' || m === 'HEAD') return false;
    const ep = ctx.endpoint || '';
    if (this.cfg.auditSkipPrefixes.some((p) => ep.startsWith(p))) return false;
    if ((ctx.statusCode === null || ctx.statusCode === undefined) && !ctx.writtenIds.length) return false;
    return true;
  }

  /** One api_audit_logs row for the request: who used which API, and how it went. */
  auditRequest(ctx) {
    try {
      if (!this.shouldAudit(ctx)) return null;
      this.resolveUser(ctx);
      const status = ctx.statusCode;
      const failed = !!ctx.writtenIds.length || (Number.isInteger(status) && status >= 400);
      const routeMethod = ctx.methodOverride || ctx.extra.route_method || null;
      const meta = auditmeta.enrich({
        httpMethod: ctx.httpMethod,
        endpoint: ctx.endpoint,
        route: ctx.routeTemplate,
        resourceType: ctx.resourceType,
        resourceId: ctx.resourceId,
        action: ctx.action,
        routeMethod,
        serviceName: this.cfg.serviceName,
      });
      const payload = {};
      if (ctx.streaming) payload.streaming = true;
      if (meta.method) payload.method = meta.method;
      else if (routeMethod) payload.method = routeMethod;
      if (ctx.writtenIds.length > 1) payload.error_log_ids = ctx.writtenIds.slice(0, 10);
      const ev = {
        _table: 'audit',
        id: uuid(),
        created_at: new Date(),
        service_name: this.cfg.serviceName,
        environment: this.cfg.environment,
        request_id: ctx.requestId,
        user_id: ctx.userId || null,
        user_email: ctx.userEmail || null,
        ip_address: ctx.ipAddress || null,
        http_method: ctx.httpMethod || null,
        endpoint: ctx.endpoint ? String(ctx.endpoint).slice(0, 500) : null,
        route: ctx.routeTemplate ? String(ctx.routeTemplate).slice(0, 500) : null,
        status_code: Number.isInteger(status) ? status : null,
        status: failed ? 'FAILED' : 'SUCCESS',
        duration_ms: Date.now() - ctx.startedAt,
        error_log_id: (failed && ctx.writtenIds[0]) ? ctx.writtenIds[0] : null,
        user_agent: ctx.userAgent ? S.truncate(ctx.userAgent, 300) : null,
        resource_type: meta.resource_type || null,
        resource_id: meta.resource_id || null,
        action: meta.action || null,
        method: meta.method || null,
        error_type: null,
        error_message: null,
        user_message: null,
        stack_trace: null,
        error_summary: null,
        error_code: null,
        what_happened: null,
        suggested_fix: null,
        payload: Object.keys(payload).length ? S.sanitizePayload(payload) : null,
      };
      if (failed) {
        // The error travels with the audit row; empty on success.
        const primary = ctx.writtenEvents[0];
        if (primary) {
          ev.error_type = primary.error_type || null;
          ev.error_message = S.truncate(primary.error_message, S.MAX_ERROR_MESSAGE);
          ev.user_message = primary.user_message || ctx.userMessage || null;
          ev.stack_trace = primary.stack_trace || null;
          ev.error_summary = primary.error_summary || null;
          ev.error_code = primary.error_code || null; ev.suggested_fix = primary.suggested_fix || null;
          ev.what_happened = classify.explain(Object.assign({}, ev, { source: primary.source, category: primary.category })).what_happened;
        } else {
          ev.error_type = Number.isInteger(status) ? `HttpErrorResponse${status}` : null;
          ev.error_message = ctx.userMessage || null;
          ev.user_message = ctx.userMessage || null;
          ev.error_summary = String(classify.summarize({ source: 'HTTP', category: 'INTERNAL', severity: 'WARNING', error_type: ev.error_type, error_message: ctx.userMessage, status_code: status })).slice(0, 500);
          Object.assign(ev, classify.explain(Object.assign({}, ev, { source: 'HTTP', category: 'INTERNAL' })));
        }
      }
      this.writer.enqueue(ev);
      return ev;
    } catch (_) {
      return null;
    }
  }
}

module.exports = { Recorder, isSeen, markSeen };
