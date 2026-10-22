import React, { useEffect, useState, useCallback } from 'react';
import { X, Zap, CheckCircle, AlertCircle, Loader2, Shield, Clock, Repeat } from 'lucide-react';
import { PAYMENT_SERVICE_URL } from '@/config/apiConfig';
import { useAuth } from '@/shared/context';
import { invalidateTokenQuotaCache } from '../api/tokenQuotaService';
import { reportPaymentError } from '../api/paymentErrorReport';

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}K`;
  return v.toLocaleString('en-IN');
}

function fmtPrice(price, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Number(price));
}

function validityLabel(days) {
  const d = Number(days) || 0;
  if (d <= 0) return 'No expiry';
  if (d % 365 === 0) return `${d / 365} year${d / 365 !== 1 ? 's' : ''}`;
  if (d % 30 === 0)  return `${d / 30} month${d / 30 !== 1 ? 's' : ''}`;
  return `${d} day${d !== 1 ? 's' : ''}`;
}

export default function TokenTopupModal({ onClose, onSuccess }) {
  const { token, user } = useAuth();
  const [plans, setPlans]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [processing, setProcessing] = useState(null); // plan id being processed
  const [successPlan, setSuccessPlan] = useState(null);
  const [newBalance, setNewBalance]   = useState(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/topup-plans`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load credit plans');
      setPlans(data.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleBuy = async (plan) => {
    setProcessing(plan.id);
    setError(null);
    try {
      const rzpLoaded = await loadRazorpay();
      if (!rzpLoaded) throw new Error('Payment gateway failed to load. Check your internet connection.');

      const orderRes  = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/topup/order/create`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ topup_plan_id: plan.id }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok || !orderData.success) throw new Error(orderData.message || 'Could not create payment order');

      const { order, key } = orderData;

      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key,
          amount:      order.amount,
          currency:    order.currency,
          name:        'JuriNex',
          description: `${plan.name} — ${fmtTokens(plan.tokens)} tokens`,
          order_id:    order.id,
          prefill:     { email: user?.email || '', name: user?.name || user?.username || '' },
          theme:       { color: '#21C1B6' },
          handler: async (response) => {
            try {
              const verifyRes = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/topup/order/verify`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  topup_plan_id:       plan.id,
                }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.success) {
                throw new Error(
                  verifyData.message || verifyData.error ||
                  (typeof verifyData.detail === 'string' ? verifyData.detail : null) ||
                  `Payment verification failed (HTTP ${verifyRes.status})`
                );
              }
              invalidateTokenQuotaCache();
              setSuccessPlan(plan);
              setNewBalance(Number(verifyData.topup_token_balance || 0));
              if (onSuccess) onSuccess(verifyData.topup_token_balance);
              resolve();
            } catch (vErr) {
              reportPaymentError({ flow: 'token-topup', kind: 'verify-failed', token, error: vErr, order, plan });
              reject(vErr);
            }
          },
          modal: {
            ondismiss: () => {
              reportPaymentError({ flow: 'token-topup', kind: 'cancelled', token, message: 'Payment cancelled', order, plan });
              reject(new Error('Payment cancelled'));
            },
          },
        });
        rzp.on('payment.failed', (resp) => {
          reportPaymentError({ flow: 'token-topup', kind: 'failed', token, razorpay: resp, order, plan });
          reject(new Error(resp.error?.description || 'Payment failed'));
        });
        rzp.open();
      });
    } catch (err) {
      if (err.message !== 'Payment cancelled') setError(err.message);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: 'min(92vh, 720px)' }}
      >
        {/* ── Sticky Header ────────────────────────────────── */}
        <div
          className="shrink-0 rounded-t-3xl sm:rounded-t-2xl overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #21C1B6 0%, #0d9488 50%, #0f766e 100%)' }}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-3 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/30" />
          </div>

          <div className="flex items-start justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Zap size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-base leading-tight">Buy Extra Credits</h2>
                <p className="text-teal-100 text-xs mt-0.5">Top up your AI token balance instantly</p>
              </div>
            </div>
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors mt-0.5"
            >
              <X size={15} className="text-white" />
            </button>
          </div>

          {/* Trust badges */}
          <div className="flex items-center gap-4 px-6 pb-4">
            {[
              { icon: Shield, text: 'Secure payment'   },
              { icon: Zap,    text: 'Instant credits'  },
              { icon: Repeat, text: 'Works everywhere' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5">
                <Icon size={11} className="text-teal-200" />
                <span className="text-[11px] text-teal-100 font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Scrollable Body ───────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#e2e8f0 transparent' }}
        >
          {/* Success state */}
          {successPlan && (
            <div className="m-5">
              <div className="flex flex-col items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-8 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle size={28} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-base font-bold text-emerald-800">Credits added!</p>
                  <p className="text-sm text-emerald-600 mt-1">
                    <strong>{fmtTokens(successPlan.tokens)} tokens</strong> have been added to your account.
                    {newBalance != null && (
                      <> Your new balance is <strong>{fmtTokens(newBalance)} credits</strong>.</>
                    )}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="h-9 px-6 text-white text-sm font-semibold rounded-xl transition-colors"
                  style={{ background: '#21C1B6' }}
                >
                  Continue working
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mx-5 mt-4 flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={28} className="text-[#21C1B6] animate-spin" />
              <p className="text-sm text-slate-400">Loading credit plans…</p>
            </div>
          )}

          {/* Empty */}
          {!loading && !successPlan && plans.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Zap size={24} className="text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500">No credit plans available right now.</p>
              <p className="text-xs text-slate-400">Please check back later or contact support.</p>
            </div>
          )}

          {/* Plans grouped by validity */}
          {!loading && !successPlan && plans.length > 0 && (() => {
            // Group by validity bucket
            const GROUP_ORDER  = ['short', 'standard', 'long'];
            const GROUP_LABELS = { short: 'Short Term', standard: 'Standard', long: 'Long Term' };
            const GROUP_BADGE  = { short: null, standard: 'Most popular', long: 'Best value' };

            function validityBucket(days) {
              const d = Number(days) || 0;
              if (d <= 30)  return 'short';
              if (d <= 90)  return 'standard';
              return 'long';
            }

            const grouped = {};
            plans.forEach(plan => {
              const key = validityBucket(plan.validity_days);
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(plan);
            });
            const groupKeys = GROUP_ORDER.filter(k => grouped[k]?.length);

            // Flat list if only one group (no point showing header)
            const showGroups = groupKeys.length > 1;

            return (
              <div className="px-5 py-4 space-y-5">
                {groupKeys.map(groupKey => (
                  <div key={groupKey}>
                    {/* Group header — only shown when multiple groups exist */}
                    {showGroups && (
                      <div className="flex items-center gap-2 mb-3">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          {GROUP_LABELS[groupKey]}
                        </p>
                        {GROUP_BADGE[groupKey] && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {GROUP_BADGE[groupKey]}
                          </span>
                        )}
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {grouped[groupKey].map(plan => {
                        const isProcessing = processing === plan.id;
                        const isDisabled   = processing !== null || !!successPlan;
                        const validity     = validityLabel(plan.validity_days);

                        return (
                          <div
                            key={plan.id}
                            className={`group relative flex items-center gap-4 bg-white border rounded-2xl px-4 py-4 transition-all duration-150 ${
                              isDisabled ? 'opacity-60' : 'hover:border-[#21C1B6] hover:shadow-md cursor-pointer'
                            } border-slate-200`}
                          >
                            {/* Token icon tile */}
                            <div className="flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-100 flex flex-col items-center justify-center gap-0">
                                <Zap size={14} className="text-[#21C1B6]" />
                                <span className="text-[10px] font-bold text-teal-600 leading-tight mt-0.5">
                                  {fmtTokens(plan.tokens)}
                                </span>
                              </div>
                            </div>

                            {/* Plan info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-slate-800 truncate">{plan.name}</p>
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                                  One-time
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs font-bold text-[#21C1B6]">
                                  {fmtTokens(plan.tokens)} tokens
                                </span>
                                <span className="text-slate-200 text-xs">·</span>
                                <span className="text-xs text-slate-400">
                                  {validity}
                                </span>
                              </div>
                              {plan.description && (
                                <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">
                                  {plan.description}
                                </p>
                              )}
                            </div>

                            {/* Price + buy button */}
                            <div className="flex-shrink-0 flex flex-col items-end gap-2">
                              <p className="text-base font-black text-slate-900">
                                {fmtPrice(plan.price, plan.currency)}
                              </p>
                              <button
                                type="button"
                                disabled={isDisabled}
                                onClick={() => !isDisabled && handleBuy(plan)}
                                className="flex items-center gap-1.5 h-8 px-4 text-xs font-bold text-white rounded-xl transition-all duration-150 disabled:cursor-not-allowed"
                                style={{ background: isProcessing ? '#1AA49B' : '#21C1B6' }}
                              >
                                {isProcessing
                                  ? <><Loader2 size={12} className="animate-spin" /> Processing…</>
                                  : 'Buy Now'
                                }
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="h-2" />
              </div>
            );
          })()}
        </div>

        {/* ── Sticky Footer ─────────────────────────────────── */}
        {!successPlan && (
          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3 flex items-center justify-between rounded-b-2xl">
            <p className="text-[11px] text-slate-400 leading-snug">
              Credits are added to your account immediately.<br />
              They activate automatically when your plan runs out.
            </p>
            <button
              type="button" onClick={onClose}
              className="h-8 px-4 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
