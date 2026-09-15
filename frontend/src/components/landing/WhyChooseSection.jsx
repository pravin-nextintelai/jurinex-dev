import { WHY_CHOOSE } from "../../utils/landingConstants"
import { Eyebrow, Icon, Reveal } from "./primitives"
import meetingPhoto from "../../assets/landing/advocates-meeting.jpg"

/**
 * "Why Jurinex" — a magazine-style split: heading and the four reasons
 * as check-marked statements on the left, and a tall photo on the right
 * with an offset accent panel and an overlapping caption card.
 */
const WhyChooseSection = () => (
  <section id="why" className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="why-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        {/* Copy + reasons */}
        <div>
          <Reveal>
            <Eyebrow>Why Jurinex</Eyebrow>
            <h2
              id="why-heading"
              className="mt-3 max-w-xl font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
            >
              Why Legal Professionals Choose Jurinex
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-nx-muted sm:text-lg">
              Not another general-purpose chatbot with a legal skin — a platform built around how
              matters are actually run.
            </p>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2">
            {WHY_CHOOSE.map((reason, i) => (
              <Reveal key={reason.title} delay={i * 0.07} className="border-t border-nx-ink/20 pt-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-nx-teal text-white">
                    <Icon name="Check" className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <h3 className="font-display text-lg font-semibold leading-snug text-nx-ink">
                    {reason.title}
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-nx-muted">{reason.text}</p>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Photo on a mint backdrop, caption overlapping the bottom edge */}
        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none lg:mt-16" y={30}>
          <div className="px-4 sm:px-6">
            <div className="overflow-hidden rounded-3xl border border-white shadow-[0_30px_70px_-30px_rgba(6,52,44,0.45)]">
              <img
                src={meetingPhoto}
                alt="An advocate in court dress reviewing papers at a laptop, with law reports on the desk"
                className="aspect-[4/5] w-full object-cover sm:aspect-[5/4] lg:aspect-[4/5]"
                loading="lazy"
              />
            </div>
          </div>
          <div className="relative -mt-12 ml-6 mr-10 rounded-2xl border border-nx-line bg-white p-5 shadow-[0_18px_40px_-20px_rgba(6,52,44,0.3)] sm:-mt-14 sm:ml-10 sm:mr-14">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-nx-teal">
              <Icon name="Scale" className="h-3.5 w-3.5" />
              Built with practicing advocates
            </p>
            <p className="mt-2 font-display text-[15px] leading-snug text-nx-ink">
              Every workflow was shaped in a working chamber before it shipped, not designed from a
              spec.
            </p>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
)

export default WhyChooseSection
