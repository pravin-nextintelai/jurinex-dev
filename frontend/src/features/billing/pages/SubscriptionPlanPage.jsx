import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/shared/context';
import { invalidateSecretsListCache } from '@/shared/api/secretsService';
import { PAYMENT_SERVICE_URL } from '@/config/apiConfig';

const BACKEND_BASE_URL = PAYMENT_SERVICE_URL;

// ─── helpers ────────────────────────────────────────────────────────────────

const fmt = (n, currency = 'INR') => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  return (currency === 'INR' ? '₹' : `${currency} `) + num.toLocaleString('en-IN');
};

const fmtTokens = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toLocaleString('en-IN')}M`;
  if (num >= 1_000) return `${(num / 1_000).toLocaleString('en-IN')}K`;
  return num.toLocaleString('en-IN');
};

const BILLING_PERIODS = [
  { label: 'Monthly',     months: 1  },
  { label: 'Quarterly',   months: 3  },
  { label: 'Half-Yearly', months: 6  },
  { label: 'Yearly',      months: 12 },
];

const billingLabel = (months) => {
  if (!months || months === 1) return '/month';
  if (months === 3) return '/quarter';
  if (months === 6) return '/6 months';
  if (months === 12) return '/year';
  return `/${months}mo`;
};

const savingsLabel = (months) => {
  if (months === 3)  return 'Save ~10%';
  if (months === 6)  return 'Save ~20%';
  if (months === 12) return 'Save ~33%';
  return null;
};

function getPlanCategory(plan) {
  if (plan.plan_category) return plan.plan_category.toLowerCase();
  const name = (plan.name || '').toLowerCase();
  if (name.includes('firm') || name.includes('team') || name.includes('enterprise')) return 'firm';
  if (name.includes('custom')) return 'firm';
  return 'solo';
}

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    if (document.getElementById('rzp-script')) return resolve(true);
    const s = document.createElement('script');
    s.id = 'rzp-script';
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function extractUserId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj.id ?? obj.user_id ?? obj.userId ?? obj.uid ?? null;
}

function resolveCurrentUser(authUser) {
  for (const key of ['userInfo', 'user', 'userData', 'authUser']) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const id = extractUserId(parsed) ?? extractUserId(parsed?.user) ?? extractUserId(parsed?.data);
      if (id) return { ...(parsed.user || parsed.data || parsed), id };
    } catch (_) {}
  }
  const id = extractUserId(authUser);
  if (id) return { ...authUser, id };
  return null;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function SubscriptionPlanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, planInfo, fetchAndStorePlan } = useAuth();

  const [plans, setPlans]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [pendingCheckout, setPendingCheckout] = useState(null);

  // Filter state
  const [activeCategory, setActiveCategory]       = useState('solo');
  const [activeBillingMonths, setActiveBillingMonths] = useState(1);

  // Current plan name (from auth context)
  const currentPlanName = useMemo(() => {
    const sub = planInfo?.subscription || planInfo;
    return (sub?.plan_name || sub?.planName || planInfo?.plan || '').toLowerCase().trim();
  }, [planInfo]);

  const isCurrentPlan = (plan) =>
    currentPlanName && plan.name.toLowerCase().trim() === currentPlanName;

  // ── Fetch monthly_plans ───────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const storedToken = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_BASE_URL}/api/payments/monthly-plans`, {
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
        },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || `Status ${res.status}`);
      setPlans(json.data || []);
    } catch (err) {
      setError(`Failed to load plans: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  useEffect(() => {
    if (!token || currentPlanName || typeof fetchAndStorePlan !== 'function') return;
    fetchAndStorePlan(token).catch(() => {});
  }, [token, currentPlanName, fetchAndStorePlan]);

  useEffect(() => {
    const statePending = location.state?.pendingUpgradePlan;
    if (statePending && typeof statePending === 'object') {
      setPendingCheckout(statePending);
      localStorage.setItem('pendingUpgradeCheckout', JSON.stringify(statePending));
      return;
    }
    const stored = localStorage.getItem('pendingUpgradeCheckout');
    if (stored) {
      try { setPendingCheckout(JSON.parse(stored)); } catch (_) { localStorage.removeItem('pendingUpgradeCheckout'); }
    }
  }, [location.state]);

  useEffect(() => {
    if (!pendingCheckout || loading || processingId || plans.length === 0) return;
    const targetName = String(pendingCheckout.planName || '').toLowerCase();
    const match = plans.find((p) => p.name.toLowerCase().includes(targetName) || targetName.includes(p.name.toLowerCase()));
    if (!match) return;
    localStorage.removeItem('pendingUpgradeCheckout');
    setPendingCheckout(null);
    handleSelectPlan(match);
  }, [pendingCheckout, loading, processingId, plans]);

  // ── Derived: which billing periods have plans for active category ──────────
  const availableBillingMonths = useMemo(() => {
    const set = new Set(
      plans
        .filter((p) => getPlanCategory(p) === activeCategory)
        .map((p) => p.billing_interval_months || 1)
    );
    return set;
  }, [plans, activeCategory]);

  // Reset to first available billing period when switching category
  useEffect(() => {
    const firstAvailable = BILLING_PERIODS.find(({ months }) => availableBillingMonths.has(months));
    setActiveBillingMonths(firstAvailable?.months ?? 1);
  }, [activeCategory]); // availableBillingMonths recomputes sync during same render, safe to omit

  // Filtered plans
  const filteredPlans = useMemo(() =>
    plans.filter(
      (p) =>
        getPlanCategory(p) === activeCategory &&
        (p.billing_interval_months || 1) === activeBillingMonths
    ),
    [plans, activeCategory, activeBillingMonths]
  );

  // ── Payment ────────────────────────────────────────────────────────────────
  const handleSelectPlan = async (plan) => {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) { setError('Please log in to continue.'); return; }

    const currentUser = resolveCurrentUser(user);
    if (!currentUser?.id) { setError('User info not found. Please log in again.'); return; }

    if (!plan.price || Number(plan.price) <= 0) {
      navigate('/contact');
      return;
    }

    setProcessingId(plan.id);
    setError(null);

    try {
      const rzpLoaded = await loadRazorpay();
      if (!rzpLoaded) throw new Error('Payment gateway failed to load. Please refresh.');

      const startRes = await fetch(`${BACKEND_BASE_URL}/api/payments/monthly-plans/subscribe/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storedToken}` },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.success) {
        throw new Error(startData.error || startData.message || 'Could not initiate payment.');
      }

      const key            = startData.key;
      const isSubscription = startData.type === 'subscription';
      const orderId        = startData.order?.id ?? null;
      const subscriptionId = startData.subscription?.id ?? null;

      const verifyResult = await new Promise((resolve, reject) => {
        const options = {
          key,
          currency: plan.currency || 'INR',
          name: 'JuriNex',
          description: `${plan.name} Subscription`,
          image: 'https://www.nexintelai.com/assets/img/Ai%20logo-01.png',
          prefill: {
            name:    currentUser.name || currentUser.username || '',
            email:   currentUser.email || '',
            contact: currentUser.phone || '',
          },
          theme: { color: '#0D9488' },
          modal: {
            ondismiss:   () => reject(new Error('Payment cancelled by user.')),
            escape:      true,
            backdropclose: false,
          },
          notes: { plan_name: plan.name, user_id: String(currentUser.id) },
          handler: async (response) => {
            try {
              const verifyRes = await fetch(
                `${BACKEND_BASE_URL}/api/payments/monthly-plans/subscribe/verify`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storedToken}` },
                  body: JSON.stringify({
                    razorpay_payment_id:      response.razorpay_payment_id,
                    razorpay_subscription_id: response.razorpay_subscription_id ?? subscriptionId,
                    razorpay_order_id:        response.razorpay_order_id ?? orderId,
                    razorpay_signature:       response.razorpay_signature,
                    plan_id: plan.id,
                  }),
                }
              );
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.success) throw new Error(verifyData.message || 'Verification failed.');

              invalidateSecretsListCache();
              const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
              userInfo.plan            = verifyData.plan?.name || plan.name;
              userInfo.planId          = verifyData.plan?.id   || plan.id;
              userInfo.monthly_tokens  = verifyData.plan?.monthly_tokens ?? null;
              localStorage.setItem('userInfo', JSON.stringify(userInfo));
              window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));

              if (token && typeof fetchAndStorePlan === 'function') {
                fetchAndStorePlan(token).catch(() => {});
              }
              resolve(verifyData);
            } catch (vErr) { reject(vErr); }
          },
        };

        if (isSubscription && subscriptionId) {
          options.subscription_id = subscriptionId;
        } else if (orderId) {
          options.order_id = orderId;
          // Amount comes from the server-created order (price + GST computed on the backend);
          // Razorpay charges the order amount, so never derive it from the plan card.
          options.amount   = Number(startData.order?.amount) || Math.round(Number(plan.price) * 100);
          options.currency = startData.order?.currency || options.currency;
        } else {
          reject(new Error('No order or subscription ID returned from server.'));
          return;
        }

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (r) => reject(new Error(r.error?.description || 'Payment failed.')));
        rzp.open();
      });

      navigate('/billing-usage', { replace: true, state: { planActivated: verifyResult?.plan?.name || plan.name } });
    } catch (err) {
      if (err.message !== 'Payment cancelled by user.') {
        setError(err.message || 'Payment failed. Please try again.');
      }
    } finally {
      setProcessingId(null);
    }
  };

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          disabled={!!processingId}
          className="mb-8 flex items-center text-gray-500 hover:text-teal-700 transition-colors"
        >
          <ArrowLeftIcon className="h-5 w-5 mr-2" />
          Back
        </button>

        {/* Heading */}
        <div className="text-center mb-10">
          <h1 className="font-playfair text-3xl font-bold text-teal-700 sm:text-4xl">Choose Your Plan</h1>
          <p className="mx-auto mt-3 max-w-xl font-dmSans text-base text-gray-500">
            Select the perfect plan for your legal practice. All plans include our core AI features.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between">
            <span className="font-dmSans text-red-800 text-sm">{error}</span>
            <button onClick={fetchPlans} className="text-red-600 hover:text-red-500 text-sm font-medium ml-4">
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-20 text-center">
            <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-teal-600" />
            <p className="font-dmSans text-gray-500">Loading plans…</p>
          </div>
        )}

        {!loading && plans.length > 0 && (
          <>
            {/* ── Category tabs ───────────────────────────────────────────── */}
            <div className="flex justify-center mb-8">
              <div className="inline-flex rounded-xl bg-white border border-gray-200 shadow-sm p-1 gap-1">
                {['solo', 'firm'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-8 py-2.5 rounded-lg font-dmSans text-sm font-semibold transition-all duration-200 ${
                      activeCategory === cat
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-teal-700 hover:bg-teal-50'
                    }`}
                  >
                    {cat === 'solo' ? 'Solo' : 'Firm'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Billing period pills ─────────────────────────────────────── */}
            <div className="flex justify-center mb-10">
              <div className="inline-flex flex-wrap justify-center gap-2">
                {BILLING_PERIODS.filter(({ months }) => availableBillingMonths.has(months)).map(({ label, months }) => {
                  const active  = activeBillingMonths === months;
                  const savings = savingsLabel(months);
                  return (
                    <button
                      key={months}
                      onClick={() => setActiveBillingMonths(months)}
                      className={`relative flex flex-col items-center px-5 py-2 rounded-full border text-sm font-dmSans font-medium transition-all duration-200 ${
                        active
                          ? 'bg-teal-600 border-teal-600 text-white shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-teal-400 hover:text-teal-700'
                      }`}
                    >
                      <span>{label}</span>
                      {savings && (
                        <span className={`text-[10px] font-semibold leading-none mt-0.5 ${
                          active ? 'text-teal-100' : 'text-teal-500'
                        }`}>
                          {savings}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Plan cards ───────────────────────────────────────────────── */}
            {filteredPlans.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-dmSans text-gray-400 text-base">
                  No {activeCategory === 'solo' ? 'Solo' : 'Firm'} plans available for this billing period.
                </p>
              </div>
            ) : (
              <div className={`grid grid-cols-1 gap-6 ${
                filteredPlans.length === 1 ? 'max-w-sm mx-auto' :
                filteredPlans.length === 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto' :
                filteredPlans.length === 3 ? 'sm:grid-cols-3 max-w-4xl mx-auto' :
                'sm:grid-cols-2 lg:grid-cols-4'
              }`}>
                {filteredPlans.map((plan) => {
                  const isProcessing  = processingId === plan.id;
                  const isCurrent     = isCurrentPlan(plan);
                  const isDisabled    = !!processingId || isCurrent;
                  const priceDisplay  = fmt(plan.price, plan.currency);
                  const isEnterprise  = !priceDisplay || Number(plan.price) <= 0;

                  return (
                    <div
                      key={plan.id}
                      className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
                        isCurrent
                          ? 'border-teal-500 ring-2 ring-teal-400 shadow-[0_4px_24px_rgba(13,148,136,0.18)]'
                          : 'border-gray-200 hover:border-teal-300'
                      }`}
                    >
                      {/* Current badge */}
                      {isCurrent && (
                        <span className="absolute top-4 right-4 inline-flex items-center rounded-full bg-teal-50 border border-teal-200 px-3 py-0.5 text-xs font-semibold text-teal-700">
                          Current Plan
                        </span>
                      )}

                      {/* Name */}
                      <h2 className="font-playfair text-xl font-bold text-teal-700 mt-1">{plan.name}</h2>

                      {/* Description */}
                      {plan.description && (
                        <p className="mt-1.5 font-dmSans text-xs text-gray-500 leading-snug">
                          {plan.description}
                        </p>
                      )}

                      {/* Price */}
                      <div className="mt-5 pb-5 border-b border-gray-100">
                        {priceDisplay ? (
                          <div className="flex items-end gap-1">
                            <span className="font-playfair text-4xl font-bold text-gray-900">{priceDisplay}</span>
                            <span className="font-dmSans text-sm text-gray-400 mb-1">
                              {billingLabel(plan.billing_interval_months)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-dmSans text-sm italic text-gray-400">Contact us for pricing</span>
                        )}
                      </div>

                      {/* Token limits */}
                      <div className="mt-5 flex-1 space-y-3">
                        <TokenRow label="Monthly tokens" value={fmtTokens(plan.monthly_tokens)} highlight />
                        {plan.billing_interval_months > 1 && (
                          <TokenRow label="Billing interval" value={`${plan.billing_interval_months} months`} />
                        )}
                      </div>

                      {/* CTA */}
                      <button
                        onClick={() => handleSelectPlan(plan)}
                        disabled={isDisabled}
                        className={`mt-6 w-full rounded-xl py-3 font-dmSans text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                          isCurrent
                            ? 'bg-teal-50 border border-teal-200 text-teal-700 cursor-not-allowed'
                            : isDisabled
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-teal-600 hover:bg-teal-700 text-white shadow-sm hover:shadow-md'
                        }`}
                      >
                        {isProcessing ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                            Processing…
                          </span>
                        ) : isCurrent ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <CheckIcon className="h-4 w-4" />
                            Current Plan
                          </span>
                        ) : isEnterprise ? (
                          'Contact Us'
                        ) : (
                          'Select Plan'
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!loading && !error && plans.length === 0 && (
          <div className="py-16 text-center">
            <p className="mb-4 font-dmSans text-lg text-gray-500">No plans available right now.</p>
            <button onClick={fetchPlans} className="font-dmSans font-medium text-teal-700 hover:text-teal-600">
              Refresh
            </button>
          </div>
        )}

        {/* ── Top-up Plans (optional, collapsed by default) ──────── */}
        <TopupPlansSection />

        {/* Footer note */}
        <p className="mt-10 text-center font-dmSans text-xs text-gray-400">
          Payments are processed securely via Razorpay. Token limits reset at the start of each billing period.
        </p>
      </div>
    </div>
  );
}

// ─── Top-up Plans Section (collapsed by default) ────────────────────────────

function TopupPlansSection() {
  const { user } = useAuth();
  const [open, setOpen]               = useState(false);
  const [topupPlans, setTopupPlans]   = useState([]);
  const [fetched, setFetched]         = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError]   = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [successMsg, setSuccessMsg]   = useState(null);

  // Only fetch once when the user first expands the section
  const handleToggle = () => {
    setOpen((prev) => {
      if (!prev && !fetched) {
        setTopupLoading(true);
        const storedToken = localStorage.getItem('token');
        fetch(`${BACKEND_BASE_URL}/api/payments/topup-plans`, {
          headers: { 'Content-Type': 'application/json', ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}) },
          cache: 'no-store',
        })
          .then((r) => r.json())
          .then((data) => {
            if (!data.success) throw new Error(data.message || 'Failed to load top-up plans');
            setTopupPlans(data.data || []);
            setFetched(true);
          })
          .catch((err) => setTopupError(err.message))
          .finally(() => setTopupLoading(false));
      }
      return !prev;
    });
  };

  const handleBuyTopup = async (plan) => {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) { setTopupError('Please log in to continue.'); return; }

    const currentUser = (() => {
      for (const key of ['userInfo', 'user', 'userData']) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try { const p = JSON.parse(raw); const u = p.user || p.data || p; if (u?.id || u?.user_id) return u; } catch (_) {}
      }
      return user;
    })();
    const userId = currentUser?.id || currentUser?.user_id;
    if (!userId) { setTopupError('User info not found. Please log in again.'); return; }

    setProcessingId(plan.id);
    setTopupError(null);
    setSuccessMsg(null);

    try {
      const rzpLoaded = await loadRazorpay();
      if (!rzpLoaded) throw new Error('Payment gateway failed to load. Please refresh.');

      const orderRes = await fetch(`${BACKEND_BASE_URL}/api/payments/topup/order/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storedToken}` },
        body: JSON.stringify({ topup_plan_id: plan.id }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok || !orderData.success) throw new Error(orderData.message || 'Could not create order.');

      const { order, key } = orderData;

      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key,
          amount: order.amount,
          currency: order.currency,
          name: 'JuriNex',
          description: `${plan.name} — ${fmtTokens(plan.tokens)} tokens`,
          order_id: order.id,
          prefill: { email: currentUser?.email || '', name: currentUser?.name || currentUser?.username || '' },
          theme: { color: '#0D9488' },
          handler: async (response) => {
            try {
              const verifyRes = await fetch(`${BACKEND_BASE_URL}/api/payments/topup/order/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storedToken}` },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  topup_plan_id: plan.id,
                }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.success) throw new Error(verifyData.message || 'Verification failed.');
              setSuccessMsg(`${Number(plan.tokens).toLocaleString()} tokens added!`);
              resolve(verifyData);
            } catch (vErr) { reject(vErr); }
          },
          modal: { ondismiss: () => reject(new Error('Payment cancelled by user.')) },
        });
        rzp.on('payment.failed', (r) => reject(new Error(r.error?.description || 'Payment failed.')));
        rzp.open();
      });
    } catch (err) {
      if (err.message !== 'Payment cancelled by user.') setTopupError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="mt-12">
      {/* Toggle trigger — visually secondary, below the main plans */}
      <div className="flex items-center justify-center">
        <button
          onClick={handleToggle}
          className="group flex items-center gap-2 font-dmSans text-sm text-gray-400 hover:text-teal-600 transition-colors duration-200"
        >
          <span className={`inline-block transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
          {open ? 'Hide top-up packs' : 'Need extra tokens? View top-up packs'}
        </button>
      </div>

      {/* Collapsible panel */}
      {open && (
        <div className="mt-6 mx-auto max-w-2xl">

          {/* Loading */}
          {topupLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-teal-500" />
              <span className="font-dmSans text-sm">Loading packs…</span>
            </div>
          )}

          {/* Error */}
          {topupError && !topupLoading && (
            <p className="text-center font-dmSans text-sm text-red-500 py-4">{topupError}</p>
          )}

          {/* Success */}
          {successMsg && (
            <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-teal-50 border border-teal-200 px-4 py-2.5">
              <span className="text-teal-600 text-sm">✓</span>
              <span className="font-dmSans text-sm font-medium text-teal-700">{successMsg}</span>
            </div>
          )}

          {/* Plans list */}
          {!topupLoading && !topupError && topupPlans.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 bg-gray-50/60">
                <p className="font-dmSans text-xs text-gray-400 uppercase tracking-wide font-semibold">
                  One-time token packs · valid for duration shown
                </p>
              </div>
              {topupPlans.map((plan, idx) => {
                const isProcessing = processingId === plan.id;
                const validityDays = Number(plan.validity_days) || 0;
                const price = `${plan.currency === 'INR' ? '₹' : plan.currency}${Number(plan.price).toLocaleString('en-IN')}`;
                return (
                  <div
                    key={plan.id}
                    className={`flex items-center justify-between px-5 py-3.5 gap-4 transition-colors hover:bg-gray-50/60 ${
                      idx < topupPlans.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-dmSans text-sm font-semibold text-gray-700">{plan.name}</span>
                        <span className="font-dmSans text-xs text-teal-600 font-medium bg-teal-50 px-2 py-0.5 rounded-full">
                          {fmtTokens(plan.tokens)} tokens
                        </span>
                        {validityDays > 0 && (
                          <span className="font-dmSans text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            {validityDays}d validity
                          </span>
                        )}
                      </div>
                      {plan.description && (
                        <p className="font-dmSans text-xs text-gray-400 mt-0.5 truncate">{plan.description}</p>
                      )}
                    </div>

                    {/* Buy button */}
                    <button
                      onClick={() => handleBuyTopup(plan)}
                      disabled={!!processingId}
                      className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-dmSans text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
                    >
                      {isProcessing ? (
                        <>
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-b-2 border-white" />
                          <span>Processing…</span>
                        </>
                      ) : (
                        <>
                          <span className="text-white/70 font-normal text-xs">{price}</span>
                          <span className="text-white/40 text-xs">·</span>
                          <span>Buy</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!topupLoading && !topupError && topupPlans.length === 0 && fetched && (
            <p className="text-center font-dmSans text-sm text-gray-400 py-4">No top-up packs available right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TokenRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`font-semibold tabular-nums ${highlight ? 'text-teal-700' : 'text-gray-700'}`}>
        {value}
      </span>
    </div>
  );
}
