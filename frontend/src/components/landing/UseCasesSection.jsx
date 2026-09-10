import { PRACTICE_SIZES, USE_CASES } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"

/**
 * "Solutions": practice-size fit as one segmented stepper bar, then the
 * persona use cases as a gridded table — cells share hairlines instead
 * of floating as separate cards.
 */
const UseCasesSection = () => (
  <section
    id="solutions"
    className="scroll-mt-20 bg-nx-pale py-20 sm:py-28"
    aria-labelledby="solutions-heading"
  >
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="solutions-heading"
        eyebrow="Built for Every Kind of Legal Practice"
        title="Whether You're a Solo Practitioner or a Corporate Legal Team — Jurinex Is the Solution"
        lede="Plans and workspaces scale from a single chamber to a multi-partner firm."
      />

      {/* Practice-size stepper */}
      <Reveal className="mt-12">
        <ol className="relative grid grid-cols-1 overflow-hidden rounded-2xl bg-nx-forest text-white sm:grid-cols-3">
          {PRACTICE_SIZES.map((size, i) => (
            <li
              key={size.numeral}
              className="relative flex items-center gap-5 px-7 py-7 sm:flex-col sm:items-start sm:gap-0 sm:py-9"
            >
              {i > 0 && (
                <span
                  className="absolute inset-y-0 left-0 hidden w-px bg-white/15 sm:block"
                  aria-hidden="true"
                />
              )}
              <span className="font-display text-4xl font-semibold text-white sm:text-5xl">
                {size.numeral}
              </span>
              <div className="sm:mt-6">
                <h3 className="text-base font-semibold text-white">{size.title}</h3>
                <p className="mt-1 text-sm text-white/85">{size.seats}</p>
              </div>
              {i < PRACTICE_SIZES.length - 1 && (
                <Icon
                  name="ChevronRight"
                  className="absolute right-[-0.6rem] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-nx-forest text-white sm:block"
                />
              )}
            </li>
          ))}
        </ol>
      </Reveal>

      {/* Persona use cases as a gridded table */}
      <Reveal className="mt-20 flex items-end justify-between gap-6" y={16}>
        <h3 className="font-display text-2xl font-semibold text-nx-ink sm:text-3xl">
          Built for Every Stage of Legal Work
        </h3>
        <span className="hidden text-sm text-nx-faint sm:block">
          {USE_CASES.length} ways teams use Jurinex
        </span>
      </Reveal>

      <Reveal className="mt-8 overflow-hidden rounded-2xl border border-nx-ink/20 bg-nx-ink/20">
        <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((useCase, i) => (
            <div
              key={useCase.title}
              className="group relative bg-white p-7 transition-colors hover:bg-nx-pale/70"
            >
              <span className="absolute right-6 top-6 font-display text-sm text-nx-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Icon
                name={useCase.icon}
                className="h-6 w-6 text-nx-teal"
                strokeWidth={1.6}
              />
              <h4 className="mt-5 font-display text-lg font-semibold text-nx-ink">{useCase.title}</h4>
              <p className="mt-2 text-sm leading-relaxed text-nx-muted">{useCase.text}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  </section>
)

export default UseCasesSection
