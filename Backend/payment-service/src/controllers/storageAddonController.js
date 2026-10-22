/**
 * storageAddonController.js
 * Storage add-on purchase flow using the existing `addon_plans` table.
 *
 * GET  /api/payments/storage-addon/plans         → list active storage plans
 * POST /api/payments/storage-addon/order/create  → create Razorpay order
 * POST /api/payments/storage-addon/order/verify  → verify + credit storage
 * GET  /api/payments/storage-addon/history       → user's purchase history
 */

const Razorpay = require('razorpay');
const crypto   = require('crypto');
const db       = require('../config/db');
const { sendPurchaseConfirmationEmail } = require('../services/purchaseEmailService');
const { issuePurchaseInvoice } = require('../services/invoiceNumberService');
const taxService = require('../services/taxService');
const gst = require('../utils/gst');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const GB = 1024 ** 3;

function expiryFromYears(validityYears) {
  const years = Number(validityYears) || 0;
  if (years <= 0) return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * GET /api/payments/storage-addon/plans
 * Returns active storage addon plans from public.addon_plans.
 */
exports.getStorageAddonPlans = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, addon_type, price, currency,
              storage_gb, billing_type, billing_interval_months,
              is_active, sort_order, validity_years, created_at, updated_at
       FROM addon_plans
       WHERE is_active = true
         AND addon_type = 'storage'
       ORDER BY sort_order ASC, price ASC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[storageAddon] getPlans error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch storage add-on plans.' });
  }
};

/**
 * POST /api/payments/storage-addon/order/create
 * Body: { addon_plan_id }
 */
exports.createStorageAddonOrder = async (req, res) => {
  try {
    const userId       = req.user?.id || req.headers['x-user-id'];
    const { addon_plan_id } = req.body;

    if (!userId)        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    if (!addon_plan_id) return res.status(400).json({ success: false, message: 'Missing addon_plan_id.' });

    const planRes = await db.query(
      `SELECT * FROM addon_plans
       WHERE id = $1 AND is_active = true AND addon_type = 'storage'
       LIMIT 1`,
      [addon_plan_id]
    );
    if (!planRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Storage add-on plan not found or inactive.' });
    }
    const plan = planRes.rows[0];

    const order = await razorpay.orders.create({
      amount:   Math.round(Number(plan.price) * 100),
      currency: plan.currency || 'INR',
      receipt:  `sa_${userId}_${Date.now()}`,
      notes: {
        app_user_id:   String(userId),
        addon_plan_id: String(plan.id),
        storage_gb:    String(plan.storage_gb),
      },
    });

    const storageBytes = Math.round(Number(plan.storage_gb) * GB);

    await db.query(
      `INSERT INTO user_storage_addon_purchases
         (user_id, addon_plan_id, storage_bytes_granted, razorpay_order_id, amount, currency, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)`,
      [userId, plan.id, storageBytes, order.id, plan.price, plan.currency || 'INR']
    );

    return res.status(200).json({
      success: true,
      message: 'Storage add-on order created.',
      order:   { id: order.id, amount: order.amount, currency: order.currency },
      plan: {
        id:             plan.id,
        name:           plan.name,
        storage_gb:     plan.storage_gb,
        validity_years: plan.validity_years,
        billing_type:   plan.billing_type,
        price:          plan.price,
        currency:       plan.currency || 'INR',
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[storageAddon] createOrder error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create storage add-on order.',
      error:   err?.error?.description || err?.message,
    });
  }
};

/**
 * POST /api/payments/storage-addon/order/verify
 * Verifies Razorpay payment and adds extra_storage_bytes to user_subscriptions.
 */
exports.verifyStorageAddonPayment = async (req, res) => {
  const userId = Number(req.user?.id || req.headers['x-user-id']);
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, addon_plan_id } = req.body || {};

  if (!userId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing verification data.' });
  }
  if (!process.env.RAZORPAY_SECRET) {
    return res.status(503).json({ success: false, message: 'Payment verification not configured on server.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Idempotency
    const already = await client.query(
      `SELECT id FROM user_storage_addon_purchases
       WHERE razorpay_payment_id = $1 AND status = 'completed' LIMIT 1`,
      [razorpay_payment_id]
    );
    if (already.rows.length) {
      const bal = await client.query(
        `SELECT COALESCE(extra_storage_bytes, 0) AS extra_storage_bytes
         FROM user_subscriptions WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      await client.query('COMMIT');
      return res.status(200).json({
        success: true,
        message: 'Payment already processed.',
        extra_storage_bytes: Number(bal.rows[0]?.extra_storage_bytes || 0),
      });
    }

    // Signature check
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expected !== razorpay_signature) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
    }

    // Fetch pending purchase
    const purchaseRes = await client.query(
      `SELECT id, user_id, addon_plan_id, storage_bytes_granted, status
       FROM user_storage_addon_purchases WHERE razorpay_order_id = $1 FOR UPDATE`,
      [razorpay_order_id]
    );
    if (!purchaseRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Storage add-on order not found.' });
    }
    const purchase = purchaseRes.rows[0];

    if (Number(purchase.user_id) !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Order does not belong to this user.' });
    }
    if (purchase.status === 'completed') {
      const bal = await client.query(
        `SELECT COALESCE(extra_storage_bytes, 0) AS extra_storage_bytes
         FROM user_subscriptions WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      await client.query('COMMIT');
      return res.status(200).json({
        success: true,
        message: 'Payment already processed.',
        extra_storage_bytes: Number(bal.rows[0]?.extra_storage_bytes || 0),
      });
    }

    const resolvedPlanId = addon_plan_id || purchase.addon_plan_id;
    const planRes = await client.query(
      `SELECT * FROM addon_plans WHERE id = $1 LIMIT 1`,
      [resolvedPlanId]
    );
    const plan = planRes.rows[0];
    if (!plan) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Add-on plan could not be resolved.' });
    }

    const storageBytes = Math.round(Number(plan.storage_gb) * GB);
    const expiresAt    = expiryFromYears(plan.validity_years);

    let paymentDetails = { id: razorpay_payment_id, amount: 0, currency: 'INR', order_id: razorpay_order_id };
    try {
      paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (fetchErr) {
      console.warn('[storageAddon] Razorpay fetch failed:', fetchErr.message);
    }

    const paidAmount   = paymentDetails.amount ? Number(paymentDetails.amount) / 100 : Number(plan.price || 0);
    const paidCurrency = paymentDetails.currency || plan.currency || 'INR';

    // Credit extra storage in user_subscriptions (upsert)
    const creditRes = await client.query(
      `INSERT INTO user_subscriptions
         (user_id, extra_storage_bytes, status, current_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1::integer, $2::bigint, 'active', 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         extra_storage_bytes = COALESCE(user_subscriptions.extra_storage_bytes, 0) + EXCLUDED.extra_storage_bytes,
         updated_at = CURRENT_TIMESTAMP
       RETURNING extra_storage_bytes`,
      [userId, storageBytes]
    );

    const totalPaise = gst.rupeesToPaise(paidAmount);
    const tax = taxService.buildTaxBreakdown({ totalPaise, currency: paidCurrency });
    const invoice = await issuePurchaseInvoice(client, {
      userId,
      sourceKind: 'storage',
      sourceId: Number(purchase.id),
      currency: paidCurrency,
      basicPaise: tax.basicPaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      totalPaise: tax.totalPaise,
    });

    // Mark purchase completed
    await client.query(
      `UPDATE user_storage_addon_purchases SET
         razorpay_payment_id   = $1::text,
         razorpay_signature    = $2::text,
         amount                = $3::numeric,
         currency              = $4::text,
         status                = 'completed',
         expires_at            = $5::timestamptz,
         storage_bytes_granted = $6::bigint,
         invoice_number        = $8::text
       WHERE id = $7::integer`,
      [
        String(razorpay_payment_id),
        String(razorpay_signature),
        paidAmount,
        String(paidCurrency),
        expiresAt,
        storageBytes,
        Number(purchase.id),
        invoice.invoice_number,
      ]
    );

    await client.query('COMMIT');

    const newExtraBytes = Number(creditRes.rows[0]?.extra_storage_bytes || storageBytes);

    sendPurchaseConfirmationEmail({
      to:              req.user?.email,
      customerName:    req.user?.email ? req.user.email.split('@')[0] : `User ${userId}`,
      customerEmail:   req.user?.email,
      planName:        `${plan.name} (+${plan.storage_gb} GB storage)`,
      amount:          paidAmount,
      currency:        paidCurrency,
      paymentId:       paymentDetails.id,
      orderId:         paymentDetails.order_id || razorpay_order_id,
      purchaseDate:    new Date(),
      transactionType: 'Storage Add-On',
      tax,
      appInvoiceNumber: invoice.invoice_number,
    }).catch((mailErr) => {
      console.warn('[storageAddon] email failed:', mailErr.message);
    });

    return res.status(200).json({
      success: true,
      message: `${plan.storage_gb} GB storage added successfully.`,
      storage_gb_granted:    plan.storage_gb,
      storage_bytes_granted: storageBytes,
      extra_storage_bytes:   newExtraBytes,
      expires_at:            expiresAt,
      invoice_number:        invoice.invoice_number,
      plan: { id: plan.id, name: plan.name, validity_years: plan.validity_years },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[storageAddon] verify error:', err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || 'Storage add-on verification failed.',
      error:   err.message,
    });
  } finally {
    client.release();
  }
};

/**
 * GET /api/payments/storage-addon/history
 */
exports.getStorageAddonHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized.' });

    const result = await db.query(
      `SELECT
         p.id,
         p.storage_bytes_granted,
         p.amount,
         p.currency,
         p.status,
         p.razorpay_payment_id,
         p.razorpay_order_id,
         p.expires_at,
         p.invoice_number,
         p.created_at,
         a.name           AS plan_name,
         a.storage_gb     AS plan_storage_gb,
         a.validity_years AS plan_validity_years
       FROM user_storage_addon_purchases p
       LEFT JOIN addon_plans a ON a.id = p.addon_plan_id
       WHERE p.user_id = $1::integer
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [Number(userId)]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[storageAddon] history error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch storage add-on history.' });
  }
};
