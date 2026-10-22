import { SECURITY_POINTS } from "../utils/landingConstants"
import { Icon, IconTile, Reveal, SectionHeading } from "./primitives"

/**
 * Confidentiality and security. Claims here are limited to what the
 * shipped product actually does — no compliance-certification badges.
 */
const SecuritySection = () => (
  <section
    id="security"
    className="scroll-mt-20 bg-white py-20 sm:py-28"
    aria-labelledby="security-heading"
  >
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        {/* Left: pitch */}
        <Reveal>
          <div className="lg:sticky lg:top-28">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">
              Security & Confidentiality
            </p>
            <h2
              id="security-heading"
              className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
            >
              Your Legal Data Deserves Enterprise-Grade Protection
            </h2>
            <p className="mt-4 text-base leading-relaxed text-nx-muted">
              Privilege and confidentiality are not features — they are the
              baseline. Case files stay inside your workspace, access is
              controlled at every layer, and you can see exactly who is signed
              in, from where.
            </p>

            <div className="mt-8 flex items-start gap-4 rounded-2xl border border-nx-ink/75 bg-nx-pale p-5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-nx-ink text-white">
                <Icon name="ShieldCheck" className="h-5.5 w-5.5" />
              </span>
              <p className="text-sm leading-relaxed text-nx-muted">
                <span className="font-semibold text-nx-ink">
                  Your documents are never anyone else's.
                </span>{" "}
                Matters are isolated per workspace, and what your team uploads
                is visible only to the people you grant access.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Right: security points */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECURITY_POINTS.map((point, i) => (
            <Reveal
              key={point.title}
              delay={(i % 2) * 0.08}
              className="rounded-2xl border border-nx-ink/75 bg-white p-6 transition-all duration-300 hover:border-nx-teal hover:shadow-[0_14px_36px_-16px_rgba(6,52,44,0.16)]"
            >
              <IconTile name={point.icon} />
              <h3 className="mt-3.5 text-sm font-semibold text-nx-ink">{point.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-nx-muted">{point.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  </section>
)

export default SecuritySection
