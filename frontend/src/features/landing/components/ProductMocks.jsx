import PropTypes from "prop-types"
import { Icon } from "./primitives"

/* ------------------------------------------------------------------ */
/* Miniature Jurinex screens for the product pages. Each one mirrors   */
/* the real app screen (Case Briefs, Case Storage, Chat with Me, the   */
/* drafting picker and Citation Research) in the app's own theme:      */
/* ink sidebar, teal primary actions, grey workspace. Pure JSX, no     */
/* images. Every person, matter and file here is fictional.            */
/* ------------------------------------------------------------------ */

const PRIMARY = "bg-nx-teal"
const CASE_1 = "Sharma Traders Limited Vs Patil Industries"
const CASE_2 = "Verma Textiles Limited Vs The State of Maharashtra and others"
const CASE_3 = "Kulkarni Agro Products Vs Deshmukh Constructions"

const SIDEBAR_MAIN = [
  { icon: "LayoutGrid", label: "Dashboard" },
  { icon: "FileText", label: "Ongoing Cases" },
  { icon: "Shield", label: "Case Storage" },
  { icon: "MessageSquare", label: "Quick Chat" },
  { icon: "FileText", label: "AI Drafting" },
  { icon: "Scale", label: "Citation Research" },
]
const SIDEBAR_FOOT = [
  { icon: "CircleUser", label: "Profile" },
  { icon: "CreditCard", label: "Billing" },
  { icon: "Settings", label: "Settings" },
  { icon: "Info", label: "Get Support" },
  { icon: "CircleHelp", label: "Help" },
  { icon: "LogOut", label: "Logout" },
]

/** Window chrome + the real black sidebar around a screen. */
export const AppFrame = ({ active, title, children }) => (
  <div className="relative w-full" aria-hidden="true">
    <div className="absolute -inset-3 rounded-[1.75rem] bg-nx-teal/10 blur-2xl" />
    <div className="relative overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_32px_70px_-28px_rgba(6,52,44,0.35)]">
      <div className="flex items-center gap-2 border-b border-nx-line bg-nx-pale px-3.5 py-2">
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
        </span>
        <span className="ml-1 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[10px] text-nx-faint ring-1 ring-nx-line">
          jurinex.ai/#/{title}
        </span>
      </div>
      <div className="grid grid-cols-[7.25rem_1fr]">
        <div className="flex flex-col bg-nx-ink px-2 pb-2 pt-3 text-slate-400">
          <div className="flex items-center gap-1.5 px-1.5">
            <span className={`grid h-4.5 w-4.5 place-items-center rounded ${PRIMARY} text-white`}>
              <Icon name="Gavel" className="h-2.5 w-2.5" />
            </span>
            <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-white">Jurinex</span>
          </div>
          <div className="mt-3.5 space-y-0.5">
            {SIDEBAR_MAIN.map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[8px] font-medium ${
                  item.label === active ? "bg-nx-teal text-white" : "text-slate-400"
                }`}
              >
                <Icon name={item.icon} className="h-2.5 w-2.5 flex-none" />
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto space-y-0.5 pt-4">
            {SIDEBAR_FOOT.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 px-1.5 py-[3px] text-[7.5px] text-slate-400">
                <Icon name={item.icon} className="h-2.5 w-2.5 flex-none" />
                {item.label}
              </div>
            ))}
            <div className="mt-1.5 flex items-center gap-1.5 border-t border-white/15 px-1.5 pt-1.5 text-[7.5px] text-slate-400">
              <Icon name="ChevronLeft" className="h-2.5 w-2.5" />
              Collapse
            </div>
          </div>
        </div>
        <div className="min-w-0 bg-[#f5f6f7]">{children}</div>
      </div>
    </div>
  </div>
)

AppFrame.propTypes = {
  active: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
}

/* ------------------------------ shared bits ------------------------ */

const PrimaryButton = ({ children, className = "" }) => (
  <span className={`inline-flex flex-none items-center gap-1 rounded-md ${PRIMARY} px-2.5 py-1 text-[8px] font-semibold text-white ${className}`}>
    {children}
  </span>
)

PrimaryButton.propTypes = { children: PropTypes.node, className: PropTypes.string }

const GhostButton = ({ icon, children }) => (
  <span className="inline-flex flex-none items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[8px] font-medium text-slate-700">
    {icon && <Icon name={icon} className="h-2.5 w-2.5" />}
    {children}
  </span>
)

GhostButton.propTypes = { icon: PropTypes.string, children: PropTypes.node }

const Card = ({ className = "", children }) => (
  <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>{children}</div>
)

Card.propTypes = { className: PropTypes.string, children: PropTypes.node }

const Title = ({ children, sub }) => (
  <div>
    <p className="text-[13px] font-bold text-slate-900">{children}</p>
    {sub && <p className="mt-0.5 text-[8px] text-slate-500">{sub}</p>}
  </div>
)

Title.propTypes = { children: PropTypes.node, sub: PropTypes.node }

/* ------------------------------ Case Briefs ------------------------ */

const STATS = [
  ["Total Active Cases", 3],
  ["Cases Pending Review", 0],
  ["Upcoming Hearings (Next 7 Days)", 0],
  ["Documents Uploaded This Month", 1],
  ["Today's Hearings", 0],
]
const ROWS = [
  [CASE_1, "—", "Writ Petition (Civil)", "Unassigned", 1, "03-09-2026"],
  [CASE_2, "2103 OF 2024", "Writ Petition (Civil)", "Adv. Neha Kulkarni", 1, "26-08-2026"],
  [CASE_3, "2323", "Writ Petition (Criminal)", "Unassigned", 3, "25-08-2026"],
]
const TABLE_COLS = "grid-cols-[1.6fr_0.8fr_1.3fr_1.2fr_1fr_0.7fr_0.6fr_0.4fr_0.8fr_0.6fr]"

export const CreateCaseMock = () => (
  <AppFrame active="Ongoing Cases" title="cases">
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Title sub="Manage, track, and analyze all your cases in one place.">Case Briefs</Title>
        <PrimaryButton className="px-3 py-1.5 text-[8.5px]">Create New Case</PrimaryButton>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {STATS.map(([label, value]) => (
          <Card key={label} className="p-2">
            <p className="line-clamp-1 text-[7px] text-slate-500">{label}</p>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-900">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[9px] font-bold text-slate-900">Cases</p>
        <span className="flex w-40 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[7px] text-slate-400">
          <Icon name="Search" className="h-2.5 w-2.5" />
          Search by title, case number, court…
        </span>
      </div>

      <Card className="mt-2 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 pt-1.5">
          <div className="flex gap-4 text-[7.5px] text-slate-500">
            {["Ongoing (3)", "Pending (0)", "Disposed (0)", "Draft (0)"].map((t, i) => (
              <span key={t} className={`pb-1.5 ${i === 0 ? "border-b-2 border-nx-teal font-semibold text-slate-900" : ""}`}>
                {t}
              </span>
            ))}
          </div>
          <Icon name="SlidersHorizontal" className="h-2.5 w-2.5 text-slate-500" />
        </div>
        <div className={`grid ${TABLE_COLS} gap-2 bg-slate-50 px-3 py-1.5 text-[6.5px] font-semibold text-slate-600`}>
          {["Title", "Case No.", "Court/Bench", "Case Type/Stage", "Advocate-in-Charge", "Next Hearing", "Status", "Docs", "Last Updated", "Actions"].map((h) => (
            <span key={h} className="truncate">{h}</span>
          ))}
        </div>
        {ROWS.map(([title, no, type, adv, docs, updated]) => (
          <div key={title + no} className={`grid ${TABLE_COLS} items-center gap-2 border-t border-slate-100 px-3 py-2 text-[7px] text-slate-800`}>
            <span className="line-clamp-2 font-medium">{title}</span>
            <span>{no}</span>
            <span className="line-clamp-2">High Court of Bombay - Aurangabad</span>
            <span className="line-clamp-2">WRIT JURISDICTION/{type}</span>
            <span className="truncate">{adv}</span>
            <span>Never</span>
            <span><span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[6px] font-semibold text-emerald-700">Active</span></span>
            <span>{docs}</span>
            <span>{updated}</span>
            <span className="flex gap-1 text-slate-500">
              <Icon name="Eye" className="h-2.5 w-2.5" />
              <Icon name="Pencil" className="h-2.5 w-2.5" />
              <Icon name="Trash2" className="h-2.5 w-2.5" />
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[6.5px] text-slate-500">
          <span>Showing 1 to 3 of 3 results · Records per page: 5</span>
          <span className="flex gap-1">
            <span className="rounded border border-slate-200 px-1.5 py-0.5">Previous</span>
            <span className="rounded border border-slate-200 px-1.5 py-0.5 font-semibold text-slate-900">1</span>
            <span className="rounded border border-slate-200 px-1.5 py-0.5">Next</span>
          </span>
        </div>
      </Card>
    </div>
  </AppFrame>
)

/* ------------------------------ Case Storage ----------------------- */

const FILES = [
  ["folder", "Arguments", "08/26/2026"],
  ["folder", "Pleadings", "08/18/2026"],
  ["pdf", "Verma Textiles Vs The State & o…", "16.8 MB · 03/12/2026"],
  ["pdf", "Verma Textiles Vs The State & o…", "20.7 MB · 03/12/2026"],
  ["pdf", "CASE 17 WP-10616-2010", "15.7 MB · 03/10/2026"],
  ["pdf", "CASE 17 WP-10616-2010", "15.7 MB · 03/11/2026"],
  ["pdf", "Sharma Traders Mutual NDA & …", "127.2 KB · 03/22/2026"],
  ["pdf", "Patil Final Vol- 2 (1)_ocred (2)", "28.2 MB · 03/11/2026"],
  ["doc", "Client intake note", "6.4 KB · 08/11/2026"],
  ["doc", "Reply to Show Cause (draft)", "214 KB · 06/23/2026"],
]

const FileIcon = ({ kind }) => {
  if (kind === "folder") return <Icon name="Folder" className="h-4 w-4 text-slate-500" />
  if (kind === "doc")
    return (
      <span className="grid h-4 w-3.5 place-items-center rounded-sm bg-slate-600 text-[6px] font-bold text-white">W</span>
    )
  return (
    <span className="relative inline-flex">
      <Icon name="FileText" className="h-4 w-4 text-slate-500" />
      <span className="absolute -bottom-0.5 -right-1 rounded-sm bg-slate-700 px-0.5 text-[4.5px] font-bold text-white">PDF</span>
    </span>
  )
}

FileIcon.propTypes = { kind: PropTypes.string.isRequired }

export const CaseStorageMock = () => (
  <AppFrame active="Case Storage" title="vault">
    <div className="px-4 py-3.5">
      <Title>Case Storage</Title>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="flex w-44 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[7.5px] text-slate-400">
          <Icon name="Search" className="h-2.5 w-2.5" />
          Search files, folders, documents…
        </span>
        <GhostButton icon="SlidersHorizontal">Filters</GhostButton>
        <GhostButton icon="Upload">Upload</GhostButton>
        <GhostButton icon="Folder">New Folder</GhostButton>
        <GhostButton icon="Plus">Create Document</GhostButton>
        <span className="ml-auto">
          <GhostButton icon="Palette">Custom Branding</GhostButton>
        </span>
      </div>

      <Card className="mt-2.5">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div className="flex rounded-full bg-slate-100 p-0.5 text-[7.5px]">
            <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 font-semibold text-slate-900 shadow-sm">
              <span className="h-1 w-1 rounded-full bg-blue-500" /> My Documents
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 text-slate-600">
              <span className="h-1 w-1 rounded-full bg-emerald-500" /> My Cases
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[7px] text-slate-600">
            <span className="flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5">
              <Icon name="HardDrive" className="h-2 w-2" /> 112.8 MB
            </span>
            <span className="flex overflow-hidden rounded-md border border-slate-200">
              <Icon name="LayoutGrid" className="h-4 w-4 bg-slate-100 p-1 text-slate-900" />
              <Icon name="List" className="h-4 w-4 p-1 text-slate-500" />
            </span>
            <span className="rounded-md border border-slate-200 px-1.5 py-0.5">Sort by: Name ▾</span>
          </div>
        </div>
        <div className="p-3">
          <p className="text-[8px] font-semibold text-slate-900">My Documents</p>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {FILES.map(([kind, name, meta]) => (
              <div key={name + meta} className="rounded-md border border-slate-200 bg-white p-2">
                <div className="flex items-start justify-between">
                  <FileIcon kind={kind} />
                  <Icon name="MoreVertical" className="h-2.5 w-2.5 text-slate-400" />
                </div>
                <p className="mt-1.5 truncate text-[7.5px] font-medium text-slate-900">{name}</p>
                <p className="mt-0.5 text-[6.5px] text-slate-500">{meta}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  </AppFrame>
)

/* ------------------------------ Chat with Me ----------------------- */

const RESEARCH = [
  ["Search", "Find judgments where the IBC moratorium under Section 14 was applied to labour court proceedings."],
  ["BookOpen", "Retrieve Supreme Court judgments on the extinguishment of claims post-approval of a Resolution Plan."],
  ["Landmark", "Search for cases where Section 33(2)(b) of the Industrial Disputes Act was discussed in a CIRP moratorium."],
]
const EXHIBITS = [
  ["Exhibit A", "A copy of the Impugned Order dated 21.01.2025, passed by the Industrial Tribunal in Complaint (IT) No. 3 of 2019."],
  ["Exhibit B", "A print of the Master Data of the Petitioner Company from the Ministry of Corporate Affairs website."],
  ["Exhibit C", "A copy of the admission order dated 15.12.2017, passed by the NCLT, Mumbai Bench."],
  ["Exhibit D", "A copy of the public announcement (Form A) dated 23.12.2017, published by the Resolution Professional."],
  ["Exhibit E (Colly)", "A copy of the resolution plan dated 27.06.2018, along with subsequent Addendums."],
  ["Exhibit F", "A copy of the Statement of Claim dated 03.07.2018 in Reference (IT) No. 8 of 2017."],
]
const GROUPS = [
  ["Summarisation", "border-emerald-300 bg-emerald-50 text-emerald-800"],
  ["Drafting", "border-sky-300 bg-sky-50 text-sky-800"],
  ["Citation", "border-violet-300 bg-violet-50 text-violet-800"],
  ["Prelitigation", "border-emerald-300 bg-emerald-50 text-emerald-800"],
  ["Court Ready Documents", "border-rose-300 bg-rose-50 text-rose-800"],
  ["Cross Examination", "border-amber-300 bg-amber-50 text-amber-800"],
]

export const QuickChatMock = () => (
  <AppFrame active="Quick Chat" title="chat">
    <div className="flex flex-col px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-900">Chat with Me</p>
        <div className="flex items-center gap-1.5">
          <GhostButton icon="Clock">Client Brief ▾</GhostButton>
          <PrimaryButton>+ New Conversation</PrimaryButton>
        </div>
      </div>

      <div className="mt-2.5">
        <p className="flex items-center gap-1 text-[6.5px] font-bold uppercase tracking-wide text-slate-500">
          <Icon name="Search" className="h-2 w-2" /> Research further
        </p>
        <div className="mt-1 space-y-1">
          {RESEARCH.map(([icon, text]) => (
            <span key={text} className="flex w-fit max-w-[80%] items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50/60 px-2 py-1 text-[7px] text-slate-800">
              <Icon name={icon} className="h-2.5 w-2.5 text-sky-700" />
              <span className="truncate">{text}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2.5 ml-auto max-w-[70%] rounded-md bg-nx-teal-deep px-2.5 py-1.5 text-[8px] text-white">
        List all the exhibits mentioned in the index of the writ petition.
      </div>

      <Card className="mt-2 max-w-[85%] p-3">
        <p className="text-[8px] text-slate-800">
          Of course. Here is a complete list of all the exhibits mentioned in the index of the writ petition, as found on pages 1 through 4 of the document:
        </p>
        <ul className="mt-1.5 space-y-1 text-[7.5px] text-slate-800">
          {EXHIBITS.map(([k, v]) => (
            <li key={k} className="flex gap-1.5">
              <span className="mt-[5px] h-[3px] w-[3px] flex-none rounded-full bg-slate-800" />
              <span>
                <span className="font-bold">{k}:</span> {v}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap gap-1">
          {GROUPS.map(([label, tone]) => (
            <span key={label} className={`rounded-full border px-2 py-0.5 text-[7px] font-medium ${tone}`}>{label}</span>
          ))}
        </div>
        <div className="mt-1">
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[7px] text-emerald-800">Case summary</span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5">
        <span className="flex-1 text-[7.5px] text-slate-400">Ask a follow-up or start a new query…</span>
        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[7px] text-slate-500">Role ▾</span>
        <Icon name="Plus" className="h-3.5 w-3.5 rounded border border-slate-200 p-0.5 text-slate-500" />
        <Icon name="Mic" className="h-3.5 w-3.5 rounded border border-slate-200 p-0.5 text-slate-500" />
        <span className={`grid h-4 w-4 place-items-center rounded ${PRIMARY} text-white`}>
          <Icon name="Send" className="h-2.5 w-2.5" />
        </span>
      </div>
      <p className="mt-1 text-center text-[6.5px] text-slate-500">The responses are AI-generated. Please verify the information from your end.</p>
    </div>
  </AppFrame>
)

/* ------------------------------ AI Drafting ------------------------ */

const DRAFT_CARDS = [
  {
    icon: "Gavel", tint: "bg-teal-50 text-nx-teal", pill: "Drafts in case chat", pillTone: "bg-teal-50 text-nx-teal-deep",
    title: "Litigation drafting",
    text: "Writs, plaints, bail and quashing applications, written statements, appeals. Built on your case's facts, parties and chronology, argued step by step in chat.",
    foot: ["Routes to:", "pick a case · create a case · dashboard chat"],
  },
  {
    icon: "House", tint: "bg-emerald-50 text-emerald-600", pill: "Guided picker", pillTone: "bg-emerald-50 text-emerald-700",
    title: "Conveyancing",
    text: "Conveyancing deeds and property agreements, including leave and licence, rent and lease, sale and gift documents, drafted from a template you pick.",
    foot: ["Categories:", "Conveyancing Deeds · Property Agreements"],
  },
  {
    icon: "Briefcase", tint: "bg-slate-100 text-slate-600", pill: "Guided picker", pillTone: "bg-slate-100 text-slate-600",
    title: "Corporate & contracts",
    text: "Commercial and corporate agreements, plus corporate deeds. Business documents drafted from a template you pick.",
    foot: ["Categories:", "Commercial & Corporate Agreements · Corporate Deeds"],
  },
  {
    icon: "FileText", tint: "bg-amber-50 text-amber-600", pill: "Guided picker", pillTone: "bg-amber-50 text-amber-700",
    title: "General drafting",
    text: "Appeals, applications, arbitration, bail, civil and other matters. The full template library, searchable across every active category.",
    foot: ["Categories:", "Appeals & Revisions · Applications · Arbitration +15 more"],
  },
]

export const AIDraftingMock = () => (
  <AppFrame active="AI Drafting" title="aidrafting">
    <div className="mx-auto max-w-[36rem] px-4 py-4">
      <p className="text-[13px] font-bold text-slate-900">Start a draft, what kind of work is this?</p>
      <p className="mt-0.5 text-[8px] text-slate-500">Litigation drafts in your case chat. Everything else drafts here, in the guided picker.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {DRAFT_CARDS.map((c) => (
          <Card key={c.title} className="p-3">
            <span className={`grid h-6 w-6 place-items-center rounded-md ${c.tint}`}>
              <Icon name={c.icon} className="h-3 w-3" />
            </span>
            <span className={`mt-2 inline-block rounded-full px-1.5 py-0.5 text-[6px] font-bold uppercase tracking-wide ${c.pillTone}`}>{c.pill}</span>
            <p className="mt-1.5 text-[9px] font-bold text-slate-900">{c.title}</p>
            <p className="mt-1 text-[7px] leading-relaxed text-slate-600">{c.text}</p>
            <p className="mt-2 border-t border-dashed border-slate-200 pt-1.5 text-[6.5px] text-slate-500">
              {c.foot[0]} <span className="font-semibold text-slate-800">{c.foot[1]}</span>
            </p>
          </Card>
        ))}
      </div>
      <Card className="mt-2 flex items-center justify-between p-3">
        <div>
          <p className="text-[9px] font-bold text-slate-900">Recent drafts & my templates</p>
          <p className="mt-0.5 text-[7px] text-slate-500">Pick up an existing draft, or create and manage your templates.</p>
        </div>
        <Icon name="ArrowRight" className="h-3 w-3 text-nx-teal" />
      </Card>
    </div>
  </AppFrame>
)

/* ------------------------------ Citation Research ------------------ */

const StepHead = ({ n, title, sub }) => (
  <div className="flex items-start gap-2 border-b border-slate-200 px-3 py-2">
    <span className="grid h-4 w-4 flex-none place-items-center rounded-full bg-teal-50 text-[7px] font-bold text-nx-teal-deep">{n}</span>
    <div>
      <p className="text-[9px] font-bold text-slate-900">{title}</p>
      <p className="text-[7px] text-slate-500">{sub}</p>
    </div>
  </div>
)

StepHead.propTypes = { n: PropTypes.number, title: PropTypes.string, sub: PropTypes.string }

const Toggle = ({ on }) => (
  <span className={`relative inline-block h-3 w-6 flex-none rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
    <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
  </span>
)

Toggle.propTypes = { on: PropTypes.bool }

const FOCUS = [
  ["Issues and grounds", "Spotted legal issues plus the grounds already pleaded.", true],
  ["Issue spotting", "Only the legal issues the material raises.", false],
  ["Pleaded grounds", "Only the grounds set out in the document.", false],
]
const RECENT = [
  [CASE_1, "14 issues", "6 days ago"],
  [CASE_2, "9 issues", "6 days ago"],
  [CASE_3, "4 issues", "14 days ago"],
]

export const CitationResearchMock = () => (
  <AppFrame active="Citation Research" title="citation-research">
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Title sub="Analyze matter documents and pleaded grounds, then retrieve relevant Indian Kanoon authorities.">Citation Research</Title>
        <div className="flex items-center gap-2 text-[7px] text-slate-600">
          <GhostButton icon="Search">Advanced Search</GhostButton>
          <span>Wednesday, September 9, 2026</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_11rem] gap-2">
        <div className="space-y-2">
          <Card>
            <StepHead n={1} title="Choose the research material" sub="Use an existing matter, upload one document, or paste case text." />
            <div className="px-3 pt-2">
              <div className="flex gap-3 text-[7.5px] text-slate-500">
                {["My cases", "Upload document", "Paste text"].map((t, i) => (
                  <span key={t} className={`pb-1 ${i === 0 ? "border-b-2 border-nx-teal font-semibold text-slate-900" : ""}`}>{t}</span>
                ))}
              </div>
            </div>
            <div className="p-3 pt-2">
              <span className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-[7.5px] text-slate-400">
                Select a case… <Icon name="ChevronsUpDown" className="h-2.5 w-2.5" />
              </span>
            </div>
          </Card>

          <Card>
            <StepHead n={2} title="Set the research approach" sub="Control what the analysis should identify before any precedent search is run." />
            <div className="divide-y divide-slate-100 px-3">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-[8px] font-semibold text-slate-900">Acting for</p>
                  <p className="text-[6.5px] text-slate-500">The client's side is inferred from the papers; adverse authority also surfaces.</p>
                </div>
                <span className="flex rounded-md bg-slate-100 p-0.5 text-[7px]">
                  <span className="rounded bg-white px-2 py-0.5 font-semibold text-nx-teal-deep shadow-sm">Auto</span>
                  <span className="px-2 py-0.5 text-slate-600">Petitioner</span>
                  <span className="px-2 py-0.5 text-slate-600">Respondent</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-[8px] font-semibold text-slate-900">Fresh matter</p>
                  <p className="text-[6.5px] text-slate-500">Use when nothing has been drafted or filed.</p>
                </div>
                <Toggle />
              </div>
              <div className="py-2">
                <p className="text-[8px] font-semibold text-slate-900">Legal focus</p>
                <p className="text-[6.5px] text-slate-500">Select what should be extracted from the material.</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {FOCUS.map(([t, d, sel]) => (
                    <div key={t} className={`rounded-md border p-1.5 ${sel ? "border-nx-teal bg-teal-50/50" : "border-slate-200"}`}>
                      <p className="flex items-center gap-1 text-[7.5px] font-semibold text-slate-900">
                        <span className={`h-2 w-2 rounded-full border ${sel ? "border-nx-teal bg-nx-teal" : "border-slate-400"}`} />
                        {t}
                        {sel && <span className="rounded bg-slate-100 px-1 text-[5.5px] font-medium text-slate-600">Recommended</span>}
                      </p>
                      <p className="mt-0.5 text-[6.5px] text-slate-500">{d}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-[8px] font-semibold text-slate-900">Boolean precision search</p>
                  <p className="text-[6.5px] text-slate-500">Builds grouped AND/OR queries for narrow or complex questions.</p>
                </div>
                <Toggle />
              </div>
            </div>
          </Card>

          <Card className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-teal-50 text-[7px] font-bold text-nx-teal-deep">3</span>
              <div>
                <p className="text-[9px] font-bold text-slate-900">Review and analyse</p>
                <p className="text-[6.5px] text-slate-500">Issues and pleaded grounds · Standard keyword search</p>
              </div>
            </div>
            <PrimaryButton className="px-3 py-1.5">
              <Icon name="Sparkles" className="h-2.5 w-2.5" /> Analyse matter
            </PrimaryButton>
          </Card>
        </div>

        <Card className="self-start p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-100 text-slate-600">
              <Icon name="History" className="h-2.5 w-2.5" />
            </span>
            <div>
              <p className="text-[8px] font-bold text-slate-900">Recent research</p>
              <p className="text-[6.5px] text-slate-500">3 saved analyses</p>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {RECENT.map(([name, issues, when]) => (
              <div key={name + when} className="border-t border-slate-100 pt-1.5">
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate text-[7.5px] font-semibold text-slate-900">{name}</p>
                  <span className="flex-none rounded-full bg-emerald-100 px-1 text-[5.5px] font-semibold text-emerald-700">Analysed</span>
                </div>
                <p className="mt-0.5 text-[6.5px] text-slate-500">{issues} · Case-linked · {when}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  </AppFrame>
)

/* ------------------------------------------------------------------ */

const MOCKS = {
  "create-case": CreateCaseMock,
  "case-storage": CaseStorageMock,
  "quick-chat": QuickChatMock,
  "ai-drafting": AIDraftingMock,
  "citation-research": CitationResearchMock,
}

/** Renders the miniature screen for a product id. */
export const ProductMock = ({ id }) => {
  const Mock = MOCKS[id]
  return Mock ? <Mock /> : null
}

ProductMock.propTypes = { id: PropTypes.string.isRequired }
