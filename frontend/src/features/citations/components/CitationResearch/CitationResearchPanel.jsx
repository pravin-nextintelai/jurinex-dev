import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ScaleIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import judgementApi from '../../api/judgementApi';
import documentApi from '@/shared/api/documentApi';
import CitationReviewResults from './CitationReviewResults';
import AdvancedSearchModal from './AdvancedSearchModal';
import DOCTYPE_CATEGORIES from './ikDoctypes';

// Court groups for the issues-step "choose courts" box — the court subset of
// Indian Kanoon's document types (laws/others make no sense as precedent).
const COURT_SCOPE_GROUPS = DOCTYPE_CATEGORIES.filter(
  (cat) => ['sc', 'highcourts', 'districtcourts', 'tribunals'].includes(cat.key),
);

// Palette matches the app's light theme: slate text/borders, the brand
// teal (#21C1B6 / hover #1AA49B) as accent, and tinted status colours
// (red/amber/green stay semantic — bands and warnings, not theme).
const BAND_STYLES = {
  GREEN: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
  YELLOW: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
  RED: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
};

// ── Case-card helpers (registry-style cards in the case picker) ─────────────

/** "COMM. SUIT 412 / 2025" style reference line from whatever fields exist. */
const caseRefOf = (cs) => {
  const clean = (v) => {
    const s = (v ?? '').toString().trim();
    return s && !/^\d+$/.test(s) ? s : '';
  };
  const prefix = clean(cs.case_prefix) || clean(cs.case_type);
  const num = (cs.case_number ?? '').toString().trim();
  const year = (cs.case_year ?? '').toString().trim()
    || ((cs.filing_date || cs.created_at || '').toString().slice(0, 4));
  const left = [prefix, num].filter(Boolean).join(' ');
  return ([left, year].filter(Boolean).join(' / ') || 'Case file').toUpperCase();
};

/** [petitioner, respondent] — from the party lists, else by splitting the title on "vs". */
const partiesOf = (cs) => {
  const nameOf = (p) => (typeof p === 'string' ? p : p?.fullName || p?.name || '');
  const withOthers = (list) => {
    const first = nameOf((list || [])[0]).trim();
    if (!first) return '';
    return (list.length > 1) ? `${first} & others` : first;
  };
  const p1 = withOthers(cs.petitioners);
  const p2 = withOthers(cs.respondents);
  if (p1 || p2) return [p1 || (cs.case_title || cs.name || cs.id), p2];
  const title = (cs.case_title || cs.name || '').toString();
  const parts = title.split(/\s+v(?:s|ersus)?\.?\s+/i);
  if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(' v. ').trim()];
  return [title || cs.id, ''];
};

/** "Updated yesterday" / "23 Jul 2026" style footer line for case cards. */
const updatedLabel = (iso) => {
  if (!iso) return 'Case documents on record';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Case documents on record';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return `Updated ${days} days ago`;
  if (days < 14) return 'Updated last week';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// "07 Aug, 10:52" from the session's ISO timestamp — formatted from the raw
// string so the stored time is shown unchanged, exactly as the API returns it.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const historyStamp = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return String(iso || '').slice(0, 16);
  return `${m[3]} ${MONTH_SHORT[Number(m[2]) - 1] || m[2]}, ${m[4]}:${m[5]}`;
};

// Quick-start templates for the fresh-matter objective box.
const QUICK_FILLS = [
  { label: 'Quash the FIR', text: 'We act for the applicants. Seek quashing of the FIR — the dispute is purely civil and the complaint is a counterblast to our recovery suit.' },
  { label: 'Anticipatory bail', text: 'We act for the applicant. Seek anticipatory bail — no custodial interrogation is needed and the applicant has no antecedents.' },
  { label: 'Stay of proceedings', text: 'We act for the respondents. Seek stay of the trial court proceedings pending disposal of this petition.' },
  { label: 'Wage revision', text: 'We act for the workmen; focus on the wage revision demand and seek reinstatement with back wages.' },
];

/** Toggle used by the Research options cards. */
function Switch({ on, label, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`relative mt-0.5 h-[23px] w-10 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-[#0E8371]' : 'bg-[#D8E1E0]'}`}
    >
      <span className={`absolute top-[3px] left-[3px] h-[17px] w-[17px] rounded-full bg-white shadow-[0_1px_3px_rgba(15,27,33,0.3)] transition-transform duration-200 ${on ? 'translate-x-[17px]' : 'translate-x-0'}`} />
    </button>
  );
}

/** Numbered section label: (n) Title ─────── note */
function StepLab({ n, title, note }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 min-w-0">
      <span className="h-[22px] w-[22px] shrink-0 rounded-full bg-[#0F1B21] text-white text-[length:calc(11px*var(--jnx-text-scale,1))] font-bold flex items-center justify-center">{n}</span>
      <h2 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold tracking-[-0.01em] text-[#0F1B21] whitespace-nowrap">{title}</h2>
      {note && <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-medium text-[#93A2A7] truncate">{note}</span>}
      <span className="h-px flex-1 bg-[#E5ECEB] min-w-[16px]" />
    </div>
  );
}

const REFINE_MODES = [
  { value: 'facet', label: 'Filter (court / year / band)' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'semantic', label: 'Semantic' },
];

function BandPill({ band }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold tracking-wide ${BAND_STYLES[band] || BAND_STYLES.RED}`}>
      {band}
    </span>
  );
}

function Chip({ text }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-[length:calc(11px*var(--jnx-text-scale,1))] font-medium bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] whitespace-nowrap">
      {text}
    </span>
  );
}

function ResultCard({ item, demoted }) {
  return (
    <div className={`rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-opacity ${demoted ? 'opacity-45' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-semibold text-[#0F172A] hover:text-[#21C1B6] leading-snug"
        >
          {item.title || item.docId}
        </a>
        <div className="flex items-center gap-2 shrink-0">
          <BandPill band={item.band} />
          <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64748B] font-semibold">{Math.round((item.score || 0) * 100)}%</span>
        </div>
      </div>
      <div className="mt-1 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64748B]">
        {item.court}{item.year ? ` · ${item.year}` : ''}
      </div>
      {item.redFlag && (
        <div className="mt-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#991B1B]">
          ⚠ Flagged: negative treatment — do not rely without checking.
        </div>
      )}
      {item.pinpoint && (
        <blockquote className="mt-3 border-l-2 border-[#21C1B6]/50 bg-[#F8FAFC] rounded-r-lg pl-3 pr-3 py-2 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#475569] italic leading-relaxed">
          {item.pinpoint}
        </blockquote>
      )}
      {Array.isArray(item.chips) && item.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.chips.map((chip, idx) => <Chip key={idx} text={chip} />)}
        </div>
      )}
    </div>
  );
}

function IssueResults({ sessionId, issue }) {
  const [mode, setMode] = useState('keyword');
  const [query, setQuery] = useState('');
  const [refined, setRefined] = useState(null);
  const [refining, setRefining] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const applyRefine = async (overrideMode) => {
    const useMode = overrideMode || mode;
    if (!query.trim() && useMode !== 'facet') {
      toast.info('Type what to refine by first');
      return;
    }
    setRefining(true);
    try {
      const data = await judgementApi.refine(sessionId, { issueId: issue.id, mode: useMode, query });
      setRefined(data);
      setCurrentPage(1); // Reset to first page on refinement
    } catch (err) {
      toast.error(err.message || 'Refine failed');
    } finally {
      setRefining(false);
    }
  };

  const rows = refined
    ? refined.items.map((entry) => ({ item: entry.result, demoted: entry.demoted }))
    : issue.results.map((item) => ({ item, demoted: false }));

  const totalPages = Math.ceil(rows.length / itemsPerPage);
  const paginatedRows = rows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="h-8 w-8 rounded-lg bg-[#F0FDFA] flex items-center justify-center shrink-0">
            <ScaleIcon className="h-4.5 w-4.5 text-[#21C1B6]" style={{ height: 18, width: 18 }} />
          </span>
          <h3 className="text-[length:calc(15px*var(--jnx-text-scale,1))] font-bold text-[#0F172A] leading-snug font-serif pt-1">{issue.issue}</h3>
        </div>
        <div className="text-[length:calc(11px*var(--jnx-text-scale,1))] font-medium text-[#94A3B8] whitespace-nowrap pt-1.5">
          {rows.length} result{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Search within these results — reorders, never deletes */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="bg-white border border-[#E2E8F0] text-[#475569] text-[length:calc(12px*var(--jnx-text-scale,1))] rounded-lg px-2 py-2 outline-none focus:border-[#21C1B6]/50"
        >
          {REFINE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyRefine(); }}
          placeholder='Refine these results, e.g. "Supreme Court after 2015"'
          className="flex-1 min-w-[220px] bg-white border border-[#E2E8F0] text-[#0F172A] text-[length:calc(12px*var(--jnx-text-scale,1))] rounded-lg px-3 py-2 outline-none focus:border-[#21C1B6]/50 placeholder:text-[#94A3B8]"
        />
        <button
          onClick={() => applyRefine()}
          disabled={refining}
          className="px-3.5 py-2 rounded-lg text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold bg-white hover:bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] disabled:opacity-50"
        >
          {refining ? 'Refining…' : 'Refine'}
        </button>
        {(refined || query) && (
          <button
            onClick={() => { setRefined(null); setQuery(''); setCurrentPage(1); }}
            className="px-2 py-2 rounded-lg text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#94A3B8] hover:text-[#475569]"
          >
            Reset
          </button>
        )}
      </div>

      {refined?.escapeHatch && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
          <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#92400E]">{refined.escapeHatch.offer}</span>
          <button
            onClick={() => applyRefine('ik_escape')}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold bg-[#21C1B6] hover:bg-[#1AA49B] text-white"
          >
            Search all of Indian Kanoon
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3">
        {paginatedRows.length === 0 && (
          <div className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#94A3B8] italic">No precedents surfaced for this issue.</div>
        )}
        {paginatedRows.map(({ item, demoted }) => (
          <ResultCard key={item.docId} item={item} demoted={demoted} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 pt-4 border-t border-[#F1F5F9] flex items-center justify-between">
          <div className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64748B]">
            Showing <span className="font-semibold text-[#0F172A]">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-semibold text-[#0F172A]">{Math.min(currentPage * itemsPerPage, rows.length)}</span> of <span className="font-semibold text-[#0F172A]">{rows.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              <ChevronLeftIcon className="h-4 w-4 text-[#475569]" />
            </button>
            <div className="flex items-center gap-1 mx-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                // Show first, last, current, and one around current
                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                  return (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[28px] h-7 text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold rounded-lg transition-colors ${
                        currentPage === p
                          ? 'bg-[#21C1B6] text-white'
                          : 'text-[#475569] hover:bg-[#F1F5F9]'
                      }`}
                    >
                      {p}
                    </button>
                  );
                }
                if (p === currentPage - 2 || p === currentPage + 2) {
                  return <span key={p} className="text-[#94A3B8] px-0.5">…</span>;
                }
                return null;
              })}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              {/* Reuse ChevronLeft but rotate it or use ChevronRight if available */}
              <ChevronLeftIcon className="h-4 w-4 text-[#475569] rotate-180" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CitationResearchPanel() {
  const [step, setStep] = useState('input'); // input | issues | results
  const [inputMode, setInputMode] = useState('case'); // case | text
  // How research items are derived: 'issues' (issue spotter — existing
  // behaviour, default) or 'grounds' (extract the grounds pleaded in the
  // filing and fetch verified judgments for each ground).
  // 'combined' = ONE pass extracting pleaded grounds AND spotting issues,
  // merged — the only mode for new analyses; 'issues'/'grounds' survive
  // solely for rendering sessions analysed before the merge.
  const [researchMode, setResearchMode] = useState('combined');
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesPage, setCasesPage] = useState(1);
  const casesPerPage = 6;
  const [caseFilter, setCaseFilter] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [caseText, setCaseText] = useState('');
  // Fresh matter: the case has NO drafted pleading yet — the system reads
  // ALL of the case's source documents and the lawyer's stated objective
  // (typed in the textarea, required) drives PROPOSED grounds via the
  // dedicated /analyze/case/fresh route.
  const [freshMode, setFreshMode] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploadTitle, setUploadTitle] = useState('');
  // Advanced search: opt-in Boolean AND/OR query generation. Off = the
  // standard keyword queries the system has always used.
  const [advancedSearch, setAdvancedSearch] = useState(false);
  // Advanced Search popup: direct Indian Kanoon search with the user's own
  // criteria (IK /advsearch mirror) — independent of the research pipeline.
  const [advSearchOpen, setAdvSearchOpen] = useState(false);
  // Court scope (issues-step Advanced search): restrict the run's IK queries
  // court-wise. Nothing selected = the service's default coverage.
  const [scopeSupreme, setScopeSupreme] = useState(false);
  const [scopeCaseCourt, setScopeCaseCourt] = useState(false);
  const [scopeCourts, setScopeCourts] = useState(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
  // Date range for the run — every query gets fromdate:/todate: when set.
  const [scopeFromDate, setScopeFromDate] = useState(''); // yyyy-mm-dd
  const [scopeToDate, setScopeToDate] = useState('');
  // Acting for: '' = auto (infer from the case) | petitioner | respondent.
  // Locked role → grounds/issues/queries framed for that side; only that
  // side's judgments surface.
  const [clientRole, setClientRole] = useState('');

  // Description boxes grow with their content instead of scrolling inside.
  // height:auto first so shrinking works; scrollHeight then includes the
  // rows-attribute minimum, so short content keeps the designed height.
  const caseTextRef = useRef(null);
  const customDraftRef = useRef(null);
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  const addFiles = (picked) => {
    const incoming = Array.from(picked || []);
    if (!incoming.length) return;
    setFiles((prev) => {
      // Dedupe on name+size so re-picking the same document is a no-op.
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}|${f.size}`))];
    });
  };
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const [analyzing, setAnalyzing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [customIssues, setCustomIssues] = useState([]);
  const [customDraft, setCustomDraft] = useState('');
  const [searchResponse, setSearchResponse] = useState(null);

  // Per-issue query curation: issueId -> { selected: [system queries kept
  // checked], custom: [user-typed queries] }. Issues with no entry run
  // with their full generated query set server-side.
  const [queryPicks, setQueryPicks] = useState({});
  const [queryDrafts, setQueryDrafts] = useState({}); // issueId -> input text

  // Issues-step UI state: kind filter, per-card "Read more", context expand.
  const [issueFilter, setIssueFilter] = useState('all');
  const [expandedDesc, setExpandedDesc] = useState({});
  const [ctxExpanded, setCtxExpanded] = useState(false);

  // Auto-grow effects live below every state they read (TDZ-safe).
  useEffect(() => { autoGrow(caseTextRef.current); }, [caseText, freshMode, inputMode, step]);
  // The sticky-bar composer behaves like a chat input: one line tall,
  // grows to ~3 lines, then scrolls internally.
  useEffect(() => {
    const el = customDraftRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 96)}px`;
  }, [customDraft, step]);

  // Analyse progress card: steps advance on a timer while the real API call
  // runs; the last step stays active until the response lands.
  const [pipeStep, setPipeStep] = useState(0);
  const pipeRef = useRef(null);
  useEffect(() => {
    if (!analyzing) { setPipeStep(0); return undefined; }
    setPipeStep(0);
    pipeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const t1 = setTimeout(() => setPipeStep(1), 8000);
    const t2 = setTimeout(() => setPipeStep(2), 20000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [analyzing]);

  const totalSelected = selectedIds.size + customIssues.length;
  const suggested = analysis?.suggestedIssues || [];
  // Once analysed, the server's researchMode is the truth for this session.
  const isGrounds = (analysis?.researchMode || researchMode) === 'grounds';
  const isCombined = (analysis?.researchMode || researchMode) === 'combined';
  const isFresh = (analysis?.researchMode || researchMode) === 'fresh';
  const groundsMeta = analysis?.groundsMeta || null;

  // The tab always opens FRESH (user preference): no state rehydration when
  // navigating here from another tab — every mount starts at the input step.
  // Past research is never lost: analysed/searched sessions live in the DB
  // and reopen from Recents. Any pre-existing persisted blob is cleared.
  const STORAGE_KEY = 'jurinex.citationResearch.v1';
  useEffect(() => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
  }, []);

  // The user's existing cases, from the agentic document service.
  useEffect(() => {
    documentApi.getCases()
      .then((r) => {
        const list = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []);
        setCases(Array.isArray(list) ? list : []);
      })
      .catch(() => setCases([]))
      .finally(() => setCasesLoading(false));
  }, []);

  // Research history — every past search stored in the citationTest DB.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);
  // Silent refresh keeps the sidebar in sync after analyze/run/back-to-input;
  // a transient failure keeps the previous list instead of blanking it.
  const refreshHistory = useCallback((initial = false) => {
    if (initial) setHistoryLoading(true);
    judgementApi.listSessions()
      .then((rows) => setHistory(rows))
      .catch(() => { if (initial) setHistory([]); })
      .finally(() => { if (initial) setHistoryLoading(false); });
  }, []);
  useEffect(() => { refreshHistory(true); }, [refreshHistory]);
  // Coming back to the input step (after a search, or via "New research")
  // must show research finished this visit — the mount-time list is stale.
  useEffect(() => {
    if (step === 'input') refreshHistory();
  }, [step, refreshHistory]);

  const openHistory = async (sessionId) => {
    try {
      const saved = await judgementApi.getSession(sessionId);
      setAnalysis({
        sessionId,
        caseContext: saved.caseContext,
        suggestedIssues: saved.suggestedIssues || [],
        caseTitle: saved.caseTitle || null,
        needsClarification: false,
        researchMode: saved.researchMode || 'issues',
        groundsMeta: saved.groundsMeta || null,
      });
      // Reopened sessions follow the same convention: nothing pre-selected.
      setSelectedIds(new Set());
      setCustomIssues([]);
      setQueryPicks(Object.fromEntries(
        (saved.suggestedIssues || []).map((i) => [i.id, { selected: [], custom: [] }])));
      setQueryDrafts({});
      const issuesWithResults = (saved.issues || []).filter((i) => (i.results || []).length > 0);
      if (issuesWithResults.length > 0) {
        // Restore approve/reject pills saved with the session.
        try {
          const statuses = {};
          Object.entries(saved.statuses || {}).forEach(([issueId, byDoc]) =>
            Object.entries(byDoc || {}).forEach(([docId, st]) => { statuses[`${issueId}:${docId}`] = st; }));
          sessionStorage.setItem(`jurinex.reviewStatuses.${sessionId}`, JSON.stringify(statuses));
        } catch { /* non-fatal */ }
        setSearchResponse({ sessionId, issues: saved.issues, forumCourt: saved.forumCourt || null });
        setStep('results');
      } else {
        setSearchResponse(null);
        setStep('issues');
        toast.info('This research was analysed but a search was never run — pick issues and hit Run search.');
      }
    } catch (err) {
      toast.error(err.message || 'Could not open this research');
    }
  };

  // Case-grid search: filter by party names, case number/ref or title.
  const filteredCases = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((cs) =>
      `${caseRefOf(cs)} ${partiesOf(cs).join(' ')} ${cs.case_title || cs.name || ''}`.toLowerCase().includes(q));
  }, [cases, caseFilter]);
  useEffect(() => { setCasesPage(1); }, [caseFilter]);
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredCases.length / casesPerPage));
    setCasesPage((p) => Math.min(p, maxPage));
  }, [filteredCases.length, casesPerPage]);

  // Each tab shows only its own research: case-based sessions carry a
  // caseId; uploaded-document sessions don't. With a case SELECTED, Recents
  // narrows to that case's history; no selection = all (default).
  const tabHistory = useMemo(
    () => history.filter((h) => {
      if (inputMode !== 'case') return !h.caseId;
      if (!h.caseId) return false;
      return !selectedCaseId || String(h.caseId) === String(selectedCaseId);
    }),
    [history, inputMode, selectedCaseId],
  );

  // Latest research per case — drives the "N issues" badge on case cards.
  const researchByCase = useMemo(() => {
    const map = {};
    history.forEach((h) => { if (h.caseId && !map[h.caseId]) map[h.caseId] = h; });
    return map;
  }, [history]);

  const [deletingId, setDeletingId] = useState(null);
  const deleteHistory = async (entry) => {
    const label = entry.caseTitle || entry.summary || entry.sessionId;
    const result = await Swal.fire({
      title: 'Delete research',
      text: `Delete "${label}" and all its citation reports? This cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#DC2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      customClass: { popup: 'rounded-lg', confirmButton: 'rounded-lg', cancelButton: 'rounded-lg' },
    });
    if (!result.isConfirmed) return;
    setDeletingId(entry.sessionId);
    try {
      await judgementApi.deleteSession(entry.sessionId);
      setHistory((prev) => prev.filter((h) => h.sessionId !== entry.sessionId));
      try { sessionStorage.removeItem(`jurinex.reviewStatuses.${entry.sessionId}`); } catch { /* non-fatal */ }
      // If the deleted research is the one currently open, reset to input.
      if (analysis?.sessionId === entry.sessionId) {
        setAnalysis(null);
        setSearchResponse(null);
        setSelectedIds(new Set());
        setCustomIssues([]);
        setStep('input');
      }
      Swal.fire({ title: 'Deleted!', text: 'The research and its reports are gone.', icon: 'success', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: 'Error!', text: err.message || 'Could not delete this research.', icon: 'error', confirmButtonColor: '#21C1B6' });
    } finally {
      setDeletingId(null);
    }
  };

  // Compact "Recents" row: icon + one truncated line; the full title and
  // details live in the hover tooltip, delete appears on hover. A div (not
  // a button) so the delete control can nest inside it.
  const HistoryRow = ({ entry }) => {
    const name = entry.caseTitle || entry.summary || entry.sessionId;
    const meta = entry.citationCount > 0
      ? `${entry.issueCount} issue${entry.issueCount === 1 ? '' : 's'} · ${entry.citationCount} citation${entry.citationCount === 1 ? '' : 's'} · ${historyStamp(entry.updatedAt)}`
      : `analysed only — no search run yet · ${historyStamp(entry.updatedAt)}`;
    const deleting = deletingId === entry.sessionId;
    return (
      <div
        onClick={() => openHistory(entry.sessionId)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') openHistory(entry.sessionId); }}
        title={`${name}\n${meta}`}
        className="group flex items-center gap-2 rounded-lg px-2 py-[7px] cursor-pointer transition-colors hover:bg-[#EFF4F3]"
      >
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-[#93A2A7]" />
        <span className="min-w-0 flex-1 truncate text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#25353C] group-hover:text-[#0F1B21]">
          {name}
        </span>
        {entry.citationCount === 0 && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#B97F24]" />
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); deleteHistory(entry); }}
          disabled={deleting}
          title="Delete this research and its reports"
          className={`shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-[#93A2A7] hover:text-[#C24444] hover:bg-[#FBEDED] transition-colors ${
            deleting ? 'opacity-60' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
        >
          {deleting
            ? <ArrowPathIcon className="animate-spin" style={{ height: 13, width: 13 }} />
            : <TrashIcon style={{ height: 13, width: 13 }} />}
        </button>
      </div>
    );
  };

  const runAnalyze = async () => {
    if (inputMode === 'case' && !selectedCaseId) {
      toast.info('Select one of your cases first');
      return;
    }
    if (inputMode === 'case' && freshMode && !caseText.trim()) {
      toast.info('Describe what the client wants — the objective drives a fresh matter\'s grounds');
      // Make the blocker impossible to miss: jump to the empty objective box.
      caseTextRef.current?.focus();
      caseTextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (inputMode === 'text' && files.length === 0) {
      toast.info('Upload at least one case document first — they are analysed directly');
      return;
    }
    setAnalyzing(true);
    try {
      const queryStyle = advancedSearch ? 'advanced' : 'simple';
      const data = inputMode === 'case'
        ? (freshMode
          ? await judgementApi.analyzeCaseFresh(selectedCaseId, caseText.trim(), queryStyle, clientRole || null)
          : await judgementApi.analyzeCase(selectedCaseId, caseText.trim(), researchMode, queryStyle, clientRole || null))
        // Upload tab: the document is the case material; the optional
        // description steers which grounds and issues come back.
        : await judgementApi.analyzeUpload(files, caseText.trim(), researchMode, uploadTitle.trim(), queryStyle, clientRole || null);
      setAnalysis(data);
      // Nothing pre-selected: the user consciously picks what to research;
      // checking a ground ticks its whole query set (toggleIssue).
      setSelectedIds(new Set());
      setCustomIssues([]);
      setQueryPicks(Object.fromEntries(
        (data.suggestedIssues || []).map((i) => [i.id, { selected: [], custom: [] }])));
      setQueryDrafts({});
      setSearchResponse(null);
      setStep('issues');
      refreshHistory();
      if (data.needsClarification && data.clarificationQuestion) {
        toast.warn(data.clarificationQuestion, { autoClose: 8000 });
      }
    } catch (err) {
      toast.error(err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const picksFor = (issue) => queryPicks[issue.id] || { selected: issue.queries || [], custom: [] };
  const toggleQuery = (issue, query) => {
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      const selected = p.selected.includes(query)
        ? p.selected.filter((q) => q !== query)
        : [...p.selected, query];
      return { ...prev, [issue.id]: { ...p, selected } };
    });
  };
  const addOwnQuery = (issue) => {
    const text = (queryDrafts[issue.id] || '').trim();
    if (!text) return;
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      if (p.custom.includes(text)) return prev;
      return { ...prev, [issue.id]: { ...p, custom: [...p.custom, text] } };
    });
    setQueryDrafts((prev) => ({ ...prev, [issue.id]: '' }));
  };
  const removeOwnQuery = (issue, query) => {
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      return { ...prev, [issue.id]: { ...p, custom: p.custom.filter((q) => q !== query) } };
    });
  };

  // Ground/issue selection drives its query ticks: deselecting unticks every
  // query on that card; reselecting ticks the full default set again (the
  // user's own typed queries are kept either way).
  const toggleIssue = (id) => {
    const selecting = !selectedIds.has(id);
    const defaults = (suggested.find((i) => i.id === id) || {}).queries || [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selecting) next.add(id); else next.delete(id);
      return next;
    });
    setQueryPicks((prev) => ({
      ...prev,
      [id]: { selected: selecting ? [...defaults] : [], custom: prev[id]?.custom || [] },
    }));
  };

  const selectAllIssues = () => {
    setSelectedIds(new Set(suggested.map((i) => i.id)));
    setQueryPicks((prev) => {
      const next = { ...prev };
      suggested.forEach((i) => {
        next[i.id] = { selected: [...(i.queries || [])], custom: prev[i.id]?.custom || [] };
      });
      return next;
    });
  };

  const clearAllIssues = () => {
    setSelectedIds(new Set());
    setQueryPicks((prev) => {
      const next = { ...prev };
      suggested.forEach((i) => {
        next[i.id] = { selected: [], custom: prev[i.id]?.custom || [] };
      });
      return next;
    });
  };

  // A user-typed issue gets the SAME treatment as system-suggested ones:
  // the backend enriches it + generates its queries, and it lands in the
  // card grid with its own SEARCH QUERIES panel. If that call fails, the
  // text degrades to the legacy path (analysed live when the search runs).
  const [addingIssue, setAddingIssue] = useState(false);
  const addCustomIssue = async () => {
    const text = customDraft.trim();
    if (!text || addingIssue) return;
    if (!analysis?.sessionId) {
      setCustomIssues((prev) => [...prev, text]);
      setCustomDraft('');
      return;
    }
    setAddingIssue(true);
    try {
      const r = await judgementApi.addIssue(analysis.sessionId, text);
      setAnalysis((prev) => (prev
        ? { ...prev, suggestedIssues: [...(prev.suggestedIssues || []), r.issue] }
        : prev));
      // The user explicitly added this issue — select it with all its
      // queries ticked, matching the check-a-ground convention.
      setSelectedIds((prev) => new Set([...prev, r.issue.id]));
      setQueryPicks((prev) => ({
        ...prev,
        [r.issue.id]: { selected: [...(r.issue.queries || [])], custom: [] },
      }));
      setCustomDraft('');
    } catch {
      setCustomIssues((prev) => [...prev, text]);
      setCustomDraft('');
      toast.info('Added — it will be analysed when the search runs');
    } finally {
      setAddingIssue(false);
    }
  };

  const runSearch = async () => {
    if (totalSelected === 0) {
      toast.info('Select at least one issue or add your own');
      return;
    }
    setSearching(true);
    try {
      // Only issues whose queries the user actually touched are overridden;
      // the rest keep their full generated set server-side.
      const queryOverrides = {};
      [...selectedIds].forEach((id) => {
        const p = queryPicks[id];
        const defaults = (suggested.find((i) => i.id === id) || {}).queries || [];
        // THE CHECKBOX PANEL IS THE CONTRACT: exactly the queries shown
        // ticked (plus any the user typed) are what runs — never the
        // system's hidden contra/axis fetch queries. This holds even when
        // the user leaves the default set untouched. An issue with no
        // displayed queries (rare legacy) keeps the server-generated set.
        const chosen = p
          ? [...(p.selected || []), ...(p.custom || [])].filter(Boolean)
          : [...defaults];
        if (!p && defaults.length === 0) return;
        queryOverrides[String(id)] = chosen;
      });
      const data = await judgementApi.runSearch(analysis.sessionId, {
        issueIds: [...selectedIds],
        customIssues,
        queryOverrides,
        // Court scope boxes — sent only when the user restricted courts.
        courtScope: (scopeSupreme || scopeCaseCourt || scopeCourts.size > 0)
          ? { supremeCourt: scopeSupreme, caseCourt: scopeCaseCourt, courts: [...scopeCourts] }
          : null,
        fromdate: scopeFromDate,
        todate: scopeToDate,
      });
      setSearchResponse(data);
      setStep('results');
      refreshHistory();
    } catch (err) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const resetAll = () => {
    setStep('input');
    setAnalysis(null);
    setSearchResponse(null);
    setSelectedIds(new Set());
    setCustomIssues([]);
    setCaseText('');
    setFiles([]);
    setUploadTitle('');
    setSelectedCaseId(null);
    setScopeSupreme(false);
    setScopeCaseCourt(false);
    setScopeCourts(new Set());
    setCourtsOpen(false);
    setScopeFromDate('');
    setScopeToDate('');
    setClientRole('');
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
  };

  // ── Step 1: case input ──────────────────────────────────────────────────
  if (step === 'input') {
    const isFiltering = caseFilter.trim().length > 0;
    const totalFiltered = filteredCases.length;
    const pageStart = totalFiltered === 0 ? 0 : (casesPage - 1) * casesPerPage + 1;
    const pageEnd = Math.min(casesPage * casesPerPage, totalFiltered);
    const pagedCases = filteredCases.slice((casesPage - 1) * casesPerPage, casesPage * casesPerPage);
    const runSub = (advancedSearch ? 'Boolean precision search' : 'Standard keyword search')
      + (inputMode === 'case' && freshMode ? ' · grounds from your objective' : '');
    const analyzeSteps = [
      inputMode === 'case' ? 'Reading the case documents' : 'Reading the uploaded documents',
      inputMode === 'case' && freshMode ? 'Building proposed grounds from your objective' : 'Finding legal issues and grounds',
      'Generating search queries for each one',
    ];
    const pct = Math.round(((Math.min(pipeStep, analyzeSteps.length - 1) + 1) / analyzeSteps.length) * 100);
    const toggleFresh = () => setFreshMode((v) => {
      if (!v) setTimeout(() => caseTextRef.current?.focus(), 320);
      return !v;
    });

    return (
      <div data-jnx-citation className="min-h-full bg-[#F6F9F8] px-4 pt-7 pb-16 sm:px-6 md:px-9 md:pt-9 overflow-x-clip lg:h-full lg:overflow-hidden lg:flex lg:flex-col lg:pb-6">
        <div className="max-w-[1240px] mx-auto min-w-0 w-full lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">

          {/* Header */}
          <header className="flex gap-[15px] mb-[26px] shrink-0">
            <div className="h-11 w-11 shrink-0 rounded-[13px] bg-gradient-to-br from-[#E9F9F5] to-[#D9F4EE] border border-[#BFE9DF] flex items-center justify-center text-[#0E8371]">
              <SparklesIcon className="h-[21px] w-[21px]" />
            </div>
            <div>
              <h1 className="text-[length:calc(23px*var(--jnx-text-scale,1))] font-extrabold tracking-[-0.02em] text-[#0F1B21] leading-tight">Citation Research</h1>
              <p className="text-[length:calc(13.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-1 max-w-[66ch]">
                Pick one of your cases or upload a document — the system finds the legal issues and grounds,
                then retrieves <b className="font-semibold text-[#0E8371]">verified Indian Kanoon precedents</b> for each one.
              </p>
            </div>
          </header>

          <AdvancedSearchModal open={advSearchOpen} onClose={() => setAdvSearchOpen(false)} />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)] items-start lg:items-stretch lg:flex-1 lg:min-h-0">
            {/* ── Left column: bounded at lg — steps 1–2 scroll (the cases pane
                flexes inside them); the Analyse section is pinned below and
                never scrolls away. */}
            <div className="min-w-0 lg:flex lg:flex-col lg:min-h-0">
              <div className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">

              {/* STEP 1 — choose a case (or upload) */}
              <StepLab n="1" title="Choose a case" note="or upload a document" />

              <div className="flex flex-wrap items-center gap-2.5 mb-3.5 shrink-0 lg:self-start">
                <div role="tablist" className="inline-flex items-center gap-[3px] rounded-xl border border-[#E5ECEB] bg-white p-1 shadow-sm">
                  {[
                    { key: 'case', label: 'My cases', icon: BriefcaseIcon },
                    { key: 'text', label: 'Upload document', icon: DocumentTextIcon },
                  ].map(({ key, label, icon: TabIcon }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={inputMode === key}
                      onClick={() => setInputMode(key)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-[9px] text-[length:calc(13px*var(--jnx-text-scale,1))] font-semibold transition-colors ${
                        inputMode === key
                          ? 'bg-[#0F1B21] text-white'
                          : 'text-[#64757C] hover:bg-[#EFF4F3] hover:text-[#25353C]'
                      }`}
                    >
                      <TabIcon className="h-[15px] w-[15px]" /> {label}
                    </button>
                  ))}
                </div>
                {/* Advanced Search popup trigger — direct Indian Kanoon search */}
                <div className="inline-flex rounded-xl border border-[#E5ECEB] bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setAdvSearchOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-[9px] text-[length:calc(13px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371] hover:bg-[#E9F9F5] transition-colors"
                  >
                    <MagnifyingGlassIcon className="h-[15px] w-[15px]" /> Advanced Search
                  </button>
                </div>
              </div>

              {inputMode === 'case' && (
                <div className="lg:flex lg:flex-col lg:flex-1">
                  {/* Search within the cases */}
                  {!casesLoading && cases.length > 0 && (
                    <div className="flex items-center gap-2.5 mb-3 shrink-0">
                      <div className="flex-1 flex items-center gap-2 bg-white border border-[#E5ECEB] rounded-[10px] px-[13px] transition-all focus-within:border-[#3FC8B4] focus-within:ring-[3px] focus-within:ring-[#3FC8B4]/15">
                        <MagnifyingGlassIcon className="h-[15px] w-[15px] shrink-0 text-[#93A2A7]" />
                        <input
                          value={caseFilter}
                          onChange={(e) => setCaseFilter(e.target.value)}
                          placeholder="Search by party name or case number…"
                          className="w-full bg-transparent border-0 outline-none py-[9px] text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#0F1B21] placeholder:text-[#93A2A7]"
                        />
                      </div>
                      <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-medium text-[#93A2A7] whitespace-nowrap">
                        {isFiltering
                          ? `${totalFiltered} match${totalFiltered === 1 ? '' : 'es'}`
                          : `Showing ${pageStart}–${pageEnd} of ${totalFiltered}`}
                      </span>
                    </div>
                  )}

                  {casesLoading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-[length:calc(14px*var(--jnx-text-scale,1))] text-[#64757C]">
                      <ArrowPathIcon className="h-4 w-4 animate-spin" /> Loading your cases…
                    </div>
                  )}
                  {!casesLoading && cases.length === 0 && (
                    <div className="rounded-[14px] border-[1.5px] border-dashed border-[#E5ECEB] bg-white px-4 py-8 text-center text-[length:calc(14px*var(--jnx-text-scale,1))] text-[#64757C]">
                      No cases found in your Projects. Upload case documents under Projects first,
                      or switch to "Upload document".
                    </div>
                  )}
                  {!casesLoading && cases.length > 0 && totalFiltered === 0 && (
                    <div className="rounded-[14px] border-[1.5px] border-dashed border-[#E5ECEB] bg-white px-4 py-8 text-center text-[length:calc(14px*var(--jnx-text-scale,1))] text-[#64757C]">
                      No case matches "{caseFilter.trim()}".
                    </div>
                  )}

                  {/* Only the cases scroll — the page itself never grows with them. */}
                  <div className="max-h-[400px] lg:max-h-none lg:flex-1 lg:min-h-44 overflow-y-auto min-w-0 p-1 -m-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {pagedCases.map((cs) => {
                      const active = selectedCaseId === cs.id;
                      const [petitioner, respondent] = partiesOf(cs);
                      const research = researchByCase[String(cs.id)];
                      const chip = research
                        ? (research.citationCount > 0
                          ? { cls: 'text-[#0E8371] bg-[#E9F9F5] border-[#BFE9DF]', text: `${research.citationCount} citation${research.citationCount === 1 ? '' : 's'}` }
                          : { cls: 'text-[#B97F24] bg-[#FCF5E7] border-[#F0E1C0]', text: 'Analysed only' })
                        : { cls: 'text-[#B97F24] bg-[#FCF5E7] border-[#F0E1C0]', text: 'No research yet' };
                      return (
                        <button
                          key={cs.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedCaseId(active ? null : cs.id)}
                          className={`relative text-left flex flex-col overflow-hidden rounded-[14px] border-[1.5px] bg-white transition-all duration-200 ${
                            active
                              ? 'border-[#3FC8B4] shadow-[0_0_0_3px_rgba(63,200,180,0.16),0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)]'
                              : 'border-[#E5ECEB] hover:border-[#BFE9DF] hover:shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)] hover:-translate-y-px'
                          }`}
                        >
                          <div className="flex-1 w-full px-4 pt-3.5 pb-3 min-w-0">
                            <div className="flex items-center gap-2 mb-2.5 min-w-0">
                              <span className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-semibold tracking-[0.07em] uppercase text-[#64757C] truncate">
                                {caseRefOf(cs)}
                              </span>
                              <span className={`ml-auto shrink-0 text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-semibold px-[9px] py-[3px] rounded-full border whitespace-nowrap ${chip.cls}`}>
                                {chip.text}
                              </span>
                            </div>
                            <div className="text-[length:calc(14.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.01em] leading-[1.35]">{petitioner}</div>
                            {respondent ? (
                              <>
                                <div className="text-[length:calc(11px*var(--jnx-text-scale,1))] italic text-[#93A2A7] my-[3px]">v.</div>
                                <div className="text-[length:calc(14.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.01em] leading-[1.35]">{respondent}</div>
                              </>
                            ) : (
                              <div className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7] mt-1">Respondent not yet on record</div>
                            )}
                          </div>
                          <div className="w-full flex items-center gap-2 px-4 py-[9px] border-t border-[#EFF4F3] bg-[#FCFDFD] text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                            <span className="truncate">{updatedLabel(cs.updated_at || cs.created_at)}</span>
                            <span className={`ml-auto h-[19px] w-[19px] shrink-0 rounded-full border-[1.5px] flex items-center justify-center transition-all duration-200 ${
                              active ? 'bg-[#0E8371] border-[#0E8371]' : 'bg-white border-[#E5ECEB]'
                            }`}>
                              <CheckIcon strokeWidth={3.4} className={`h-2.5 w-2.5 text-white transition-all duration-200 ${active ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    </div>
                  </div>

                  {/* Pagination */}
                  {totalFiltered > casesPerPage && (
                    <div className="mt-3 flex items-center gap-2 shrink-0">
                      <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7] mr-auto">
                        Showing {pageStart}–{pageEnd} of {totalFiltered} cases
                      </span>
                      <button
                        type="button"
                        aria-label="Previous page"
                        disabled={casesPage === 1}
                        onClick={() => setCasesPage((p) => Math.max(1, p - 1))}
                        className="h-[30px] w-[30px] rounded-[9px] border border-[#E5ECEB] bg-white text-[#64757C] flex items-center justify-center transition-colors hover:border-[#3FC8B4] hover:text-[#0E8371] hover:bg-[#E9F9F5] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E5ECEB] disabled:hover:text-[#64757C] disabled:hover:bg-white"
                      >
                        <ChevronLeftIcon strokeWidth={2.4} className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Next page"
                        disabled={casesPage * casesPerPage >= totalFiltered}
                        onClick={() => setCasesPage((p) => p + 1)}
                        className="h-[30px] w-[30px] rounded-[9px] border border-[#E5ECEB] bg-white text-[#64757C] flex items-center justify-center transition-colors hover:border-[#3FC8B4] hover:text-[#0E8371] hover:bg-[#E9F9F5] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E5ECEB] disabled:hover:text-[#64757C] disabled:hover:bg-white"
                      >
                        <ChevronLeftIcon strokeWidth={2.4} className="h-3.5 w-3.5 rotate-180" />
                      </button>
                    </div>
                  )}

                </div>
              )}

              {/* Upload tab: the documents ARE the case material — analysed
                  directly; the optional description steers the extraction. */}
              {inputMode === 'text' && (
                <div className="shrink-0">
                  <label className="block cursor-pointer rounded-[14px] border-[1.5px] border-dashed border-[#BFE9DF] bg-gradient-to-b from-[#F7FCFB] to-white px-6 py-9 text-center transition-colors hover:border-[#3FC8B4]">
                    <span className="mx-auto mb-[11px] h-11 w-11 rounded-xl bg-white border border-[#BFE9DF] shadow-sm flex items-center justify-center text-[#0E8371]">
                      <ArrowUpTrayIcon className="h-5 w-5" />
                    </span>
                    <strong className="block text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">
                      {files.length
                        ? `${files.length} document${files.length === 1 ? '' : 's'} ready — click to add more`
                        : 'Drop a petition, reply or order here'}
                    </strong>
                    <span className="block text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-[3px]">
                      {files.length
                        ? 'All documents are analysed together as one matter.'
                        : 'or click to browse — PDF, DOCX or TXT · select one or several'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      multiple
                      className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                    />
                  </label>
                  {files.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {files.map((f, idx) => (
                        <div key={`${f.name}|${f.size}`} className="flex items-center gap-2.5 rounded-[10px] border border-[#E5ECEB] bg-white px-3 py-2">
                          <DocumentTextIcon className="h-4 w-4 text-[#0E8371] shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#0F1B21]">{f.name}</span>
                          <span className="text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                          <button
                            type="button"
                            onClick={() => removeFile(idx)}
                            title="Remove this document"
                            className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-[#93A2A7] hover:text-[#C24444] hover:bg-[#FBEDED]"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Name shown in this tab's Recent research; blank = first file's name. */}
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    maxLength={200}
                    placeholder={files.length
                      ? `Research name (optional) — e.g. "${files[0].name.replace(/\.[^.]+$/, '')}"`
                      : 'Research name (optional) — how it appears under Recent research'}
                    className="mt-3 w-full bg-[#FBFDFC] border-[1.5px] border-[#E5ECEB] text-[#0F1B21] text-[length:calc(13px*var(--jnx-text-scale,1))] rounded-[11px] px-3.5 py-2.5 outline-none transition-all focus:border-[#3FC8B4] focus:bg-white focus:ring-[3px] focus:ring-[#3FC8B4]/15 placeholder:text-[#93A2A7]"
                  />
                  <div className="mt-3">
                    <label className="block text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold tracking-[0.06em] uppercase text-[#64757C] mb-[7px]">
                      Optional description — steers the analysis
                    </label>
                    <textarea
                      ref={caseTextRef}
                      value={caseText}
                      onChange={(e) => setCaseText(e.target.value)}
                      rows={3}
                      placeholder='e.g. "we act for the accused; seek regular bail" — the grounds and issues extracted from the documents follow this'
                      className="w-full resize-none overflow-hidden bg-[#FBFDFC] border-[1.5px] border-[#E5ECEB] text-[#0F1B21] rounded-[11px] px-3.5 py-3 text-[length:calc(13px*var(--jnx-text-scale,1))] leading-relaxed outline-none transition-all focus:border-[#3FC8B4] focus:bg-white focus:ring-[3px] focus:ring-[#3FC8B4]/15 placeholder:text-[#93A2A7]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2 — research options */}
              <div className="mt-7 shrink-0">
                <StepLab n="2" title="Research options" note="optional — leave off for a standard run" />
                <div className="space-y-2.5">

                  {/* Acting for: lock the client's side. Locked → grounds,
                      issues and queries are framed for that side and ONLY
                      that side's judgments surface. Auto = infer from the
                      case (existing behaviour). */}
                  <div className="rounded-[14px] border-[1.5px] border-[#E5ECEB] bg-white px-[17px] py-[13px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0">
                        <span className="block text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Acting for</span>
                        <span className="block text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                          {clientRole
                            ? `Only judgments favouring the ${clientRole} will be surfaced.`
                            : 'Auto — the system infers your side from the case papers.'}
                        </span>
                      </span>
                      <div className="ml-auto inline-flex items-center gap-[3px] rounded-xl border border-[#E5ECEB] bg-[#F8FAFC] p-1">
                        {[
                          { key: '', label: 'Auto' },
                          { key: 'petitioner', label: 'Petitioner' },
                          { key: 'respondent', label: 'Respondent' },
                        ].map(({ key, label }) => (
                          <button
                            key={key || 'auto'}
                            type="button"
                            onClick={() => setClientRole(key)}
                            aria-pressed={clientRole === key}
                            className={`px-3 py-1.5 rounded-[9px] text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold transition-colors ${
                              clientRole === key ? 'bg-[#0F1B21] text-white' : 'text-[#64757C] hover:bg-[#EFF4F3]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Fresh matter: nothing drafted yet — proposed grounds are
                      built from ALL case documents + the typed objective. */}
                  {inputMode === 'case' && (
                    <div className={`rounded-[14px] border-[1.5px] bg-white overflow-hidden transition-all ${
                      freshMode ? 'border-[#BFE9DF] shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)]' : 'border-[#E5ECEB]'
                    }`}>
                      <div className="flex items-start gap-[13px] px-[17px] py-[15px] cursor-pointer" onClick={toggleFresh}>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.01em]">
                              Fresh matter — nothing drafted or filed yet
                            </strong>
                            <span className="text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold uppercase tracking-[0.06em] text-[#B97F24] bg-[#FCF5E7] border border-[#F0E1C0] px-[7px] py-0.5 rounded-[5px]">
                              Objective required
                            </span>
                          </div>
                          <p className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-1 max-w-[66ch]">
                            The system reads all of this case's source documents and builds{' '}
                            <b className="font-semibold text-[#25353C]">proposed grounds</b> from what you want to achieve.
                          </p>
                        </div>
                        <Switch on={freshMode} label="Fresh matter" onToggle={toggleFresh} />
                      </div>
                      <div className={`grid grid-cols-1 transition-[grid-template-rows] duration-300 ${freshMode ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="px-[17px] pb-[17px]">
                            <label htmlFor="jnx-objective" className="block text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold tracking-[0.06em] uppercase text-[#64757C] mb-[7px]">
                              What are you trying to achieve?
                            </label>
                            <textarea
                              id="jnx-objective"
                              ref={caseTextRef}
                              value={caseText}
                              onChange={(e) => setCaseText(e.target.value)}
                              rows={3}
                              placeholder='e.g. "We act for the workmen; focus on the wage revision demand and seek reinstatement with back wages."'
                              className="w-full min-h-[96px] resize-none overflow-hidden bg-[#FBFDFC] border-[1.5px] border-[#E5ECEB] text-[#0F1B21] rounded-[11px] px-3.5 py-3 text-[length:calc(13px*var(--jnx-text-scale,1))] leading-relaxed outline-none transition-all focus:border-[#3FC8B4] focus:bg-white focus:ring-[3px] focus:ring-[#3FC8B4]/15 placeholder:text-[#93A2A7]"
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-[7px]">
                              <span className="text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7] mr-0.5">Quick start:</span>
                              {QUICK_FILLS.map((qf) => (
                                <button
                                  key={qf.label}
                                  type="button"
                                  onClick={() => { setCaseText(qf.text); caseTextRef.current?.focus(); }}
                                  className="border border-[#E5ECEB] bg-white text-[#64757C] text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-semibold px-[11px] py-[5px] rounded-full transition-colors hover:border-[#3FC8B4] hover:text-[#0E8371] hover:bg-[#E9F9F5]"
                                >
                                  {qf.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Advanced search: opt-in Boolean query generation — off by
                      default, the system uses its standard keyword queries. */}
                  <div className={`rounded-[14px] border-[1.5px] bg-white overflow-hidden transition-all ${
                    advancedSearch ? 'border-[#BFE9DF] shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)]' : 'border-[#E5ECEB]'
                  }`}>
                    <div className="flex items-start gap-[13px] px-[17px] py-[15px] cursor-pointer" onClick={() => setAdvancedSearch((v) => !v)}>
                      <div className="flex-1 min-w-0">
                        <strong className="text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.01em]">
                          Advanced search — Boolean queries
                        </strong>
                        <p className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-1 max-w-[66ch]">
                          Builds precision queries with{' '}
                          <code className="text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-mono font-semibold text-[#25353C] bg-[#EFF4F3] px-[5px] py-px rounded">AND</code> /{' '}
                          <code className="text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-mono font-semibold text-[#25353C] bg-[#EFF4F3] px-[5px] py-px rounded">OR</code>{' '}
                          operators and grouped synonyms. Leave off to use the standard keyword queries.
                        </p>
                      </div>
                      <Switch on={advancedSearch} label="Advanced search" onToggle={() => setAdvancedSearch((v) => !v)} />
                    </div>
                    <div className={`grid grid-cols-1 transition-[grid-template-rows] duration-300 ${advancedSearch ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden">
                        <div className="px-[17px] pb-[17px]">
                          <div className="block text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold tracking-[0.06em] uppercase text-[#64757C] mb-[7px]">
                            Example of what the system will send
                          </div>
                          <div className="bg-[#0F1B21] rounded-[11px] px-[15px] py-3 font-mono text-[length:calc(11.5px*var(--jnx-text-scale,1))] leading-[1.8] text-[#CBDDDC] overflow-x-auto whitespace-nowrap">
                            "quashing of FIR" <b className="text-[#5BDCC9] font-bold">AND</b> ("malafide" <b className="text-[#5BDCC9] font-bold">OR</b> "ulterior motive") <b className="text-[#5BDCC9] font-bold">AND</b> <span className="text-[#EFC27E]">section 482</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              </div>

              {/* STEP 3 — analyse (pinned at lg — does not scroll with the column) */}
              <div className="mt-6 shrink-0">
                <StepLab n="3" title="Analyse" note={runSub} />
                <button
                  type="button"
                  onClick={runAnalyze}
                  disabled={analyzing}
                  className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-[13px] text-[length:calc(14.5px*var(--jnx-text-scale,1))] font-bold tracking-[-0.01em] transition-all ${
                    analyzing
                      ? 'bg-[#E1E9E8] text-[#93A2A7] cursor-not-allowed'
                      : 'bg-gradient-to-b from-[#5BDCC9] to-[#3FC8B4] text-[#053B33] shadow-[0_10px_24px_-10px_rgba(63,200,180,0.8)] hover:-translate-y-px hover:shadow-[0_14px_30px_-11px_rgba(63,200,180,0.95)]'
                  }`}
                >
                  {analyzing
                    ? <ArrowPathIcon className="h-[17px] w-[17px] animate-spin" />
                    : <SparklesIcon className="h-[17px] w-[17px]" />}
                  {analyzing ? 'Analysing…' : 'Analyse case'}
                </button>
                <div className="text-center text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7] mt-2">
                  Runs in under a minute · results are <b className="font-semibold text-[#64757C]">saved to the case</b> so you can leave the page.
                </div>

                {/* Progress while the analysis runs */}
                {analyzing && (
                  <div ref={pipeRef} className="mt-3.5 rounded-[14px] border-[1.5px] border-[#BFE9DF] bg-white px-[19px] py-[17px] shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)]">
                    <div className="flex items-center mb-3">
                      <strong className="text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Analysing your case</strong>
                      <span className="ml-auto text-[length:calc(12px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">{pct}%</span>
                    </div>
                    <div className="h-[5px] rounded-full bg-[#EFF4F3] overflow-hidden mb-3.5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#0E8371] to-[#5BDCC9] transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {analyzeSteps.map((label, i) => {
                      const state = i < pipeStep ? 'done' : i === pipeStep ? 'active' : 'todo';
                      return (
                        <div
                          key={label}
                          className={`flex items-center gap-2.5 py-[5px] text-[length:calc(12.5px*var(--jnx-text-scale,1))] ${
                            state === 'active' ? 'text-[#0F1B21] font-semibold' : state === 'done' ? 'text-[#64757C]' : 'text-[#93A2A7]'
                          }`}
                        >
                          <span className={`h-[17px] w-[17px] shrink-0 rounded-full border-[1.5px] flex items-center justify-center ${
                            state === 'done'
                              ? 'bg-[#0E8371] border-[#0E8371]'
                              : state === 'active'
                                ? 'border-[#3FC8B4] border-r-transparent animate-spin'
                                : 'border-[#E5ECEB]'
                          }`}>
                            {state === 'done' && <CheckIcon strokeWidth={3.6} className="h-[9px] w-[9px] text-white" />}
                          </span>
                          <span className="flex-1 min-w-0 truncate">{label}</span>
                          {state === 'active' && <small className="ml-auto text-[length:calc(11px*var(--jnx-text-scale,1))] font-normal text-[#93A2A7]">running…</small>}
                          {state === 'done' && <small className="ml-auto text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7]">done</small>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right rail ── */}
            <aside className="flex flex-col gap-3.5 min-w-0 lg:min-h-0 lg:overflow-y-auto">
              {/* Recents — the research history for this tab */}
              <div className="rounded-[14px] border border-[#E5ECEB] bg-white p-2.5 shrink-0 lg:shrink lg:min-h-0 lg:flex lg:flex-col">
                <button
                  type="button"
                  onClick={() => setRecentsCollapsed((v) => !v)}
                  className="w-full shrink-0 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[length:calc(13px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] transition-colors hover:text-[#0F1B21] hover:bg-[#EFF4F3]"
                >
                  Recents
                  {inputMode === 'case' && selectedCaseId && (
                    <span className="px-1.5 py-px rounded-[5px] bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">this case</span>
                  )}
                  <ChevronRightIcon strokeWidth={2.4} className={`h-3.5 w-3.5 transition-transform ${recentsCollapsed ? '' : 'rotate-90'}`} />
                  {tabHistory.length > 0 && (
                    <span className="ml-auto text-[length:calc(11px*var(--jnx-text-scale,1))] font-medium text-[#93A2A7]">{tabHistory.length}</span>
                  )}
                </button>
                {!recentsCollapsed && (
                  <>
                    {historyLoading && (
                      <div className="px-2 py-2 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7]">Loading history…</div>
                    )}
                    {!historyLoading && tabHistory.length === 0 && (
                      <div className="px-2 py-2 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                        {inputMode === 'case'
                          ? (selectedCaseId
                            ? 'No research for this case yet — unselect it to see all history.'
                            : 'No research on your cases yet — it will appear here.')
                          : 'No research on uploaded documents yet — it will appear here.'}
                      </div>
                    )}
                    {!historyLoading && tabHistory.length > 0 && (
                      <div className="mt-0.5 space-y-px min-w-0 lg:min-h-0 lg:overflow-y-auto">
                        {tabHistory.map((entry) => <HistoryRow key={entry.sessionId} entry={entry} />)}
                      </div>
                    )}
                  </>
                )}
              </div>

            </aside>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: pick / add issues ───────────────────────────────────────────
  if (step === 'issues') {
    // Pleaded grounds keep their verbatim label; spotted issues are the
    // system's own; fresh mode proposes grounds from the objective.
    const pleadedItems = suggested.filter((i) => isGrounds || !!i.ground_label);
    const spottedItems = suggested.filter((i) => !isGrounds && !i.ground_label);
    const showFilter = pleadedItems.length > 0 && spottedItems.length > 0;
    const effFilter = showFilter ? issueFilter : 'all';
    const visibleItems = effFilter === 'pleaded' ? pleadedItems
      : effFilter === 'spotted' ? spottedItems : suggested;
    const ctxFull = analysis?.caseContext?.raw_case_summary || analysis?.caseContext?.facts || '';
    const pleadedWord = isFresh ? 'Proposed' : 'Grounds';

    const BADGES = {
      high: 'text-[#0E8371] bg-[#E9F9F5] border-[#BFE9DF]',
      medium: 'text-[#B97F24] bg-[#FCF5E7] border-[#F0E1C0]',
      low: 'text-[#991B1B] bg-[#FEF2F2] border-[#FECACA]',
      spotted: 'text-[#3D6FA8] bg-[#EDF3FA] border-[#CDDEF0]',
    };
    const warnPill = 'inline-flex items-center gap-1.5 text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold text-[#B97F24] bg-[#FCF5E7] border border-[#F0E1C0] px-2.5 py-1 rounded-full';

    const Tick = ({ on, size = 20, onToggle, label }) => (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`shrink-0 rounded-md border-[1.5px] flex items-center justify-center transition-all duration-150 ${
          on ? 'bg-[#0E8371] border-[#0E8371]' : 'bg-white border-[#E5ECEB] hover:border-[#3FC8B4]'
        }`}
        style={{ height: size, width: size }}
      >
        <CheckIcon
          strokeWidth={3.4}
          className={`text-white transition-all duration-150 ${on ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
          style={{ height: Math.round(size * 0.55), width: Math.round(size * 0.55) }}
        />
      </button>
    );

    const renderIssueCard = (issue) => {
      const active = selectedIds.has(issue.id);
      const isPleaded = isGrounds || !!issue.ground_label;
      const label = isPleaded
        ? `${issue.ground_label || `Ground ${issue.id}`} · ${pleadedWord}`
        : `Legal issue ${issue.id}`;
      const badgeKey = isPleaded ? (issue.confidence || null) : 'spotted';
      const badgeText = isPleaded ? issue.confidence : 'Spotted';
      // Legal issues lead with the full bold "Whether …?" question as
      // the heading; grounds keep their pleaded title.
      const heading = isPleaded ? (issue.title || issue.issue) : (issue.issue || issue.title);
      const desc = issue.explanation || '';
      const isLong = desc.length > 220;
      const expanded = !!expandedDesc[issue.id];
      const picks = picksFor(issue);
      return (
        <article
          key={issue.id}
          className={`bg-white border-[1.5px] rounded-[14px] flex flex-col overflow-hidden transition-all duration-200 hover:shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)] ${
            active ? 'border-[#BFE9DF]' : 'border-[#E5ECEB]'
          }`}
        >
          {/* Head — clicking the label/title (or the tick) toggles selection */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleIssue(issue.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleIssue(issue.id); }}
            className="flex items-start gap-[11px] px-[15px] pt-[13px] cursor-pointer"
          >
            <span className="mt-px">
              <Tick
                on={active}
                onToggle={() => toggleIssue(issue.id)}
                label={active ? 'Exclude from the search' : 'Include in the search'}
              />
            </span>
            <span className="flex-1 min-w-0 block">
              <span className="flex flex-wrap items-center gap-[7px] text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.09em] uppercase text-[#93A2A7] mb-0.5">
                {label}
                {badgeKey && (
                  <span className={`px-[7px] py-px rounded-[5px] border text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.05em] ${BADGES[badgeKey] || BADGES.medium}`}>
                    {badgeText}
                  </span>
                )}
              </span>
              <span className="block text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.012em] leading-[1.35]">
                {heading}
              </span>
            </span>
          </div>

          {/* Body: clamped description + Read more, statute chips, citations */}
          <div className="pl-[46px] pr-[15px] pt-2">
            {desc && (
              <>
                <p className={`text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64757C] leading-[1.55] ${expanded ? '' : 'line-clamp-3'}`}>{desc}</p>
                {isLong && (
                  <button
                    type="button"
                    onClick={() => setExpandedDesc((prev) => ({ ...prev, [issue.id]: !expanded }))}
                    className="text-[length:calc(11px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] mt-0.5 rounded-md hover:bg-[#E9F9F5] px-0.5"
                  >
                    {expanded ? 'Read less' : 'Read more'}
                  </button>
                )}
              </>
            )}
            {Array.isArray(issue.legal_framework) && issue.legal_framework.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {issue.legal_framework.map((law, li) => (
                  <span key={li} className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-semibold text-[#25353C] bg-[#EFF4F3] border border-[#E5ECEB] px-[9px] py-[2.5px] rounded-full">
                    {law}
                  </span>
                ))}
              </span>
            )}
            {Array.isArray(issue.case_law_cited) && issue.case_law_cited.length > 0 && (
              <span className="mt-1.5 block text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#64757C]">
                <span className="font-semibold">Case law cited:</span>{' '}
                <span className="italic">{issue.case_law_cited.join('; ')}</span>
              </span>
            )}
            {(issue.source || issue.ground_ref) && (
              <span className="mt-1.5 block text-[length:calc(10.5px*var(--jnx-text-scale,1))] text-[#93A2A7] truncate">
                {[issue.ground_ref, issue.source].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>

          {/* Queries — the checkbox panel is the contract for what runs */}
          {Array.isArray(issue.queries) && issue.queries.length > 0 && (
            <div className="mt-[11px] mb-[13px] ml-[46px] mr-[15px] bg-[#FBFDFC] border border-[#EFF4F3] rounded-[11px] overflow-hidden">
              <div className="flex items-center px-3 pt-2 pb-1.5">
                <span className="text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.09em] uppercase text-[#93A2A7]">Search queries</span>
                <span className="ml-auto text-[length:calc(10px*var(--jnx-text-scale,1))] text-[#93A2A7]">untick to exclude</span>
              </div>
              {issue.queries.map((q, qi) => {
                const checked = picks.selected.includes(q);
                return (
                  <div
                    key={qi}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); toggleQuery(issue, q); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') toggleQuery(issue, q); }}
                    title={checked ? 'Untick to exclude this query from the search' : 'Tick to include this query in the search'}
                    className="flex items-center gap-2 px-3 py-[5.5px] cursor-pointer transition-colors hover:bg-[#E9F9F5]"
                  >
                    <Tick on={checked} size={16} onToggle={() => toggleQuery(issue, q)} label={checked ? 'Exclude this query' : 'Include this query'} />
                    <span className={`flex-1 min-w-0 truncate text-[length:calc(11.5px*var(--jnx-text-scale,1))] ${checked ? 'text-[#25353C]' : 'text-[#93A2A7] line-through'}`}>
                      {q}
                    </span>
                  </div>
                );
              })}
              {/* The user's own queries — searched exactly like system anchors */}
              {picks.custom.map((q) => (
                <div key={`own-${q}`} className="flex items-center gap-2 px-3 py-[5.5px]">
                  <span className="h-4 w-4 shrink-0 rounded-[5px] bg-[#0E8371] flex items-center justify-center">
                    <CheckIcon strokeWidth={3.4} className="h-[9px] w-[9px] text-white" />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371]">{q}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeOwnQuery(issue, q); }}
                    title="Remove your query"
                    className="shrink-0 text-[#93A2A7] hover:text-[#C24444]"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {/* + add your own query for THIS issue */}
              <div className="flex items-center gap-2 px-3 py-[7px]" onClick={(e) => e.stopPropagation()}>
                <PlusIcon className="h-[13px] w-[13px] shrink-0 text-[#93A2A7]" />
                <input
                  value={queryDrafts[issue.id] || ''}
                  onChange={(e) => setQueryDrafts((prev) => ({ ...prev, [issue.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwnQuery(issue); } }}
                  placeholder='Add your own query, e.g. "mala fide intention" quash FIR'
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#0F1B21] placeholder:text-[#93A2A7]"
                />
                <button
                  type="button"
                  onClick={() => addOwnQuery(issue)}
                  className="shrink-0 text-[length:calc(11px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#3FC8B4]/15"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </article>
      );
    };

    return (
      <div data-jnx-citation className="min-h-full bg-[#F6F9F8] px-4 pt-5 pb-5 sm:px-6 md:px-7 overflow-x-clip lg:h-full lg:overflow-hidden">
        <div className="max-w-[1380px] mx-auto w-full min-w-0 flex flex-col gap-3 lg:h-full lg:min-h-0">

          {/* Header row */}
          <header className="flex items-center gap-3 shrink-0 min-w-0">
            <div className="h-[38px] w-[38px] shrink-0 rounded-[11px] bg-gradient-to-br from-[#E9F9F5] to-[#D9F4EE] border border-[#BFE9DF] flex items-center justify-center text-[#0E8371]">
              <SparklesIcon className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[length:calc(18px*var(--jnx-text-scale,1))] font-extrabold tracking-[-0.02em] text-[#0F1B21] leading-tight">What should we research?</h1>
              <p className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-px truncate">
                {isGrounds
                  ? 'These are the grounds pleaded in the filing — pick the ones you need judgments for, or add your own.'
                  : isCombined
                    ? 'Pleaded grounds and system-spotted issues, combined — pick what you need judgments for, or add your own.'
                    : isFresh
                      ? 'Proposed grounds built from your objective — pick what you need judgments for, or add your own.'
                      : 'Pick the issues you need authority for, or describe it yourself.'}
              </p>
            </div>
            <button
              onClick={runAnalyze}
              disabled={analyzing}
              className="ml-auto shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold border border-[#E5ECEB] bg-white text-[#64757C] shadow-sm transition-colors hover:border-[#BFE9DF] hover:text-[#0E8371] disabled:opacity-60"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin' : ''}`} />
              Re-analyse
            </button>
          </header>

          {/* Context banner + extraction stats, side by side */}
          {(ctxFull || ((isGrounds || isCombined || isFresh) && groundsMeta)) && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 shrink-0">
              {ctxFull && (
                <div className="min-w-0 flex items-start gap-[11px] rounded-[14px] border border-[#BFE9DF] bg-gradient-to-b from-[#F6FDFB] to-white px-[15px] py-[11px]">
                  <ScaleIcon className="h-4 w-4 mt-0.5 shrink-0 text-[#0E8371]" />
                  <p className={`min-w-0 flex-1 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64757C] leading-[1.55] ${ctxExpanded ? '' : 'line-clamp-2'}`}>
                    {analysis?.caseTitle && (
                      <>
                        <b className="font-bold text-[#0F1B21]">{analysis.caseTitle}</b>
                        {' — '}
                      </>
                    )}
                    {ctxFull}
                  </p>
                  {ctxFull.length > 160 && (
                    <button
                      type="button"
                      onClick={() => setCtxExpanded((v) => !v)}
                      className="shrink-0 self-end text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#E9F9F5]"
                    >
                      {ctxExpanded ? 'Less' : 'More'}
                    </button>
                  )}
                </div>
              )}
              {(isGrounds || isCombined || isFresh) && groundsMeta && (
                <div className="min-w-0 flex items-center rounded-[14px] border border-[#E5ECEB] bg-white px-[15px] py-[11px]">
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-semibold tracking-[0.08em] uppercase text-[#93A2A7] whitespace-nowrap">
                      {isFresh ? 'Proposed grounds' : 'Grounds'}
                    </div>
                    <div className="text-[length:calc(17px*var(--jnx-text-scale,1))] font-extrabold text-[#0F1B21] leading-tight">{groundsMeta.totalGrounds ?? suggested.length}</div>
                  </div>
                  {groundsMeta.spottedIssues != null && (
                    <div className="flex-1 min-w-0 px-3 border-l border-[#EFF4F3]">
                      <div className="text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-semibold tracking-[0.08em] uppercase text-[#93A2A7] whitespace-nowrap">Spotted issues</div>
                      <div className="text-[length:calc(17px*var(--jnx-text-scale,1))] font-extrabold text-[#0F1B21] leading-tight">{groundsMeta.spottedIssues}</div>
                    </div>
                  )}
                  {groundsMeta.documentType && (
                    <div className="flex-1 min-w-0 px-3 border-l border-[#EFF4F3]">
                      <div className="text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-semibold tracking-[0.08em] uppercase text-[#93A2A7] whitespace-nowrap">Document</div>
                      <div className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-extrabold text-[#0F1B21] truncate">{groundsMeta.documentType}</div>
                    </div>
                  )}
                  {groundsMeta.party && (
                    <div className="flex-1 min-w-0 pl-3 border-l border-[#EFF4F3]">
                      <div className="text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-semibold tracking-[0.08em] uppercase text-[#93A2A7] whitespace-nowrap">Acting for</div>
                      <div className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-extrabold text-[#0F1B21] truncate">{groundsMeta.party}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {analysis?.needsClarification && (
            <div className="shrink-0 rounded-[11px] border border-[#F0E1C0] bg-[#FCF5E7] px-3.5 py-2 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#B97F24]">
              {analysis.clarificationQuestion} — add detail via Re-analyse, or type your own search below and run anyway.
            </div>
          )}

          {/* Toolbar: heading + counts + kind filter + cap warnings + clear */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0 min-w-0">
            <h2 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.01em]">
              {isGrounds ? 'Grounds of the case' : isCombined ? 'Grounds & issues' : isFresh ? 'Proposed grounds' : 'Legal issues'}
            </h2>
            <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-medium text-[#93A2A7]">
              <b className="font-bold text-[#0E8371]">{selectedIds.size}</b> of {suggested.length} selected
            </span>
            {showFilter && (
              <div role="tablist" className="inline-flex items-center gap-0.5 rounded-[10px] border border-[#E5ECEB] bg-white p-[3px] shadow-sm ml-1.5">
                {[
                  { key: 'all', label: 'All', count: suggested.length },
                  { key: 'pleaded', label: pleadedWord, count: pleadedItems.length },
                  { key: 'spotted', label: 'Legal issues', count: spottedItems.length },
                ].map(({ key, label, count }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={effFilter === key}
                    onClick={() => setIssueFilter(key)}
                    className={`flex items-center gap-1.5 px-3 py-[5.5px] rounded-[7px] text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold transition-colors ${
                      effFilter === key ? 'bg-[#0F1B21] text-white' : 'text-[#64757C] hover:bg-[#EFF4F3]'
                    }`}
                  >
                    {label}
                    <em className={`not-italic text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold px-1.5 py-px rounded-full ${
                      effFilter === key ? 'bg-white/20 text-white' : 'bg-[#EFF4F3] text-[#64757C]'
                    }`}>{count}</em>
                  </button>
                ))}
              </div>
            )}
            {groundsMeta?.truncatedGrounds > 0 && (
              <span className={warnPill}>
                ⚠ {groundsMeta.truncatedGrounds} further ground{groundsMeta.truncatedGrounds === 1 ? '' : 's'} beyond the cap not shown
              </span>
            )}
            {(groundsMeta?.notes || []).map((note, ni) => (
              <span key={ni} className={warnPill}>⚠ {note}</span>
            ))}
            <span className="flex-1" />
            {selectedIds.size > 0 ? (
              <button onClick={clearAllIssues} className="shrink-0 text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] px-2 py-1 rounded-lg transition-colors hover:text-[#C24444] hover:bg-[#FBEDED]">
                Clear all
              </button>
            ) : (
              <button onClick={selectAllIssues} className="shrink-0 text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371] px-2 py-1 rounded-lg transition-colors hover:bg-[#E9F9F5]">
                Select all
              </button>
            )}
          </div>

          {/* Court scope — Advanced search: the three court boxes. The run's
              IK queries carry doctypes: for exactly the ticked courts;
              nothing ticked = default coverage (SC + High Courts + tribunals). */}
          <div className="shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => setScopeSupreme((v) => !v)}
                aria-pressed={scopeSupreme}
                className={`text-left rounded-[13px] border-[1.5px] px-[13px] py-[11px] transition-colors ${
                  scopeSupreme ? 'border-[#3FC8B4] bg-[#F6FDFB]' : 'border-[#E5ECEB] bg-white hover:border-[#BFE9DF]'
                }`}
              >
                <span className="flex items-start gap-2.5">
                  <span className={`mt-px h-5 w-5 shrink-0 rounded-md border-[1.5px] flex items-center justify-center transition-colors ${
                    scopeSupreme ? 'bg-[#0E8371] border-[#0E8371]' : 'bg-white border-[#D8E1E0]'
                  }`}>
                    {scopeSupreme && <CheckIcon strokeWidth={3.4} className="h-[11px] w-[11px] text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Supreme Court</span>
                    <span className="block text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] leading-snug">Judgments of the Supreme Court of India</span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeCaseCourt((v) => !v)}
                aria-pressed={scopeCaseCourt}
                className={`text-left rounded-[13px] border-[1.5px] px-[13px] py-[11px] transition-colors ${
                  scopeCaseCourt ? 'border-[#3FC8B4] bg-[#F6FDFB]' : 'border-[#E5ECEB] bg-white hover:border-[#BFE9DF]'
                }`}
              >
                <span className="flex items-start gap-2.5">
                  <span className={`mt-px h-5 w-5 shrink-0 rounded-md border-[1.5px] flex items-center justify-center transition-colors ${
                    scopeCaseCourt ? 'bg-[#0E8371] border-[#0E8371]' : 'bg-white border-[#D8E1E0]'
                  }`}>
                    {scopeCaseCourt && <CheckIcon strokeWidth={3.4} className="h-[11px] w-[11px] text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">This case&apos;s court</span>
                    <span className="block text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] leading-snug truncate">
                      {analysis?.caseContext?.forum || 'The High Court applicable to this case (all High Courts when undetectable)'}
                    </span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setCourtsOpen((v) => !v)}
                aria-expanded={courtsOpen}
                className={`text-left rounded-[13px] border-[1.5px] px-[13px] py-[11px] transition-colors ${
                  scopeCourts.size > 0 ? 'border-[#3FC8B4] bg-[#F6FDFB]' : 'border-[#E5ECEB] bg-white hover:border-[#BFE9DF]'
                }`}
              >
                <span className="flex items-start gap-2.5">
                  <span className="mt-px h-5 w-5 shrink-0 rounded-md bg-[#EFF4F3] flex items-center justify-center">
                    <ChevronRightIcon className={`h-[13px] w-[13px] text-[#64757C] transition-transform ${courtsOpen ? 'rotate-90' : ''}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">
                      Choose courts
                      {scopeCourts.size > 0 && (
                        <em className="not-italic ml-1.5 px-1.5 py-px rounded-full bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">{scopeCourts.size}</em>
                      )}
                    </span>
                    <span className="block text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] leading-snug">Pick any High Courts, district courts or tribunals</span>
                  </span>
                </span>
              </button>

              {/* 4 — date range: rides on every query as fromdate:/todate: */}
              <div className={`rounded-[13px] border-[1.5px] px-[13px] py-[9px] transition-colors ${
                (scopeFromDate || scopeToDate) ? 'border-[#3FC8B4] bg-[#F6FDFB]' : 'border-[#E5ECEB] bg-white'
              }`}>
                <span className="flex items-center justify-between mb-1">
                  <span className="text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Date range</span>
                  {(scopeFromDate || scopeToDate) && (
                    <button
                      type="button"
                      onClick={() => { setScopeFromDate(''); setScopeToDate(''); }}
                      className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#3FC8B4]/15"
                    >
                      Clear
                    </button>
                  )}
                </span>
                <span className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: scopeFromDate, set: setScopeFromDate, label: 'From' },
                    { value: scopeToDate, set: setScopeToDate, label: 'To' },
                  ].map(({ value, set, label }) => (
                    <label key={label} className="block">
                      <span className="block mb-0.5 text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.07em] uppercase text-[#93A2A7]">{label}</span>
                      <input
                        type="date"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="w-full bg-white border border-[#E5ECEB] rounded-[8px] px-2 py-1 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#0F1B21] outline-none focus:border-[#3FC8B4]"
                      />
                    </label>
                  ))}
                </span>
              </div>
            </div>

            {courtsOpen && (
              <div className="mt-2 rounded-[13px] border border-[#E5ECEB] bg-white px-4 py-2.5 max-h-[300px] overflow-y-auto">
                {COURT_SCOPE_GROUPS.map((cat) => {
                  const allOn = cat.options.every(([v]) => scopeCourts.has(v));
                  return (
                    <div key={cat.key} className="py-2 border-b border-[#EFF4F3] last:border-b-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.07em] uppercase text-[#64757C]">{cat.label}</span>
                        <button
                          type="button"
                          onClick={() => setScopeCourts((prev) => {
                            const next = new Set(prev);
                            cat.options.forEach(([v]) => { if (allOn) next.delete(v); else next.add(v); });
                            return next;
                          })}
                          className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#E9F9F5]"
                        >
                          {allOn ? 'Uncheck all' : 'Check all'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-1">
                        {cat.options.map(([value, label]) => (
                          <label key={value} className="flex items-center gap-2 cursor-pointer rounded-md px-1.5 py-1 hover:bg-[#F8FAFC]">
                            <input
                              type="checkbox"
                              checked={scopeCourts.has(value)}
                              onChange={() => setScopeCourts((prev) => {
                                const next = new Set(prev);
                                if (next.has(value)) next.delete(value); else next.add(value);
                                return next;
                              })}
                              className="h-3.5 w-3.5 rounded accent-[#0E8371]"
                            />
                            <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#475569] truncate">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Board — the only scrolling region at lg */}
          <div className="grid grid-cols-1 md:grid-cols-2 auto-rows-max gap-3 content-start min-w-0 lg:flex-1 lg:min-h-0 lg:overflow-y-auto p-1 -m-1">
            {suggested.length === 0 && customIssues.length === 0 && (
              <div className="md:col-span-2 rounded-[14px] border-[1.5px] border-dashed border-[#E5ECEB] bg-white px-4 py-8 text-center text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                {isGrounds ? 'No pleaded grounds were found — add your own below.'
                  : isCombined ? 'No grounds or issues were found — add your own below.'
                    : isFresh ? 'No grounds could be proposed — describe your objective more precisely and re-analyse.'
                      : 'No issues were suggested — add your own below.'}
              </div>
            )}
            {visibleItems.map(renderIssueCard)}
            {/* Searches the user typed that fell back to the legacy path —
                analysed live when the search runs. */}
            {customIssues.map((text, idx) => (
              <article key={`custom-${idx}`} className="bg-white border-[1.5px] border-[#BFE9DF] rounded-[14px] px-[15px] py-[13px]">
                <div className="flex items-start gap-[11px]">
                  <span className="mt-px h-5 w-5 shrink-0 rounded-md bg-[#0E8371] flex items-center justify-center">
                    <CheckIcon strokeWidth={3.4} className="h-[11px] w-[11px] text-white" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-[7px] text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.09em] uppercase text-[#93A2A7] mb-0.5">
                      Custom · Added by you
                      <span className={`px-[7px] py-px rounded-[5px] border text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold tracking-[0.05em] ${BADGES.spotted}`}>Custom</span>
                    </span>
                    <span className="block text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] tracking-[-0.012em] leading-[1.35]">{text}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustomIssues((prev) => prev.filter((_, i) => i !== idx))}
                    title="Remove this search"
                    className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-[#93A2A7] hover:text-[#C24444] hover:bg-[#FBEDED]"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>

          {/* Pinned action bar: composer + Start over + Run search.
              (The AI Help pill lifts above action bars via .jnx-assistant-fab
              in index.css.) */}
          <div data-jnx-actionbar className="shrink-0 sticky bottom-0 lg:static z-30 -mx-4 sm:-mx-6 md:mx-0">
            <div className="flex flex-wrap items-center gap-2.5 border-t border-[#E5ECEB] bg-white/95 backdrop-blur px-3.5 py-3 sm:px-4 md:rounded-2xl md:border md:bg-white md:shadow-[0_2px_5px_rgba(15,27,33,0.04),0_10px_24px_-12px_rgba(15,27,33,0.12)]">
              <button
                onClick={resetAll}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-[10px] text-[length:calc(12.5px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] transition-colors hover:bg-[#EFF4F3] hover:text-[#25353C]"
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" /> Start over
              </button>
              {/* Chat-style composer: one line tall, grows to ~3 lines, then
                  scrolls internally. */}
              <div className="flex-1 min-w-[200px] flex items-end gap-2 bg-[#FBFDFC] border-[1.5px] border-[#E5ECEB] rounded-[11px] px-3 transition-all focus-within:border-[#3FC8B4] focus-within:bg-white focus-within:ring-[3px] focus-within:ring-[#3FC8B4]/15">
                <MagnifyingGlassIcon className="h-[15px] w-[15px] shrink-0 text-[#93A2A7] mb-[11px]" />
                <textarea
                  ref={customDraftRef}
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCustomIssue(); }
                  }}
                  rows={1}
                  placeholder="Search in your own words — e.g. Whether bail may be granted pending appeal under Article 136"
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none resize-none overflow-y-auto py-[9px] text-[length:calc(12.5px*var(--jnx-text-scale,1))] leading-relaxed text-[#0F1B21] placeholder:text-[#93A2A7]"
                />
              </div>
              <button
                onClick={addCustomIssue}
                disabled={!customDraft.trim() || addingIssue}
                title="Add this search — it gets its own card and queries, like the suggested ones"
                className="shrink-0 flex items-center gap-1.5 px-3.5 py-[9px] rounded-[11px] text-[length:calc(12.5px*var(--jnx-text-scale,1))] font-bold border border-[#E5ECEB] bg-white text-[#25353C] transition-colors hover:border-[#3FC8B4] hover:text-[#0E8371] hover:bg-[#E9F9F5] disabled:opacity-50"
              >
                {addingIssue
                  ? (<><ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> Analysing…</>)
                  : (<><PlusIcon className="h-3.5 w-3.5" /> Add</>)}
              </button>
              <button
                onClick={runSearch}
                disabled={searching || totalSelected === 0}
                className="shrink-0 flex items-center gap-2 px-[22px] py-[10px] rounded-xl text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-bold tracking-[-0.01em] transition-all bg-gradient-to-b from-[#5BDCC9] to-[#3FC8B4] text-[#053B33] shadow-[0_8px_18px_-8px_rgba(63,200,180,0.8)] hover:-translate-y-px disabled:bg-none disabled:bg-[#E1E9E8] disabled:text-[#93A2A7] disabled:shadow-none disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {searching ? <ArrowPathIcon className="h-[15px] w-[15px] animate-spin" /> : <MagnifyingGlassIcon className="h-[15px] w-[15px]" />}
                {searching ? 'Searching…' : `Run search (${totalSelected})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 3: citation review (list + Report/Document detail) ─────────────
  return (
    <CitationReviewResults
      searchResponse={searchResponse}
      caseContext={analysis?.caseContext}
      caseTitle={analysis?.caseTitle}
      researchMode={analysis?.researchMode || 'issues'}
      onEditIssues={() => setStep('issues')}
      onReset={resetAll}
    />
  );
}
