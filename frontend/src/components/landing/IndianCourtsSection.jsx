import { INDIAN_COURTS } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import courtsPhoto from "../../assets/landing/courts-desk.jpg"

const COURT_LEVELS = ["District Courts", "High Courts", "Supreme Court", "Tribunals"]

/**
 * "Built for Indian courts." — the four platform commitments published
 * on jurinex.ai as a vertical timeline beside a photo, on a light ground.
 */
const IndianCourtsSection = () => (
  <section
    id="indian-courts"
    className="relative scroll-mt-20 overflow-hidden bg-[#eaf5f1] py-20 sm:py-28"
    aria-labelledby="indian-courts-heading"
  >
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(13,148,136,0.10), transparent 65%), linear-gradient(180deg, #eaf5f1 0%, #f3faf7 100%)",
      }}
    />
    <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="indian-courts-heading"
        eyebrow="Purpose-Built"
        title="Built for Indian Courts"
        lede="Not adapted for India as an afterthought — engineered for how Indian legal practice actually works."
      />

      <div className="mt-14 grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
        {/* Courtroom photo with court-level ladder */}
        <Reveal className="lg:sticky lg:top-28">
          <div className="relative overflow-hidden rounded-3xl border border-white shadow-[0_24px_60px_-28px_rgba(6,52,44,0.35)]">
            <img
              src={courtsPhoto}
              alt="A gavel, Indian statute books and the scales of justice on a desk, with the Supreme Court of India behind"
              className="h-80 w-full object-cover sm:h-[26rem]"
              loading="lazy"
            />
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-nx-ink/20 bg-nx-ink/15 sm:grid-cols-4">
            {COURT_LEVELS.map((level) => (
              <li
                key={level}
                className="flex items-center justify-center gap-2 bg-white px-3 py-3 text-center text-xs font-semibold text-nx-ink"
              >
                <Icon name="Landmark" className="h-3.5 w-3.5 text-nx-teal" />
                {level}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* Commitments as a vertical timeline */}
        <ol className="relative">
          <span
            className="absolute bottom-6 left-6 top-6 w-px bg-gradient-to-b from-nx-teal via-nx-line to-transparent"
            aria-hidden="true"
          />
          {INDIAN_COURTS.map((item, i) => (
            <Reveal
              key={item.title}
              as="li"
              delay={i * 0.08}
              className="relative flex gap-6 pb-10 last:pb-0"
            >
              <span className="relative z-10 inline-flex h-12 w-12 flex-none items-center justify-center rounded-full bg-nx-teal text-white ring-4 ring-[#eef7f3]">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <div className="pt-2.5">
                <h3 className="font-display text-xl font-semibold text-nx-ink">{item.title}</h3>
                <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-nx-muted">
                  {item.text}
                </p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </div>
  </section>
)

export default IndianCourtsSection
