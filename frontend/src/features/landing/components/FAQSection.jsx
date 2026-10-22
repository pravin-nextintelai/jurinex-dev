import { useState } from "react"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import { FAQS } from "../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"

/**
 * Accessible FAQ accordion — buttons with aria-expanded, smooth
 * height animation, static when reduced motion is preferred.
 */
const FAQSection = () => {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" className="scroll-mt-20 bg-nx-pale py-20 sm:py-28" aria-labelledby="faq-heading">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <SectionHeading
          id="faq-heading"
          eyebrow="FAQ"
          title="Frequently Asked Questions"
          lede="Everything you need to know before bringing Jurinex into your practice."
        />

        <Reveal className="mt-12 divide-y divide-nx-line overflow-hidden rounded-2xl border border-nx-ink/75 bg-white">
          {FAQS.map((faq, i) => {
            const isOpen = open === i
            return (
              <div key={faq.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  id={`faq-button-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-nx-pale/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nx-teal"
                >
                  <span className="text-[15px] font-semibold text-nx-ink">{faq.q}</span>
                  <Motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border transition-colors ${
                      isOpen
                        ? "border-nx-teal bg-nx-teal text-white"
                        : "border-nx-line text-nx-muted"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon name="Plus" className="h-4 w-4" />
                  </Motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <Motion.div
                      id={`faq-panel-${i}`}
                      role="region"
                      aria-labelledby={`faq-button-${i}`}
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-5 text-sm leading-relaxed text-nx-muted">{faq.a}</p>
                    </Motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </Reveal>
      </div>
    </section>
  )
}

export default FAQSection
