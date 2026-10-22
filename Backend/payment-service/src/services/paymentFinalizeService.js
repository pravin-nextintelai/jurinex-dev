'use strict';
/**
 * Single trusted path for turning a Razorpay payment into database rows.
 *
 * Used by every checkout verify handler AND by the webhook, so both converge on the same rules:
 *   1. the payment is re-read from Razorpay (never trusted from the browser);
 *   2. user, plan, amount, currency and tax breakdown come from server-side data
 *      (payment_orders snapshot → plan table → auth DB profile);
 *   3. the payments row is upserted under the unique razorpay_payment_id;
 *   4. the subscription is activated at most once per payment (payments.subscription_activated_at gate);
 *   5. a genuine Razorpay invoice is stored only when Razorpay reports one (payment.invoice_id);
 *   6. an application-generated invoice number is issued separately (app_invoices).
 *
 * All functions take the transaction `client` from utils/withTransaction. Side effects that must run
 * outside the transaction (token reset, auth sync, e-mail) are the caller's job, after COMMIT.
 */
const gst = require('../utils/gst');
const defaultTaxService = require('./taxService');
const defaultProfiles = require('./customerProfileService');
const { fiscalYearIST, formatInvoiceNumber, allocateSequence } = require('./invoiceNumberService');

class PaymentVerificationError extends Error {
  constructor(code, message, httpStatus = 400, details = undefined) {
    super(message);
    this.name = 'PaymentVerificationError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const PLAN_SOURCE = Object.freeze({ MONTHLY: 'monthly_plans', LEGACY: 'subscription_plans' });

function rateToNumeric(bp) {
  return bp ? gst.bpToPercentString(bp) : '0.00';
}

function breakdownFromRow(row) {
  if (!row || row.basic_amount_paise === null || row.basic_amount_paise === undefined) return null;
  const taxType = row.tax_type || 'NONE';
  const cgstBp = gst.percentToBp(row.cgst_rate || 0);
  const sgstBp = gst.percentToBp(row.sgst_rate || 0);
  const igstBp = gst.percentToBp(row.igst_rate || 0);
  return {
    basis: row.tax_basis || 'inclusive',
    taxType,
    gstRateBp: taxType === 'IGST' ? igstBp : cgstBp + sgstBp,
    basicPaise: Number(row.basic_amount_paise),
    cgstRateBp: cgstBp, cgstPaise: Number(row.cgst_amount_paise || 0),
    sgstRateBp: sgstBp, sgstPaise: Number(row.sgst_amount_paise || 0),
    igstRateBp: igstBp, igstPaise: Number(row.igst_amount_paise || 0),
    taxPaise: Number(row.cgst_amount_paise || 0) + Number(row.sgst_amount_paise || 0) + Number(row.igst_amount_paise || 0),
    totalPaise: Number(row.amount_paise ?? row.total_amount_paise),
    currency: row.currency || 'INR',
    calculatedAt: row.tax_calculated_at ? new Date(row.tax_calculated_at).toISOString() : null,
    metadata: row.tax_metadata || {},
  };
}

function planPricePaise(plan) {
  return gst.rupeesToPaise(plan?.price ?? 0);
}

function createPaymentFinalizer(deps = {}) {
  const razorpay = deps.razorpay || require('../config/rezorpay');
  const tax = deps.taxService || defaultTaxService;
  const profiles = deps.customerProfileService || defaultProfiles;
  const logger = deps.logger || console;
  const appInvoiceEnabled = deps.appInvoiceEnabled !== undefined
    ? deps.appInvoiceEnabled
    : String(process.env.APP_INVOICE_ENABLED ?? 'true').toLowerCase() !== 'false';
  const appInvoicePrefix = deps.appInvoicePrefix || process.env.APP_INVOICE_PREFIX || 'JNX';

  // ───────────────────────────── plans ─────────────────────────────
  async function loadPlan(client, source, id) {
    if (!id) return null;
    const table = source === PLAN_SOURCE.MONTHLY ? 'monthly_plans' : 'subscription_plans';
    const r = await client.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [Number(id)]);
    const plan = r.rows[0] || null;
    if (plan) plan.plan_source = source;
    return plan;
  }

  async function loadPlanByName(client, source, name) {
    if (!name) return null;
    const table = source === PLAN_SOURCE.MONTHLY ? 'monthly_plans' : 'subscription_plans';
    const r = await client.query(
      `SELECT * FROM ${table} WHERE LOWER(name) = LOWER($1) AND (is_active IS NOT FALSE) ORDER BY price DESC LIMIT 1`,
      [String(name)]
    );
    const plan = r.rows[0] || null;
    if (plan) plan.plan_source = source;
    return plan;
  }

  // ───────────────────────────── orders ─────────────────────────────
  /**
   * Price + tax for a plan purchase, computed server-side before the Razorpay order is created.
   * Inclusive basis: the charged total is the plan price. Exclusive basis: the plan price is the
   * basic amount and GST is added on top.
   */
  async function prepareOrderAmount({ plan, userId, profile }) {
    const customer = profile || await profiles.getCustomerProfile(userId);
    const pricePaise = planPricePaise(plan);
    const config = tax.readConfig();
    const breakdown = tax.buildTaxBreakdown({
      currency: plan.currency || 'INR',
      customerState: customer.state,
      customerStateSource: customer.stateSource ? { source: customer.stateSource } : null,
      ...(config.basis === gst.BASIS.EXCLUSIVE ? { basicPaise: pricePaise } : { totalPaise: pricePaise }),
    });
    return { breakdown, amountPaise: breakdown.totalPaise, profile: customer };
  }

  async function recordOrder(client, { razorpayOrder, userId, plan, breakdown, notes }) {
    const r = await client.query(
      `INSERT INTO payment_orders (
         razorpay_order_id, user_id, plan_source, plan_id, plan_name, receipt, currency, amount_paise,
         basic_amount_paise, cgst_rate, cgst_amount_paise, sgst_rate, sgst_amount_paise,
         igst_rate, igst_amount_paise, tax_basis, tax_type, tax_calculated_at, tax_metadata, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'created',$20)
       ON CONFLICT (razorpay_order_id) DO NOTHING
       RETURNING *`,
      [
        razorpayOrder.id, Number(userId), plan.plan_source, plan.id, plan.name, razorpayOrder.receipt || null,
        breakdown.currency, breakdown.totalPaise,
        breakdown.basicPaise, rateToNumeric(breakdown.cgstRateBp), breakdown.cgstPaise,
        rateToNumeric(breakdown.sgstRateBp), breakdown.sgstPaise,
        rateToNumeric(breakdown.igstRateBp), breakdown.igstPaise,
        breakdown.basis, breakdown.taxType, breakdown.calculatedAt, JSON.stringify(breakdown.metadata || {}),
        JSON.stringify(notes || {}),
      ]
    );
    return r.rows[0] || null;
  }

  // ───────────────────────────── context resolution ─────────────────────────────
  async function resolveContext(client, p) {
    const ctx = {
      userId: p.userId ? Number(p.userId) : null,
      plan: null,
      orderRecord: null,
      expectedAmountPaise: null,
      expectedCurrency: null,
      breakdown: null,
      subscriptionRow: null,
    };

    if (p.razorpayOrderId) {
      const r = await client.query('SELECT * FROM payment_orders WHERE razorpay_order_id = $1 FOR UPDATE', [p.razorpayOrderId]);
      const order = r.rows[0];
      if (order) {
        if (ctx.userId && Number(order.user_id) !== ctx.userId) {
          throw new PaymentVerificationError('ORDER_USER_MISMATCH', 'This order belongs to a different user.', 403);
        }
        ctx.userId = Number(order.user_id);
        ctx.orderRecord = order;
        ctx.expectedAmountPaise = Number(order.amount_paise);
        ctx.expectedCurrency = order.currency;
        ctx.breakdown = breakdownFromRow(order);
        ctx.plan = await loadPlan(client, order.plan_source, order.plan_id);
      }
    }

    if (p.razorpaySubscriptionId) {
      const r = await client.query(
        'SELECT * FROM user_subscriptions WHERE razorpay_subscription_id = $1 LIMIT 1',
        [p.razorpaySubscriptionId]
      );
      const sub = r.rows[0];
      if (sub) {
        if (ctx.userId && Number(sub.user_id) !== ctx.userId) {
          throw new PaymentVerificationError('SUBSCRIPTION_USER_MISMATCH', 'This subscription belongs to a different user.', 403);
        }
        ctx.userId = Number(sub.user_id);
        ctx.subscriptionRow = sub;
        if (!ctx.plan) {
          ctx.plan = sub.monthly_plan_id
            ? await loadPlan(client, PLAN_SOURCE.MONTHLY, sub.monthly_plan_id)
            : await loadPlan(client, PLAN_SOURCE.LEGACY, sub.plan_id);
        }
      } else if (!ctx.plan && !p.planHint) {
        throw new PaymentVerificationError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
      }
    }

    if (!ctx.plan && p.planHint) {
      const { source, id, name } = p.planHint;
      ctx.plan = (await loadPlan(client, source, id)) || (await loadPlanByName(client, source, name));
      if (ctx.plan && !p.razorpaySubscriptionId && !ctx.orderRecord) {
        // Legacy order (created before payment_orders existed): the plan price is the only server-side
        // reference for the expected amount.
        ctx.expectedAmountPaise = planPricePaise(ctx.plan);
        ctx.expectedCurrency = ctx.plan.currency || 'INR';
      }
    }

    if (!ctx.plan) {
      throw new PaymentVerificationError('PLAN_NOT_FOUND', 'Purchased plan not found.', 404);
    }
    if (!ctx.userId) {
      throw new PaymentVerificationError('USER_UNRESOLVED', 'Could not resolve the paying user.', 400);
    }
    return ctx;
  }

  // ───────────────────────────── Razorpay reads ─────────────────────────────
  async function fetchPayment(razorpayPaymentId, signedEntity) {
    try {
      return await razorpay.payments.fetch(razorpayPaymentId);
    } catch (err) {
      if (signedEntity && signedEntity.id === razorpayPaymentId) {
        logger.warn(`[paymentFinalize] Razorpay fetch failed for ${razorpayPaymentId}; using signed webhook entity`);
        return signedEntity;
      }
      throw new PaymentVerificationError(
        'RAZORPAY_FETCH_FAILED',
        'Could not confirm the payment with Razorpay. Please retry in a moment; the purchase will also be confirmed automatically.',
        502,
        { reason: err?.error?.description || err?.message }
      );
    }
  }

  async function fetchRazorpayInvoice(invoiceId) {
    if (!invoiceId) return { razorpayInvoiceId: null, razorpayInvoiceNumber: null };
    try {
      const inv = await razorpay.invoices.fetch(invoiceId);
      return { razorpayInvoiceId: inv?.id || invoiceId, razorpayInvoiceNumber: inv?.invoice_number || null };
    } catch (err) {
      logger.warn(`[paymentFinalize] invoice fetch failed for ${invoiceId}: ${err?.error?.description || err?.message}`);
      return { razorpayInvoiceId: invoiceId, razorpayInvoiceNumber: null };
    }
  }

  // ───────────────────────────── payments upsert ─────────────────────────────
  async function upsertPayment(client, row) {
    const r = await client.query(
      `INSERT INTO payments (
         user_id, subscription_id, razorpay_payment_id, razorpay_order_id, razorpay_signature,
         amount, currency, status, payment_method, created_at, transaction_date,
         plan_id, monthly_plan_id, plan_source, plan_name, user_name, user_email,
         razorpay_subscription_id, razorpay_invoice_id, razorpay_invoice_number, razorpay_receipt, razorpay_status,
         amount_paise, amount_refunded_paise, refund_status,
         basic_amount_paise, cgst_rate, cgst_amount_paise, sgst_rate, sgst_amount_paise,
         igst_rate, igst_amount_paise, total_amount_paise, tax_basis, tax_type, tax_calculated_at, tax_metadata,
         purchase_date, captured_at, verification_source, razorpay_payload, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,CURRENT_DATE,
         $10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,
         $21,$22,$23,
         $24,$25,$26,$27,$28,
         $29,$30,$31,$32,$33,$34,$35,
         $36,$37,$38,$39,CURRENT_TIMESTAMP
       )
       ON CONFLICT (razorpay_payment_id) DO UPDATE SET
         status = CASE
           WHEN payments.status = 'captured' AND EXCLUDED.status IN ('authorized', 'created') THEN payments.status
           WHEN payments.status IN ('refunded', 'partially_refunded') AND EXCLUDED.status NOT IN ('refunded', 'partially_refunded') THEN payments.status
           ELSE EXCLUDED.status END,
         razorpay_status         = EXCLUDED.razorpay_status,
         payment_method          = COALESCE(EXCLUDED.payment_method, payments.payment_method),
         razorpay_signature      = COALESCE(payments.razorpay_signature, EXCLUDED.razorpay_signature),
         razorpay_order_id       = COALESCE(payments.razorpay_order_id, EXCLUDED.razorpay_order_id),
         subscription_id         = COALESCE(payments.subscription_id, EXCLUDED.subscription_id),
         user_name               = COALESCE(payments.user_name, EXCLUDED.user_name),
         user_email              = COALESCE(payments.user_email, EXCLUDED.user_email),
         razorpay_invoice_id     = COALESCE(payments.razorpay_invoice_id, EXCLUDED.razorpay_invoice_id),
         razorpay_invoice_number = COALESCE(payments.razorpay_invoice_number, EXCLUDED.razorpay_invoice_number),
         razorpay_receipt        = COALESCE(payments.razorpay_receipt, EXCLUDED.razorpay_receipt),
         amount_refunded_paise   = GREATEST(payments.amount_refunded_paise, EXCLUDED.amount_refunded_paise),
         refund_status           = COALESCE(EXCLUDED.refund_status, payments.refund_status),
         captured_at             = COALESCE(payments.captured_at, EXCLUDED.captured_at),
         razorpay_payload        = EXCLUDED.razorpay_payload,
         updated_at              = CURRENT_TIMESTAMP
       RETURNING *, (xmax = 0) AS inserted`,
      [
        row.user_id, row.subscription_id, row.razorpay_payment_id, row.razorpay_order_id, row.razorpay_signature,
        row.amount, row.currency, row.status, row.payment_method,
        row.plan_id, row.monthly_plan_id, row.plan_source, row.plan_name, row.user_name, row.user_email,
        row.razorpay_subscription_id, row.razorpay_invoice_id, row.razorpay_invoice_number, row.razorpay_receipt, row.razorpay_status,
        row.amount_paise, row.amount_refunded_paise, row.refund_status,
        row.basic_amount_paise, row.cgst_rate, row.cgst_amount_paise, row.sgst_rate, row.sgst_amount_paise,
        row.igst_rate, row.igst_amount_paise, row.total_amount_paise, row.tax_basis, row.tax_type, row.tax_calculated_at, row.tax_metadata,
        row.purchase_date, row.captured_at, row.verification_source, row.razorpay_payload,
      ]
    );
    return r.rows[0];
  }

  function paymentRowFrom({ ctx, payment, breakdown, invoice, profile, source, signature, userEmail }) {
    const status = payment.status || 'created';
    const capturedAt = status === 'captured'
      ? (payment.captured_at ? new Date(payment.captured_at * 1000) : new Date())
      : null;
    const purchaseDate = payment.created_at ? new Date(payment.created_at * 1000) : new Date();
    const amountRefunded = Number(payment.amount_refunded || 0);
    const refundStatus = payment.refund_status || null;
    const effectiveStatus = refundStatus === 'full' ? 'refunded' : (refundStatus === 'partial' ? 'partially_refunded' : status);

    return {
      user_id: ctx.userId,
      subscription_id: ctx.subscriptionRow ? ctx.subscriptionRow.id : null,
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id || ctx.orderRecord?.razorpay_order_id || null,
      razorpay_signature: signature || null,
      amount: gst.paiseToRupeesString(payment.amount),
      currency: payment.currency || breakdown.currency || 'INR',
      status: effectiveStatus,
      payment_method: payment.method || null,
      plan_id: ctx.plan.plan_source === PLAN_SOURCE.LEGACY ? ctx.plan.id : null,
      monthly_plan_id: ctx.plan.plan_source === PLAN_SOURCE.MONTHLY ? ctx.plan.id : null,
      plan_source: ctx.plan.plan_source,
      plan_name: ctx.plan.name,
      user_name: profile?.name || null,
      user_email: profile?.email || userEmail || payment.email || null,
      razorpay_subscription_id: ctx.subscriptionRow?.razorpay_subscription_id || null,
      razorpay_invoice_id: invoice.razorpayInvoiceId,
      razorpay_invoice_number: invoice.razorpayInvoiceNumber,
      razorpay_receipt: ctx.orderRecord?.receipt || null,
      razorpay_status: status,
      amount_paise: Number(payment.amount),
      amount_refunded_paise: amountRefunded,
      refund_status: refundStatus,
      basic_amount_paise: breakdown.basicPaise,
      cgst_rate: rateToNumeric(breakdown.cgstRateBp),
      cgst_amount_paise: breakdown.cgstPaise,
      sgst_rate: rateToNumeric(breakdown.sgstRateBp),
      sgst_amount_paise: breakdown.sgstPaise,
      igst_rate: rateToNumeric(breakdown.igstRateBp),
      igst_amount_paise: breakdown.igstPaise,
      total_amount_paise: breakdown.totalPaise,
      tax_basis: breakdown.basis,
      tax_type: breakdown.taxType,
      tax_calculated_at: breakdown.calculatedAt,
      tax_metadata: JSON.stringify(breakdown.metadata || {}),
      purchase_date: purchaseDate,
      captured_at: capturedAt,
      verification_source: source,
      razorpay_payload: JSON.stringify(sanitizePayment(payment)),
    };
  }

  function sanitizePayment(payment) {
    // Keep what reconciliation needs; drop card/bank/contact details.
    const {
      id, entity, amount, currency, status, order_id, invoice_id, international, method, amount_refunded,
      refund_status, captured, description, error_code, error_description, error_reason, created_at, notes,
      fee, tax, bank, wallet, vpa, acquirer_data,
    } = payment;
    return {
      id, entity, amount, currency, status, order_id, invoice_id, international, method, amount_refunded,
      refund_status, captured, description, error_code, error_description, error_reason, created_at, notes,
      fee, tax, bank, wallet, vpa: vpa ? vpa.replace(/^(.{2}).*(@.*)$/, '$1***$2') : vpa, acquirer_data,
    };
  }

  // ───────────────────────────── activation ─────────────────────────────
  async function activateSubscription(client, { ctx, paymentRow }) {
    const plan = ctx.plan;
    const userId = ctx.userId;

    if (plan.plan_source === PLAN_SOURCE.MONTHLY) {
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (Number(plan.billing_interval_months) || 1));
      const r = await client.query(
        `INSERT INTO user_subscriptions
           (user_id, monthly_plan_id, status, current_token_balance, topup_token_balance,
            start_date, end_date, activated_at, last_reset_date, razorpay_payment_id, razorpay_subscription_id,
            created_at, updated_at)
         VALUES ($1, $2, 'active', $3, 0,
                 CURRENT_DATE, $4::DATE, CURRENT_TIMESTAMP, CURRENT_DATE, $5, $6,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           status                   = 'active',
           monthly_plan_id          = EXCLUDED.monthly_plan_id,
           plan_id                  = NULL,
           current_token_balance    = EXCLUDED.current_token_balance,
           start_date               = EXCLUDED.start_date,
           end_date                 = EXCLUDED.end_date,
           activated_at             = CURRENT_TIMESTAMP,
           last_reset_date          = CURRENT_DATE,
           plan_tokens_used         = 0,
           razorpay_payment_id      = EXCLUDED.razorpay_payment_id,
           razorpay_subscription_id = COALESCE(EXCLUDED.razorpay_subscription_id, user_subscriptions.razorpay_subscription_id),
           last_charged_at          = CURRENT_TIMESTAMP,
           updated_at               = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId, plan.id, plan.monthly_tokens || 0, endDate.toISOString().split('T')[0],
         paymentRow.razorpay_payment_id, ctx.subscriptionRow?.razorpay_subscription_id || null]
      );
      return r.rows[0];
    }

    if (ctx.subscriptionRow) {
      // Legacy Razorpay-managed subscription (subscription_plans.razorpay_plan_id)
      const r = await client.query(
        `UPDATE user_subscriptions
            SET status = 'active',
                razorpay_payment_id = $1,
                activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
                last_charged_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *`,
        [paymentRow.razorpay_payment_id, ctx.subscriptionRow.id]
      );
      return r.rows[0];
    }

    // Legacy one-time order on subscription_plans
    const endDate = new Date();
    const interval = String(plan.interval || '').toLowerCase();
    if (['year', 'yearly', 'annual'].includes(interval)) endDate.setFullYear(endDate.getFullYear() + 1);
    else if (['quarter', 'quarterly'].includes(interval)) endDate.setMonth(endDate.getMonth() + 3);
    else if (['month', 'monthly'].includes(interval)) endDate.setMonth(endDate.getMonth() + 1);
    const r = await client.query(
      `INSERT INTO user_subscriptions (
         user_id, plan_id, razorpay_subscription_id, razorpay_payment_id, status, current_token_balance,
         start_date, end_date, activated_at, last_reset_date, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, 'active', $4, CURRENT_DATE, $5, CURRENT_TIMESTAMP, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         plan_id               = EXCLUDED.plan_id,
         monthly_plan_id       = NULL,
         razorpay_payment_id   = EXCLUDED.razorpay_payment_id,
         status                = EXCLUDED.status,
         current_token_balance = EXCLUDED.current_token_balance,
         start_date            = EXCLUDED.start_date,
         end_date              = EXCLUDED.end_date,
         activated_at          = CURRENT_TIMESTAMP,
         plan_tokens_used      = 0,
         updated_at            = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, plan.id, paymentRow.razorpay_payment_id, plan.token_limit || 0, endDate]
    );
    return r.rows[0];
  }

  // ───────────────────────────── application invoice ─────────────────────────────
  async function issueAppInvoice(client, paymentRow) {
    const existing = await client.query('SELECT * FROM app_invoices WHERE payment_id = $1', [paymentRow.id]);
    if (existing.rows[0]) return existing.rows[0];

    const fy = fiscalYearIST(paymentRow.purchase_date || paymentRow.created_at);
    const sequenceNo = await allocateSequence(client, fy);
    const invoiceNumber = formatInvoiceNumber(fy, sequenceNo, appInvoicePrefix);
    const ins = await client.query(
      `INSERT INTO app_invoices (
         invoice_number, invoice_kind, payment_id, user_id, fiscal_year, sequence_no, currency,
         basic_amount_paise, cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_amount_paise, issued_at,
         source_kind, source_id)
       VALUES ($1, 'application_generated', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, $12, $13)
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING *`,
      [invoiceNumber, paymentRow.id, paymentRow.user_id, fy, sequenceNo, paymentRow.currency || 'INR',
       paymentRow.basic_amount_paise, paymentRow.cgst_amount_paise || 0, paymentRow.sgst_amount_paise || 0,
       paymentRow.igst_amount_paise || 0, paymentRow.total_amount_paise, 'payment', paymentRow.id]
    );
    const invoice = ins.rows[0] || (await client.query('SELECT * FROM app_invoices WHERE payment_id = $1', [paymentRow.id])).rows[0];
    await client.query('UPDATE payments SET app_invoice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND app_invoice_id IS NULL', [invoice.id, paymentRow.id]);
    return invoice;
  }

  // ───────────────────────────── main entry ─────────────────────────────
  /**
   * @param {import('pg').PoolClient} client  open transaction
   * @param {object} p
   * @param {number|string|null} p.userId            authenticated user (null for webhooks)
   * @param {string}  p.razorpayPaymentId
   * @param {string}  [p.razorpayOrderId]
   * @param {string}  [p.razorpaySubscriptionId]
   * @param {string}  [p.razorpaySignature]
   * @param {{source:string,id?:number,name?:string}} [p.planHint]  fallback plan reference
   * @param {'checkout'|'webhook'} p.source
   * @param {object}  [p.paymentEntity]  signed webhook entity (fallback when the API fetch fails)
   * @param {string}  [p.userEmail]
   */
  async function finalizePayment(client, p) {
    if (!p.razorpayPaymentId) throw new PaymentVerificationError('MISSING_PAYMENT_ID', 'Missing razorpay_payment_id', 400);

    const ctx = await resolveContext(client, p);
    let payment = await fetchPayment(p.razorpayPaymentId, p.paymentEntity);

    // ── cross-checks against trusted data ──
    if (p.razorpayOrderId && payment.order_id && payment.order_id !== p.razorpayOrderId) {
      throw new PaymentVerificationError('ORDER_MISMATCH', 'Payment does not belong to the supplied order.', 400);
    }
    if (payment.notes?.app_user_id && String(payment.notes.app_user_id) !== String(ctx.userId)) {
      throw new PaymentVerificationError('USER_MISMATCH', 'Payment was made for a different user.', 403);
    }
    const currency = String(payment.currency || 'INR').toUpperCase();
    if (ctx.expectedCurrency && currency !== String(ctx.expectedCurrency).toUpperCase()) {
      throw new PaymentVerificationError('CURRENCY_MISMATCH', 'Payment currency does not match the order.', 400);
    }
    const amountMatchesExpected = ctx.expectedAmountPaise === null || Number(payment.amount) === ctx.expectedAmountPaise;
    if (!amountMatchesExpected && payment.status !== 'failed') {
      throw new PaymentVerificationError('AMOUNT_MISMATCH', 'Payment amount does not match the plan price.', 400, {
        expected_paise: ctx.expectedAmountPaise, received_paise: Number(payment.amount),
      });
    }

    // ── authorized but not captured: capture through Razorpay with the expected amount ──
    if (payment.status === 'authorized' && ctx.expectedAmountPaise !== null) {
      try {
        payment = await razorpay.payments.capture(payment.id, ctx.expectedAmountPaise, currency);
      } catch (err) {
        logger.warn(`[paymentFinalize] capture failed for ${payment.id}: ${err?.error?.description || err?.message}`);
      }
    }

    // ── tax breakdown: frozen order snapshot when it matches, else recomputed from trusted data ──
    const profile = await profiles.getCustomerProfile(ctx.userId);
    let breakdown = ctx.breakdown && ctx.breakdown.totalPaise === Number(payment.amount) ? ctx.breakdown : null;
    if (!breakdown) {
      breakdown = tax.buildTaxBreakdown({
        totalPaise: Number(payment.amount),
        currency,
        customerState: profile.state,
        customerStateSource: profile.stateSource ? { source: profile.stateSource } : null,
      });
      const planPrice = planPricePaise(ctx.plan);
      if (planPrice && planPrice !== Number(payment.amount)) {
        breakdown.metadata.plan_price_paise = planPrice;
        breakdown.metadata.amount_differs_from_plan_price = true;
      }
    }

    const invoice = await fetchRazorpayInvoice(payment.invoice_id);

    const paymentRow = await upsertPayment(client, paymentRowFrom({
      ctx, payment, breakdown, invoice, profile, source: p.source, signature: p.razorpaySignature, userEmail: p.userEmail,
    }));

    // ── activate once ──
    let activated = false;
    let subscription = null;
    if (paymentRow.status === 'captured') {
      const gate = await client.query(
        `UPDATE payments SET subscription_activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND subscription_activated_at IS NULL RETURNING id`,
        [paymentRow.id]
      );
      if (gate.rows.length) {
        subscription = await activateSubscription(client, { ctx, paymentRow });
        if (subscription) {
          await client.query('UPDATE payments SET subscription_id = $1 WHERE id = $2', [subscription.id, paymentRow.id]);
          paymentRow.subscription_id = subscription.id;
        }
        activated = true;
      }
    }

    // ── application-generated invoice (separate from any Razorpay invoice) ──
    let appInvoice = null;
    if (paymentRow.status === 'captured' && appInvoiceEnabled) {
      appInvoice = await issueAppInvoice(client, paymentRow);
      paymentRow.app_invoice_id = appInvoice.id;
    }

    if (ctx.orderRecord) {
      const orderStatus = paymentRow.status === 'captured' ? 'paid' : (payment.status === 'failed' ? 'failed' : ctx.orderRecord.status);
      await client.query(
        `UPDATE payment_orders SET status = $1, razorpay_payment_id = COALESCE(razorpay_payment_id, $2), updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [orderStatus, payment.id, ctx.orderRecord.id]
      );
    }

    return {
      payment: paymentRow,
      plan: ctx.plan,
      userId: ctx.userId,
      profile,
      breakdown,
      razorpayInvoice: invoice,
      appInvoice,
      activated,
      alreadyProcessed: !paymentRow.inserted && !activated,
      subscription,
      razorpayPayment: payment,
    };
  }

  /** Webhook `payment.failed`: keep a failed row for investigation; never activates anything. */
  async function recordFailedPayment(client, p) {
    let ctx;
    try {
      ctx = await resolveContext(client, p);
    } catch (err) {
      if (err instanceof PaymentVerificationError) {
        logger.warn(`[paymentFinalize] failed payment ${p.razorpayPaymentId} has no resolvable context (${err.code}); logged only`);
        return null;
      }
      throw err;
    }
    const payment = p.paymentEntity || await fetchPayment(p.razorpayPaymentId);
    const profile = await profiles.getCustomerProfile(ctx.userId);
    const breakdown = ctx.breakdown || tax.buildTaxBreakdown({
      totalPaise: Number(payment.amount || 0), currency: payment.currency || 'INR', customerState: profile.state,
    });
    const row = paymentRowFrom({
      ctx, payment: { ...payment, status: 'failed' }, breakdown,
      invoice: { razorpayInvoiceId: null, razorpayInvoiceNumber: null }, profile, source: p.source || 'webhook',
    });
    const saved = await upsertPayment(client, row);
    if (ctx.orderRecord) {
      await client.query(`UPDATE payment_orders SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [ctx.orderRecord.id]);
    }
    return saved;
  }

  /** Webhook refund.* events. */
  async function applyRefund(client, { refundEntity, paymentEntity }) {
    if (!refundEntity?.id || !refundEntity?.payment_id) return null;
    const pr = await client.query('SELECT * FROM payments WHERE razorpay_payment_id = $1 FOR UPDATE', [refundEntity.payment_id]);
    const paymentRow = pr.rows[0] || null;

    await client.query(
      `INSERT INTO payment_refunds (razorpay_refund_id, razorpay_payment_id, payment_id, amount_paise, currency, status, speed, notes, razorpay_created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (razorpay_refund_id) DO UPDATE SET
         status = EXCLUDED.status, speed = EXCLUDED.speed, amount_paise = EXCLUDED.amount_paise,
         payment_id = COALESCE(payment_refunds.payment_id, EXCLUDED.payment_id), updated_at = CURRENT_TIMESTAMP`,
      [refundEntity.id, refundEntity.payment_id, paymentRow?.id || null, Number(refundEntity.amount || 0),
       refundEntity.currency || paymentRow?.currency || 'INR', refundEntity.status || null,
       refundEntity.speed_processed || refundEntity.speed_requested || null,
       JSON.stringify(refundEntity.notes || {}), refundEntity.created_at ? new Date(refundEntity.created_at * 1000) : null]
    );
    if (!paymentRow) return null;

    // Amount refunded: prefer the payment entity Razorpay sent alongside; otherwise sum processed refunds.
    let refundedPaise;
    let refundStatus;
    if (paymentEntity && paymentEntity.id === refundEntity.payment_id && paymentEntity.amount_refunded !== undefined) {
      refundedPaise = Number(paymentEntity.amount_refunded || 0);
      refundStatus = paymentEntity.refund_status || null;
    } else {
      const sum = await client.query(
        `SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS total FROM payment_refunds
          WHERE razorpay_payment_id = $1 AND COALESCE(status, '') <> 'failed'`,
        [refundEntity.payment_id]
      );
      refundedPaise = Number(sum.rows[0].total);
      refundStatus = refundedPaise <= 0 ? null : (refundedPaise >= Number(paymentRow.amount_paise) ? 'full' : 'partial');
    }
    const newStatus = refundStatus === 'full' ? 'refunded' : (refundStatus === 'partial' ? 'partially_refunded' : paymentRow.status);
    const upd = await client.query(
      `UPDATE payments SET amount_refunded_paise = $1, refund_status = $2, status = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 RETURNING *`,
      [refundedPaise, refundStatus, newStatus, paymentRow.id]
    );
    return upd.rows[0];
  }

  return {
    PLAN_SOURCE,
    prepareOrderAmount,
    recordOrder,
    finalizePayment,
    recordFailedPayment,
    applyRefund,
    issueAppInvoice,
    loadPlan,
    breakdownFromRow,
    fiscalYearIST,
  };
}

module.exports = { createPaymentFinalizer, PaymentVerificationError, PLAN_SOURCE, breakdownFromRow, fiscalYearIST };
