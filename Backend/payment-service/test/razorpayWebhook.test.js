'use strict';
/**
 * Webhook intake tests: raw-body signature, idempotent event log, dispatch, failure handling.
 * Run:  node --test test/razorpayWebhook.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createWebhookProcessor, verifyWebhookSignature, planHintFromNotes } = require('../src/services/razorpayWebhookService');

const SECRET = 'whsec_test_123';
const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

function makeFakeDb() {
  const events = [];
  const subs = [{ id: 1, razorpay_subscription_id: 'sub_1', status: 'created' }];
  const log = [];
  let nextId = 1;
  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    log.push({ sql: s, params });
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.startsWith('INSERT INTO payment_webhook_events (event_id, event, razorpay_payment_id')) {
      const existing = events.find((e) => e.event_id === params[0]);
      if (existing) {
        existing.attempts += 1;
        if (existing.status !== 'processed') existing.status = 'received';
        return { rows: [{ ...existing, inserted: false }] };
      }
      const row = { id: nextId++, event_id: params[0], event: params[1], status: 'received', attempts: 1, error: null };
      events.push(row);
      return { rows: [{ ...row, inserted: true }] };
    }
    if (s.startsWith('INSERT INTO payment_webhook_events (event_id, event, status, attempts, error, payload)')) {
      const existing = events.find((e) => e.event_id === params[0]);
      if (existing) { existing.attempts += 1; if (existing.status !== 'processed') existing.status = 'failed'; existing.error = params[2]; }
      else events.push({ id: nextId++, event_id: params[0], event: params[1], status: 'failed', attempts: 1, error: params[2] });
      return { rows: [] };
    }
    if (s.startsWith('UPDATE payment_webhook_events SET status')) {
      const e = events.find((x) => x.id === params[0]); e.status = params[1]; e.error = params[2]; return { rows: [] };
    }
    if (s.startsWith('UPDATE user_subscriptions SET status')) {
      const sub = subs.find((x) => x.razorpay_subscription_id === params[0]);
      if (!sub) return { rows: [] };
      sub.status = params[1] || 'active';
      return { rows: [{ user_id: 7 }] };
    }
    throw new Error(`fake db: unhandled SQL ${s.slice(0, 80)}`);
  }
  // Transactions: the real withTransaction uses pool.connect(); the fake just hands back itself.
  // Rollback emulation: snapshot events on BEGIN and restore on ROLLBACK.
  let snapshot = null;
  const client = {
    query: async (sql, params) => {
      const s = sql.trim();
      if (s === 'BEGIN') snapshot = JSON.parse(JSON.stringify(events));
      if (s === 'ROLLBACK' && snapshot) { events.length = 0; events.push(...snapshot); }
      return query(sql, params);
    },
    release() {},
  };
  return { query, connect: async () => client, events, subs, log };
}

function makeFakeFinalizer() {
  const calls = { finalize: [], failed: [], refund: [] };
  return {
    calls,
    finalizePayment: async (client, p) => { calls.finalize.push(p); if (p.razorpayPaymentId === 'pay_boom') throw new Error('db exploded'); return { payment: { id: 1, razorpay_payment_id: p.razorpayPaymentId, status: 'captured' }, activated: true }; },
    recordFailedPayment: async (client, p) => { calls.failed.push(p); return { status: 'failed' }; },
    applyRefund: async (client, p) => { calls.refund.push(p); return { status: 'refunded' }; },
  };
}

function event(name, payload, extra = {}) {
  return Buffer.from(JSON.stringify({ entity: 'event', event: name, payload, created_at: 1760000000, ...extra }), 'utf8');
}

const capturedBody = () => event('payment.captured', {
  payment: { entity: { id: 'pay_1', amount: 10000, currency: 'INR', status: 'captured', order_id: 'order_A', notes: { app_user_id: '7', monthly_plan_id: '4' } } },
});

test('signature is verified over the raw bytes with a constant-time compare', () => {
  const raw = capturedBody();
  assert.equal(verifyWebhookSignature(raw, sign(raw), SECRET), true);
  const tampered = (sign(raw)[0] === 'f' ? '0' : 'f') + sign(raw).slice(1);
  assert.equal(verifyWebhookSignature(raw, tampered, SECRET), false);
  assert.equal(verifyWebhookSignature(raw, sign(raw), 'other'), false);
  assert.equal(verifyWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), sign(raw), SECRET), true);
  assert.equal(verifyWebhookSignature(Buffer.from(raw.toString() + ' '), sign(raw), SECRET), false, 'any byte change breaks it');
  assert.equal(verifyWebhookSignature(raw, undefined, SECRET), false);
  assert.equal(verifyWebhookSignature(raw, sign(raw), undefined), false);
});

test('invalid signature → 400 and nothing is processed or stored', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });
  const res = await wp.processWebhook({ rawBody: capturedBody(), signature: 'deadbeef', eventId: 'evt_1' });
  assert.equal(res.httpStatus, 400);
  assert.equal(fin.calls.finalize.length, 0);
  assert.equal(db.events.length, 0);
});

test('payment.captured → finalizePayment with user/plan from notes; post-commit hook runs', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const hookCalls = [];
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, hooks: { afterPaymentFinalized: (r) => hookCalls.push(r) }, logger: { warn() {}, error() {} } });
  const raw = capturedBody();
  const res = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_1' });
  assert.equal(res.httpStatus, 200);
  assert.equal(fin.calls.finalize.length, 1);
  const p = fin.calls.finalize[0];
  assert.equal(p.userId, 7);
  assert.equal(p.razorpayPaymentId, 'pay_1');
  assert.equal(p.razorpayOrderId, 'order_A');
  assert.deepEqual(p.planHint, { source: 'monthly_plans', id: 4 });
  assert.equal(p.source, 'webhook');
  assert.equal(db.events[0].status, 'processed');
  await new Promise((r) => setImmediate(r));
  assert.equal(hookCalls.length, 1);
});

test('duplicate delivery (same x-razorpay-event-id) is acknowledged without reprocessing', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });
  const raw = capturedBody();
  const a = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_dup' });
  const b = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_dup' });
  const c = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_dup' });
  assert.equal(a.httpStatus, 200); assert.equal(b.httpStatus, 200); assert.equal(c.httpStatus, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal(fin.calls.finalize.length, 1, 'finalizer ran once');
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].attempts, 3);
  assert.equal(db.events[0].status, 'processed');
});

test('missing event id falls back to a body hash key (still idempotent)', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });
  const raw = capturedBody();
  await wp.processWebhook({ rawBody: raw, signature: sign(raw) });
  await wp.processWebhook({ rawBody: raw, signature: sign(raw) });
  assert.equal(fin.calls.finalize.length, 1);
  assert.ok(db.events[0].event_id.startsWith('sha256:'));
});

test('processing failure → 500, event marked failed, and a retry re-processes it', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });
  const raw = event('payment.captured', { payment: { entity: { id: 'pay_boom', amount: 1, currency: 'INR', status: 'captured', order_id: 'order_B', notes: { app_user_id: '7', monthly_plan_id: '4' } } } });
  const first = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_boom' });
  assert.equal(first.httpStatus, 500);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].status, 'failed');
  assert.match(db.events[0].error, /db exploded/);

  fin.finalizePayment = async () => ({ payment: { status: 'captured' }, activated: true });
  const retry = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'evt_boom' });
  assert.equal(retry.httpStatus, 200);
  assert.equal(db.events[0].status, 'processed');
});

test('payment.failed → recordFailedPayment; refund.processed → applyRefund; subscription.* update status', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });

  let raw = event('payment.failed', { payment: { entity: { id: 'pay_f', amount: 10000, currency: 'INR', status: 'failed', order_id: 'order_A', notes: { app_user_id: '7', monthly_plan_id: '4' } } } });
  assert.equal((await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_f' })).httpStatus, 200);
  assert.equal(fin.calls.failed.length, 1);
  assert.equal(fin.calls.failed[0].razorpayPaymentId, 'pay_f');

  raw = event('refund.processed', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 10000, status: 'processed' } }, payment: { entity: { id: 'pay_1', amount: 10000, amount_refunded: 10000, refund_status: 'full' } } });
  assert.equal((await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_r' })).httpStatus, 200);
  assert.equal(fin.calls.refund.length, 1);
  assert.equal(fin.calls.refund[0].refundEntity.id, 'rfnd_1');
  assert.equal(fin.calls.refund[0].paymentEntity.refund_status, 'full');

  raw = event('subscription.cancelled', { subscription: { entity: { id: 'sub_1', status: 'cancelled' } } });
  assert.equal((await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_c' })).httpStatus, 200);
  assert.equal(db.subs[0].status, 'cancelled');

  raw = event('subscription.charged', { payment: { entity: { id: 'pay_sc', amount: 10000, currency: 'INR', status: 'captured' } }, subscription: { entity: { id: 'sub_1', notes: { app_user_id: '7' } } } });
  assert.equal((await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_sc' })).httpStatus, 200);
  assert.equal(fin.calls.finalize.at(-1).razorpaySubscriptionId, 'sub_1');
  assert.equal(fin.calls.finalize.at(-1).razorpayOrderId, null);
});

test('unknown events and non-plan orders are acknowledged and marked ignored', async () => {
  const db = makeFakeDb(); const fin = makeFakeFinalizer();
  const { PaymentVerificationError } = require('../src/services/paymentFinalizeService');
  fin.finalizePayment = async () => { throw new PaymentVerificationError('PLAN_NOT_FOUND', 'no plan', 404); };
  const wp = createWebhookProcessor({ db, finalizer: fin, webhookSecret: SECRET, logger: { warn() {}, error() {} } });

  let raw = event('order.paid', { order: { entity: { id: 'order_A' } } });
  let res = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_u' });
  assert.equal(res.httpStatus, 200);
  assert.equal(db.events[0].status, 'ignored');

  raw = event('payment.captured', { payment: { entity: { id: 'pay_topup', amount: 500, currency: 'INR', status: 'captured', order_id: 'order_T', notes: { app_user_id: '7', topup_plan_id: '2' } } } });
  res = await wp.processWebhook({ rawBody: raw, signature: sign(raw), eventId: 'e_t' });
  assert.equal(res.httpStatus, 200);
  assert.equal(db.events[1].status, 'ignored');
});

test('planHintFromNotes maps Razorpay order notes to plan tables', () => {
  assert.deepEqual(planHintFromNotes({ monthly_plan_id: '4' }), { source: 'monthly_plans', id: 4 });
  assert.deepEqual(planHintFromNotes({ app_plan_id: '25' }), { source: 'subscription_plans', id: 25 });
  assert.deepEqual(planHintFromNotes({ plan_name: 'Pro' }), { source: 'subscription_plans', name: 'Pro' });
  assert.equal(planHintFromNotes({}), null);
  assert.equal(planHintFromNotes(undefined), null);
});
