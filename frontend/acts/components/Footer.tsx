import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";

/**
 * Static copy of the React app's Footer (frontend/src/features/landing/components/Footer.jsx).
 * The newsletter form needs JavaScript and the auth service, so it is left out;
 * every other link is a plain <a href> into the React app or an external site.
 */
const CONTACT_INFO = {
  company: "NexIntel AI Pvt Ltd",
  tagline: "Enterprise grade legal operating system for Professionals powered by AI",
  addressLines: ["B11, Near Railway Station Road, MIDC,", "Chhatrapati Sambhajinagar, Maharashtra 431010"],
  phone: "+91 9684027372",
  email: "connect@jurinex.ai",
  cin: "U62010MH2025PTC448297",
  gstin: "27AAKCN4811B1ZQ",
  registeredOffice: "Chhatrapati Sambhajinagar, Maharashtra 431005",
  incorporation: "Incorporated under the Companies Act, 2013.",
};

const SOCIAL_LINKS = [
  { label: "Instagram", href: "https://www.instagram.com/jurinex_/" },
  { label: "Facebook", href: "https://www.facebook.com/share/19VmrVEWYM" },
  { label: "X", href: "https://x.com/nexintel_ai" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/jurinex" },
  { label: "YouTube", href: "https://www.youtube.com/@JuriNex_ai" },
  { label: "Pinterest", href: "https://in.pinterest.com/nexintel_ai/" },
];

interface FooterLink {
  title: string;
  href: string;
  external?: boolean;
}

const FOOTER_COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { title: "Create Case", href: "/products/create-case" },
      { title: "Case Storage", href: "/products/case-storage" },
      { title: "Quick Chat", href: "/products/quick-chat" },
      { title: "AI Drafting", href: "/products/ai-drafting" },
      { title: "Citation Research", href: "/products/citation-research" },
      { title: "All Products", href: "/products" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { title: "Solo Practitioners", href: "/#solutions" },
      { title: "Law Firms & Enterprises", href: "/#solutions" },
      { title: "Built for Indian Courts", href: "/#indian-courts" },
      { title: "Security & Trust", href: "/#security" },
      { title: "Pricing", href: "/#pricing" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { title: "Bare Acts", href: "/acts" },
      { title: "Blogs", href: "/blogs" },
      { title: "FAQs", href: "/faqs" },
      { title: "WhatsApp Community", href: "/community" },
      { title: "Get Help", href: "/help" },
      { title: "Contact Us", href: "/contact" },
    ],
  },
  {
    heading: "Company",
    links: [
      { title: "Why Jurinex", href: "/#why" },
      { title: "Team", href: "/team" },
      { title: "Book a Demo", href: "/contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { title: "Terms of Services", href: "https://drive.google.com/open?id=1BTXf-YUiOjQiJmdwM9QS0GCgbGUXRBOO&usp=drive_copy", external: true },
      { title: "Master Service Agreement", href: "https://drive.google.com/open?id=1iUYu1fDiqp95_GV16G8w_Su-EIgBg4aT&usp=drive_copy", external: true },
      { title: "DPA", href: "https://drive.google.com/open?id=1MEYVdK5NtlqkhlhPrCi_q4o6zCvsyBTP&usp=drive_copy", external: true },
      { title: "Privacy Policy", href: "https://drive.google.com/open?id=10RKK0Eh7ybm0mRNpbsDx4ecMs5ymedWa&usp=drive_copy", external: true },
      { title: "Data Security Policy", href: "https://drive.google.com/open?id=1X0qE1gpz-oVfy9qfL7UdIhcoLezhIEeZ&usp=drive_copy", external: true },
      { title: "Disclosures", href: "https://drive.google.com/open?id=11oc-dhaFbjhPtraRuYucjfOtnE5WqQj4&usp=drive_copy", external: true },
      { title: "Cookie Policy", href: "https://drive.google.com/open?id=1iKeGRa0w86ERuGJLYRSaAFnw7H1fYeNS&usp=drive_copy", external: true },
      { title: "Refund Policy", href: "https://drive.google.com/open?id=1ryZoxjk55ESOU4QaSximCarJe2236DAC&usp=drive_copy", external: true },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="mt-16 overflow-hidden rounded-t-[3.5rem] border border-b-0 border-nx-line bg-[#fbfbfa] font-body shadow-[0_-16px_48px_-28px_rgba(6,52,44,0.3)] sm:rounded-t-[5rem]"
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>

      <div className="bg-nx-forest">
        <div className="mx-auto max-w-7xl px-5 pb-12 pt-16 sm:px-8">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-md">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">Get in touch</p>
              <p className="mt-4 font-display text-3xl text-white">
                Have a question or a <em className="text-nx-mint">use case</em> in mind?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/85">
                Tell us how your practice works. We will show you where Jurinex fits.
              </p>
            </div>
            <a
              href="/contact"
              className="inline-flex flex-none items-center gap-3 rounded-lg bg-white px-8 py-4 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-nx-teal-deep transition-colors hover:bg-teal-50"
            >
              Get in touch
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-1 gap-12 pt-14 lg:grid-cols-[1.3fr_2.7fr]">
          <div>
            <BrandLogo size="lg" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-nx-muted">{CONTACT_INFO.tagline}</p>
            <address className="mt-7 space-y-1 text-sm not-italic leading-relaxed text-nx-muted">
              {CONTACT_INFO.addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="pt-2">
                <a href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`} className="transition-colors hover:text-nx-teal-deep">
                  {CONTACT_INFO.phone}
                </a>
              </p>
              <p>
                <a href={`mailto:${CONTACT_INFO.email}`} className="font-medium text-nx-teal-deep transition-colors hover:text-nx-teal-ink">
                  {CONTACT_INFO.email}
                </a>
              </p>
            </address>

            <div className="mt-7">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Follow Jurinex</p>
              <ul className="mt-3 flex flex-wrap items-center gap-2.5">
                {SOCIAL_LINKS.map((social) => (
                  <li key={social.label}>
                    <a
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Jurinex on ${social.label}`}
                      className="inline-flex h-9 items-center rounded-lg border border-nx-line px-3 text-xs font-semibold text-nx-muted transition-colors hover:border-nx-teal-deep hover:text-nx-teal-deep"
                    >
                      {social.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 space-y-1.5 font-mono text-xs leading-relaxed text-nx-faint">
              <p className="font-semibold text-nx-ink">{CONTACT_INFO.company}</p>
              <p>
                <span className="text-nx-muted">CIN:</span> {CONTACT_INFO.cin}
              </p>
              <p>
                <span className="text-nx-muted">GSTIN:</span> {CONTACT_INFO.gstin}
              </p>
              <p>
                <span className="text-nx-muted">Registered Office:</span> {CONTACT_INFO.registeredOffice}
              </p>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-5" aria-label="Footer">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">{column.heading}</p>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={`${column.heading}-${link.title}`}>
                      <a
                        href={link.href}
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noopener noreferrer" : undefined}
                        className="text-left text-sm text-nx-muted transition-colors hover:text-nx-ink"
                      >
                        {link.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div aria-hidden="true" className="mt-16 flex select-none justify-center overflow-hidden border-t border-nx-line py-10">
          <Image
            src="/brand/jurinex-wordmark.png"
            alt=""
            width={816}
            height={169}
            className="h-[clamp(3rem,9vw,8rem)] w-auto"
            loading="lazy"
          />
        </div>

        <div className="flex flex-col items-start justify-between gap-3 border-t border-nx-line py-7 sm:flex-row sm:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
              &copy; {year} {CONTACT_INFO.company}
            </p>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-nx-faint/80">{CONTACT_INFO.incorporation}</p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">All rights reserved</p>
        </div>
      </div>
    </footer>
  );
}
