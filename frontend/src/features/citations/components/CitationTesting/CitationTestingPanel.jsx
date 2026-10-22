import React, { useState, useEffect, useRef } from 'react';
import documentApi from '@/shared/api/documentApi';
import { CITATION_TESTING_SERVICE_URL, getUserIdForDrafting } from '@/config/apiConfig';

const T = '#21C1B6';

// ── Official API pricing (verified June 2026) ──────────────────────────────
// Gemini 2.5 Flash (non-thinking):  $0.075/1M input  ·  $0.60/1M output
// Claude Sonnet 4.6:                $3.00/1M input   ·  $15.00/1M output
// Serper Google Search API:         $0.30/1,000 searches = $0.0003/search
// Google Cloud Run asia-south1:     $0.000024/vCPU-second (2 vCPU allocated)
const USD_TO_INR = 84;

// Token model per pipeline stage (used for dynamic cost calculation):
//   Stages 1-3 (Case Analyzer + Decomposer + Query Planner): fixed base tokens
//   Stage 4 (grounding / Serper):  scales with sources found
//   Stage 5 (extractor):           scales with sources × snippet length + citations × JSON size
function calcCost(result, methodId) {
  const sources   = result?.search_results?.length ?? 0;
  const citations = result?.citations?.length       ?? 0;
  const elapsed   = result?.elapsed_seconds         ?? 30;
  const fromCache = result?.from_cache              ?? false;

  // Cloud Run: 2 vCPU × elapsed seconds × $0.000024
  const infraUsd = Math.max(elapsed, 5) * 2 * 0.000024;

  if (fromCache) {
    return {
      cached: true,
      rows:  [{ label: `Cloud Run only — cached result (${elapsed}s × 2vCPU)`, usd: infraUsd }],
      total: infraUsd,
    };
  }

  // Token estimates:
  //   Stages 1-3 base: ~13,000 input  + ~3,200 output  (fixed)
  //   Stage 5 per-source snippet fed to extractor: ~600 tokens input
  //   Stage 5 per-citation JSON produced:          ~450 tokens output
  const inputTokens  = 13_000 + sources * 600;
  const outputTokens =  3_200 + citations * 450;

  if (methodId === 'gemini') {
    const llmIn  = inputTokens  * 0.075 / 1_000_000;
    const llmOut = outputTokens * 0.60  / 1_000_000;
    return {
      cached: false,
      rows: [
        { label: `Gemini 2.5 Flash input — ${(inputTokens/1000).toFixed(1)}K tok × $0.075/1M`,  usd: llmIn  },
        { label: `Gemini 2.5 Flash output — ${(outputTokens/1000).toFixed(1)}K tok × $0.60/1M`, usd: llmOut },
        { label: `Cloud Run (${elapsed}s × 2 vCPU × $0.000024/s)`,                               usd: infraUsd },
      ],
      total: llmIn + llmOut + infraUsd,
    };
  }

  // Claude method
  const llmIn      = inputTokens  * 3.00 / 1_000_000;
  const llmOut     = outputTokens * 15.0 / 1_000_000;
  // Serper: estimate ~2 searches per source found (min 4, max 8)
  const serperN    = Math.min(8, Math.max(4, Math.ceil(sources * 0.6)));
  const serperUsd  = serperN * 0.0003;
  return {
    cached: false,
    rows: [
      { label: `Claude Sonnet 4.6 input — ${(inputTokens/1000).toFixed(1)}K tok × $3/1M`,    usd: llmIn    },
      { label: `Claude Sonnet 4.6 output — ${(outputTokens/1000).toFixed(1)}K tok × $15/1M`, usd: llmOut   },
      { label: `Serper API — ${serperN} searches × $0.0003`,                                  usd: serperUsd },
      { label: `Cloud Run (${elapsed}s × 2 vCPU × $0.000024/s)`,                              usd: infraUsd },
    ],
    total: llmIn + llmOut + serperUsd + infraUsd,
  };
}

const METHODS = [
  {
    id: 'gemini', label: 'Gemini', sub: 'Google Grounding',
    color: T, activeBg: '#F0FDFA', activeBorder: T,
    icon: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    id: 'claude', label: 'Claude', sub: 'Serper Web Search',
    color: '#E65100', activeBg: '#FFF8F5', activeBorder: '#E65100',
    icon: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  },
];

const PIPELINE_STAGES = [
  'Fetching case documents…',
  'Case Analyzer — extracting legal issues, statutes & parties…',
  'Research Decomposer — building similar-fact research questions…',
  'Query Planner — generating precedent search queries…',
  'Searching indiankanoon.org and authorised sources…',
  'Extracting citation briefs with court arguments…',
];

const WEIGHT_CFG = {
  BINDING:           { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', label: 'BINDING — Supreme Court' },
  PERSUASIVE:        { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', label: 'PERSUASIVE — High Court' },
  PERSUASIVE_OTHER:  { bg: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE', label: 'PERSUASIVE — Other HC'  },
  TRIBUNAL:          { bg: '#F9FAFB', text: '#4B5563', border: '#E5E7EB', label: 'Tribunal / Other'       },
};
const TIER_CFG = {
  T1: { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0', label: 'T1 Official' },
  T2: { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', label: 'T2 Reporter' },
};
const CONF_CFG = {
  HIGH:   { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
  MEDIUM: { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
};

function Badge({ cfg, label }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
      {label || cfg.label}
    </span>
  );
}

function Section({ title, icon, children, accent }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent || '#374151' }}>{title}</span>
      </div>
      <div className="px-4 py-3 text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Spinner({ size = 4 }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

function CitationCard({ c, idx, sourceRef }) {
  const [open, setOpen] = useState(false);
  const weightCfg = WEIGHT_CFG[c.authority_weight] || WEIGHT_CFG.PERSUASIVE;
  const tierCfg   = TIER_CFG[c.authority_tier]     || TIER_CFG.T2;
  const confCfg   = CONF_CFG[c.confidence]         || CONF_CFG.MEDIUM;

  const similarities = (c.factual_similarity || '')
    .split(/\n|•|·|-(?=\s)/)
    .map(s => s.trim())
    .filter(Boolean);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">

      {/* ── Card header ── */}
      <div
        className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-start gap-3">
          {/* Index badge */}
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-white"
            style={{ background: T }}>
            {idx + 1}
          </div>

          <div className="flex-1 min-w-0">
            {/* Authority badges */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Badge cfg={weightCfg} label={weightCfg.label} />
              <Badge cfg={tierCfg} />
              <Badge cfg={confCfg} label={c.confidence} />
              {c.year && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{c.year}</span>
              )}
            </div>

            {/* Overruled warning — shown above case name if flagged */}
            {c.is_overruled && (
              <div className="flex items-center gap-1.5 mb-1.5 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 w-fit">
                <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-bold text-red-700 uppercase tracking-wide">Overruled — Do Not Cite</span>
                {c.overruled_by && (
                  <span className="text-xs text-red-600 font-normal">· {c.overruled_by}</span>
                )}
              </div>
            )}
            {/* Case name + inline source citation */}
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-bold text-base leading-snug ${c.is_overruled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                {c.parties || 'Unknown Parties'}
              </span>
              {sourceRef && (
                <a
                  href={sourceRef.source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Source [${sourceRef.index}]: ${sourceRef.source.title || sourceRef.source.uri}`}
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center justify-center font-bold rounded hover:opacity-75 transition-opacity flex-shrink-0"
                  style={{ background: T, color: '#fff', fontSize: '10px', padding: '1px 5px', lineHeight: '16px', borderRadius: '4px' }}
                >
                  [{sourceRef.index}]
                </a>
              )}
            </div>

            {/* Court + citation */}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {c.court && <span className="text-sm text-gray-500">{c.court}{c.bench ? ` · ${c.bench}` : ''}</span>}
              {c.citation_no && (
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ background: '#F0FDFA', color: T }}>
                  {c.citation_no}
                </span>
              )}
            </div>

            {/* Key principle preview */}
            {c.key_principle && (
              <div className="mt-2 text-sm text-gray-600 italic">"{c.key_principle}"</div>
            )}
          </div>

          <svg className={`w-5 h-5 text-gray-400 flex-shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* ── Full brief (expanded) ── */}
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">

          {/* HOW TO USE IN COURT — most prominent */}
          {c.our_argument && (
            <div className="px-5 py-4" style={{ background: '#FFFBEB' }}>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: '#B45309' }}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">How to Use in Court</span>
              </div>
              <p className="text-sm text-amber-900 leading-relaxed font-medium">{c.our_argument}</p>
            </div>
          )}

          <div className="px-5 py-4 space-y-4">

            {/* Facts of the precedent case */}
            {c.facts_of_precedent && (
              <Section title="Facts of the Precedent Case" icon="📋">
                {c.facts_of_precedent}
              </Section>
            )}

            {/* Legal issue decided */}
            {c.legal_issue && (
              <Section title="Legal Issue Decided" icon="⚖️" accent="#1D4ED8">
                {c.legal_issue}
              </Section>
            )}

            {/* Ratio decidendi */}
            {c.ratio && (
              <Section title="Ratio Decidendi (What the Court Held)" icon="🏛️" accent="#166534">
                {c.ratio}
              </Section>
            )}

            {/* Key quote */}
            {c.key_quote && (
              <div className="rounded-lg border-l-4 bg-gray-50 px-4 py-3" style={{ borderColor: T }}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Key Quote from Judgment</div>
                <blockquote className="text-sm text-gray-700 italic leading-relaxed">"{c.key_quote}"</blockquote>
              </div>
            )}

            {/* Factual similarity */}
            {similarities.length > 0 && (
              <Section title="Why This Case Matches Ours" icon="🔗" accent={T}>
                <ul className="space-y-1.5">
                  {similarities.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" style={{ color: T }}>
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Distinguishing notes */}
            {c.distinguishing_notes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-amber-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Caution — Distinguishing Facts</span>
                </div>
                <p className="text-sm text-amber-900 leading-relaxed">{c.distinguishing_notes}</p>
              </div>
            )}

            {/* References block */}
            {sourceRef ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Reference</div>
                <div className="flex items-start gap-2">
                  <a
                    href={sourceRef.source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center font-bold rounded flex-shrink-0 hover:opacity-75 transition-opacity"
                    style={{ background: T, color: '#fff', fontSize: '10px', padding: '2px 6px', lineHeight: '16px', borderRadius: '4px' }}
                  >
                    [{sourceRef.index}]
                  </a>
                  <div className="min-w-0">
                    <a href={sourceRef.source.uri} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium hover:underline block truncate" style={{ color: T }}>
                      {sourceRef.source.title || sourceRef.source.uri}
                    </a>
                    <span className="text-xs text-gray-400 break-all">{sourceRef.source.uri}</span>
                  </div>
                </div>
                {sourceRef.source.snippet && (
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-3 border-t border-gray-200 pt-2">
                    {sourceRef.source.snippet}
                  </p>
                )}
              </div>
            ) : c.source_url ? (
              <div className="flex items-center gap-2 pt-1">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <a href={c.source_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs break-all hover:underline" style={{ color: T }}>
                  {c.source_url}
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CitationTestingPanel() {
  const [method, setMethod]             = useState('gemini');
  const [cases, setCases]               = useState([]);
  const [selectedId, setSelectedId]     = useState('');
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError]     = useState('');
  const [manualQuery, setManualQuery]   = useState('');
  const [useManual, setUseManual]       = useState(false);
  const [running, setRunning]           = useState(false);
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState('');
  const [stageIdx, setStageIdx]         = useState(-1);
  const resultsRef = useRef(null);

  async function loadCases() {
    setCasesLoading(true);
    setCasesError('');
    try {
      const r = await documentApi.getCases();
      const list = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []);
      const arr = Array.isArray(list) ? list : [];
      setCases(arr);
      if (arr.length === 0) {
        setCasesError('empty');
      }
    } catch (e) {
      setCases([]);
      setCasesError(e?.message || 'network');
    } finally {
      setCasesLoading(false);
    }
  }

  useEffect(() => { loadCases(); }, []);

  const caseId   = c => c?.id ?? c?.case_id ?? '';
  const caseName = c => c?.case_title ?? c?.name ?? c?.title ?? caseId(c) ?? 'Untitled';
  const selMethod = METHODS.find(m => m.id === method);

  async function handleRun() {
    const hasCase = useManual ? manualQuery.trim() : selectedId;
    if (!hasCase) { setError(useManual ? 'Please enter a case name or description.' : 'Please select a case.'); return; }
    setError(''); setResult(null); setStageIdx(0); setRunning(true);

    let si = 0;
    const ticker = setInterval(() => {
      si++;
      if (si < PIPELINE_STAGES.length) setStageIdx(si);
      else clearInterval(ticker);
    }, 2800);

    try {
      const token  = localStorage.getItem('token') || localStorage.getItem('authToken') || '';
      const userId = getUserIdForDrafting();
      const body = useManual
        ? { method, case_query: manualQuery.trim(), user_id: userId || undefined }
        : { method, case_id: selectedId, user_id: userId || undefined };
      const res = await fetch(`${CITATION_TESTING_SERVICE_URL}/citation-test/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      clearInterval(ticker);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 504) {
          throw new Error('Research timed out on the server. The pipeline can take several minutes — try again or use a shorter case query.');
        }
        throw new Error(data.detail || 'Research failed');
      }
      setStageIdx(PIPELINE_STAGES.length - 1);
      setResult(data);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } catch (e) {
      clearInterval(ticker);
      setError(e.message || 'Citation research failed. Check that the citation-testing service is available.');
    } finally {
      setRunning(false);
    }
  }

  /* Authority weight sort order */
  const WEIGHT_ORDER = { BINDING: 0, PERSUASIVE: 1, PERSUASIVE_OTHER: 2, TRIBUNAL: 3 };
  const sortedCitations = result?.citations
    ? [...result.citations].sort((a, b) =>
        (WEIGHT_ORDER[a.authority_weight] ?? 4) - (WEIGHT_ORDER[b.authority_weight] ?? 4))
    : [];

  const binding    = sortedCitations.filter(c => c.authority_weight === 'BINDING');
  const persuasive = sortedCitations.filter(c => c.authority_weight !== 'BINDING');
  const costInfo   = result ? calcCost(result, result.method_used ?? method) : null;

  /* Build source URL → index map for inline [N] citations.
     Each citation.source_url is matched against search_results[i].uri.
     sourceRefFor(c) returns { index: 1-based, source: search_results[i] } or null. */
  const sourceUriToIdx = {};
  (result?.search_results || []).forEach((s, i) => {
    if (s.uri) sourceUriToIdx[s.uri] = i;
  });
  function sourceRefFor(citation) {
    const url = citation?.source_url;
    if (!url) return null;
    const i = sourceUriToIdx[url];
    if (i === undefined) return null;
    return { index: i + 1, source: result.search_results[i] };
  }
  /* Set of source indices actually cited (for highlighting in Sources list) */
  const citedSourceIndices = new Set(
    sortedCitations
      .map(c => sourceUriToIdx[c.source_url])
      .filter(i => i !== undefined)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#F0FDFA' }}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" style={{ color: T }}>
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Citation Research — Lawyer Brief</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Finds past court judgments with the same facts · Full citation brief with court argument · No need to read the full judgment
              </p>
            </div>
          </div>
        </div>

        {/* Method selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="text-sm font-semibold text-gray-700 mb-3">Select AI Method</div>
          <div className="grid grid-cols-2 gap-3">
            {METHODS.map(opt => {
              const active = method === opt.id;
              return (
                <button key={opt.id} onClick={() => setMethod(opt.id)}
                  className="text-left p-4 rounded-xl border-2 transition-all duration-150"
                  style={{ background: active ? opt.activeBg : '#FAFAFA', borderColor: active ? opt.activeBorder : '#E5E7EB' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: opt.color, color: '#fff' }}>
                      {opt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.sub}</div>
                    </div>
                    {active && (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: opt.activeBorder }}>
                        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Case selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">
              {useManual ? 'Enter Case Name / Description' : 'Select Case'}
              <span className="text-red-500 ml-0.5">*</span>
            </div>
            <div className="flex items-center gap-2">
              {casesLoading && <span className="flex items-center gap-1 text-xs text-gray-400"><Spinner size={3} />Loading…</span>}
              {!casesLoading && (
                <button onClick={() => setUseManual(v => !v)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
                  {useManual ? '← Pick from list' : 'Type manually →'}
                </button>
              )}
            </div>
          </div>

          {useManual ? (
            /* Manual entry mode */
            <div className="space-y-2">
              <textarea
                rows={3}
                value={manualQuery}
                onChange={e => { setManualQuery(e.target.value); setResult(null); setError(''); }}
                placeholder="e.g. GREEN EYE INFRASTRUCTURE PVT. LTD. vs CHIEF CONTROLLING REVENUE AUTHORITY MAHARASHTRA — stamp duty dispute on infrastructure company..."
                className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 bg-white resize-none
                           focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6] transition-colors"
              />
              <p className="text-xs text-gray-500">
                Type the case title and a brief description of the dispute. The AI will research relevant precedents.
              </p>
            </div>
          ) : cases.length > 0 ? (
            /* Dropdown mode */
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setResult(null); setError(''); }}
              className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 bg-white
                         focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6] transition-colors">
              <option value="">— Choose a case —</option>
              {cases.map(c => <option key={caseId(c)} value={caseId(c)}>{caseName(c)}</option>)}
            </select>
          ) : (
            /* Empty state with retry */
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div>
                  <div className="text-sm font-semibold text-amber-800">
                    {casesError === 'empty' ? 'No cases found for your account' : 'Could not load cases'}
                  </div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    {casesError === 'empty'
                      ? 'The document service is running but returned no cases. This may be because the firm context service (port 5000/5001) is offline. Use "Type manually" to enter your case directly.'
                      : `Error: ${casesError}. Check that the agentic-document-service is running on port 8092.`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={loadCases}
                  className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 bg-white hover:bg-amber-50 transition-colors font-medium">
                  Retry
                </button>
                <button onClick={() => setUseManual(true)}
                  className="text-xs px-3 py-1.5 rounded-lg text-white font-medium transition-colors"
                  style={{ background: T }}>
                  Type case manually →
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}

        {/* Run button */}
        {(() => {
          const isReady = useManual ? manualQuery.trim().length > 3 : !!selectedId;
          return (
            <button onClick={handleRun} disabled={running || !isReady}
              className="w-full py-3 px-6 rounded-xl font-semibold text-white text-sm transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
              style={{ background: running || !isReady ? '#9CA3AF' : selMethod.color }}>
              {running
                ? <span className="flex items-center justify-center gap-2"><Spinner size={4} />Finding similar-fact precedents…</span>
                : `Find Precedents — ${selMethod.label}`}
            </button>
          );
        })()}

        {/* Pipeline progress */}
        {(running || (stageIdx >= 0 && result)) && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="text-sm font-semibold text-gray-700 mb-4">Pipeline Progress</div>
            <div className="space-y-2.5">
              {PIPELINE_STAGES.map((stage, i) => {
                const done   = !running && i <= stageIdx;
                const active = running && i === stageIdx;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-5 h-5 flex-shrink-0">
                      {done ? (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: '#F0FDFA', border: `1.5px solid ${T}` }}>
                          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" style={{ color: T }}>
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      ) : active ? (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: '#EFF6FF', border: '1.5px solid #3B82F6' }}>
                          <Spinner size={2} />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
                      )}
                    </div>
                    <span className={`text-sm ${done ? 'text-gray-700' : active ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                      {stage}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {result && (
          <div ref={resultsRef} className="space-y-5">

            {/* Summary */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-900">Research Results</h2>
                <span className="text-xs px-2.5 py-1 rounded-full font-semibold text-white"
                  style={{ background: selMethod.color }}>via {selMethod.label}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Total Citations', value: sortedCitations.length,               color: T },
                  { label: 'Binding (SC)',    value: binding.length,                        color: '#B45309' },
                  { label: 'Sources Found',  value: result.search_results?.length ?? 0,    color: '#6366F1' },
                  { label: 'Time',           value: `${result.elapsed_seconds ?? '—'}s`,   color: '#6B7280' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold" style={{ color }}>{value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                  </div>
                ))}

                {/* Dynamic cost card */}
                {costInfo && (
                  <div className="bg-gray-50 rounded-lg p-3 text-center relative group col-span-2 sm:col-span-1">
                    <div className="text-xl font-bold" style={{ color: costInfo.cached ? '#6B7280' : '#059669' }}>
                      {costInfo.cached ? '₹0.01' : `₹${(costInfo.total * USD_TO_INR).toFixed(2)}`}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center justify-center gap-1">
                      {costInfo.cached ? 'Cached — Free' : 'Est. Cost'}
                      <svg className="w-3 h-3 text-gray-400" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M8 7v5M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    {/* Hover tooltip — dynamic line-by-line breakdown */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 hidden group-hover:block w-72">
                      <div className="bg-gray-900 text-white text-xs rounded-xl shadow-xl p-3 text-left">
                        <div className="font-bold mb-2" style={{ color: costInfo.cached ? '#9CA3AF' : '#34D399' }}>
                          Cost Breakdown — {(result?.method_used ?? method) === 'gemini' ? 'Gemini' : 'Claude'}
                          {costInfo.cached && <span className="ml-1 text-gray-400">(from cache)</span>}
                        </div>
                        <div className="mb-2 text-gray-400 text-[10px]">
                          Based on: {result?.search_results?.length ?? 0} sources · {result?.citations?.length ?? 0} citations · {result?.elapsed_seconds ?? 0}s
                        </div>
                        {costInfo.rows.map((r, i) => (
                          <div key={i} className="flex justify-between gap-3 py-1 border-b border-gray-700 last:border-0">
                            <span className="text-gray-300 leading-tight">{r.label}</span>
                            <span className="font-mono text-white whitespace-nowrap">${r.usd.toFixed(5)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between gap-2 pt-2 mt-1 font-bold text-sm">
                          <span>Total</span>
                          <span style={{ color: '#34D399' }}>
                            ${costInfo.total.toFixed(4)} ≈ ₹{(costInfo.total * USD_TO_INR).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-gray-500 text-[10px] mt-2 leading-tight border-t border-gray-700 pt-2">
                          Gemini: $0.075/$0.60 per 1M · Claude: $3/$15 per 1M · Serper: $0.30/1K · Cloud Run: $0.000024/vCPU-s
                        </div>
                      </div>
                      <div className="w-2.5 h-2.5 bg-gray-900 rotate-45 mx-auto -mt-1.5 rounded-sm" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {sortedCitations.length > 0 ? (
              <div className="space-y-5">

                {/* Binding citations */}
                {binding.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                        Binding Precedents — Supreme Court of India
                        <span className="ml-2 text-gray-400 font-normal normal-case">({binding.length})</span>
                      </h3>
                    </div>
                    <div className="space-y-4">
                      {binding.map((c, i) => <CitationCard key={i} c={c} idx={i} sourceRef={sourceRefFor(c)} />)}
                    </div>
                  </div>
                )}

                {/* Persuasive citations */}
                {persuasive.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                        Persuasive Precedents — High Courts &amp; Others
                        <span className="ml-2 text-gray-400 font-normal normal-case">({persuasive.length})</span>
                      </h3>
                    </div>
                    <div className="space-y-4">
                      {persuasive.map((c, i) => <CitationCard key={i} c={c} idx={binding.length + i} sourceRef={sourceRefFor(c)} />)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-gray-400" viewBox="0 0 24 24" fill="none">
                    <path d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="font-semibold text-gray-800 mb-1">No citations found</div>
                <div className="text-sm text-gray-500">
                  {result.gaps?.join(' · ') || 'Try a different method or ensure your case documents are uploaded.'}
                </div>
              </div>
            )}

            {/* Sources searched */}
            {result.search_results?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-700">
                    Sources Searched <span className="text-gray-400 font-normal">({result.search_results.length})</span>
                  </div>
                  {citedSourceIndices.size > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: '#F0FDFA', color: T, border: `1px solid ${T}` }}>
                      {citedSourceIndices.size} cited
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {result.search_results.map((s, i) => {
                    const cfg     = TIER_CFG[s.authority_tier] || TIER_CFG.T2;
                    const isCited = citedSourceIndices.has(i);
                    return (
                      <div key={i}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
                        style={isCited ? { background: '#F0FDFA' } : {}}>
                        {/* [N] index badge */}
                        <span className="text-xs font-mono font-bold flex-shrink-0 w-8 text-right"
                          style={{ color: isCited ? T : '#9CA3AF' }}>
                          [{i + 1}]
                        </span>
                        {/* Tier badge */}
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                          style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                          {s.authority_tier}
                        </span>
                        {/* Title / URL link */}
                        <a href={s.uri} target="_blank" rel="noopener noreferrer"
                          className="text-xs truncate hover:underline transition-colors flex-1 min-w-0"
                          style={{ color: isCited ? '#374151' : '#6B7280' }}>
                          {s.title || s.uri}
                        </a>
                        {/* "cited" pill for referenced sources */}
                        {isCited && (
                          <span className="text-xs font-semibold flex-shrink-0 px-1.5 py-0.5 rounded"
                            style={{ background: T, color: '#fff', fontSize: '10px' }}>
                            cited
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Gaps */}
            {result.gaps?.length > 0 && !sortedCitations.length && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-amber-800 mb-1">Research Gaps</div>
                {result.gaps.map((g, i) => <div key={i} className="text-sm text-amber-700">{g}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
