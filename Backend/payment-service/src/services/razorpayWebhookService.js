'use strict';
/**
 * Razorpay webhook intake: raw-body HMAC verification, idempotent event log, dispatch.
 *
 * Mount the route BEFORE express.json() so `req.body` is the raw Buffer (see index.js).
 * Razorpay retries any non-2xx response, so:
 *   - invalid signature        → 400 (never retried by us; logged)
 *   - duplicate event id       → 200 (already processed)
 *   - processing failure       → 500 (row marked failed; Razorpay's retry re-processes it)
 */
const crypto = require('crypto');
const { withTransaction } = require('../utils/withTransaction');
const { createPaymentFinalizer, PaymentVerificationError, PLAN_SOURCE } = require('./paymentFinalizeService');

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bodyHash(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function planHintFromNotes(notes = {}) {
  if (notes.monthly_plan_id) return { source: PLAN_SOURCE.MONTHLY, id: Number(notes.monthly_plan_id) };
  if (notes.app_plan_id) return { source: PLAN_SOURCE.LEGACY, id: Number(notes.app_plan_id) };
  if (notes.plan_name) return { source: PLAN_SOURCE.LEGACY, name: String(notes.plan_name) };
  return null;
}

function createWebhookProcessor(deps = {}) {
  const db = deps.db || require('../config/db');
  const finalizer = deps.finalizer || createPaymentFinalizer(deps.finalizerDeps || {});
  const logger = deps.logger || console;
  const secret = deps.webhookSecret !== undefined ? deps.webhookSecret : process.env.RAZORPAY_WEBHOOK_SECRET;
  const hooks = deps.hooks || {}; // { afterPaymentFinalized(result) } — post-commit side effects

  /** Insert the event row; returns { row, duplicate } */
  async function registerEvent(client, { eventId, event, body }) {
    const payment = body?.payload?.payment?.entity || {};
    const subscription = body?.payload?.subscription?.entity || {};
    const r = await client.query(
      `INSERT INTO payment_webhook_events (event_id, event, razorpay_payment_id, razorpay_order_id, razorpay_subscription_id, status, attempts, payload)
       VALUES ($1, $2, $3, $4, $5, 'received', 1, $6)
       ON CONFLICT (event_id) DO UPDATE SET
         attempts = payment_webhook_events.attempts + 1,
         status = CASE WHEN payment_webhook_events.status = 'processed' THEN 'processed' ELSE 'received' END
       RETURNING *, (xmax = 0) AS inserted`,
      [eventId, event, payment.id || null, payment.order_id || null, subscription.id || null, JSON.stringify(body)]
    );
    const row = r.rows[0];
    return { row, duplicate: !row.inserted && row.status === 'processed' };
  }

  async function markEvent(client, id, status, error) {
    await client.query(
      `UPDATE payment_webhook_events SET status = $2, error = $3, processed_at = CASE WHEN $2 IN ('processed','ignored') THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id = $1`,
      [id, status, error ? String(error).slice(0, 2000) : null]
    );
  }

  // ───────────────────────────── event handlers (inside the transaction) ─────────────────────────────
  async function onPaymentCapturedOrAuthorized(client, body) {
    const payment = body.payload.payment.entity;
    if (!payment?.id) return { outcome: 'ignored', note: 'no payment entity' };

    const planHint = planHintFromNotes(payment.notes);
    const params = {
      userId: payment.notes?.app_user_id ? Number(payment.notes.app_user_id) : null,
      razorpayPaymentId: payment.id,
      razorpayOrderId: payment.order_id || null,
      razorpaySubscriptionId: null,
      planHint,
      source: 'webhook',
      paymentEntity: payment,
    };
    try {
      const result = await finalizer.finalizePayment(client, params);
      return { outcome: 'processed', result };
    } catch (err) {
      if (err instanceof PaymentVerificationError && ['PLAN_NOT_FOUND', 'USER_UNRESOLVED'].includes(err.code)) {
        // e.g. a top-up / storage add-on order: those flows keep their own tables.
        return { outcome: 'ignored', note: `${err.code}: ${err.message}` };
      }
      throw err;
    }
  }

  async function onPaymentFailed(client, body) {
    const payment = body.payload.payment.entity;
    if (!payment?.id) return { outcome: 'ignored', note: 'no payment entity' };
    const saved = await finalizer.recordFailedPayment(client, {
      userId: payment.notes?.app_user_id ? Number(payment.notes.app_user_id) : null,
      razorpayPaymentId: payment.id,
      razorpayOrderId: payment.order_id || null,
      planHint: planHintFromNotes(payment.notes),
      source: 'webhook',
      paymentEntity: payment,
    });
    return { outcome: saved ? 'processed' : 'ignored', note: saved ? null : 'no purchase context for failed payment' };
  }

  async function onRefund(client, body) {
    const refund = body.payload?.refund?.entity;
    const payment = body.payload?.payment?.entity;
    if (!refund?.id) return { outcome: 'ignored', note: 'no refund entity' };
    const updated = await finalizer.applyRefund(client, { refundEntity: refund, paymentEntity: payment });
    return { outcome: 'processed', refundedPayment: updated };
  }

  async function onSubscriptionCharged(client, body) {
    const payment = body.payload.payment.entity;
    const subscription = body.payload.subscription.entity;
    if (!payment?.id || !subscription?.id) return { outcome: 'ignored', note: 'missing payment/subscription entity' };
    try {
      const result = await finalizer.finalizePayment(client, {
        userId: null,
        razorpayPaymentId: payment.id,
        razorpayOrderId: null,
        razorpaySubscriptionId: subscription.id,
        planHint: planHintFromNotes(subscription.notes),
        source: 'webhook',
        paymentEntity: payment,
      });
      return { outcome: 'processed', result };
    } catch (err) {
      if (err instanceof PaymentVerificationError && err.code === 'SUBSCRIPTION_NOT_FOUND') {
        return { outcome: 'ignored', note: `unknown subscription ${subscription.id}` };
      }
      throw err;
    }
  }

  async function onSubscriptionActivated(client, body) {
    const subscription = body.payload.subscription.entity;
    const r = await client.query(
      `UPDATE user_subscriptions SET status = 'active', activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE razorpay_subscription_id = $1 RETURNING user_id`,
      [subscription.id]
    );
    return { outcome: r.rows.length ? 'processed' : 'ignored', note: r.rows.length ? null : 'unknown subscription' };
  }

  async function onSubscriptionStatus(client, body, status, column) {
    const subscription = body.payload.subscription.entity;
    const r = await client.query(
      `UPDATE user_subscriptions SET status = $2, ${column} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE razorpay_subscription_id = $1 RETURNING user_id`,
      [subscription.id, status]
    );
    return { outcome: r.rows.length ? 'processed' : 'ignored', note: r.rows.length ? null : 'unknown subscription' };
  }

  const HANDLERS = {
    'payment.captured': onPaymentCapturedOrAuthorized,
    'payment.authorized': onPaymentCapturedOrAuthorized,
    'payment.failed': onPaymentFailed,
    'refund.created': onRefund,
    'refund.processed': onRefund,
    'refund.failed': onRefund,
    'subscription.activated': onSubscriptionActivated,
    'subscription.charged': onSubscriptionCharged,
    'subscription.cancelled': (c, b) => onSubscriptionStatus(c, b, 'cancelled', 'cancelled_at'),
    'subscription.completed': (c, b) => onSubscriptionStatus(c, b, 'completed', 'completed_at'),
  };

  /**
   * @param {{ rawBody: Buffer|string, signature: string, eventId?: string }} input
   * @returns {Promise<{ httpStatus: number, body: object }>}
   */
  async function processWebhook({ rawBody, signature, eventId }) {
    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
    if (!verifyWebhookSignature(raw, signature, secret)) {
      logger.warn('[webhook] invalid Razorpay signature');
      return { httpStatus: 400, body: { message: 'Invalid signature' } };
    }

    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch (_) {
      return { httpStatus: 400, body: { message: 'Invalid JSON' } };
    }
    const event = body?.event;
    if (!event) return { httpStatus: 400, body: { message: 'Missing event' } };
    const key = eventId || `sha256:${bodyHash(raw)}`;

    let finalized = null;
    try {
      const outcome = await withTransaction(db, async (client) => {
        const { row, duplicate } = await registerEvent(client, { eventId: key, event, body });
        if (duplicate) return { duplicate: true };

        const handler = HANDLERS[event];
        if (!handler) {
          await markEvent(client, row.id, 'ignored', `unhandled event ${event}`);
          return { ignored: true };
        }
        const res = await handler(client, body);
        await markEvent(client, row.id, res.outcome === 'processed' ? 'processed' : 'ignored', res.note || null);
        if (res.result) finalized = res.result;
        return res;
      });

      if (finalized && typeof hooks.afterPaymentFinalized === 'function') {
        // Post-commit side effects (token reset, auth sync, e-mail). Never fail the webhook over them.
        Promise.resolve()
          .then(() => hooks.afterPaymentFinalized(finalized))
          .catch((e) => logger.error('[webhook] post-commit hook failed:', e.message));
      }
      return { httpStatus: 200, body: { status: 'ok', event, ...(outcome.duplicate ? { duplicate: true } : {}) } };
    } catch (err) {
      logger.error(`[webhook] processing failed for ${event} (${key}):`, err.message);
      // The transaction (including the event row when it was new) rolled back; store the failure
      // outside the transaction so it can be investigated. Razorpay retries non-2xx responses.
      try {
        await db.query(
          `INSERT INTO payment_webhook_events (event_id, event, status, attempts, error, payload)
           VALUES ($1, $2, 'failed', 1, $3, $4)
           ON CONFLICT (event_id) DO UPDATE SET
             attempts = payment_webhook_events.attempts + 1,
             status = CASE WHEN payment_webhook_events.status = 'processed' THEN 'processed' ELSE 'failed' END,
             error = EXCLUDED.error`,
          [key, event, String(err.message).slice(0, 2000), JSON.stringify(body)]
        );
      } catch (_) { /* best effort */ }
      return { httpStatus: 500, body: { message: 'Webhook handling failed' } };
    }
  }

  return { processWebhook, verifyWebhookSignature, HANDLERS };
}

module.exports = { createWebhookProcessor, verifyWebhookSignature, planHintFromNotes };
