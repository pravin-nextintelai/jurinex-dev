import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { CTA_COPY } from "../../utils/landingConstants"
import { Icon, Reveal } from "./primitives"

/**
 * Final conversion section. "Start for Free" creates an account;
 * "Talk to Us" opens the demo-booking modal (real contact flow).
 */
const CTASection = ({ onBookDemo } = {}) => {
  const navigate = useNavigate()

  return (
    <section className="bg-white px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="cta-heading">
      <Reveal y={28}>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-nx-forest px-7 py-16 text-center sm:px-16 sm:py-20">
          {/* Ambient glows */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 60% 70% at 50% 0%, rgba(13,148,136,0.28), transparent 60%), radial-gradient(ellipse 45% 45% at 85% 100%, rgba(15,118,110,0.2), transparent 65%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent"
            aria-hidden="true"
          />

          <div className="relative">
            <h2
              id="cta-heading"
              className="mx-auto max-w-2xl font-display text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]"
            >
              {CTA_COPY.heading}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/90">
              {CTA_COPY.text}
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3.5 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate("/register")}
                aria-label="Create a free Jurinex account"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-nx-ink shadow-lg transition-all duration-200 hover:bg-teal-50 active:scale-[0.98]"
              >
                {CTA_COPY.primary}
                <Icon name="ArrowRight" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onBookDemo}
                aria-label="Book a demo with the Jurinex team"
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 bg-transparent px-8 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-white/10 active:scale-[0.98]"
              >
                {CTA_COPY.secondary}
              </button>
            </div>

            <p className="mt-6 text-sm text-white/85">
              {CTA_COPY.trial} · Developed, tried and tested by experienced lawyers
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

CTASection.propTypes = {
  onBookDemo: PropTypes.func,
}

export default CTASection
