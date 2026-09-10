import { useNavigate } from "react-router-dom"
import PublicPageShell from "../components/landing/PublicPageShell"
import { Icon, PrimaryButton, Reveal, SecondaryButton, SectionHeading } from "../components/landing/primitives"
import { CONTACT_INFO, HELP_CHANNELS, HELP_TOPICS } from "../utils/landingConstants"

/**
 * Standalone /help page — support channels for visitors and customers,
 * quick-start topics, and a hand-off to the in-app ticket desk for
 * signed-in users.
 */
const HelpPage = () => {
  const navigate = useNavigate()

  const follow = (channel) => {
    if (channel.href.startsWith("/")) navigate(channel.href)
    else if (/^(https?:|mailto:|tel:)/.test(channel.href)) window.open(channel.href, "_blank", "noopener,noreferrer")
  }

  return (
    <PublicPageShell title="Get Help">
      <section className="bg-nx-pale py-20 sm:py-24" aria-labelledby="help-heading">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHeading
            id="help-heading"
            eyebrow="Support"
            title="How can we help?"
            lede={`Reach the Jurinex team on any channel below. Support hours are Monday to Friday, 9 AM to 6 PM IST. Email: ${CONTACT_INFO.email}`}
          />

          <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {HELP_CHANNELS.map((channel, i) => (
              <Reveal key={channel.title} delay={i * 0.05}>
                <button
                  type="button"
                  onClick={() => follow(channel)}
                  className="group flex h-full w-full flex-col rounded-2xl border border-nx-ink/75 bg-white p-6 text-left transition-all hover:-translate-y-0.5 hover:border-nx-teal hover:shadow-[0_16px_40px_-20px_rgba(13,60,55,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-nx-pale text-nx-teal">
                    <Icon name={channel.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-nx-ink">{channel.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-nx-muted">{channel.body}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-nx-teal">
                    {channel.cta}
                    <Icon name="ArrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20 sm:py-24" aria-labelledby="help-topics-heading">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHeading
            id="help-topics-heading"
            eyebrow="Quick answers"
            title="Common questions from new users"
            lede="Short answers to the things people ask in their first week. The full list lives on the FAQs page."
            align="left"
          />

          <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
            {HELP_TOPICS.map((topic, i) => (
              <Reveal key={topic.q} delay={i * 0.04} className="border-l-2 border-nx-teal/40 pl-5">
                <h3 className="text-[15px] font-semibold text-nx-ink">{topic.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-nx-muted">{topic.a}</p>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-12 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton onClick={() => navigate("/faqs")} ariaLabel="Browse all FAQs">
              Browse all FAQs
            </PrimaryButton>
            <SecondaryButton onClick={() => navigate("/contact")} ariaLabel="Contact the Jurinex team">
              Contact us
            </SecondaryButton>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-nx-line bg-nx-pale py-16" aria-labelledby="help-ticket-heading">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">Existing customers</p>
            <h2 id="help-ticket-heading" className="mt-2 font-display text-2xl font-semibold text-nx-ink">
              Raise a support ticket from your workspace
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-nx-muted">
              Signed-in users can open a ticket with attachments, track its status and see past
              conversations under Get Help inside the app.
            </p>
          </div>
          <PrimaryButton onClick={() => navigate("/get-help")} ariaLabel="Open the in-app support desk">
            <Icon name="LifeBuoy" className="h-4 w-4" />
            Open support desk
          </PrimaryButton>
        </div>
      </section>
    </PublicPageShell>
  )
}

export default HelpPage
