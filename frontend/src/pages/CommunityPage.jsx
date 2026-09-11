import PublicPageShell from "../components/landing/PublicPageShell"
import CommunitySection from "../components/landing/CommunitySection"
import { Icon, PrimaryButton, Reveal, SecondaryButton, SectionHeading } from "../components/landing/primitives"
import { COMMUNITY_LINKS, COMMUNITY_PERKS } from "../utils/landingConstants"

/**
 * Standalone /community page — join CTA for the WhatsApp community, what
 * members get, then the interactive community loop demo from the landing page.
 */
const CommunityPage = () => (
  <PublicPageShell title="WhatsApp Community">
    <section className="bg-nx-pale py-20 sm:py-24" aria-labelledby="community-join-heading">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="community-join-heading"
          eyebrow="WhatsApp Community"
          title="Practise alongside advocates who use AI every day"
          lede="Product updates, drafting tips, court-specific workflows and direct access to the Jurinex team — in the app you already keep open."
        />

        <Reveal className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <PrimaryButton
            onClick={() => window.open(COMMUNITY_LINKS.whatsapp, "_blank", "noopener,noreferrer")}
            ariaLabel="Join the Jurinex WhatsApp community"
          >
            <Icon name="MessageCircle" className="h-4 w-4" />
            Join on WhatsApp
          </PrimaryButton>
          <SecondaryButton
            onClick={() => window.open(COMMUNITY_LINKS.whatsappChannel, "_blank", "noopener,noreferrer")}
            ariaLabel="Follow the Jurinex WhatsApp channel"
          >
            <Icon name="Megaphone" className="h-4 w-4" />
            Follow the Channel
          </SecondaryButton>
          <SecondaryButton
            onClick={() => window.open(COMMUNITY_LINKS.linkedin, "_blank", "noopener,noreferrer")}
            ariaLabel="Follow Jurinex on LinkedIn"
          >
            Follow on LinkedIn
          </SecondaryButton>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {COMMUNITY_PERKS.map((perk, i) => (
            <Reveal
              key={perk.title}
              delay={i * 0.05}
              className="rounded-2xl border border-nx-ink/75 bg-white p-6"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-nx-pale text-nx-teal">
                <Icon name={perk.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-nx-ink">{perk.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-nx-muted">{perk.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>

    <CommunitySection />
  </PublicPageShell>
)

export default CommunityPage
