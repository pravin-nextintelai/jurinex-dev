import { useState } from "react"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import { FEATURES } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"

/**
 * Core platform features as a spotlight: a vertical index of the eight
 * capabilities on the left, and a large detail panel on the right that
 * swaps as the reader hovers or selects. Keyboard-accessible tabs.
 */
const FeaturesSection = () => {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const feature = FEATURES[active]

  return (
    <section
      id="features"
      className="scroll-mt-20 bg-white py-20 sm:py-28"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="features-heading"
          eyebrow="The Platform"
          title="Everything You Need to Work Smarter"
          lede="One connected workspace where documents, research, evidence, and drafting share the same understanding of your case."
        />

        <Reveal className="mt-14 grid grid-cols-1 overflow-hidden rounded-3xl border border-nx-ink/20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* Index */}
          <div role="tablist" aria-orientation="vertical" className="divide-y divide-nx-line bg-white">
            {FEATURES.map((item, i) => {
              const selected = i === active
              return (
                <button
                  key={item.title}
                  type="button"
                  role="tab"
                  id={`feature-tab-${i}`}
                  aria-selected={selected}
                  aria-controls="feature-panel"
                  onClick={() => setActive(i)}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  className={`relative flex w-full items-center gap-4 px-6 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nx-teal sm:px-8 ${
                    selected ? "bg-nx-pale" : "hover:bg-nx-pale/60"
                  }`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-1 transition-opacity ${
                      selected ? "bg-nx-teal opacity-100" : "opacity-0"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="w-7 font-display text-sm font-semibold text-nx-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`flex-1 text-[15px] font-semibold ${
                      selected ? "text-nx-ink" : "text-nx-muted"
                    }`}
                  >
                    {item.title}
                  </span>
                  <Icon
                    name="ArrowRight"
                    className={`h-4 w-4 transition-all ${
                      selected ? "translate-x-0 text-nx-teal opacity-100" : "-translate-x-1 opacity-0"
                    }`}
                  />
                </button>
              )
            })}
          </div>

          {/* Detail panel */}
          <div
            id="feature-panel"
            role="tabpanel"
            aria-labelledby={`feature-tab-${active}`}
            className="relative flex min-h-[22rem] flex-col justify-between overflow-hidden bg-nx-forest p-8 text-white sm:p-12"
          >
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
              style={{
                background:
                  "radial-gradient(ellipse 70% 70% at 100% 0%, rgba(13,148,136,0.35), transparent 60%)",
              }}
            />
            <AnimatePresence mode="wait">
              <Motion.div
                key={feature.title}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="relative"
              >
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15">
                  <Icon name={feature.icon} className="h-7 w-7" />
                </span>
                <h3 className="mt-8 font-display text-2xl font-semibold leading-snug sm:text-3xl">
                  {feature.title}
                </h3>
                <p className="mt-4 max-w-lg text-base leading-relaxed text-white/90 sm:text-[17px]">
                  {feature.text}
                </p>
              </Motion.div>
            </AnimatePresence>

            <div className="relative mt-10 flex items-center justify-between border-t border-white/25 pt-5">
              <span className="font-display text-sm text-white/85">
                {String(active + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
              </span>
              <div className="flex gap-1.5" aria-hidden="true">
                {FEATURES.map((item, i) => (
                  <span
                    key={item.title}
                    className={`h-1 rounded-full transition-all ${
                      i === active ? "w-6 bg-white" : "w-1.5 bg-white/25"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default FeaturesSection
