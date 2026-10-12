'use strict';
/**
 * Client-reported errors: failures the browser sees but the backend never does,
 * such as a Razorpay checkout the user cancelled, a declined card, a React render
 * crash, an unhandled promise rejection or a network failure.
 *
 * Mount once, behind the service's own auth middleware so req.user is set:
 *   app.use('/api/payments/client-errors', protect, errorlog.clientErrorRouter());
 *
 * Body (JSON, max 32 KB):
 *   kind        cancelled | failed | verify-failed | unhandled | render | network | error
 *   flow        "token-topup" | "storage-addon" | "subscription" | "chat" | …
 *   message     what the user saw (max 1000)
 *   error       { name, message, stack }
 *   url, status the request that failed and the status seen (network kind)
 *   razorpay    the Razorpay `payment.failed` payload ({ error: { code, description, source, step, reason, metadata } })
 *   order_id, payment_id, plan_id, plan_name, amount, currency, page, details
 *
 * The row is written immediately with the caller's user id and email.
 */
const { SOURCE, CAT, SEV } = require('../classify');
const S = require('../sanitize');
const { resolveFrom } = require('../resolve');

const KINDS = {
  cancelled: ['PaymentCancelled', SEV.WARNING],
  failed: ['PaymentFailed', SEV.ERROR],
  'verify-failed': ['PaymentVerifyFailed', SEV.ERROR],
  unhandled: ['ClientUnhandledError', SEV.ERROR],
  render: ['ClientRenderError', SEV.ERROR],
  network: ['ClientNetworkError', SEV.ERROR],
  error: ['ClientError', SEV.ERROR],
};
const PAYMENT_KINDS = new Set(['cancelled', 'failed', 'verify-failed']);
const RATE_LIMIT_PER_MINUTE = 60;

function str(v, limit) {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return S.truncate(S.maskText(s), limit) || null;
}

class RateLimiter {
  constructor(limit = RATE_LIMIT_PER_MINUTE, windowMs = 60000) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key) {
    const now = Date.now();
    const hits = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (hits.length >= this.limit) { this.hits.set(key, hits); return false; }
    hits.push(now); this.hits.set(key, hits);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] >= this.windowMs) this.hits.delete(k);
    return true;
  }
}

function clientErrorRouter(recorder, cfg, opts = {}) {
  const express = resolveFrom(cfg.root, 'express');
  const router = express.Router();
  const limiter = new RateLimiter();
  router.use(express.json({ limit: '32kb' }));

  const refuse = (req, res, status, message) => {
    if (req.errorlogContext) req.errorlogContext.suppress = true; // our own refusal is not an app error
    return res.status(status).json({ success: false, message });
  };

  router.post('/', (req, res) => {
    const user = req.user && typeof req.user === 'object' ? req.user : null;
    const uid = user ? (user.id !== undefined ? user.id : (user.user_id !== undefined ? user.user_id : user.userId)) : req.userId;
    if ((uid === undefined || uid === null || uid === '') && opts.requireUser !== false) return refuse(req, res, 401, 'Authentication required');
    const key = uid !== undefined && uid !== null ? String(uid) : (req.ip || 'anonymous');
    if (!limiter.allow(key)) return refuse(req, res, 429, 'Too many error reports');
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const kind = KINDS[b.kind] ? b.kind : 'error';
    const [defaultType, severity] = KINDS[kind];
    const flow = (str(b.flow, 50) || 'app').replace(/[^a-z0-9_.:-]/gi, '-').toLowerCase();
    const err = b.error && typeof b.error === 'object' ? b.error : {};
    const errName = str(err.name, 100);
    const errMsg = str(err.message, 2000);
    const stack = typeof err.stack === 'string' && err.stack ? S.tail(S.maskText(err.stack), S.MAX_STACK) : null;
    const userMessage = str(b.message, S.MAX_USER_MESSAGE) || errMsg || (kind === 'cancelled' ? 'Payment cancelled' : 'Error');
    const url = b.url ? S.stripQuery(str(b.url, 500)) : null;
    const status = Number.isInteger(b.status) ? b.status : null;
    const payload = { client_report: true, kind, flow };
    const page = str(b.page || req.headers.referer, 500); if (page) payload.page = page;
    const display = str(b.display, 30); if (display) payload.display = display;
    if (req.headers['user-agent']) payload.user_agent = S.truncate(req.headers['user-agent'], 300);
    if (b.details && typeof b.details === 'object') payload.details = b.details;
    for (const k of ['plan_id', 'plan_name', 'order_id', 'payment_id', 'currency']) if (b[k] !== undefined && b[k] !== null && b[k] !== '') payload[k] = str(b[k], 200);
    if (Number.isFinite(Number(b.amount)) && b.amount !== null && b.amount !== '') payload.amount = Number(b.amount);

    const ev = recorder.base({
      source: SOURCE.HTTP, category: CAT.INTERNAL, severity,
      error_type: errName || defaultType,
      error_message: str(`${flow}: ${errMsg || userMessage}`, S.MAX_ERROR_MESSAGE),
      stack_trace: stack,
      user_message: userMessage,
      endpoint: `client:${flow}`,
      method: `client.${flow}.${kind}`,
      payload,
    });
    if (PAYMENT_KINDS.has(kind)) {
      const provider = (str(b.provider, 50) || 'RAZORPAY').toUpperCase();
      const rz = b.razorpay && typeof b.razorpay === 'object' ? b.razorpay : {};
      const rzErr = rz.error && typeof rz.error === 'object' ? rz.error : {};
      const meta = rzErr.metadata && typeof rzErr.metadata === 'object' ? rzErr.metadata : {};
      const description = str(rzErr.description || b.description, S.MAX_EXTERNAL_RESPONSE);
      ev.source = SOURCE.EXTERNAL; ev.category = CAT.EXTERNAL; ev.error_type = defaultType;
      ev.external_provider = provider; ev.external_endpoint = `${provider.toLowerCase()}.checkout`;
      ev.external_error_code = str(rzErr.code || b.code || (kind === 'cancelled' ? 'USER_CANCELLED' : null), 100);
      ev.external_response = description;
      if (description) ev.error_message = str(`${flow}: ${description}`, S.MAX_ERROR_MESSAGE);
      for (const k of ['reason', 'step', 'source']) if (rzErr[k]) payload[k] = str(rzErr[k], 100);
      for (const k of ['order_id', 'payment_id']) if (meta[k]) payload[k] = str(meta[k], 100);
    } else if (kind === 'network') {
      const host = S.hostOf(url);
      ev.source = SOURCE.EXTERNAL;
      ev.category = errMsg && /timeout/i.test(errMsg) ? CAT.TIMEOUT : CAT.EXTERNAL;
      ev.external_provider = cfg.providerForHost(host) || (host ? host.split(':')[0].slice(0, 50).toUpperCase() : null);
      ev.external_endpoint = url; ev.external_status_code = status;
      if (!errName) ev.error_type = defaultType;
    } else {
      ev.status_code = status;
    }
    ev.user_id = uid !== undefined && uid !== null ? String(uid).slice(0, 64) : null;
    ev.user_email = user && typeof user.email === 'string' ? user.email.slice(0, 255) : null;
    const requestId = recorder.recordNow(ev);
    return res.status(202).json({ success: true, request_id: requestId });
  });

  return router;
}

module.exports = { clientErrorRouter, KINDS };
