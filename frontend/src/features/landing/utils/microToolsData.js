/**
 * Free Legal Micro-Tools.
 *
 * Section rows follow the published comparative tables for the Bharatiya
 * Nyaya Sanhita (IPC), the Bharatiya Nagarik Suraksha Sanhita (CrPC) and
 * the Bharatiya Sakshya Adhiniyam (Evidence Act). A row is a drafting aid.
 * The bare Act controls.
 */

const ACTS = {
  ipc: ["IPC", "Indian Penal Code, 1860", "BNS", "Bharatiya Nyaya Sanhita, 2023"],
  crpc: ["CrPC", "Code of Criminal Procedure, 1973", "BNSS", "Bharatiya Nagarik Suraksha Sanhita, 2023"],
  iea: ["IEA", "Indian Evidence Act, 1872", "BSA", "Bharatiya Sakshya Adhiniyam, 2023"],
}

const row = (family, old, neu, extra) => {
  const [oldCode, oldAct, newCode, newAct] = ACTS[family]
  return {
    id: extra.id,
    family,
    popular: extra.popular || 0,
    title: extra.title,
    keywords: extra.keywords || [],
    old: { code: oldCode, act: oldAct, section: old },
    neu: { code: newCode, act: newAct, section: neu, also: extra.also || [] },
    scope: extra.scope,
    punishment: extra.punishment || "",
    keyChange: extra.keyChange,
  }
}

const ipc = (old, neu, extra) => row("ipc", old, neu, extra)
const crpc = (old, neu, extra) => row("crpc", old, neu, extra)
const iea = (old, neu, extra) => row("iea", old, neu, extra)

export const SECTIONS = [
  ipc("34", "3(5)", {
    id: "ipc-34",
    title: "Acts done by several persons in furtherance of common intention",
    keywords: ["common intention"],
    scope: "Where a criminal act is done by several persons in furtherance of the common intention of all, each is liable for that act.",
    keyChange: "Common intention is now Section 3(5). Plead it with the offence section, as Section 34 used to be pleaded.",
  }),
  ipc("63", "8", {
    id: "ipc-63",
    title: "Amount of fine, and liability in default of payment",
    scope: "How a fine is quantified, and what follows if it is not paid.",
    keyChange: "Old Section 63 is now Section 8. It is not rape, and it is not electronic records. Rape is BNS Section 63 (old Section 375). Electronic records are BSA Section 63 (old Section 65B).",
  }),
  ipc("120B", "61(2)", {
    id: "ipc-120b",
    title: "Punishment of criminal conspiracy",
    keywords: ["conspiracy"],
    scope: "Punishment for a criminal conspiracy. The definition that was Section 120A is now Section 61(1).",
    keyChange: "Plead Section 61(2) for the punishment that was Section 120B, and Section 61(1) for the definition.",
  }),
  ipc("153A", "196", {
    id: "ipc-153a",
    title: "Promoting enmity between different groups",
    scope: "Promoting enmity on grounds of religion, race, place of birth, residence, language, and acts prejudicial to harmony.",
    keyChange: "The offence that was Section 153A is now Section 196.",
  }),
  ipc("302", "103(1)", {
    id: "ipc-302",
    popular: 5,
    title: "Punishment for murder",
    keywords: ["murder"],
    scope: "The punishment for murder. Culpable homicide is Section 100 (old Section 299) and murder is Section 101 (old Section 300).",
    punishment: "Death, or imprisonment for life, and fine.",
    keyChange: "Section 103(1) is the punishment that was Section 302. Section 103(2) is additional: murder by a group of five or more persons acting in concert on grounds such as race, caste, community, sex, place of birth, language or personal belief. Read Section 103(2) before you cite it.",
  }),
  ipc("304", "105", {
    id: "ipc-304",
    title: "Punishment for culpable homicide not amounting to murder",
    keywords: ["culpable homicide"],
    scope: "Punishment where the act is culpable homicide but does not amount to murder.",
    keyChange: "The comparative table marks Section 105 as changed from Section 304. Read Section 105 before you copy an old prayer.",
  }),
  ipc("304A", "106", {
    id: "ipc-304a",
    title: "Causing death by negligence",
    keywords: ["negligence", "rash"],
    scope: "Causing death by a rash or negligent act not amounting to culpable homicide.",
    keyChange: "Death by negligence is now Section 106. The comparative table records Section 106(2) as a new sub-section that was not brought into force on 1 July 2024. Cite the text that is actually in force.",
  }),
  ipc("304B", "80", {
    id: "ipc-304b",
    title: "Dowry death",
    keywords: ["dowry"],
    scope: "Where a woman dies of burns or bodily injury, or otherwise than under normal circumstances, within seven years of marriage and it is shown she was subjected to cruelty or harassment for dowry.",
    keyChange: "Dowry death is now Section 80.",
  }),
  ipc("306", "108", {
    id: "ipc-306",
    title: "Abetment of suicide",
    keywords: ["suicide"],
    scope: "Abetment of suicide. Abetment of suicide of a child or a person of unsound mind is Section 107 (old Section 305).",
    keyChange: "Abetment of suicide is now Section 108.",
  }),
  ipc("307", "109", {
    id: "ipc-307",
    title: "Attempt to murder",
    keywords: ["attempt to murder"],
    scope: "Attempt to murder, and the higher punishment where hurt is caused.",
    keyChange: "Attempt to murder is now Section 109. The comparative table marks it as changed from Section 307, so read Section 109 before you copy an old prayer.",
  }),
  ipc("318", "94", {
    id: "ipc-318",
    title: "Concealment of birth by secret disposal of a dead body",
    keywords: ["concealment of birth"],
    scope: "Secret disposal of the dead body of a child, intended to conceal the birth.",
    keyChange: "Old Section 318 is now Section 94. Do not confuse it with the new Section 318, which is cheating (old Sections 415 to 420).",
  }),
  ipc("323", "115(2)", {
    id: "ipc-323",
    title: "Punishment for voluntarily causing hurt",
    keywords: ["hurt", "simple hurt"],
    scope: "Punishment for voluntarily causing hurt. The definition that was Section 321 is now Section 115(1).",
    keyChange: "Simple hurt is Section 115(2). Hurt by a dangerous weapon is Section 118(1) (old Section 324), not Section 115.",
  }),
  ipc("324", "118(1)", {
    id: "ipc-324",
    title: "Voluntarily causing hurt by dangerous weapons or means",
    scope: "Voluntarily causing hurt by an instrument used for shooting, stabbing or cutting, or by fire or another dangerous means.",
    keyChange: "Hurt by dangerous weapons is Section 118(1). Grievous hurt by those means is Section 118(2) (old Section 326).",
  }),
  ipc("325", "117(2)", {
    id: "ipc-325",
    title: "Punishment for voluntarily causing grievous hurt",
    keywords: ["grievous hurt"],
    scope: "Punishment for voluntarily causing grievous hurt. The definition that was Section 322 is now Section 117(1). What counts as grievous hurt is Section 116 (old Section 320).",
    keyChange: "Grievous hurt is Section 117(2). The comparative table marks Section 117 as changed, so read it before you copy an old prayer.",
  }),
  ipc("326", "118(2)", {
    id: "ipc-326",
    title: "Voluntarily causing grievous hurt by dangerous weapons or means",
    scope: "Voluntarily causing grievous hurt by a dangerous weapon or means.",
    keyChange: "This limb is Section 118(2). The simple-hurt limb of the same section is Section 118(1) (old Section 324).",
  }),
  ipc("351", "130", {
    id: "ipc-351",
    title: "Assault",
    keywords: ["assault"],
    scope: "Assault, as defined. Criminal force and assault offences against a woman are Sections 74 to 79.",
    keyChange: "Old Section 351 is now Section 130. The new Section 351 is criminal intimidation (old Sections 503 and 506). Section 351 of the BNSS is a different provision: examination of the accused, which was Section 313 of the CrPC.",
  }),
  ipc("354", "74", {
    id: "ipc-354",
    title: "Assault or criminal force to a woman with intent to outrage her modesty",
    keywords: ["modesty", "outraging"],
    scope: "Assault or use of criminal force to a woman with intent to outrage her modesty.",
    keyChange: "The offence is now Section 74. Sexual harassment is Section 75 (old Section 354A), disrobing is Section 76 (old Section 354B), voyeurism is Section 77 (old Section 354C) and stalking is Section 78 (old Section 354D).",
  }),
  ipc("354A", "75", {
    id: "ipc-354a",
    title: "Sexual harassment",
    keywords: ["sexual harassment"],
    scope: "Sexual harassment, and the punishment for it.",
    keyChange: "Sexual harassment is now Section 75. The comparative table pairs it with old Section 354A.",
  }),
  ipc("375", "63", {
    id: "ipc-375",
    title: "Rape",
    keywords: ["rape"],
    scope: "The definition of rape. The punishment is Section 64 (old Section 376).",
    keyChange: "The definition is now Section 63. That number is also old Section 63 of the IPC (fines, now BNS Section 8) and Section 63 of the BSA (electronic records, old Section 65B). Name the Act in the pleading.",
  }),
  ipc("376", "64", {
    id: "ipc-376",
    title: "Punishment for rape",
    scope: "Punishment for rape. Aggravated punishment sits in the sections that follow Section 64, which the comparative table pairs with the old Section 376 sub-sections.",
    keyChange: "The punishment that was Section 376 is now Section 64. Read the later sub-sections before you plead an aggravated count.",
  }),
  ipc("379", "303(2)", {
    id: "ipc-379",
    title: "Punishment for theft",
    keywords: ["theft"],
    scope: "Punishment for theft. The definition that was Section 378 is now the opening of Section 303.",
    keyChange: "Theft is Section 303(2). Snatching is a new offence under Section 304 and is not Section 379.",
  }),
  ipc("384", "308(2)", {
    id: "ipc-384",
    title: "Punishment for extortion",
    keywords: ["extortion"],
    scope: "Punishment for extortion. The definition that was Section 383 is now Section 308(1).",
    keyChange: "Extortion is Section 308(2).",
  }),
  ipc("405", "316(1)", {
    id: "ipc-405",
    title: "Criminal breach of trust",
    keywords: ["breach of trust"],
    scope: "The definition of criminal breach of trust.",
    keyChange: "The definition is Section 316(1). The punishment that was Section 406 is Section 316(2). A public servant, banker, merchant or agent is Section 316(5) (old Section 409).",
  }),
  ipc("406", "316(2)", {
    id: "ipc-406",
    popular: 6,
    title: "Punishment for criminal breach of trust",
    keywords: ["criminal breach of trust"],
    scope: "Punishment for criminal breach of trust. The definition is Section 316(1) (old Section 405).",
    punishment: "Imprisonment up to 3 years, or fine, or both.",
    keyChange: "Sections 405 to 409 are now sub-sections of Section 316. Section 316(2) is the old Section 406 punishment. A carrier is 316(3), a clerk or servant is 316(4), and a public servant, banker, merchant or agent is 316(5).",
  }),
  ipc("409", "316(5)", {
    id: "ipc-409",
    title: "Criminal breach of trust by a public servant, banker, merchant or agent",
    scope: "Criminal breach of trust by a public servant, or by a banker, merchant or agent.",
    keyChange: "This is Section 316(5), not Section 316(2). Section 316(2) is the general punishment that was Section 406.",
  }),
  ipc("415", "318(1)", {
    id: "ipc-415",
    title: "Cheating",
    keywords: ["cheating"],
    scope: "The definition of cheating.",
    keyChange: "The definition is Section 318(1). The general punishment is Section 318(2) (old Section 417). Dishonestly inducing delivery of property is Section 318(4) (old Section 420).",
  }),
  ipc("417", "318(2)", {
    id: "ipc-417",
    title: "Punishment for cheating",
    scope: "The general punishment for cheating, where the charge is not the Section 420 limb.",
    keyChange: "The general punishment is Section 318(2). If the charge is dishonestly inducing delivery of property, cite Section 318(4), which was Section 420.",
  }),
  ipc("418", "318(3)", {
    id: "ipc-418",
    title: "Cheating with knowledge that wrongful loss may be caused to a person whose interest the offender is bound to protect",
    scope: "Cheating by a person who is bound to protect the interest of the person deceived.",
    keyChange: "This limb is Section 318(3).",
  }),
  ipc("420", "318(4)", {
    id: "ipc-420",
    popular: 1,
    title: "Cheating and dishonestly inducing delivery of property",
    keywords: ["cheating", "delivery of property"],
    scope: "Cheating that dishonestly induces delivery of property, or the making, alteration or destruction of a valuable security.",
    punishment: "Imprisonment up to 7 years, and fine.",
    keyChange: "Cheating is now one section. Section 318(1) is the definition (old Section 415), Section 318(2) is the general punishment (old Section 417), and Section 318(4) is inducing delivery of property (old Section 420). Old Section 318 of the IPC is a different offence: concealment of birth, now Section 94.",
  }),
  ipc("498A", "85", {
    id: "ipc-498a",
    title: "Cruelty by the husband or a relative of the husband",
    keywords: ["cruelty", "498a"],
    scope: "A husband, or a relative of the husband, subjecting a woman to cruelty.",
    keyChange: "The offence is now Section 85. The explanation of cruelty that sat under Section 498A is now Section 86.",
  }),
  ipc("503", "351(1)", {
    id: "ipc-503",
    title: "Criminal intimidation",
    keywords: ["intimidation"],
    scope: "The definition of criminal intimidation.",
    keyChange: "The definition is Section 351(1). The punishment that was Section 506 is Section 351(2), and the higher limb is Section 351(3). Old Section 351 of the IPC is assault, now Section 130.",
  }),
  ipc("506", "351(2)", {
    id: "ipc-506",
    title: "Punishment for criminal intimidation",
    also: ["351(3)"],
    keywords: ["criminal intimidation", "threat"],
    scope: "Section 351(2) is the general punishment. Section 351(3) is the higher punishment, where the threat is of death, grievous hurt, destruction of property by fire, or an imputation of unchastity to a woman.",
    keyChange: "Old Section 506 is split. Cite Section 351(2) or Section 351(3) according to the threat, not both as a matter of course. Section 351 of the BNSS is examination of the accused (old Section 313 CrPC).",
  }),
  ipc("499", "356(1)", {
    id: "ipc-499",
    title: "Defamation",
    keywords: ["defamation"],
    scope: "The definition of defamation.",
    keyChange: "Defamation is now Section 356. Section 356(1) is the definition that was Section 499. The comparative table marks Section 356 as changed, so read the punishment sub-section before you plead it.",
  }),
  ipc("509", "79", {
    id: "ipc-509",
    title: "Word, gesture or act intended to insult the modesty of a woman",
    keywords: ["modesty", "insult"],
    scope: "A word, gesture or act intended to insult the modesty of a woman.",
    keyChange: "The offence is now Section 79. Assault or criminal force with that intent remains Section 74 (old Section 354).",
  }),

  crpc("41A", "35(3)", {
    id: "crpc-41a",
    title: "Notice of appearance instead of arrest",
    keywords: ["arnesh kumar", "notice of appearance"],
    scope: "A notice directing the person to appear, instead of arresting them, where arrest is not required.",
    keyChange: "The notice that was Section 41A is now in Section 35. Arrest without warrant, which was Section 41, is in the same section. Read Section 35 for the conditions, including the protection for a person who is infirm or over 60.",
  }),
  crpc("125", "144", {
    id: "crpc-125",
    title: "Order for maintenance of wives, children and parents",
    keywords: ["maintenance"],
    scope: "A Magistrate's order for maintenance of a wife, child or parent.",
    keyChange: "Maintenance is now Section 144 of the BNSS. It is not Section 144 of the CrPC, which was a different power.",
  }),
  crpc("154", "173", {
    id: "crpc-154",
    title: "Information in a cognizable case",
    keywords: ["fir", "first information"],
    scope: "Registration of information in a cognizable case, the first information report.",
    keyChange: "The FIR is now Section 173 of the BNSS. Section 173 of the CrPC is a different provision: the police report on completion of investigation, which is now Section 193 of the BNSS. Do not swap them.",
  }),
  crpc("164", "183", {
    id: "crpc-164",
    title: "Recording of confessions and statements",
    keywords: ["confession", "164 statement"],
    scope: "A confession or statement recorded by a Magistrate.",
    keyChange: "Recording before a Magistrate is now Section 183.",
  }),
  crpc("167", "187", {
    id: "crpc-167",
    title: "Procedure when investigation cannot be completed in twenty-four hours",
    keywords: ["remand", "default bail", "police custody"],
    scope: "Remand, and the consequence when investigation is not completed within the period the section allows.",
    keyChange: "Remand is now Section 187. Read Section 187 itself for how custody is structured. Do not assume every sentence of Section 167 has been copied across.",
  }),
  crpc("173", "193", {
    id: "crpc-173",
    popular: 7,
    title: "Report of a police officer on completion of investigation",
    keywords: ["chargesheet", "charge-sheet", "police report"],
    scope: "The police report filed when investigation is complete.",
    keyChange: "The charge-sheet is now Section 193. Section 173 of the BNSS is the FIR, which was Section 154 of the CrPC. A pleading that says 'Section 173' without the Act is now ambiguous.",
  }),
  crpc("313", "351", {
    id: "crpc-313",
    title: "Power to examine the accused",
    keywords: ["examination of accused", "313 statement"],
    scope: "The court's power to examine the accused so that they can explain the circumstances appearing in the evidence.",
    keyChange: "Examination of the accused is now Section 351 of the BNSS. Section 351 of the BNS is criminal intimidation (old Sections 503 and 506). Old Section 351 of the IPC is assault, now BNS Section 130.",
  }),
  crpc("320", "359", {
    id: "crpc-320",
    title: "Compounding of offences",
    keywords: ["compounding"],
    scope: "Which offences may be compounded, and by whom.",
    keyChange: "Compounding is now Section 359. Check the table in that section. Do not assume every old Section 320 entry survived unchanged.",
  }),
  crpc("438", "482", {
    id: "crpc-438",
    popular: 2,
    title: "Direction for grant of bail to a person apprehending arrest",
    keywords: ["anticipatory bail", "pre-arrest"],
    scope: "A person who apprehends arrest for a non-bailable offence may apply to the High Court or the Court of Session for a direction that they be released on bail if arrested.",
    keyChange: "Anticipatory bail is now Section 482 of the BNSS, not Section 438. Section 482 of the CrPC is a different power: the High Court's inherent power, now Section 528 of the BNSS. Section 482(4) of the BNSS keeps a bar for accusations under Section 65 and Section 70(2) of the BNS. Read that sub-section before you rely on the bar.",
  }),
  crpc("482", "528", {
    id: "crpc-482",
    popular: 3,
    title: "Saving of the inherent powers of the High Court",
    keywords: ["quashing", "inherent power", "inherent jurisdiction"],
    scope: "Nothing in the Sanhita limits the inherent power of the High Court to give effect to an order, to prevent abuse of the process of any court, or otherwise to secure the ends of justice.",
    keyChange: "A quashing petition is now under Section 528. The text follows old Section 482, with 'this Code' now reading 'this Sanhita'. Section 482 of the BNSS is anticipatory bail. Citing 'Section 482' without the Act names the wrong power.",
  }),

  iea("32", "26", {
    id: "iea-32",
    title: "Statement of a person who is dead or cannot be found",
    keywords: ["dying declaration"],
    scope: "When a statement of a relevant fact by a person who is dead, or who cannot be found, is itself relevant.",
    keyChange: "The provision that was Section 32, including a dying declaration, is now Section 26.",
  }),
  iea("45", "39", {
    id: "iea-45",
    title: "Opinions of experts",
    keywords: ["expert"],
    scope: "When the opinion of an expert is relevant.",
    keyChange: "Expert opinion is now Section 39. The comparative table pairs Section 39(1) with old Section 45.",
  }),
  iea("65B", "63", {
    id: "iea-65b",
    popular: 4,
    title: "Admissibility of electronic records",
    keywords: ["electronic", "certificate", "65b"],
    scope: "When an electronic record is admissible, and the certificate that must go with it.",
    keyChange: "Cite Section 63 of the Bharatiya Sakshya Adhiniyam, 2023, and read the certificate requirement and the Schedule. Section 63 of the BNS is the definition of rape (old Section 375). Old Section 63 of the IPC is about fines, now BNS Section 8.",
  }),
  iea("101", "104", {
    id: "iea-101",
    title: "Burden of proof",
    keywords: ["burden of proof"],
    scope: "Whoever desires a court to give judgment on a legal right or liability must prove the facts on which that right or liability rests.",
    keyChange: "The burden of proof is now Section 104.",
  }),
  iea("114", "119", {
    id: "iea-114",
    title: "Court may presume the existence of certain facts",
    keywords: ["presumption"],
    scope: "The court may presume the existence of any fact it thinks likely to have happened, having regard to the common course of natural events, human conduct and public and private business.",
    keyChange: "The general presumption is now Section 119. The presumption as to absence of consent in a prosecution for rape, which was Section 114A, is Section 120.",
  }),
  iea("114A", "120", {
    id: "iea-114a",
    title: "Presumption as to absence of consent in certain prosecutions for rape",
    keywords: ["consent", "presumption"],
    scope: "Where sexual intercourse by the accused is proved and the woman states she did not consent, the court shall presume she did not consent.",
    keyChange: "The presumption that was Section 114A is now Section 120. The general 'may presume' provision is Section 119 (old Section 114).",
  }),
]

export const CODE_FILTERS = [
  { id: "all", label: "All criminal codes" },
  { id: "ipc", label: "IPC ↔ BNS" },
  { id: "crpc", label: "CrPC ↔ BNSS" },
  { id: "iea", label: "Evidence Act ↔ BSA" },
]

export const MICRO_TOOLS = [
  {
    slug: "bns-mapper",
    href: "/legal-tools",
    kicker: "Tool 1 · Most searched",
    title: "IPC / CrPC / IEA ↔ BNS / BNSS / BSA Mapper",
    description: "Section conversion, what changed, and a footnote ready to paste into a draft.",
    pathLabel: "/legal-tools",
  },
  {
    slug: "fir-text",
    href: "/legal-tools/fir-text",
    kicker: "Tool 2 · Pleadings",
    title: "Vernacular FIR & 7/12 text sandbox",
    description: "Paste Marathi, Hindi, Tamil, Telugu or English text and update the section numbers.",
    pathLabel: "/legal-tools/fir-text",
  },
  {
    slug: "citation-check",
    href: "/legal-tools/citation-check",
    kicker: "Tool 3 · Citations",
    title: "High Court bench line & citation check",
    description: "Check the shape of a citation, and the coram line, before it goes into a draft.",
    pathLabel: "/legal-tools/citation-check",
  },
  {
    slug: "limitation",
    href: "/legal-tools/limitation",
    kicker: "Tool 4 · Daily utility",
    title: "Indian Court Limitation Calculator",
    description: "Filing deadlines under the Limitation Act, with Section 12 certified-copy time excluded.",
    pathLabel: "/legal-tools/limitation",
  },
]

export const SAMPLE_PLEADING =
  "The Applicant is filing this Anticipatory Bail application under Section 438 of CrPC in connection with the FIR registered for offences under Section 420, Section 406 and Section 120B of IPC, supported by an electronic certificate under Section 65B of the Indian Evidence Act."

export function popularSections() {
  return SECTIONS.filter((s) => s.popular).sort((a, b) => a.popular - b.popular)
}

export function newSectionText(section) {
  return [section.neu.section, ...section.neu.also].join(" / ")
}

export function footnoteFor(section) {
  return `Note: ${section.title} under erstwhile Section ${section.old.section} of the ${section.old.act} corresponds to Section ${newSectionText(section)} of the ${section.neu.act}. Confirm the text against the bare Act before you file.`
}

const normalize = (value) => String(value).toLowerCase().replace(/\s/g, "")

function matchesToken(section, also, token) {
  const forms = [section, ...(also || [])].map(normalize)
  if (forms.includes(token)) return true
  if (token.includes("(") || /[a-z]/i.test(token)) return false
  return forms.some((form) => form.replace(/\([^)]*\)$/, "") === token)
}

function detectHint(query) {
  const has = (...words) => words.some((word) => query.includes(word))
  if (has("bnss", "nagarik")) return { family: "crpc", side: "new" }
  if (has("bns", "nyaya")) return { family: "ipc", side: "new" }
  if (has("bsa", "sakshya")) return { family: "iea", side: "new" }
  if (has("crpc", "cr.p.c", "criminal procedure")) return { family: "crpc", side: "old" }
  if (has("ipc", "i.p.c", "penal code")) return { family: "ipc", side: "old" }
  if (has("iea", "i.e.a", "evidence")) return { family: "iea", side: "old" }
  return null
}

function exactness(section, token) {
  if (!token) return 1
  const oldExact = normalize(section.old.section) === token
  const neuExact = [section.neu.section, ...section.neu.also].some((item) => normalize(item) === token)
  return oldExact || neuExact ? 0 : 1
}

export function searchSections(query, filter = "all") {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const pool = SECTIONS.filter((section) => filter === "all" || section.family === filter)
  const hint = detectHint(q)
  const hinted = hint ? pool.filter((section) => section.family === hint.family) : pool
  const token = q.match(/\d+[a-z]?(?:\(\d+\))?/i)?.[0]?.toLowerCase() || ""

  const collect = (needle) => hinted.filter((section) => {
    if (!needle) {
      const hay = `${section.title} ${section.keywords.join(" ")}`.toLowerCase()
      return hay.includes(q)
    }
    const oldHit = matchesToken(section.old.section, [], needle)
    const newHit = matchesToken(section.neu.section, section.neu.also, needle)
    if (hint?.side === "old") return oldHit
    if (hint?.side === "new") return newHit
    return oldHit || newHit
  })

  let hits = collect(token)
  if (token && !hits.length) {
    const digits = token.match(/^\d+/)?.[0]
    if (digits && digits !== token) hits = collect(digits)
  }

  return hits.sort((a, b) => {
    const byExact = exactness(a, token) - exactness(b, token)
    if (byExact) return byExact
    return `${a.family}-${a.old.section}`.localeCompare(`${b.family}-${b.old.section}`, undefined, { numeric: true })
  })
}

export function emptyHint(query) {
  const q = query.trim()
  if (/^\s*(section\s+)?138\s*$/i.test(q) || (/\b138\b/.test(q) && /ni\b|n\.i\.|negotiable|cheque/i.test(q))) {
    return "Section 138 of the Negotiable Instruments Act, 1881 is still in force. It was not replaced by the BNS, the BNSS or the BSA."
  }
  return "No correspondence for that number in this table. Try 420, 438, 302, 65B or 173."
}

const CODE_ENTRIES = [
  { src: "bharatiya nagarik suraksha sanhita", family: "crpc", side: "new" },
  { src: "bharatiya nyaya sanhita", family: "ipc", side: "new" },
  { src: "bharatiya sakshya adhiniyam", family: "iea", side: "new" },
  { src: "code of criminal procedure", family: "crpc", side: "old" },
  { src: "indian evidence act", family: "iea", side: "old" },
  { src: "indian penal code", family: "ipc", side: "old" },
  { src: "evidence act", family: "iea", side: "old" },
  { src: "bnss", family: "crpc", side: "new" },
  { src: "cr\\.?\\s?p\\.?\\s?c\\.?", family: "crpc", side: "old" },
  { src: "i\\.?\\s?p\\.?\\s?c\\.?", family: "ipc", side: "old" },
  { src: "i\\.?\\s?e\\.?\\s?a\\.?", family: "iea", side: "old" },
  { src: "bns", family: "ipc", side: "new" },
  { src: "bsa", family: "iea", side: "new" },
  { src: "आईपीसी", family: "ipc", side: "old" },
  { src: "आयपीसी", family: "ipc", side: "old" },
]

const bordered = (src) => `(?<![A-Za-z])(?:${src})(?![A-Za-z])`
const CODE_SRC = CODE_ENTRIES.map((entry) => bordered(entry.src)).join("|")
const NUMBER_SRC = "\\d+[A-Za-z]?(?:\\(\\d+\\))?"
const SECTION_SRC = "(?<![A-Za-z])(?:sections?|sec\\.?|u\\/s|s\\.|धारा|कलम|பிரிவு|సెక్షన్)(?![A-Za-z])"
const TOKEN_SRC = `(?<sw>${SECTION_SRC})\\s+(?<sn>${NUMBER_SRC})|(?<bn>${NUMBER_SRC})\\s*(?<bc>${CODE_SRC})|(?<co>${CODE_SRC})`

function identifyCode(raw) {
  const value = raw.trim()
  for (const entry of CODE_ENTRIES) {
    if (new RegExp(`^${entry.src}$`, "iu").test(value)) return { family: entry.family, side: entry.side }
  }
  return null
}

function locateCode(text, from, until) {
  const window = text.slice(from, until)
  let best = null
  for (const entry of CODE_ENTRIES) {
    const found = new RegExp(bordered(entry.src), "iu").exec(window)
    if (!found) continue
    const cand = {
      start: from + found.index,
      end: from + found.index + found[0].length,
      family: entry.family,
      side: entry.side,
    }
    if (!best || cand.start < best.start || (cand.start === best.start && found[0].length > best.rawLength)) {
      best = { ...cand, rawLength: found[0].length }
    }
  }
  return best
}

function sentenceEnd(text, from) {
  const re = /\n|;\s*|\.\s+(?=[A-Z])/g
  re.lastIndex = from
  const found = re.exec(text)
  return found ? found.index : text.length
}

function uniqueRow(number) {
  const token = number.toLowerCase()
  const hits = []
  for (const section of SECTIONS) {
    if (matchesToken(section.old.section, [], token)) hits.push({ section, side: "old" })
    if (matchesToken(section.neu.section, section.neu.also, token)) hits.push({ section, side: "new" })
  }
  const ids = new Set(hits.map((hit) => hit.section.id))
  if (ids.size !== 1) return null
  return hits.find((hit) => hit.side === "old") || hits[0]
}

function citeNew(section) {
  const extras = section.neu.also.map((item) => `Section ${item}`).join(" and ")
  const head = extras ? `Section ${section.neu.section} and ${extras}` : `Section ${section.neu.section}`
  return `${head} of the ${section.neu.act} (erstwhile Section ${section.old.section} ${section.old.code})`
}

function joinClauses(parts) {
  if (parts.length <= 1) return parts[0] || ""
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

function resolveNumbers(numbers, code) {
  return numbers.map((item) => {
    const applied = code || uniqueRow(item.value)
    if (!applied) return { value: item.value, status: "ambiguous" }
    const family = applied.family || applied.section.family
    const side = applied.side
    if (!code && applied.section) {
      return { value: item.value, status: side === "old" ? "rewrite" : "current", row: applied.section }
    }
    const token = item.value.toLowerCase()
    const matches = SECTIONS.filter((section) => {
      if (section.family !== family) return false
      return side === "new"
        ? matchesToken(section.neu.section, section.neu.also, token)
        : matchesToken(section.old.section, [], token)
    })
    if (matches.length === 1) return { value: item.value, status: side === "old" ? "rewrite" : "current", row: matches[0] }
    if (!matches.length) return { value: item.value, status: "unknown" }
    return { value: item.value, status: "ambiguous" }
  })
}

function clauseFor(item) {
  if (item.status === "rewrite") return citeNew(item.row)
  if (item.status === "current") return `Section ${newSectionText(item.row)} of the ${item.row.neu.act}`
  return `Section ${item.value}`
}

function bindSections(text) {
  const re = new RegExp(TOKEN_SRC, "giu")
  const groups = []
  let pending = []
  let current = null
  let lastEnd = 0

  const settleUnbound = () => {
    for (const item of pending) {
      groups.push({ start: item.start, end: item.end, numbers: [item], code: null })
    }
    pending = []
  }

  const flush = (code, end) => {
    if (!pending.length) return
    let start = pending[0].start
    if (code.tokenStart != null && code.tokenStart < start) {
      const gap = text.slice(code.tokenEnd, start)
      if (/^(?:\s+|of\s+the\s+|of\s+|the\s+)*$/i.test(gap)) start = code.tokenStart
    }
    groups.push({
      start,
      end,
      numbers: pending,
      code: { family: code.family, side: code.side },
    })
    pending = []
  }

  let match = re.exec(text)
  while (match) {
    const between = text.slice(lastEnd, match.index)
    if (/\n|;\s*|\.\s+(?=[A-Z])/.test(between)) {
      settleUnbound()
      current = null
    }
    lastEnd = match.index + match[0].length
    const groupsNamed = match.groups || {}

    if (groupsNamed.sw) {
      pending.push({ value: groupsNamed.sn, start: match.index, end: lastEnd })
      const next = locateCode(text, lastEnd, sentenceEnd(text, lastEnd))
      if (!next && current) flush(current, lastEnd)
    } else if (groupsNamed.bn) {
      const meta = identifyCode(groupsNamed.bc)
      pending.push({ value: groupsNamed.bn, start: match.index, end: match.index + groupsNamed.bn.length })
      if (meta) flush({ ...meta }, lastEnd)
      current = meta ? { ...meta, tokenStart: match.index, tokenEnd: lastEnd } : null
    } else if (groupsNamed.co) {
      const meta = identifyCode(groupsNamed.co)
      if (meta) {
        flush({ ...meta, tokenStart: match.index, tokenEnd: lastEnd }, lastEnd)
        current = { ...meta, tokenStart: match.index, tokenEnd: lastEnd }
      }
    }
    match = re.exec(text)
  }
  settleUnbound()
  return groups.sort((a, b) => a.start - b.start)
}

export function rewritePleadings(text) {
  const source = text || ""
  if (!source.trim()) return { text: "", replacements: [], missed: [] }
  const groups = bindSections(source)
  let cursor = 0
  let out = ""
  const replacements = []
  const missed = []

  for (const group of groups) {
    const start = Math.max(group.start, cursor)
    const end = Math.max(group.end, start)
    if (end <= cursor) continue
    const resolved = resolveNumbers(group.numbers, group.code)
    const rewrites = resolved.filter((item) => item.status === "rewrite")
    out += source.slice(cursor, start)
    if (rewrites.length) {
      const replacement = joinClauses(resolved.map(clauseFor))
      out += replacement
      for (const item of rewrites) {
        replacements.push({ row: item.row, from: source.slice(start, end), to: citeNew(item.row) })
      }
    } else {
      out += source.slice(start, end)
    }
    for (const item of resolved) {
      if (item.status === "ambiguous") {
        missed.push(`Section ${item.value} matches more than one provision. Search it above and pick the Act.`)
      } else if (item.status === "unknown") {
        missed.push(`Section ${item.value} is not in this table.`)
      }
    }
    cursor = end
  }
  out += source.slice(cursor)
  return { text: out, replacements, missed }
}

const CITATION_PATTERNS = [
  {
    label: "Supreme Court Cases",
    shape: "(2024) 5 SCC (Cri) 1",
    re: /^\((\d{4})\)\s+(\d+)\s+SCC\s+\(([^)]+)\)\s+(\d+)$/i,
    parts: (match) => [
      ["Year", match[1]],
      ["Volume", match[2]],
      ["Series", match[3]],
      ["Page", match[4]],
    ],
  },
  {
    label: "Supreme Court Cases",
    shape: "(2024) 5 SCC 1",
    re: /^\((\d{4})\)\s+(\d+)\s+SCC\s+(\d+)$/i,
    parts: (match) => [
      ["Year", match[1]],
      ["Volume", match[2]],
      ["Page", match[3]],
    ],
  },
  {
    label: "SCC OnLine",
    shape: "2024 SCC OnLine Del 123",
    re: /^(\d{4})\s+SCC\s+OnLine\s+([A-Za-z]+)\s+(\d+)$/i,
    parts: (match) => [
      ["Year", match[1]],
      ["Court", match[2].toUpperCase()],
      ["Number", match[3]],
    ],
  },
  {
    label: "AIR",
    shape: "AIR 2023 SC 100",
    re: /^AIR\s+(\d{4})\s+([A-Za-z][A-Za-z.&]{0,8})\s+(\d+)$/i,
    parts: (match) => [
      ["Year", match[1]],
      ["Court", match[2].toUpperCase()],
      ["Page", match[3]],
    ],
  },
  {
    label: "Supreme Court neutral citation",
    shape: "2024 INSC 88",
    re: /^(\d{4})\s+INSC\s+(\d+)$/i,
    parts: (match) => [
      ["Year", match[1]],
      ["Number", match[2]],
    ],
  },
  {
    label: "High Court neutral citation",
    shape: "2024:DHC:1234",
    re: /^(\d{4}):([A-Za-z]{2,6}):(\d+)$/,
    parts: (match) => [
      ["Year", match[1]],
      ["Court", match[2].toUpperCase()],
      ["Number", match[3]],
    ],
  },
]

export const CITATION_SHAPES = CITATION_PATTERNS.map((pattern) => pattern.shape)

export function checkCitation(input) {
  const text = String(input || "").trim().replace(/\s+/g, " ").replace(/\.$/, "")
  if (!text) return null
  for (const pattern of CITATION_PATTERNS) {
    const match = pattern.re.exec(text)
    if (!match) continue
    const year = Number(match[1])
    if (year < 1800 || year > 2100) {
      return { ok: false, text, reason: "That year is outside the range of a reported citation." }
    }
    return {
      ok: true,
      text,
      label: pattern.label,
      parts: pattern.parts(match).map(([label, value]) => ({ label, value })),
    }
  }
  return {
    ok: false,
    text,
    reason: "This does not match a reporter shape this check knows.",
  }
}

export const LIMITATION_ARTICLES = [
  {
    id: "116a",
    label: "Appeal to a High Court",
    article: "Article 116(a)",
    days: 90,
    years: 0,
    from: "the date of the decree or order",
    copy: true,
  },
  {
    id: "116b",
    label: "Appeal to any other court",
    article: "Article 116(b)",
    days: 30,
    years: 0,
    from: "the date of the decree or order",
    copy: true,
  },
  {
    id: "124",
    label: "Review by a court other than the Supreme Court",
    article: "Article 124",
    days: 30,
    years: 0,
    from: "the date of the decree or order",
    copy: true,
  },
  {
    id: "123",
    label: "Set aside an ex parte decree",
    article: "Article 123",
    days: 30,
    years: 0,
    from: "the date of the decree, or the date you learnt of it if the summons was not duly served",
    copy: false,
  },
  {
    id: "54",
    label: "Specific performance of a contract",
    article: "Article 54",
    days: 0,
    years: 3,
    from: "the date fixed for performance, or the date you had notice that performance was refused",
    copy: false,
  },
  {
    id: "58",
    label: "A declaration",
    article: "Article 58",
    days: 0,
    years: 3,
    from: "the date the right to sue first accrues",
    copy: false,
  },
  {
    id: "65",
    label: "Possession of immovable property based on title",
    article: "Article 65",
    days: 0,
    years: 12,
    from: "the date the defendant's possession becomes adverse",
    copy: false,
  },
  {
    id: "113",
    label: "A suit for which no other period is provided",
    article: "Article 113",
    days: 0,
    years: 3,
    from: "the date the right to sue accrues",
    copy: false,
  },
  {
    id: "137",
    label: "An application for which no other period is provided",
    article: "Article 137",
    days: 0,
    years: 3,
    from: "the date the right to apply accrues",
    copy: false,
  },
  {
    id: "custom",
    label: "A period I enter",
    article: "Entered period",
    days: 0,
    years: 0,
    from: "the date you enter",
    copy: null,
  },
]

function parseDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "")
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return { y, m, d }
}

function shift({ y, m, d }, days) {
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }
}

function pad(n) {
  return String(n).padStart(2, "0")
}

export function filingDeadline({ articleId, start, copyDays = 0, customDays, excludeCopy = false }) {
  const article = LIMITATION_ARTICLES.find((item) => item.id === articleId)
  if (!article) return { error: "Choose a period." }
  const parsed = parseDate(start)
  if (!parsed) return { error: "Enter the date the period runs from." }

  let days = article.days
  let years = article.years
  if (article.id === "custom") {
    days = Number(customDays)
    years = 0
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return { error: "Enter the period as a whole number of days, from 1 to 3,650." }
    }
  }

  const useCopy = article.copy === true || (article.copy == null && excludeCopy)
  const copies = useCopy ? Number(copyDays) : 0
  if (useCopy && (!Number.isInteger(copies) || copies < 0 || copies > 365)) {
    return { error: "Certified-copy time should be a whole number of days, from 0 to 365." }
  }

  let last = parsed
  if (years) last = shift(last, 0)
  if (years) {
    const dt = new Date(last.y + years, last.m - 1, last.d)
    last = { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }
  }
  last = shift(last, days + (useCopy ? copies : 0))
  const weekday = new Date(last.y, last.m - 1, last.d).toLocaleDateString("en-IN", { weekday: "long" })
  const display = new Date(last.y, last.m - 1, last.d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return {
    article,
    iso: `${last.y}-${pad(last.m)}-${pad(last.d)}`,
    display,
    weekday,
    copies: useCopy ? copies : 0,
    useCopy,
    period: years ? `${years} years` : `${days} days`,
  }
}
