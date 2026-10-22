import { BENEFITS } from "../utils/landingConstants"
import { Eyebrow, Reveal } from "./primitives"

/**
 * Outcome-focused editorial section — large serif statements with short
 * supporting copy, separated by hairline rules.
 */
const BenefitsSection = () => (
  <section className="bg-nx-pale py-20 sm:py-28" aria-labelledby="benefits-heading">
    <div className="mx-auto max-w-5xl px-5 sm:px-8">
      <Reveal>
        <Eyebrow>Outcomes</Eyebrow>
        <h2
          id="benefits-heading"
          className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
        >
          What Changes When the Reading Is Done for You
        </h2>
      </Reveal>

      <div className="mt-12">
        {BENEFITS.map((benefit, i) => (
          <Reveal
            key={benefit.title}
            delay={i * 0.05}
            className="grid grid-cols-1 gap-3 border-t border-nx-line py-9 last:border-b md:grid-cols-[1fr_1.2fr] md:gap-10"
          >
            <h3 className="font-display text-2xl font-semibold leading-snug text-nx-ink sm:text-3xl">
              {benefit.title.split(". ").map((part, j, arr) => (
                <span key={part} className={j === arr.length - 1 && arr.length > 1 ? "text-nx-teal" : undefined}>
                  {part}
                  {j < arr.length - 1 ? ". " : ""}
                </span>
              ))}
            </h3>
            <p className="text-base leading-relaxed text-nx-muted md:pt-1.5">{benefit.text}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default BenefitsSection
