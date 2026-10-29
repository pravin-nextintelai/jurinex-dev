import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import PropTypes from "prop-types"
import { Icon, Reveal } from "./primitives"
import { EASE } from "./motionTokens"

/* ------------------------------------------------------------------ */
/* Free Legal Micro-Tools hub — four product-led tools directly under  */
/* the hero. Styled on the landing design system (nx-*): editorial     */
/* serif headings, teal accent, hairline cards. All data below is demo */
/* data ported verbatim from the Jurinex micro-tools prototype.        */
/* ------------------------------------------------------------------ */

// 1. Database of IPC/CrPC/IEA -> BNS/BNSS/BSA Mappings for Tool #1
const STATUTE_DATABASE = [
  {
    id: "IPC_420",
    codeType: "IPC",
    oldSection: "Section 420 IPC",
    newSection: "Section 318(4) BNS, 2023",
    title: "Cheating and dishonestly inducing delivery of property",
    punishment: "Imprisonment up to 7 years and fine (Unchanged)",
    keyChange:
      "Consolidated under Clause 318 of Bharatiya Nyaya Sanhita (Cheating). Sub-section (4) specifically covers dishonestly inducing delivery of property or valuable security.",
    footnote:
      "Note: Offence under erstwhile Section 420 of the Indian Penal Code, 1860 corresponds to Section 318(4) of the Bharatiya Nyaya Sanhita, 2023 (Verified via Jurinex Zero-Hallucination Statute Engine).",
  },
  {
    id: "CRPC_438",
    codeType: "CRPC",
    oldSection: "Section 438 CrPC",
    newSection: "Section 482 BNSS, 2023",
    title: "Direction for grant of bail to person apprehending arrest (Anticipatory Bail)",
    punishment: "Procedural Remedy (Sessions Court / High Court)",
    keyChange:
      "Streamlined conditions under Section 482 of Bharatiya Nagarik Suraksha Sanhita; bars anticipatory bail in offences punishable with death or life imprisonment under specific gang/sexual offence subsections.",
    footnote:
      "Note: Application under Section 482 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (corresponding to erstwhile Section 438 of the Code of Criminal Procedure, 1973).",
  },
  {
    id: "CRPC_482",
    codeType: "CRPC",
    oldSection: "Section 482 CrPC",
    newSection: "Section 528 BNSS, 2023",
    title: "Saving of inherent powers of High Court (Quashing of FIR / Charge Sheet)",
    punishment: "Inherent High Court Jurisdiction",
    keyChange:
      "Verbatim preservation of the High Court’s inherent powers to prevent abuse of process of any Court or otherwise to secure the ends of justice.",
    footnote:
      "Note: Invoking inherent jurisdiction of this Hon’ble High Court under Section 528 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (erstwhile Section 482 CrPC).",
  },
  {
    id: "IEA_65B",
    codeType: "IEA",
    oldSection: "Section 65B IEA",
    newSection: "Section 63 BSA, 2023",
    title: "Admissibility of Electronic or Digital Records (Certificate)",
    punishment: "Evidentiary Rule (Mandatory Hash/Metadata Certificate)",
    keyChange:
      "Expanded scope covering semiconductor memories, cloud servers, communication devices, and requires structured Schedule certificate verifying hash value and device control.",
    footnote:
      "Note: Electronic record accompanied by mandatory certificate under Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 (erstwhile Section 65B of the Indian Evidence Act, 1872).",
  },
  {
    id: "IPC_302",
    codeType: "IPC",
    oldSection: "Section 302 IPC",
    newSection: "Section 103(1) BNS, 2023",
    title: "Punishment for Murder",
    punishment: "Death or imprisonment for life, and fine",
    keyChange:
      "Section 103(2) introduces a distinct sub-provision for murder committed by a group of 5 or more persons (mob lynching) acting in concert.",
    footnote:
      "Note: Offence punishable under Section 103(1) of the Bharatiya Nyaya Sanhita, 2023 (corresponding to erstwhile Section 302 of the Indian Penal Code, 1860).",
  },
  {
    id: "IPC_406",
    codeType: "IPC",
    oldSection: "Section 406 IPC",
    newSection: "Section 316(2) BNS, 2023",
    title: "Criminal Breach of Trust",
    punishment:
      "Imprisonment up to 5 years (increased from 3 years under old IPC 406), or fine, or both",
    keyChange:
      "CRITICAL CHANGE: Maximum punishment for general criminal breach of trust enhanced from 3 years (IPC 406) to 5 years under Section 316(2) BNS.",
    footnote:
      "Note: Offence under Section 316(2) of the Bharatiya Nyaya Sanhita, 2023 (erstwhile Section 406 IPC; note statutory enhancement of maximum sentence from 3 to 5 years).",
  },
  {
    id: "CRPC_173",
    codeType: "CRPC",
    oldSection: "Section 173 CrPC",
    newSection: "Section 193 BNSS, 2023",
    title: "Report of Police Officer on Completion of Investigation (Charge Sheet)",
    punishment: "Procedural Mandate (90-day timeline + Electronic supply of police report)",
    keyChange:
      "Mandates electronic communication of police report and victim progress updates within 90 days.",
    footnote:
      "Note: Final Police Report / Charge Sheet filed under Section 193 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (erstwhile Section 173 CrPC).",
  },
]

// 2. Vernacular OCR Sample Datasets for Tool #2
const VERNACULAR_SAMPLES = {
  MARATHI_FIR: {
    docTitle: "Kranti_Chowk_PS_FIR_0194_Satbara.pdf",
    language: "Marathi / Devanagari",
    totalPages: 340,
    rawText:
      '"दिनांक १४/०८/२०२६ रोजी फिर्यादी श्री. राजेश कुलकर्णी यांनी तक्रार दाखल केली की गट क्र. १४२, सातबारा (७/१२) उतारा मधील जमिनीबाबत बनावट कुलमुखत्यारपत्र तयार करून रक्कम रु. ४५,००,०००/- चा अपहार केला..."',
    rows: [
      {
        date: "12/05/2026",
        event:
          "Execution of registered Sale Agreement regarding agricultural land at Gut No. 142 (7/12 Satbara Extract verified in Marathi).",
        page: "Annex P-1 (Pg 2)",
      },
      {
        date: "28/07/2026",
        event:
          "Alleged fabrication of notarized Power of Attorney (कुलमुखत्यारपत्र) bearing disputed thumb impression and rubber stamp.",
        page: "Annex P-2 (Pg 7)",
      },
      {
        date: "14/08/2026",
        event:
          "Registration of FIR No. 0194/2026 at Kranti Chowk Police Station under Sec 318(4), 316(2) BNS (erstwhile 420, 406 IPC).",
        page: "Annex P-3 (Pg 11)",
      },
    ],
  },
  HINDI_CHARGESHEET: {
    docTitle: "PS_Connaught_Place_Final_Report_Sec193.pdf",
    language: "Hindi / Devanagari",
    totalPages: 480,
    rawText:
      '"अंतिम रिपोर्ट धारा १९३ भारतीय नागरिक सुरक्षा संहिता: दिनांक ०३/०७/२०२६ को शिकायतकर्ता द्वारा प्रस्तुत बैंक स्टेटमेंट एवं गवाह संख्या २ के बयान से यह स्पष्ट है कि..."',
    rows: [
      {
        date: "03/07/2026",
        event:
          "Written complaint submitted regarding commercial supply dispute of ₹1.20 Crore with ledger annexures.",
        page: "Part I (Pg 4)",
      },
      {
        date: "19/07/2026",
        event:
          "Notice for appearance issued under Section 35(3) BNSS (erstwhile Section 41A CrPC) duly complied with by Applicant.",
        page: "Part II (Pg 38)",
      },
      {
        date: "05/08/2026",
        event:
          "Recording of Section 180 BNSS witness statements; zero recovery of incriminating article from Applicant’s premises.",
        page: "Part III (Pg 92)",
      },
    ],
  },
  TAMIL_LAND_WRIT: {
    docTitle: "Chengalpattu_Tahsildar_Patta_Order_2026.pdf",
    language: "Tamil + English",
    totalPages: 210,
    rawText:
      '"காஞ்சிபுரம் மாவட்டம், செங்கல்பட்டு வட்டம், புல எண் 84/2B பட்டா மாறுதல் தொடர்பான வட்டாட்சியர் செயல்முறை ஆணை..."',
    rows: [
      {
        date: "10/04/2026",
        event:
          "Representation submitted by Petitioner to Tahsildar seeking restoration of Patta No. 419 for Survey No. 84/2B.",
        page: "Typed Set (Pg 5)",
      },
      {
        date: "22/06/2026",
        event:
          "Impugned order passed cancelling sub-division Patta without affording personal hearing (violation of natural justice).",
        page: "Typed Set (Pg 14)",
      },
      {
        date: "18/08/2026",
        event:
          "Statutory appeal preferred before Revenue Divisional Officer (RDO) kept pending without interim stay.",
        page: "Typed Set (Pg 29)",
      },
    ],
  },
}

const OCR_SAMPLE_BUTTONS = [
  {
    key: "MARATHI_FIR",
    title: "Marathi FIR & Panchnama",
    court: "Chhatrapati Sambhajinagar / Bombay HC",
    sub: "340-page scanned charge sheet + 7/12 Satbara extract (Devanagari)",
  },
  {
    key: "HINDI_CHARGESHEET",
    title: "Hindi Police Report & Witness Statements",
    court: "Delhi / Allahabad HC",
    sub: "480-page Sec 193 BNSS (173 CrPC) final report + medical certificate",
  },
  {
    key: "TAMIL_LAND_WRIT",
    title: "Tamil Patta / Chitta Revenue Record & Writ File",
    court: "Madras HC",
    sub: "210-page land acquisition dispute & Tahsildar proceedings",
  },
]

// 3. Bench Validation Rules for Tool #3
const BENCH_RULES = {
  BOMBAY_HC: {
    name: "Bombay High Court (Mumbai / Aurangabad / Nagpur Benches)",
    paperSpec:
      "Legal / A4 Green Ledger or Standard White A4 (as per 2026 e-Filing Notification), Font: Times New Roman / Georgia 14pt, 1.5 Line Spacing, Left Margin 1.5 inch.",
    sequence: [
      "Index (with exact page numbers)",
      "Synopsis & Chronological List of Dates & Events",
      "Memo of Writ Petition / Application under Art. 226 / Sec 482 BNSS",
      "Grounds (Alphabetically numbered A, B, C...)",
      "Prayer & Interim Relief Clause",
      "Solemn Affirmation / Verification Affidavit",
      'Annexures Marked Exhibit "A", "B", "C"',
    ],
    verifiedCitation:
      "Arnesh Kumar v. State of Bihar, (2014) 8 SCC 273 & Satender Kumar Antil v. CBI, (2022) 10 SCC 51",
    flaggedWarning:
      'Unverified ChatGPT citation "2024 SCC OnLine Bom 99912" does not exist in primary repository — automatically blocked by Jurinex Zero-Hallucination Engine.',
  },
  DELHI_HC: {
    name: "High Court of Delhi (Mandatory e-Filing Standard)",
    paperSpec:
      "A4 Size, Font: Times New Roman 14pt, Double Line Spacing (2.0), Margin: Left 4 cm, Right 2.5 cm, Top 3 cm, Bottom 3 cm. OCR Searchable PDF/A mandatory.",
    sequence: [
      "Urgent Application & Notice of Motion",
      "Memo of Parties (with complete email & WhatsApp number)",
      "Synopsis & List of Dates (Mandatory chronological table)",
      "Main Petition with Non-Filing Certificate",
      "Supporting Affidavit + Sec 63 BSA Certificate (if electronic annexures)",
    ],
    verifiedCitation: "Bhajan Lal v. State of Haryana, 1992 Supp (1) SCC 335",
    flaggedWarning:
      "Missing mandatory paragraph certifying that no similar petition has been filed before the Supreme Court or any other High Court.",
  },
  MADRAS_HC: {
    name: "Madras High Court (Principal Seat & Madurai Bench)",
    paperSpec:
      "A4 White Paper, Font: 12pt/14pt, 1.5 Spacing, Separate Coding Sheet + Affidavit of Petitioner + Memorandum of Writ Petition + Typed Set of Papers.",
    sequence: [
      "Coding Sheet & Batta Memo",
      "Affidavit of the Petitioner (First Person narrative)",
      "Writ Petition Memo with Prayer for Writ of Certiorari/Mandamus",
      "Chronological Typed Set of Documents with Tamil-to-English translated copies",
    ],
    verifiedCitation: "Whirlpool Corporation v. Registrar of Trade Marks, (1998) 8 SCC 1",
    flaggedWarning:
      "Tamil revenue exhibits on Pages 14–19 require certified English translation copies in the Typed Set.",
  },
  SC_INDIA: {
    name: "Supreme Court of India (Article 136 SLP Format)",
    paperSpec:
      "A4 Size, Times New Roman 14pt, 1.5 Line Spacing, Impugned High Court Judgment placed immediately after List of Dates.",
    sequence: [
      "Cover Page & Index",
      "Office Report on Limitation",
      "Synopsis & List of Dates (Crucial: 70% of SLP admission relies on this section)",
      "Impugned Judgment & Order of High Court",
      "Questions of Law & Grounds in Form 28",
      "Main Prayer & Interim Relief",
      "Certificate by Advocate-on-Record (AoR)",
    ],
    verifiedCitation: "Siddharth v. State of Uttar Pradesh, (2022) 1 SCC 676",
    flaggedWarning:
      "Ensure Questions of Law are framed as general principles of statutory interpretation rather than pure findings of fact.",
  },
  NCLT: {
    name: "National Company Law Tribunal (NCLT — IBC / Companies Act)",
    paperSpec:
      "Form 1 (Financial Creditor Sec 7) or Form 5 (Operational Creditor Sec 9), Master Data from MCA21, NeSL Information Utility Record of Default.",
    sequence: [
      "Index & Master Data of Corporate Debtor",
      "Synopsis & Chronology of Debt and Default",
      "Statutory Form (Form 1 / Form 5) Parts I to V",
      "Computation Table of Default Amount & Date of Default",
      "NeSL Record of Default + Bank Certificate",
    ],
    verifiedCitation: "Innoventive Industries Ltd. v. ICICI Bank, (2018) 1 SCC 407",
    flaggedWarning:
      "Date of Default in Part IV must explicitly exclude the Section 10A COVID-19 suspension window.",
  },
}

const TOOL_TABS = [
  {
    id: 1,
    icon: "ArrowLeftRight",
    label: "Statute Mapper",
    tag: "Statute Mapper",
    title: "IPC / CrPC / IEA ↔ BNS / BNSS / BSA",
    desc: "Instant section conversion, statutory changes and a ready-to-paste court transition footnote.",
  },
  {
    id: 2,
    icon: "ScanText",
    label: "Vernacular OCR",
    tag: "Vernacular OCR",
    title: "FIR, Charge Sheet & 7/12 Sandbox",
    desc: "Marathi, Hindi, Tamil and Telugu scans to an English List of Dates in 30 seconds.",
  },
  {
    id: 3,
    icon: "FileCheck2",
    label: "Bench Validator",
    tag: "Bench Validator",
    title: "Court Format & Citation Check",
    desc: "Margins, filing sequence and zero-hallucination citation checks, bench by bench.",
  },
  {
    id: 4,
    icon: "CalendarClock",
    label: "Limitation",
    tag: "Limitation Calculator",
    title: "Filing Deadline Calculator",
    desc: "Exact last date of filing after excluding Section 12 certified-copy time.",
  },
]

/* Single brand accent for every card: teal tile, neutral pill, ink title. */
const ACCENT = {
  pill: "bg-nx-pale text-nx-muted ring-nx-line",
  tile: "bg-nx-teal text-white shadow-teal-500/30",
  bar: "bg-nx-teal",
  active: "border-nx-teal ring-nx-teal/15",
  title: "text-nx-ink",
  link: "text-nx-teal-ink",
}

const TRUST_ROW = [
  { icon: "BadgeCheck", text: "Citations verified via Indian Kanoon" },
  { icon: "ShieldCheck", text: "100% India data residency (GCP Mumbai)" },
  { icon: "Languages", text: "Marathi, Hindi, Tamil, Telugu OCR" },
  { icon: "Lock", text: "No sign-up needed to try" },
]

const DEFAULT_PLEADING =
  "The Applicant is filing this Anticipatory Bail application under Section 438 of CrPC in connection with FIR registered for offences under Section 420, Section 406 and Section 120B of IPC, supported by electronic certificate under Section 65B of Indian Evidence Act."

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const temp = document.createElement("textarea")
    temp.value = text
    document.body.appendChild(temp)
    temp.select()
    document.execCommand("copy")
    document.body.removeChild(temp)
  }
}


/* ----------------------------- UI atoms ----------------------------- */
/* Product-console treatment: white surfaces, hairline borders, light   */
/* teal accents, serif headings. No decorative numerals or dark blocks.  */

const FIELD =
  "w-full rounded-lg border border-nx-line bg-white px-3.5 py-2.5 text-sm text-nx-ink placeholder:text-nx-faint transition-colors focus:border-nx-teal focus:outline-none focus:ring-2 focus:ring-nx-teal/15"

const FieldLabel = ({ children }) => (
  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-muted">{children}</label>
)

const Card = ({ className = "", children }) => (
  <div className={`rounded-lg border border-nx-line bg-nx-pale/50 ${className}`}>{children}</div>
)

const CardLabel = ({ children, tone = "faint" }) => (
  <div
    className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${tone === "teal" ? "text-nx-teal-ink" : "text-nx-faint"
      }`}
  >
    {children}
  </div>
)

const Tag = ({ icon, children, tone = "neutral" }) => {
  const tones = {
    neutral: "border-nx-line bg-white text-nx-muted",
    teal: "border-teal-200 bg-teal-50 text-nx-teal-ink",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}
    >
      {icon && <Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2} />}
      {children}
    </span>
  )
}

const InkButton = ({ children, onClick, icon, className = "", variant = "solid" }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal ${variant === "solid"
        ? "border-nx-teal bg-nx-teal text-white hover:border-nx-teal-deep hover:bg-nx-teal-deep"
        : "border-nx-ink/20 bg-white text-nx-ink hover:border-nx-ink hover:bg-nx-ink hover:text-white"
      } ${className}`}
  >
    {children}
    {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
  </button>
)

/* Compact tool header: eyebrow, serif title and badge on one row, lede below. */
const PanelHeader = ({ eyebrow, title, lede, badge, badgeIcon, meta }) => (
  <div className="border-b border-nx-line bg-gradient-to-r from-teal-50/70 to-white px-6 py-6 sm:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nx-teal-ink">{eyebrow}</p>
        <h3 className="mt-1.5 font-display text-xl font-semibold leading-snug text-nx-ink sm:text-2xl">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-nx-muted">{lede}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <Tag icon={badgeIcon} tone="teal">
          {badge}
        </Tag>
        {meta && <span className="text-[11px] text-nx-faint">{meta}</span>}
      </div>
    </div>
  </div>
)

/* Closing prompt under each tool: light teal band with one solid button. */
const ConversionBanner = ({ title, body, cta, onClick }) => (
  <div className="flex flex-col gap-4 rounded-lg border border-teal-200 bg-teal-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
    <div className="min-w-0">
      <div className="font-display text-base font-semibold text-nx-ink">{title}</div>
      <p className="mt-1 max-w-xl text-xs leading-relaxed text-nx-muted">{body}</p>
    </div>
    <InkButton onClick={onClick} icon="ArrowRight" className="flex-none">
      {cta}
    </InkButton>
  </div>
)

/* Right-hand result surface shared by every tool. */
const ResultPane = ({ children, className = "" }) => (
  <div
    className={`flex flex-col justify-between gap-5 rounded-xl border border-nx-line border-t-4 border-t-nx-teal bg-white p-5 shadow-[0_24px_56px_-36px_rgba(16,20,19,0.35)] ${className}`}
  >
    {children}
  </div>
)

/* ------------------------------ Tool #1 ------------------------------ */

const StatuteMapperPanel = ({ onOpenTrial, showToast }) => {
  const [codeFilter, setCodeFilter] = useState("ALL")
  const [query, setQuery] = useState("")
  const [pleading, setPleading] = useState(DEFAULT_PLEADING)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = STATUTE_DATABASE.filter((item) => {
      const matchesCode = codeFilter === "ALL" || item.codeType === codeFilter
      const matchesQuery =
        !q ||
        item.oldSection.toLowerCase().includes(q) ||
        item.newSection.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q)
      return matchesCode && matchesQuery
    })
    return list.length ? list : STATUTE_DATABASE
  }, [codeFilter, query])

  const [selectedId, setSelectedId] = useState(STATUTE_DATABASE[0].id)
  useEffect(() => {
    setSelectedId(filtered[0].id)
  }, [filtered])

  const item = STATUTE_DATABASE.find((s) => s.id === selectedId) || filtered[0]

  const convertPleading = () => {
    const text = pleading
      .replace(/Section 438 of CrPC|Section 438 CrPC/gi, "Section 482 of BNSS, 2023 (erstwhile Sec 438 CrPC)")
      .replace(/Section 420/gi, "Section 318(4) BNS (erstwhile Sec 420 IPC)")
      .replace(/Section 406/gi, "Section 316(2) BNS (erstwhile Sec 406 IPC)")
      .replace(/Section 120B of IPC|Section 120B IPC/gi, "Section 61(2) of BNS, 2023 (erstwhile Sec 120B IPC)")
      .replace(/Section 65B of Indian Evidence Act|Section 65B IEA/gi, "Section 63 of BSA, 2023 (erstwhile Sec 65B IEA)")
    setPleading(text)
    showToast("Pleading paragraph updated with verified BNS, BNSS and BSA sections.")
  }

  return (
    <>
      <PanelHeader
        eyebrow="Tool I · Statute Mapper"
        title="Corresponding Provisions under the BNS, BNSS and BSA"
        lede="Search any provision of the IPC, CrPC or Evidence Act, or select a frequently cited section, to view the corresponding provision under the 2023 Sanhitas together with a footnote suitable for pleadings."
        badge="Verified against primary statute"
        badgeIcon="BadgeCheck"
        meta="Source: Gazette of India texts of the 2023 Sanhitas"
      />

      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-5">
          <div>
            <FieldLabel>Code and section</FieldLabel>
            <div className="flex gap-2">
              <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} className={`${FIELD} w-auto font-medium`}>
                <option value="ALL">All codes</option>
                <option value="IPC">IPC → BNS</option>
                <option value="CRPC">CrPC → BNSS</option>
                <option value="IEA">IEA → BSA</option>
              </select>
              <div className="relative flex-1">
                <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nx-faint" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. 420, 438, 65B, 302"
                  className={`${FIELD} pl-9`}
                />
              </div>
            </div>
          </div>

          <div>
            <FieldLabel>Frequently cited provisions</FieldLabel>
            <ul className="divide-y divide-nx-line overflow-hidden rounded-lg border border-nx-line bg-white">
              {filtered.map((s) => {
                const on = s.id === item.id
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      aria-pressed={on}
                      className={`group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors ${on ? "bg-nx-teal text-white" : "text-nx-ink hover:bg-nx-pale"
                        }`}
                    >
                      <span className="min-w-0 truncate font-medium">{s.oldSection}</span>
                      <span className={`flex flex-none items-center gap-2 ${on ? "text-white/80" : "text-nx-muted"}`}>
                        <span className="font-display italic">now</span>
                        <span className="font-medium">{s.newSection.split(",")[0]}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="border-t border-nx-line pt-6">
            <FieldLabel>Update an existing pleading</FieldLabel>
            <textarea
              rows={4}
              value={pleading}
              onChange={(e) => setPleading(e.target.value)}
              className={`${FIELD} text-xs leading-relaxed`}
            />
            <InkButton onClick={convertPleading} variant="outline" className="mt-3 w-full">
              Substitute corresponding provisions
            </InkButton>
          </div>
        </div>

        <ResultPane className="lg:col-span-7">
          <div>
            <CardLabel tone="teal">Result</CardLabel>
            <h4 className="mt-1.5 font-display text-lg font-medium leading-snug text-nx-ink">{item.title}</h4>

            {/* Erstwhile / corresponding provision, laid out like a statutory table */}
            <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-lg border border-nx-line bg-white sm:grid-cols-2">
              <div className="border-b border-nx-line p-4 sm:border-b-0 sm:border-r">
                <CardLabel>Erstwhile provision</CardLabel>
                <div className="mt-1.5 font-display text-xl text-nx-muted line-through decoration-nx-faint/70 decoration-1">
                  {item.oldSection}
                </div>
                <div className="mt-1 text-[11px] italic text-nx-faint">Repealed w.e.f. 1 July 2024</div>
              </div>
              <div className="relative bg-teal-50/70 p-4">
                <Icon name="BadgeCheck" className="absolute right-4 top-4 h-5 w-5 text-nx-teal" strokeWidth={1.75} />
                <CardLabel tone="teal">Corresponding provision</CardLabel>
                <div className="mt-1.5 font-display text-xl font-medium text-nx-ink">{item.newSection}</div>
                <div className="mt-1 text-[11px] italic text-nx-teal-ink">In force</div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <Card className="p-4">
                <dt>
                  <CardLabel>Punishment / scope</CardLabel>
                </dt>
                <dd className="mt-1.5 font-medium leading-relaxed text-nx-ink">{item.punishment}</dd>
              </Card>
              <Card className="p-4">
                <dt>
                  <CardLabel>Material change</CardLabel>
                </dt>
                <dd className="mt-1.5 leading-relaxed text-nx-muted">{item.keyChange}</dd>
              </Card>
            </dl>

            <Card className="mt-4 p-4">
              <div className="mb-2 flex items-center justify-between">
                <CardLabel>Footnote for pleadings</CardLabel>
                <button
                  type="button"
                  onClick={() => {
                    copyToClipboard(item.footnote)
                    showToast("Footnote copied to clipboard.")
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-nx-teal-ink hover:text-nx-teal-deep"
                >
                  <Icon name="Copy" className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>
              <p className="border-l-2 border-nx-teal/50 pl-3 font-display text-[13px] italic leading-relaxed text-nx-ink/85">
                {item.footnote}
              </p>
            </Card>
          </div>

          <ConversionBanner
            title="Require the complete petition under the new codes?"
            body="Jurinex prepares bench-formatted anticipatory bail applications, quashing petitions and replies to charge sheets with verified citations."
            cta="Draft in Jurinex"
            onClick={onOpenTrial}
          />
        </ResultPane>
      </div>
    </>
  )
}

/* ------------------------------ Tool #2 ------------------------------ */

const OcrSandboxPanel = ({ onOpenTrial, showToast }) => {
  const [sampleKey, setSampleKey] = useState("MARATHI_FIR")
  const [uploadedName, setUploadedName] = useState(null)
  const [whatsapp, setWhatsapp] = useState("")
  const fileRef = useRef(null)
  const sample = VERNACULAR_SAMPLES[sampleKey]
  const remaining = sample.totalPages - 3

  const handleUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadedName(file.name)
    showToast(`Processed the first 3 pages of "${file.name}". The remaining pages can be sent to you on WhatsApp.`)
    e.target.value = ""
  }

  const unlock = () => {
    const phone = whatsapp.trim()
    if (!phone) {
      onOpenTrial()
      return
    }
    showToast(`Full ${sample.totalPages}-page chronology sent to ${phone} on WhatsApp.`)
  }

  return (
    <>
      <PanelHeader
        eyebrow="Tool II · Vernacular OCR"
        title="List of Dates from Scanned FIRs, Charge Sheets and Revenue Records"
        lede="Upload a scanned Marathi, Hindi, Tamil, Telugu or English record, or examine one of the pre-loaded court files below. The first three pages are processed without an account."
        badge="95%+ accuracy on degraded scans"
        badgeIcon="ScanText"
        meta="Multilingual OCR with page-linked indexing"
      />

      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-xl border border-dashed border-nx-teal/40 bg-teal-50/30 p-6 text-center">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg" className="hidden" onChange={handleUpload} />
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-lg border border-nx-line bg-white text-nx-teal"><Icon name="FileUp" className="h-5 w-5" strokeWidth={1.5} /></span>
            <div className="mt-3 font-display text-base font-medium text-nx-ink">Upload a scanned record</div>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-nx-muted">
              PDF, PNG or JPG. Devanagari, Tamil, Telugu and English, including faded stamps. Up to 500 pages.
            </p>
            <InkButton onClick={() => fileRef.current?.click()} variant="outline" className="mt-4">
              Select file
            </InkButton>
          </div>

          <div>
            <FieldLabel>Or examine a sample court record</FieldLabel>
            <ul className="divide-y divide-nx-line overflow-hidden rounded-lg border border-nx-line bg-white">
              {OCR_SAMPLE_BUTTONS.map((b, i) => {
                const on = b.key === sampleKey
                return (
                  <li key={b.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSampleKey(b.key)
                        setUploadedName(null)
                      }}
                      className={`flex w-full items-start gap-4 px-3 py-3 text-left transition-colors ${on ? "bg-nx-teal text-white" : "hover:bg-nx-pale"
                        }`}
                    >
                      <span className={`font-display text-sm ${on ? "text-white/70" : "text-nx-faint"}`}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-xs font-semibold ${on ? "text-white" : "text-nx-ink"}`}>{b.title}</span>
                        <span className={`mt-0.5 block text-[11px] leading-relaxed ${on ? "text-white/70" : "text-nx-muted"}`}>
                          {b.court} · {b.sub}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-nx-line bg-white p-4 text-xs">
            <div className="flex items-center justify-between gap-3 border-b border-nx-line pb-2 font-mono text-[10.5px] text-nx-muted">
              <span className="truncate">{uploadedName ? `Uploaded · ${uploadedName}` : `Source · ${sample.docTitle}`}</span>
              <span className="flex-none text-nx-teal-ink">Confidence 96.4%</span>
            </div>
            <div className="mt-2.5 text-[10.5px] uppercase tracking-[0.16em] text-nx-faint">{sample.language}</div>
            <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-nx-ink/80">{sample.rawText}</p>
          </div>
        </div>

        <ResultPane className="lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardLabel tone="teal">Output</CardLabel>
                <h4 className="mt-1.5 font-display text-lg font-medium text-nx-ink">Chronological List of Dates and Events</h4>
                <p className="mt-0.5 text-xs text-nx-muted">
                  Pages 1 to 3 of {sample.totalPages}, each entry linked to its source page
                </p>
              </div>
              <Tag icon="Link2">Page-linked</Tag>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-nx-line bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-nx-ink/20 text-[10.5px] uppercase tracking-[0.14em] text-nx-muted">
                    <th className="w-28 px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Event</th>
                    <th className="w-32 px-4 py-3 text-right font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nx-line text-nx-ink">
                  {sample.rows.map((r) => (
                    <tr key={r.date + r.page}>
                      <td className="px-4 py-3.5 align-top font-mono font-medium text-nx-ink">{r.date}</td>
                      <td className="px-4 py-3.5 align-top leading-relaxed">{r.event}</td>
                      <td className="px-4 py-3.5 text-right align-top font-mono text-[11px] text-nx-faint">{r.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="relative border-t border-nx-line">
                <div className="blur-paywall space-y-1 px-4 py-2 text-xs text-nx-muted" aria-hidden="true">
                  <div className="flex justify-between gap-3 py-1.5"><span>19/08/2026</span><span>Spot Panchnama recorded in presence of two independent panch witnesses showing boundary alteration...</span><span>Annex P-4 (Pg 18)</span></div>
                  <div className="flex justify-between gap-3 py-1.5"><span>24/08/2026</span><span>Statement of Bank Manager recorded under Sec 180 BNSS confirming RTGS transfer of ₹45,00,000...</span><span>Annex P-7 (Pg 64)</span></div>
                  <div className="flex justify-between gap-3 py-1.5"><span>02/09/2026</span><span>Handwriting & Forensic Science Lab report on disputed Power of Attorney signature...</span><span>Annex P-12 (Pg 142)</span></div>
                  <div className="flex justify-between gap-3 py-1.5"><span>14/09/2026</span><span>Rejection of bail application by Sessions Court and filing of 340-page Charge Sheet...</span><span>Annex P-19 (Pg 289)</span></div>
                </div>
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-white via-white/95 to-transparent p-4">
                  <div className="w-full max-w-md rounded-xl border border-nx-line bg-white p-5 text-center shadow-[0_18px_40px_-20px_rgba(16,20,19,0.3)]">
                    <div className="inline-flex items-center gap-1.5 font-display text-sm font-medium text-nx-ink">
                      <Icon name="Lock" className="h-3.5 w-3.5 text-nx-teal" />
                      {remaining} further pages and a draft petition
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-nx-muted">
                      Receive the complete page-linked chronology and open this file in a complimentary 7-day workspace.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        type="tel"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        placeholder="WhatsApp number (+91)"
                        className={`${FIELD} py-2 text-xs`}
                      />
                      <InkButton onClick={unlock} icon="ArrowRight" className="flex-none py-2">
                        Send
                      </InkButton>
                    </div>
                    <p className="mt-2.5 text-[10px] italic text-nx-faint">
                      DPDP Act compliant · Hosted in Mumbai (GCP asia-south1) · Never used for model training
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ResultPane>
      </div>
    </>
  )
}

/* ------------------------------ Tool #3 ------------------------------ */

const BenchValidatorPanel = ({ onOpenTrial }) => {
  const [benchKey, setBenchKey] = useState("BOMBAY_HC")
  const [petitionType, setPetitionType] = useState("WRIT_CERTIORARI")
  const rule = BENCH_RULES[benchKey]

  return (
    <>
      <PanelHeader
        eyebrow="Tool III · Bench Validator"
        title="Filing Format and Citation Check by Bench"
        lede="Select the bench before which the matter is to be filed to review its paper, typography and sequencing requirements, and to confirm that every authority cited exists in the primary reports."
        badge="Flags unverifiable citations"
        badgeIcon="ShieldCheck"
        meta="Indian Kanoon API and bench rules register"
      />

      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-5">
          <div>
            <FieldLabel>Court or bench</FieldLabel>
            <select value={benchKey} onChange={(e) => setBenchKey(e.target.value)} className={`${FIELD} font-medium`}>
              <option value="BOMBAY_HC">Bombay High Court (Principal Seat, Aurangabad and Nagpur Benches)</option>
              <option value="DELHI_HC">High Court of Delhi (e-Filing standard)</option>
              <option value="MADRAS_HC">Madras High Court (Writ and Appellate Jurisdiction)</option>
              <option value="SC_INDIA">Supreme Court of India (Special Leave Petition)</option>
              <option value="NCLT">National Company Law Tribunal (Sections 7 and 9, IBC)</option>
            </select>
          </div>

          <div>
            <FieldLabel>Nature of proceeding</FieldLabel>
            <select value={petitionType} onChange={(e) => setPetitionType(e.target.value)} className={`${FIELD} font-medium`}>
              <option value="WRIT_CERTIORARI">Writ Petition under Article 226 (Certiorari / Mandamus)</option>
              <option value="ANTICIPATORY_BAIL">Anticipatory Bail Application (Section 482 BNSS / 438 CrPC)</option>
              <option value="QUASHING_FIR">Quashing of FIR / Charge Sheet (Section 528 BNSS / 482 CrPC)</option>
            </select>
          </div>

          <div className="border-l-2 border-nx-teal/60 pl-4 text-xs">
            <div className="font-display text-sm font-medium text-nx-ink">Why general-purpose AI drafts fail at the Registry</div>
            <p className="mt-1.5 leading-relaxed text-nx-muted">
              Generic assistants produce briefs without the mandatory <em>Synopsis and List of Dates</em>, apply the wrong
              margin and spacing rules, and routinely cite AIR and SCC reports that do not exist.
            </p>
          </div>
        </div>

        <ResultPane className="lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardLabel tone="teal">Bench specification</CardLabel>
                <h4 className="mt-1.5 font-display text-lg font-medium leading-snug text-nx-ink">{rule.name}</h4>
              </div>
              <Tag icon="BadgeCheck">Rules loaded</Tag>
            </div>

            <Card className="mt-4 p-4 text-xs">
              <CardLabel>Paper, typography and margins</CardLabel>
              <div className="mt-1.5 leading-relaxed text-nx-ink">{rule.paperSpec}</div>
            </Card>

            <Card className="mt-4 p-4 text-xs">
              <CardLabel>Order of documents</CardLabel>
              <ol className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {rule.sequence.map((s, i) => (
                  <li key={s} className="flex items-start gap-2.5 text-nx-ink/85">
                    <span className="w-5 flex-none font-display text-[11px] text-nx-faint">{i + 1}.</span>
                    <span className="leading-snug">{s}</span>
                  </li>
                ))}
              </ol>
            </Card>

            <div className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <Card className="border-t-2 border-t-nx-teal bg-white p-4">
                <div className="flex items-center gap-1.5">
                  <Icon name="BadgeCheck" className="h-3.5 w-3.5 text-nx-teal-ink" />
                  <CardLabel tone="teal">Verified authority</CardLabel>
                </div>
                <p className="mt-1.5 font-display text-[13px] leading-relaxed text-nx-ink">{rule.verifiedCitation}</p>
                <p className="mt-1 text-[10.5px] italic text-nx-faint">Confirmed in the primary reports</p>
              </Card>
              <Card className="border-t-2 border-t-amber-500 bg-white p-4">
                <div className="flex items-center gap-1.5">
                  <Icon name="Flag" className="h-3.5 w-3.5 text-amber-700" />
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-amber-800">Requires attention</div>
                </div>
                <p className="mt-1.5 leading-relaxed text-nx-ink">{rule.flaggedWarning}</p>
              </Card>
            </div>
          </div>

          <ConversionBanner
            title="Prepare the petition in the prescribed format"
            body="Upload the case file to Jurinex to populate the Synopsis, List of Dates, Grounds and Prayer in the format required by the selected bench."
            cta="Format in Jurinex"
            onClick={onOpenTrial}
          />
        </ResultPane>
      </div>
    </>
  )
}

/* ------------------------------ Tool #4 ------------------------------ */

const LimitationCalculatorPanel = ({ onOpenTrial }) => {
  const [forum, setForum] = useState("90")
  const [dateJudgment, setDateJudgment] = useState("2026-08-10")
  const [dateApplied, setDateApplied] = useState("2026-08-12")
  const [dateReady, setDateReady] = useState("2026-08-26")

  const result = useMemo(() => {
    const baseDays = parseInt(forum, 10) || 90
    const dJudg = new Date(dateJudgment)
    const dApp = new Date(dateApplied)
    const dReady = new Date(dateReady)
    const rawCopy = Math.round((dReady - dApp) / (1000 * 60 * 60 * 24)) + 1
    const copyDays = Number.isNaN(rawCopy) ? 0 : Math.max(0, rawCopy)
    const totalAllowedDays = baseDays + copyDays
    const deadline = new Date(dJudg)
    deadline.setDate(deadline.getDate() + totalAllowedDays)
    const valid = !Number.isNaN(deadline.getTime())
    return {
      baseDays,
      copyDays,
      totalAllowedDays,
      weekday: valid ? deadline.toLocaleDateString("en-IN", { weekday: "long" }) : "",
      formatted: valid ? deadline.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : "—",
    }
  }, [forum, dateJudgment, dateApplied, dateReady])

  const steps = [
    { label: "Date of judgment or order", value: dateJudgment, set: setDateJudgment },
    { label: "Certified copy applied for", value: dateApplied, set: setDateApplied },
    { label: "Certified copy ready", value: dateReady, set: setDateReady },
  ]

  const figures = [
    { label: "Statutory period", value: result.baseDays, tone: "ink" },
    { label: "Section 12 exclusion", value: `+${result.copyDays}`, tone: "teal" },
    { label: "Total period", value: result.totalAllowedDays, tone: "ink" },
  ]

  return (
    <>
      <PanelHeader
        eyebrow="Tool IV · Limitation"
        title="Last Date for Filing under the Limitation Act, 1963"
        lede="Compute the last date for filing an appeal or petition after excluding, under Section 12, the time taken to obtain a certified copy of the judgment, decree or order."
        badge="Section 12 exclusion applied"
        badgeIcon="CalendarClock"
        meta="Limitation Act, 1963 and Commercial Courts Act, 2015"
      />

      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-6">
          <div>
            <FieldLabel>Forum and nature of proceeding</FieldLabel>
            <select value={forum} onChange={(e) => setForum(e.target.value)} className={`${FIELD} font-medium`}>
              <option value="90">High Court — First Appeal / Writ Appeal (90 days, Art. 116(a))</option>
              <option value="30">District or Sessions Court — Appeal from subordinate court (30 days, Art. 116(b))</option>
              <option value="90_SLP">Supreme Court — Special Leave Petition against High Court judgment (90 days, Art. 133(c))</option>
              <option value="60">Commercial Courts Act — Appeal to Commercial Appellate Division (60 days, s. 13(1A))</option>
              <option value="30_WS">Civil or Commercial Suit — Written Statement (30 days, extendable to 120)</option>
              <option value="45">NCLAT — Appeal against NCLT order under IBC (30 days, 15 condonable)</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.label}>
                <FieldLabel>
                  <span className="mr-1.5 font-display text-nx-teal-ink">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </FieldLabel>
                <input type="date" value={s.value} onChange={(e) => s.set(e.target.value)} className={`${FIELD} text-xs`} />
              </div>
            ))}
          </div>

          <div className="border-l-2 border-nx-teal/60 pl-4 text-xs leading-relaxed text-nx-muted">
            <span className="font-display text-sm font-medium text-nx-ink">Method. </span>
            Section 12(2) of the Limitation Act excludes the day on which the judgment was pronounced and the time
            requisite for obtaining a certified copy. That period is added to the statutory limitation to arrive at the
            last date for filing.
          </div>
        </div>

        <ResultPane className="lg:col-span-6">
          <div>
            <CardLabel tone="teal">Last date for filing</CardLabel>
            <div className="mt-2 font-display text-3xl font-medium leading-tight text-nx-ink sm:text-4xl">{result.formatted}</div>
            {result.weekday && <div className="mt-1 text-sm italic text-nx-muted">{result.weekday}</div>}

            <dl className="mt-6 grid grid-cols-3 divide-x divide-nx-line overflow-hidden rounded-lg border border-nx-line bg-white text-xs">
              {figures.map((f) => (
                <div key={f.label} className="p-4">
                  <dt>
                    <CardLabel tone={f.tone === "teal" ? "teal" : "faint"}>{f.label}</CardLabel>
                  </dt>
                  <dd className={`mt-1.5 font-display text-2xl font-medium ${f.tone === "teal" ? "text-nx-teal-ink" : "text-nx-ink"}`}>
                    {f.value}
                    <span className="ml-1 font-body text-[11px] font-medium text-nx-faint">days</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <ConversionBanner
            title="Application for condonation of delay under Section 5"
            body="Jurinex drafts the Section 5 application with grounds, supporting affidavit and bench formatting from the case file."
            cta="Draft application"
            onClick={onOpenTrial}
          />
        </ResultPane>
      </div>
    </>
  )
}

/* ----------------------------- Tool cards ---------------------------- */
/* Sit in the light band under the hero. Selection opens the panel below. */

export const ToolCards = ({ activeTool, onSelect }) => (
  <div role="tablist" aria-label="Choose a free tool" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
    {TOOL_TABS.map((t, i) => {
      const on = t.id === activeTool
      return (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`micro-tool-tab-${t.id}`}
          aria-selected={on}
          aria-controls="micro-tool-panel"
          onClick={() => onSelect(t.id)}
          className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white p-4 text-left transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal lg:p-3.5 ${on
              ? "border-nx-teal shadow-[0_28px_56px_-28px_rgba(6,52,44,0.45)]"
              : "border-nx-line shadow-[0_12px_32px_-24px_rgba(6,52,44,0.25)] hover:-translate-y-1 hover:border-nx-teal/40 hover:shadow-[0_28px_56px_-28px_rgba(6,52,44,0.35)]"
            }`}
        >
          <span
            className={`absolute inset-x-0 top-0 h-1 bg-nx-teal transition-opacity ${on ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}
            aria-hidden="true"
          />
          <span className="flex items-center justify-between">
            <span
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors lg:h-9 lg:w-9 ${on ? "bg-nx-teal text-white shadow-md shadow-teal-500/30" : "bg-nx-teal/8 text-nx-teal group-hover:bg-nx-teal group-hover:text-white"
                }`}
            >
              <Icon name={t.icon} className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
            <span className={`font-display text-sm ${on ? "text-nx-teal-ink" : "text-nx-faint"}`}>{String(i + 1).padStart(2, "0")}</span>
          </span>
          <span className="mt-3 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink lg:mt-2.5">{t.label}</span>
          <span className="mt-1 block font-display text-[1.05rem] font-semibold leading-snug text-nx-ink lg:text-[0.98rem]">{t.title}</span>
          <span className="mt-1.5 block text-[12.5px] leading-snug text-nx-muted">{t.desc}</span>
          <span className={`mt-auto inline-flex items-center gap-1.5 pt-3 text-xs font-semibold lg:pt-2.5 ${on ? "text-nx-teal-ink" : "text-nx-muted group-hover:text-nx-ink"}`}>
            {on ? "Open below" : "Try it free"}
            <Icon name={on ? "ArrowDown" : "ArrowRight"} className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      )
    })}
  </div>
)

ToolCards.propTypes = {
  activeTool: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
}

/* ------------------------------ Section ------------------------------ */

const MicroToolsSection = () => {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [activeTool, setActiveTool] = useState(1)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const panelRef = useRef(null)

  const selectTool = (id) => {
    setActiveTool(id)
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      })
    })
  }

  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // Every CTA in the hub goes straight to sign-up.
  const openTrial = () => navigate("/register")

  const panels = {
    1: <StatuteMapperPanel onOpenTrial={openTrial} showToast={showToast} />,
    2: <OcrSandboxPanel onOpenTrial={openTrial} showToast={showToast} />,
    3: <BenchValidatorPanel onOpenTrial={openTrial} />,
    4: <LimitationCalculatorPanel onOpenTrial={openTrial} />,
  }

  return (
    <section
      id="micro-tools"
      className="relative scroll-mt-20 overflow-hidden border-y border-nx-line bg-[#f7fcfa] py-14 sm:py-16 lg:pb-16 lg:pt-8"
      aria-labelledby="micro-tools-heading"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(8,163,147,0.14)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-nx-teal/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        {/* Header + cards */}
        <Reveal>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">Free legal tools</p>
              <h2 id="micro-tools-heading" className="mt-2 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink lg:text-[1.85rem]">
                Four tools lawyers use daily, open to everyone
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-nx-muted md:text-right">
              Four working tools from the platform. Pick one and it opens in the console below, no sign-up required.
            </p>
          </div>
          <div className="mt-8 lg:mt-5">
            <ToolCards activeTool={activeTool} onSelect={selectTool} />
          </div>
        </Reveal>

        {/* Active tool panel */}
        <Reveal className="mt-8">
          <div className="overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_40px_80px_-48px_rgba(16,20,19,0.4)]">
            <div
              ref={panelRef}
              id="micro-tool-panel"
              role="tabpanel"
              aria-labelledby={`micro-tool-tab-${activeTool}`}
              className="scroll-mt-28"
            >
              <AnimatePresence mode="wait" initial={false}>
                <Motion.div
                  key={activeTool}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.26, ease: EASE }}
                >
                  {panels[activeTool]}
                </Motion.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-3 border-t border-nx-line bg-nx-pale/60 px-6 py-3.5 text-xs text-nx-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="flex items-center gap-2">
                <Icon name="Info" className="h-3.5 w-3.5 flex-none text-nx-faint" />
                Sample case data is shown for demonstration. Outputs are illustrative and do not constitute legal advice.
              </p>
              <button
                type="button"
                onClick={openTrial}
                className="inline-flex items-center gap-1.5 font-semibold text-nx-teal-ink transition-colors hover:text-nx-teal-deep"
              >
                Open the full workspace free for 7 days
                <Icon name="ArrowRight" className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-8">
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-nx-muted">
            {TRUST_ROW.map((t) => (
              <li key={t.text} className="flex items-center gap-2">
                <Icon name={t.icon} className="h-4 w-4 text-nx-teal" strokeWidth={1.75} />
                {t.text}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[110] flex max-w-sm items-center gap-3 rounded-xl border border-white/10 bg-nx-ink px-4 py-3 text-xs text-white shadow-xl"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-nx-mint" />
          <div>{toast}</div>
        </div>
      )}
    </section>
  )
}

export default MicroToolsSection
