/**
 * Report a checkout failure the browser saw but the backend never did (a
 * Razorpay window the user closed, a declined card, a verify call that failed)
 * so it lands in the central error log with the user's id.
 *
 * Fire-and-forget: never throws, never blocks the UI.
 */
import { PAYMENT_SERVICE_URL } from '../config/apiConfig';

const pick = (obj, keys) => {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
};

/**
 * @param {object} p
 * @param {string} p.flow      "token-topup" | "storage-addon" | "subscription"
 * @param {string} p.kind      "cancelled" | "failed" | "verify-failed" | "error"
 * @param {string} [p.token]   JWT; without it nothing is sent
 * @param {string} [p.message] text shown to the user
 * @param {Error}  [p.error]
 * @param {object} [p.razorpay] the `payment.failed` payload from Razorpay
 * @param {object} [p.order]    { id, amount, currency } from the order/subscription start call
 * @param {object} [p.plan]     { id, name }
 */
export function reportPaymentError({ flow, kind, token, message, error, razorpay, order, plan, page } = {}) {
  try {
    const jwt = token || localStorage.getItem('token');
    if (!jwt) return;
    const rzError = razorpay && razorpay.error ? razorpay.error : null;
    const body = {
      flow: flow || 'unknown',
      kind: kind || 'error',
      message: message || (error && error.message) || undefined,
      razorpay: rzError
        ? { error: { ...pick(rzError, ['code', 'description', 'source', 'step', 'reason']), metadata: pick(rzError.metadata, ['order_id', 'payment_id']) } }
        : undefined,
      order_id: (order && order.id) || undefined,
      amount: (order && order.amount) || undefined,
      currency: (order && order.currency) || undefined,
      plan_id: (plan && plan.id) || undefined,
      plan_name: (plan && plan.name) || undefined,
      page: page || (typeof window !== 'undefined' ? window.location.pathname : undefined),
    };
    // window.fetch may be wrapped by clientErrorReporter; a failure here must not be re-reported
    (window.__nativeFetch || fetch)(`${PAYMENT_SERVICE_URL}/api/payments/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never break checkout */
  }
}

export default reportPaymentError;
