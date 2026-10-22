'use strict';
/**
 * paymentFinalizeService tests against an in-memory fake of the pg client and a fake Razorpay SDK.
 * Run:  node --test test/paymentFinalize.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BUSINESS_STATE = 'Maharashtra';
process.env.GST_PRICE_BASIS = 'inclusive';
delete process.env.GST_ENABLED;
delete process.env.GST_RATE_PERCENT;

const { createPaymentFinalizer, PaymentVerificationError } = require('../src/services/paymentFinalizeService');
const taxService = require('../src/services/taxService');

// ───────────────────────────── fakes ─────────────────────────────
function makeFakeClient(seed = {}) {
  const db = {
    payment_orders: seed.payment_orders || [],
    user_subscriptions: seed.user_subscriptions || [],
    monthly_plans: seed.monthly_plans || [],
    subscription_plans: seed.subscription_plans || [],
    payments: [],
    app_invoices: [],
    app_invoice_sequences: {},
    payment_refunds: [],
    nextId: { payments: 1, app_invoices: 1, user_subscriptions: 100, payment_refunds: 1 },
  };
  const log = [];

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    log.push({ sql: s, params });

    if (s.startsWith('SELECT * FROM payment_orders WHERE razorpay_order_id')) {
      return { rows: db.payment_orders.filter((o) => o.razorpay_order_id === params[0]) };
    }
    if (s.startsWith('SELECT * FROM user_subscriptions WHERE razorpay_subscription_id')) {
      return { rows: db.user_subscriptions.filter((o) => o.razorpay_subscription_id === params[0]) };
    }
    if (s.startsWith('SELECT * FROM monthly_plans WHERE id')) return { rows: db.monthly_plans.filter((p) => p.id === params[0]) };
    if (s.startsWith('SELECT * FROM subscription_plans WHERE id')) return { rows: db.subscription_plans.filter((p) => p.id === params[0]) };
    if (s.startsWith('SELECT * FROM monthly_plans WHERE LOWER(name)')) return { rows: db.monthly_plans.filter((p) => p.name.toLowerCase() === params[0].toLowerCase()) };
    if (s.startsWith('SELECT * FROM subscription_plans WHERE LOWER(name)')) return { rows: db.subscription_plans.filter((p) => p.name.toLowerCase() === params[0].toLowerCase()) };

    if (s.startsWith('INSERT INTO payments (')) {
      const cols = [
        'user_id', 'subscription_id', 'razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature',
        'amount', 'currency', 'status', 'payment_method',
        'plan_id', 'monthly_plan_id', 'plan_source', 'plan_name', 'user_name', 'user_email',
        'razorpay_subscription_id', 'razorpay_invoice_id', 'razorpay_invoice_number', 'razorpay_receipt', 'razorpay_status',
        'amount_paise', 'amount_refunded_paise', 'refund_status',
        'basic_amount_paise', 'cgst_rate', 'cgst_amount_paise', 'sgst_rate', 'sgst_amount_paise',
        'igst_rate', 'igst_amount_paise', 'total_amount_paise', 'tax_basis', 'tax_type', 'tax_calculated_at', 'tax_metadata',
        'purchase_date', 'captured_at', 'verification_source', 'razorpay_payload',
      ];
      const row = {};
      cols.forEach((c, i) => { row[c] = params[i]; });
      const existing = db.payments.find((p) => p.razorpay_payment_id === row.razorpay_payment_id);
      if (!existing) {
        const created = { id: db.nextId.payments++, created_at: new Date(), subscription_activated_at: null, app_invoice_id: null, ...row };
        db.payments.push(created);
        return { rows: [{ ...created, inserted: true }] };
      }
      // emulate the ON CONFLICT DO UPDATE rules that matter
      let status = row.status;
      if (existing.status === 'captured' && ['authorized', 'created'].includes(row.status)) status = existing.status;
      if (['refunded', 'partially_refunded'].includes(existing.status) && !['refunded', 'partially_refunded'].includes(row.status)) status = existing.status;
      Object.assign(existing, {
        status,
        razorpay_status: row.razorpay_status,
        payment_method: row.payment_method ?? existing.payment_method,
        razorpay_invoice_id: existing.razorpay_invoice_id ?? row.razorpay_invoice_id,
        razorpay_invoice_number: existing.razorpay_invoice_number ?? row.razorpay_invoice_number,
        amount_refunded_paise: Math.max(existing.amount_refunded_paise || 0, row.amount_refunded_paise || 0),
        refund_status: row.refund_status ?? existing.refund_status,
        captured_at: existing.captured_at ?? row.captured_at,
        updated_at: new Date(),
      });
      return { rows: [{ ...existing, inserted: false }] };
    }
    if (s.startsWith('UPDATE payments SET subscription_activated_at')) {
      const p = db.payments.find((x) => x.id === params[0]);
      if (p && !p.subscription_activated_at) { p.subscription_activated_at = new Date(); return { rows: [{ id: p.id }] }; }
      return { rows: [] };
    }
    if (s.startsWith('UPDATE payments SET subscription_id')) {
      const p = db.payments.find((x) => x.id === params[1]); if (p) p.subscription_id = params[0]; return { rows: [] };
    }
    if (s.startsWith('UPDATE payments SET app_invoice_id')) {
      const p = db.payments.find((x) => x.id === params[1]); if (p && !p.app_invoice_id) p.app_invoice_id = params[0]; return { rows: [] };
    }
    if (s.startsWith('UPDATE payments SET amount_refunded_paise')) {
      const p = db.payments.find((x) => x.id === params[3]);
      Object.assign(p, { amount_refunded_paise: params[0], refund_status: params[1], status: params[2] });
      return { rows: [{ ...p }] };
    }
    if (s.startsWith('SELECT * FROM payments WHERE razorpay_payment_id')) {
      return { rows: db.payments.filter((p) => p.razorpay_payment_id === params[0]) };
    }
    if (s.startsWith('INSERT INTO user_subscriptions')) {
      const existing = db.user_subscriptions.find((u) => u.user_id === params[0]);
      const sub = existing || { id: db.nextId.user_subscriptions++, user_id: params[0] };
      const monthly = s.includes('(user_id, monthly_plan_id');
      Object.assign(sub, { status: 'active', monthly_plan_id: monthly ? params[1] : null, plan_id: monthly ? null : params[1], razorpay_payment_id: monthly ? params[4] : params[2] });
      if (!existing) db.user_subscriptions.push(sub);
      return { rows: [{ ...sub }] };
    }
    if (s.startsWith('UPDATE user_subscriptions SET status = \'active\'')) {
      const sub = db.user_subscriptions.find((u) => u.id === params[1]);
      Object.assign(sub, { status: 'active', razorpay_payment_id: params[0] });
      return { rows: [{ ...sub }] };
    }
    if (s.startsWith('SELECT * FROM app_invoices WHERE payment_id')) return { rows: db.app_invoices.filter((i) => i.payment_id === params[0]) };
    if (s.startsWith('INSERT INTO app_invoice_sequences')) {
      db.app_invoice_sequences[params[0]] = (db.app_invoice_sequences[params[0]] || 0) + 1;
      return { rows: [{ last_value: db.app_invoice_sequences[params[0]] }] };
    }
    if (s.startsWith('INSERT INTO app_invoices')) {
      if (db.app_invoices.find((i) => i.payment_id === params[1])) return { rows: [] };
      const inv = { id: db.nextId.app_invoices++, invoice_number: params[0], payment_id: params[1], user_id: params[2], fiscal_year: params[3], sequence_no: params[4], total_amount_paise: params[10] };
      db.app_invoices.push(inv);
      return { rows: [{ ...inv }] };
    }
    if (s.startsWith('UPDATE payment_orders SET')) {
      const o = db.payment_orders.find((x) => x.id === params[params.length - 1]);
      if (o) {
        if (s.includes("ELSE 'failed' END")) { if (o.status !== 'paid') o.status = 'failed'; }
        else { o.status = params[0]; o.razorpay_payment_id = o.razorpay_payment_id || params[1]; }
      }
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO payment_refunds')) {
      const existing = db.payment_refunds.find((r) => r.razorpay_refund_id === params[0]);
      const r = existing || { id: db.nextId.payment_refunds++, razorpay_refund_id: params[0] };
      Object.assign(r, { razorpay_payment_id: params[1], payment_id: params[2], amount_paise: params[3], status: params[5] });
      if (!existing) db.payment_refunds.push(r);
      return { rows: [] };
    }
    if (s.startsWith('SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS total FROM payment_refunds')) {
      const total = db.payment_refunds.filter((r) => r.razorpay_payment_id === params[0] && r.status !== 'failed').reduce((a, r) => a + r.amount_paise, 0);
      return { rows: [{ total }] };
    }
    throw new Error(`fake client: unhandled SQL: ${s.slice(0, 90)}`);
  }

  return { query, db, log };
}

function makeFakeRazorpay(overrides = {}) {
  const calls = { fetch: [], capture: [], invoices: [] };
  return {
    calls,
    payments: {
      fetch: async (id) => {
        calls.fetch.push(id);
        if (overrides.fetchError) throw new Error(overrides.fetchError);
        return overrides.payment ? { ...overrides.payment, id } : { id, amount: 10000, currency: 'INR', status: 'captured', method: 'upi', order_id: 'order_A', notes: { app_user_id: '7' }, created_at: 1791536000 /* 2026-10-09 */ };
      },
      capture: async (id, amount, currency) => {
        calls.capture.push({ id, amount, currency });
        if (overrides.captureError) throw new Error(overrides.captureError);
        return { ...(overrides.payment || {}), id, amount, currency, status: 'captured', order_id: overrides.payment?.order_id || 'order_A' };
      },
    },
    invoices: {
      fetch: async (id) => {
        calls.invoices.push(id);
        if (overrides.invoiceError) throw new Error(overrides.invoiceError);
        return { id, invoice_number: overrides.invoiceNumber || 'INV-RZP-0001' };
      },
    },
  };
}

const profiles = {
  getCustomerProfile: async (userId) => ({ id: userId, name: 'Asha', email: 'asha@example.com', state: 'Maharashtra', stateSource: 'firms.state' }),
};

const plan = { id: 4, name: 'Pro', price: '100.00', currency: 'INR', monthly_tokens: 500000, billing_interval_months: 1 };

function orderRow(extra = {}) {
  return {
    id: 1, razorpay_order_id: 'order_A', user_id: 7, plan_source: 'monthly_plans', plan_id: 4, plan_name: 'Pro', receipt: 'mp_7_1',
    currency: 'INR', amount_paise: 10000, basic_amount_paise: 8475, cgst_rate: '9.00', cgst_amount_paise: 763, sgst_rate: '9.00',
    sgst_amount_paise: 762, igst_rate: '0.00', igst_amount_paise: 0, tax_basis: 'inclusive', tax_type: 'CGST_SGST',
    tax_calculated_at: new Date('2026-10-15T09:00:00Z'), tax_metadata: { rule: 'place_of_supply_match' }, status: 'created', ...extra,
  };
}

function finalizer(razorpay, extra = {}) {
  return createPaymentFinalizer({ razorpay, customerProfileService: profiles, taxService, logger: { warn() {}, error() {}, log() {} }, appInvoicePrefix: 'NXI', ...extra });
}

// ───────────────────────────── tests ─────────────────────────────
test('successful order payment: stored in paise with the frozen GST snapshot, activated once, app invoice issued, Razorpay invoice NULL', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay();
  const f = finalizer(rzp);

  const r = await f.finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', razorpaySignature: 'sig', source: 'checkout' });

  assert.equal(r.activated, true);
  assert.equal(r.alreadyProcessed, false);
  const p = client.db.payments[0];
  assert.equal(p.status, 'captured');
  assert.equal(p.amount, '100.00');
  assert.equal(p.amount_paise, 10000);
  assert.equal(p.basic_amount_paise, 8475);
  assert.equal(p.cgst_amount_paise, 763);
  assert.equal(p.sgst_amount_paise, 762);
  assert.equal(p.igst_amount_paise, 0);
  assert.equal(p.total_amount_paise, 10000);
  assert.equal(p.cgst_rate, '9.00');
  assert.equal(p.tax_type, 'CGST_SGST');
  assert.equal(p.plan_source, 'monthly_plans');
  assert.equal(p.monthly_plan_id, 4);
  assert.equal(p.plan_name, 'Pro');
  assert.equal(p.user_name, 'Asha');
  assert.equal(p.user_email, 'asha@example.com');
  assert.equal(p.razorpay_receipt, 'mp_7_1');
  assert.equal(p.razorpay_invoice_id, null, 'no Razorpay invoice for a plain order payment');
  assert.equal(p.razorpay_invoice_number, null);
  assert.equal(p.verification_source, 'checkout');
  assert.ok(p.subscription_activated_at);
  assert.equal(rzp.calls.invoices.length, 0, 'invoice API not called without invoice_id');

  assert.equal(r.appInvoice.invoice_number, 'NXI/2026-27/000001');
  assert.equal(client.db.app_invoices.length, 1);
  assert.equal(client.db.user_subscriptions[0].monthly_plan_id, 4);
  assert.equal(client.db.payment_orders[0].status, 'paid');
  assert.equal(client.db.payment_orders[0].razorpay_payment_id, 'pay_1');
});

test('same payment verified twice (checkout + webhook): no second activation, no second invoice', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay();
  const f = finalizer(rzp);

  const first = await f.finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'checkout' });
  const second = await f.finalizePayment(client, { userId: null, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'webhook', paymentEntity: { id: 'pay_1', amount: 10000, currency: 'INR', status: 'captured', order_id: 'order_A' } });

  assert.equal(first.activated, true);
  assert.equal(second.activated, false);
  assert.equal(second.alreadyProcessed, true);
  assert.equal(client.db.payments.length, 1);
  assert.equal(client.db.app_invoices.length, 1);
  assert.equal(client.db.app_invoice_sequences['2026-27'], 1);
  assert.equal(client.log.filter((l) => l.sql.startsWith('INSERT INTO user_subscriptions')).length, 1);
});

test('amount reported by Razorpay must equal the order snapshot', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay({ payment: { amount: 100, currency: 'INR', status: 'captured', order_id: 'order_A' } });
  await assert.rejects(
    () => finalizer(rzp).finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_x', razorpayOrderId: 'order_A', source: 'checkout' }),
    (e) => e instanceof PaymentVerificationError && e.code === 'AMOUNT_MISMATCH' && e.httpStatus === 400
  );
  assert.equal(client.db.payments.length, 0);
});

test('order of another user, or a payment for a different order, is rejected', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  await assert.rejects(
    () => finalizer(makeFakeRazorpay()).finalizePayment(client, { userId: 99, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'checkout' }),
    (e) => e.code === 'ORDER_USER_MISMATCH' && e.httpStatus === 403
  );
  const rzp = makeFakeRazorpay({ payment: { amount: 10000, currency: 'INR', status: 'captured', order_id: 'order_OTHER' } });
  await assert.rejects(
    () => finalizer(rzp).finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'checkout' }),
    (e) => e.code === 'ORDER_MISMATCH'
  );
});

test('Razorpay unreachable: checkout verify fails with 502 and nothing is written; webhook falls back to the signed entity', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay({ fetchError: 'ECONNRESET' });
  await assert.rejects(
    () => finalizer(rzp).finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'checkout' }),
    (e) => e.code === 'RAZORPAY_FETCH_FAILED' && e.httpStatus === 502
  );
  assert.equal(client.db.payments.length, 0);

  const r = await finalizer(rzp).finalizePayment(client, {
    userId: null, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'webhook',
    paymentEntity: { id: 'pay_1', amount: 10000, currency: 'INR', status: 'captured', method: 'card', order_id: 'order_A', notes: { app_user_id: '7' } },
  });
  assert.equal(r.activated, true);
  assert.equal(client.db.payments[0].verification_source, 'webhook');
});

test('failed payment is recorded with status failed and never activates or invoices', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const f = finalizer(makeFakeRazorpay());
  const saved = await f.recordFailedPayment(client, {
    userId: null, razorpayPaymentId: 'pay_fail', razorpayOrderId: 'order_A', source: 'webhook',
    paymentEntity: { id: 'pay_fail', amount: 10000, currency: 'INR', status: 'failed', method: 'netbanking', order_id: 'order_A', error_code: 'BAD_REQUEST_ERROR', notes: { app_user_id: '7' } },
  });
  assert.equal(saved.status, 'failed');
  assert.equal(client.db.payments[0].status, 'failed');
  assert.equal(client.db.payments[0].subscription_activated_at, null);
  assert.equal(client.db.app_invoices.length, 0);
  assert.equal(client.db.user_subscriptions.length, 0);
  assert.equal(client.db.payment_orders[0].status, 'failed');

  // A later successful payment on the same order still works and does not touch the failed row.
  const ok = await f.finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_ok', razorpayOrderId: 'order_A', source: 'checkout' });
  assert.equal(ok.activated, true);
  assert.equal(client.db.payments.length, 2);
  assert.equal(client.db.payment_orders[0].status, 'paid');
});

test('authorized payment is captured through Razorpay with the expected amount; capture failure leaves it pending', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay({ payment: { amount: 10000, currency: 'INR', status: 'authorized', method: 'card', order_id: 'order_A' } });
  const r = await finalizer(rzp).finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_auth', razorpayOrderId: 'order_A', source: 'checkout' });
  assert.deepEqual(rzp.calls.capture, [{ id: 'pay_auth', amount: 10000, currency: 'INR' }]);
  assert.equal(r.payment.status, 'captured');
  assert.equal(r.activated, true);

  const client2 = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const rzp2 = makeFakeRazorpay({ payment: { amount: 10000, currency: 'INR', status: 'authorized', order_id: 'order_A' }, captureError: 'capture refused' });
  const r2 = await finalizer(rzp2).finalizePayment(client2, { userId: 7, razorpayPaymentId: 'pay_auth2', razorpayOrderId: 'order_A', source: 'checkout' });
  assert.equal(r2.payment.status, 'authorized');
  assert.equal(r2.activated, false);
  assert.equal(client2.db.app_invoices.length, 0);
  assert.equal(client2.db.user_subscriptions.length, 0);
});

test('Razorpay-managed subscription charge: genuine invoice id + number stored; later charge of the same subscription is a new payment row', async () => {
  const sub = { id: 55, user_id: 7, razorpay_subscription_id: 'sub_1', monthly_plan_id: 4, plan_id: null, status: 'created' };
  const client = makeFakeClient({ user_subscriptions: [sub], monthly_plans: [plan] });
  const rzp = makeFakeRazorpay({ payment: { amount: 10000, currency: 'INR', status: 'captured', method: 'card', order_id: null, invoice_id: 'inv_X1' }, invoiceNumber: 'RZP-INV-2026-0042' });
  const r = await finalizer(rzp).finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_s1', razorpaySubscriptionId: 'sub_1', source: 'checkout' });
  assert.deepEqual(rzp.calls.invoices, ['inv_X1']);
  assert.equal(r.payment.razorpay_invoice_id, 'inv_X1');
  assert.equal(r.payment.razorpay_invoice_number, 'RZP-INV-2026-0042');
  assert.equal(r.payment.razorpay_subscription_id, 'sub_1');
  assert.equal(r.payment.subscription_id, 55);
  assert.equal(r.activated, true);
  // tax recomputed from the Razorpay amount (no order snapshot) with the customer's state
  assert.equal(r.payment.basic_amount_paise, 8475);
  assert.equal(r.payment.tax_type, 'CGST_SGST');

  // invoice number unavailable → id kept, number NULL (never invented)
  const rzp2 = makeFakeRazorpay({ payment: { amount: 10000, currency: 'INR', status: 'captured', order_id: null, invoice_id: 'inv_X2' }, invoiceError: 'not found' });
  const r2 = await finalizer(rzp2).finalizePayment(client, { userId: null, razorpayPaymentId: 'pay_s2', razorpaySubscriptionId: 'sub_1', source: 'webhook', paymentEntity: { id: 'pay_s2', amount: 10000, currency: 'INR', status: 'captured', invoice_id: 'inv_X2' } });
  assert.equal(r2.payment.razorpay_invoice_id, 'inv_X2');
  assert.equal(r2.payment.razorpay_invoice_number, null);
  assert.equal(client.db.payments.length, 2);
  assert.equal(client.db.app_invoices.length, 2);
  assert.equal(client.db.app_invoices[1].invoice_number, 'NXI/2026-27/000002');
});

test('inter-state customer gets IGST when no order snapshot exists', async () => {
  const client = makeFakeClient({ subscription_plans: [{ id: 25, name: 'Pro', price: '10.00', currency: 'INR', interval: 'month', token_limit: 1000 }] });
  const rzp = makeFakeRazorpay({ payment: { amount: 1000, currency: 'INR', status: 'captured', method: 'upi', order_id: 'order_legacy', notes: {} } });
  const delhiProfiles = { getCustomerProfile: async () => ({ name: 'Dev', email: 'dev@example.com', state: 'Delhi', stateSource: 'users.location' }) };
  const f = createPaymentFinalizer({ razorpay: rzp, customerProfileService: delhiProfiles, taxService, logger: { warn() {}, error() {} } });
  const r = await f.finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_l', razorpayOrderId: 'order_legacy', planHint: { source: 'subscription_plans', id: 25 }, source: 'checkout' });
  assert.equal(r.payment.tax_type, 'IGST');
  assert.equal(r.payment.basic_amount_paise, 847);
  assert.equal(r.payment.igst_amount_paise, 153);
  assert.equal(r.payment.cgst_amount_paise, 0);
  assert.equal(r.payment.plan_id, 25);
  assert.equal(r.payment.plan_source, 'subscription_plans');
  assert.equal(client.db.user_subscriptions[0].plan_id, 25);
});

test('refunds: partial then full; refund rows are idempotent', async () => {
  const client = makeFakeClient({ payment_orders: [orderRow()], monthly_plans: [plan] });
  const f = finalizer(makeFakeRazorpay());
  await f.finalizePayment(client, { userId: 7, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'checkout' });

  const partial = await f.applyRefund(client, {
    refundEntity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 4000, currency: 'INR', status: 'processed', created_at: 1760000100 },
    paymentEntity: { id: 'pay_1', amount: 10000, amount_refunded: 4000, refund_status: 'partial' },
  });
  assert.equal(partial.status, 'partially_refunded');
  assert.equal(partial.amount_refunded_paise, 4000);

  // duplicate delivery of the same refund event
  await f.applyRefund(client, {
    refundEntity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 4000, currency: 'INR', status: 'processed' },
    paymentEntity: { id: 'pay_1', amount: 10000, amount_refunded: 4000, refund_status: 'partial' },
  });
  assert.equal(client.db.payment_refunds.length, 1);

  // second refund without a payment entity → computed from refund rows
  const full = await f.applyRefund(client, { refundEntity: { id: 'rfnd_2', payment_id: 'pay_1', amount: 6000, currency: 'INR', status: 'processed' } });
  assert.equal(full.status, 'refunded');
  assert.equal(full.amount_refunded_paise, 10000);
  assert.equal(full.refund_status, 'full');

  // a late "captured" webhook must not downgrade a refunded row
  const again = await f.finalizePayment(client, { userId: null, razorpayPaymentId: 'pay_1', razorpayOrderId: 'order_A', source: 'webhook', paymentEntity: { id: 'pay_1', amount: 10000, currency: 'INR', status: 'captured', order_id: 'order_A' } });
  assert.equal(again.payment.status, 'refunded');
  assert.equal(again.activated, false);

  // unknown payment id → refund row stored, nothing else touched
  const none = await f.applyRefund(client, { refundEntity: { id: 'rfnd_9', payment_id: 'pay_unknown', amount: 5 } });
  assert.equal(none, null);
  assert.equal(client.db.payment_refunds.length, 3);
});

test('prepareOrderAmount freezes price + GST server-side (inclusive basis keeps the plan price as the total)', async () => {
  const f = finalizer(makeFakeRazorpay());
  const { breakdown, amountPaise } = await f.prepareOrderAmount({ plan: { ...plan, plan_source: 'monthly_plans' }, userId: 7 });
  assert.equal(amountPaise, 10000);
  assert.equal(breakdown.basicPaise, 8475);
  assert.equal(breakdown.cgstPaise, 763);
  assert.equal(breakdown.sgstPaise, 762);
  assert.equal(breakdown.metadata.customer_state, 'Maharashtra');
  assert.equal(breakdown.metadata.supply_type, 'intra');
  assert.ok(breakdown.calculatedAt);
});

test('fiscal year helper follows the Indian financial year in IST', () => {
  const { fiscalYearIST } = require('../src/services/paymentFinalizeService');
  assert.equal(fiscalYearIST(new Date('2026-10-15T10:00:00Z')), '2026-27');
  assert.equal(fiscalYearIST(new Date('2026-03-31T18:29:00Z')), '2025-26'); // 23:59 IST on 31 Mar
  assert.equal(fiscalYearIST(new Date('2026-03-31T18:31:00Z')), '2026-27'); // 00:01 IST on 1 Apr
});
