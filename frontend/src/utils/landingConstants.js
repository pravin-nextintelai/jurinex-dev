/**
 * Landing-page content for the Jurinex.ai marketing site.
 * Primary copy mirrors the live production site (jurinex.ai); everything
 * here maps to a shipped capability or published company fact — do not
 * add customer names, statistics, or certifications beyond these.
 */

/**
 * Primary navigation. Items with `children` render a dropdown; every
 * child href is a real on-page anchor or app route.
 * @type {{ label: string, href: string, children?: { label: string, href: string }[] }[]}
 */
/**
 * Primary navigation. Items with `children` or `sections` open a
 * full-width mega menu; each entry carries a one-line description and
 * the menu shows a `feature` card on the right.
 */
export const NAV_LINKS = [
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
  { label: "Team", href: "/team" },
]

export const HERO_COPY = {
  eyebrow: "AI-Powered Legal Intelligence",
  titleMain: "Enterprise grade legal operating system for Law Professionals",
  titleAccent: "powered by AI",
  subtitle:
    "Work faster, practice smarter with the power of AI. Jurinex handles your research, drafting, citations and case files — purpose-built for Indian courts, supports Indian languages.",
  primaryCta: "Start Free Trial",
  secondaryCta: "Explore the Platform",
  trustLine: "Developed, tried and tested by experienced lawyers",
}

/** Published platform stats (from jurinex.ai). */
export const STATS = [
  { value: "5,00,000+", label: "Pages processed" },
  { value: "95%", label: "Accuracy" },
  { value: "100%", label: "Data residency in India" },
]

/** Trust strip — capability claims only, no invented customers. */
export const TRUST_POINTS = [
  {
    icon: "ShieldCheck",
    title: "Zero-hallucination policy",
    text: "Responses come only from authorised, verified sources — if the system isn't confident, it flags rather than invents.",
  },
  {
    icon: "FolderLock",
    title: "Private case workspaces",
    text: "Each matter lives in its own encrypted vault with role-based access for your team.",
  },
  {
    icon: "Quote",
    title: "Citation-grounded answers",
    text: "Every citation is verified against source databases and shown in court-approved formats.",
  },
  {
    icon: "Scale",
    title: "Built for Indian practice",
    text: "Indian court hierarchy, Indian citation formats, and drafting in Indian languages.",
  },
]

export const PROBLEMS = [
  {
    icon: "FileStack",
    title: "Hours lost to reading",
    text: "Briefs, annexures, and precedents run into hundreds of pages before the real work begins.",
  },
  {
    icon: "SearchX",
    title: "Research that drags",
    text: "Finding the authority that actually supports your ground takes days of database trawling.",
  },
  {
    icon: "ScanSearch",
    title: "Buried clauses and dates",
    text: "The obligation, limitation date, or admission that decides the matter hides on page 214.",
  },
  {
    icon: "CopyX",
    title: "Repetitive drafting",
    text: "The same applications, notices, and replies get rebuilt from scratch, matter after matter.",
  },
  {
    icon: "FolderTree",
    title: "Scattered information",
    text: "Facts live across emails, scans, and drafts — nothing connects them into one case picture.",
  },
  {
    icon: "GitCompareArrows",
    title: "Manual cross-checking",
    text: "Reconciling pleadings against evidence and chronology is slow, error-prone work.",
  },
]

export const SOLUTION_COPY = {
  headline: "One Intelligent Workspace for Your Legal Work",
  text: "Upload a matter once. Jurinex processes every page — including scans — then keeps the entire case in context: summaries, chronology, evidence, research, and drafts all draw from the same understanding of your file.",
  points: [
    "Every document analyzed, OCR included, the moment it lands in the case folder",
    "Ask questions in plain language and get answers grounded in your own papers",
    "Research, chronology, evidence matrix, and drafting share one case context",
  ],
}

/** Core features grid. `span` controls bento sizing: "wide" | "base". */
export const FEATURES = [
  {
    icon: "FileSearch",
    title: "AI Document Analysis",
    text: "Upload petitions, contracts, and scanned briefs. Jurinex reads every page — OCR included — and returns structure, parties, dates, and issues in seconds.",
    span: "wide",
  },
  {
    icon: "ListTree",
    title: "Intelligent Summarization",
    text: "Structured, ground-wise summaries of lengthy filings — not vague abstracts.",
    span: "base",
  },
  {
    icon: "MessageSquareText",
    title: "Legal AI Assistant",
    text: "Ask questions about your case files and get contextual answers that cite the exact passages they rely on.",
    span: "base",
  },
  {
    icon: "BookMarked",
    title: "Citation Research",
    text: "Find Indian Kanoon authorities matched to your pleaded grounds, with checks on whether a judgment still stands.",
    span: "base",
  },
  {
    icon: "FilePenLine",
    title: "AI Drafting",
    text: "Generate applications, notices, and pleadings from templates that follow your structure — section by section, in English or Marathi.",
    span: "base",
  },
  {
    icon: "TableProperties",
    title: "Evidence Matrix & Chronology",
    text: "Auto-built timelines and evidence tables that map each fact to its source document.",
    span: "base",
  },
  {
    icon: "Languages",
    title: "Legal Translation",
    text: "Translate documents between English and regional languages with Devanagari-ready exports.",
    span: "base",
  },
  {
    icon: "FolderLock",
    title: "Secure Case Workspace",
    text: "Organized matter folders with team roles, device-session controls, and private storage — intake to final filing.",
    span: "base",
  },
]

/** The Jurinex workflow — five stages, as published on jurinex.ai. */
export const WORKFLOW_STEPS = [
  {
    num: "01",
    label: "Understand",
    title: "Upload case documents.",
    text: "Scanned FIRs, bulky case files, judgments, affidavits. OCR extracts the text, RAG indexes it for semantic search, chronology builds automatically.",
  },
  {
    num: "02",
    label: "Converse & Summarize",
    title: "Ask anything about the case.",
    text: "Ask questions in plain English across an entire case folder. Surface prior statements, cross-reference dates, and pull key testimony in seconds.",
  },
  {
    num: "03",
    label: "Draft",
    title: "Generate court-ready documents.",
    text: "Bail applications, petitions, writs, agreements. Upload your own templates or use our library. Formatted for the bench you're filing in.",
  },
  {
    num: "04",
    label: "Research & Citation",
    title: "Every citation, verified and reference displayed.",
    text: "Court approved format citations verified against source databases. Zero-hallucination policy — if the system isn't confident, it flags rather than invents.",
  },
  {
    num: "05",
    label: "Storage & Case Lifecycle",
    title: "Every matter, end to end.",
    text: "Encrypted vault storage with full-text search. Track each case from filing through hearings to disposal, with deadlines, status, and a clean archive when it closes.",
  },
]

/** "Built for Indian courts." — the four commitments from jurinex.ai. */
export const INDIAN_COURTS = [
  {
    icon: "Languages",
    title: "Supports Indian languages",
    text: "Marathi, Hindi, Tamil, Telugu and other widely spoken Indian languages, so drafts and reports come out in the language the court and the client read.",
    tags: ["Marathi", "Hindi", "Tamil", "Telugu", "English"],
  },
  {
    icon: "Landmark",
    title: "Built for the Indian court hierarchy",
    text: "Drafts follow the formats expected by District Courts, High Courts, the Supreme Court and tribunals, so a filing is ready for the forum it is going to.",
    tags: ["District Courts", "High Courts", "Supreme Court", "Tribunals"],
  },
  {
    icon: "BadgeCheck",
    title: "Zero-hallucination policy",
    text: "Answers are drawn only from authorised, verified sources and pass multiple verification checks before they reach you. Gaps are flagged, never filled in.",
    tags: ["Authorised sources only", "Multiple verification checks", "Flags, never invents"],
  },
  {
    icon: "ShieldCheck",
    title: "Data sensitivity and security",
    text: "All data is stored on infrastructure in India and handled under the Digital Personal Data Protection Act, 2023. No cross-border transfer, and end-to-end encryption for everything processed.",
    tags: ["Stored in India", "DPDP Act compliant", "End-to-end encrypted"],
  },
]

/** The court ladder shown beside the photo, top of the hierarchy first. */
export const COURT_LADDER = [
  { level: "Supreme Court", note: "Special leave petitions, appeals and writs under Article 32." },
  { level: "High Courts", note: "Writ petitions, appeals and revisions, every bench and format." },
  { level: "District Courts", note: "Suits, applications and bail, civil and criminal sides." },
  { level: "Tribunals", note: "NCLT, DRT, CAT and other specialised forums." },
]

/** Compliance facts for the strip under the commitments. */
export const INDIA_COMPLIANCE = [
  { icon: "MapPin", label: "All data stored in India" },
  { icon: "FileCheck2", label: "DPDP Act, 2023 compliant" },
  { icon: "Ban", label: "No cross-border transfer" },
  { icon: "Lock", label: "End-to-end encryption" },
]

/** Practice-size fit cards ("Whether you're a solo practitioner…"). */
export const PRACTICE_SIZES = [
  {
    numeral: "I",
    title: "Solo Practitioners",
    seats: "3 seats",
    text: "One chamber with the document-handling depth of a large firm. Upload, research and draft without a junior.",
  },
  {
    numeral: "II",
    title: "Small Law Firms",
    seats: "4 to 10 seats",
    text: "Shared case folders and roles, so juniors upload and organise while seniors analyse and draft.",
  },
  {
    numeral: "III",
    title: "Large Law Firms and Enterprises",
    seats: "11 and above seats",
    text: "Firm-wide workspaces with admin controls, device limits and storage that grows with the practice.",
  },
]

export const USE_CASES = [
  {
    icon: "Building2",
    title: "Law Firms",
    text: "Juniors upload and organize; seniors analyze and draft. Shared case folders keep the whole team on one version of the truth.",
    products: ["Create Case", "Case Storage", "AI Drafting"],
  },
  {
    icon: "Briefcase",
    title: "Corporate Legal Teams",
    text: "Manage contracts, notices, and internal legal documents with structured extraction of obligations and key dates.",
    products: ["Quick Chat", "AI Drafting", "Case Storage"],
  },
  {
    icon: "Gavel",
    title: "Litigation Teams",
    text: "Build chronologies and evidence matrices from case materials, and find the fact that matters before the other side does.",
    products: ["Create Case", "Citation Research", "AI Drafting"],
  },
  {
    icon: "BookOpen",
    title: "Legal Researchers",
    text: "Search judgments in natural language and get authorities matched to specific grounds, not keyword noise.",
    products: ["Citation Research", "Quick Chat"],
  },
  {
    icon: "ClipboardCheck",
    title: "Compliance Teams",
    text: "Review policies and regulatory documents with AI extraction of duties, deadlines, and exposure.",
    products: ["Quick Chat", "Case Storage"],
  },
  {
    icon: "UserRound",
    title: "Individual Attorneys",
    text: "A solo practice with the document-handling depth of a large chamber — reading, research, and drafting handled.",
    products: ["Create Case", "Quick Chat", "AI Drafting"],
  },
]

export const AI_CAPABILITIES = [
  { icon: "Brain", title: "Context-aware analysis", text: "The AI holds your whole case in context — answers reflect the full record, not one page." },
  { icon: "Layers", title: "Multi-document reasoning", text: "Connects facts across 50+ documents in a single matter folder." },
  { icon: "FileText", title: "Long-document processing", text: "Handles filings running to hundreds of pages, scanned or digital." },
  { icon: "Braces", title: "Structured extraction", text: "Parties, dates, clauses, obligations, and reliefs pulled into usable structure." },
  { icon: "Search", title: "Semantic search", text: "Finds passages by meaning, so the answer surfaces even when the wording differs." },
  { icon: "AlignLeft", title: "Summarization", text: "Ground-wise, structured summaries tuned for legal reading." },
  { icon: "MessagesSquare", title: "Question answering", text: "Grounded responses with references back to your source documents." },
  { icon: "PenLine", title: "Draft generation", text: "Section-by-section drafting that follows your templates and instructions." },
  { icon: "Link2", title: "Grounded citations", text: "Research results link to the underlying judgments — verify everything." },
]

/** Security section — only claims the shipped product supports. */
export const SECURITY_POINTS = [
  {
    icon: "KeyRound",
    title: "Secure authentication",
    text: "Token-based sign-in with session controls — see every device logged into your account and revoke any of them.",
  },
  {
    icon: "Lock",
    title: "Encrypted data transfer",
    text: "Documents and messages move over encrypted HTTPS connections end to end.",
  },
  {
    icon: "MapPin",
    title: "Data residency in India",
    text: "All data storage infrastructure is in India, with a no cross-border data transfer policy — DPDPA compliant.",
  },
  {
    icon: "Users",
    title: "Role-based permissions",
    text: "Firm admins control who can upload, analyze, and manage cases across the team.",
  },
  {
    icon: "MonitorSmartphone",
    title: "Device session limits",
    text: "Concurrent-device caps and a live 'where you're logged in' view guard against shared credentials.",
  },
  {
    icon: "CreditCard",
    title: "Trusted payments",
    text: "Subscriptions are processed by Razorpay — card details never touch our servers.",
  },
]

export const BENEFITS = [
  {
    title: "Read less. Understand more.",
    text: "A 300-page brief becomes a structured summary, a chronology, and an evidence table before your first cup of chai is done.",
  },
  {
    title: "Research faster.",
    text: "Authorities matched to your pleaded grounds from Indian Kanoon — with the reasoning for why each one fits.",
  },
  {
    title: "Draft smarter.",
    text: "Filings generated from your own templates and the actual case record, ready for a senior's red pen instead of a blank page.",
  },
  {
    title: "Work with confidence.",
    text: "Every AI answer points back to its source, so you can verify before you rely.",
  },
]

export const WHY_CHOOSE = [
  {
    icon: "Scale",
    title: "Built for Indian legal practice",
    text: "Indian Kanoon research, Indian citation formats, bilingual drafting, and pricing in rupees — not a Western tool with a coat of paint.",
  },
  {
    icon: "Quote",
    title: "Answers you can verify",
    text: "Summaries, research, and chat responses reference the documents and judgments behind them.",
  },
  {
    icon: "Database",
    title: "The whole case in context",
    text: "Context caching keeps your entire matter in the AI's working memory across sessions — no re-uploading, no re-explaining.",
  },
  {
    icon: "Workflow",
    title: "Intake to filing, one place",
    text: "Upload, analysis, research, evidence, drafting, and export to Word or PDF — a complete pipeline, not a point tool.",
  },
]

/**
 * Real user testimonials, as published on jurinex.ai
 * ("Voices from the Bench & Bar").
 */
export const TESTIMONIALS = [
  {
    name: "Adv. Akshay Kulkarni",
    title: "Associate, Chamber of Adv. Yadkikar, Chhatrapati Sambhajinagar",
    photo: "akshay",
    quote:
      "Our chamber handles dense matters that move fast. The moment that tested me most was a client arriving when senior counsel wasn't around. Jurinex helps me grasp a matter well enough to explain where it stands, what comes next, and its real strengths and weaknesses - clearly, without the client having to wait. For a junior, that's been invaluable.",
  },
  {
    name: "Adv. Aashish Manglani",
    title: "Professional Corporate Legal Advisor",
    photo: null,
    quote:
      "I run a high volume of litigation, and the hardest part is holding it all clearly in view. Jurinex summarises matters fast and accurately, surfaces the right citations, and cuts drafting time - so I can focus on assessing exposure and advising the business. For a lean legal team, that efficiency is real.",
  },
  {
    name: "Adv. Shailesh Chapalgaonkar",
    title: "High Court, Chhatrapati Sambhajinagar",
    photo: "shailesh",
    quote:
      "Our work demands precision, and I doubted AI could deliver it in law - Jurinex proved me wrong. I was productive within hours, no training needed. Drafting that once took hours now takes thirty minutes, giving me time back for case strategy and court. For a lawyer, time is the one resource you can't recover - Jurinex gives it back.",
  },
  {
    name: "Adv. Prathamesh Borde",
    title: "Associate, Chamber of Adv. Shailesh Chapalgaonkar",
    photo: "prathamesh",
    quote:
      "As a junior, the hardest part is the volume - reading long matters and getting every date and timeline right before briefing senior counsel. Jurinex's summarisation gets me to the core fast, with the chronology laid out clearly, so my briefs are tighter and I walk in confident. The seniors have noticed.",
  },
]

/** The team behind Jurinex (from jurinex.ai). */
export const TEAM_INTRO = {
  eyebrow: "The Team Behind Jurinex",
  title: "Engineers and lawyers, building together.",
  lede: "Jurinex is built by NexIntel AI Pvt Ltd — a team that combines deep AI engineering with real legal practice.",
}

export const EXECUTIVE_CORE = [
  {
    name: "Santosh Dehadrai",
    role: "Founder, CTO & Principal Architect",
    photo: "santosh",
    bio: "Santosh Dehadrai is the founder & CTO of NexIntel AI, where he leads the development of Jurinex — an AI-powered legal platform built for Indian advocates and law firms. With 25+ years across networking, internet technologies, and large-scale systems, he brings deep technical depth and a practical understanding of how legal practice actually works.",
    summary:
      "Engineer-founder who leads NexIntel AI and architects Jurinex end to end.",
    journey: [
      {
        tag: "25+ years",
        title: "Networking, internet technologies & large-scale systems",
        text: "The technical depth that underpins every part of the platform.",
      },
      {
        tag: "NexIntel AI",
        title: "Founder & CTO",
        text: "Runs the company and its engineering with a practical understanding of how legal practice actually works.",
      },
      {
        tag: "Jurinex",
        title: "Principal Architect",
        text: "Designs the AI-powered legal platform for Indian advocates and law firms.",
      },
    ],
  },
  {
    name: "Saurabh Bhogale",
    role: "Co-founder, Executive Director & Project Coordinator",
    photo: "saurabh",
    bio: "Fifteen years in precision manufacturing and ten years building products gave Saurabh one non-negotiable standard: if a tool fails the person depending on it, it is not a product yet. Watching practicing advocates lose hours every day to drafting, documentation, and procedural paperwork made the problem clear — and the solution worth building. Jurinex exists because it was built by someone who understands what it truly means to engineer something a professional can depend on.",
    summary:
      "Co-founder who brings a manufacturer's discipline to how Jurinex is built and run.",
    journey: [
      {
        tag: "15 years",
        title: "Precision manufacturing",
        text: "Set his one non-negotiable standard: if a tool fails the person depending on it, it is not a product yet.",
      },
      {
        tag: "10 years",
        title: "Building products",
        text: "Saw practising advocates lose hours every day to drafting, documentation and procedural paperwork — the problem became clear, and the solution worth building.",
      },
      {
        tag: "Jurinex",
        title: "Executive Director & Project Coordinator",
        text: "Owns the project end to end, engineering something a professional can genuinely depend on.",
      },
    ],
  },
]

export const ADVISORY_BOARD = [
  {
    name: "Adv. Amit A. Yadkikar",
    role: "Litigation & Procedural Rigour",
    photo: "amit",
    bio: "Amit Yadkikar approaches every matter the way his family has practised law for over a century — methodically, deliberately, leaving nothing to chance. A High Court Advocate at the Aurangabad Bench with nearly two decades at the Bar and a rare Diploma in Cyber Laws, he has made disciplined process his signature across commercial, banking, arbitration, and civil litigation. He brings the same rigour to Jurinex, ensuring the platform reasons the way a meticulous lawyer does, so speed never comes at the cost of soundness and every output holds up to the scrutiny of an Indian courtroom.",
    facts: [
      ["High Court Advocate", "Aurangabad Bench"],
      ["Experience", "Nearly two decades at the Bar"],
      ["Education", "Diploma in Cyber Laws"],
      ["Legacy", "Over a century of legal practice"],
    ],
  },
  {
    name: "Adv. Amar D. Soman",
    role: "Litigation & Case Strategy",
    photo: "amar",
    bio: "For fifteen years at the Bombay High Court, Amar Soman has done what the best litigators do but few can teach — read the room, read the witness, and read the lines no one wrote down. Leading Soman & Associates across commercial litigation, arbitration, debt recovery, and high-stakes due diligence for clients like Indian Railways, the Income Tax Department, and Saint-Gobain, he built an instinct for what a case is really about beneath what the file says. Jurinex drew him in because he saw a chance to encode the part of legal judgment that usually walks out the door with the senior lawyer — the ability to sense intent, weigh adversarial posture, and surface what matters before anyone asks.",
    facts: [
      ["High Court Advocate", "Bombay High Court"],
      ["Experience", "Fifteen years at the Bar"],
      ["Expertise", "Commercial litigation, arbitration, debt recovery and due diligence"],
      ["Client Work", "Indian Railways, Income Tax Department and Saint-Gobain"],
    ],
  },
  {
    name: "Adv. Anoop U. Patil",
    role: "Litigation, Commercial Law & Legal Advisory",
    photo: "anoop",
    bio: "Adv. Anoop Umakant Patil practises before the High Court of Judicature at Bombay and its Aurangabad Bench, handling independent work across civil, criminal, constitutional, commercial, arbitration, intellectual property, real estate, and banking matters. He appears regularly before the City Civil and Metropolitan Magistrate Courts and tribunals including the DRT, NCLT, and administrative and consumer forums. He has also served as panel counsel for institutions such as the Slum Rehabilitation Authority, IndusInd Bank, the Municipal Corporation of Greater Mumbai, NHAI, and the Dedicated Freight Corridor Corporation of India.",
    facts: [
      ["High Court Advocate", "Bombay High Court and Aurangabad Bench"],
      ["Experience", "Practicing since 2006"],
      ["Education", "LL.M., Queen Mary University of London | BSL LL.B., ILS Law College Pune"],
      ["Client Work", "MCGM, SRA, NHAI, DFCCIL, TATA Steel, WIPRO, Tech Mahindra and IndusInd Bank"],
    ],
  },
]

export const MENTOR = {
  eyebrow: "Mentor & Advisor",
  quote:
    "Absolute to us means free from imperfection, free from doubt — and where science prevails, always. Guided by our core quality policy of 100 - 1=ZERO, we look forward to creating a lasting impact in all our endeavours.",
  name: "Milind Kelkar",
  role: "Chairman & Managing Director, Grind Master",
  photo: "milind",
  text: "Jurinex is mentored by Milind Kelkar — founder of Grind Master, a 40-year Indian engineering legacy exporting precision machines to global manufacturers. The discipline that built Grind Master's “Absolute Engineering” philosophy guides the rigor, the zero-hallucination standard, and the long view we bring to legal AI.",
}

/** "Getting started" — three steps, as published on jurinex.ai. */
export const THREE_STEPS = [
  {
    numeral: "I",
    title: "Create your account",
    text: "Sign up in under two minutes. Add your Bar Council registration, choose your practice areas, and invite your team with role-based access.",
  },
  {
    numeral: "II",
    title: "Upload your case",
    text: "Add documents — FIRs, judgments, contracts, affidavits. OCR scanning, indexing and chronology happens automatically.",
  },
  {
    numeral: "III",
    title: "Chat, draft, cite, edit, collaborate",
    text: "Ask questions. Generate drafts. Verify citations. Share with your team. The work that took hours now takes minutes.",
  },
]

/** Features included in every subscription plan (from jurinex.ai). */
export const PLAN_FEATURES = [
  "Chat & Assistance",
  "Case Management",
  "Document Vault",
  "AI Drafting",
  "Citation",
  "Branding & Output",
  "Multi Languages",
  "Role based User management",
  "DPDPA compliant",
  "In-app ticket system",
]

export const FAQS = [
  {
    q: "What is Jurinex.ai?",
    a: "Jurinex.ai is NexIntel AI's legal operating system for advocates, law firms, and legal teams. It analyzes case documents, answers questions about them, researches Indian case law, builds chronologies and evidence matrices, and drafts legal documents — all inside secure, per-matter workspaces purpose-built for Indian courts.",
  },
  {
    q: "What types of legal documents can I analyze?",
    a: "FIRs, petitions, written statements, contracts, notices, judgments, affidavits, annexures, and general case papers. PDF and DOCX files are supported, and scanned documents are read with built-in OCR.",
  },
  {
    q: "How does the AI document analysis work?",
    a: "When you upload documents to a case folder, every page is processed and indexed. The AI then produces structured summaries and extracts parties, dates, issues, and reliefs, and the chronology builds automatically. From there, everything else — chat, research, drafting — works from that same understanding of your file.",
  },
  {
    q: "Can I ask questions about my documents?",
    a: "Yes. The Legal AI Assistant answers questions in plain language, grounded in your uploaded case files, and shows the passages it relied on so you can verify the answer.",
  },
  {
    q: "Which languages does Jurinex support?",
    a: "Marathi, Hindi, Tamil, Telugu, and other widely spoken Indian languages are supported, and the system can generate reports and drafts in these languages.",
  },
  {
    q: "Can I upload large legal documents?",
    a: "Yes. The platform is built for long filings — documents running to hundreds of pages, and matter folders containing 50+ documents, including scans processed through OCR.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data storage infrastructure is in India, DPDPA compliant, with a no cross-border data transfer policy and end-to-end encryption for all data processed. Access is controlled through token-based authentication with device-session limits, and firm accounts get role-based permissions.",
  },
  {
    q: "Can teams collaborate?",
    a: "Yes. Plans scale from solo practitioners to firms — juniors can upload and organize while seniors analyze and draft — with admin control over roles and access.",
  },
  {
    q: "Does Jurinex support legal drafting?",
    a: "Yes. AI Drafting generates bail applications, petitions, writs, and agreements from your own templates or the built-in library, formatted for the bench you're filing in, with export to Word and PDF.",
  },
  {
    q: "Does it cover Indian case law?",
    a: "Yes. Citation Research finds authorities matched to your pleaded grounds, verified against source databases and presented in court-approved formats — with a zero-hallucination policy: if the system isn't confident, it flags rather than invents.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every plan starts with a 7-day free trial.",
  },
]

export const CTA_COPY = {
  heading: "Ready to Transform Your Legal Workflow?",
  text: "Bring document intelligence, AI research, evidence analysis, and drafting into one secure workspace built for legal professionals.",
  primary: "Start Free Trial",
  secondary: "Talk to Us",
  trial: "Start your 7-day free trial today",
}

/**
 * Footer columns. `type`: "route" → react-router navigation, "anchor" →
 * in-page scroll, "policy" → PolicyModal key, "external" → new tab,
 * "mailto" → mail link.
 */
export const FOOTER_COLUMNS = [
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
]

/** Newsletter signup copy under the Get in touch band. */
export const NEWSLETTER_COPY = {
  eyebrow: "Newsletter",
  title: "Practice notes, once a month.",
  text: "Product updates, drafting tips and Indian legal-AI news. No spam, unsubscribe any time.",
  placeholder: "Your work email",
  button: "Subscribe",
  thanks: "Thanks, you're on the list.",
}

export const SOCIAL_LINKS = [
  { label: "Instagram", icon: "Instagram", href: "https://www.instagram.com/jurinex_/" },
  { label: "Facebook", icon: "Facebook", href: "https://www.facebook.com/share/19VmrVEWYM" },
  { label: "X", icon: "x", href: "https://x.com/nexintel_ai" },
  { label: "LinkedIn", icon: "Linkedin", href: "https://www.linkedin.com/company/jurinex" },
  { label: "YouTube", icon: "Youtube", href: "https://www.youtube.com/@JuriNex_ai" },
  { label: "Pinterest", icon: "pinterest", href: "https://in.pinterest.com/nexintel_ai/" },
]

export const CONTACT_INFO = {
  company: "NexIntel AI Pvt Ltd",
  tagline: "Enterprise grade legal operating system for Professionals powered by AI",
  addressLines: [
    "B11, Near Railway Station Road, MIDC,",
    "Chhatrapati Sambhajinagar, Maharashtra 431010",
  ],
  phone: "+91 9684027372",
  email: "connect@jurinex.ai",
  cin: "U62010MH2025PTC448297",
  gstin: "27AAKCN4811B1ZQ",
  registeredOffice: "Chhatrapati Sambhajinagar, Maharashtra 431005",
  incorporation: "Incorporated under the Companies Act, 2013.",
}

/** External links for the community page. */
export const COMMUNITY_LINKS = {
  /** Two-way WhatsApp community (group invite). */
  whatsapp: "https://chat.whatsapp.com/CXptyt4StG9GKSumtE3ybk",
  /** One-way WhatsApp channel (announcements). */
  whatsappChannel: "https://whatsapp.com/channel/0029Vb8NdX01Hsq606MtPe3h",
  linkedin: "https://www.linkedin.com/company/jurinex",
}

export const COMMUNITY_PERKS = [
  {
    icon: "Megaphone",
    title: "Release announcements first",
    body: "New features, model upgrades and court coverage land in the channel before anywhere else.",
  },
  {
    icon: "MessagesSquare",
    title: "Peer drafting tips",
    body: "Advocates share prompts, templates and workflows that work in their courts and practice areas.",
  },
  {
    icon: "Vote",
    title: "Vote on the roadmap",
    body: "Polls decide what we build next. Members see the results and the follow-through.",
  },
  {
    icon: "Headset",
    title: "Direct line to the team",
    body: "Product and support staff are in the group. Bugs and questions get answered in working hours.",
  },
]

/** Support channels shown on the public Get Help page. */
export const HELP_CHANNELS = [
  {
    icon: "Mail",
    title: "Email support",
    body: "Best for account, billing and detailed technical questions. We reply within one working day.",
    cta: "connect@jurinex.ai",
    href: "mailto:connect@jurinex.ai",
  },
  {
    icon: "Phone",
    title: "Call us",
    body: "Talk to a person during support hours for onboarding help or urgent issues.",
    cta: "+91 9684027372",
    href: "tel:+919684027372",
  },
  {
    icon: "MessageCircle",
    title: "WhatsApp community",
    body: "Quick questions, tips from other advocates and product updates in one place.",
    cta: "Join the community",
    href: "/community",
  },
  {
    icon: "CalendarCheck",
    title: "Book a walkthrough",
    body: "A 30-minute session with our team covering your practice's workflow end to end.",
    cta: "Contact us",
    href: "/contact",
  },
]

export const HELP_TOPICS = [
  {
    q: "How do I start a free trial?",
    a: "Click Start Free Trial in the header, register your firm with a work email and you can upload your first case file within minutes. No card is needed.",
  },
  {
    q: "Which file types can I upload?",
    a: "PDF, DOCX, images of scanned documents and plain text. Scanned pages are OCR-processed automatically, including regional-language documents.",
  },
  {
    q: "Is my client data used to train models?",
    a: "No. Your files and conversations stay in your workspace, are encrypted at rest and in transit, and are never used for model training.",
  },
  {
    q: "Can I add colleagues to my workspace?",
    a: "Yes. Firm admins invite team members from User Management, assign roles and control who can see which cases.",
  },
  {
    q: "How do citations get verified?",
    a: "Every citation Jurinex produces is checked against its source and flagged if it cannot be verified, so you never carry an unverified authority into a filing.",
  },
  {
    q: "Where do I raise a bug or a support ticket?",
    a: "Signed-in users can open Get Help inside the app to raise a ticket with attachments and track its status. Visitors can email or call us.",
  },
]

/** Articles rendered on the public Blogs page. */
export const BLOG_POSTS = [
  {
    slug: "citation-hallucination-checklist",
    category: "Research",
    date: "Aug 2026",
    readTime: "5 min read",
    author: "Jurinex Team",
    title: "A five-point checklist before you rely on an AI-generated citation",
    excerpt:
      "Courts in India and abroad have sanctioned counsel for citing cases that do not exist. Here is the routine we recommend before any authority reaches a draft.",
    body: [
      "Generative models are excellent at producing text that looks like a citation and poor at guaranteeing the case exists. The failure is not rare, and the consequences for counsel are serious. The fix is procedural, not technical: treat every citation as unverified until it clears a short checklist.",
      "First, confirm the case exists in a primary source, not a secondary summary. Second, check that the proposition attributed to it actually appears in the judgment. Third, confirm it has not been overruled or distinguished. Fourth, verify the bench and year match what you are citing. Fifth, keep the verification record with the draft.",
      "Jurinex runs steps one through three automatically and marks anything it cannot verify, but the checklist belongs in your own practice regardless of which tool you use.",
    ],
  },
  {
    slug: "drafting-with-structure",
    category: "Drafting",
    date: "Jul 2026",
    readTime: "4 min read",
    author: "Jurinex Team",
    title: "Why structured drafts beat free-form prompts for court filings",
    excerpt:
      "A plaint, a written statement and a bail application share almost no structure. Asking a model to write one from a blank prompt is where most quality problems begin.",
    body: [
      "The most common drafting complaint we hear is that AI output reads well but misses mandatory parts: a verification clause, a prayer, the correct cause title format for the court concerned. These are not knowledge failures. They are the result of asking for a document without telling the model what shape it must take.",
      "Structured drafting inverts this. The template carries the mandatory sections, the court-specific formatting and the order of relief. The model fills content into that structure from your case facts and the documents you have uploaded, and every section can be regenerated on its own.",
      "The result is a draft you review section by section rather than a wall of text you re-read from the top after every change.",
    ],
  },
  {
    slug: "regional-language-ocr",
    category: "Product",
    date: "Jun 2026",
    readTime: "3 min read",
    author: "Jurinex Team",
    title: "Working with Marathi, Hindi and other regional-language case files",
    excerpt:
      "A large share of trial-court records are scanned, handwritten or in a regional language. Here is how Jurinex handles them and where it still needs your help.",
    body: [
      "Most legal AI tools assume clean, English, machine-readable PDFs. Indian practice does not look like that. Lower-court orders, police papers and evidence bundles arrive as scans, often in Devanagari or other scripts, sometimes with handwritten annotations in the margins.",
      "Jurinex runs OCR on every scanned page and detects the language automatically, so a Marathi charge sheet can be searched, summarised and translated alongside the English documents in the same case. Translations preserve page layout so you can cross-check against the original.",
      "Handwriting remains the hard case. Where recognition confidence is low we flag the page rather than guess, and the original scan is always one click away.",
    ],
  },
  {
    slug: "chronology-from-bundle",
    category: "Case management",
    date: "May 2026",
    readTime: "4 min read",
    author: "Jurinex Team",
    title: "Building a case chronology from a thousand-page bundle in an afternoon",
    excerpt:
      "The chronology is the document every litigator needs and nobody wants to prepare. A repeatable method for producing one from raw files.",
    body: [
      "A good chronology does three things: it lists every dated event, ties each event to the page that proves it, and makes gaps and contradictions visible. Done by hand it takes days and is out of date the moment a new document arrives.",
      "The method we recommend is to extract every dated statement from the bundle first, with its source page, and only then decide which events matter. Jurinex produces that first list automatically and links each entry to the exact page. Your work becomes editorial: merge duplicates, cut noise, annotate significance.",
      "When new documents come in, the extraction re-runs on the additions only, so the chronology grows with the file instead of being rebuilt.",
    ],
  },
  {
    slug: "data-protection-for-law-firms",
    category: "Security",
    date: "Apr 2026",
    readTime: "6 min read",
    author: "Jurinex Team",
    title: "What the DPDP Act means for a law firm adopting AI tools",
    excerpt:
      "Client files are personal data. The Digital Personal Data Protection Act puts obligations on firms that process them, and on the vendors those firms choose.",
    body: [
      "Under the DPDP Act a law firm is typically a data fiduciary for the personal data in its client files, and an AI vendor processing that data on the firm's behalf is a data processor. That relationship needs a contract, defined purposes and a clear answer to where the data lives and who can see it.",
      "Questions to put to any vendor: Is data stored in India? Is it encrypted at rest and in transit? Is it used to train models? Can the firm delete it on demand? Who inside the vendor can access it and under what audit?",
      "Jurinex answers these in its Data Processing Agreement and Data Security Policy, both linked from the footer. We think every vendor should be able to do the same in writing.",
    ],
  },
  {
    slug: "solo-practice-week",
    category: "Practice",
    date: "Mar 2026",
    readTime: "4 min read",
    author: "Jurinex Team",
    title: "A week in a solo practice, with and without an AI assistant",
    excerpt:
      "We asked a solo advocate to log where the hours went for two weeks. The second week used Jurinex for research, drafting and file review.",
    body: [
      "Week one looked familiar: roughly a third of working hours on reading and summarising files, a quarter on drafting, a large slice on research, and the remainder on court attendance and client calls. Almost none of it was billable at full rate.",
      "In week two, file review and first-draft time fell sharply. Research time fell less than expected, because verification of AI-suggested authorities replaced some of the searching. Court attendance and client time were unchanged.",
      "The honest conclusion is that the gain is not in replacing legal judgment but in removing the mechanical reading and typing that surrounds it. The hours came back as client time and, for the first time in months, an evening off.",
    ],
  },
]

/* ------------------------------------------------------------------ */
/* /products page                                                      */
/* ------------------------------------------------------------------ */

export const PRODUCTS_HERO = {
  eyebrow: "Products",
  title: "Five products. One case memory.",
  lede:
    "Create Case builds the matter once. Case Storage, Quick Chat, AI Drafting and Citation Research then work on it, from the sidebar or from inside the case. Nothing re-uploaded, nothing re-explained.",
  tagline: "Independent when you need a tool. Connected when you are inside a case.",
  hint: "Hover a product to preview it",
}

/**
 * The five products in sidebar order. Each carries the copy for its
 * section on /products: what it is, how it works (from the user guide),
 * quick facts, and what it produces. `id` doubles as the in-page anchor.
 */
export const PRODUCTS = [
  {
    id: "create-case",
    num: "01",
    name: "Create Case",
    icon: "FolderPlus",
    short: "Upload once. The matter is read, structured and remembered.",
    tagline: "Process once. Intelligence for the life of the case.",
    text:
      "A case in Jurinex is like a folder: every document, note and AI analysis for one matter lives inside it. A guided wizard reads your papers, fills in the particulars and builds the case memory that every draft, chronology, citation and question draws on later.",
    facts: [
      { value: "200 MB", label: "per file" },
      { value: "PDF · DOCX · JPG · A/V", label: "accepted formats" },
      { value: "1–3 min", label: "per 50-page document" },
    ],
    stepsHeading: "How it works",
    steps: [
      { title: "Upload", text: "Drag in PDFs, Word files, images, audio or video, one file or many." },
      { title: "Auto Fill", text: "Title, court, bench, case type, filing date and parties are extracted from the papers. Skip it and type them yourself if you prefer." },
      { title: "OCR + Verify", text: "Scans are read page by page. Low-confidence text is flagged for a one-time human check." },
      { title: "Processing", text: "Documents are indexed and a synopsis generated in the background. Leave the page; the work continues." },
      { title: "Chronology", text: "Dates and events are sequenced automatically, each linked to the page that proves it." },
    ],
    outputsHeading: "Ready inside the case when processing ends",
    outputs: [
      "Case Summary",
      "List of Dates & Events",
      "Case Brief",
      "Hearing Preparation",
      "Prayer Matrix",
      "Statute & Section Radar",
      "Gap Reasoning",
    ],
    highlight: "Upload once, understood forever. Every hearing, draft and citation starts from full context.",
  },
  {
    id: "case-storage",
    num: "02",
    name: "Case Storage",
    icon: "FolderLock",
    short: "Every document and case in folders, searchable in seconds.",
    tagline: "Your digital filing cabinet, searchable in seconds.",
    text:
      "Every document and every case lives here. Browse My Documents and My Cases as folders, upload files without opening a case, create documents in place, switch between grid and list, and watch the storage meter as the practice grows.",
    facts: [
      { value: "6 filters", label: "court, bench, type, status, dates, keywords" },
      { value: "Full text", label: "search inside document content" },
      { value: "DOCX + PDF", label: "branded exports" },
    ],
    stepsHeading: "Advance Search, when the simple box is not enough",
    steps: [
      { title: "Court and Bench", text: "All matters from the Bombay High Court, or only the Aurangabad Bench." },
      { title: "Case type and status", text: "Civil, criminal, writ. Pending, disposed, in appeal." },
      { title: "Date range", text: "Anything filed, heard or uploaded between two dates." },
      { title: "Keywords", text: "Any word or phrase inside the document content itself, not just the file name." },
    ],
    outputsHeading: "Custom Branding for every export",
    outputs: [
      "Firm name, address, phone and email",
      "Logo with position and size",
      "Bar Council number",
      "Font, paper size and orientation",
      "Live letterhead preview",
      "Set as default for every export",
    ],
    highlight: "Always available, never lost. Search, filters, grid or list.",
  },
  {
    id: "quick-chat",
    num: "03",
    name: "Quick Chat",
    icon: "MessageSquareText",
    short: "Ask anything about a file, with answers that cite the passage.",
    tagline: "Ask anything about a file, no case required.",
    text:
      "Session chat over any document, the easiest way into Jurinex. Upload the file, type a question in plain English and get an answer that cites the passage it relies on. The same preset workflows and role selector as the case view, without creating a case first.",
    facts: [
      { value: "9 presets", label: "one-click workflows" },
      { value: "H · M · L · RV", label: "confidence on every answer" },
      { value: "Cited", label: "source page on every claim" },
    ],
    stepsHeading: "How a conversation runs",
    steps: [
      { title: "Upload", text: "Attach the document you want to discuss. Its name appears at the top of the chat." },
      { title: "Ask", text: "Type freely, or tap a preset: Case Summary, List of Dates & Events, Case Gist, Grounds, Hearing Preparation, Client Brief, Statute & Section Finder." },
      { title: "Read with confidence", text: "Answers carry a confidence level: High, Medium, Low or Requires Verification, so you know what to double-check." },
      { title: "Follow up or export", text: "Suggested follow-ups keep the thread moving. Click a citation to open the source, then copy, download or print." },
    ],
    outputsHeading: "Ask it things like",
    outputs: [
      "Summarise this case in five sentences.",
      "What are the important dates in this matter?",
      "List all the parties and their roles.",
      "What sections of the IPC / BNS are mentioned?",
      "What is the prayer of the petitioner?",
      "Draft a short reply to this notice.",
    ],
    highlight: "Private and encrypted. Your conversations never leave your firm.",
  },
  {
    id: "ai-drafting",
    num: "04",
    name: "AI Drafting",
    icon: "FilePenLine",
    short: "Court-ready petitions, agreements and notices, section by section.",
    tagline: "Petitions, agreements and notices in minutes, not hours.",
    text:
      "Litigation drafts start from inside case chat. Conveyancing, corporate and general drafting go through a guided template picker: system templates, or your own, cloned and edited. Every draft is built section by section so you stay in control of the structure.",
    facts: [
      { value: "6 steps", label: "guided drafting workflow" },
      { value: "~30 sec", label: "to a first full draft" },
      { value: "EN · MR", label: "English or Marathi output" },
    ],
    stepsHeading: "The drafting workflow",
    steps: [
      { title: "Initialization", text: "Attach a case to use its facts and history, or upload context files. Pick a court for compliant formatting and the output language." },
      { title: "Section config", text: "Every standard section is on by default. Switch any off, and set each one to Detailed, Concise or Short with its own instruction." },
      { title: "Draft sections", text: "Generate and refine one section at a time. Send an instruction to update just that section." },
      { title: "Review", text: "Final human verification of names, dates, sections of law and prayer before assembly." },
      { title: "Generate document", text: "Preview the assembled draft, download it as DOCX or PDF with your branding, or save it back to the case." },
    ],
    outputsHeading: "Templates in the library",
    outputs: [
      "Writ Petition",
      "Bail Application",
      "Revision Petition",
      "Legal Notice · Reply to Notice",
      "Leave and Licence Agreement",
      "Employment Agreement",
      "Sale, Gift and Mortgage Deeds",
      "Partnership Deed",
      "Power of Attorney",
      "Franchise Agreement",
      "Arbitration Appeal",
      "Suit for Partition",
    ],
    highlight: "Formatted for the bench you are filing in, on your letterhead.",
  },
  {
    id: "citation-research",
    num: "05",
    name: "Citation Research",
    icon: "Scale",
    short: "Indian Kanoon authorities matched to your pleaded grounds.",
    tagline: "Authorities matched to your pleaded grounds.",
    text:
      "Pick a case, or upload or paste the text you are arguing from. Tell Jurinex who you act for and the legal focus, and it retrieves Indian Kanoon authorities that fit the ground, with the reasoning for why each one applies. Analyses are saved to the case for the next hearing.",
    facts: [
      { value: "Indian Kanoon", label: "source database" },
      { value: "Boolean", label: "precision when you need it" },
      { value: "Verified", label: "still-good-law check" },
    ],
    stepsHeading: "From ground to authority",
    steps: [
      { title: "Set the context", text: "Choose a case from your workspace, or upload or paste the pleading, order or issue." },
      { title: "Acting for and focus", text: "Petitioner or respondent, and the point of law you need support on." },
      { title: "Retrieve", text: "Indian Kanoon authorities matched to the ground, with Boolean precision when you want to narrow the field." },
      { title: "Verify and save", text: "Each citation links to the underlying judgment and is checked for whether it still stands. Save the analysis to the case." },
    ],
    outputsHeading: "What you can rely on",
    outputs: [
      "Court-approved citation formats",
      "Reasoning for why each authority fits",
      "Checks on whether a judgment still stands",
      "Links back to the source judgment",
      "Saved analyses inside the case",
      "Flags rather than invents when unsure",
    ],
    highlight: "Zero-hallucination policy. If the system is not confident, it flags rather than invents.",
  },
]

/** Automated presets and workflows that run on the case memory. */
export const PRODUCT_PRESETS = [
  { group: "Summarisation", icon: "AlignLeft", items: ["Grounds", "Case summary", "Concise summary"] },
  { group: "Drafting", icon: "PenLine", items: ["Start drafting"] },
  { group: "Citation", icon: "BookMarked", items: ["Find authorities"] },
  { group: "Prelitigation", icon: "Mail", items: ["Notice", "Reply"] },
  { group: "Court Ready Documents", icon: "Stamp", items: ["Branded DOCX / PDF"] },
  { group: "Cross Examination", icon: "ListChecks", items: ["Question bank"] },
]

export const PRODUCT_PRESETS_COPY = {
  eyebrow: "Automated presets and workflows",
  title: "Run on the case memory. No prompt writing, no re-reading the file.",
  lede: "One-click legal workflows available from Quick Chat and from inside every case. Suggested follow-ups and precedent searches are proposed from the case itself.",
  extras: ["Suggested follow-ups", "Research further", "Role selector"],
}

/** Side-by-side matrix: what each product needs and gives. */
export const PRODUCT_MATRIX = {
  rows: [
    { label: "Works without a case", values: ["Builds it", true, true, true, true] },
    { label: "Reads the case memory", values: [true, true, true, true, true] },
    { label: "One-click presets", values: [true, false, true, true, true] },
    { label: "Cites the source page", values: [true, false, true, true, true] },
    { label: "Exports DOCX / PDF", values: [true, true, true, true, true] },
    { label: "Custom branding applied", values: [false, true, true, true, false] },
    { label: "Indian Kanoon lookup", values: [false, false, true, false, true] },
  ],
}
