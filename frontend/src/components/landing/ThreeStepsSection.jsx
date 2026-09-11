import { useNavigate } from "react-router-dom"
import { THREE_STEPS } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"

/**
 * "Getting started" — three steps to a first drafted petition, leading
 * into the pricing section.
 */
const ThreeStepsSection = () => {
  const navigate = useNavigate()

  return (
    <section className="bg-teal-50 py-20 sm:py-28" aria-labelledby="steps-heading">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="steps-heading"
          eyebrow="Getting Started"
          title="Three Steps to Your First Drafted Petition"
          align="left"
        />

        <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3">
          {THREE_STEPS.map((step, i) => (
            <Reveal key={step.numeral} delay={i * 0.1}>
              <p className="font-display text-5xl font-semibold text-nx-teal">
                {step.numeral}.
              </p>
              <h3 className="mt-4 font-display text-xl font-semibold text-nx-ink">
                {step.title}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-nx-muted">{step.text}</p>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.25} className="mt-12">
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="inline-flex items-center gap-2 rounded-lg bg-nx-teal px-7 py-3 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all duration-200 hover:bg-nx-teal-deep active:scale-[0.98]"
          >
            Start Free Trial
            <Icon name="ArrowRight" className="h-4 w-4" />
          </button>
        </Reveal>
      </div>
    </section>
  )
}

export default ThreeStepsSection
