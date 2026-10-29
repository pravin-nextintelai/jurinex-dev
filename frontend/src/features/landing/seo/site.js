/**
 * Canonical site facts for SEO and generative-engine optimization.
 *
 * Host contract for the website developer
 * ---------------------------------------
 * 1. Publish only on https://jurinex.ai. Redirect http and any www host
 *    to that origin with a 301. Do not add a trailing slash.
 * 2. Serve /robots.txt, /sitemap.xml and /llms.txt from the site root.
 *    The production build writes them, plus one HTML file per public URL.
 * 3. Prefer that HTML file before the shared SPA shell:
 *    try_files $uri $uri.html $uri/index.html /index.html;
 *    `serve -s` with frontend/public/serve.json (cleanUrls) does this.
 *    Each file has its own title, canonical, JSON-LD and article text,
 *    and still boots the React app.
 * 4. Submit https://jurinex.ai/sitemap.xml in Google Search Console
 *    and Bing Webmaster Tools. Leave AI crawlers allowed on public URLs
 *    (see robots.txt) and disallowed on signed-in routes.
 * 5. Keep the public name, address and phone identical everywhere:
 *    NexIntel AI Pvt Ltd, B11 MIDC, Chhatrapati Sambhajinagar,
 *    Maharashtra 431010, +91 9684027372, connect@jurinex.ai.
 *    The office pin below is the city centroid, used only as a geo hint.
 *    The postal address is the location to cite.
 */

import { CONTACT_INFO, SOCIAL_LINKS } from "../utils/landingConstants.js"

export const SITE = {
  origin: "https://jurinex.ai",
  name: "Jurinex",
  legalName: CONTACT_INFO.company,
  locale: "en-IN",
  ogLocale: "en_IN",
  inLanguage: ["en-IN", "hi", "mr", "ta", "te"],
  email: CONTACT_INFO.email,
  phone: "+91-96840-27372",
  phoneDisplay: CONTACT_INFO.phone,
  cin: CONTACT_INFO.cin,
  gstin: CONTACT_INFO.gstin,
  streetAddress: "B11, Near Railway Station Road, MIDC",
  locality: "Chhatrapati Sambhajinagar",
  regionName: "Maharashtra",
  regionCode: "IN-MH",
  postalCode: "431010",
  country: "IN",
  /** City centroid for Chhatrapati Sambhajinagar. Not a surveyed door pin. */
  latitude: 19.8762,
  longitude: 75.3433,
  sameAs: SOCIAL_LINKS.map((s) => s.href),
  iconPath: "/jurinex-icon.png",
}

/** ISO region and principal seat. Used on court pages only. */
export const COURT_PLACES = {
  allahabad: ["IN-UP", "Prayagraj"],
  "andhra-pradesh": ["IN-AP", "Amaravati"],
  bombay: ["IN-MH", "Mumbai"],
  calcutta: ["IN-WB", "Kolkata"],
  chhattisgarh: ["IN-CG", "Bilaspur"],
  delhi: ["IN-DL", "New Delhi"],
  gauhati: ["IN-AS", "Guwahati"],
  gujarat: ["IN-GJ", "Ahmedabad"],
  "himachal-pradesh": ["IN-HP", "Shimla"],
  "jammu-kashmir-ladakh": ["IN-JK", "Srinagar"],
  jharkhand: ["IN-JH", "Ranchi"],
  karnataka: ["IN-KA", "Bengaluru"],
  kerala: ["IN-KL", "Kochi"],
  "madhya-pradesh": ["IN-MP", "Jabalpur"],
  madras: ["IN-TN", "Chennai"],
  manipur: ["IN-MN", "Imphal"],
  meghalaya: ["IN-ML", "Shillong"],
  orissa: ["IN-OD", "Cuttack"],
  patna: ["IN-BR", "Patna"],
  "punjab-haryana": ["IN-CH", "Chandigarh"],
  rajasthan: ["IN-RJ", "Jodhpur"],
  sikkim: ["IN-SK", "Gangtok"],
  telangana: ["IN-TG", "Hyderabad"],
  tripura: ["IN-TR", "Agartala"],
  uttarakhand: ["IN-UT", "Nainital"],
  "supreme-court": ["IN-DL", "New Delhi"],
}

/** Signed-in and account URLs. Disallowed in robots.txt and marked noindex. */
export const PRIVATE_PREFIXES = [
  "/login",
  "/register",
  "/set-password",
  "/dashboard",
  "/cases/",
  "/chatmodel",
  "/chats",
  "/analysis",
  "/tools",
  "/draft",
  "/template-drafting",
  "/build-template",
  "/citation",
  "/case-storage",
  "/documents",
  "/billing-usage",
  "/subscription-plans",
  "/settings",
  "/user-management",
  "/branding",
  "/translation",
  "/timeline",
  "/batch-request",
  "/get-help",
  "/evidence-matrix",
  "/ground-summary",
  "/enterprise-analytics",
  "/auth/",
]

export const absoluteUrl = (path = "/") => {
  if (!path || path === "/") return `${SITE.origin}/`
  return `${SITE.origin}${path.startsWith("/") ? path : `/${path}`}`
}

export const toPublicHref = (href) => {
  if (!href) return "/"
  if (href.startsWith("#")) return `/${href}`
  return href
}

export const isModifiedClick = (event) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
