import { TRUST_POINTS } from "../../utils/landingConstants"
import { Icon, Reveal } from "./primitives"

/**
 * Trust strip directly under the hero — a single hairline-divided row,
 * no cards. Capability-based trust signals only; no invented logos or
 * statistics.
 */
const TrustSection = () => (
  <section className="border-b border-nx-line bg-white" aria-labelledby="trust-heading">
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
      <Reveal className="flex items-center gap-4">
        <p
          id="trust-heading"
          className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.2em] text-nx-faint"
        >
          Built for modern legal teams
        </p>
        <span className="h-px flex-1 bg-nx-line" aria-hidden="true" />
      </Reveal>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-4 lg:divide-x lg:divide-nx-line">
        {TRUST_POINTS.map((point, i) => (
          <Reveal
            key={point.title}
            delay={i * 0.06}
            className="border-t border-nx-line py-5 sm:border-t-0 sm:py-0 lg:px-8 lg:first:pl-0 lg:last:pr-0"
          >
            <div className="flex items-center gap-2.5">
              <Icon name={point.icon} className="h-4.5 w-4.5 text-nx-teal" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-nx-ink">{point.title}</h3>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-nx-muted">{point.text}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default TrustSection
