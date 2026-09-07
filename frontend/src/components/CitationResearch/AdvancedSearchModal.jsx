import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CalendarDaysIcon,
  CircleStackIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import DOMPurify from 'dompurify';
import judgementApi from '../../services/judgementApi';

// Document Types live in ikDoctypes.js (shared with the issues-step court
// scope) — IK's own /advsearch categories, tokens and labels.
import DOCTYPE_CATEGORIES from './ikDoctypes';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'mostrecent', label: 'Most Recent' },
  { value: 'leastrecent', label: 'Least Recent' },
];

const EMPTY_FIELDS = { query: '', title: '', cite: '', author: '', bench: '' };

const CRITERIA_FIELDS = [
  { key: 'query', label: 'Document or Title or Citation', placeholder: 'Enter keywords, title, or citation' },
  { key: 'title', label: 'Title Only', placeholder: 'Search within document titles only' },
  { key: 'cite', label: 'Citation Number', placeholder: 'e.g., 2009 SCR 123' },
  { key: 'author', label: 'Author/Judge', placeholder: 'Judge name or author' },
  { key: 'bench', label: 'Court/Bench', placeholder: 'Judge on the bench' },
];

// "2009-05-12" (IK publishdate) → "12 May 2009"; anything else unchanged.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1] || m[2]} ${m[1]}`;
};

const inputCls = 'w-full bg-white border border-[#E5ECEB] rounded-[10px] px-[13px] py-[9px] text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#0F1B21] placeholder:text-[#93A2A7] outline-none transition-all focus:border-[#3FC8B4] focus:ring-[3px] focus:ring-[#3FC8B4]/15';
const labelCls = 'block mb-1.5 text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#25353C]';

// Indian Kanoon's own doc HTML, sanitized; relative IK links (e.g. /doc/123/)
// made absolute AFTER sanitization so they open on indiankanoon.org instead
// of dead-ending on our origin.
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanDocHtml = (html) => DOMPurify
  .sanitize(html || '', { USE_PROFILES: { html: true } })
  .replaceAll('href="/', 'target="_blank" rel="noreferrer" href="https://indiankanoon.org/');

// A matched-paragraph fragment from the service: <mark> is the only tag it
// is allowed to carry, so the judgment's own text can never inject markup.
const cleanFragment = (html) => DOMPurify.sanitize(html || '', {
  ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [],
});

// Highlight every occurrence of the searched words inside the rendered
// judgment, so the paragraph a result was fetched on is visible in the doc
// itself. Walks text nodes (never re-parses HTML) and returns the count.
const markMatches = (root, needles) => {
  if (!root || needles.length === 0) return 0;
  const rx = new RegExp(`(${needles.map(escapeRx).join('|')})`, 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && !n.parentElement?.closest('mark.adv-hit')
        && rx.test(n.nodeValue)) targets.push(n);
    rx.lastIndex = 0;
  }
  let count = 0;
  targets.forEach((node) => {
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = node.nodeValue;
    for (let m = rx.exec(text); m; m = rx.exec(text)) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'adv-hit';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      count += 1;
    }
    rx.lastIndex = 0;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  });
  return count;
};

// The words to highlight: quoted phrases verbatim, then the bare words —
// the same grammar the library engine matched on.
const highlightTerms = (query) => {
  const text = String(query || '');
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  const rest = text.replace(/"[^"]*"/g, ' ').split(/\s+/)
    .map((w) => w.trim()).filter((w) => w.length > 2);
  return [...new Set([...phrases, ...rest])].filter(Boolean).slice(0, 12);
};

// Typography for the rendered judgment — mirrors IK's doc page (justified
// serif paragraphs, bordered monospace block for pre-formatted orders).
const HIT_CSS = `
.adv-hit-text mark, .adv-ik-doc mark.adv-hit { background: #FDF0A8; color: inherit; border-radius: 3px; padding: 0 1px; }
.adv-ik-doc mark.adv-hit.adv-hit-first { background: #FBD44C; box-shadow: 0 0 0 2px rgba(251,212,76,0.35); }
`;

const DOC_CSS = `
.adv-ik-doc { font-family: Georgia, 'Times New Roman', serif; color: #1F2937; font-size: calc(15px * var(--jnx-text-scale, 1)); line-height: 1.85; }
.adv-ik-doc p { margin: 0 0 1em; text-align: justify; }
.adv-ik-doc pre { font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size: calc(12.5px * var(--jnx-text-scale, 1)); line-height: 1.6; white-space: pre-wrap; word-break: break-word; background: #FDFDFC; border: 1px solid #E5ECEB; border-radius: 10px; padding: 14px 16px; margin: 0 0 1em; overflow-x: auto; }
.adv-ik-doc h1, .adv-ik-doc h2, .adv-ik-doc h3 { text-align: center; font-weight: 700; margin: 1.1em 0 0.6em; font-size: 1.05em; }
.adv-ik-doc blockquote { margin: 0 0 1em 22px; }
.adv-ik-doc a { color: #0E8371; text-decoration: underline; }
.adv-ik-doc table { border-collapse: collapse; margin: 0 0 1em; }
.adv-ik-doc td, .adv-ik-doc th { border: 1px solid #E5ECEB; padding: 4px 8px; }
`;

/** Collapsible doctype category checklists — shared by the criteria page
 *  (wide grid) and the results-page filter rail (single column). */
function DoctypeFilter({ doctypes, onToggle, onToggleAll, openCats, onToggleOpen, compact }) {
  return (
    <div className="divide-y divide-[#EFF4F3]">
      {DOCTYPE_CATEGORIES.map((cat) => {
        const selectedInCat = cat.options.filter(([v]) => doctypes.has(v)).length;
        const allOn = selectedInCat === cat.options.length;
        const isOpen = openCats.has(cat.key);
        return (
          <div key={cat.key} className="py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleOpen(cat.key)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left group"
                aria-expanded={isOpen}
              >
                <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-[#93A2A7] transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                <span className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] font-semibold text-[#25353C] group-hover:text-[#0E8371] truncate">{cat.label}</span>
                {selectedInCat > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">{selectedInCat}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onToggleAll(cat)}
                className="shrink-0 text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md border border-[#E5ECEB] hover:border-[#BFE9DF] hover:bg-[#F6FDFB] transition-colors whitespace-nowrap"
              >
                {allOn ? 'Uncheck All' : 'Check All'}
              </button>
            </div>
            {isOpen && (
              <div className={`mt-2 ml-5 grid gap-x-3 gap-y-1 ${compact ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
                {cat.options.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer rounded-md px-1.5 py-1 hover:bg-[#F8FAFC]">
                    <input
                      type="checkbox"
                      checked={doctypes.has(value)}
                      onChange={() => onToggle(value)}
                      className="h-3.5 w-3.5 rounded accent-[#0E8371]"
                    />
                    <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#475569] truncate">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Browser-console provenance: which judgments came back and where each one
// was actually served from (the local Elasticsearch library, a cache, or a
// billed Indian Kanoon call — the service reports it in `servedFrom`).
const logResults = (label, data) => {
  const rows = data.results || [];
  const from = data.servedFrom || (data.source === 'local_library'
    ? 'your library — Elasticsearch (free)' : 'Indian Kanoon');
  console.groupCollapsed(
    `%c[Advanced Search]%c ${label} — ${rows.length} judgment(s) from ${from}`,
    'color:#0E8371;font-weight:700', 'color:inherit',
  );
  console.info(`Query: ${data.formInput || '(none)'}`);
  console.info(`Source: ${from}${data.mode ? ` · engine: ${data.mode}` : ''}`);
  if (rows.length === 0) {
    console.warn('NOT FOUND — nothing matched these criteria.');
  } else {
    console.table(rows.map((r) => ({
      docId: r.docId,
      title: r.title,
      court: r.court,
      date: r.date,
      from: r.fromLibrary ? 'library (Elasticsearch)' : 'Indian Kanoon',
    })));
  }
  console.groupEnd();
};

const logDoc = (docId, data) => {
  const from = data.servedFrom || (data.source === 'local_library'
    ? 'your library — Elasticsearch (free)' : 'Indian Kanoon');
  console.info(
    `%c[Advanced Search]%c judgment ${docId} fetched from ${from} — `
    + `"${data.title || 'untitled'}"`,
    'color:#0E8371;font-weight:700', 'color:inherit',
  );
};

/**
 * Advanced Search popup — a direct Indian Kanoon search with the user's own
 * criteria, mirroring IK's /advsearch form. Two pages inside the popup, like
 * Indian Kanoon itself: the criteria form, then a results page with the
 * court/document filters + sort + dates in a left rail. Rail changes re-run
 * the search automatically (debounced). Results come back exactly as IK
 * ranks them, 10 per page.
 */
export default function AdvancedSearchModal({ open, onClose }) {
  const [view, setView] = useState('form'); // form | results | doc
  // Search source: 'ik' = Indian Kanoon (billed) | 'local' = the
  // Elasticsearch library of every judgment already fetched (free).
  const [source, setSource] = useState('ik');
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [sortby, setSortby] = useState('relevance');
  const [fromdate, setFromdate] = useState(''); // yyyy-mm-dd (native date input)
  const [todate, setTodate] = useState('');
  const [doctypes, setDoctypes] = useState(new Set());
  const [openCats, setOpenCats] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [resp, setResp] = useState(null);
  const [error, setError] = useState('');
  // In-app document view (like Indian Kanoon's doc page).
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState('');
  // The open judgment's origin — labels and the "not found" copy differ, and
  // a library document must never fall back to a billed Indian Kanoon fetch.
  const [docFromLibrary, setDocFromLibrary] = useState(false);
  // Pagination re-runs the criteria as SUBMITTED, not as currently edited.
  const submittedRef = useRef(null);
  const listRef = useRef(null);
  const docRef = useRef(null);
  const docBodyRef = useRef(null);
  // Search-within-results: the query as FIRST submitted, plus the extra
  // keywords added on top of it. Every refinement is ANDed into the query
  // and the search re-runs — the same thing Indian Kanoon's "Search Within
  // Results" does — so refining narrows the set instead of replacing it.
  const baseQueryRef = useRef('');
  const [refinements, setRefinements] = useState([]);
  const [refineText, setRefineText] = useState('');
  // How many times the searched words appear in the open judgment.
  const [docHits, setDocHits] = useState(0);

  const hasCriteria = useMemo(
    () => Object.values(fields).some((v) => v.trim())
      || doctypes.size > 0 || fromdate || todate,
    [fields, doctypes, fromdate, todate],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // One canonical criteria shape — used for the request, for pagination and
  // for the changed-since-submit comparison (doctypes sorted so Set insertion
  // order never fakes a difference).
  const buildCriteria = () => ({
    ...fields,
    doctypes: [...doctypes].sort().join(','),
    fromdate,
    todate,
    sortby,
    source,
  });

  const runSearch = async (pagenum = 0, criteria = null) => {
    const params = criteria || buildCriteria();
    if (!criteria && !hasCriteria) {
      toast.info('Fill in at least one search field first');
      return;
    }
    if (!criteria) {
      // Submitted from the criteria form — this query is the new baseline.
      baseQueryRef.current = params.query || '';
      setRefinements([]);
      setRefineText('');
    }
    setSearching(true);
    setError('');
    try {
      const call = params.source === 'local' ? judgementApi.localSearch : judgementApi.advancedSearch;
      const data = await call({ ...params, pagenum });
      logResults(`page ${(data.pagenum || 0) + 1}`, data);
      if (data.cost && params.source !== 'local') {
        // Complete costing for the Advanced Search module — the service
        // console prints the same bill as a [cost] table per request.
        console.info(
          `[Advanced Search · Indian Kanoon cost] page ${(data.pagenum || 0) + 1} — "${data.formInput}"\n`
          + `  Billed searches: ${data.cost.billedSearches} × ₹${data.cost.ratePerSearchInr.toFixed(2)}\n`
          + `  Cache hits (free): ${data.cost.cachedHits}\n`
          + `  TOTAL: ₹${data.cost.totalInr.toFixed(2)}`,
        );
      }
      submittedRef.current = params;
      setResp(data);
      setView('results');
      listRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Results-page rail behaves like Indian Kanoon's sidebar: changing a court/
  // document filter, the sort order or the dates re-runs the search from page
  // 0 automatically. Debounced so ticking several courts sends ONE request.
  useEffect(() => {
    if (view !== 'results' || !resp || searching) return undefined;
    const current = buildCriteria();
    if (JSON.stringify(current) === JSON.stringify(submittedRef.current)) return undefined;
    const t = setTimeout(() => runSearch(0, current), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctypes, sortby, fromdate, todate, source, view]);

  // The judgment is rendered from HTML, so the marking happens on the DOM
  // afterwards: the paragraph a result was fetched on is then visible inside
  // the judgment itself, not just in the result card.
  useEffect(() => {
    if (view !== 'doc' || !doc?.html) { setDocHits(0); return; }
    const root = docBodyRef.current;
    if (!root) return;
    const terms = highlightTerms(submittedRef.current?.query || fields.query);
    setDocHits(markMatches(root, terms));
    const first = root.querySelector('mark.adv-hit');
    if (first) {
      first.classList.add('adv-hit-first');
      first.scrollIntoView({ block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, view]);

  if (!open) return null;

  const setField = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const toggleDoctype = (value) => setDoctypes((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  const toggleCategoryAll = (cat) => setDoctypes((prev) => {
    const next = new Set(prev);
    const allOn = cat.options.every(([v]) => next.has(v));
    cat.options.forEach(([v]) => { if (allOn) next.delete(v); else next.add(v); });
    return next;
  });

  const toggleCatOpen = (key) => setOpenCats((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const goPage = (delta) => {
    if (!resp || !submittedRef.current) return;
    const next = Math.max(0, (resp.pagenum || 0) + delta);
    if (next !== resp.pagenum) runSearch(next, submittedRef.current);
  };

  // Re-run the search with the baseline query plus `list` of extra keywords.
  // The words join the query itself, so the engine's all-words rule does the
  // filtering and the result count is honest at every step.
  const runWithRefinements = (list) => {
    const query = [baseQueryRef.current, ...list].filter(Boolean).join(' ').trim();
    const params = { ...(submittedRef.current || buildCriteria()), query };
    setFields((f) => ({ ...f, query }));
    setRefinements(list);
    setRefineText('');
    runSearch(0, params);
  };

  const addRefinement = () => {
    const words = refineText.trim();
    if (!words) return;
    if (refinements.includes(words)) { setRefineText(''); return; }
    runWithRefinements([...refinements, words]);
  };

  // Escape hatch from an empty library result — an explicit, billed re-run
  // of the SAME criteria against Indian Kanoon.
  const searchIndianKanoon = () => {
    const params = { ...(submittedRef.current || buildCriteria()), source: 'ik' };
    setSource('ik');
    runSearch(0, params);
  };

  // Open one judgment IN the popup, rendered like Indian Kanoon's doc page.
  const openDoc = async (docId) => {
    // A search served from the library keeps its documents in the library
    // too: /local-search/doc reads Elasticsearch only and 404s when the
    // judgment was never collected — it never spends Indian Kanoon credit.
    const fromLibrary = (submittedRef.current?.source || source) === 'local';
    setDocFromLibrary(fromLibrary);
    setView('doc');
    setDocLoading(true);
    setDocError('');
    setDoc(null);
    try {
      const data = fromLibrary
        ? await judgementApi.localSearchDoc(docId)
        : await judgementApi.advancedSearchDoc(docId);
      if (data.cost && !fromLibrary) {
        console.info(
          `[Advanced Search · Indian Kanoon cost] document ${docId}\n`
          + `  Billed: ${Object.entries(data.cost.billed || {}).map(([k, v]) => `${v}× ${k}`).join(', ') || 'nothing (cached)'}\n`
          + `  Cache hits (free): ${data.cost.cachedHits}\n`
          + `  TOTAL: ₹${data.cost.totalInr.toFixed(2)}`,
        );
      }
      logDoc(docId, data);
      setDoc(data);
      docRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      if (err.status === 404 && fromLibrary) {
        console.warn(`[Advanced Search] judgment ${docId} NOT FOUND in your `
          + 'library (Elasticsearch) — no Indian Kanoon call was made.');
      }
      setDocError(err.status === 404 && fromLibrary
        ? 'Not found — this judgment is not in your library yet. Switch the '
          + 'source to Indian Kanoon on the search form to fetch it.'
        : err.message || 'Could not load the judgment');
    } finally {
      setDocLoading(false);
    }
  };

  const resetAll = () => {
    setFields(EMPTY_FIELDS);
    setSortby('relevance');
    setFromdate('');
    setTodate('');
    setDoctypes(new Set());
    setSource('ik');
    setResp(null);
    setError('');
    setDoc(null);
    setDocError('');
    setDocFromLibrary(false);
    setRefinements([]);
    setRefineText('');
    baseQueryRef.current = '';
    submittedRef.current = null;
    setView('form');
  };

  // The source the SHOWN results came from — the submitted one, not the
  // toggle the user may have flipped since.
  const libraryResults = resp?.source === 'local_library';
  const pageStart = resp ? (resp.pagenum || 0) * 10 + 1 : 0;
  const pageEnd = resp ? pageStart + (resp.results?.length || 0) - 1 : 0;

  const dateInput = (chip, value, set, id) => (
    <div key={id} className="rounded-[10px] border border-[#E5ECEB] bg-[#F8FAFC] p-2.5">
      <span className="inline-block mb-1.5 px-2 py-0.5 rounded-md bg-[#EFF4F3] text-[length:calc(10px*var(--jnx-text-scale,1))] font-bold tracking-wide uppercase text-[#64757C]">{chip}</span>
      <div className="flex items-center gap-2 bg-white border border-[#E5ECEB] rounded-[9px] px-2.5 focus-within:border-[#3FC8B4] focus-within:ring-[3px] focus-within:ring-[#3FC8B4]/15 transition-all">
        <CalendarDaysIcon className="h-4 w-4 shrink-0 text-[#93A2A7]" />
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => set(e.target.value)}
          className="w-full bg-transparent border-0 outline-none py-2 text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#0F1B21]"
        />
      </div>
    </div>
  );

  const sortRadios = (compact) => (
    <div className="space-y-2">
      {SORT_OPTIONS.map(({ value, label }) => (
        <label
          key={value}
          className={`flex items-center gap-2.5 rounded-[10px] border cursor-pointer transition-colors ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'} ${
            sortby === value
              ? 'border-[#3FC8B4] bg-[#F6FDFB] ring-[3px] ring-[#3FC8B4]/15'
              : 'border-[#E5ECEB] bg-white hover:border-[#BFE9DF]'
          }`}
        >
          <input
            type="radio"
            name="adv-sortby"
            value={value}
            checked={sortby === value}
            onChange={() => setSortby(value)}
            className="h-3.5 w-3.5 accent-[#0E8371]"
          />
          <span className="text-[length:calc(13px*var(--jnx-text-scale,1))] font-medium text-[#25353C]">{label}</span>
        </label>
      ))}
    </div>
  );

  const resultCards = resp && (
    <div className="space-y-2.5">
      {resp.results.map((item) => (
        <article key={item.docId} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => openDoc(item.docId)}
              className="text-left text-[length:calc(14px*var(--jnx-text-scale,1))] font-semibold text-[#0F172A] hover:text-[#21C1B6] leading-snug"
            >
              {item.title || item.docId}
            </button>
            <div className="flex items-center gap-2 shrink-0">
              {item.numCitedby > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold text-[#475569] whitespace-nowrap">
                  Cited by {item.numCitedby}
                </span>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title="Open on Indian Kanoon"
                className="h-6 w-6 flex items-center justify-center rounded-md text-[#93A2A7] hover:text-[#0E8371] hover:bg-[#F6FDFB]"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64748B]">
            <span>{[item.court, prettyDate(item.date)].filter(Boolean).join(' · ')}</span>
            {item.fromLibrary && (
              <span
                title="Served from JuriNex's own judgment library — no Indian Kanoon call"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]"
              >
                <CircleStackIcon className="h-3 w-3" /> JuriNex
              </span>
            )}
          </div>
          {item.evidence?.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {item.evidence.map((ev, i) => (
                <div
                  key={`${item.docId}-ev-${ev.paragraph ?? i}`}
                  className="flex gap-2 rounded-lg border-l-2 border-[#BFE9DF] bg-[#F8FAFC] px-2.5 py-1.5"
                >
                  {ev.paragraph != null && (
                    <span
                      title="Paragraph this judgment matched on"
                      className="shrink-0 text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] pt-[1px]"
                    >
                      ¶ {ev.paragraph}
                    </span>
                  )}
                  <p
                    className="adv-hit-text text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#475569] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: cleanFragment(ev.html) }}
                  />
                </div>
              ))}
            </div>
          ) : item.headline && (
            <p className="mt-2 text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#475569] leading-relaxed line-clamp-3">
              {item.headline}
            </p>
          )}
        </article>
      ))}
    </div>
  );

  const notFound = resp && resp.results.length === 0 && !searching && (
    <div className="rounded-2xl border border-dashed border-[#D8E3E0] bg-white px-6 py-12 text-center shadow-sm">
      <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-[#F1F5F4] flex items-center justify-center text-[#93A2A7]">
        <MagnifyingGlassIcon className="h-5 w-5" />
      </div>
      <h4 className="text-[length:calc(15px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Not found</h4>
      <p className="mt-1.5 mx-auto max-w-[440px] text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] leading-relaxed">
        {libraryResults
          ? 'No judgment in your library matches these criteria. The library holds only what JuriNex has already collected — try fewer words, drop a filter, or search Indian Kanoon instead.'
          : 'Indian Kanoon returned no documents for these criteria. Try fewer words, a wider date range, or fewer court filters.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {refinements.length > 0 && (
          <button
            type="button"
            onClick={() => runWithRefinements(refinements.slice(0, -1))}
            className="px-3.5 py-2 rounded-[9px] border border-[#BFE9DF] bg-[#F6FDFB] text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371] hover:bg-[#E9F9F5] transition-colors"
          >
            Undo &quot;{refinements[refinements.length - 1]}&quot;
          </button>
        )}
        <button
          type="button"
          onClick={() => setView('form')}
          className="px-3.5 py-2 rounded-[9px] border border-[#E5ECEB] bg-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#25353C] hover:border-[#BFE9DF] hover:text-[#0E8371] transition-colors"
        >
          Edit search
        </button>
        {libraryResults && (
          <button
            type="button"
            onClick={searchIndianKanoon}
            className="px-3.5 py-2 rounded-[9px] bg-[#0F1B21] text-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold hover:bg-[#25353C] transition-colors"
          >
            Search Indian Kanoon instead
          </button>
        )}
      </div>
    </div>
  );

  const refineBar = resp && (
    <div className="mb-3 rounded-xl border border-[#E5ECEB] bg-white p-2.5 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addRefinement(); }}
          placeholder="Refine your search — add a keyword, or an exact phrase in quotes"
          aria-label="Add a keyword to search within these results"
          className="flex-1 min-w-0 bg-white border border-[#E5ECEB] rounded-[9px] px-3 py-2 text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#0F1B21] placeholder:text-[#93A2A7] outline-none transition-all focus:border-[#3FC8B4] focus:ring-[3px] focus:ring-[#3FC8B4]/15"
        />
        <button
          type="button"
          onClick={addRefinement}
          disabled={searching || !refineText.trim()}
          className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-[9px] bg-[#0F1B21] text-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold hover:bg-[#25353C] disabled:opacity-40 transition-colors"
        >
          <MagnifyingGlassIcon className="h-3.5 w-3.5" /> Search Within Results
        </button>
      </div>
      {refinements.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold text-[#64757C]">
            Narrowed by:
          </span>
          {refinements.map((word, i) => (
            <button
              key={word}
              type="button"
              title="Remove this keyword"
              onClick={() => runWithRefinements(refinements.filter((_, j) => j !== i))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(11px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371] hover:bg-[#D9F4EE] transition-colors"
            >
              {word}
              <XMarkIcon className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => runWithRefinements([])}
            className="ml-1 text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#3FC8B4]/15"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );

  const pagination = resp && (resp.pagenum > 0 || resp.hasMore) && (
    <div className="mt-4 flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => goPage(-1)}
        disabled={searching || resp.pagenum <= 0}
        className="flex items-center gap-1 px-3 py-1.5 rounded-[9px] border border-[#E5ECEB] bg-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#25353C] hover:border-[#BFE9DF] hover:text-[#0E8371] disabled:opacity-40 transition-colors"
      >
        <ChevronLeftIcon className="h-3.5 w-3.5" /> Previous
      </button>
      <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-medium text-[#64757C]">Page {(resp.pagenum || 0) + 1}</span>
      <button
        type="button"
        onClick={() => goPage(1)}
        disabled={searching || !resp.hasMore}
        className="flex items-center gap-1 px-3 py-1.5 rounded-[9px] border border-[#E5ECEB] bg-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#25353C] hover:border-[#BFE9DF] hover:text-[#0E8371] disabled:opacity-40 transition-colors"
      >
        Next <ChevronRightIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6 bg-[#0F1B21]/45 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Advanced Search"
    >
      <div className="w-full max-w-[1080px] max-h-[92vh] flex flex-col rounded-2xl bg-[#F6F9F8] border border-[#E5ECEB] shadow-[0_24px_64px_rgba(15,27,33,0.28)] overflow-hidden">
        <style>{HIT_CSS}</style>

        {/* Header */}
        <div className="flex items-start gap-3.5 px-5 sm:px-7 pt-5 pb-4 bg-white border-b border-[#E5ECEB] shrink-0">
          <div className="h-10 w-10 shrink-0 rounded-[12px] bg-gradient-to-br from-[#E9F9F5] to-[#D9F4EE] border border-[#BFE9DF] flex items-center justify-center text-[#0E8371]">
            <MagnifyingGlassIcon className="h-[19px] w-[19px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[length:calc(18px*var(--jnx-text-scale,1))] font-extrabold tracking-[-0.02em] text-[#0F1B21] leading-tight">Advanced Search</h2>
            <p className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] mt-0.5 truncate">
              {view === 'doc'
                ? (doc?.title || 'Loading judgment…')
                : view === 'results' && resp
                  ? (resp.results.length === 0
                    ? 'No documents matched these criteria.'
                    : `Showing ${pageStart}–${pageEnd}${resp.total ? ` of ${resp.total.toLocaleString('en-IN')}` : ''} — refine with the filters on the left.`)
                  : source === 'local'
                    ? 'Search your own judgment library — free and instant; every field is optional, fill any and search.'
                    : 'Search Indian Kanoon directly with precision — every field is optional; fill any and search.'}
            </p>
          </div>
          {view === 'results' && (
            <button
              type="button"
              onClick={() => setView('form')}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[9px] border border-[#E5ECEB] bg-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] hover:border-[#BFE9DF] hover:text-[#0E8371] transition-colors"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" /> Edit search
            </button>
          )}
          {view === 'doc' && (
            <button
              type="button"
              onClick={() => { setView('results'); setDocError(''); }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[9px] border border-[#E5ECEB] bg-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] hover:border-[#BFE9DF] hover:text-[#0E8371] transition-colors"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to results
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 h-8 w-8 rounded-[9px] flex items-center justify-center text-[#64757C] hover:bg-[#EFF4F3] hover:text-[#0F1B21] transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ── PAGE 1: criteria form ── */}
        {view === 'form' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-5">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
                <section className="rounded-2xl border border-[#E5ECEB] bg-white p-5 shadow-sm">
                  {/* Source: Indian Kanoon (billed) vs the local library (free) */}
                  <div className="mb-4 inline-flex items-center gap-[3px] rounded-xl border border-[#E5ECEB] bg-[#F8FAFC] p-1">
                    {[
                      { key: 'ik', label: 'Indian Kanoon' },
                      { key: 'local', label: 'My library (free)' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSource(key)}
                        aria-pressed={source === key}
                        className={`px-3.5 py-1.5 rounded-[9px] text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold transition-colors ${
                          source === key ? 'bg-[#0F1B21] text-white' : 'text-[#64757C] hover:bg-[#EFF4F3]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <h3 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] mb-4">Search Criteria</h3>
                  <div className="space-y-3.5">
                    {CRITERIA_FIELDS.map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <label htmlFor={`adv-${key}`} className={labelCls}>{label}</label>
                        <input
                          id={`adv-${key}`}
                          type="text"
                          value={fields[key]}
                          onChange={setField(key)}
                          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(0); }}
                          placeholder={placeholder}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <div className="space-y-5">
                  <section className="rounded-2xl border border-[#E5ECEB] bg-white p-5 shadow-sm">
                    <h3 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] mb-3">Filters</h3>
                    <span className={labelCls}>Order Results By</span>
                    {sortRadios(false)}
                  </section>

                  <section className="rounded-2xl border border-[#E5ECEB] bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Date Range</h3>
                      {(fromdate || todate) && (
                        <button
                          type="button"
                          onClick={() => { setFromdate(''); setTodate(''); }}
                          className="flex items-center gap-1 text-[length:calc(11px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-2 py-1 rounded-md hover:bg-[#3FC8B4]/15"
                        >
                          <XMarkIcon className="h-3 w-3" /> Clear dates
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {dateInput('From', fromdate, setFromdate, 'adv-fromdate')}
                      {dateInput('To', todate, setTodate, 'adv-todate')}
                    </div>
                    <p className="mt-2.5 text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] leading-relaxed">
                      Use both fields to limit results to a specific period, or leave them empty to include all dates.
                    </p>
                  </section>
                </div>
              </div>

              <section className="mt-5 rounded-2xl border border-[#E5ECEB] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[length:calc(14px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Document Types</h3>
                  <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                    {doctypes.size > 0 ? `${doctypes.size} selected` : 'optional — all documents when none selected'}
                  </span>
                </div>
                <DoctypeFilter
                  doctypes={doctypes}
                  onToggle={toggleDoctype}
                  onToggleAll={toggleCategoryAll}
                  openCats={openCats}
                  onToggleOpen={toggleCatOpen}
                  compact={false}
                />
              </section>

              {error && (
                <div className="mt-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[length:calc(13px*var(--jnx-text-scale,1))] font-medium text-[#991B1B]">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 px-5 sm:px-7 py-4 bg-white border-t border-[#E5ECEB] shrink-0">
              <button
                type="button"
                onClick={() => runSearch(0)}
                disabled={searching || !hasCriteria}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searching
                  ? <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  : <MagnifyingGlassIcon className="h-4 w-4" />}
                {searching ? 'Searching…' : 'Search Documents'}
              </button>
              <button
                type="button"
                onClick={resetAll}
                disabled={searching}
                className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] border border-[#E5ECEB] bg-white text-[length:calc(13px*var(--jnx-text-scale,1))] font-semibold text-[#64757C] hover:border-[#BFE9DF] hover:text-[#0E8371] transition-colors disabled:opacity-50"
              >
                <ArrowPathIcon className="h-4 w-4" /> Reset Filters
              </button>
              <span className="ml-auto hidden sm:block text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7]">
                {source === 'local'
                  ? "Results come from your own judgment library — no Indian Kanoon call, no spend."
                  : 'Results come directly from Indian Kanoon, exactly as it ranks them.'}
              </span>
            </div>
          </>
        )}

        {/* ── PAGE 2: results with the IK-style filter rail ── */}
        {view === 'results' && resp && (
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

              {/* Filter rail — like Indian Kanoon's results sidebar */}
              <aside className="space-y-4 lg:sticky lg:top-0">
                <section className="rounded-2xl border border-[#E5ECEB] bg-white p-4 shadow-sm">
                  <h4 className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-bold tracking-wide uppercase text-[#64757C] mb-2.5">Sort By</h4>
                  {sortRadios(true)}
                </section>

                <section className="rounded-2xl border border-[#E5ECEB] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2.5">
                    <h4 className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-bold tracking-wide uppercase text-[#64757C]">Date Range</h4>
                    {(fromdate || todate) && (
                      <button
                        type="button"
                        onClick={() => { setFromdate(''); setTodate(''); }}
                        className="text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#3FC8B4]/15"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    {dateInput('From', fromdate, setFromdate, 'adv-rail-fromdate')}
                    {dateInput('To', todate, setTodate, 'adv-rail-todate')}
                  </div>
                </section>

                <section className="rounded-2xl border border-[#E5ECEB] bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-bold tracking-wide uppercase text-[#64757C]">Courts &amp; Documents</h4>
                    {doctypes.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setDoctypes(new Set())}
                        className="ml-auto text-[length:calc(10.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371] px-1.5 py-0.5 rounded-md hover:bg-[#3FC8B4]/15"
                      >
                        Clear ({doctypes.size})
                      </button>
                    )}
                  </div>
                  <DoctypeFilter
                    doctypes={doctypes}
                    onToggle={toggleDoctype}
                    onToggleAll={toggleCategoryAll}
                    openCats={openCats}
                    onToggleOpen={toggleCatOpen}
                    compact
                  />
                </section>
              </aside>

              {/* Results column */}
              <div className="min-w-0 relative">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                  <span className="text-[length:calc(12px*var(--jnx-text-scale,1))] text-[#64757C]">
                    {resp.results.length === 0
                      ? (libraryResults
                        ? 'Not found in your library — adjust the filters or edit the search.'
                        : 'No documents matched these criteria — adjust the filters or edit the search.')
                      : `Showing ${pageStart}–${pageEnd}${resp.total ? ` of ${resp.total.toLocaleString('en-IN')}` : ''}`}
                  </span>
                  {resp.source === 'local_library' && (
                    <span className="px-2 py-0.5 rounded-md bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(11px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">
                      From your library — free
                    </span>
                  )}
                  <code className="ml-auto max-w-full truncate text-[length:calc(11px*var(--jnx-text-scale,1))] text-[#93A2A7] bg-[#F8FAFC] border border-[#E5ECEB] rounded-md px-2 py-0.5" title={resp.formInput}>
                    {resp.formInput}
                  </code>
                </div>
                {error && (
                  <div className="mb-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[length:calc(13px*var(--jnx-text-scale,1))] font-medium text-[#991B1B]">
                    {error}
                  </div>
                )}
                {searching && (
                  <div className="absolute inset-0 z-10 flex items-start justify-center pt-16 rounded-xl bg-[#F6F9F8]/70 backdrop-blur-[1px]">
                    <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5ECEB] shadow-sm text-[length:calc(12.5px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371]">
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      {source === 'local' ? 'Searching your library…' : 'Searching Indian Kanoon…'}
                    </span>
                  </div>
                )}
                {refineBar}
                {resultCards}
                {notFound}
                {pagination}
              </div>
            </div>
          </div>
        )}

        {/* ── PAGE 3: in-app judgment view, like Indian Kanoon's doc page ── */}
        {view === 'doc' && (
          <div ref={docRef} className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-5">
            <style>{DOC_CSS}{HIT_CSS}</style>
            {docLoading && (
              <div className="flex items-center justify-center gap-2 py-24 text-[length:calc(13.5px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371]">
                <ArrowPathIcon className="h-5 w-5 animate-spin" />
                {docFromLibrary ? 'Loading the judgment from your library…' : 'Loading the judgment from Indian Kanoon…'}
              </div>
            )}
            {!docLoading && docError && (
              docError.startsWith('Not found')
                ? (
                  <div className="max-w-[560px] mx-auto rounded-2xl border border-dashed border-[#D8E3E0] bg-white px-6 py-12 text-center shadow-sm">
                    <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-[#F1F5F4] flex items-center justify-center text-[#93A2A7]">
                      <MagnifyingGlassIcon className="h-5 w-5" />
                    </div>
                    <h4 className="text-[length:calc(15px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">Not found</h4>
                    <p className="mt-1.5 text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#64757C] leading-relaxed">
                      This judgment is not in your library yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setView('form'); setSource('ik'); setDocError(''); }}
                      className="mt-4 px-3.5 py-2 rounded-[9px] bg-[#0F1B21] text-white text-[length:calc(12px*var(--jnx-text-scale,1))] font-semibold hover:bg-[#25353C] transition-colors"
                    >
                      Switch to Indian Kanoon
                    </button>
                  </div>
                )
                : (
                  <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[length:calc(13px*var(--jnx-text-scale,1))] font-medium text-[#991B1B]">
                    {docError}
                  </div>
                )
            )}
            {!docLoading && !docError && doc && (
              <article className="max-w-[880px] mx-auto rounded-2xl border border-[#E5ECEB] bg-white shadow-sm px-5 sm:px-10 py-8">
                {/* IK-style masthead */}
                <div className="text-center space-y-2 mb-6">
                  <div className="text-[length:calc(13px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21]">
                    [Cites {doc.citesCount || 0}, Cited by <span className="text-[#0E8371]">{doc.citedByCount || 0}</span>]
                  </div>
                  {doc.court && (
                    <div className="text-[length:calc(15px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]">{doc.court}</div>
                  )}
                  <h3 className="text-[length:calc(17px*var(--jnx-text-scale,1))] font-bold text-[#0F1B21] leading-snug">{doc.title}</h3>
                  {(doc.author || doc.bench) && (
                    <div className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#25353C]">
                      {doc.author && <span><b className="font-bold">Author:</b> {doc.author}</span>}
                      {doc.author && doc.bench && <span className="mx-2 text-[#93A2A7]">·</span>}
                      {doc.bench && <span><b className="font-bold">Bench:</b> {doc.bench}</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-3 pt-1">
                    {docHits > 0 && (
                      <span
                        title="Occurrences of your search words in this judgment — the first one is scrolled to"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#FDF0A8] border border-[#E7D06A] text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold text-[#6B5A0E]"
                      >
                        {docHits} match{docHits === 1 ? '' : 'es'} highlighted
                      </span>
                    )}
                    {docFromLibrary && (
                      <span
                        title="Served from JuriNex's own judgment library — no Indian Kanoon call"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#E9F9F5] border border-[#BFE9DF] text-[length:calc(9.5px*var(--jnx-text-scale,1))] font-bold text-[#0E8371]"
                      >
                        <CircleStackIcon className="h-3 w-3" /> From your library
                      </span>
                    )}
                    {doc.publishdate && (
                      <span className="text-[length:calc(11.5px*var(--jnx-text-scale,1))] text-[#93A2A7]">{prettyDate(doc.publishdate)}</span>
                    )}
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[length:calc(11.5px*var(--jnx-text-scale,1))] font-semibold text-[#0E8371] hover:underline"
                    >
                      Open on Indian Kanoon <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <div className="h-px bg-[#E5ECEB] mb-6" />

                {/* The judgment, in IK's own formatting (sanitized) */}
                {doc.html
                  ? <div ref={docBodyRef} className="adv-ik-doc" dangerouslySetInnerHTML={{ __html: cleanDocHtml(doc.html) }} />
                  : (
                    <p className="text-[length:calc(13px*var(--jnx-text-scale,1))] text-[#64757C]">
                      {docFromLibrary
                        ? 'The library copy of this judgment has no full text — open it on Indian Kanoon, or search that source instead.'
                        : 'The full text of this document is not available from Indian Kanoon.'}
                    </p>
                  )}

                {/* Cites / cited-by samples — each opens in-app too */}
                {[['Cases cited', doc.casesCited], ['Cited by', doc.citedBy]].map(([label, list]) => (
                  Array.isArray(list) && list.length > 0 && (
                    <div key={label} className="mt-7">
                      <h4 className="text-[length:calc(12px*var(--jnx-text-scale,1))] font-bold tracking-wide uppercase text-[#64757C] mb-2 border-t border-[#E5ECEB] pt-4">
                        {label} ({label === 'Cases cited' ? doc.citesCount : doc.citedByCount})
                      </h4>
                      <ul className="space-y-1">
                        {list.map((c) => (
                          <li key={`${label}-${c.docId || c.title}`}>
                            {c.docId ? (
                              <button
                                type="button"
                                onClick={() => openDoc(c.docId)}
                                className="text-left text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#0E8371] hover:underline leading-relaxed"
                              >
                                {c.title}
                              </button>
                            ) : (
                              <span className="text-[length:calc(12.5px*var(--jnx-text-scale,1))] text-[#475569]">{c.title}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                ))}
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
