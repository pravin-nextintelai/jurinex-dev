const Razorpay = require("razorpay");
const crypto = require("crypto");
const db = require("../config/db");
const { sendPurchaseConfirmationEmail } = require("../services/purchaseEmailService");
const { maybeDeductTopupAfterUsage } = require("../services/topupDeductionService");
const { issuePurchaseInvoice } = require("../services/invoiceNumberService");
const taxService = require("../services/taxService");
const gst = require("../utils/gst");

const TOPUP_PLANS_TABLE = "topup_plans";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

function nextIstMidnightIso() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const nextIst = new Date(istNow);
  nextIst.setHours(24, 0, 0, 0);
  const diffMs = nextIst.getTime() - istNow.getTime();
  return new Date(now.getTime() + diffMs).toISOString();
}

function nextUtcMidnightIso() {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  )).toISOString();
}

/**
 * GET /api/payments/topup-plans
 * Returns active packs from public.topup_plans (Freedom_10, Freedom_50, Quick_10, …).
 */
const getTopupPlans = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, price, currency, tokens, validity_days,
              is_active, sort_order, razorpay_plan_id, created_at, updated_at
       FROM ${TOPUP_PLANS_TABLE}
       WHERE is_active = true
       ORDER BY sort_order ASC, price ASC, id ASC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[getTopupPlans] error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch top-up plans.", error: err.message });
  }
};

/**
 * GET /api/payments/token-quota-status
 * Unified shared token pool status.
 */
const getDailyTokenStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const usageResult = await db.query(
      `SELECT
         COALESCE(
           SUM(total_tokens) FILTER (
             WHERE (used_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           ),
           0
         )::bigint AS tokens_today,
         COALESCE(SUM(total_tokens), 0)::bigint AS tokens_all_time
       FROM public.llm_usage_logs
       WHERE user_id::text = $1`,
      [String(userId)]
    );
    const tokensToday = Number(usageResult.rows[0]?.tokens_today || 0);

    const subResult = await db.query(
      `SELECT
         us.topup_token_balance,
         COALESCE(us.last_reset_date, us.start_date) AS billing_period_start,
         COALESCE(mp.monthly_tokens, sp.token_limit, 0) AS monthly_tokens,
         COALESCE(mp.name, sp.name)                     AS plan_name,
         mp.id                                          AS monthly_plan_id
       FROM user_subscriptions us
       LEFT JOIN monthly_plans mp    ON mp.id = us.monthly_plan_id
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id = $1
         AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
         AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
       ORDER BY us.updated_at DESC
       LIMIT 1`,
      [userId]
    );

    const sub = subResult.rows[0] || {};
    const monthlyLimit = Number(sub.monthly_tokens || 0);
    const topupBalance = Number(sub.topup_token_balance || 0);
    const billingPeriodStart = sub.billing_period_start || null;

    let tokensThisPeriod = Number(usageResult.rows[0]?.tokens_all_time || 0);
    if (monthlyLimit > 0 && billingPeriodStart) {
      const periodResult = await db.query(
        `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_period
         FROM public.llm_usage_logs
         WHERE user_id::text = $1 AND used_at >= $2::timestamptz`,
        [String(userId), billingPeriodStart]
      );
      tokensThisPeriod = Number(periodResult.rows[0]?.tokens_period || 0);
    }

    const effectiveTopup = topupBalance;
    const monthlyExhausted = monthlyLimit > 0 && tokensThisPeriod >= monthlyLimit;
    const canUseTopup = effectiveTopup > 0 && monthlyExhausted;
    const blocked = monthlyExhausted && effectiveTopup <= 0;

    const planRemaining = Math.max(0, monthlyLimit - tokensThisPeriod);
    const source = effectiveTopup > 0 && monthlyExhausted ? 'topup'
      : monthlyLimit === 0 ? 'unlimited'
      : blocked ? 'none'
      : 'plan';

    return res.status(200).json({
      success: true,
      data: {
        shared_pool: true,
        plan_name: sub.plan_name || null,
        monthly_plan_id: sub.monthly_plan_id || null,
        tokens_used_today: tokensToday,
        tokens_used_this_period: tokensThisPeriod,
        monthly_token_limit: monthlyLimit,
        topup_token_balance: effectiveTopup,
        monthly_exhausted: monthlyExhausted,
        limit_exhausted: blocked,
        blocked,
        block_reason: blocked ? "monthly" : null,
        can_use_topup: canUseTopup,
        reset_at_utc: nextUtcMidnightIso(),
        source,
        remaining: { plan: planRemaining, topup: effectiveTopup },
      },
    });
  } catch (err) {
    console.error("[getDailyTokenStatus] error:", err);
    return res.status(500).json({ success: false, message: "Failed to get token quota status.", error: err.message });
  }
};

/**
 * POST /api/payments/topup/order/create
 * Body: { topup_plan_id }
 */
const createTopupOrder = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    const { topup_plan_id } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (!topup_plan_id) return res.status(400).json({ success: false, message: "Missing topup_plan_id." });

    const planResult = await db.query(
      `SELECT * FROM ${TOPUP_PLANS_TABLE} WHERE id = $1 AND is_active = true LIMIT 1`,
      [topup_plan_id]
    );
    if (!planResult.rows.length) {
      return res.status(404).json({ success: false, message: "Top-up plan not found or inactive." });
    }
    const plan = planResult.rows[0];

    const order = await razorpay.orders.create({
      amount: Math.round(Number(plan.price) * 100),
      currency: plan.currency || "INR",
      receipt: `tu_${userId}_${Date.now()}`,
      notes: {
        app_user_id: String(userId),
        topup_plan_id: String(plan.id),
        tokens: String(plan.tokens),
      },
    });

    await db.query(
      `INSERT INTO user_token_topup_purchases
         (user_id, topup_plan_id, tokens_credited, razorpay_order_id, amount, currency, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)`,
      [userId, plan.id, plan.tokens, order.id, plan.price, plan.currency || "INR"]
    );

    return res.status(200).json({
      success: true,
      message: "Top-up order created.",
      order: { id: order.id, amount: order.amount, currency: order.currency },
      plan: {
        id: plan.id,
        name: plan.name,
        tokens: plan.tokens,
        validity_days: plan.validity_days,
        price: plan.price,
        currency: plan.currency || "INR",
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[createTopupOrder] error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create top-up order.",
      error: err?.error?.description || err?.message,
    });
  }
};

/**
 * POST /api/payments/topup/order/verify
 * Verifies Razorpay payment and credits topup_token_balance.
 */
const verifyTopupPayment = async (req, res) => {
  const userId = Number(req.user?.id || req.headers["x-user-id"]);
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, topup_plan_id } = req.body || {};

  console.log("[verifyTopupPayment] start", {
    userId,
    razorpay_order_id,
    razorpay_payment_id: razorpay_payment_id ? `${String(razorpay_payment_id).slice(0, 12)}…` : null,
    topup_plan_id,
  });

  if (!userId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: "Missing verification data." });
  }

  if (!process.env.RAZORPAY_SECRET) {
    console.error("[verifyTopupPayment] RAZORPAY_SECRET is not configured");
    return res.status(503).json({
      success: false,
      message: "Payment verification is not configured on the server.",
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const completedByPayment = await client.query(
      `SELECT id, status FROM user_token_topup_purchases
       WHERE razorpay_payment_id = $1 AND status = 'completed' LIMIT 1`,
      [razorpay_payment_id]
    );
    if (completedByPayment.rows.length) {
      const bal = await client.query(
        "SELECT topup_token_balance FROM user_subscriptions WHERE user_id = $1 LIMIT 1",
        [userId]
      );
      await client.query("COMMIT");
      return res.status(200).json({
        success: true,
        message: "Payment already processed.",
        topup_token_balance: Number(bal.rows[0]?.topup_token_balance || 0),
      });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) {
      await client.query("ROLLBACK");
      console.warn("[verifyTopupPayment] invalid signature for order", razorpay_order_id);
      return res.status(400).json({ success: false, message: "Invalid payment signature." });
    }

    const purchaseRes = await client.query(
      `SELECT id, user_id, topup_plan_id, status
       FROM user_token_topup_purchases
       WHERE razorpay_order_id = $1
       FOR UPDATE`,
      [razorpay_order_id]
    );
    if (!purchaseRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Top-up order not found. Please create a new order and try again.",
      });
    }

    const purchase = purchaseRes.rows[0];
    if (Number(purchase.user_id) !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Order does not belong to this user." });
    }
    if (purchase.status === "completed") {
      const bal = await client.query(
        "SELECT topup_token_balance FROM user_subscriptions WHERE user_id = $1 LIMIT 1",
        [userId]
      );
      await client.query("COMMIT");
      return res.status(200).json({
        success: true,
        message: "Payment already processed.",
        topup_token_balance: Number(bal.rows[0]?.topup_token_balance || 0),
      });
    }

    const planId = topup_plan_id || purchase.topup_plan_id;
    const planRes = await client.query(
      `SELECT * FROM ${TOPUP_PLANS_TABLE} WHERE id = $1 LIMIT 1`,
      [planId]
    );
    const plan = planRes.rows[0];
    if (!plan) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Top-up plan could not be resolved." });
    }

    const tokensToCredit = Math.max(0, Math.floor(Number(plan.tokens) || 0));
    const validityDays = Math.max(0, Number(plan.validity_days) || 0);
    const topupExpiresAt =
      validityDays > 0
        ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
        : null;

    let paymentDetails = { id: razorpay_payment_id, amount: 0, currency: "INR", order_id: razorpay_order_id };
    try {
      paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (fetchErr) {
      console.warn("[verifyTopupPayment] Razorpay fetch failed:", fetchErr.message);
    }

    const paidAmount = paymentDetails.amount
      ? Number(paymentDetails.amount) / 100
      : Number(plan.price || 0);
    const paidCurrency = paymentDetails.currency || plan.currency || "INR";

    const creditResult = await client.query(
      `INSERT INTO user_subscriptions
         (user_id, topup_token_balance, topup_expires_at, status,
          current_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1::integer, $2::integer, $3::timestamptz, 'active', 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         topup_token_balance = COALESCE(user_subscriptions.topup_token_balance, 0) + EXCLUDED.topup_token_balance,
         topup_expires_at = CASE
           WHEN EXCLUDED.topup_expires_at IS NULL THEN user_subscriptions.topup_expires_at
           WHEN user_subscriptions.topup_expires_at IS NULL
             OR user_subscriptions.topup_expires_at < EXCLUDED.topup_expires_at
           THEN EXCLUDED.topup_expires_at
           ELSE user_subscriptions.topup_expires_at
         END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING topup_token_balance`,
      [userId, tokensToCredit, topupExpiresAt]
    );

    const totalPaise = gst.rupeesToPaise(paidAmount);
    const tax = taxService.buildTaxBreakdown({ totalPaise, currency: paidCurrency });
    const invoice = await issuePurchaseInvoice(client, {
      userId,
      sourceKind: "topup",
      sourceId: Number(purchase.id),
      currency: paidCurrency,
      basicPaise: tax.basicPaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      totalPaise: tax.totalPaise,
    });

    await client.query(
      `UPDATE user_token_topup_purchases SET
         razorpay_payment_id = $1::text,
         razorpay_signature  = $2::text,
         amount              = $3::numeric,
         currency            = $4::text,
         status              = 'completed',
         expires_at          = $5::timestamptz,
         tokens_credited     = $6::integer,
         invoice_number      = $8::text
       WHERE id = $7::integer`,
      [
        String(razorpay_payment_id),
        String(razorpay_signature),
        paidAmount,
        String(paidCurrency),
        topupExpiresAt,
        tokensToCredit,
        Number(purchase.id),
        invoice.invoice_number,
      ]
    );

    await client.query("COMMIT");

    const newBalance = Number(creditResult.rows[0]?.topup_token_balance || tokensToCredit);
    console.log("[verifyTopupPayment] success", { userId, tokensToCredit, newBalance, planId: plan.id });

    sendPurchaseConfirmationEmail({
      to: req.user?.email,
      customerName: req.user?.email ? req.user.email.split("@")[0] : `User ${userId}`,
      customerEmail: req.user?.email,
      planName: `${plan.name} (${tokensToCredit.toLocaleString()} tokens)`,
      amount: paidAmount,
      currency: paidCurrency,
      paymentId: paymentDetails.id,
      orderId: paymentDetails.order_id || razorpay_order_id,
      purchaseDate: new Date(),
      transactionType: "Token Top-Up",
      tax,
      appInvoiceNumber: invoice.invoice_number,
    }).catch((mailErr) => {
      console.warn("[verifyTopupPayment] email failed:", mailErr.message);
    });

    return res.status(200).json({
      success: true,
      message: `${tokensToCredit.toLocaleString()} tokens credited successfully.`,
      tokens_credited: tokensToCredit,
      topup_token_balance: newBalance,
      expires_at: topupExpiresAt,
      invoice_number: invoice.invoice_number,
      plan: { id: plan.id, name: plan.name, validity_days: plan.validity_days },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[verifyTopupPayment] rollback failed:", rollbackErr.message);
    }
    console.error("[verifyTopupPayment] error:", err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || "Top-up verification failed.",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

/**
 * POST /api/payments/topup/deduct
 * Deduct top-up tokens after LLM usage beyond plan limits.
 */
const deductTopupTokens = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    const { tokens } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (!tokens || tokens <= 0) return res.status(400).json({ success: false, message: "Invalid tokens value." });

    await maybeDeductTopupAfterUsage(userId, tokens);

    const result = await db.query(
      `SELECT topup_token_balance FROM user_subscriptions WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      topup_token_balance: Number(result.rows[0]?.topup_token_balance || 0),
    });
  } catch (err) {
    console.error("[deductTopupTokens] error:", err);
    return res.status(500).json({ success: false, message: "Failed to deduct topup tokens.", error: err.message });
  }
};

/**
 * GET /api/payments/topup/history
 * Returns the authenticated user's top-up purchase history.
 */
const getTopupHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const result = await db.query(
      `SELECT
         p.id,
         p.tokens_credited,
         p.amount,
         p.currency,
         p.status,
         p.razorpay_payment_id,
         p.razorpay_order_id,
         p.expires_at,
         p.invoice_number,
         p.created_at,
         t.name   AS plan_name,
         t.tokens AS plan_tokens
       FROM user_token_topup_purchases p
       LEFT JOIN topup_plans t ON t.id = p.topup_plan_id
       WHERE p.user_id = $1::integer
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [Number(userId)]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[getTopupHistory] error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch top-up history.", error: err.message });
  }
};

module.exports = { getTopupPlans, getDailyTokenStatus, createTopupOrder, verifyTopupPayment, deductTopupTokens, getTopupHistory };
