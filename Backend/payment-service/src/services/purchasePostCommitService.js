'use strict';
/**
 * Side effects that run AFTER a payment transaction has committed:
 *   - token balance reset (TokenUsageService opens its own transaction, so it must not run inside ours)
 *   - active-plan sync to the auth service
 *   - purchase confirmation e-mail with the stored GST breakdown and invoice numbers
 *
 * Every step is best-effort and logged; none of them can undo a committed purchase.
 */
const TokenUsageService = require('./tokenUsageService');
const { syncUserActivePlanToAuth } = require('./userPlanSyncService');
const { sendPurchaseConfirmationEmail } = require('./purchaseEmailService');
const { resolveEffectivePlan } = require('./effectivePlanService');
const { PLAN_SOURCE } = require('./paymentFinalizeService');
const gst = require('../utils/gst');

function emailPayload(result, { transactionType, fallbackEmail } = {}) {
  const { payment, plan, profile, appInvoice } = result;
  const email = profile?.email || payment.user_email || fallbackEmail || null;
  const name = profile?.name || (email ? email.split('@')[0] : `User ${payment.user_id}`);
  return {
    to: email,
    customerName: name,
    customerEmail: email,
    planName: plan?.name || payment.plan_name || 'Subscription Plan',
    amount: gst.paiseToRupeesNumber(payment.amount_paise),
    currency: payment.currency || 'INR',
    paymentId: payment.razorpay_payment_id,
    orderId: payment.razorpay_order_id,
    purchaseDate: payment.purchase_date || new Date(),
    transactionType: transactionType || 'Plan Purchase',
    paymentStatus: payment.status,
    paymentMethod: payment.payment_method,
    tax: {
      basicPaise: Number(payment.basic_amount_paise),
      cgstRate: payment.cgst_rate, cgstPaise: Number(payment.cgst_amount_paise || 0),
      sgstRate: payment.sgst_rate, sgstPaise: Number(payment.sgst_amount_paise || 0),
      igstRate: payment.igst_rate, igstPaise: Number(payment.igst_amount_paise || 0),
      totalPaise: Number(payment.total_amount_paise),
      taxType: payment.tax_type,
      basis: payment.tax_basis,
    },
    appInvoiceNumber: appInvoice?.invoice_number || null,
    razorpayInvoiceNumber: payment.razorpay_invoice_number || null,
    receipt: payment.razorpay_receipt || null,
  };
}

/**
 * @param {object} result  return value of paymentFinalizeService.finalizePayment
 * @param {object} [opts]
 * @param {string} [opts.transactionType]
 * @param {string} [opts.fallbackEmail]   e-mail from the JWT when the profile lookup had none
 * @param {boolean} [opts.sendEmail=true]
 */
async function afterPaymentFinalized(result, opts = {}) {
  if (!result || !result.payment) return;
  const { payment, plan, userId, activated } = result;
  const log = (m, e) => console.warn(`[postCommit] ${m}:`, e?.message || e);

  if (activated && plan) {
    const tokenLimit = plan.plan_source === PLAN_SOURCE.MONTHLY ? Number(plan.monthly_tokens || 0) : Number(plan.token_limit || 0);
    if (tokenLimit > 0) {
      try { await TokenUsageService.resetUserUsage(userId, tokenLimit, `Plan purchase activation (${payment.razorpay_payment_id})`); }
      catch (e) { log('token reset failed', e); }
    }
    try {
      const { activePlan } = await resolveEffectivePlan(userId);
      await syncUserActivePlanToAuth(userId, activePlan || { plan_id: plan.id, plan_name: plan.name, monthly_plan_id: plan.plan_source === PLAN_SOURCE.MONTHLY ? plan.id : null });
    } catch (e) { log('auth plan sync failed', e); }
  }

  if (activated && payment.status === 'captured' && opts.sendEmail !== false) {
    try { await sendPurchaseConfirmationEmail(emailPayload(result, opts)); }
    catch (e) { log('purchase email failed', e); }
  }
}

module.exports = { afterPaymentFinalized, emailPayload };
