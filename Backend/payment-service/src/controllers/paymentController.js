const Razorpay = require("razorpay");
const crypto = require("crypto");
const db = require("../config/db");
const TokenUsageService = require("../services/tokenUsageService");
const { resolveEffectivePlan } = require("../services/effectivePlanService");
const { withTransaction } = require("../utils/withTransaction");
const { createPaymentFinalizer, PaymentVerificationError, PLAN_SOURCE } = require("../services/paymentFinalizeService");
const { createWebhookProcessor } = require("../services/razorpayWebhookService");
const { afterPaymentFinalized } = require("../services/purchasePostCommitService");
const gst = require("../utils/gst");
const axios = require('axios'); // Import axios for HTTP requests

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const finalizer = createPaymentFinalizer({ razorpay });
const webhookProcessor = createWebhookProcessor({
  db,
  finalizer,
  hooks: { afterPaymentFinalized: (result) => afterPaymentFinalized(result, { transactionType: 'Plan Purchase' }) },
});

/** Constant-time comparison of the checkout signature. */
function signatureMatches(expectedBase, received) {
  if (!received || !process.env.RAZORPAY_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_SECRET).update(expectedBase).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(received), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verificationErrorResponse(res, err, label) {
  if (err instanceof PaymentVerificationError) {
    console.warn(`[${label}] ${err.code}: ${err.message}`, err.details || "");
    return res.status(err.httpStatus).json({ success: false, message: err.message, code: err.code });
  }
  console.error(`[${label}] error:`, err);
  return res.status(500).json({ success: false, message: "Payment verification failed", error: err?.message || "Unknown verification error" });
}

function publicTax(payment) {
  if (!payment) return null;
  return {
    basic_amount: gst.paiseToRupeesNumber(payment.basic_amount_paise || 0),
    cgst_rate: payment.cgst_rate === null || payment.cgst_rate === undefined ? null : Number(payment.cgst_rate),
    cgst_amount: gst.paiseToRupeesNumber(payment.cgst_amount_paise || 0),
    sgst_rate: payment.sgst_rate === null || payment.sgst_rate === undefined ? null : Number(payment.sgst_rate),
    sgst_amount: gst.paiseToRupeesNumber(payment.sgst_amount_paise || 0),
    igst_rate: payment.igst_rate === null || payment.igst_rate === undefined ? null : Number(payment.igst_rate),
    igst_amount: gst.paiseToRupeesNumber(payment.igst_amount_paise || 0),
    total_amount: gst.paiseToRupeesNumber(payment.total_amount_paise || payment.amount_paise || 0),
    currency: payment.currency || "INR",
    tax_type: payment.tax_type,
    tax_basis: payment.tax_basis,
  };
}

/**
 * POST /api/payments/order/create   (legacy one-time purchase of a subscription_plans row)
 * Body: { plan_id } or { plan_name }. The amount sent by the browser is ignored: the price comes
 * from subscription_plans and the GST breakdown is frozen in payment_orders.
 */
const createOneTimeOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { plan_id, plan_name, currency: requestedCurrency } = req.body || {};

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: User ID missing." });
    }
    if (!plan_id && !plan_name) {
      return res.status(400).json({ success: false, message: "plan_id or plan_name is required." });
    }

    const planResult = plan_id
      ? await db.query(`SELECT * FROM subscription_plans WHERE id = $1 AND (is_active IS NOT FALSE) LIMIT 1`, [Number(plan_id)])
      : await db.query(`SELECT * FROM subscription_plans WHERE LOWER(name) = LOWER($1) AND (is_active IS NOT FALSE) ORDER BY price DESC LIMIT 1`, [String(plan_name)]);
    const plan = planResult.rows[0];
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    plan.plan_source = PLAN_SOURCE.LEGACY;
    if (requestedCurrency && String(requestedCurrency).toUpperCase() !== String(plan.currency || "INR").toUpperCase()) {
      return res.status(400).json({ success: false, message: "Currency does not match the plan." });
    }

    const { breakdown, amountPaise } = await finalizer.prepareOrderAmount({ plan, userId });
    if (!amountPaise || amountPaise <= 0) {
      return res.status(400).json({ success: false, message: "Plan has no valid price configured." });
    }

    const receipt = `ord_${userId}_${Date.now()}`;
    const notes = { app_user_id: String(userId), app_plan_id: String(plan.id), plan_name: String(plan.name) };
    const order = await razorpay.orders.create({ amount: amountPaise, currency: breakdown.currency, receipt, notes });

    await withTransaction(db, (client) => finalizer.recordOrder(client, { razorpayOrder: order, userId, plan, breakdown, notes }));

    return res.status(200).json({
      success: true,
      message: "Order created successfully",
      order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt },
      plan: { id: plan.id, name: plan.name },
      tax: publicTax({
        basic_amount_paise: breakdown.basicPaise, cgst_rate: gst.bpToPercentNumber(breakdown.cgstRateBp), cgst_amount_paise: breakdown.cgstPaise,
        sgst_rate: gst.bpToPercentNumber(breakdown.sgstRateBp), sgst_amount_paise: breakdown.sgstPaise,
        igst_rate: gst.bpToPercentNumber(breakdown.igstRateBp), igst_amount_paise: breakdown.igstPaise,
        total_amount_paise: breakdown.totalPaise, currency: breakdown.currency, tax_type: breakdown.taxType, tax_basis: breakdown.basis,
      }),
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("🔥 createOneTimeOrder error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: err?.error?.description || err?.message || "Unknown Razorpay error",
    });
  }
};

const startSubscription = async (req, res) => {
  try {
    // Prefer authenticated user id from JWT middleware.
    // Fallback to header for backward compatibility.
    const userId = req.user?.id || req.headers['x-user-id'];
    const { plan_id } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: User ID missing.' });
    if (!plan_id) return res.status(400).json({ success: false, message: 'Missing plan_id.' });

    const planQuery = await db.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
      [plan_id]
    );
    if (planQuery.rows.length === 0) return res.status(404).json({ success: false, message: 'Plan not found or inactive.' });
    const plan = planQuery.rows[0];
    if (!plan.razorpay_plan_id) return res.status(500).json({ success: false, message: `Plan '${plan.name}' is not configured with Razorpay.` });

    const userServiceURL = `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}`;
    const userResponse = await axios.get(userServiceURL, { headers: { Authorization: req.headers['authorization'] } });
    const user = userResponse.data.user || userResponse.data;
    if (!user) return res.status(404).json({ success: false, message: 'User not found in User Service.' });

    let customerId = user.razorpay_customer_id;
    if (!customerId) {
      try {
        const customerData = { name: user.name || user.username, email: user.email };
        if (user.phone) customerData.contact = user.phone;

        const customer = await razorpay.customers.create(customerData);
        customerId = customer.id;

      } catch (err) {
        if (err.error?.code === 'BAD_REQUEST_ERROR' && err.error?.description.includes('already exists')) {
          const existingCustomers = await razorpay.customers.all({ email: user.email });
          if (existingCustomers.items.length > 0) customerId = existingCustomers.items[0].id;
          else throw new Error('Razorpay customer exists but could not fetch ID');
        } else throw err;
      }

      await axios.put(
        `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}/razorpay-customer-id`,
        { razorpay_customer_id: customerId },
        { headers: { Authorization: req.headers['authorization'] } }
      );
    }

    // Validate that the configured Razorpay plan exists and is usable.
    let razorpayPlan;
    try {
      razorpayPlan = await razorpay.plans.fetch(plan.razorpay_plan_id);
    } catch (planFetchErr) {
      console.error("❌ Razorpay plan fetch failed:", {
        statusCode: planFetchErr?.statusCode,
        code: planFetchErr?.error?.code,
        description: planFetchErr?.error?.description || planFetchErr?.message,
        razorpay_plan_id: plan.razorpay_plan_id,
      });
      return res.status(400).json({
        success: false,
        message: "Configured Razorpay plan is invalid or not accessible.",
        error:
          planFetchErr?.error?.description ||
          planFetchErr?.error?.code ||
          planFetchErr?.message ||
          "Unable to fetch Razorpay plan",
      });
    }

    const normalizedInterval = String(plan.interval || "").toLowerCase();
    const totalCount =
      normalizedInterval === "lifetime"
        ? 1
        : normalizedInterval === "year" || normalizedInterval === "yearly" || normalizedInterval === "annual"
        ? 1
        : normalizedInterval === "quarter" || normalizedInterval === "quarterly"
        ? 4
        : 12;

    // Keep payload minimal and Razorpay-compatible.
    const subscriptionData = {
      plan_id: plan.razorpay_plan_id,
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      notes: {
        app_user_id: String(userId),
        app_plan_id: String(plan.id),
      },
    };

    let subscription;
    try {
      subscription = await razorpay.subscriptions.create(subscriptionData);
    } catch (createErr) {
      console.error("❌ Razorpay create subscription failed (primary attempt):", {
        statusCode: createErr?.statusCode,
        code: createErr?.error?.code,
        description: createErr?.error?.description || createErr?.message,
        payload: subscriptionData,
      });

      // Retry once with ultra-minimal payload for provider-side validation edge cases.
      const fallbackPayload = {
        plan_id: plan.razorpay_plan_id,
        total_count: totalCount,
      };
      try {
        subscription = await razorpay.subscriptions.create(fallbackPayload);
      } catch (fallbackErr) {
        console.error("❌ Razorpay create subscription failed (fallback attempt):", {
          statusCode: fallbackErr?.statusCode,
          code: fallbackErr?.error?.code,
          description: fallbackErr?.error?.description || fallbackErr?.message,
          fallbackPayload,
          razorpayPlanMeta: {
            id: razorpayPlan?.id,
            period: razorpayPlan?.period,
            interval: razorpayPlan?.interval,
            status: razorpayPlan?.status,
            item: razorpayPlan?.item,
          },
        });
        throw fallbackErr;
      }
    }
    if (!subscription?.id) throw new Error('Invalid subscription response');

    await db.query(
      `INSERT INTO user_subscriptions
       (user_id, plan_id, razorpay_subscription_id, status, current_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
         status = EXCLUDED.status,
         current_token_balance = EXCLUDED.current_token_balance,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, plan.id, subscription.id, subscription.status, plan.token_limit || 0]
    );

    if (plan.token_limit) {
      await TokenUsageService.resetUserUsage(userId, plan.token_limit, 'Initial Subscription Token Allocation');
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription started successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_id: plan.id,
        plan_name: plan.name,
        customer_id: customerId,
        key: process.env.RAZORPAY_KEY_ID
      }
    });

  } catch (err) {
    console.error('🔥 startSubscription error:', err);
    return res.status(500).json({
      success: false,
      message: 'Subscription initiation failed',
      error:
        err?.error?.description ||
        err?.error?.code ||
        err?.message ||
        'Unknown Razorpay error',
    });
  }
};


/**
 * POST /api/payments/subscription/verify   (legacy Razorpay-managed subscription on subscription_plans)
 */
const verifySubscription = async (req, res) => {
  const userId = req.user?.id;
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, razorpay_order_id } = req.body || {};

  console.log(`[verifySubscription] User: ${userId}, Payment: ${razorpay_payment_id}, Subscription: ${razorpay_subscription_id}`);

  if (!userId || !razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: "Missing verification data" });
  }
  if (!signatureMatches(`${razorpay_payment_id}|${razorpay_subscription_id}`, razorpay_signature)) {
    console.warn(`[verifySubscription] Invalid signature for payment ${razorpay_payment_id}`);
    return res.status(400).json({ success: false, message: "Invalid payment signature" });
  }

  try {
    const result = await withTransaction(db, (client) => finalizer.finalizePayment(client, {
      userId,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id || null,
      razorpaySubscriptionId: razorpay_subscription_id,
      razorpaySignature: razorpay_signature,
      source: 'checkout',
      userEmail: req.user?.email,
    }));

    afterPaymentFinalized(result, { transactionType: 'Plan Upgrade', fallbackEmail: req.user?.email })
      .catch((e) => console.error("[verifySubscription] post-commit error:", e.message));

    if (result.payment.status !== 'captured') {
      return res.status(202).json({
        success: false,
        pending: true,
        message: `Payment is ${result.payment.status}. Your plan will be activated automatically once Razorpay confirms the capture.`,
        payment: { payment_id: razorpay_payment_id, status: result.payment.status },
      });
    }

    const subscription = result.subscription
      || (await db.query('SELECT * FROM user_subscriptions WHERE user_id = $1', [userId])).rows[0] || { status: 'active' };
    return res.status(200).json({
      success: true,
      message: result.alreadyProcessed ? "Payment already verified and processed" : "Subscription verified successfully",
      subscription,
      payment: {
        payment_id: result.payment.razorpay_payment_id,
        order_id: result.payment.razorpay_order_id,
        status: result.payment.status,
        app_invoice_number: result.appInvoice?.invoice_number || null,
        razorpay_invoice_number: result.payment.razorpay_invoice_number || null,
      },
      tax: publicTax(result.payment),
    });
  } catch (err) {
    return verificationErrorResponse(res, err, 'verifySubscription');
  }
};


/**
 * POST /api/payments/webhooks/razorpay — raw body (Buffer) is required; see routes/webhookRoutes.js
 */
const handleWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf8');
  const { httpStatus, body } = await webhookProcessor.processWebhook({
    rawBody,
    signature: req.headers['x-razorpay-signature'],
    eventId: req.headers['x-razorpay-event-id'] || null,
  });
  return res.status(httpStatus).json(body);
};

const getUserPaymentHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized user" });
    }

    const paymentHistory = await db.query(
      `SELECT
        p.id AS payment_id,
        p.razorpay_payment_id,
        p.razorpay_order_id,
        p.razorpay_subscription_id,
        p.amount,
        p.currency,
        p.status AS payment_status,
        p.razorpay_status,
        p.refund_status,
        p.payment_method,
        p.created_at AS payment_date,
        COALESCE(p.purchase_date, p.created_at) AS purchase_date,
        p.transaction_date,

        -- GST breakdown (rupees, derived from integer paise)
        ROUND(p.basic_amount_paise / 100.0, 2) AS basic_amount,
        p.cgst_rate,
        ROUND(p.cgst_amount_paise / 100.0, 2)  AS cgst_amount,
        p.sgst_rate,
        ROUND(p.sgst_amount_paise / 100.0, 2)  AS sgst_amount,
        p.igst_rate,
        ROUND(p.igst_amount_paise / 100.0, 2)  AS igst_amount,
        ROUND(COALESCE(p.total_amount_paise, p.amount_paise) / 100.0, 2) AS total_amount,
        ROUND(p.amount_refunded_paise / 100.0, 2) AS amount_refunded,
        p.tax_type,
        p.tax_basis,

        -- Invoice references: Razorpay (genuine, usually NULL for order payments) and application-generated
        p.razorpay_invoice_id,
        p.razorpay_invoice_number,
        p.razorpay_receipt,
        ai.invoice_number AS app_invoice_number,
        ai.issued_at      AS app_invoice_issued_at,

        us.id AS user_subscription_id,
        us.status AS subscription_status,
        us.start_date,
        us.end_date,

        COALESCE(p.monthly_plan_id, p.plan_id, sp.id, mp.id) AS plan_id,
        COALESCE(p.plan_name, mp.name, sp.name) AS plan_name,
        COALESCE(mp.description, sp.description) AS plan_description,
        COALESCE(mp.price, sp.price) AS plan_price,
        sp.interval AS plan_interval,
        COALESCE(mp.monthly_tokens, sp.token_limit) AS plan_token_limit
      FROM payments p
      LEFT JOIN app_invoices ai ON ai.id = p.app_invoice_id
      LEFT JOIN user_subscriptions us ON p.subscription_id = us.id
      LEFT JOIN subscription_plans sp ON sp.id = COALESCE(p.plan_id, us.plan_id)
      LEFT JOIN monthly_plans mp ON mp.id = COALESCE(p.monthly_plan_id, us.monthly_plan_id)
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC, p.id DESC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: paymentHistory.rows,
    });
  } catch (err) {
    console.error("Error fetching user payment history:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: err.message,
    });
  }
};

const testPlans = async (req, res) => {
  try {
    const dbPlans = await db.query("SELECT id, name, razorpay_plan_id, price, interval, is_active FROM subscription_plans ORDER BY id");
    const rzpPlans = await razorpay.plans.all({ count: 10 });

    console.log("Database Plans:", JSON.stringify(dbPlans.rows, null, 2));
    console.log("Razorpay Plans:", JSON.stringify(rzpPlans.items?.map(p => ({
      id: p.id,
      name: p.item?.name,
      amount: p.item?.amount,
      currency: p.item?.currency,
      period: p.period
    })), null, 2));

    return res.json({
      success: true,
      database_plans: dbPlans.rows,
      razorpay_plans: rzpPlans.items?.length || 0,
      razorpay_plan_details: rzpPlans.items?.map(p => ({
        id: p.id,
        name: p.item?.name,
        amount: p.item?.amount,
        currency: p.item?.currency,
        period: p.period
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Plan test failed",
      error: error.message
    });
  }
};

const testRazorpayConnection = async (req, res) => {
  try {
    const plans = await razorpay.plans.all({ count: 1 });
    return res.status(200).json({
      success: true,
      message: "Successfully connected to Razorpay API",
      plans_count: plans.items.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to connect to Razorpay API",
      error: error.error?.description || error.message,
      raw_error: JSON.stringify(error)
    });
  }
};

const checkAndDeductTokens = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Tokens checked and deducted successfully.",
    currentTokenBalance: req.user.current_token_balance // Provide updated balance
  });
};

const checkAndReserveTokensApi = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { operationCost } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized user" });
    if (typeof operationCost === 'undefined' || operationCost <= 0) {
      return res.status(400).json({ success: false, message: "Bad Request: operationCost is missing or invalid." });
    }

    const tokensReserved = await TokenUsageService.checkAndReserveTokens(userId, operationCost);

    if (tokensReserved) {
      return res.status(200).json({ success: true, message: "Tokens checked and reserved successfully." });
    } else {
      return res.status(403).json({ success: false, message: "Insufficient tokens." });
    }
  } catch (error) {
    console.error("Error in checkAndReserveTokensApi:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const commitTokensApi = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { tokensUsed, actionDescription } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized user" });
    if (typeof tokensUsed === 'undefined' || tokensUsed <= 0) {
      return res.status(400).json({ success: false, message: "Bad Request: tokensUsed is missing or invalid." });
    }

    const committed = await TokenUsageService.commitTokens(userId, tokensUsed, actionDescription);

    if (committed) {
      return res.status(200).json({ success: true, message: "Tokens committed successfully." });
    } else {
      return res.status(400).json({ success: false, message: "Failed to commit tokens. Check balance or logs." });
    }
  } catch (error) {
    console.error("Error in commitTokensApi:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const rollbackTokensApi = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { tokensToRollback, actionDescription } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized user" });
    if (typeof tokensToRollback === 'undefined' || tokensToRollback <= 0) {
      return res.status(400).json({ success: false, message: "Bad Request: tokensToRollback is missing or invalid." });
    }

    const rolledBack = await TokenUsageService.rollbackTokens(userId, tokensToRollback, actionDescription);

    if (rolledBack) {
      return res.status(200).json({ success: true, message: "Tokens rolled back successfully." });
    } else {
      return res.status(400).json({ success: false, message: "Failed to rollback tokens. Check logs." });
    }
  } catch (error) {
    console.error("Error in rollbackTokensApi:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * POST /api/payments/order/verify   (legacy one-time order on subscription_plans)
 * plan_id / plan_name from the body are only a fallback for orders created before payment_orders
 * existed; the payment_orders snapshot (by razorpay_order_id) is the trusted source.
 */
const verifyPersistedOneTimePayment = async (req, res) => {
  const userId = req.user?.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_name, plan_id } = req.body || {};

  if (!userId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: "Missing verification data" });
  }
  if (!signatureMatches(`${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature)) {
    return res.status(400).json({ success: false, message: "Invalid payment signature" });
  }

  try {
    const result = await withTransaction(db, (client) => finalizer.finalizePayment(client, {
      userId,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      razorpaySignature: razorpay_signature,
      planHint: { source: PLAN_SOURCE.LEGACY, id: plan_id ? Number(plan_id) : undefined, name: plan_name },
      source: 'checkout',
      userEmail: req.user?.email,
    }));

    afterPaymentFinalized(result, { transactionType: 'Plan Purchase', fallbackEmail: req.user?.email })
      .catch((e) => console.error("[verifyPersistedOneTimePayment] post-commit error:", e.message));

    if (result.payment.status !== 'captured') {
      return res.status(202).json({
        success: false,
        pending: true,
        message: `Payment is ${result.payment.status}. Your plan will be activated automatically once Razorpay confirms the capture.`,
        payment: { order_id: razorpay_order_id, payment_id: razorpay_payment_id, status: result.payment.status },
      });
    }

    const { activePlan } = await resolveEffectivePlan(userId);
    return res.status(200).json({
      success: true,
      message: result.alreadyProcessed ? "Payment already verified successfully" : "Payment verified successfully",
      payment: {
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
        plan_id: result.plan.id,
        plan_name: result.plan.name,
        status: result.payment.status,
        app_invoice_number: result.appInvoice?.invoice_number || null,
        razorpay_invoice_number: result.payment.razorpay_invoice_number || null,
      },
      tax: publicTax(result.payment),
      subscription: result.subscription || null,
      activePlan,
    });
  } catch (err) {
    return verificationErrorResponse(res, err, 'verifyPersistedOneTimePayment');
  }
};

module.exports = {
  createOneTimeOrder,
  verifyOneTimePayment: verifyPersistedOneTimePayment,
  startSubscription,
  verifySubscription,
  testPlans,
  testRazorpayConnection,
  handleWebhook,
  getUserPaymentHistory,
  checkAndDeductTokens,
  checkAndReserveTokensApi,
  commitTokensApi,
  rollbackTokensApi,
  // exported for tests / other controllers
  finalizer,
  webhookProcessor,
  publicTax,
  signatureMatches,
};
