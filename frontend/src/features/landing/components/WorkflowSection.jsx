import { motion as Motion, useReducedMotion } from "framer-motion"
import { WORKFLOW_STEPS } from "../utils/landingConstants"
import { Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"

/**
 * The Jurinex workflow — five connected stages from upload to a closed
 * matter, as published on jurinex.ai. Connector line draws in on scroll.
 */
const WorkflowSection = () => {
  const reduce = useReducedMotion()

  return (
    <section
      id="workflow"
      className="scroll-mt-20 overflow-hidden bg-white py-20 sm:py-28"
      aria-labelledby="workflow-heading"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="workflow-heading"
          eyebrow="How It Works"
          title="The Jurinex Workflow"
          lede="A single pipeline carries your matter from raw papers to a hearing-ready position — and all the way to a clean archive."
        />

        <div className="relative mt-16">
          {/* Horizontal connector (lg+) */}
          <div
            className="absolute left-0 right-0 top-5 hidden h-px bg-nx-line lg:block"
            aria-hidden="true"
          >
            {!reduce && (
              <Motion.div
                className="h-full origin-left bg-nx-teal"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 1.6, ease: "easeInOut" }}
              />
            )}
          </div>

          <ol className="relative grid grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-5 lg:gap-x-5">
            {WORKFLOW_STEPS.map((step, i) => (
              <Motion.li
                key={step.num}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: reduce ? 0 : i * 0.12, duration: 0.45, ease: EASE }}
                className="relative flex gap-4 lg:block"
              >
                {/* Vertical connector for stacked layouts */}
                {i < WORKFLOW_STEPS.length - 1 && (
                  <span
                    className="absolute left-5 top-11 h-[calc(100%-4px)] w-px -translate-x-1/2 bg-nx-line lg:hidden"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10 flex h-10 w-10 flex-none items-center justify-center rounded-full border-2 border-nx-teal bg-white text-sm font-bold text-nx-teal lg:mb-4">
                  {step.num}
                </span>
                <div className="rounded-2xl lg:border lg:border-nx-line lg:bg-nx-pale lg:p-5 lg:transition-all lg:duration-300 lg:hover:-translate-y-1 lg:hover:border-nx-teal lg:hover:bg-white lg:hover:shadow-[0_14px_36px_-16px_rgba(6,52,44,0.18)]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-nx-teal">
                    {step.label}
                  </p>
                  <h3 className="mt-1.5 font-display text-base font-semibold leading-snug text-nx-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-nx-muted">{step.text}</p>
                </div>
              </Motion.li>
            ))}
          </ol>
        </div>

        <Reveal className="mt-14 text-center" delay={0.2}>
          <p className="text-sm text-nx-faint">
            Every step works from the same case context — nothing is re-uploaded, nothing is re-explained.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

export default WorkflowSection
