/**
 * Navigation and footer content, copied verbatim from
 * frontend/src/features/landing/utils/landingConstants.js so the Bare Acts
 * pages show exactly the same header and footer as the React app.
 * Keep the two files in sync when the site navigation changes.
 */

export interface NavChild {
  label: string;
  href: string;
  icon?: string;
  desc?: string;
}

export interface NavSection {
  heading: string;
  links: NavChild[];
}

export interface NavFeature {
  image: "product" | "solutions" | "resources";
  eyebrow: string;
  badge?: string;
  text: string;
  cta?: string;
  href: string;
}

export interface NavLink {
  label: string;
  href: string;
  lines?: string[];
  children?: NavChild[];
  sections?: NavSection[];
  feature?: NavFeature;
  menu?: "compact";
}

export const NAV_LINKS: NavLink[] = [
  {
    label: "Product",
    href: "/products",
    children: [
      { label: "Create Case", href: "/products/create-case", icon: "FolderPlus", desc: "Upload once. A guided wizard builds the case memory every later step reads from." },
      { label: "Case Storage", href: "/products/case-storage", icon: "FolderLock", desc: "My Documents and My Cases in folders, with advance search and custom branding." },
      { label: "Quick Chat", href: "/products/quick-chat", icon: "MessageSquareText", desc: "Ask anything about a file without creating a case, with one-click presets." },
      { label: "AI Drafting", href: "/products/ai-drafting", icon: "FilePenLine", desc: "Petitions, agreements and notices from a guided template picker, section by section." },
      { label: "Citation Research", href: "/products/citation-research", icon: "Scale", desc: "Indian Kanoon authorities matched to your pleaded grounds, verified before you rely." },
      { label: "All Products", href: "/products", icon: "LayoutGrid", desc: "Five products, one case memory. See how each one works, step by step." },
    ],
    feature: {
      image: "product",
      eyebrow: "Introducing Chronology",
      badge: "New",
      text: "Every dated event in a bundle, extracted automatically and linked to the page that proves it.",
      cta: "See it in action",
      href: "/products/create-case",
    },
  },
  {
    label: "Solutions",
    href: "#solutions",
    children: [
      { label: "Solo Practitioners", href: "#solutions", icon: "UserRound", desc: "A single chamber with the document-handling depth of a large firm." },
      { label: "Law Firms & Enterprises", href: "#solutions", icon: "Building2", desc: "Shared case folders, roles and seats that scale with the practice." },
      { label: "Built for Indian Courts", href: "#indian-courts", icon: "Landmark", desc: "Indian court hierarchy, citation formats and regional languages." },
      { label: "Security & Trust", href: "#security", icon: "ShieldCheck", desc: "Data in India, DPDPA-compliant, encrypted end to end." },
    ],
    feature: {
      image: "solutions",
      eyebrow: "Built for Indian courts",
      text: "Drafts formatted for District Courts, High Courts, the Supreme Court and tribunals, in English or Marathi.",
      cta: "Explore court coverage",
      href: "#indian-courts",
    },
  },
  { label: "Why Jurinex", href: "#why" },
  {
    label: "Resources",
    href: "#resources",
    sections: [
      {
        heading: "Resource center",
        links: [
          { label: "Blogs", href: "/blogs", icon: "Newspaper", desc: "Practical writing on legal AI, drafting and running a modern practice." },
          { label: "FAQs", href: "/faqs", icon: "CircleHelp", desc: "Everything to know before bringing Jurinex into your practice." },
        ],
      },
      {
        heading: "Support",
        links: [
          { label: "WhatsApp Community", href: "/community", icon: "MessageCircle", desc: "Product updates, drafting tips and a direct line to the team." },
          { label: "Get Help", href: "/help", icon: "LifeBuoy", desc: "Email, phone, walkthroughs and the in-app support desk." },
          { label: "Contact Us", href: "/contact", icon: "Mail", desc: "Office address, phone and email for the Jurinex team." },
        ],
      },
    ],
    feature: {
      image: "resources",
      eyebrow: "Join the community",
      badge: "WhatsApp",
      text: "Practise alongside advocates who use AI every day. Release notes and roadmap polls land there first.",
      cta: "Join on WhatsApp",
      href: "/community",
    },
  },
  { label: "Pricing", href: "#pricing" },
  { label: "Bare Acts", href: "/acts" },
  { label: "Blog", href: "/blogs" },
  { label: "Team", href: "/team" },
  {
    label: "Bench Wire News & Hub",
    lines: ["Bench Wire", "News & Hub"],
    href: "/content-hub/stories?topic=news-updates",
  },
];

export const FEATURE_IMAGES: Record<NavFeature["image"], string> = {
  product: "/brand/menu-product.jpg",
  solutions: "/brand/menu-solutions.jpg",
  resources: "/brand/menu-resources.jpg",
};

export type FooterLinkType = "route" | "anchor" | "demo" | "external" | "plain";

export interface FooterLink {
  title: string;
  href: string;
  type: FooterLinkType;
}

export const FOOTER_COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { title: "Create Case", href: "/products/create-case", type: "route" },
      { title: "Case Storage", href: "/products/case-storage", type: "route" },
      { title: "Quick Chat", href: "/products/quick-chat", type: "route" },
      { title: "AI Drafting", href: "/products/ai-drafting", type: "route" },
      { title: "Citation Research", href: "/products/citation-research", type: "route" },
      { title: "All Products", href: "/products", type: "route" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { title: "Solo Practitioners", href: "#solutions", type: "anchor" },
      { title: "Law Firms & Enterprises", href: "#solutions", type: "anchor" },
      { title: "Built for Indian Courts", href: "#indian-courts", type: "anchor" },
      { title: "Security & Trust", href: "#security", type: "anchor" },
      { title: "Pricing", href: "#pricing", type: "anchor" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { title: "Bare Acts", href: "/acts", type: "plain" },
      { title: "Blogs", href: "/blogs", type: "route" },
      { title: "FAQs", href: "/faqs", type: "route" },
      { title: "WhatsApp Community", href: "/community", type: "route" },
      { title: "Get Help", href: "/help", type: "route" },
      { title: "Contact Us", href: "/contact", type: "route" },
    ],
  },
  {
    heading: "Company",
    links: [
      { title: "Why Jurinex", href: "#why", type: "anchor" },
      { title: "Team", href: "/team", type: "route" },
      { title: "Book a Demo", href: "demo", type: "demo" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { title: "Terms of Services", href: "https://drive.google.com/open?id=1BTXf-YUiOjQiJmdwM9QS0GCgbGUXRBOO&usp=drive_copy", type: "external" },
      { title: "Master Service Agreement", href: "https://drive.google.com/open?id=1iUYu1fDiqp95_GV16G8w_Su-EIgBg4aT&usp=drive_copy", type: "external" },
      { title: "DPA", href: "https://drive.google.com/open?id=1MEYVdK5NtlqkhlhPrCi_q4o6zCvsyBTP&usp=drive_copy", type: "external" },
      { title: "Privacy Policy", href: "https://drive.google.com/open?id=10RKK0Eh7ybm0mRNpbsDx4ecMs5ymedWa&usp=drive_copy", type: "external" },
      { title: "Data Security Policy", href: "https://drive.google.com/open?id=1X0qE1gpz-oVfy9qfL7UdIhcoLezhIEeZ&usp=drive_copy", type: "external" },
      { title: "Disclosures", href: "https://drive.google.com/open?id=11oc-dhaFbjhPtraRuYucjfOtnE5WqQj4&usp=drive_copy", type: "external" },
      { title: "Cookie Policy", href: "https://drive.google.com/open?id=1iKeGRa0w86ERuGJLYRSaAFnw7H1fYeNS&usp=drive_copy", type: "external" },
      { title: "Refund Policy", href: "https://drive.google.com/open?id=1ryZoxjk55ESOU4QaSximCarJe2236DAC&usp=drive_copy", type: "external" },
    ],
  },
];

export const NEWSLETTER_COPY = {
  eyebrow: "Newsletter",
  title: "Practice notes, once a month.",
  text: "Product updates, drafting tips and Indian legal-AI news. No spam, unsubscribe any time.",
  placeholder: "Your work email",
  button: "Subscribe",
  thanks: "Thanks, you're on the list.",
};

export const SOCIAL_LINKS = [
  { label: "Instagram", icon: "Instagram", href: "https://www.instagram.com/jurinex_/" },
  { label: "Facebook", icon: "Facebook", href: "https://www.facebook.com/share/19VmrVEWYM" },
  { label: "X", icon: "x", href: "https://x.com/nexintel_ai" },
  { label: "LinkedIn", icon: "Linkedin", href: "https://www.linkedin.com/company/jurinex" },
  { label: "YouTube", icon: "Youtube", href: "https://www.youtube.com/@JuriNex_ai" },
  { label: "Pinterest", icon: "pinterest", href: "https://in.pinterest.com/nexintel_ai/" },
];

export const CONTACT_INFO = {
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

/**
 * Hrefs in the constants are written for the React app (routes and in-page
 * anchors on the landing page). From the Bare Acts pages every one of them is
 * a full navigation into the React app, so anchors become "/#id".
 */
export function toReactHref(href: string): string {
  if (!href) return "/";
  if (href.startsWith("#")) return `/${href}`;
  return href;
}
