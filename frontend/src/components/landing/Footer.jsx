import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { CONTACT_INFO, FOOTER_COLUMNS, SOCIAL_LINKS } from "../../utils/landingConstants"
import { Icon } from "./primitives"
import BrandLogo from "./BrandLogo"
import wordmark from "../../assets/jurinex-wordmark.png"

/** Brand icons lucide doesn't ship (Pinterest, X). */
const PinterestIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.64 7.86 6.36 9.31-.09-.79-.17-2 .04-2.87.18-.78 1.18-4.98 1.18-4.98s-.3-.6-.3-1.49c0-1.4.81-2.44 1.82-2.44.86 0 1.27.64 1.27 1.42 0 .86-.55 2.15-.83 3.35-.24 1 .5 1.81 1.49 1.81 1.78 0 3.15-1.88 3.15-4.59 0-2.4-1.72-4.08-4.19-4.08-2.85 0-4.53 2.14-4.53 4.35 0 .86.33 1.79.75 2.29.08.1.09.19.07.29-.08.31-.25 1-.28 1.14-.04.19-.15.23-.34.14-1.25-.58-2.03-2.4-2.03-3.87 0-3.15 2.29-6.04 6.6-6.04 3.46 0 6.16 2.47 6.16 5.77 0 3.44-2.17 6.21-5.18 6.21-1.01 0-1.96-.53-2.29-1.15l-.62 2.37c-.22.87-.83 1.96-1.24 2.62.93.29 1.92.45 2.94.45 5.52 0 10-4.48 10-10S17.52 2 12 2z" />
  </svg>
)

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

const SocialIcon = ({ icon }) => {
  if (icon === "pinterest") return <PinterestIcon />
  if (icon === "x") return <XIcon />
  return <Icon name={icon} className="h-4 w-4" />
}

SocialIcon.propTypes = { icon: PropTypes.string.isRequired }

/**
 * Editorial enterprise footer — monospace eyebrow labels, serif display
 * headline, hairline-divided sections and a giant faded brand lockup
 * above the bottom bar. Full company record from jurinex.ai (columns,
 * legal documents, social profiles, statutory identifiers). Anchor links
 * scroll in place on the landing page and route home (with a scroll
 * target) from other pages; policy links open PolicyModal.
 */
const Footer = ({ onOpenPolicy, onGetInTouch }) => {
  const navigate = useNavigate()
  const year = new Date().getFullYear()

  const followLink = (link) => {
    if (link.type === "policy") {
      onOpenPolicy?.(link.href)
      return
    }
    if (link.type === "route") {
      navigate(link.href)
      return
    }
    if (link.type === "external") {
      window.open(link.href, "_blank", "noopener,noreferrer")
      return
    }
    // anchor
    const id = link.href.replace("#", "")
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: "smooth" })
    else navigate("/", { state: { scrollTo: id } })
  }

  return (
    <footer
      className="overflow-hidden rounded-t-[3.5rem] border border-b-0 border-nx-line bg-[#fbfbfa] shadow-[0_-16px_48px_-28px_rgba(6,52,44,0.3)] sm:rounded-t-[5rem]"
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>

      {/* Get in touch — editorial split row on the solid brand teal */}
      <div className="bg-nx-forest">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-center">
          <div className="max-w-md">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">
              Get in touch
            </p>
            <p className="mt-4 font-display text-3xl text-white">
              Have a question or a <em className="text-nx-mint">use case</em> in mind?
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/85">
              Tell us how your practice works — we'll show you where Jurinex fits.
            </p>
          </div>
          <button
            type="button"
            onClick={() => (onGetInTouch ? onGetInTouch() : navigate("/contact"))}
            className="inline-flex flex-none items-center gap-3 bg-white px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-nx-teal-deep transition-colors hover:bg-teal-50"
          >
            Get in touch
            <Icon name="ArrowRight" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main columns */}
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-1 gap-12 pt-14 lg:grid-cols-[1.3fr_2.7fr]">
          {/* Brand + contact + statutory record */}
          <div>
            <BrandLogo size="lg" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-nx-muted">
              {CONTACT_INFO.tagline}
            </p>
            <address className="mt-7 space-y-1 text-sm not-italic leading-relaxed text-nx-muted">
              {CONTACT_INFO.addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="pt-2">
                <a
                  href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`}
                  className="transition-colors hover:text-nx-teal-deep"
                >
                  {CONTACT_INFO.phone}
                </a>
              </p>
              <p>
                <a
                  href={`mailto:${CONTACT_INFO.email}`}
                  className="font-medium text-nx-teal-deep transition-colors hover:text-nx-teal-ink"
                >
                  {CONTACT_INFO.email}
                </a>
              </p>
            </address>

            {/* Social */}
            <div className="mt-7">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                Follow Jurinex
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Jurinex on ${social.label}`}
                    className="grid h-9 w-9 place-items-center border border-nx-line text-nx-muted transition-colors hover:border-nx-teal-deep hover:text-nx-teal-deep"
                  >
                    <SocialIcon icon={social.icon} />
                  </a>
                ))}
              </div>
            </div>

            {/* Statutory identifiers */}
            <div className="mt-8 space-y-1.5 font-mono text-xs leading-relaxed text-nx-faint">
              <p className="font-semibold text-nx-ink">{CONTACT_INFO.company}</p>
              <p>
                <span className="text-nx-muted">CIN:</span> {CONTACT_INFO.cin}
              </p>
              <p>
                <span className="text-nx-muted">GSTIN:</span> {CONTACT_INFO.gstin}
              </p>
              <p>
                <span className="text-nx-muted">Registered Office:</span>{" "}
                {CONTACT_INFO.registeredOffice}
              </p>
            </div>
          </div>

          {/* Link columns */}
          <nav
            className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-5"
            aria-label="Footer"
          >
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                  {column.heading}
                </p>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={`${column.heading}-${link.title}`}>
                      <button
                        type="button"
                        onClick={() => followLink(link)}
                        className="text-left text-sm text-nx-muted transition-colors hover:text-nx-ink"
                      >
                        {link.title}
                        {link.type === "external" && link.href.startsWith("https") && (
                          <Icon name="ArrowUpRight" className="mb-1 ml-0.5 inline h-3 w-3" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Giant brand lockup — the same artwork as the header */}
        <div
          aria-hidden="true"
          className="mt-16 flex select-none justify-center overflow-hidden border-t border-nx-line py-10"
        >
          <img
            src={wordmark}
            alt=""
            className="h-[clamp(3rem,9vw,8rem)] w-auto"
            loading="lazy"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-nx-line py-7 sm:flex-row sm:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
              © {year} {CONTACT_INFO.company}
            </p>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-nx-faint/80">
              {CONTACT_INFO.incorporation}
            </p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
            All rights reserved
          </p>
        </div>
      </div>
    </footer>
  )
}

Footer.propTypes = {
  onOpenPolicy: PropTypes.func,
  onGetInTouch: PropTypes.func,
}

export default Footer
