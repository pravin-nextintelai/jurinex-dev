import { useState, useRef, useEffect, useCallback } from "react"
import { motion as Motion, AnimatePresence } from "framer-motion"
import { useLocation } from "react-router-dom"
import FormattedAssistantContent from "./ChatInterface/FormattedAssistantContent"
import { AI_CHATBOT_URL } from "@/config/apiConfig"

// ── constants ─────────────────────────────────────────────────────────────────

const WS_URL = AI_CHATBOT_URL.replace(/^http/, "ws")
const INITIAL_PLAYBACK_LEAD = 0.30   // 300 ms initial buffer — absorbs first burst jitter
const RECOVERY_PLAYBACK_LEAD = 0.18  // 180 ms recovery — bridges tool-call pauses
const VOICE_PLACEHOLDER = "Voice question..."

function isRealSpeech(text) {
  const t = String(text || "").trim()
  return t.length > 0 && t !== VOICE_PLACEHOLDER
}

function mergeTranscriptChunk(current, chunk) {
  const c = String(chunk || "").trim()
  if (!c) return String(current || "").trim()
  const cur = String(current || "").trim()
  if (!cur || cur === VOICE_PLACEHOLDER) return c
  if (c.startsWith(cur)) return c
  if (cur.endsWith(c)) return cur
  return `${cur} ${c}`.trim().replace(/\s+/g, " ")
}

// Brand palette — matches #21C1B6 teal used across the app
const T = {
  primary:    "#21C1B6",
  dark:       "#0d9488",
  darker:     "#0f766e",
  900:        "#134e4a",
  soft:       "rgba(33,193,182,0.10)",
  softBorder: "rgba(33,193,182,0.22)",
  userGrad:   "linear-gradient(135deg,#21C1B6,#0d9488)",
  btnGrad:    "linear-gradient(135deg,#21C1B6,#0d9488)",
  headerGrad: "linear-gradient(135deg,#0f172a 0%,#042f2e 55%,#0d4240 100%)",
}

// ── page-aware config ─────────────────────────────────────────────────────────

const PAGE_MAP = [
  {
    match: /^\/dashboard/,
    name: "Dashboard",
    badge: "Overview",
    context: `user is on the JuriNex Dashboard — the main home screen after login. It shows:
- Overview widgets: total cases, documents, recent activity feed
- Quick Tools section with shortcut buttons
- Case Summarizer widget for pasting or selecting a case to summarise
Available actions and buttons:
- "Upload Document" button (top-right or Quick Tools) → opens file picker to upload PDF/Word
- "New Case" button → opens a form to create a new legal case
- "View Analysis" button → navigates to the Case Analysis page
- "Open Drafting Editor" button → navigates to the Legal Drafting page
- Sidebar navigation: Documents, Cases, Drafting, Analysis, Evidence, Timeline, Billing, Settings
- Recent activity feed shows last 10 actions (clickable to open the item)
- Case Summarizer: paste case text or select an uploaded document, then click "Summarise"`,
    tips: [
      "How do I upload a document from here?",
      "How do I create a new case?",
      "What does the Case Summarizer do and how do I use it?",
      "Where do I find my recent documents?",
      "How do I navigate to the Document Analysis page?",
    ],
  },
  {
    match: /^\/documents\/.+/,
    name: "Document Folder",
    badge: "Folder View",
    context: `user is inside a specific document folder. They can see all files in this folder and manage them.
Available actions and buttons:
- "Chat with Documents" button → opens an AI chat sidebar where you can ask questions about all documents in this folder
- "Run Analysis" button → runs AI analysis on all documents in the folder
- "Upload More" button → opens file picker to add more files to this folder
- "Share" button → opens a dialog to share this folder with team members by email
- "Download" icon next to each file → downloads that individual file
- File list: click any filename to preview or open the document
- Three-dot menu (⋯) next to each file: options include Rename, Move, Delete`,
    tips: [
      "How do I start a chat with the documents in this folder?",
      "How do I run AI analysis on a file here?",
      "How do I upload more files to this folder?",
      "How do I share this folder with a colleague?",
      "How do I download a specific file?",
    ],
  },
  {
    match: /^\/documents/,
    name: "Documents",
    badge: "File Manager",
    context: `user is on the Documents page — the main file manager for all uploaded legal documents.
Available actions and buttons:
- "Create Folder" button (top-right) → opens a dialog to name and create a new folder
- "Upload File" button → opens file picker; supports PDF, DOC, DOCX, TXT, JPG, PNG
- "Upload Folder" button → lets you upload an entire folder of files at once
- Search bar at the top → type to filter documents and folders by name
- Click any folder to open it and see its documents
- Three-dot menu (⋯) next to each item: Rename, Move to folder, Share, Delete
- Drag and drop files onto a folder to move them
- Supported file types: PDF, Word (.doc/.docx), plain text (.txt), images (JPG, PNG)`,
    tips: [
      "How do I upload a PDF or Word file?",
      "What file types does JuriNex support?",
      "How do I create a new folder?",
      "How do I share a document with my team?",
      "How do I delete or move a file?",
    ],
  },
  {
    match: /^\/(drafting|draft-editor|draft-form)/,
    name: "Legal Drafting",
    badge: "Draft Editor",
    context: `user is in the JuriNex Legal Drafting editor — a rich-text editor for writing legal documents with AI assistance.
Available actions and buttons:
- "AI Suggest" button (toolbar) → asks the AI to suggest the next sentence or clause at the cursor position
- "Add Clause" button → opens a clause library; search and insert standard legal clauses
- "Insert Evidence" button → opens the Evidence Matrix picker to embed linked evidence
- "Export PDF" button (top-right) → exports the current draft as a formatted PDF
- "Export Word" button (top-right) → exports as a .docx Word file
- "Collaborate" button → opens a dialog to invite team members to co-edit this draft
- Auto-save: the draft saves automatically every 30 seconds
- Formatting toolbar: Bold, Italic, Underline, Heading levels, Bullet list, Numbered list
- Version history: click the clock icon to view or restore previous versions`,
    tips: [
      "How do I get an AI suggestion for the current paragraph?",
      "How do I add a specific clause to my draft?",
      "How do I export this draft as a PDF?",
      "How do I insert evidence from the Evidence Matrix?",
      "How do I invite a colleague to collaborate on this draft?",
    ],
  },
  {
    match: /^\/(draft-selection|templates|drafts)/,
    name: "Templates",
    badge: "Template Library",
    context: `user is on the Template Library page for selecting a template to start a new legal draft.
Available actions and buttons:
- Search bar → type to filter templates by name or category
- Category filters (left sidebar): Contracts, Affidavits, Petitions, Notices, Agreements, Pleadings, Letters
- Template cards: each shows template name, category, and a short description
- "Preview" button on each card → opens a read-only preview of the full template
- "Use This Template" button → creates a new draft pre-filled with the template content and opens the Drafting editor
- "Start from Scratch" button (top) → creates a blank draft without any template
- Favourites: click the star icon on a template to save it to your favourites`,
    tips: [
      "How do I find a Contract template?",
      "How do I start a draft from a template?",
      "What categories of templates are available?",
      "Can I start a draft from scratch without a template?",
      "How do I preview a template before using it?",
    ],
  },
  {
    match: /^\/analysis/,
    name: "Case Analysis",
    badge: "AI Analysis",
    context: `user is on the Case Analysis page for AI-powered analysis of legal documents.
Available actions and buttons:
- "Run Analysis" button → triggers AI analysis on selected or uploaded documents; shows results with citations
- Search bar → semantic search across all uploaded documents to find specific legal points
- "Download Report" button → exports the full analysis as a PDF report
- "View Citations" link in results → expands the source passages from the document
- Document selector (left panel) → choose which uploaded documents to include in the analysis
- Analysis results show: Summary, Key Legal Issues, Relevant Statutes, Recommendations
- Each finding is clickable → highlights the source passage in the document viewer on the right`,
    tips: [
      "How do I run an AI analysis on my documents?",
      "How do I search for a specific legal point across documents?",
      "How do I view the citations and sources in the analysis?",
      "How do I download the analysis report as PDF?",
      "What does semantic search mean in this context?",
    ],
  },
  {
    match: /^\/evidence/,
    name: "Evidence Matrix",
    badge: "Evidence",
    context: `user is on the Evidence Matrix page for organising and linking evidence to legal claims.
Available actions and buttons:
- "Add Evidence" button (top-right) → opens a form to add a new evidence item (title, description, file attachment, date)
- "Link to Claim" button on each evidence row → opens a picker to associate the evidence with a legal claim or case issue
- "Tag" button → add category tags to evidence items (e.g. Documentary, Oral, Digital, Forensic)
- "Filter" dropdown → filter evidence by tag, date range, claim, or relevance rating
- "Export Report" button → exports the full evidence matrix as a PDF or Excel file
- Relevance rating: click the stars on each evidence item to rate its strength (1–5)
- Drag rows to reorder the evidence matrix
- Click any evidence item's title to open its full details and attached files`,
    tips: [
      "How do I add a new piece of evidence?",
      "How do I link evidence to a specific legal claim?",
      "How do I tag evidence by relevance or category?",
      "How do I export the evidence report?",
      "How do I filter evidence by date or type?",
    ],
  },
  {
    match: /^\/timeline/,
    name: "Timeline",
    badge: "Case Timeline",
    context: `user is on the Timeline page for building a chronological timeline of case events.
Available actions and buttons:
- "Add Event" button (top-right) → opens a form to add a new event (title, date, description, category, attached document)
- "Filter" button → filter events by date range, category, or keyword
- "Export PDF" button → exports the timeline as a formatted PDF document
- "Colour Code" button → assign colours to event categories (e.g. red for incidents, blue for hearings, green for filings)
- Timeline view: events are displayed on a horizontal or vertical timeline; click any event to see full details
- Edit/Delete: click an event, then use the Edit or Delete button in the detail panel
- Events can be linked to uploaded documents — click "Attach Document" on any event`,
    tips: [
      "How do I add a new event to the timeline?",
      "How do I colour-code events by category?",
      "How do I filter the timeline by a date range?",
      "How do I export this timeline as a PDF?",
      "Can events be imported automatically from documents?",
    ],
  },
  {
    match: /^\/cases/,
    name: "Cases",
    badge: "Case Manager",
    context: `user is on the Cases page — the central hub for managing all legal cases.
Available actions and buttons:
- "New Case" button (top-right) → opens a form to create a case (case name, court, type, parties, description)
- "Add Documents" button on a case card → opens the document picker to attach existing or new documents to the case
- "Share" button on a case → opens a dialog to add team members to the case by email with view or edit permissions
- "Archive" button on a case → moves the case to the Archived section (reversible)
- Search bar → search cases by name, court, or party name
- Case cards show: case name, court, status (Active/Archived), last updated date, document count
- Click any case card to open the full case view with its documents, timeline, evidence, and notes
- Filter dropdown: filter by Active, Archived, or case type`,
    tips: [
      "How do I create a new case?",
      "How do I add documents to an existing case?",
      "How do I share a case with a team member?",
      "How do I archive a completed case?",
      "How do I search for a specific case?",
    ],
  },
  {
    match: /^\/billing/,
    name: "Billing & Usage",
    badge: "Subscription",
    context: `user is on the Billing & Usage page for managing their subscription and viewing usage.
Available actions and buttons:
- "Upgrade Plan" button → opens the plan comparison page to upgrade subscription
- "Manage Payment" button → opens the payment details form to update card or billing info
- "Download Invoice" link next to each billing entry → downloads the invoice as PDF
- Current Plan card: shows plan name, renewal date, features included
- Token Usage bar: shows tokens used this month vs. the monthly limit
- Billing History table: lists past invoices with date, amount, status, and download link
- Plan comparison: shows Basic, Professional, and Enterprise plans with feature differences`,
    tips: [
      "How do I upgrade my subscription plan?",
      "What features are included in each plan?",
      "How do I view my remaining token usage?",
      "How do I update my billing or payment details?",
      "How do I download an invoice?",
    ],
  },
  {
    match: /^\/settings/,
    name: "Settings",
    badge: "Account",
    context: `user is on the Settings page for managing their JuriNex account and preferences.
Available sections and actions:
- Profile tab: update display name, profile photo (click photo to upload), and job title; click "Save Changes"
- Security tab: "Change Password" button → enter current password and new password, then click "Update Password"
- Team tab: "Invite Member" button → enter email and role (Viewer/Editor/Admin), click "Send Invite"; remove members with the "Remove" button next to their name
- Integrations tab: "Connect Google Drive" button → OAuth flow to link Google Drive; "Connect OneDrive" button → links OneDrive
- Notifications tab: toggles for email notifications (case updates, document uploads, team activity); click the toggle then "Save Preferences"
- Danger Zone (bottom): "Delete Account" button — requires typing account name to confirm`,
    tips: [
      "How do I change my account password?",
      "How do I update my profile photo or name?",
      "How do I invite or remove a team member?",
      "How do I connect Google Drive to JuriNex?",
      "How do I turn off email notifications?",
    ],
  },
]

const DEFAULT_PAGE = {
  name: "JuriNex",
  badge: "Platform",
  context: `user is using the JuriNex AI legal intelligence platform. Main sections accessible from the sidebar:
- Dashboard: overview of cases, documents, recent activity, and the Case Summarizer
- Documents: file manager to upload PDF/Word files, create folders, share, and organise legal documents
- Cases: create and manage legal cases, attach documents and evidence, share with team members
- Legal Drafting: AI-assisted rich-text editor to write legal documents; export as PDF or Word
- Templates: browse and start drafts from legal document templates (contracts, affidavits, petitions, etc.)
- Case Analysis: AI-powered analysis of uploaded documents with citations and semantic search
- Evidence Matrix: organise evidence, link to legal claims, tag, filter, and export evidence reports
- Timeline: build a chronological case timeline, colour-code events, and export as PDF
- Billing & Usage: manage subscription plan, view token usage, download invoices
- Settings: update profile, password, team members, integrations (Google Drive, OneDrive), notifications`,
  tips: [
    "How do I upload my first document?",
    "How do I run an AI analysis on a document?",
    "How do I create a new case?",
    "How do I start drafting a legal document?",
    "How do I search across all my documents?",
  ],
}

function getPageConfig(pathname) {
  for (const cfg of PAGE_MAP) {
    if (cfg.match.test(pathname)) return cfg
  }
  return DEFAULT_PAGE
}

// ── sub-components ────────────────────────────────────────────────────────────

const BotAvatar = () => (
  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
    style={{ background: T.userGrad }}>
    <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
      <line x1="16" y1="2" x2="16" y2="6" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="2" r="1.5" fill="white" />
      <rect x="5" y="6" width="22" height="16" rx="4" fill="white" />
      <rect x="2" y="11" width="3" height="6" rx="1.5" fill="white" />
      <rect x="27" y="11" width="3" height="6" rx="1.5" fill="white" />
      <circle cx="11.5" cy="13" r="2.5" fill={T.primary} />
      <circle cx="11.5" cy="13" r="1" fill="white" />
      <circle cx="20.5" cy="13" r="2.5" fill={T.primary} />
      <circle cx="20.5" cy="13" r="1" fill="white" />
      <path d="M11 19.5 Q16 22.5 21 19.5" stroke={T.primary} strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  </div>
)

const TypingDots = () => (
  <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-tl-sm"
    style={{ background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
    {[0, 1, 2].map(i => (
      <Motion.span key={i} className="w-1.5 h-1.5 rounded-full"
        style={{ background: T.primary }}
        animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.14, ease: "easeInOut" }} />
    ))}
  </div>
)

const VoiceWave = () => (
  <div className="flex items-center gap-[2px] h-3.5">
    {[0.4, 0.8, 1, 0.7, 0.5].map((h, i) => (
      <Motion.span key={i} className="w-[2.5px] rounded-full"
        style={{ background: "rgba(255,255,255,0.9)" }}
        animate={{ scaleY: [h * 0.4, h, h * 0.5, h * 0.9, h * 0.4] }}
        transition={{ duration: 0.85 + i * 0.07, repeat: Infinity, ease: "easeInOut", delay: i * 0.06 }}
        initial={{ scaleY: h * 0.4, height: "14px", originY: "50%" }} />
    ))}
  </div>
)

// Renders the AI answer section inside a Q&A card
function AnswerBody({ text, error }) {
  if (error) {
    return (
      <p className="text-[12.5px] leading-relaxed" style={{ color: "#c53030" }}>{text}</p>
    )
  }
  // Single shared assistant renderer — same markdown styling as every other surface.
  return <FormattedAssistantContent raw={text} />
}

// A single Q&A turn rendered as a self-contained card
function TurnCard({ question, answer, isLoading, isVoice }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #dff0ef",
      borderLeft: `3px solid ${T.primary}`,
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(33,193,182,0.07)",
      overflow: "hidden",
    }}>
      {/* ── Question row ── */}
      {question && (
        <div style={{ background: "rgba(33,193,182,0.06)", borderBottom: "1px solid #dff0ef", padding: "10px 14px" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: T.userGrad }}>
              {isVoice ? (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.darker }}>
              {isVoice ? "Voice Question" : "Your Question"}
            </span>
          </div>
          <p className={`text-[13px] leading-relaxed pl-7 ${isVoice ? "text-gray-500 italic" : "text-gray-800 font-medium"}`}>
            {question}
          </p>
        </div>
      )}

      {/* ── Answer row ── */}
      <div style={{ padding: "12px 14px" }}>
        <div className="flex items-center gap-2 mb-2">
          <BotAvatar />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.darker }}>
            JuriNex Assistant
          </span>
        </div>
        <div className="pl-9">
          {isLoading
            ? <TypingDots />
            : answer
            ? <AnswerBody text={answer.text} error={answer.error} />
            : null}
        </div>
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function AppAssistant() {
  const location = useLocation()
  const pageCfg = getPageConfig(location.pathname)

  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState("")
  const [loading, setLoading]   = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [micStatus, setMicStatus] = useState("idle")

  const wsRef            = useRef(null)
  const audioCtxRef      = useRef(null)
  const playCtxRef       = useRef(null)
  const nextPlayRef      = useRef(0)
  const sourceRef        = useRef(null)
  const processorRef     = useRef(null)
  const streamRef        = useRef(null)
  const voiceDoneRef     = useRef(false)
  const awaitingFinalRef = useRef(false)
  const stopTimeoutRef   = useRef(null)
  const bottomRef        = useRef(null)
  const inputRef         = useRef(null)

  // Reset chat when user navigates to a different page
  useEffect(() => { setMessages([]) }, [location.pathname])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading, micStatus])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // ── audio helpers ────────────────────────────────────────────────────────────

  const getPlayCtx = useCallback(() => {
    if (!playCtxRef.current || playCtxRef.current.state === "closed") {
      playCtxRef.current = new AudioContext({ sampleRate: 24000 })
      nextPlayRef.current = 0
    }
    if (playCtxRef.current.state === "suspended") {
      playCtxRef.current.resume().catch(() => {})
    }
    return playCtxRef.current
  }, [])

  const resample = useCallback((input, from, to) => {
    if (!input?.length || from === to) return input
    const ratio = from / to
    const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)))
    for (let i = 0; i < out.length; i++) {
      const idx = Math.floor(i * ratio)
      const frac = i * ratio - idx
      out[i] = (input[idx] ?? 0) + ((input[Math.min(idx + 1, input.length - 1)] ?? input[idx] ?? 0) - (input[idx] ?? 0)) * frac
    }
    return out
  }, [])

  const pcm16ToBase64 = useCallback((samples) => {
    const bytes = new Uint8Array(samples.buffer)
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }, [])

  const scheduleAudio = useCallback((b64, mime) => {
    try {
      const sr = mime?.includes("24000") ? 24000 : 16000
      const raw = atob(b64)
      const int16 = new Int16Array(raw.length / 2)
      for (let i = 0; i < int16.length; i++)
        int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
      let f32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768
      const ctx = getPlayCtx()
      if (ctx.sampleRate !== sr) f32 = resample(f32, sr, ctx.sampleRate)
      // No per-chunk fade: sequential chunks from Gemini are continuous PCM.
      // Fading the end of one chunk and start of the next creates rapid amplitude
      // modulation (tremolo/noise) on speech. Web Audio scheduled playback
      // already provides seamless gapless stitching.
      const buf = ctx.createBuffer(1, f32.length, ctx.sampleRate)
      buf.copyToChannel(f32, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf; src.connect(ctx.destination)
      const now = ctx.currentTime
      if (!nextPlayRef.current) nextPlayRef.current = now + INITIAL_PLAYBACK_LEAD
      else if (nextPlayRef.current < now + RECOVERY_PLAYBACK_LEAD) nextPlayRef.current = now + RECOVERY_PLAYBACK_LEAD
      src.start(nextPlayRef.current)
      nextPlayRef.current += buf.duration
    } catch {}
  }, [getPlayCtx, resample])

  const cleanupAudio = useCallback(() => {
    sourceRef.current?.disconnect()
    processorRef.current?.disconnect()
    audioCtxRef.current?.close().catch(() => {})
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current = null; sourceRef.current = null
    processorRef.current = null; streamRef.current = null
    nextPlayRef.current = 0
  }, [])

  const stopAudio = useCallback(() => {
    voiceDoneRef.current = true
    awaitingFinalRef.current = true
    try { wsRef.current?.send(JSON.stringify({ type: "end" })) } catch {}
    cleanupAudio()
    setMicStatus("connecting")
    clearTimeout(stopTimeoutRef.current)
    stopTimeoutRef.current = setTimeout(() => {
      try { wsRef.current?.close() } catch {}
      wsRef.current = null
      awaitingFinalRef.current = false
      setMicStatus("idle")
    }, 45000)
  }, [cleanupAudio])

  // Hard reset for panel close / unmount — no waiting for AI response
  const forceCloseAudio = useCallback(() => {
    clearTimeout(stopTimeoutRef.current)
    voiceDoneRef.current = true
    awaitingFinalRef.current = false
    try { wsRef.current?.send(JSON.stringify({ type: "end" })) } catch {}
    try { wsRef.current?.close() } catch {}
    wsRef.current = null
    cleanupAudio()
    playCtxRef.current?.close().catch(() => {})
    playCtxRef.current = null
    nextPlayRef.current = 0
    setMicStatus("idle")
  }, [cleanupAudio])

  useEffect(() => () => { clearTimeout(stopTimeoutRef.current); forceCloseAudio(); }, []) // eslint-disable-line

  const startAudio = useCallback(async () => {
    // Kill any existing session before opening a new one
    if (wsRef.current) {
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }
    clearTimeout(stopTimeoutRef.current)
    setMicStatus("connecting")
    voiceDoneRef.current = false
    if (playCtxRef.current && playCtxRef.current.state !== "closed") {
      playCtxRef.current.close().catch(() => {})
      playCtxRef.current = null
      nextPlayRef.current = 0
    }
    getPlayCtx()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      streamRef.current = stream
      const ctx = new AudioContext()
      if (ctx.state === "suspended") await ctx.resume()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      const silent = ctx.createGain(); silent.gain.value = 0

      const ws = new WebSocket(`${WS_URL}/ws/audio?mode=app`)
      wsRef.current = ws

      ws.onopen = () => {
        setMicStatus("live")
        // Stream mic audio continuously — Gemini Live VAD handles turn detection.
        // Session stays alive until user clicks stop.
        processor.onaudioprocess = (e) => {
          if (voiceDoneRef.current || ws.readyState !== WebSocket.OPEN) return
          const raw = e.inputBuffer.getChannelData(0)
          const ratio = ctx.sampleRate / 16000
          const out = new Float32Array(Math.max(1, Math.round(raw.length / ratio)))
          for (let i = 0; i < out.length; i++) {
            const start = Math.floor(i * ratio)
            const end = Math.min(Math.floor((i + 1) * ratio), raw.length)
            let sum = 0
            for (let j = start; j < end; j++) sum += raw[j]
            out[i] = sum / Math.max(end - start, 1)
          }
          const int16 = new Int16Array(out.length)
          for (let i = 0; i < out.length; i++) int16[i] = Math.max(-32768, Math.min(32767, out[i] * 32768))
          ws.send(JSON.stringify({ type: "audio", data: pcm16ToBase64(int16) }))
        }
        source.connect(processor); processor.connect(silent); silent.connect(ctx.destination)
      }

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return  // reject stale messages from old sessions
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === "audio" && msg.data) scheduleAudio(msg.data, msg.mime_type)
          if (msg.type === "input_transcript" && msg.content) {
            const chunk = String(msg.content).trim()
            if (chunk) {
              setMessages(prev => {
                const clean = prev.filter(m => m.role !== "system")
                const last = clean[clean.length - 1]
                if (last?.role === "user" && last.voicePending) {
                  const newText = mergeTranscriptChunk(last.text, chunk)
                  return [...clean.slice(0, -1), { role: "user", text: newText, voicePending: true }]
                }
                return [...clean, { role: "user", text: chunk, voicePending: true }]
              })
            }
          }
          if (msg.type === "text" && msg.content) {
            const chunk = String(msg.content).trim()
            if (chunk) {
              setMessages(prev => {
                const clean = prev.filter(m => m.role !== "system")
                const last = clean[clean.length - 1]
                if (last?.role === "assistant" && last.voiceStreaming) {
                  const cur = last.text || ""
                  let full
                  if (chunk.startsWith(cur)) full = chunk
                  else if (!cur.endsWith(chunk)) full = `${cur}\n${chunk}`.replace(/\n{3,}/g, "\n\n").trim()
                  else full = cur
                  return [...clean.slice(0, -1), { ...last, text: full }]
                }
                const lastUser = [...clean].reverse().find(m => m.role === "user")
                if (lastUser && isRealSpeech(lastUser.text)) {
                  return [...clean, { role: "assistant", text: chunk, voiceStreaming: true }]
                }
                return clean
              })
            }
          }
          if (msg.type === "turn_complete") {
            if (awaitingFinalRef.current) {
              // User clicked stop — close session cleanly
              nextPlayRef.current = 0
              clearTimeout(stopTimeoutRef.current)
              awaitingFinalRef.current = false
              voiceDoneRef.current = true
              cleanupAudio()
              try { wsRef.current?.close() } catch {}
              wsRef.current = null
              setMicStatus("idle")
              setMessages(prev =>
                prev.filter(m => m.role !== "system")
                    .map(m => {
                      if (m.voiceStreaming) return { role: m.role, text: m.text }
                      if (m.voicePending) {
                        if (!isRealSpeech(m.text)) return null
                        return { role: m.role, text: m.text.trim(), voiceInput: true }
                      }
                      return m
                    })
                    .filter(Boolean)
              )
            } else if (!voiceDoneRef.current) {
              setMicStatus("live")
              setMessages(prev =>
                prev.filter(m => m.role !== "system")
                    .map(m => {
                      if (m.voicePending) {
                        if (!isRealSpeech(m.text)) return null
                        return { role: m.role, text: m.text.trim(), voiceInput: true }
                      }
                      return m
                    })
                    .filter(Boolean)
              )
            }
          }
          if (msg.type === "error") {
            setMessages(prev => [...prev.filter(m => m.role !== "system"), { role: "assistant", text: msg.message || "Voice error. Please try again.", error: true }])
            stopAudio()
          }
        } catch {}
      }

      ws.onerror = () => {
        setMessages(prev => [...prev.filter(m => m.role !== "system"), { role: "assistant", text: "Could not connect to voice service.", error: true }])
        stopAudio()
      }
      ws.onclose = () => {
        clearTimeout(stopTimeoutRef.current)
        awaitingFinalRef.current = false
        setMessages(prev => prev.filter(m => m.role !== "system"))
        setMicStatus("idle")
      }
    } catch (err) {
      voiceDoneRef.current = true
      setMessages(prev => [...prev, { role: "assistant", text: err?.message || "Microphone access denied.", error: true }])
      setMicStatus("error")
      setTimeout(() => setMicStatus("idle"), 2000)
    }
  }, [stopAudio, scheduleAudio, pcm16ToBase64])

  const toggleMic = () => {
    if (micStatus === "connecting") return
    if (micStatus === "live") stopAudio()
    else startAudio()
  }

  // ── text chat — RAG pipeline via /api/chat, page-context aware ───────────────

  const sendText = async (override) => {
    const text = (typeof override === "string" ? override : input).trim()
    if (!text || loading || micStatus === "live") return
    setInput("")
    setMessages(prev => [...prev, { role: "user", text }])
    setLoading(true)
    try {
      const contextualMessage = `[APP CONTEXT: ${pageCfg.context}]\nUSER: ${text}`
      const res = await fetch(`${AI_CHATBOT_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: contextualMessage, session_id: sessionId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSessionId(data.session_id)
      const raw = (data.answer || "").replace(/^\[APP CONTEXT:[^\]]*\]\s*/, "").replace(/^USER:\s*/i, "")
      setMessages(prev => [...prev, { role: "assistant", text: raw || data.answer }])
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Having trouble connecting. Please try again.", error: true }])
    } finally {
      setLoading(false)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────

  const isLive = micStatus === "live"
  const isBusy = loading || micStatus === "connecting"
  const canSend = input.trim().length > 0 && !isBusy && !isLive
  const hasMessages = messages.filter(m => m.role !== "system").length > 0

  return (
    <>
      {/* ── Side panel — flex sibling (pushes MainContent left, no overlay) ── */}
      <AnimatePresence>
        {open && (
            <Motion.div
              key="panel"
              initial={{ width: 0 }}
              animate={{ width: 420 }}
              exit={{ width: 0 }}
              transition={{ type: "tween", duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
              className="h-full flex-shrink-0 flex flex-col overflow-hidden"
              style={{
                borderLeft: "1px solid #dff0ef",
                background: "#ffffff",
                boxShadow: "-4px 0 20px rgba(0,0,0,0.07)",
              }}
            >
            {/* Fixed-width inner wrapper prevents content squish during animation */}
            <div className="flex flex-col h-full" style={{ width: 420, minWidth: 420 }}>
              {/* ── Header ───────────────────────────────────────────────── */}
              <div className="flex-shrink-0 relative overflow-hidden" style={{ background: T.headerGrad }}>
                <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
                  style={{ backgroundImage: "radial-gradient(circle, #fff 1.5px, transparent 1.5px)", backgroundSize: "20px 20px" }} />
                <div className="pointer-events-none absolute -bottom-4 -right-4 w-32 h-32 rounded-full opacity-20"
                  style={{ background: T.primary, filter: "blur(32px)" }} />

                <div className="relative z-10 px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: "rgba(33,193,182,0.18)", border: "1px solid rgba(33,193,182,0.35)" }}>
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.74L12 2z" fill="rgba(33,193,182,0.95)" />
                          <path d="M18 12l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12z" fill="rgba(33,193,182,0.70)" />
                          <path d="M6 16l.55 1.64L8 18l-1.45.55L6 20l-.55-1.45L4 18l1.45-.55L6 16z" fill="rgba(33,193,182,0.50)" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-white font-semibold text-[14px] leading-tight">JuriNex Assistant</div>
                        <div className="text-[11px] mt-0.5" style={{ color: "rgba(33,193,182,0.80)" }}>Powered by Gemini AI</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.16)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                    >
                      <svg className="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Page context badge */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "rgba(33,193,182,0.70)" }}>Context</span>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                      style={{ background: "rgba(33,193,182,0.15)", border: "1px solid rgba(33,193,182,0.30)" }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: T.primary }} />
                      <span className="text-[11px] font-medium" style={{ color: "#7de8e4" }}>{pageCfg.name}</span>
                      <span className="text-[9px] ml-0.5" style={{ color: "rgba(33,193,182,0.60)" }}>· {pageCfg.badge}</span>
                    </div>
                    {isLive && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <VoiceWave />
                        <span className="text-[10px] text-emerald-300">Listening</span>
                      </div>
                    )}
                    {micStatus === "connecting" && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <Motion.span className="w-1.5 h-1.5 rounded-full bg-amber-400"
                          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }} />
                        <span className="text-[10px] text-amber-300">Connecting…</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Messages / Tips ───────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto" style={{ background: "#f8fafa" }}>

                {/* Empty state: contextual tip chips */}
                {!hasMessages && (
                  <div className="px-5 py-5">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Suggested for this page
                    </p>
                    <div className="flex flex-col gap-2">
                      {pageCfg.tips.map((tip, i) => (
                        <button key={i} onClick={() => sendText(tip)}
                          className="text-left text-[12.5px] px-4 py-2.5 rounded-xl transition-all flex items-center gap-2.5"
                          style={{ background: "#fff", border: "1px solid #e2eae9", color: "#374151", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.background = "#f0fdfc" }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2eae9"; e.currentTarget.style.background = "#fff" }}
                        >
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: T.soft }}>
                            <svg className="w-3 h-3" style={{ color: T.primary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </span>
                          {tip}
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-[11px] text-gray-400 text-center">
                        Or type any question below · Supports voice
                      </p>
                    </div>
                  </div>
                )}

                {/* Q&A turns — each question + answer is one card */}
                {hasMessages && (
                  <div className="px-4 py-4 flex flex-col gap-3">

                    {/* Voice status pills */}
                    {messages.filter(m => m.role === "system").map((m, i) => (
                      <div key={`sys-${i}`} className="flex justify-center">
                        <span className="text-[10px] font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5"
                          style={{ background: T.soft, color: T.dark, border: `1px solid ${T.softBorder}` }}>
                          <Motion.span className="w-1.5 h-1.5 rounded-full bg-red-400"
                            animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
                          {m.text}
                        </span>
                      </div>
                    ))}

                    {/* Build Q&A pairs and render as cards */}
                    {(() => {
                      const visible = messages.filter(m => m.role !== "system")
                      const turns = []
                      let i = 0
                      while (i < visible.length) {
                        const msg = visible[i]
                        if (msg.role === "user") {
                          if (!isRealSpeech(msg.text) && (msg.voicePlaceholder || msg.voicePending)) {
                            i++
                            continue
                          }
                          const next = visible[i + 1]
                          const isVoice = !!(msg.voiceInput || msg.voicePending)
                          if (next?.role === "assistant") {
                            turns.push({ id: i, question: msg.text, answer: next, isVoice })
                            i += 2
                          } else {
                            turns.push({ id: i, question: msg.text, answer: null, isVoice })
                            i++
                          }
                        } else {
                          // standalone assistant message — no user pairing
                          turns.push({ id: i, question: null, answer: msg, isVoice: false })
                          i++
                        }
                      }
                      return turns.map((turn, idx) => (
                        <Motion.div key={turn.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}>
                          <TurnCard
                            question={turn.question}
                            answer={turn.answer}
                            isLoading={!turn.answer && (loading || micStatus === "live" || micStatus === "connecting") && idx === turns.length - 1}
                            isVoice={turn.isVoice}
                          />
                        </Motion.div>
                      ))
                    })()}

                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              {/* ── Input bar ────────────────────────────────────────────── */}
              <div className="flex-shrink-0 px-4 py-3"
                style={{ background: "#fff", borderTop: "1px solid #eaf3f3" }}>
                <div className="flex items-end gap-2 rounded-2xl px-3 py-2 transition-all"
                  style={isLive
                    ? { background: "#fff5f5", border: "1.5px solid #fc8181" }
                    : { background: "#f4fafa", border: "1.5px solid #daeaea" }}
                  onFocusCapture={e => { if (!isLive) { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.boxShadow = `0 0 0 3px ${T.soft}` } }}
                  onBlurCapture={e => { if (!isLive) { e.currentTarget.style.borderColor = "#daeaea"; e.currentTarget.style.boxShadow = "none" } }}
                >
                  {/* Mic */}
                  <Motion.button onClick={toggleMic} disabled={isBusy && !isLive}
                    whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.90 }}
                    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-40"
                    style={isLive
                      ? { background: "linear-gradient(135deg,#ef4444,#dc2626)", boxShadow: "0 3px 10px rgba(239,68,68,0.40)" }
                      : micStatus === "connecting"
                      ? { background: T.primary }
                      : { background: T.soft }}>
                    {isLive ? (
                      <Motion.svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20"
                        animate={{ scale: [1, 0.85, 1] }} transition={{ duration: 0.7, repeat: Infinity }}>
                        <rect x="5" y="5" width="10" height="10" rx="2.5" />
                      </Motion.svg>
                    ) : micStatus === "connecting" ? (
                      <Motion.svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                        <path strokeLinecap="round" d="M12 3a9 9 0 010 18" />
                      </Motion.svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" style={{ color: T.primary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    )}
                  </Motion.button>

                  {/* Text input */}
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText() } }}
                    placeholder={isLive ? "Listening via microphone…" : "Ask how to use this page or about your documents…"}
                    disabled={isBusy || isLive}
                    className="flex-1 bg-transparent text-[13px] text-gray-800 placeholder-gray-400 resize-none outline-none max-h-24 overflow-y-auto disabled:cursor-default leading-relaxed" />

                  {/* Send */}
                  <Motion.button onClick={sendText} disabled={!canSend}
                    whileHover={canSend ? { scale: 1.06 } : {}} whileTap={canSend ? { scale: 0.90 } : {}}
                    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-30"
                    style={canSend
                      ? { background: T.btnGrad, boxShadow: "0 3px 10px rgba(33,193,182,0.40)" }
                      : { background: "#e8edf2" }}>
                    <svg className={`w-3.5 h-3.5 ${canSend ? "text-white" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Motion.button>
                </div>

                <p className="text-[10px] text-center mt-1.5" style={{ color: "#b0bec5" }}>
                  {isLive ? "Tap to stop recording" : "Platform guide · Grounded in your uploaded documents"}
                </p>
              </div>
            </div>
            </Motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating trigger button ─────────────────────────────────────────── */}
      <Motion.button
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.04, y: -2 }}
        whileTap={{ scale: 0.94 }}
        className="jnx-assistant-fab fixed bottom-6 right-6 z-40 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-white font-semibold text-[13px] select-none"
        style={{
          background: open ? "linear-gradient(135deg,#0f2a28,#0d4240)" : T.btnGrad,
          boxShadow: open
            ? "0 4px 20px rgba(4,47,46,0.50)"
            : "0 4px 20px rgba(33,193,182,0.45), 0 0 0 1px rgba(33,193,182,0.30)",
          transition: "background 0.25s, box-shadow 0.25s",
        }}
        aria-label="Open JuriNex AI Assistant"
      >
        {!open && (
          <Motion.span className="absolute inset-0 rounded-2xl"
            animate={{ scale: [1, 1.18, 1.18], opacity: [0.4, 0, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }}
            style={{ background: "rgba(33,193,182,0.35)", zIndex: -1 }} />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <Motion.svg key="ai" className="w-4 h-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }} viewBox="0 0 24 24" fill="none">
            <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.74L12 2z" fill="rgba(255,255,255,0.95)" />
            <path d="M18 12l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12z" fill="rgba(255,255,255,0.70)" />
            <path d="M6 16l.55 1.64L8 18l-1.45.55L6 20l-.55-1.45L4 18l1.45-.55L6 16z" fill="rgba(255,255,255,0.50)" />
          </Motion.svg>
        </AnimatePresence>

        <span>AI Help</span>

        {!open && (
          <span className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.80)" }} />
        )}
      </Motion.button>
    </>
  )
}
