

import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { motion as Motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { HERO_COPY } from "../../utils/landingConstants"
import { Icon } from "./primitives"
import { EASE } from "./motionTokens"
import gavelIcon from "../../assets/jurinex-mark.png"
import heroOffice from "../../assets/landing/hero-office.jpg"

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
}

/* ------------------------------------------------------------------ */
/* Product showcase — the real Jurinex screens in miniature, rotating  */
/* as slides. All people, cases, and files are fictional.              */
/* ------------------------------------------------------------------ */

const DUMMY_CASE = "Sharma Traders Vs Patil Industries and others"
const DUMMY_CASE_2 = "Verma Textiles Vs The State of Maharashtra and others"

const SIDEBAR_MAIN = [
  { icon: "LayoutGrid", label: "Dashboard" },
  { icon: "Scale", label: "Ongoing Cases" },
  { icon: "Shield", label: "Case Storage" },
  { icon: "MessageSquare", label: "Quick Chat" },
  { icon: "PenLine", label: "AI Drafting" },
  { icon: "BookMarked", label: "Citation Research" },
]

const SIDEBAR_FOOT = [
  { icon: "User", label: "Profile" },
  { icon: "CreditCard", label: "Billing" },
  { icon: "Settings", label: "Settings" },
  { icon: "CircleHelp", label: "Get Support" },
  { icon: "Info", label: "Help" },
  { icon: "LogOut", label: "Logout" },
]

const Sidebar = ({ active }) => (
  <div className="hidden flex-col bg-nx-ink px-3 py-4 text-slate-300 sm:flex">
    <div className="flex items-center gap-2 px-1.5">
      <img src={gavelIcon} alt="" className="h-6 w-6 rounded-md" />
      <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white">
        Jurinex
      </span>
    </div>

    <div className="mt-5 space-y-0.5">
      {SIDEBAR_MAIN.map((item) => (
        <div
          key={item.label}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-medium ${
            item.label === active ? "bg-white/10 text-white" : "text-slate-400"
          }`}
        >
          <Icon name={item.icon} className="h-3 w-3 flex-none" />
          {item.label}
        </div>
      ))}
    </div>

    <div className="mt-auto space-y-0.5 border-t border-white/10 pt-3">
      {SIDEBAR_FOOT.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-medium text-slate-400"
        >
          <Icon name={item.icon} className="h-3 w-3 flex-none" />
          {item.label}
        </div>
      ))}
    </div>
  </div>
)

Sidebar.propTypes = { active: PropTypes.string.isRequired }

const CardTitle = ({ icon, children }) => (
  <span className="flex items-center gap-1.5 text-[9.5px] font-semibold text-nx-ink">
    <Icon name={icon} className="h-3 w-3 text-nx-muted" />
    {children}
  </span>
)

CardTitle.propTypes = { icon: PropTypes.string, children: PropTypes.node }

/* ----------------------------- Slide 1: Dashboard ----------------- */

const DUMMY_CASE_3 = "Kulkarni Agro Products Vs Deshmukh Constructions"
const DUMMY_ADVOCATE = "Adv. Rohan Sharma"

const ACTION_CARDS = [
  { icon: "FolderPlus", tint: "bg-teal-50 text-nx-teal", title: "Create New Case", sub: "Upload documents · OCR · AI analysis · chronology" },
  { icon: "FileText", tint: "bg-slate-100 text-slate-600", title: "AI Drafting", sub: "From a case, your documents, or a template" },
  { icon: "Scale", tint: "bg-emerald-50 text-emerald-600", title: "Citation", sub: "Citations · grounds · case-law search" },
  { icon: "Upload", tint: "bg-amber-50 text-amber-600", title: "Upload files", sub: "To storage or straight into a case folder" },
  { icon: "MessageSquare", tint: "bg-slate-100 text-slate-600", title: "Quick chat", sub: "Ask anything · attach a case for context" },
]

const WEEK_DAYS = [
  { d: "Fri", n: 4, active: true },
  { d: "Sat", n: 5 },
  { d: "Sun", n: 6 },
  { d: "Mon", n: 7 },
  { d: "Tue", n: 8 },
  { d: "Wed", n: 9 },
  { d: "Thu", n: 10 },
]

const RECENT_DRAFTS = [
  {
    title: "Terms of Service and Privacy – 7_Supporting_Documents_Checklist.docx",
    meta: "edited 25 Aug 2026",
    status: "Ready",
  },
  {
    title: `Terms of Service and Privacy – ${DUMMY_CASE}`,
    meta: `${DUMMY_CASE} · edited 25 Aug 2026`,
    status: "Draft",
  },
  {
    title: "Power of Attorney – 06_Covering_Letter_Index.pdf",
    meta: "edited 25 Aug 2026",
    status: "Ready",
  },
]

const RECENT_CASES = [DUMMY_CASE, DUMMY_CASE_2, DUMMY_CASE_3]

const CASE_STAGES = [
  { label: "Ongoing", value: 3 },
  { label: "Draft", value: 0 },
  { label: "Pending", value: 0 },
  { label: "Disposed", value: 0 },
]

const WEEK_AHEAD = [
  { label: "Hearings", value: 0 },
  { label: "Days with hearings", value: 0 },
  { label: "Drafts in progress", sub: "Yours, not limited to this week", value: 1 },
  { label: "Expected disposals", sub: "Due this week · overdue ones appear above", value: 0 },
]

const STATUS_TINT = {
  Ready: "bg-emerald-50 text-emerald-700",
  Draft: "bg-slate-100 text-slate-600",
  Ongoing: "bg-emerald-50 text-emerald-700",
}

const StatusPill = ({ status }) => (
  <span
    className={`flex-none rounded-full px-1.5 py-0.5 text-[7px] font-semibold ${STATUS_TINT[status]}`}
  >
    {status}
  </span>
)

StatusPill.propTypes = { status: PropTypes.string.isRequired }

const Panel = ({ className = "", children }) => (
  <div className={`min-h-0 overflow-hidden rounded-lg border border-nx-line/70 bg-white p-2 ${className}`}>
    {children}
  </div>
)

Panel.propTypes = { className: PropTypes.string, children: PropTypes.node }

const DashboardScreen = () => (
  <div className="flex h-full min-w-0 flex-col gap-2 overflow-hidden bg-[#f6f7f6] px-4 py-3 sm:px-5">
    {/* Header */}
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-bold text-nx-ink sm:text-sm">Hello, {DUMMY_ADVOCATE}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[8.5px] text-nx-faint">
          Friday, 4 September 2026 · No hearings this week
          <span className="text-nx-faint/80">· Updated 09:27</span>
          <Icon name="RefreshCw" className="h-2 w-2" />
        </p>
      </div>
      <span className="flex-none rounded-md bg-nx-teal px-3 py-1.5 text-[9px] font-semibold text-white">
        Create New Case
      </span>
    </div>

    {/* AI brief */}
    <div className="relative rounded-md border border-nx-line/70 border-l-[3px] border-l-nx-teal bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[7.5px] font-bold uppercase tracking-[0.1em] text-nx-faint">
        <Icon name="Sparkles" className="h-2.5 w-2.5 text-nx-teal" />
        Your Brief · Jurinex AI
        <span className="font-medium normal-case tracking-normal">· Updated 09:27</span>
      </div>
      <p className="mt-1 text-[10px] text-nx-ink">
        <span className="font-display font-bold">Good morning, {DUMMY_ADVOCATE}.</span> 3 cases
        have no hearing date recorded.
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[8.5px] font-semibold text-nx-teal-deep">
          Review all in Needs attention →
        </span>
        <span className="text-[8px] text-nx-faint">Sources: 3 cases · 3 drafts</span>
      </div>
      <Icon name="X" className="absolute right-2.5 top-2 h-2.5 w-2.5 text-nx-faint" />
    </div>

    {/* Quick actions */}
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {ACTION_CARDS.map((card, i) => (
        <div
          key={card.title}
          className={`rounded-lg border border-nx-line/70 bg-white p-2 ${i > 2 ? "hidden sm:block" : ""}`}
        >
          <span className={`grid h-5 w-5 place-items-center rounded-md ${card.tint}`}>
            <Icon name={card.icon} className="h-2.5 w-2.5" />
          </span>
          <p className="mt-1 text-[9px] font-semibold text-nx-ink">{card.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[7.5px] leading-snug text-nx-faint">{card.sub}</p>
        </div>
      ))}
    </div>

    {/* Body: week + needs attention | drafts + cases */}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1.45fr_1fr]">
      <Panel className="flex flex-col">
        <div className="flex items-center justify-between">
          <CardTitle icon="CalendarDays">
            This week
            <span className="font-normal text-nx-faint">4 – 10 Sep 2026 · 0 hearings</span>
          </CardTitle>
          <span className="flex gap-1">
            <Icon name="ChevronLeft" className="h-3 w-3 rounded border border-nx-line p-0.5 text-nx-faint" />
            <Icon name="ChevronRight" className="h-3 w-3 rounded border border-nx-line p-0.5 text-nx-faint" />
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1">
          {WEEK_DAYS.map((day) => (
            <div
              key={day.d}
              className={`rounded-md border px-1 py-1 text-center ${
                day.active ? "border-teal-300 bg-teal-50" : "border-nx-line bg-white"
              }`}
            >
              <p className="text-[7px] text-nx-faint">{day.d}</p>
              <p className="text-[8.5px] font-semibold text-nx-ink">{day.n}</p>
              <p className="text-[7px] text-nx-faint/60">—</p>
            </div>
          ))}
        </div>
        <div className="mt-1.5 rounded-md border border-dashed border-nx-line bg-[#fafbfa] px-2 py-1 text-[8px] text-nx-faint">
          No hearings on Fri 4
        </div>
        <div className="my-1 text-center">
          <p className="text-[9px] font-semibold text-nx-ink">No hearings this week</p>
          <p className="text-[7.5px] text-nx-faint">Hearing dates from your cases appear here automatically.</p>
        </div>
        <div className="mt-auto border-t border-nx-line pt-1.5">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-nx-ink">
            <Icon name="TriangleAlert" className="h-2.5 w-2.5 text-nx-ink" />
            Needs attention
            <span className="font-normal text-nx-faint">1 item</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-nx-faint" />
              <div>
                <p className="text-[8.5px] font-medium text-nx-ink">
                  3 cases with no hearing date recorded
                </p>
                <p className="text-[7.5px] text-nx-faint">
                  Neither a hearing date nor a next hearing date is recorded
                </p>
              </div>
            </div>
            <span className="flex-none rounded-md bg-slate-100 px-2 py-0.5 text-[7.5px] font-medium text-nx-muted">
              Edit
            </span>
          </div>
        </div>
      </Panel>

      <div className="flex min-h-0 flex-col gap-2">
        <Panel>
          <div className="flex items-center justify-between">
            <CardTitle icon="FileText">Recent drafts</CardTitle>
            <span className="text-[8px] text-nx-faint">All drafts →</span>
          </div>
          <div className="mt-1.5 divide-y divide-nx-line/70">
            {RECENT_DRAFTS.map((draft) => (
              <div key={draft.title} className="flex items-center justify-between gap-2 py-[3px]">
                <div className="min-w-0">
                  <p className="truncate text-[8.5px] font-medium text-nx-ink">{draft.title}</p>
                  <p className="truncate text-[7px] text-nx-faint">{draft.meta}</p>
                </div>
                <StatusPill status={draft.status} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="flex-1">
          <div className="flex items-center justify-between">
            <CardTitle icon="History">Recent cases</CardTitle>
            <span className="text-[8px] text-nx-faint">View all cases (3) →</span>
          </div>
          <div className="mt-1.5 divide-y divide-nx-line/70">
            {RECENT_CASES.map((name) => (
              <div key={name} className="flex items-center justify-between gap-2 py-[3px]">
                <div className="min-w-0">
                  <p className="truncate text-[8.5px] font-medium text-nx-ink">{name}</p>
                  <p className="text-[7px] text-nx-faint">High Court of Bombay — Aurangabad</p>
                </div>
                <StatusPill status="Ongoing" />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>

    {/* Bottom: stage chart | week ahead */}
    <div className="hidden min-h-0 grid-cols-[1fr_1.2fr] gap-2 sm:grid">
      <Panel className="flex flex-col">
        <CardTitle icon="BarChart3">
          My cases by stage
          <span className="font-normal text-nx-faint">3 cases</span>
        </CardTitle>
        <div className="mt-1.5 grid flex-1 grid-cols-4 items-end gap-3 border-b border-nx-line px-2 pb-0.5">
          {CASE_STAGES.map((stage) => (
            <div key={stage.label} className="flex h-full flex-col items-center justify-end">
              {stage.value > 0 && (
                <>
                  <span className="text-[7px] text-nx-faint">{stage.value}</span>
                  <span className="mt-0.5 w-8 rounded-t-sm bg-[#1a7a3c]" style={{ height: "80%" }} />
                </>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-4 gap-3 px-2 text-center text-[7px] text-nx-faint">
          {CASE_STAGES.map((stage) => (
            <span key={stage.label}>{stage.label}</span>
          ))}
        </div>
      </Panel>

      <Panel>
        <CardTitle icon="CalendarDays">
          Week ahead
          <span className="font-normal text-nx-faint">4 – 10 Sep 2026</span>
        </CardTitle>
        <div className="mt-1 divide-y divide-nx-line/70">
          {WEEK_AHEAD.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 py-[3px]">
              <div>
                <p className="text-[8.5px] text-nx-ink">{row.label}</p>
                {row.sub && <p className="text-[7px] text-nx-faint">{row.sub}</p>}
              </div>
              <span className="text-[10px] font-bold text-nx-ink">{row.value}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  </div>
)

/* ----------------------------- Slide 2: Case Briefs --------------- */

const CASE_STATS = [
  { label: "Total Active Cases", value: 3 },
  { label: "Cases Pending Review", value: 0 },
  { label: "Upcoming Hearings (7 Days)", value: 0 },
  { label: "Documents This Month", value: 1 },
  { label: "Today's Hearings", value: 0 },
]

const CASE_ROWS = [
  { title: "Sharma Traders Vs Patil Industries", no: "—", type: "Writ Petition (Civil)", adv: "Unassigned", docs: 1, updated: "03-09-2026" },
  { title: DUMMY_CASE_2, no: "2103 OF 2024", type: "Writ Petition (Civil)", adv: "Adv. Neha Kulkarni", docs: 1, updated: "26-08-2026" },
  { title: "Sharma Traders Vs Patil Industries", no: "2323", type: "Writ Petition (Criminal)", adv: "Unassigned", docs: 3, updated: "25-08-2026" },
]

const CasesScreen = () => (
  <div className="flex h-full min-w-0 flex-col bg-white px-4 py-4 sm:px-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-bold text-nx-ink sm:text-sm">Case Briefs</p>
        <p className="mt-0.5 text-[9px] text-nx-faint">
          Manage, track, and analyze all your cases in one place.
        </p>
      </div>
      <span className="flex-none rounded-lg bg-nx-teal px-3 py-1.5 text-[9.5px] font-semibold text-white">
        Create New Case
      </span>
    </div>

    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
      {CASE_STATS.map((stat, i) => (
        <div
          key={stat.label}
          className={`rounded-lg border border-nx-line p-2.5 ${i > 2 ? "hidden sm:block" : ""}`}
        >
          <p className="line-clamp-1 text-[8px] text-nx-faint">{stat.label}</p>
          <p className="mt-1 text-sm font-bold text-nx-ink">{stat.value}</p>
        </div>
      ))}
    </div>

    <div className="mt-3 flex flex-1 flex-col rounded-lg border border-nx-line">
      <div className="flex items-center justify-between border-b border-nx-line px-3 pt-2">
        <div className="flex gap-4">
          {["Ongoing (3)", "Pending (0)", "Disposed (0)", "Draft (0)"].map((tab, i) => (
            <span
              key={tab}
              className={`pb-1.5 text-[9px] font-medium ${
                i === 0 ? "border-b-2 border-nx-teal text-nx-ink" : "text-nx-faint"
              }`}
            >
              {tab}
            </span>
          ))}
        </div>
        <span className="hidden items-center gap-1 rounded-md border border-nx-line px-2 py-0.5 text-[8px] text-nx-faint sm:flex">
          <Icon name="Search" className="h-2.5 w-2.5" />
          Search by title, case number, court…
        </span>
      </div>

      <div className="grid grid-cols-[2fr_1fr_1.4fr_1fr_0.6fr_0.8fr] gap-2 bg-nx-pale px-3 py-1.5 text-[7.5px] font-semibold uppercase tracking-wide text-nx-faint">
        <span>Title</span>
        <span>Case No.</span>
        <span>Type / Stage</span>
        <span>Advocate</span>
        <span>Status</span>
        <span>Updated</span>
      </div>
      {CASE_ROWS.map((row) => (
        <div
          key={`${row.title}-${row.no}`}
          className="grid grid-cols-[2fr_1fr_1.4fr_1fr_0.6fr_0.8fr] items-center gap-2 border-t border-nx-line px-3 py-2 text-[8.5px] text-nx-muted"
        >
          <span className="truncate font-medium text-nx-ink">{row.title}</span>
          <span>{row.no}</span>
          <span className="truncate">{row.type}</span>
          <span className="truncate">{row.adv}</span>
          <span>
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7.5px] font-semibold text-emerald-700">
              Active
            </span>
          </span>
          <span>{row.updated}</span>
        </div>
      ))}
      <div className="mt-auto flex items-center justify-between border-t border-nx-line px-3 py-1.5 text-[8px] text-nx-faint">
        <span>Showing 1 to 3 of 3 results</span>
        <span>Previous · 1 · Next</span>
      </div>
    </div>
  </div>
)

/* ----------------------------- Slide 3: Case Storage -------------- */

const STORAGE_FILES = [
  { icon: "Folder", name: "Arguments", meta: "08/26/2026" },
  { icon: "Folder", name: "Hearing Bundle", meta: "08/18/2026" },
  { icon: "FileText", name: "Verma Textiles Vs The State & o…", meta: "16.8 MB · 03/12/2026" },
  { icon: "FileText", name: "Verma Textiles Vs The State & o…", meta: "20.7 MB · 03/12/2026" },
  { icon: "FileText", name: "CASE 17 WP-10616-2010", meta: "15.7 MB · 03/10/2026" },
  { icon: "FileText", name: "Banyan Mutual NDA & Annexures", meta: "127.2 KB · 03/22/2026" },
  { icon: "FileText", name: "Final Vol-2 (1)_ocred", meta: "28.2 MB · 03/11/2026" },
  { icon: "FileType", name: "Draft Test document", meta: "6.4 KB · 08/11/2026" },
]

const StorageScreen = () => (
  <div className="flex h-full min-w-0 flex-col bg-white px-4 py-4 sm:px-5">
    <p className="text-[13px] font-bold text-nx-ink sm:text-sm">Case Storage</p>

    <div className="mt-2.5 flex items-center gap-2">
      <span className="flex flex-1 items-center gap-1.5 rounded-lg border border-nx-line px-2.5 py-1.5 text-[8.5px] text-nx-faint">
        <Icon name="Search" className="h-2.5 w-2.5" />
        Search files, folders, documents…
      </span>
      {[
        { icon: "SlidersHorizontal", label: "Filters" },
        { icon: "Upload", label: "Upload" },
        { icon: "FolderPlus", label: "New Folder" },
        { icon: "Plus", label: "Create Document" },
      ].map((btn) => (
        <span
          key={btn.label}
          className="hidden items-center gap-1 rounded-lg border border-nx-line px-2 py-1.5 text-[8.5px] font-medium text-nx-muted sm:flex"
        >
          <Icon name={btn.icon} className="h-2.5 w-2.5" />
          {btn.label}
        </span>
      ))}
    </div>

    <div className="mt-2.5 flex items-center justify-between">
      <div className="flex gap-1.5">
        <span className="rounded-full bg-white px-2.5 py-1 text-[8.5px] font-semibold text-nx-ink shadow-sm ring-1 ring-nx-line">
          ● My Documents
        </span>
        <span className="rounded-full px-2.5 py-1 text-[8.5px] font-medium text-nx-faint">
          ● My Cases
        </span>
      </div>
      <span className="text-[8.5px] text-nx-faint">112.8 MB · Sort by: Name</span>
    </div>

    <div className="mt-2.5 grid flex-1 auto-rows-min grid-cols-2 gap-2 sm:grid-cols-4">
      {STORAGE_FILES.map((file, i) => (
        <div
          key={`${file.name}-${i}`}
          className="rounded-lg border border-nx-line p-2.5"
        >
          <div className="flex items-start justify-between">
            <Icon
              name={file.icon}
              className={`h-4 w-4 ${file.icon === "Folder" ? "text-amber-400" : "text-rose-400"}`}
            />
            <Icon name="EllipsisVertical" className="h-3 w-3 text-nx-faint" />
          </div>
          <p className="mt-1.5 truncate text-[9px] font-medium text-nx-ink">{file.name}</p>
          <p className="mt-0.5 text-[7.5px] text-nx-faint">{file.meta}</p>
        </div>
      ))}
    </div>
  </div>
)

/* ----------------------------- Slide 4: Quick Chat ---------------- */

const CHAT_CHIPS = ["Summarisation", "Drafting", "Citation", "Prelitigation", "Court Ready Documents"]

const ChatScreen = () => (
  <div className="flex h-full min-w-0 flex-col bg-[#f6f7f6] px-4 py-4 sm:px-5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[13px] font-bold text-nx-ink sm:text-sm">Chat with Me</p>
      <div className="flex items-center gap-2">
        <span className="hidden rounded-lg border border-nx-line bg-white px-2.5 py-1.5 text-[8.5px] font-medium text-nx-muted sm:block">
          Client Brief ▾
        </span>
        <span className="rounded-lg bg-nx-teal px-3 py-1.5 text-[9.5px] font-semibold text-white">
          + New Conversation
        </span>
      </div>
    </div>

    <div className="mt-3 flex justify-end">
      <span className="flex items-center gap-1.5 rounded-lg bg-nx-ink px-2.5 py-1.5 text-[8.5px] font-medium text-white">
        <Icon name="FileText" className="h-2.5 w-2.5 text-rose-300" />
        Final Sharma Traders vs Patil Ind.pdf
      </span>
    </div>

    <div className="mt-2 flex-1 overflow-hidden rounded-lg bg-white p-3.5 shadow-sm">
      <p className="text-[9px] leading-relaxed text-nx-muted">
        Of course. Based on the writ petition you've provided, here is a client-friendly
        explanation of the case, prepared in both English and Marathi as requested.
      </p>
      <p className="mt-2.5 border-t border-nx-line pt-2 text-[10px] font-bold text-nx-ink">
        English Version — Case Briefing
      </p>
      <div className="mt-1.5 space-y-0.5 text-[8.5px] leading-relaxed text-nx-muted">
        <p>
          <span className="font-semibold text-nx-ink">For:</span> Sharma Traders Limited (the
          "Company")
        </p>
        <p>
          <span className="font-semibold text-nx-ink">Date:</span> August 25, 2026
        </p>
        <p>
          <span className="font-semibold text-nx-ink">Case:</span> Writ Petition challenging the
          Industrial Tribunal's Order dated 21.01.2025 in Complaint (IT) No. 3 of 2019.
        </p>
      </div>
      <p className="mt-2 text-[9px] font-bold text-nx-ink">
        🎯 The Bottom Line (The 30-Second Summary)
      </p>
      <p className="mt-1 text-[8.5px] leading-relaxed text-nx-muted">
        You dismissed an employee, Mr. Anil Jadhav, for misconduct. The Industrial Tribunal has
        overturned this dismissal, ordering you to re-hire him and pay back wages. We have
        challenged this order in the High Court. Our case is very strong — the Tribunal's order
        ignores the effects of the Company's recently concluded insolvency proceedings…
      </p>
    </div>

    <div className="mt-2 flex flex-wrap gap-1.5">
      {CHAT_CHIPS.map((chip, i) => (
        <span
          key={chip}
          className={`rounded-full border px-2 py-0.5 text-[8px] font-medium ${
            i === 0
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-nx-line bg-white text-nx-muted"
          }`}
        >
          {chip}
        </span>
      ))}
    </div>
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-nx-line bg-white px-3 py-2">
      <span className="flex-1 truncate text-[9px] text-nx-faint">
        Ask a follow-up or start a new query…
      </span>
      <span className="grid h-5.5 w-5.5 flex-none place-items-center rounded-md bg-nx-teal p-1 text-white">
        <Icon name="Send" className="h-2.5 w-2.5" />
      </span>
    </div>
  </div>
)

/* ----------------------------- Slide 5: AI Drafting --------------- */

const DRAFT_CARDS = [
  {
    icon: "Gavel",
    tint: "bg-rose-50 text-rose-600",
    tag: "Drafts in case chat",
    title: "Litigation drafting",
    text: "Writs, plaints, bail and quashing applications, written statements, appeals — argued step by step in chat.",
  },
  {
    icon: "Home",
    tint: "bg-emerald-50 text-emerald-600",
    tag: "Guided picker",
    title: "Conveyancing",
    text: "Deeds and property agreements — leave and licence, rent and lease, sale and gift documents.",
  },
  {
    icon: "Briefcase",
    tint: "bg-slate-100 text-slate-600",
    tag: "Guided picker",
    title: "Corporate & contracts",
    text: "Commercial and corporate agreements, plus corporate deeds — drafted from a template you pick.",
  },
  {
    icon: "FileText",
    tint: "bg-amber-50 text-amber-600",
    tag: "Guided picker",
    title: "General drafting",
    text: "Appeals, applications, arbitration, bail, civil and other matters — the full template library.",
  },
]

const DraftingScreen = () => (
  <div className="flex h-full min-w-0 flex-col bg-white px-4 py-4 sm:px-6">
    <p className="text-[13px] font-bold text-nx-ink sm:text-sm">
      Start a draft — what kind of work is this?
    </p>
    <p className="mt-0.5 text-[9px] text-nx-faint">
      Litigation drafts in your case chat. Everything else drafts here, in the guided picker.
    </p>

    <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
      {DRAFT_CARDS.map((card) => (
        <div key={card.title} className="rounded-lg border border-nx-line p-3">
          <span className={`grid h-7 w-7 place-items-center rounded-md ${card.tint}`}>
            <Icon name={card.icon} className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-[7.5px] font-bold uppercase tracking-[0.08em] text-nx-faint">
            {card.tag}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold text-nx-ink">{card.title}</p>
          <p className="mt-1 line-clamp-2 text-[8.5px] leading-snug text-nx-muted">{card.text}</p>
        </div>
      ))}
    </div>

    <div className="mt-2.5 flex items-center justify-between rounded-lg border border-nx-line px-3 py-2.5">
      <div>
        <p className="text-[9.5px] font-semibold text-nx-ink">Recent drafts & my templates</p>
        <p className="text-[8px] text-nx-faint">
          Pick up an existing draft, or create and manage your templates.
        </p>
      </div>
      <Icon name="ArrowRight" className="h-3 w-3 text-nx-teal" />
    </div>
  </div>
)

/* ----------------------------- Slide 6: Citation Research --------- */

const RECENT_RESEARCH = [
  { name: "Sharma Traders Vs Patil Ind…", meta: "14 issues · Case-linked · 1 hour ago" },
  { name: "Verma Textiles Vs The State…", meta: "9 issues · Case-linked · 1 hour ago" },
  { name: "Verma Textiles Vs The State…", meta: "4 issues · Case-linked · 8 days ago" },
]

const CitationScreen = () => (
  <div className="flex h-full min-w-0 flex-col bg-white px-4 py-4 sm:px-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-bold text-nx-ink sm:text-sm">Citation Research</p>
        <p className="mt-0.5 text-[9px] text-nx-faint">
          Analyze matter documents and pleaded grounds, then retrieve relevant Indian Kanoon
          authorities.
        </p>
      </div>
      <span className="hidden flex-none items-center gap-1 rounded-lg border border-nx-line px-2.5 py-1.5 text-[8.5px] font-medium text-nx-muted sm:flex">
        <Icon name="Search" className="h-2.5 w-2.5" />
        Advanced Search
      </span>
    </div>

    <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-[1.6fr_1fr]">
      <div className="flex flex-col gap-2.5">
        <div className="rounded-lg border border-nx-line p-3">
          <p className="text-[9.5px] font-semibold text-nx-ink">
            <span className="mr-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-teal-50 text-[8px] font-bold text-teal-700">
              1
            </span>
            Choose the research material
          </p>
          <div className="mt-2 flex gap-3 border-b border-nx-line text-[8.5px]">
            {["My cases", "Upload document", "Paste text"].map((tab, i) => (
              <span
                key={tab}
                className={`pb-1 font-medium ${
                  i === 0 ? "border-b-2 border-nx-teal text-nx-ink" : "text-nx-faint"
                }`}
              >
                {tab}
              </span>
            ))}
          </div>
          <div className="mt-2 rounded-md border border-nx-line px-2.5 py-1.5 text-[8.5px] text-nx-faint">
            Select a case…
          </div>
        </div>

        <div className="flex-1 rounded-lg border border-nx-line p-3">
          <p className="text-[9.5px] font-semibold text-nx-ink">
            <span className="mr-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-teal-50 text-[8px] font-bold text-teal-700">
              2
            </span>
            Set the research approach
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[8.5px] font-medium text-nx-ink">Acting for</span>
            <span className="flex overflow-hidden rounded-md border border-nx-line text-[8px]">
              <span className="bg-nx-teal px-2 py-0.5 font-semibold text-white">Auto</span>
              <span className="px-2 py-0.5 text-nx-muted">Petitioner</span>
              <span className="px-2 py-0.5 text-nx-muted">Respondent</span>
            </span>
          </div>
          <p className="mt-2 text-[8.5px] font-medium text-nx-ink">Legal focus</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[
              { t: "Issues and grounds", sel: true },
              { t: "Issue spotting", sel: false },
              { t: "Pleaded grounds", sel: false },
            ].map((opt) => (
              <div
                key={opt.t}
                className={`rounded-md border p-1.5 text-[8px] font-medium ${
                  opt.sel
                    ? "border-teal-300 bg-teal-50 text-teal-800"
                    : "border-nx-line text-nx-muted"
                }`}
              >
                {opt.sel ? "● " : "○ "}
                {opt.t}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-nx-line pt-2">
            <span className="text-[8px] text-nx-faint">
              Issues and pleaded grounds · Standard keyword search
            </span>
            <span className="rounded-lg bg-nx-teal px-2.5 py-1 text-[8.5px] font-semibold text-white">
              ✦ Analyse matter
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-nx-line p-3">
        <CardTitle icon="History">
          Recent research
          <span className="font-normal text-nx-faint">3 saved analyses</span>
        </CardTitle>
        <div className="mt-2 space-y-2">
          {RECENT_RESEARCH.map((row, i) => (
            <div key={`${row.name}-${i}`} className="border-b border-nx-line/70 pb-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[9px] font-medium text-nx-ink">{row.name}</p>
                <span className="flex-none rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-semibold text-emerald-700">
                  Analysed
                </span>
              </div>
              <p className="mt-0.5 text-[7.5px] text-nx-faint">{row.meta}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)

/* ----------------------------- Showcase carousel ------------------ */

const SLIDES = [
  { key: "dashboard", active: "Dashboard", Screen: DashboardScreen },
  { key: "cases", active: "Ongoing Cases", Screen: CasesScreen },
  { key: "storage", active: "Case Storage", Screen: StorageScreen },
  { key: "chat", active: "Quick Chat", Screen: ChatScreen },
  { key: "drafting", active: "AI Drafting", Screen: DraftingScreen },
  { key: "citation", active: "Citation Research", Screen: CitationScreen },
]

const SLIDE_MS = 5000

const AppShowcase = () => {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]

  useEffect(() => {
    if (reduce) return undefined
    const timer = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS)
    return () => clearInterval(timer)
  }, [reduce])

  return (
    <div className="w-full">
      <Motion.div
        initial={reduce ? false : { opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className="relative w-full overflow-hidden rounded-xl bg-white shadow-[0_36px_80px_-32px_rgba(6,52,44,0.4)] sm:aspect-[1.78/1] sm:rounded-2xl"
        aria-hidden="true"
      >
        <div className="grid h-full grid-cols-1 sm:grid-cols-[10.5rem_1fr]">
          <Sidebar active={slide.active} />
          <div className="relative min-w-0 overflow-hidden">
            <AnimatePresence mode="wait">
              <Motion.div
                key={slide.key}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="h-full"
              >
                <slide.Screen />
              </Motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Motion.div>

      {/* Slide dots */}
      <div className="mt-5 flex justify-center gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show the ${s.active} screen`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "w-6 bg-nx-teal-deep" : "w-1.5 bg-nx-forest/25 hover:bg-nx-forest/40"
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const HEADLINE_MAIN_WORDS = HERO_COPY.titleMain.split(" ")
const HEADLINE_ACCENT_WORDS = HERO_COPY.titleAccent.split(" ")
const HEADLINE_WORDS = [
  ...HEADLINE_MAIN_WORDS.map((w) => ({ w, accent: false })),
  ...HEADLINE_ACCENT_WORDS.map((w) => ({ w, accent: true })),
]
const WORD_MS = 170
const TYPE_START_MS = 350
const HOLD_MS = 2600
const RESTART_MS = 450

const HERO_STAGES = ["01 Analyze", "02 Research", "03 Draft", "+ Indian courts"]

/**
 * Headline that types itself in one word at a time with a blinking
 * caret. Reduced-motion users get the full headline immediately.
 */
const TypedHeadline = () => {
  const reduce = useReducedMotion()
  const [count, setCount] = useState(reduce ? HEADLINE_WORDS.length : 0)
  const done = count >= HEADLINE_WORDS.length

  // Type in word by word, hold on the full headline, clear, and repeat.
  useEffect(() => {
    if (reduce) return undefined
    let timer
    const tick = (n) => {
      setCount(n)
      if (n < HEADLINE_WORDS.length) {
        timer = setTimeout(() => tick(n + 1), WORD_MS)
      } else {
        timer = setTimeout(() => {
          setCount(0)
          timer = setTimeout(() => tick(1), RESTART_MS)
        }, HOLD_MS)
      }
    }
    timer = setTimeout(() => tick(1), TYPE_START_MS)
    return () => clearTimeout(timer)
  }, [reduce])

  return (
    <h1
      id="hero-heading"
      aria-label={`${HERO_COPY.titleMain} ${HERO_COPY.titleAccent}`}
      className="relative max-w-[30ch] font-hero text-[clamp(2.6rem,6vw,5.25rem)] font-light leading-[1.1] tracking-[-0.04em] text-[#fafaf7]"
    >
      {/* Invisible full headline reserves the height so the layout never jumps */}
      <span aria-hidden="true" className="invisible block">
        {HERO_COPY.titleMain}
        <br />
        <em className="font-normal">{HERO_COPY.titleAccent}</em>
      </span>
      <span aria-hidden="true" className="absolute inset-0 block">
        {HEADLINE_WORDS.slice(0, count).map(({ w, accent }, i) => (
          <span key={`${w}-${i}`}>
            {accent && !HEADLINE_WORDS[i - 1]?.accent && <br />}
            <span className={`hero-word inline-block ${accent ? "font-normal italic text-nx-mint" : ""}`}>
              {w}
              {i < HEADLINE_WORDS.length - 1 ? "\u00A0" : ""}
            </span>
          </span>
        ))}
        <span
          className={`hero-caret ml-1 inline-block h-[0.85em] w-[3px] translate-y-[0.1em] bg-[#fafaf7] align-baseline ${
            done ? "" : "hero-caret-typing"
          }`}
        />
      </span>
    </h1>
  )
}

/**
 * Editorial full-bleed hero: dark office photograph under a deep-teal
 * wash, eyebrow, headline typed in word by word, italic tagline, a
 * dotted rule with the product stages, then the intro copy on the left
 * with the two CTAs beside it. The rotating product showcase follows
 * on the light ground below.
 */
const HeroSection = ({ onLogin } = {}) => {
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  return (
    <section id="platform" className="relative bg-[#f7fcfa]" aria-labelledby="hero-heading">
      {/* Full-bleed photographic hero */}
      <div className="relative overflow-hidden bg-[#1a1410]">
        <img
          src={heroOffice}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
          style={{ filter: "sepia(0.45) saturate(1.05) brightness(0.9) contrast(1.05)" }}
        />
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(90deg, rgba(38,26,16,0.62) 0%, rgba(38,26,16,0.4) 50%, rgba(38,26,16,0.22) 100%), linear-gradient(180deg, rgba(38,26,16,0.15) 0%, rgba(30,20,12,0.5) 100%)",
          }}
        />

        <Motion.div
          variants={reduce ? undefined : stagger}
          initial={reduce ? false : "hidden"}
          animate="show"
          className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col px-5 pb-14 pt-[calc(4rem+clamp(80px,12vh,140px))] sm:px-8 lg:pb-20"
        >
          {/* Eyebrow */}
          <Motion.p
            variants={fadeUp}
            className="flex items-center gap-3 font-mono text-[0.74rem] font-medium uppercase tracking-[0.18em] text-nx-mint"
          >
            <span className="h-px w-8 bg-nx-mint" aria-hidden="true" />
            {HERO_COPY.eyebrow}
          </Motion.p>

          {/* Typed headline */}
          <div className="mt-10">
            <TypedHeadline />
          </div>

          {/* Tagline */}
          <Motion.p
            variants={fadeUp}
            className="mt-[22px] max-w-[60ch] font-hero text-[1.15rem] font-light italic text-teal-50/85"
          >
            {HERO_COPY.trustLine}
          </Motion.p>

          {/* Dotted rule + stage strip */}
          <Motion.div variants={fadeUp} className="mt-10 border-t border-dotted border-white/40 pt-4">
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-teal-100/65">
              <li className="flex items-center gap-2 text-white">
                <span className="text-[8px] text-nx-mint" aria-hidden="true">◆</span>
                Jurinex
              </li>
              {HERO_STAGES.map((stage) => (
                <li key={stage} className="flex items-center gap-3">
                  <span className="text-white/30" aria-hidden="true">/</span>
                  {stage}
                </li>
              ))}
            </ul>
          </Motion.div>

          {/* Intro copy + CTAs */}
          <Motion.div
            variants={fadeUp}
            className="mt-auto grid grid-cols-1 items-end gap-10 pt-16 lg:grid-cols-[1.3fr_0.7fr] lg:gap-20"
          >
            <p className="max-w-2xl text-[17px] leading-relaxed text-white/90 sm:text-lg">
              <span className="font-bold text-white">Work faster, practice smarter</span> with the
              power of AI. <span className="font-bold text-white">Jurinex</span> handles your
              research, drafting, citations and case files — purpose-built for{" "}
              <span className="font-bold text-white">Indian courts</span>, supports Indian
              languages.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
              <button
                type="button"
                onClick={() => navigate("/register")}
                aria-label="Create a free Jurinex account"
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-md bg-nx-teal px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-teal-900/30 transition-colors hover:bg-nx-teal-deep sm:w-auto lg:w-60"
              >
                {HERO_COPY.primaryCta}
                <Icon name="ArrowRight" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onLogin?.()}
                aria-label="Log in to your account"
                className="inline-flex w-full items-center justify-center rounded-md border border-white/40 px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:border-white hover:bg-white/10 sm:w-auto lg:w-60"
              >
                Login
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      </div>

      {/* Product band — inset from the page edges like Harvey's, light
          painterly mint with deep-teal brushed edges */}
      <div className="mx-auto max-w-[102rem] px-5 py-16 sm:px-12 lg:px-16 lg:py-20">
        <div className="relative overflow-hidden rounded-md">
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(50% 75% at 2% 100%, rgba(6,52,44,0.26) 0%, rgba(6,52,44,0) 58%), radial-gradient(45% 65% at 100% 0%, rgba(6,52,44,0.18) 0%, rgba(6,52,44,0) 58%), linear-gradient(118deg, #93c3b4 0%, #e7f4ef 36%, #f3fbf7 55%, #c2e0d6 100%)",
            }}
          />
          <div className="relative px-5 py-10 sm:px-14 sm:py-16 lg:px-20 lg:py-20">
            <AppShowcase />
          </div>
        </div>
      </div>
    </section>
  )
}

HeroSection.propTypes = {
  onLogin: PropTypes.func,
}

export default HeroSection