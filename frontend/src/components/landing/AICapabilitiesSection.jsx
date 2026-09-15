import { AI_CAPABILITIES } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import courtroomPhoto from "../../assets/landing/courtroom.jpg"

/**
 * The intelligence layer behind the platform — rendered over a darkened
 * courtroom photograph so it reads as the "engine room" of the product.
 */
const AICapabilitiesSection = () => (
  <section
    id="capabilities"
    className="relative scroll-mt-20 overflow-hidden bg-nx-ink py-20 sm:py-28"
    aria-labelledby="capabilities-heading"
  >
    {/* Background photograph with a dark overlay for legibility */}
    <img
      src={courtroomPhoto}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
    />
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        background:
          "linear-gradient(180deg, rgba(16,20,19,0.62) 0%, rgba(16,20,19,0.48) 50%, rgba(16,20,19,0.66) 100%)",
      }}
    />

    <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="capabilities-heading"
        dark
        eyebrow="The AI Engine"
        title="The Intelligence Behind the Platform"
        lede="Every feature on the surface is powered by the same set of legal-tuned AI capabilities underneath."
      />

      <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AI_CAPABILITIES.map((cap, i) => (
          <Reveal
            key={cap.title}
            delay={(i % 3) * 0.07}
            className="group relative overflow-hidden rounded-2xl border border-white/20 bg-nx-ink/85 p-6 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.8)] transition-all duration-300 hover:scale-[1.03] hover:border-white/40 hover:bg-nx-ink hover:shadow-[0_28px_60px_-20px_rgba(0,0,0,0.85)]"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-nx-teal text-white shadow-md shadow-teal-500/30">
                <Icon name={cap.icon} className="h-4.5 w-4.5" />
              </span>
              <h3 className="text-[15px] font-bold text-white">{cap.title}</h3>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-white">{cap.text}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default AICapabilitiesSection
