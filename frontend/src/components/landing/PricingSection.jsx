import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { motion as Motion } from "framer-motion"
import { PAYMENT_SERVICE_URL } from "../../config/apiConfig"
import apiService from "../../services/api"
import { buildPlanLimitSections, toDisplayString } from "../../utils/planDisplayConfig"
import { PLAN_FEATURES } from "../../utils/landingConstants"
import PlanLimitsDisplay from "../PlanLimitsDisplay"

/**
 * Subscription tiers as published on jurinex.ai. Every plan includes the
 * same PLAN_FEATURES; tiers differ by seats. Checkout resolves the real
 * backend plan from the payment-service catalog by name hints.
 */
const PLANS = [
  {
    id: "lite",
    name: "Jurinex Lite",
    description: "1 user",
    monthlyPrice: "₹3,100",
    monthlyPeriod: "/month",
    badge: "Limited time offer",
    features: PLAN_FEATURES,
    cta: "Start Free Trial",
  },
  {
    id: "plus",
    name: "Jurinex Plus",
    description: "Up to 3 users",
    monthlyPrice: "₹5,100",
    monthlyPeriod: "/month",
    badge: null,
    features: PLAN_FEATURES,
    cta: "Start Free Trial",
  },
  {
    id: "pro",
    name: "Jurinex Pro",
    description: "Up to 5 users",
    monthlyPrice: "₹7,500",
    monthlyPeriod: "/month",
    badge: null,
    features: PLAN_FEATURES,
    cta: "Start Free Trial",
  },
]

/** Backend catalog name hints per UI tier (new names first, legacy fallbacks after). */
const NAME_HINTS = {
  lite: ["jurinex lite", "lite", "sololite", "solo lite", "starter", "basic", "solo lawyer", "solo", "free"],
  plus: ["jurinex plus", "plus", "law firm", "lawfirm", "team", "business"],
  pro: ["jurinex pro", "pro", "enterprise"],
}

const MONTHLY_INTERVALS = ["month", "monthly"]

const PricingSection = ({ onNavigateLogin, onNavigateContact }) => {
  const [plansCatalog, setPlansCatalog] = useState([])
  const [processingPlanId, setProcessingPlanId] = useState(null)
  const [paymentError, setPaymentError] = useState("")

  useEffect(() => {
    let mounted = true
    const loadPlans = async () => {
      try {
        const response = await apiService.getPublicPlans()
        if (!mounted) return
        const list = Array.isArray(response?.data) ? response.data : []
        setPlansCatalog(list)
      } catch {
        if (!mounted) return
        setPlansCatalog([])
      }
    }
    loadPlans()
    return () => {
      mounted = false
    }
  }, [])

  const getCurrentUser = () => {
    const candidates = ["userInfo", "user", "userData", "authUser"]
    for (const key of candidates) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.id) return parsed
        if (parsed?.user?.id) return parsed.user
        if (parsed?.data?.id) return parsed.data
      } catch {
        // Ignore invalid JSON blobs and keep scanning fallback keys.
      }
    }
    return null
  }

  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      if (window.Razorpay || document.getElementById("razorpay-script")) {
        resolve(true)
        return
      }
      const script = document.createElement("script")
      script.id = "razorpay-script"
      script.src = "https://checkout.razorpay.com/v1/checkout.js"
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.body.appendChild(script)
    })

  const resolveBackendPlanForCard = (uiPlan) => {
    const hints = NAME_HINTS[uiPlan.id] || [uiPlan.name.toLowerCase()]
    const activePlans = plansCatalog.filter((p) => p?.is_active !== false)
    const matchingInterval = activePlans.filter((plan) =>
      MONTHLY_INTERVALS.includes(String(plan?.interval || "").toLowerCase())
    )
    return (
      matchingInterval.find((plan) =>
        hints.some((hint) => String(plan?.name || "").toLowerCase().includes(hint))
      ) ||
      activePlans.find((plan) =>
        hints.some((hint) => String(plan?.name || "").toLowerCase().includes(hint))
      ) ||
      null
    )
  }

  const resolvePlanIdForCheckout = (uiPlan) => resolveBackendPlanForCard(uiPlan)?.id || null

  const handlePlanCheckout = async (uiPlan) => {
    setPaymentError("")

    const token = localStorage.getItem("token")
    if (!token) {
      const pendingUpgradePlan = {
        planId: uiPlan.id,
        planName: uiPlan.name,
        billing: "monthly",
      }
      localStorage.setItem("pendingUpgradeCheckout", JSON.stringify(pendingUpgradePlan))
      setPaymentError("Please log in to continue with subscription payment.")
      onNavigateLogin?.({
        from: "/subscription-plans",
        pendingUpgradePlan,
      })
      return
    }

    const currentUser = getCurrentUser()
    if (!currentUser?.id) {
      setPaymentError("User session not found. Please log in again.")
      onNavigateLogin?.()
      return
    }

    const backendPlanId = resolvePlanIdForCheckout(uiPlan)
    if (!backendPlanId) {
      setPaymentError("No matching payment plan found. Please contact support.")
      return
    }

    setProcessingPlanId(uiPlan.id)
    try {
      const loaded = await loadRazorpayScript()
      if (!loaded) throw new Error("Razorpay checkout failed to load.")

      const startRes = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/subscription/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-User-ID": String(currentUser.id),
        },
        body: JSON.stringify({ plan_id: backendPlanId }),
      })
      if (!startRes.ok) throw new Error("Failed to start subscription.")
      const startData = await startRes.json()
      if (!startData?.success || !startData?.subscription?.id || !startData?.subscription?.key) {
        throw new Error(startData?.message || "Invalid subscription response.")
      }

      const options = {
        key: startData.subscription.key,
        subscription_id: startData.subscription.id,
        name: "NexintelAI Subscriptions",
        description: `${uiPlan.name} Subscription`,
        prefill: {
          name: currentUser?.name || currentUser?.username || "",
          email: currentUser?.email || "",
          contact: currentUser?.phone || currentUser?.contact || "",
        },
        theme: { color: "#0D9488" },
        handler: async (response) => {
          try {
            const verifyRes = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/subscription/verify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature,
              }),
            })
            const verifyData = await verifyRes.json()
            if (!verifyRes.ok || !verifyData?.success) {
              throw new Error(verifyData?.message || "Payment verification failed.")
            }
            alert("Payment successful. Subscription activated.")
            setProcessingPlanId(null)
          } catch (err) {
            setPaymentError(err.message || "Payment verification failed.")
            setProcessingPlanId(null)
          }
        },
        modal: {
          ondismiss: () => setProcessingPlanId(null),
        },
      }

      const instance = new window.Razorpay(options)
      instance.on("payment.failed", (failed) => {
        setPaymentError(
          toDisplayString(failed?.error?.description, "Payment failed. Please try again.")
        )
        setProcessingPlanId(null)
      })
      instance.open()
    } catch (error) {
      setPaymentError(error.message || "Payment initiation failed.")
      setProcessingPlanId(null)
    }
  }

  return (
    <section
      id="pricing"
      className="scroll-mt-20 bg-nx-pale py-20 sm:py-28"
      aria-labelledby="pricing-heading"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Header */}
        <Motion.div
          className="text-center"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">
            Pricing
          </p>
          <h2
            id="pricing-heading"
            className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
          >
            Subscription Plans
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-nx-muted">
            Start your 7-day free trial today. Every plan includes the full platform —
            tiers scale with your team.
          </p>
        </Motion.div>

        {/* Cards */}
        <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
          {PLANS.map((plan, i) => {
            const isProcessing = processingPlanId === plan.id
            const backendPlan = resolveBackendPlanForCard(plan)
            const planLimitSections = backendPlan
              ? buildPlanLimitSections(backendPlan)
              : { marketing: plan.features, sections: [] }

            return (
              <Motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="group relative flex flex-col rounded-2xl border border-nx-ink/75 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-nx-teal hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.25)]"
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-nx-teal px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow">
                    {plan.badge}
                  </span>
                )}

                {/* Plan name */}
                <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-nx-faint">
                  {plan.name}
                </p>

                {/* Price */}
                <div className="mt-4 flex items-end justify-center gap-1">
                  <span className="font-display text-4xl font-semibold text-nx-ink">
                    {plan.monthlyPrice}
                  </span>
                  <span className="mb-1 text-sm text-nx-muted">{plan.monthlyPeriod}</span>
                </div>
                <p className="mt-1.5 text-center text-xs text-nx-muted">
                  ({toDisplayString(plan.description, "")})
                </p>

                {/* CTA */}
                <button
                  type="button"
                  onClick={() => handlePlanCheckout(plan)}
                  disabled={isProcessing}
                  className="mt-5 w-full rounded-lg border border-nx-teal bg-white py-2.5 text-sm font-semibold text-nx-teal transition-all duration-300 active:scale-[0.98] group-hover:bg-nx-teal group-hover:text-white"
                >
                  {isProcessing ? "Processing..." : plan.cta}
                </button>

                {/* Divider */}
                <hr className="my-5 border-nx-line" />

                {/* Included features (as published on jurinex.ai) */}
                <ul className="space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[13px] text-nx-ink">
                      <svg
                        className="mt-0.5 h-4 w-4 flex-none text-nx-teal"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3.5 8.5l3 3 6-6"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Backend-configured limits, when the catalog is reachable */}
                {backendPlan && (
                  <div className="mt-5 border-t border-nx-line pt-4">
                    <PlanLimitsDisplay
                      plan={backendPlan}
                      planLimitSections={planLimitSections}
                    />
                  </div>
                )}
              </Motion.div>
            )
          })}
        </div>

        {paymentError && (
          <p className="mt-8 text-center text-sm text-red-600">
            {toDisplayString(paymentError, "")}
          </p>
        )}

        {/* Enterprise / custom */}
        <div className="mx-auto mt-10 flex max-w-5xl flex-col items-center justify-between gap-4 rounded-2xl border border-nx-ink/75 bg-white px-7 py-6 sm:flex-row">
          <p className="text-sm text-nx-muted">
            <span className="font-semibold text-nx-ink">Need more than 5 seats</span> or a
            custom enterprise setup? We'll tailor a plan to your firm.
          </p>
          <button
            type="button"
            onClick={() => onNavigateContact?.()}
            className="flex-none rounded-lg bg-nx-teal px-7 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all hover:bg-nx-teal-deep active:scale-[0.98]"
          >
            Contact Us
          </button>
        </div>
      </div>
    </section>
  )
}

export default PricingSection

PricingSection.propTypes = {
  onNavigateLogin: PropTypes.func,
  onNavigateContact: PropTypes.func,
}
