import { STATS } from "../../utils/landingConstants"
import { Reveal } from "./primitives"

/**
 * Slim dark stats band directly under the hero — the platform's
 * published numbers from jurinex.ai.
 */
const StatsSection = () => (
  <section className="bg-nx-forest" aria-label="Platform statistics">
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8">
      {STATS.map((stat, i) => (
        <Reveal key={stat.label} delay={i * 0.08} y={14} className="text-center">
          <p className="font-display text-3xl font-semibold text-white sm:text-4xl">
            {stat.value}
          </p>
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/85">
            {stat.label}
          </p>
        </Reveal>
      ))}
    </div>
  </section>
)

export default StatsSection
