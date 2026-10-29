/**
 * Side-by-side comparison shown on /compare/jurinex-vs-alternatives.
 * Jurinex prices match the published plans in PricingSection.
 * Competitor cells summarise publicly described products and list prices.
 *
 * tone: "brand" highlighted Jurinex claim, "yes" confirmed capability,
 * "no" missing capability, "warn" unpublished or gated, "muted" unknown.
 */
export const COMPARE_COLUMNS = [
  { key: "jurinex", label: "Jurinex", sub: "jurinex.ai", highlight: true },
  { key: "claw", label: "Claw / VakilAI" },
  { key: "nyaya", label: "Nyayanidhi / NyayAssist" },
  { key: "manupatra", label: "Manupatra / SCC Online" },
  { key: "harvey", label: "Harvey / ChatGPT" },
]

export const COMPARE_ROWS = [
  {
    feature: "Primary Architecture",
    cells: {
      jurinex: { tone: "brand", text: "Full-Stack AI Legal OS (OCR + RAG + Drafting + Vault)" },
      claw: { text: "Point Tools (Tracking or Writ-only)" },
      nyaya: { text: "Litigation OS / WhatsApp Bot" },
      manupatra: { text: "Case Law Research DB" },
      harvey: { text: "Western / Generic LLM" },
    },
  },
  {
    feature: "Vernacular OCR (Marathi, Hindi, Tamil, Telugu)",
    cells: {
      jurinex: { tone: "yes", text: "Yes (95%+ on faded FIRs & 7/12 extracts)" },
      claw: { tone: "muted", text: "Unconfirmed" },
      nyaya: { tone: "muted", text: "Unconfirmed" },
      manupatra: { tone: "no", text: "No Client File OCR" },
      harvey: { tone: "no", text: "English Bias" },
    },
  },
  {
    feature: "Zero-Hallucination Citation Verification",
    cells: {
      jurinex: { tone: "yes", text: "Verified via Indian Kanoon API + Amber Flags" },
      claw: { text: "Standard LLM / Writ-focused" },
      nyaya: { tone: "warn", text: "Claimed / Unverified" },
      manupatra: { text: "Manual Search Only" },
      harvey: { tone: "no", text: "High Hallucination Risk" },
    },
  },
  {
    feature: "Indian Court Bench Formatting",
    cells: {
      jurinex: { tone: "yes", text: "District, Tribunals, High Courts & SC" },
      claw: { text: "Partial (SC/HC Writs)" },
      nyaya: { text: "Yes" },
      manupatra: { tone: "no", text: "No Drafting" },
      harvey: { tone: "no", text: "US/UK Formats Only" },
    },
  },
  {
    feature: "100% India Data Residency (DPDP Compliant)",
    cells: {
      jurinex: { tone: "yes", text: "GCP Mumbai (asia-south1) + Encrypted Vault" },
      claw: { text: "Cloud SaaS" },
      nyaya: { text: "Cloud SaaS" },
      manupatra: { text: "Cloud SaaS" },
      harvey: { tone: "no", text: "Cross-Border US Servers" },
    },
  },
  {
    feature: "Published Entry Pricing",
    cells: {
      jurinex: { tone: "brand", text: "₹3,100/mo (Lite) · ₹5,100 (Plus) · ₹7,500 (Pro)" },
      claw: { lines: ["Claw: ₹9k–13k/yr", "VakilAI: Hidden"] },
      nyaya: { tone: "warn", text: "Demo-Gated / Not Published" },
      manupatra: { text: "₹14,250–₹55,480/yr (+ ₹18.5k AI Pro)" },
      harvey: { text: "USD Enterprise ($100+/mo)" },
    },
  },
]
