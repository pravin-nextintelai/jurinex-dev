import advocatesPhoto from "@/assets/landing/advocates-meeting.jpg"
import executionPetitionPhoto from "@/assets/landing/execution-petition.png"
import karnatakaCourtPhoto from "@/assets/landing/karnataka-high-court.png"
import karnatakaFirHeadline from "@/assets/landing/karnataka-fir-headline.png"
import subsequentSuitPhoto from "@/assets/landing/subsequent-suit.jpg"
import vandeMataramCourtPhoto from "@/assets/landing/vande-mataram-supreme-court.webp"
import vandeMataramHeadline from "@/assets/landing/vande-mataram-headline.png"
import aiLawPhoto2 from "@/assets/ai law02.jpeg"
import socialMediaArrestPhoto from "@/assets/landing/hub/social-media-arrest.jpg"
import whatsappEvidencePhoto from "@/assets/landing/hub/whatsapp-evidence.jpg"
import writAppealPhoto from "@/assets/landing/hub/writ-appeal-lawyer.jpg"
import bailBooksPhoto from "@/assets/landing/hub/bail-law-books.jpg"
import mediationSigningPhoto from "@/assets/landing/hub/mediation-signing.jpg"
import serviceContractPhoto from "@/assets/landing/hub/employment-contract.jpg"
import chequePhoto from "@/assets/landing/hub/holding-cheque.jpg"
import { HIGH_COURTS } from "./landingConstants"

/**
 * Content Hub data. Until the content API ships these are SAMPLE stories:
 * practice explainers written for layout and navigation, not reports of
 * actual judgments. Replace with API data before publishing real news.
 */

export const SUPREME_COURT = { slug: "supreme-court", name: "Supreme Court" }

export const HUB_TOPICS = [
  { slug: "news-updates", label: "News Updates" },
  { slug: "judgments", label: "Judgments" },
  { slug: "articles", label: "Articles" },
  { slug: "explainers", label: "Explainers" },
]

/** Dark Content Hub bar. `menu` items open a dropdown; `columns` lays it out in a grid. */
export const HUB_NAV = [
  { label: "Top Stories", href: "/content-hub" },
  {
    label: "Supreme Court",
    href: "/content-hub/supreme-court",
    menu: [
      { label: "Supreme Court Home", href: "/content-hub/supreme-court" },
      { label: "Judgments", href: "/content-hub/stories?court=supreme-court&topic=judgments" },
      { label: "News Updates", href: "/content-hub/stories?court=supreme-court&topic=news-updates" },
      { label: "All Supreme Court Stories", href: "/content-hub/stories?court=supreme-court" },
    ],
  },
  {
    label: "High Courts",
    href: "/content-hub/high-courts",
    columns: 3,
    menu: [
      { label: "All High Courts", href: "/content-hub/high-courts" },
      ...HIGH_COURTS.map((c) => ({ label: c.name, href: `/content-hub/high-courts/${c.slug}` })),
    ],
  },
  ...HUB_TOPICS.map((t) => ({ label: t.label, href: `/content-hub/stories?topic=${t.slug}` })),
]

export const HUB_STORIES = [
  {
    slug: "six-stanza-vande-mataram-plea",
    title:
      "Supreme Court Examines Plea Challenging New Six-Stanza Vande Mataram Order Amid Secularism Constitutional Concerns",
    excerpt:
      "A former IAS officer has asked the Court to quash Home Ministry orders that prescribe the six-stanza Anandamath text of Vande Mataram, and to bar any penalty for those who respectfully decline to sing it.",
    image: vandeMataramCourtPhoto,
    imageFit: "video",
    imageAlt: "Supreme Court of India, with the national flag and a Vande Mataram graphic",
    figures: [
      {
        src: vandeMataramHeadline,
        alt: "Supreme Court examines a plea challenging the new six-stanza Vande Mataram order on secularism grounds",
      },
    ],
    body: [
      "The Supreme Court is seized of a writ petition challenging two Ministry of Home Affairs orders, dated 28 January and 9 July 2026, that prescribe the six-stanza version of Vande Mataram for singing and playing on specified occasions. The petition, filed by Balakrishnan Sathyabhama Mavoji, a retired IAS officer from Kerala, is reported to be listed for hearing on 27 October 2026. It asks the Court to quash both orders.",
      "The case turns on which text the State may treat as the National Song. The petitioner says the two opening stanzas were written in the early 1870s as a standalone ode to the motherland, and that this shorter text is what governments, schools and public functions have sung since Independence. The six-stanza composition, he says, belongs to Bankim Chandra Chattopadhyay’s 1882 novel Anandamath. On his reading, those later stanzas address particular deities and sit inside a Vaishnavite and Shakta religious frame. The 2026 orders, the plea argues, drop the shorter text that has been in use for decades, without any decision of Parliament conferring the title of National Song.",
      "The petition invokes Articles 14, 19(1)(a) and 19(1)(b), 21, 25(1) and 28(3), together with secularism and fraternity as features of the Constitution’s basic structure. Mavoji, who describes himself as a Hindu from a Scheduled Caste community and files in a representative capacity as chairman of the Anupathika Prathinidhya Prakshobha Samithi, says he does not follow the religious practices named in the longer text. Compulsory singing, he argues, would force him to offer obeisance to a doctrine he does not accept. He also relies on the settled position that freedom of speech includes the freedom not to speak, or to sing, against one’s conscience.",
      "Three reliefs are pressed. A writ of certiorari to set aside the January and July orders. A mandamus restraining the Union from requiring the six-stanza text at state, ceremonial, governmental or educational events, including in schools. And a declaration that the two-stanza version alone is to be recognised and performed as the National Song, with respectful non-participation treated neither as an offence nor as disrespect.",
      "The plea joins a set of challenges already before the Court, including one by Carnatic musician T.M. Krishna to a circular requiring all six stanzas at official events and school assemblies. Last month the Court asked the Centre for its response in that matter. On 22 September 2026, a Bench headed by Chief Justice Surya Kant observed orally that an elected government may decide how much of the National Song is to be sung, but cannot compel a conscientious objector to sing or play it on pain of penalty. The Bench referred to Bijoe Emmanuel v. State of Kerala (1986), which protected students who stood in respectful silence during the national anthem. For counsel following the 27 October listing, the questions to watch are how far an executive order can go in fixing the text, and whether declining to join in can carry any civil or criminal consequence.",
    ],
    court: "supreme-court",
    topic: "news-updates",
    date: "2026-10-24",
    readMins: 5,
  },
  {
    slug: "recovery-of-possession-without-declaration",
    title: "When Can a Suit for Recovery of Possession Proceed Without a Prayer for Declaration of Title?",
    excerpt:
      "A practitioner's guide to how courts approach suits for possession where the plaintiff's title is under a cloud, and when a separate declaratory prayer becomes necessary. The answer usually turns on whether title is admitted, denied, or only clouded.",
    body: [
      "A suit for recovery of possession can stand on its own where the plaintiff shows a better right to possess and the defendant does not set up an independent title. A declaratory prayer is not something to add to every plaint as a matter of form.",
      "That changes once ownership is specifically denied, or the plaint itself discloses a cloud on title. A decree for possession alone does not quiet title, so the plaintiff is generally expected to seek a declaration in the same suit.",
      "Read the written statement before treating declaration as optional. If title is in issue and the relief is left out without the court's leave, a later suit for the same property is the fact pattern that runs into Order II Rule 2 of the Code of Civil Procedure and constructive res judicata.",
    ],
    image: subsequentSuitPhoto,
    imageFit: "contain",
    imageAlt:
      "Supreme Court of India, with Justice Dipankar Datta and Justice Augustine George Masih",
    court: "supreme-court",
    topic: "explainers",
    date: "2026-10-23",
    readMins: 6,
  },
  {
    slug: "karnataka-hc-quashes-fir-denial-of-justice-posters",
    title:
      'Karnataka High Court quashes FIR against persons who put up posters terming Supreme Court judgment a "denial of justice"',
    excerpt:
      "The Court held that expressing dissent against a judgment did not attract offences of promoting enmity or outraging religious feelings, and fell within the limits of free speech.",
    image: karnatakaCourtPhoto,
    imageFit: "video",
    imageAlt: "Entrance of the High Court of Karnataka",
    figures: [{ src: karnatakaFirHeadline, alt: "The holding in brief: dissent against a judgment is protected speech" }],
    body: [
      "The Karnataka High Court has quashed an FIR against 13 persons who pasted posters in Mangaluru calling a Supreme Court judgment a “denial of justice” and asking people to raise their voice for justice. Justice H.P. Sandesh held that the posters were dissent against a verdict, and that such dissent falls within Articles 19 and 21 of the Constitution.",
      "Police had booked them under Sections 153A, 295A and 120B of the Indian Penal Code, and under Section 3 of the Karnataka Open Place Disfigurement Act. The complaint treated the slogans as capable of causing disharmony. The petitioners said those words disclosed none of the offences, and relied on the Supreme Court’s ruling in Javed Ahmad Hajam on the right to disagree with decisions of public authorities.",
      "The Court read the posters for the words actually used. Disagreeing with a judgment is not, by itself, promoting enmity between groups or an act aimed at outraging religious feelings. For Section 153A, the effect of the words is judged by how reasonable people would read them. The reaction of a few is not enough, and dissatisfaction with a verdict is not sedition against the State. The Court also applied the ingredients of the offence as explained in Bilal Ahmed Kaloo.",
      "Finding no ground to let the prosecution continue, the Court quashed the FIR in Mahammed Hanif and Others v. State of Karnataka (2026:KHC:58498). For counsel advising on speech about a decided case, the order is a reminder to test the words against the section charged, rather than treat criticism of a court as an offence on its own.",
    ],
    court: "karnataka",
    topic: "judgments",
    date: "2026-10-20",
    readMins: 4,
  },
  {
    slug: "arrest-guidelines-social-media-posts",
    title: "Arrests Over Social Media Posts: The Safeguards Every Advocate Should Cite",
    excerpt:
      "From notice before arrest to the proportionality test, a checklist of procedural protections and the provisions that anchor them. The first question is whether arrest is necessary at all.",
    image: socialMediaArrestPhoto,
    imageAlt: "A judge’s gavel on a desk beside a laptop and case files",
    body: [
      "A post is not, by itself, a reason to arrest. Where the alleged offence is punishable with imprisonment of up to seven years, Arnesh Kumar v. State of Bihar requires the police to record why arrest is necessary and, if it is not, to issue a notice of appearance. Section 35 of the Bharatiya Nagarik Suraksha Sanhita carries that discipline forward: reasons for arrest go on the record, and a notice is the ordinary first step when custody is not required.",
      "Counsel briefing a client who has been called in over a post should ask four things before the station visit. Which offence is actually disclosed by the words used. Whether those words are a cognizable offence at all. Whether the officer has recorded the reasons in Arnesh Kumar. And whether the client has been served a notice under Section 35 rather than picked up. A remand request that skips those steps is the point to oppose, with the checklist annexed to the bail or anticipatory-bail papers.",
      "The second line of argument is proportionality. Criticism, satire and disagreement with a judgment sit inside Articles 19 and 21 unless the words meet the ingredients of the offence charged. Ask the court to read the post itself, not the complainant’s paraphrase of it, and to test the reaction of reasonable readers rather than the complaint’s description of likely unrest.",
    ],
    court: "karnataka",
    topic: "articles",
    date: "2026-10-22",
    readMins: 7,
  },
  {
    slug: "whatsapp-messages-as-evidence",
    title: "Are WhatsApp Messages Enough to Sustain a Conviction? Reading the Evidence Rules",
    excerpt:
      "Certification requirements for electronic records, corroboration, and why screenshots alone often fail at trial. A printout is secondary evidence, and it needs a certificate before the court can read it.",
    image: whatsappEvidencePhoto,
    imageAlt: "Brass scales of justice and a gavel on a lawyer’s desk with case files",
    body: [
      "A WhatsApp chat is an electronic record. A screenshot or a forwarded printout is secondary evidence of that record, not the record itself. Section 63 of the Bharatiya Sakshya Adhiniyam, which carries forward the old Section 65B of the Evidence Act, requires a certificate identifying the device, describing how the output was produced, and confirming that the computer was operating properly. Arjun Panditrao Khotkar v. Kailash Kushanrao Gorantyal holds that this certificate is mandatory when the original device can be produced, and that it may be brought on record at any stage before the trial ends.",
      "Screenshots fail for predictable reasons. The print does not show the phone number or the device it came from. Messages are cropped so the thread cannot be read in sequence. The certificate is signed by someone who never handled the phone. Or the chat is a forward, with no witness who can speak to the original. Any one of those gaps is enough for an objection when the document is tendered.",
      "Even a complete certificate rarely carries a conviction on its own. The court still looks for corroboration: a witness who sent or received the messages, recovery of the handset, call-data records that line up with the thread, or conduct that matches what the chat describes. For the defence, the cross-examination is about the device, the export, and what the certificate does not say. For the prosecution, the certificate and the witness who made it belong in the charge-sheet, not in a reply filed after the objection.",
    ],
    court: "supreme-court",
    topic: "explainers",
    date: "2026-10-21",
    readMins: 6,
  },
  {
    slug: "writ-appeals-vigilance-fir",
    title: "Writ Appeals Against Orders Directing Registration of an FIR: What the Bench Looks At",
    excerpt:
      "Maintainability, delay and the scope of interference in intra-court appeals arising from vigilance proceedings. The Division Bench does not re-investigate the complaint.",
    image: writAppealPhoto,
    imageAlt: "An advocate reading case papers at a desk with a laptop and law books",
    body: [
      "An order of a single judge directing the police to register an FIR is challenged, where the High Court rules allow it, by a writ appeal to a Division Bench. The appeal is an intra-court proceeding. It is not a second writ petition, and it is not a rehearing of the complaint on facts the single judge never had.",
      "Three questions usually decide it. Is the appeal maintainable against a direction that leaves the investigation to the police. Is it in time, or is the explanation for delay only an afterthought once the FIR was registered. And did the single judge stay inside Lalita Kumari v. Government of Uttar Pradesh, which requires registration when the information discloses a cognizable offence and confines a preliminary inquiry to a short list of categories. A vigilance file that was not before the single judge is a weak basis for asking the appeal bench to take a different view.",
      "Draft the memo of appeal around those three points, with the writ petition, the counter and the order extracted. Ask for a stay of further steps only where the FIR has not yet been registered or the direction is wider than the complaint. Once investigation is underway, the practical relief is usually a narrow one: keep the direction tied to the offences actually disclosed, and leave the rest to the officer.",
    ],
    court: "kerala",
    topic: "news-updates",
    date: "2026-10-21",
    readMins: 5,
  },
  {
    slug: "bail-economic-offences",
    title: "Bail in Economic Offences: Twin Conditions, Parity and Long Incarceration",
    excerpt:
      "How courts weigh the gravity of the offence against the right to a speedy trial, with drafting tips for bail applications. Gravity is a factor. It is not a reason to refuse bail in every economic case.",
    image: bailBooksPhoto,
    imageAlt: "A stack of law books beside an open notebook and a pen",
    body: [
      "Economic offences are not one class. For an ordinary prosecution, the bail court still applies the usual tests: the allegation, the evidence gathered, the likelihood of absconding or of interfering with witnesses, and the stage of the trial. Satender Kumar Antil v. Central Bureau of Investigation treats cooperation during investigation, and the fact that the accused was not arrested then, as reasons to grant bail on appearance. It also says economic offences are not homogeneous, so the label on the charge-sheet does not decide the application.",
      "A prosecution under the Prevention of Money Laundering Act is different. Section 45 imposes the twin conditions: the public prosecutor must have a chance to oppose, and the court must be satisfied that there are reasonable grounds to believe the accused is not guilty and is not likely to commit an offence while on bail. Vijay Madanlal Choudhary upheld those conditions. The application has to meet them on the complaint and the relied-upon documents, not on a general plea that the amount is disputed.",
      "Two further arguments belong in the same petition, with dates. Parity, where a co-accused with a comparable role is already on bail, and the reasons the court gave in that order. And long incarceration, where the trial has not started, the complaint runs to thousands of pages, and custody is approaching or passing the minimum sentence. Article 21 does not erase Section 45, but a court can record that continued custody has itself become disproportionate. Annex a custody chart, a witness chart, and the parity orders instead of narrating them in the body.",
    ],
    court: "delhi",
    topic: "articles",
    date: "2026-10-20",
    readMins: 8,
  },
  {
    slug: "commercial-courts-pre-institution-mediation",
    title: "Pre-Institution Mediation Under the Commercial Courts Act: Mandatory or Directory?",
    excerpt:
      "What happens when a commercial suit is filed without exhausting mediation, and when urgent interim relief excuses the step. A bare plea of urgency is not enough.",
    image: mediationSigningPhoto,
    imageAlt: "Close-up of hands signing a legal document with a pen",
    body: [
      "Section 12A of the Commercial Courts Act requires a plaintiff to exhaust pre-institution mediation before filing a commercial suit, unless the suit contemplates urgent interim relief. In Patil Automation Private Limited v. Rakheja Engineers Private Limited the Supreme Court held that the requirement is mandatory. A suit filed in breach of it, with no real claim for urgent interim relief, is liable to be rejected under Order VII Rule 11 of the Code of Civil Procedure.",
      "The exception is narrower than the heading of an interim application. The court reads the plaint and the interim prayer together. A prayer for a temporary injunction that only repeats the final relief, with no fact showing why the matter cannot wait for mediation, does not open Section 12A. What does is a pleaded risk that is current: dissipation of the claimed goods, invocation of a bank guarantee that expires this week, or a termination that takes effect before a mediation can be fixed.",
      "For the plaintiff who genuinely needs that relief, say so in a short paragraph of the plaint and move the interim application with the suit. For the defendant, the objection is a ground in the Order VII Rule 11 application, taken before the written statement, with the absence of a mediation application and the text of the interim prayer annexed. A suit rejected on this ground can be filed again after mediation. A suit that goes to trial without the objection having been pressed is a harder case to reopen.",
    ],
    court: "bombay",
    topic: "explainers",
    date: "2026-10-19",
    readMins: 5,
  },
  {
    slug: "service-law-regularisation",
    title: "Regularisation of Contractual Employees: The Questions High Courts Keep Asking",
    excerpt:
      "Sanctioned posts, length of service and the line between irregular and illegal appointments, explained with practice notes. Years in a post do not, by themselves, create a right to be regularised. The petition has to show a sanctioned post and how the person was engaged.",
    image: serviceContractPhoto,
    imageAlt: "An employment contract on a desk, with pens and a signature line for the employer",
    body: [
      "Secretary, State of Karnataka v. Umadevi is still the starting point. A person engaged on daily wages, on contract, or through a contractor does not acquire a right to regularisation only because the engagement has lasted for years. The Court drew a line between an irregular appointment, where the post existed and the selection was only procedurally defective, and an illegal appointment, made against no sanctioned post or in the face of the rules. Only the first category was left open for a one-time consideration.",
      "High Courts keep returning to the same four questions. Was there a sanctioned post on the date of engagement, and is it vacant now. Was any selection process held, or was the person simply continued by a succession of orders. How long has the work gone on, and was it the work of that post rather than a scheme or a project. And is the petitioner an employee of the department, or of a contractor whose contract has since ended. A petition that does not annex the sanction, the engagement orders and the latest contract is usually met with a direction to file a representation, not with a mandamus.",
      "The relief worth asking for is correspondingly narrow. Not a declaration that the petitioner stands regularised, but a direction to consider the case against the existing policy, or to hold a regular selection in which past service is given a stated weight. Where the appointment was illegal, the workable prayer is often continuity until that selection, not absorption.",
      "File the representation before the writ, and annex the reply, or the fact that none came within a stated time. The cause of action for the petition is the refusal or the silence, not the original contract. A chart of each engagement order, the post it names, and the gap between orders does more work than a long narrative of the petitioner’s service.",
    ],
    court: "madras",
    topic: "news-updates",
    date: "2026-10-18",
    readMins: 6,
  },
  {
    slug: "cheque-bounce-compounding",
    title: "Compounding Cheque Bounce Cases at the Appellate Stage: A Quick Reference",
    excerpt:
      "Stage-wise costs, the court's discretion to compound, and how to frame a joint compromise application. Before a High Court, the usual cost under the guidelines is 15% of the cheque amount.",
    image: chequePhoto,
    imageAlt: "Hands holding signed bank cheques",
    body: [
      "Section 147 of the Negotiable Instruments Act makes every offence under the Act compoundable, notwithstanding the scheme in the old Section 320 of the Code of Criminal Procedure. A cheque-dishonour case can therefore be settled after conviction, including while an appeal or a revision is pending. The compensatory purpose of Section 138 is what the court is asked to give effect to.",
      "Damodar S. Prabhu v. Sayed Babalal H. set a graded cost so that settlement is not left to the last day. Compounding at the first or second hearing before the Magistrate can be allowed without cost. A later application before the Magistrate is on payment of 10% of the cheque amount. Before the Sessions Court or a High Court in revision or appeal, the figure is 15%. Before the Supreme Court it is 20%. The deposit goes to the Legal Services Authority at that level: the District Authority for the Magistrate and the Sessions Court, the State Authority for the High Court, and the National Authority for the Supreme Court. The court may reduce the figure, but it has to record why.",
      "At the appellate stage the paper is a joint application by the complainant and the accused. It should set out the settlement, the payment of the cheque amount, and the deposit of the cost. The prayer is to compound the offence and to set aside the conviction and sentence. Annex the cheque, the judgment under appeal, the affidavits of both sides, and the receipt from the Legal Services Authority. A memo signed only by counsel, with nothing from the complainant, is the application that gets adjourned.",
    ],
    court: "punjab-haryana",
    topic: "judgments",
    date: "2026-10-17",
    readMins: 5,
  },
  {
    slug: "electoral-disputes-limitation",
    title: "Limitation in Election Petitions: Why the Clock Is Unforgiving",
    excerpt:
      "Computing the 45-day window, defects in verification, and the rare cases where amendment is allowed after limitation.",
    image: executionPetitionPhoto,
    court: "allahabad",
    topic: "explainers",
    date: "2026-10-16",
    readMins: 6,
  },
]

export const HUB_PROMOS = {
  leaderboard: {
    eyebrow: "Citation Research",
    title: "Find the authority before the other side does",
    text: "Indian Kanoon judgments matched to your pleaded grounds, verified before you rely on them.",
    cta: "Start Free Trial",
    href: "/register",
    image: aiLawPhoto2,
  },
  tile: {
    eyebrow: "AI Drafting",
    title: "Petitions in minutes, not days",
    text: "Guided templates for petitions, agreements and notices, drafted section by section.",
    cta: "Explore drafting",
    href: "/products/ai-drafting",
    image: advocatesPhoto,
  },
}

export const courtName = (slug) =>
  slug === SUPREME_COURT.slug ? SUPREME_COURT.name : HIGH_COURTS.find((c) => c.slug === slug)?.name

export const topicLabel = (slug) => HUB_TOPICS.find((t) => t.slug === slug)?.label

/** `court` may be "supreme-court", "high-courts" (any High Court) or a High Court slug. */
export const filterStories = ({ court, topic } = {}) =>
  HUB_STORIES.filter((s) => {
    if (court === "high-courts" && s.court === SUPREME_COURT.slug) return false
    if (court && court !== "high-courts" && s.court !== court) return false
    if (topic && s.topic !== topic) return false
    return true
  })

export const storyHref = (story) => `/content-hub/stories/${story.slug}`

export const formatStoryDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
