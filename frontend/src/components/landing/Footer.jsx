import { useRef, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { CONTACT_INFO, FOOTER_COLUMNS, NEWSLETTER_COPY, SOCIAL_LINKS } from "../../utils/landingConstants"
import { Icon } from "./primitives"
import BrandLogo from "./BrandLogo"
import SocialIcon from "./SocialIcon"
import wordmark from "../../assets/jurinex-wordmark.png"
import { AUTH_SERVICE_URL } from "../../config/apiConfig"


/**
 * Editorial enterprise footer — monospace eyebrow labels, serif display
 * headline, hairline-divided sections and a giant faded brand lockup
 * above the bottom bar. Full company record from jurinex.ai (columns,
 * legal documents, social profiles, statutory identifiers). Anchor links
 * scroll in place on the landing page and route home (with a scroll
 * target) from other pages; policy links open PolicyModal.
 */
const Footer = ({ onOpenPolicy, onGetInTouch, onRequestDemo }) => {
  const navigate = useNavigate()
  const year = new Date().getFullYear()
  const [email, setEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [subscribeError, setSubscribeError] = useState("")
  const [emailError, setEmailError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const subscribe = async (e) => {
    e.preventDefault()
    if (submittingRef.current) return
    setSubscribeError("")
    setEmailError(false)
    const trimmedEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setEmailError(true)
      setSubscribeError("Enter a valid email address")
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = await fetch(`${AUTH_SERVICE_URL.replace(/\/$/, "")}/api/auth/newsletter-subscribers`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          source: "website_footer",
          page_url: window.location.href,
          website: "",
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) {
        setEmailError(Boolean(result?.errors?.email))
        throw new Error(result?.errors?.email || result?.message || "We could not save your subscription. Please try again.")
      }
      setSuccessMessage(result.message || (result.already_subscribed
        ? "This email is already on the newsletter list."
        : NEWSLETTER_COPY.thanks))
      setSubscribed(true)
    } catch (error) {
      setSubscribeError(error instanceof TypeError
        ? "Unable to connect. Please check your connection and try again."
        : error.message || "We could not save your subscription. Please try again.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const followLink = (link) => {
    if (link.type === "policy") {
      onOpenPolicy?.(link.href)
      return
    }
    if (link.type === "route") {
      navigate(link.href)
      return
    }
    if (link.type === "demo") {
      if (onRequestDemo) onRequestDemo()
      else navigate("/contact")
      return
    }
    if (link.type === "external") {
      window.open(link.href, "_blank", "noopener,noreferrer")
      return
    }
    // anchor
    const id = link.href.replace("#", "")
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: "smooth" })
    else navigate("/", { state: { scrollTo: id } })
  }

  return (
    <footer
      className="overflow-hidden rounded-t-[3.5rem] border border-b-0 border-nx-line bg-[#fbfbfa] shadow-[0_-16px_48px_-28px_rgba(6,52,44,0.3)] sm:rounded-t-[5rem]"
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>

      {/* Get in touch + newsletter, one teal band */}
      <div className="bg-nx-forest">
        <div className="mx-auto max-w-7xl px-5 pb-12 pt-16 sm:px-8">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-md">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">
                Get in touch
              </p>
              <p className="mt-4 font-display text-3xl text-white">
                Have a question or a <em className="text-nx-mint">use case</em> in mind?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/85">
                Tell us how your practice works — we'll show you where Jurinex fits.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (onGetInTouch ? onGetInTouch() : navigate("/contact"))}
              className="inline-flex flex-none items-center gap-3 rounded-lg bg-white px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-nx-teal-deep transition-colors hover:bg-teal-50"
            >
              Get in touch
              <Icon name="ArrowRight" className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Newsletter, inset within the same band */}
          <div className="mt-12 flex flex-col gap-5 rounded-2xl border border-white/15 bg-nx-teal-ink/70 px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:flex-row md:items-center md:justify-between">
            <div className="max-w-md">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="Mail" className="h-4 w-4 text-nx-mint" />
                {NEWSLETTER_COPY.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/80">{NEWSLETTER_COPY.text}</p>
            </div>
            {subscribed ? (
              <div className="flex w-full max-w-md flex-col items-start gap-3">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-white" role="status">
                <Icon name="CircleCheck" className="h-5 w-5 text-nx-mint" />
                {successMessage}
              </p>
              <button
                type="button"
                onClick={() => {
                  setEmail("")
                  setSuccessMessage("")
                  setSubscribeError("")
                  setEmailError(false)
                  setSubscribed(false)
                  requestAnimationFrame(() => document.getElementById("footer-newsletter-email")?.focus())
                }}
                className="rounded-sm text-sm font-semibold text-white underline underline-offset-4 hover:text-nx-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Subscribe another email
              </button>
              </div>
            ) : (
              <form onSubmit={subscribe} noValidate aria-busy={submitting} className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap">
                <label htmlFor="footer-newsletter-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="footer-newsletter-email"
                  type="email"
                  required
                  maxLength={255}
                  autoComplete="email"
                  disabled={submitting}
                  aria-invalid={emailError}
                  aria-describedby={subscribeError ? "footer-newsletter-error" : undefined}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setEmailError(false)
                    setSubscribeError("")
                  }}
                  placeholder={NEWSLETTER_COPY.placeholder}
                  className="min-w-0 flex-1 rounded-lg border border-white/30 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 focus:border-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex flex-none items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-nx-teal-deep transition-colors hover:bg-teal-50"
                >
                  {submitting ? "Subscribing…" : NEWSLETTER_COPY.button}
                  <Icon name="ArrowRight" className="h-3.5 w-3.5" />
                </button>
                {subscribeError && (
                  <p id="footer-newsletter-error" role="alert" className="w-full text-sm text-white">
                    {subscribeError}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Main columns */}
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-1 gap-12 pt-14 lg:grid-cols-[1.3fr_2.7fr]">
          {/* Brand + contact + statutory record */}
          <div>
            <BrandLogo size="lg" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-nx-muted">
              {CONTACT_INFO.tagline}
            </p>
            <address className="mt-7 space-y-1 text-sm not-italic leading-relaxed text-nx-muted">
              {CONTACT_INFO.addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="pt-2">
                <a
                  href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`}
                  className="transition-colors hover:text-nx-teal-deep"
                >
                  {CONTACT_INFO.phone}
                </a>
              </p>
              <p>
                <a
                  href={`mailto:${CONTACT_INFO.email}`}
                  className="font-medium text-nx-teal-deep transition-colors hover:text-nx-teal-ink"
                >
                  {CONTACT_INFO.email}
                </a>
              </p>
            </address>

            {/* Social */}
            <div className="mt-7">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                Follow Jurinex
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Jurinex on ${social.label}`}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-nx-line text-nx-muted transition-colors hover:border-nx-teal-deep hover:text-nx-teal-deep"
                  >
                    <SocialIcon icon={social.icon} />
                  </a>
                ))}
              </div>
            </div>

            {/* Statutory identifiers */}
            <div className="mt-8 space-y-1.5 font-mono text-xs leading-relaxed text-nx-faint">
              <p className="font-semibold text-nx-ink">{CONTACT_INFO.company}</p>
              <p>
                <span className="text-nx-muted">CIN:</span> {CONTACT_INFO.cin}
              </p>
              <p>
                <span className="text-nx-muted">GSTIN:</span> {CONTACT_INFO.gstin}
              </p>
              <p>
                <span className="text-nx-muted">Registered Office:</span>{" "}
                {CONTACT_INFO.registeredOffice}
              </p>
            </div>
          </div>

          {/* Link columns */}
          <nav
            className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-5"
            aria-label="Footer"
          >
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                  {column.heading}
                </p>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={`${column.heading}-${link.title}`}>
                      <button
                        type="button"
                        onClick={() => followLink(link)}
                        className="text-left text-sm text-nx-muted transition-colors hover:text-nx-ink"
                      >
                        {link.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Giant brand lockup — the same artwork as the header */}
        <div
          aria-hidden="true"
          className="mt-16 flex select-none justify-center overflow-hidden border-t border-nx-line py-10"
        >
          <img
            src={wordmark}
            alt=""
            className="h-[clamp(3rem,9vw,8rem)] w-auto"
            loading="lazy"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-nx-line py-7 sm:flex-row sm:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
              © {year} {CONTACT_INFO.company}
            </p>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-nx-faint/80">
              {CONTACT_INFO.incorporation}
            </p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
            All rights reserved
          </p>
        </div>
      </div>
    </footer>
  )
}

Footer.propTypes = {
  onOpenPolicy: PropTypes.func,
  onGetInTouch: PropTypes.func,
  onRequestDemo: PropTypes.func,
}

export default Footer
