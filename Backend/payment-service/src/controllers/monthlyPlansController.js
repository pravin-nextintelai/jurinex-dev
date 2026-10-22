const Razorpay = require("razorpay");
const crypto = require("crypto");
const db = require("../config/db");
const axios = require("axios");
const { withTransaction } = require("../utils/withTransaction");
const { createPaymentFinalizer, PaymentVerificationError, PLAN_SOURCE } = require("../services/paymentFinalizeService");
const { afterPaymentFinalized } = require("../services/purchasePostCommitService");
const gst = require("../utils/gst");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const finalizer = createPaymentFinalizer({ razorpay });

function signatureMatches(expectedBase, received) {
  if (!received || !process.env.RAZORPAY_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_SECRET).update(expectedBase).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(received), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function taxForResponse(b) {
  return {
    basic_amount: gst.paiseToRupeesNumber(b.basicPaise),
    cgst_rate: gst.bpToPercentNumber(b.cgstRateBp), cgst_amount: gst.paiseToRupeesNumber(b.cgstPaise),
    sgst_rate: gst.bpToPercentNumber(b.sgstRateBp), sgst_amount: gst.paiseToRupeesNumber(b.sgstPaise),
    igst_rate: gst.bpToPercentNumber(b.igstRateBp), igst_amount: gst.paiseToRupeesNumber(b.igstPaise),
    total_amount: gst.paiseToRupeesNumber(b.totalPaise),
    currency: b.currency, tax_type: b.taxType, tax_basis: b.basis,
  };
}

function taxFromPaymentRow(p) {
  if (!p) return null;
  return {
    basic_amount: gst.paiseToRupeesNumber(p.basic_amount_paise || 0),
    cgst_rate: p.cgst_rate === null || p.cgst_rate === undefined ? null : Number(p.cgst_rate),
    cgst_amount: gst.paiseToRupeesNumber(p.cgst_amount_paise || 0),
    sgst_rate: p.sgst_rate === null || p.sgst_rate === undefined ? null : Number(p.sgst_rate),
    sgst_amount: gst.paiseToRupeesNumber(p.sgst_amount_paise || 0),
    igst_rate: p.igst_rate === null || p.igst_rate === undefined ? null : Number(p.igst_rate),
    igst_amount: gst.paiseToRupeesNumber(p.igst_amount_paise || 0),
    total_amount: gst.paiseToRupeesNumber(p.total_amount_paise || p.amount_paise || 0),
    currency: p.currency || "INR", tax_type: p.tax_type, tax_basis: p.tax_basis,
  };
}

/**
 * GET /api/user-resources/monthly-plans
 * Returns all active monthly plans ordered by sort_order.
 */
const getMonthlyPlans = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, price, currency, monthly_tokens,
              storage_limit_gb, is_active, sort_order, razorpay_plan_id, billing_interval_months,
              created_at, updated_at
       FROM monthly_plans
       WHERE is_active = true
       ORDER BY sort_order ASC, price ASC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[getMonthlyPlans] error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch monthly plans", error: err.message });
  }
};

/**
 * POST /api/user-resources/monthly-plans/subscribe/start
 * Body: { plan_id }
 * Creates a Razorpay subscription for a monthly_plans entry.
 */
const startMonthlySubscription = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    const { plan_id } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized: User ID missing." });
    if (!plan_id) return res.status(400).json({ success: false, message: "Missing plan_id." });

    const planResult = await db.query(
      "SELECT * FROM monthly_plans WHERE id = $1 AND is_active = true LIMIT 1",
      [plan_id]
    );
    if (!planResult.rows.length) {
      return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    }
    const plan = planResult.rows[0];

    if (!plan.razorpay_plan_id) {
      // No Razorpay subscription plan — use a one-time order.
      // Price and GST are computed server-side (integer paise) and frozen in payment_orders so the
      // verify step and the webhook reuse exactly this breakdown.
      plan.plan_source = PLAN_SOURCE.MONTHLY;
      const { breakdown, amountPaise } = await finalizer.prepareOrderAmount({ plan, userId });
      if (!amountPaise || amountPaise <= 0) {
        return res.status(400).json({ success: false, message: "Plan has no valid price configured." });
      }

      const notes = { app_user_id: String(userId), monthly_plan_id: String(plan.id), plan_name: String(plan.name) };
      const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: breakdown.currency,
        receipt: `mp_${userId}_${Date.now()}`,
        notes,
      });

      await withTransaction(db, (client) => finalizer.recordOrder(client, { razorpayOrder: order, userId, plan, breakdown, notes }));

      // Compute end date in JS to avoid PostgreSQL interval type-inference issues
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (Number(plan.billing_interval_months) || 1));

      // Store pending plan WITHOUT changing the current active status.
      // This ensures the user keeps their existing plan during payment.
      await db.query(
        `INSERT INTO user_subscriptions
           (user_id, monthly_plan_id, status, current_token_balance, topup_token_balance,
            start_date, end_date, activated_at, last_reset_date, created_at, updated_at)
         VALUES ($1, $2, 'active', $3, 0,
                 CURRENT_DATE, $4::DATE,
                 NULL, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_plan_id = EXCLUDED.monthly_plan_id,
           updated_at      = CURRENT_TIMESTAMP`,
        [userId, plan.id, plan.monthly_tokens || 0, endDate.toISOString().split("T")[0]]
      );

      return res.status(200).json({
        success: true,
        type: "order",
        order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt },
        plan: {
          id: plan.id,
          name: plan.name,
          monthly_tokens: plan.monthly_tokens,
        },
        tax: taxForResponse(breakdown),
        key: process.env.RAZORPAY_KEY_ID,
      });
    }

    // Fetch user for Razorpay customer creation
    let user = {};
    try {
      const userResp = await axios.get(
        `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}`,
        { headers: { Authorization: req.headers["authorization"] } }
      );
      user = userResp.data.user || userResp.data || {};
    } catch (_) {}

    let customerId = user.razorpay_customer_id;
    if (!customerId && user.email) {
      try {
        const customer = await razorpay.customers.create({
          name: user.name || user.username || user.email,
          email: user.email,
          ...(user.phone ? { contact: user.phone } : {}),
        });
        customerId = customer.id;
        await axios.put(
          `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}/razorpay-customer-id`,
          { razorpay_customer_id: customerId },
          { headers: { Authorization: req.headers["authorization"] } }
        );
      } catch (cerr) {
        console.warn("[startMonthlySubscription] customer create failed:", cerr.message);
      }
    }

    const totalCount = plan.billing_interval_months > 0 ? Math.ceil(12 / plan.billing_interval_months) : 12;

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpay_plan_id,
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      notes: { app_user_id: String(userId), monthly_plan_id: String(plan.id) },
    });

    await db.query(
      `INSERT INTO user_subscriptions
         (user_id, monthly_plan_id, razorpay_subscription_id, status, current_token_balance,
          topup_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         monthly_plan_id           = EXCLUDED.monthly_plan_id,
         razorpay_subscription_id  = EXCLUDED.razorpay_subscription_id,
         status                    = EXCLUDED.status,
         current_token_balance     = EXCLUDED.current_token_balance,
         updated_at                = CURRENT_TIMESTAMP`,
      [userId, plan.id, subscription.id, subscription.status, plan.monthly_tokens || 0]
    );

    return res.status(200).json({
      success: true,
      type: "subscription",
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_id: plan.id,
        plan_name: plan.name,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    const detail = err?.error?.description || err?.error?.code || err?.message || "Unknown error";
    console.error("[startMonthlySubscription] error:", detail, err);
    return res.status(500).json({
      success: false,
      message: detail,
      error: detail,
    });
  }
};

/**
 * POST /api/user-resources/monthly-plans/subscribe/verify
 * Verifies the checkout signature, then finalizes the payment through the shared trusted path:
 * payment re-read from Razorpay, amount/currency checked against the payment_orders snapshot,
 * GST breakdown stored in paise, subscription activated at most once, application invoice issued.
 */
const verifyMonthlySubscription = async (req, res) => {
  const userId = req.user?.id;
  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_order_id,
    razorpay_signature,
    plan_id,
  } = req.body || {};

  if (!userId || !razorpay_payment_id || !razorpay_signature || (!razorpay_order_id && !razorpay_subscription_id)) {
    return res.status(400).json({ success: false, message: "Missing verification data." });
  }

  const signBase = razorpay_subscription_id
    ? `${razorpay_payment_id}|${razorpay_subscription_id}`
    : `${razorpay_order_id}|${razorpay_payment_id}`;
  if (!signatureMatches(signBase, razorpay_signature)) {
    return res.status(400).json({ success: false, message: "Invalid payment signature." });
  }

  try {
    const result = await withTransaction(db, (client) => finalizer.finalizePayment(client, {
      userId,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_subscription_id ? null : razorpay_order_id,
      razorpaySubscriptionId: razorpay_subscription_id || null,
      razorpaySignature: razorpay_signature,
      // Fallback only (orders created before payment_orders existed); never overrides the snapshot.
      planHint: plan_id ? { source: PLAN_SOURCE.MONTHLY, id: Number(plan_id) } : null,
      source: "checkout",
      userEmail: req.user?.email,
    }));

    afterPaymentFinalized(result, { transactionType: "Monthly Plan Subscription", fallbackEmail: req.user?.email })
      .catch((e) => console.error("[verifyMonthlySubscription] post-commit error:", e.message));

    const plan = result.plan;
    if (result.payment.status !== "captured") {
      return res.status(202).json({
        success: false,
        pending: true,
        message: `Payment is ${result.payment.status}. Your plan will be activated automatically once Razorpay confirms the capture.`,
        payment: { payment_id: razorpay_payment_id, order_id: razorpay_order_id || null, status: result.payment.status },
      });
    }

    const userSub = result.subscription
      || (await db.query("SELECT * FROM user_subscriptions WHERE user_id = $1 LIMIT 1", [userId])).rows[0] || null;

    return res.status(200).json({
      success: true,
      message: result.alreadyProcessed ? "Payment already processed." : "Monthly plan subscription verified.",
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        monthly_tokens: plan.monthly_tokens,
        billing_interval_months: plan.billing_interval_months,
      },
      payment: {
        payment_id: result.payment.razorpay_payment_id,
        order_id: result.payment.razorpay_order_id,
        status: result.payment.status,
        payment_method: result.payment.payment_method,
        app_invoice_number: result.appInvoice?.invoice_number || null,
        razorpay_invoice_number: result.payment.razorpay_invoice_number || null,
        receipt: result.payment.razorpay_receipt || null,
      },
      tax: taxFromPaymentRow(result.payment),
      subscription: userSub,
      activePlan: {
        plan_id: plan.id,
        plan_name: plan.name,
        monthly_tokens: plan.monthly_tokens,
        billing_interval_months: plan.billing_interval_months,
        price: plan.price,
        currency: plan.currency,
        status: "active",
      },
    });
  } catch (err) {
    if (err instanceof PaymentVerificationError) {
      console.warn(`[verifyMonthlySubscription] ${err.code}: ${err.message}`, err.details || "");
      return res.status(err.httpStatus).json({ success: false, message: err.message, code: err.code });
    }
    console.error("[verifyMonthlySubscription] error:", err);
    return res.status(500).json({ success: false, message: "Verification failed.", error: err.message });
  }
};

module.exports = { getMonthlyPlans, startMonthlySubscription, verifyMonthlySubscription };
