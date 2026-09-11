import { useRef, useState } from "react"
import { motion as Motion } from "framer-motion"
import PropTypes from "prop-types"
import Navbar from "../components/landing/Navbar"
import Footer from "../components/landing/Footer"
import PolicyModal from "../components/landing/PolicyModal"
import ChatbotWidget from "../components/landing/ChatbotWidget"
import BookDemoModal from "../components/landing/BookDemoModal"
import { Icon } from "../components/landing/primitives"
import { useDemoPrompt } from "../hooks/useDemoPrompt"
import { COMMUNITY_LINKS, CONTACT_INFO } from "../utils/landingConstants"
import { AUTH_SERVICE_URL } from "../config/apiConfig"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
}

const TOPICS = [
  { value: "demo", label: "Request a demo / walkthrough" },
  { value: "pricing", label: "Pricing & plans" },
  { value: "onboarding", label: "Onboarding & training" },
  { value: "data_security", label: "Data security & compliance" },
  { value: "partnership", label: "Partnership / enterprise" },
  { value: "support", label: "Existing customer support" },
  { value: "other", label: "Something else" },
]

const EXPECT = [
  "A reply from the Jurinex team within one working day",
  "A walkthrough on your own matters, if you want one",
  "Pricing, onboarding and data-security questions answered",
]

const DIRECT = [
  {
    eyebrow: "General enquiries",
    icon: "Mail",
    title: "Email",
    accent: "us",
    value: CONTACT_INFO.email,
    href: `mailto:${CONTACT_INFO.email}`,
    text: "Sales, partnerships, product questions and press. Everything lands with the team.",
    cta: "Send mail",
  },
  {
    eyebrow: "Speak to someone",
    icon: "Phone",
    title: "Call",
    accent: "us",
    value: CONTACT_INFO.phone,
    href: `tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`,
    text: "India business hours, Monday to Friday, 9 AM to 6 PM IST.",
    cta: "Call now",
  },
  {
    eyebrow: "Existing customers",
    icon: "MessageCircle",
    title: "Message on",
    accent: "WhatsApp",
    href: COMMUNITY_LINKS.whatsapp,
    text: "Product updates, drafting tips and a direct line for account and billing help.",
    cta: "Open WhatsApp",
    external: true,
  },
]

const EMPTY = {
  firstName: "",
  surname: "",
  email: "",
  mobile: "",
  website: "",
  organisation: "",
  topic: "",
  details: "",
}

const FIELD =
  "w-full rounded-lg border border-nx-line bg-white px-4 py-3 text-sm text-nx-ink placeholder:text-nx-faint transition-colors focus:border-nx-ink focus:outline-none"
const LABEL = "block text-[13px] font-medium text-nx-ink"

/** "01 · SEND A MESSAGE" marker over a hairline. */
const SectionMark = ({ n, children }) => (
  <p className="border-b border-nx-line pb-4 font-mono text-[11px] uppercase tracking-[0.28em] text-nx-faint">
    <span className="text-nx-teal">{n}</span> · {children}
  </p>
)

SectionMark.propTypes = { n: PropTypes.string.isRequired, children: PropTypes.node }

const Field = ({ id, label, optional, children }) => (
  <div>
    <label htmlFor={id} className={LABEL}>
      {label}
      {optional ? <span className="ml-1 font-normal text-nx-faint">(optional)</span> : null}
    </label>
    <div className="mt-1.5">{children}</div>
  </div>
)

Field.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  optional: PropTypes.bool,
  children: PropTypes.node,
}

/**
 * /contact: contact details on the left, an enquiry form on the right.
 * The "agree" checkbox opens the Consent & Communication policy; it
 * only ticks when the reader presses Accept inside the popup.
 */
const ContactPage = ({ onNavigateLogin, onSectionNav }) => {
  const [demoOpen, setDemoOpen] = useState(false)
  useDemoPrompt(setDemoOpen)
  const [policyKey, setPolicyKey] = useState(null)

  const [form, setForm] = useState(EMPTY)
  const [agreed, setAgreed] = useState(false)
  const [termsForAgree, setTermsForAgree] = useState(false)
  const [tried, setTried] = useState(false)
  const [sent, setSent] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const submittingRef = useRef(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const missing = {
    firstName: !form.firstName.trim(),
    surname: !form.surname.trim(),
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()),
    mobile: !/^[0-9]{10}$/.test(form.mobile),
  }
  const invalid = Object.values(missing).some(Boolean)
  const err = (key) => tried && missing[key]

  const openTermsToAgree = () => {
    setTermsForAgree(true)
    setPolicyKey("consent")
  }
  const closePolicy = () => {
    setPolicyKey(null)
    setTermsForAgree(false)
  }
  const acceptTerms = () => {
    setAgreed(true)
    closePolicy()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (submittingRef.current) return
    setTried(true)
    setSubmitError("")
    if (invalid) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = await fetch(`${AUTH_SERVICE_URL.replace(/\/$/, "")}/api/auth/contact-enquiries`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.firstName.trim(),
          last_name: form.surname.trim(),
          email: form.email.trim(),
          country_code: "+91",
          mobile_number: form.mobile.trim(),
          organisation_name: form.organisation.trim(),
          topic: form.topic || "other",
          message: form.details.trim(),
          marketing_consent: agreed,
          page_url: window.location.href,
          website: form.website,
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) {
        const errors = Object.values(result?.errors || {}).filter((value) => typeof value === "string")
        throw new Error(errors.join(". ") || result?.message || "We could not send your enquiry. Please try again.")
      }
      setSent(result)
    } catch (error) {
      setSubmitError(error instanceof TypeError
        ? "Unable to connect. Please check your connection and try again."
        : error.message || "We could not send your enquiry. Please try again.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const reset = () => {
    setForm(EMPTY)
    setAgreed(false)
    setTried(false)
    setSent(null)
    setSubmitError("")
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar solid onRequestDemo={() => setDemoOpen(true)} onLogin={onNavigateLogin} onSectionNav={onSectionNav} />

      <main className="pt-20">
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-12 sm:px-10 sm:pt-16">

        <SectionMark n="01">Send a message</SectionMark>

        <div className="mt-12 grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Right: what to expect, and the details */}
          <Motion.aside
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="order-1 lg:col-span-5 lg:pt-2"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-nx-faint">Contact us</p>
            <h1 className="mt-4 font-editorial text-[2.4rem] font-normal leading-[1.05] tracking-[-0.02em] text-nx-ink sm:text-[2.75rem] [&_em]:italic [&_em]:text-nx-teal-deep">
              We&apos;d like to <em>hear from you.</em>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-[1.7] text-nx-muted">
              Tell us a little about your practice and what you need. A person from the Jurinex team
              replies, not an auto-responder.
            </p>

            <ul className="mt-8 space-y-1">
              {EXPECT.map((item) => (
                <li key={item} className="flex items-start gap-3 py-2 text-[15px] text-nx-ink">
                  <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-teal-50 text-nx-teal">
                    <Icon name="Check" className="h-3 w-3" strokeWidth={2.8} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <dl className="mt-10 space-y-5">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-nx-faint">Our office</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-nx-ink">
                  <span className="font-medium">{CONTACT_INFO.company}</span>
                  {CONTACT_INFO.addressLines.map((line) => (
                    <span key={line} className="block text-nx-muted">
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-12 gap-y-5">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-nx-faint">Phone</dt>
                  <dd className="mt-1.5 whitespace-nowrap font-editorial text-lg italic text-nx-ink">
                    <a href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`} className="hover:text-nx-teal-deep">
                      {CONTACT_INFO.phone}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-nx-faint">Email</dt>
                  <dd className="mt-1.5 font-editorial text-lg italic text-nx-ink">
                    <a href={`mailto:${CONTACT_INFO.email}`} className="hover:text-nx-teal-deep">
                      {CONTACT_INFO.email}
                    </a>
                  </dd>
                </div>
              </div>
            </dl>

          </Motion.aside>

          {/* Left: enquiry form */}
          <Motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="order-2 lg:col-span-6 lg:col-start-7 lg:-mr-10 xl:-mr-16"
          >
            <div className="rounded-2xl border border-nx-line bg-nx-pale/40 p-6 sm:p-10">
              {sent ? (
                <div className="py-10 text-center" role="status">
                  <span className="inline-flex h-14 w-14 items-center justify-center border border-nx-teal text-nx-teal">
                    <Icon name="CircleCheck" className="h-7 w-7" />
                  </span>
                  <h2 className="mt-5 font-display text-2xl font-semibold text-nx-ink">
                    Thanks, {form.firstName.trim()}. We&apos;ve got your message.
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-nx-muted">
                    {sent.message}
                  </p>
                  {sent.enquiry?.reference_no && (
                    <p className="mt-3 text-sm font-medium text-nx-ink">Reference: {sent.enquiry.reference_no}</p>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-nx-teal-deep hover:text-nx-teal-ink"
                  >
                    Send another message
                    <Icon name="ArrowRight" className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} noValidate aria-busy={submitting}>
                  <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
                  <div hidden aria-hidden="true">
                    <label htmlFor="c-website">Website</label>
                    <input id="c-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                  </div>
                  <h2 className="font-display text-2xl font-semibold text-nx-ink">Contact Jurinex</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-nx-muted">
                    Our team can walk you through the platform on your own matters.
                  </p>

                  <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field id="c-first" label="Name *">
                      <input
                        id="c-first"
                          maxLength={100}
                        type="text"
                        autoComplete="given-name"
                        value={form.firstName}
                        onChange={set("firstName")}
                        aria-invalid={err("firstName")}
                        className={`${FIELD} ${err("firstName") ? "border-red-400" : ""}`}
                      />
                    </Field>
                    <Field id="c-surname" label="Surname *">
                      <input
                        id="c-surname"
                          maxLength={100}
                        type="text"
                        autoComplete="family-name"
                        value={form.surname}
                        onChange={set("surname")}
                        aria-invalid={err("surname")}
                        className={`${FIELD} ${err("surname") ? "border-red-400" : ""}`}
                      />
                    </Field>
                    <Field id="c-email" label="Email *">
                      <input
                        id="c-email"
                          maxLength={255}
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={set("email")}
                        aria-invalid={err("email")}
                        className={`${FIELD} ${err("email") ? "border-red-400" : ""}`}
                      />
                    </Field>
                    <Field id="c-mobile" label="Mobile number *">
                      <div className={`flex min-w-0 items-center overflow-hidden rounded-lg border bg-white transition-colors focus-within:border-nx-ink ${err("mobile") ? "border-red-400" : "border-nx-line"}`}>
                        <span aria-label="India country code +91" className="w-16 flex-none px-3 py-3 text-sm text-nx-ink">
                          +91
                        </span>
                        <span aria-hidden="true" className="h-5 w-px flex-none bg-nx-line" />
                        <input
                          id="c-mobile"
                          maxLength={10}
                          pattern="[0-9]{10}"
                          required
                          type="tel"
                          autoComplete="tel-national"
                          inputMode="numeric"
                          value={form.mobile}
                          onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))}
                          aria-invalid={err("mobile")}
                          aria-describedby={err("mobile") ? "c-mobile-error" : undefined}
                          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-sm text-nx-ink placeholder:text-nx-faint focus:outline-none focus:ring-0"
                        />
                      </div>
                      {err("mobile") && (
                        <p id="c-mobile-error" className="mt-1.5 text-xs text-red-600" role="alert">
                          Enter a 10-digit mobile number.
                        </p>
                      )}
                    </Field>
                    <div className="sm:col-span-2">
                      <Field id="c-org" label="Organisation name" optional>
                        <input
                          id="c-org"
                          maxLength={255}
                          type="text"
                          autoComplete="organization"
                          value={form.organisation}
                          onChange={set("organisation")}
                          className={FIELD}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field id="c-topic" label="What is this about?" optional>
                        <div className="relative">
                          <select
                            id="c-topic"
                            value={form.topic}
                            onChange={set("topic")}
                            className={`${FIELD} appearance-none pr-10 ${form.topic ? "" : "text-nx-faint"}`}
                          >
                            <option value="" disabled>
                              Choose one
                            </option>
                            {TOPICS.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <Icon
                            name="ChevronDown"
                            className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-nx-faint"
                          />
                        </div>
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field id="c-details" label="Additional details" optional>
                        <textarea
                          id="c-details"
                          maxLength={5000}
                          rows={4}
                          value={form.details}
                          onChange={set("details")}
                          className={`${FIELD} resize-y`}
                        />
                      </Field>
                    </div>
                  </div>

                  {/* Consent: opens the policy; ticks only on Accept */}
                  <div className="mt-6 rounded-lg border border-nx-line bg-white p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => {
                          if (e.target.checked) openTermsToAgree()
                          else setAgreed(false)
                        }}
                        className="mt-0.5 h-4 w-4 flex-none cursor-pointer rounded border-nx-line text-nx-teal focus:ring-nx-teal"
                      />
                      <span className="text-sm leading-relaxed text-nx-ink">
                        (Optional) I agree to receive promotional calls, SMS, WhatsApp messages and emails from NexIntel AI
                        Pvt. Ltd., as set out in the{" "}
                        <button
                          type="button"
                          onClick={openTermsToAgree}
                          className="font-semibold text-nx-teal-deep underline decoration-nx-teal/40 underline-offset-2 hover:text-nx-teal-ink"
                        >
                          Consent &amp; Communication Policy
                        </button>
                        .
                        {agreed ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-nx-teal">
                            <Icon name="Check" className="h-3.5 w-3.5" strokeWidth={2.6} />
                            Accepted
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </div>

                  {tried && invalid && (
                    <p className="mt-4 text-sm text-red-600" role="alert">
                      Please fill in the highlighted fields.
                    </p>
                  )}

                  {submitError && <p className="mt-4 text-sm text-red-600" role="alert">{submitError}</p>}

                  <button
                    disabled={submitting}
                    type="submit"
                    className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-nx-teal px-8 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-nx-teal-deep"
                  >
                    {submitting ? "Sending…" : "Submit"}
                  </button>
                  <p className="mt-3 text-xs text-nx-faint">
                    Required fields are marked with *. Promotional communications are optional.
                  </p>
                  </fieldset>
                </form>
              )}
            </div>
          </Motion.div>
        </div>
        </div>

        {/* 02 · Reach us directly */}
        <section className="bg-nx-pale" aria-labelledby="direct-heading">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:px-10 sm:py-24">
            <SectionMark n="02">Email or phone</SectionMark>
            <h2
              id="direct-heading"
              className="mt-12 font-editorial text-[2.9rem] font-normal leading-[1.02] tracking-[-0.02em] text-nx-ink sm:text-6xl [&_em]:italic [&_em]:text-nx-teal-deep"
            >
              Reach us <em>directly.</em>
            </h2>
            <p className="mt-8 font-editorial text-xl italic leading-relaxed text-nx-muted sm:text-2xl">
              If you&apos;d rather skip the form. Each channel lands with the right person.
            </p>

            <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-3">
              {DIRECT.map((ch) => (
                <a
                  key={ch.title + ch.accent}
                  href={ch.href}
                  target={ch.external ? "_blank" : undefined}
                  rel={ch.external ? "noopener noreferrer" : undefined}
                  className="group flex flex-col items-center text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-nx-line bg-white text-nx-teal shadow-[0_1px_2px_rgba(16,20,19,0.04)] transition-all group-hover:-translate-y-0.5 group-hover:border-nx-teal/50 group-hover:shadow-[0_10px_24px_-14px_rgba(6,52,44,0.35)]">
                    <Icon name={ch.icon} className="h-5 w-5" />
                  </span>
                  <span className="mt-4 font-editorial text-xl text-nx-ink">
                    {ch.title} <em className="italic text-nx-teal-deep">{ch.accent}</em>
                  </span>
                  {ch.value ? (
                    <span className="mt-1 font-editorial text-base italic text-nx-ink">{ch.value}</span>
                  ) : null}
                  <span className="mt-2 max-w-[17rem] text-[14px] leading-relaxed text-nx-muted">{ch.text}</span>
                  <span className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-nx-teal-deep">
                    {ch.cta}
                    <Icon name="ArrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer onOpenPolicy={setPolicyKey} onRequestDemo={() => setDemoOpen(true)} />

      {policyKey && (
        <PolicyModal
          policyKey={policyKey}
          onClose={closePolicy}
          onAccept={termsForAgree ? acceptTerms : undefined}
        />
      )}

      <BookDemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
      <ChatbotWidget />
    </div>
  )
}

ContactPage.propTypes = {
  onNavigateLogin: PropTypes.func,
  onSectionNav: PropTypes.func,
}

export default ContactPage
