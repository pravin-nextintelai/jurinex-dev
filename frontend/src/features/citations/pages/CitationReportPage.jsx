import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import citationApi, { resolveCitationUserId } from '../api/citationApi';
import citationV1Api from '../api/citationV1Api';
import documentApi from '@/shared/api/documentApi';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';
import { QUOTA_ERROR_CODES } from '@/shared/utils/quotaError';
import { CITATION_SERVICE_URL } from '@/config/apiConfig';
import html2pdf from 'html2pdf.js';
import RedesignedCitationReportDoc from '../components/CitationReport/RedesignedCitationReportDoc';
import PipelineDetailModal from '../components/CitationReport/PipelineDetailModal';
import ReportErrorBoundary from '../components/CitationReport/ReportErrorBoundary';

/* ── tokens ── */
const N = '#1B2A4A', NL = '#2C4066', ND = '#0F1A30';
const G = '#1B5E20', GL = '#388E3C', GS = '#F0F9F0';
const Y = '#E65100', YS = '#FFF8E1';
const R = '#B71C1C', RS = '#FFF5F5';
const B = '#0D47A1', BS = '#EBF4FF';
const T = '#21C1B6', TD = '#1AA49B';
const W = '#FFFFFF';
const g50 = '#F8F9FB', g100 = '#EEF0F4', g200 = '#DDE1E8', g300 = '#C5CAD3', g400 = '#8690A2', g500 = '#556275', g600 = '#3D4A5C', g700 = '#263040', g800 = '#131B28';

const SCFG = {
  GREEN: { dot: '#16A34A', text: '#15532D', bg: '#F0FDF4', border: '#BBF7D0', label: 'VERIFIED' },
  YELLOW: { dot: '#D97706', text: '#92400E', bg: '#FFFBEB', border: '#FDE68A', label: 'REVIEW' },
  RED: { dot: '#DC2626', text: '#991B1B', bg: '#FEF2F2', border: '#FECACA', label: 'UNVERIFIED' },
  PENDING: { dot: '#7C3AED', text: '#4C1D95', bg: '#F5F3FF', border: '#DDD6FE', label: 'PENDING' },
  STALE: { dot: '#EA580C', text: '#7C2D12', bg: '#FFF7ED', border: '#FED7AA', label: 'STALE' },
};

// Priority score → SLA label
function _slaLabel(score) {
  if (score >= 0.85) return '4 hrs (URGENT)';
  if (score >= 0.70) return '8 hrs';
  if (score >= 0.50) return '24 hrs';
  return '72 hrs';
}

function Dot({ c, s = 7 }) { return <span style={{ width: s, height: s, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />; }
function Spin() { return (<span style={{ display: 'inline-flex', gap: 4 }}>{[0, .18, .36].map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: T, animation: `sp 1.2s ${d}s ease-in-out infinite` }} />)}<style>{`@keyframes sp{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}`}</style></span>); }

const PERSPECTIVE_OPTIONS = [
  { key: 'all', label: 'All', emoji: '⚖️' },
  { key: 'appellant', label: 'Appellant', emoji: '🔵' },
  { key: 'respondent', label: 'Respondent', emoji: '🟡' },
  { key: 'court', label: "Court's Ratio", emoji: '🟢' },
  { key: 'neutral', label: 'Both Sides', emoji: '⚪' },
];

function normalizePerspectiveKey(value, fallback = 'neutral') {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw) return fallback;
  if (raw === 'all') return 'all';
  if (/(appellant|petitioner|plaintiff|accused)/.test(raw)) return 'appellant';
  if (/(respondent|defendant|state|prosecution)/.test(raw)) return 'respondent';
  if (/(court|ratio|analysis|conclusion|judge|bench)/.test(raw)) return 'court';
  if (/(neutral|both|common|either|shared|all parties|both parties)/.test(raw)) return fallback === 'all' ? 'all' : 'neutral';
  return fallback;
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCourtKey(value) {
  const raw = normalizeSearchText(value);
  if (!raw || raw === 'court not specified' || raw === '—') return 'unknown';
  return raw;
}

function resolveCaseFolderName(caseData) {
  const folder = caseData?.folders?.[0] || caseData?.folder || null;
  return (
    folder?.name ||
    folder?.originalname ||
    caseData?.folder_name ||
    caseData?.folderName ||
    ''
  );
}

/** Party bucket for Appellant / Respondent / Court / Both — uses backend argumentParty plus partyArguments when present. */
function effectivePartyForSort(c) {
  const pa = c.partyArguments || c.party_arguments || {};
  const hasApp = Array.isArray(pa.appellant) && pa.appellant.length > 0;
  const hasResp = Array.isArray(pa.respondent) && pa.respondent.length > 0;
  const np = normalizePerspectiveKey(c.argumentParty || c.argument_party || '', 'neutral');
  if (hasApp && hasResp) return 'neutral';
  if (hasApp && !hasResp) return 'appellant';
  if (hasResp && !hasApp) return 'respondent';
  return np;
}

/** Whether a citation belongs in the selected party tab (All = no extra filter). */
function citationMatchesPerspectiveFilter(c, perspectiveFilter) {
  if (perspectiveFilter === 'all') return true;
  const pa = c.partyArguments || c.party_arguments || {};
  const hasApp = Array.isArray(pa.appellant) && pa.appellant.length > 0;
  const hasResp = Array.isArray(pa.respondent) && pa.respondent.length > 0;
  const hasCourtArg = Boolean(pa.court) || (typeof pa.court === 'string' && pa.court.trim().length > 0);
  const np = normalizePerspectiveKey(c.argumentParty || c.argument_party || '', 'neutral');
  if (perspectiveFilter === 'appellant') return np === 'appellant' || hasApp;
  if (perspectiveFilter === 'respondent') return np === 'respondent' || hasResp;
  if (perspectiveFilter === 'court') return np === 'court' || hasCourtArg;
  if (perspectiveFilter === 'neutral') {
    return np === 'neutral' || (hasApp && hasResp);
  }
  return true;
}

function analyzeQueryIntent(query) {
  const raw = normalizeSearchText(query);
  if (!raw) return { perspective: 'all', intent: 'general_research' };

  let perspective = 'all';
  if (/(respondent|defendant|state|prosecution)(?:'s)?\s+(side|arguments?|citations?|case|cases|position)?/.test(raw)) {
    perspective = 'respondent';
  } else if (/(appellant|petitioner|plaintiff|accused)(?:'s)?\s+(side|arguments?|citations?|case|cases|position)?/.test(raw)) {
    perspective = 'appellant';
  } else if (/(court|judge|bench|ratio|analysis|reasoning|holding|conclusion)/.test(raw)) {
    perspective = 'court';
  }

  let intent = 'general_research';
  if (/(citation|citations|case law|precedent|precedents|authorities)/.test(raw)) {
    intent = 'citation_research';
  } else if (/(argument|arguments|grounds|contention|submission|submissions)/.test(raw)) {
    intent = 'argument_research';
  } else if (/(ratio|analysis|reasoning|holding|conclusion)/.test(raw)) {
    intent = 'judicial_analysis';
  }

  return { perspective, intent };
}

/* ─── Inline Citation Network (Manupatra-style SVG radial graph) ─── */
let _icnCounter = 0;
function InlineCitationNetwork({ c }) {
  // Unique ID per instance so SVG defs (markers, gradients) don't conflict across multiple graphs on the same page
  const uid = useRef(`icn${++_icnCounter}`).current;

  const cites     = (c.ikCiteList    || []).slice(0, 7);
  const citedBy   = (c.ikCitedByList || []).slice(0, 7);
  const citeExtra = Math.max(0, (c.ikCiteList    || []).length - 7);
  const cbyExtra  = Math.max(0, (c.ikCitedByList || []).length - 7);
  if (!cites.length && !citedBy.length) return null;

  // viewBox wide enough to hold labels without clipping
  const VW = 860, VH = 420, CX = VW / 2, CY = VH / 2;
  // Orbit: distance from center to satellite node centers
  const ORBIT = 210, CR = 36, NR = 20;
  // Label column X positions (labels are placed at these fixed X columns, not floating beside nodes)
  const CITE_LABEL_X = 14;   // right-aligned label column for CITES
  const CBY_LABEL_X  = VW - 14; // left-aligned label column for CITED BY
  const toRad = d => (d * Math.PI) / 180;

  const placeArc = (items, startDeg, endDeg) => {
    if (!items.length) return [];
    const s = toRad(startDeg), e = toRad(endDeg);
    return items.map((item, i) => {
      const t = items.length === 1 ? 0.5 : i / (items.length - 1);
      const a = s + t * (e - s);
      const x = CX + ORBIT * Math.cos(a);
      const y = CY + ORBIT * Math.sin(a);
      return {
        ...item,
        id: `${uid}-${item.tid || i}`,
        x, y,
        label: item.title || `Doc #${item.tid}`,
        url: item.url || (item.tid ? `https://indiankanoon.org/doc/${item.tid}/` : null),
      };
    });
  };

  // CITES on the left arc (135°→225°), CITED-BY on the right arc (−45°→45°)
  const cnodes  = placeArc(cites,   135, 225);
  const cbnodes = placeArc(citedBy, -45,  45);

  const trim = (s, n = 30) => !s ? '—' : s.length > n ? s.slice(0, n - 1) + '…' : s;

  // Edge endpoint helper — stops at the node circle surface
  const ep = (x1, y1, x2, y2, r1, r2) => {
    const dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x1: x1 + (dx / d) * r1, y1: y1 + (dy / d) * r1,
             x2: x2 - (dx / d) * r2, y2: y2 - (dy / d) * r2 };
  };

  // Center node label: split at word boundary to fit inside the circle (≤14 chars per line)
  const centerWords = (c.caseName || '').split(/\s+/).filter(Boolean);
  let cl1 = '', cl2 = '';
  for (const w of centerWords) {
    if (!cl1 && w.length <= 12) { cl1 = w; continue; }
    if (cl1 && !cl2 && (cl1 + ' ' + w).length <= 12) { cl1 += ' ' + w; continue; }
    if (!cl2 && w.length <= 12) { cl2 = w; continue; }
    if (cl2 && (cl2 + ' ' + w).length <= 12) { cl2 += ' ' + w; continue; }
    break;
  }
  if (!cl1) cl1 = (c.caseName || '').slice(0, 12);

  const followed      = (c.treatment?.followedList      || []).slice(0, 4);
  const distinguished = (c.treatment?.distinguishedList || []).slice(0, 4);
  const overruled     = (c.treatment?.overruledList     || []).slice(0, 3);
  const hasTreat = followed.length || distinguished.length || overruled.length;

  return (
    <div>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 14px', background: '#EEF6FA',
                    border: '1px solid #C5E4EE', borderBottom: 'none', borderRadius: '6px 6px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#2563EB', display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            ← Cases Cited&nbsp;({(c.ikCiteList||[]).length})
          </span>
        </div>
        <span style={{ fontSize: 9, color: '#64748B', fontStyle: 'italic', fontFamily: "'Source Serif 4',serif" }}>
          {trim(c.caseName, 60)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#0F766E', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Cited By&nbsp;({(c.ikCitedByList||[]).length})&nbsp;→
          </span>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0D9488', display: 'inline-block' }} />
        </div>
      </div>

      {/* SVG graph */}
      <div style={{ background: '#F8FBFD', border: '1px solid #C5E4EE', borderRadius: '0 0 6px 6px', overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', width: '100%', minWidth: 520 }}>
          <defs>
            {/* Unique marker + gradient IDs per instance to avoid page-wide ID conflicts */}
            <marker id={`arr-c-${uid}`}  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563EB" opacity="0.85" />
            </marker>
            <marker id={`arr-cb-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#0D9488" opacity="0.85" />
            </marker>
            <radialGradient id={`cgrad-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2C4066" />
              <stop offset="100%" stopColor="#1B2A4A" />
            </radialGradient>
            <clipPath id={`cnclip-${uid}`}>
              <circle cx="0" cy="0" r={CR - 2} />
            </clipPath>
          </defs>

          {/* Subtle concentric guide rings */}
          <circle cx={CX} cy={CY} r={ORBIT} fill="none" stroke="#D4E8EE" strokeWidth="0.8" strokeDasharray="4 6" />
          <circle cx={CX} cy={CY} r={ORBIT * 0.52} fill="none" stroke="#D4E8EE" strokeWidth="0.6" strokeDasharray="3 8" />

          {/* ── Leader lines: node circle → label column (CITES, left) ── */}
          {cnodes.map((n, i) => {
            const ly = n.y;
            return (
              <polyline key={`cl-${n.id}`}
                points={`${n.x - NR - 2},${n.y} ${CITE_LABEL_X + 160},${ly}`}
                fill="none" stroke="#93C5FD" strokeWidth="0.9" strokeDasharray="3 3" opacity="0.7" />
            );
          })}
          {/* ── Leader lines: node circle → label column (CITED BY, right) ── */}
          {cbnodes.map((n, i) => {
            const ly = n.y;
            return (
              <polyline key={`cbl-${n.id}`}
                points={`${n.x + NR + 2},${n.y} ${CBY_LABEL_X - 160},${ly}`}
                fill="none" stroke="#6EE7B7" strokeWidth="0.9" strokeDasharray="3 3" opacity="0.7" />
            );
          })}

          {/* ── Edges — CITES (dashed arrow, center → satellite) ── */}
          {cnodes.map(n => {
            const p = ep(CX, CY, n.x, n.y, CR + 2, NR + 2);
            return <line key={`ce-${n.id}`} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
              stroke="#2563EB" strokeWidth="1.5" strokeOpacity="0.45" strokeDasharray="5 3"
              markerEnd={`url(#arr-c-${uid})`} />;
          })}

          {/* ── Edges — CITED BY (solid arrow, satellite → center) ── */}
          {cbnodes.map(n => {
            const p = ep(n.x, n.y, CX, CY, NR + 2, CR + 2);
            return <line key={`cbe-${n.id}`} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
              stroke="#0D9488" strokeWidth="1.5" strokeOpacity="0.45"
              markerEnd={`url(#arr-cb-${uid})`} />;
          })}

          {/* Center glow rings */}
          <circle cx={CX} cy={CY} r={CR + 16} fill="#21C1B6" fillOpacity="0.06" />
          <circle cx={CX} cy={CY} r={CR + 8}  fill="#21C1B6" fillOpacity="0.11" />

          {/* Center node circle */}
          <circle cx={CX} cy={CY} r={CR} fill={`url(#cgrad-${uid})`} stroke="#21C1B6" strokeWidth="2.5" />
          {/* Center node label — clipped to circle, word-split */}
          <text x={CX} y={CY + (cl2 ? -6 : 3)} textAnchor="middle" fontSize="9" fontWeight="700"
            fill="#FFFFFF" fontFamily="'Source Sans 3',sans-serif">{cl1}</text>
          {cl2 && <text x={CX} y={CY + 8} textAnchor="middle" fontSize="8.5" fontWeight="600"
            fill="#CBD5E1" fontFamily="'Source Sans 3',sans-serif">{cl2}</text>}

          {/* ── CITES satellite nodes (clickable) ── */}
          {cnodes.map(n => (
            <a key={n.id} href={n.url || '#'} target="_blank" rel="noopener noreferrer"
               style={{ cursor: n.url ? 'pointer' : 'default' }}>
              <title>{n.label}{n.docsource ? ` — ${n.docsource}` : ''}</title>
              {/* Hit area */}
              <circle cx={n.x} cy={n.y} r={NR + 4} fill="transparent" />
              <circle cx={n.x} cy={n.y} r={NR} fill="#EFF6FF" stroke="#2563EB" strokeWidth="1.8" />
              {/* Short abbreviation inside node */}
              <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize="7" fill="#1E40AF"
                fontFamily="'Source Sans 3',sans-serif" fontWeight="700">
                {(n.label || '').split(/\s+/).slice(0, 2).join(' ').slice(0, 10)}
              </text>
              {/* Full label in the left column */}
              <text x={CITE_LABEL_X + 158} y={n.y + 4} textAnchor="end" fontSize="9" fill="#1E3A8A"
                fontFamily="'Source Sans 3',sans-serif" fontWeight="600">{trim(n.label, 30)}</text>
              {n.docsource && <text x={CITE_LABEL_X + 158} y={n.y + 15} textAnchor="end" fontSize="7.5"
                fill="#94A3B8" fontFamily="'Source Sans 3',sans-serif">{n.docsource.slice(0, 24)}</text>}
            </a>
          ))}

          {/* ── CITED BY satellite nodes (clickable) ── */}
          {cbnodes.map(n => (
            <a key={n.id} href={n.url || '#'} target="_blank" rel="noopener noreferrer"
               style={{ cursor: n.url ? 'pointer' : 'default' }}>
              <title>{n.label}{n.docsource ? ` — ${n.docsource}` : ''}</title>
              {/* Hit area */}
              <circle cx={n.x} cy={n.y} r={NR + 4} fill="transparent" />
              <circle cx={n.x} cy={n.y} r={NR} fill="#F0FDFA" stroke="#0D9488" strokeWidth="1.8" />
              {/* Short abbreviation inside node */}
              <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize="7" fill="#0F766E"
                fontFamily="'Source Sans 3',sans-serif" fontWeight="700">
                {(n.label || '').split(/\s+/).slice(0, 2).join(' ').slice(0, 10)}
              </text>
              {/* Full label in the right column */}
              <text x={CBY_LABEL_X - 158} y={n.y + 4} textAnchor="start" fontSize="9" fill="#0F766E"
                fontFamily="'Source Sans 3',sans-serif" fontWeight="600">{trim(n.label, 30)}</text>
              {n.docsource && <text x={CBY_LABEL_X - 158} y={n.y + 15} textAnchor="start" fontSize="7.5"
                fill="#94A3B8" fontFamily="'Source Sans 3',sans-serif">{n.docsource.slice(0, 24)}</text>}
            </a>
          ))}

          {/* "+N more" overflow counters */}
          {citeExtra > 0 && (
            <text x={CITE_LABEL_X + 80} y={VH - 14} textAnchor="middle" fontSize="10" fill="#2563EB"
              fontFamily="'Source Sans 3',sans-serif" fontWeight="700">+{citeExtra} more</text>
          )}
          {cbyExtra > 0 && (
            <text x={CBY_LABEL_X - 80} y={VH - 14} textAnchor="middle" fontSize="10" fill="#0D9488"
              fontFamily="'Source Sans 3',sans-serif" fontWeight="700">+{cbyExtra} more</text>
          )}
        </svg>
      </div>

      {/* Treatment badges */}
      {hasTreat > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {followed.map((nm, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F0FDF4',
              border: '1px solid #BBF7D0', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#166534', fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', flexShrink: 0 }} />
              Followed: {nm.slice(0, 38)}{nm.length > 38 ? '…' : ''}
            </span>
          ))}
          {distinguished.map((nm, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FFFBEB',
              border: '1px solid #FDE68A', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#92400E', fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706', flexShrink: 0 }} />
              Distinguished: {nm.slice(0, 36)}{nm.length > 36 ? '…' : ''}
            </span>
          ))}
          {overruled.map((nm, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#991B1B', fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
              Overruled: {nm.slice(0, 38)}{nm.length > 38 ? '…' : ''}
            </span>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, padding: '7px 14px',
                    background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                       letterSpacing: '.06em', alignSelf: 'center' }}>Legend</span>
        {[
          { col: '#2563EB', lbl: 'Cites (prior art)', dash: true },
          { col: '#0D9488', lbl: 'Cited By (posterior)' },
          { col: '#16A34A', lbl: 'Followed' },
          { col: '#D97706', lbl: 'Distinguished' },
          { col: '#DC2626', lbl: 'Overruled' },
        ].map(({ col, lbl, dash }) => (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="22" height="10" style={{ flexShrink: 0 }}>
              <line x1="0" y1="5" x2="16" y2="5" stroke={col} strokeWidth="2"
                strokeDasharray={dash ? '4 2' : undefined} />
              <polygon points="13,2 20,5 13,8" fill={col} />
            </svg>
            <span style={{ fontSize: 9, color: '#475569', fontWeight: 600 }}>{lbl}</span>
          </div>
        ))}
        <span style={{ fontSize: 9, color: '#64748B', marginLeft: 'auto', alignSelf: 'center' }}>
          Click any node to open source
        </span>
      </div>
    </div>
  );
}

/* ─── Citation Force Graph (Canvas) ─── */
const EDGE_COLORS = { FOLLOWS: '#16A34A', DISTINGUISHES: '#E65100', OVERRULES: '#B71C1C', CITES: '#0D47A1' };
const NODE_COLORS = { FOLLOWS: '#16A34A', DISTINGUISHES: '#E65100', OVERRULES: '#B71C1C', CITES: '#0D47A1' };

function CitationGraphSVG({ nodes, edges }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(null);
  // posRef holds the live layout positions — shared between draw loop and event handlers
  const posRef = useRef({});
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !wrap || !nodes.length) return;

    const DPR = window.devicePixelRatio || 1;
    const W = wrap.clientWidth || 780;
    const H = wrap.clientHeight || 420;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const center = nodes.find(n => n.role === 'center') || nodes[0];

    // Determine each node's primary relationship type for coloring
    const nodeType = {};
    edges.forEach(e => {
      if (e.from !== center?.id) nodeType[e.from] = nodeType[e.from] || e.type;
      if (e.to !== center?.id) nodeType[e.to] = nodeType[e.to] || e.type;
    });

    // Initialize positions — spread related nodes in a circle
    const related = nodes.filter(n => n.id !== center?.id);
    const pos = posRef.current;
    // Reset
    Object.keys(pos).forEach(k => delete pos[k]);
    if (center) pos[center.id] = { x: W / 2, y: H / 2, vx: 0, vy: 0, fixed: true };
    related.forEach((n, i) => {
      const angle = (i / Math.max(related.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const r = Math.min(W, H) * 0.32 + (Math.random() - 0.5) * 30;
      pos[n.id] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle), vx: 0, vy: 0, fixed: false };
    });

    const simulate = () => {
      const REPULSE = 2800, ATTRACT = 0.025, DAMP = 0.75, GRAVITY = 0.008;
      const ids = nodes.map(n => n.id).filter(id => !pos[id]?.fixed);

      // Repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 1;
          const f = REPULSE / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }

      // Edge attraction
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        const f = ATTRACT * d;
        if (!a.fixed) { a.vx += dx / d * f; a.vy += dy / d * f; }
        if (!b.fixed) { b.vx -= dx / d * f; b.vy -= dy / d * f; }
      });

      // Integrate
      ids.forEach(id => {
        const p = pos[id];
        p.vx += (W / 2 - p.x) * GRAVITY;
        p.vy += (H / 2 - p.y) * GRAVITY;
        p.vx *= DAMP; p.vy *= DAMP;
        p.x = Math.max(70, Math.min(W - 70, p.x + p.vx));
        p.y = Math.max(30, Math.min(H - 30, p.y + p.vy));
      });
    };

    const shortLabel = (s, max = 22) => (!s ? '—' : s.length > max ? s.slice(0, max - 1) + '…' : s);

    // Helper: find which node (if any) is under canvas coordinates (cx, cy)
    const hitTest = (cx, cy) => {
      for (const n of nodesRef.current) {
        const p = pos[n.id];
        if (!p) continue;
        const isCenter = n.id === center?.id;
        const r = isCenter ? 22 : 15;
        const dx = cx - p.x, dy = cy - p.y;
        if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return n;
      }
      return null;
    };

    const draw = (hoverId = null) => {
      ctx.clearRect(0, 0, W, H);

      // Edges
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const color = EDGE_COLORS[e.type] || '#94A3B8';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = color + '99';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      });

      // Nodes
      nodes.forEach(n => {
        const p = pos[n.id];
        if (!p) return;
        const isCenter = n.id === center?.id;
        const isHovered = n.id === hoverId;
        const r = isCenter ? 22 : 15;
        const color = isCenter ? '#1B2A4A' : (NODE_COLORS[nodeType[n.id]] || '#4B5563');

        // Glow for center or hovered
        if (isCenter || isHovered) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + (isHovered && !isCenter ? 5 : 7), 0, Math.PI * 2);
          ctx.fillStyle = isCenter ? '#21C1B620' : color + '30';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isHovered && !isCenter ? color + 'EE' : color;
        ctx.fill();
        ctx.strokeStyle = isCenter ? '#21C1B6' : isHovered ? '#FFFFFF' : color + 'CC';
        ctx.lineWidth = isCenter ? 2.5 : isHovered ? 2 : 1;
        ctx.stroke();

        // Label
        const label = shortLabel(n.label || n.id);
        ctx.font = `${isCenter ? '600 ' : ''}11px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isHovered ? '#0F172A' : '#1E293B';
        ctx.fillText(label, p.x, p.y + r + 4);

        // Clickable hint on hover
        if (isHovered && !isCenter) {
          const nodeData = nodesRef.current.find(nd => nd.id === n.id);
          const hint = nodeData?.url ? '🔗 click to open' : '';
          if (hint) {
            ctx.font = '9px sans-serif';
            ctx.fillStyle = '#64748B';
            ctx.fillText(hint, p.x, p.y + r + 17);
          }
        }
      });
    };

    let frame = 0;
    let hoveredId = null;
    const loop = () => {
      if (frame < 300) simulate();
      draw(hoveredId);
      frame++;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    // Mouse move — update hover state
    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width, scaleY = H / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const hit = hitTest(cx, cy);
      hoveredId = hit?.id || null;
      canvas.style.cursor = (hit && hit.id !== center?.id) ? 'pointer' : 'default';
    };

    // Click — open URL
    const onClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width, scaleY = H / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const hit = hitTest(cx, cy);
      if (!hit || hit.id === center?.id) return;
      const url = hit.url || (hit.canonicalId ? `https://indiankanoon.org/doc/${hit.canonicalId}/` : null)
                           || (hit.id ? `https://indiankanoon.org/doc/${hit.id}/` : null);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [nodes, edges]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

/* ─── Helper sub-components ─── */
function JudgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="7" cy="4.5" r="2.8" fill="#94A3B8" />
      <path d="M1.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="#94A3B8" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CourtHeading({ court }) {
  const upper = (court || '').toUpperCase();
  let line1 = 'IN THE SUPREME COURT OF INDIA';
  let line2 = 'CRIMINAL APPELLATE JURISDICTION';
  if (court && !/supreme/i.test(court) && court !== 'Court not specified' && court !== '—') {
    line1 = `IN THE ${upper}`;
    line2 = '';
  }
  return (
    <div style={{ textAlign: 'center', paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ fontFamily: "'Source Serif 4',serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: '#0C4A6E', textTransform: 'uppercase' }}>{line1}</div>
      {line2 && <div style={{ fontFamily: "'Source Sans 3',sans-serif", fontSize: 9, letterSpacing: '0.14em', color: '#94A3B8', textTransform: 'uppercase', marginTop: 4 }}>{line2}</div>}
    </div>
  );
}

/* ─── Live Agent Logs Component ─── */
function LiveAgentLogs({ logs }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!logs || logs.length === 0) return null;

  return (
    <div style={{
      marginTop: 16,
      marginBottom: 8,
      background: '#0F172A',
      borderRadius: 12,
      overflow: 'hidden',
      border: '1px solid #1E293B',
      boxShadow: '0 8px 32px rgba(15,23,42,.15)',
      animation: 'fdUp .4s ease-out'
    }}>
      <div style={{
        padding: '8px 14px',
        background: '#1E293B',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderBottom: '1px solid #0F172A'
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#EF4444', opacity: 0.8 }} />
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#F59E0B', opacity: 0.8 }} />
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#10B981', opacity: 0.8 }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#38BDF8', letterSpacing: '.06em', textTransform: 'uppercase' }}>📡 Agent Pipeline Pipeline Live Logs</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: '#64748B' }}>{logs.length} entries</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#38BDF8', animation: 'pulsate 2s infinite' }} />
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          padding: '12px 14px',
          fontFamily: '"JetBrains Mono", "Fira Code", "Menlo", monospace',
          fontSize: 11,
          lineHeight: 1.6,
          color: '#94A3B8'
        }}
        className="sc-dark"
      >
        {logs.map((log, i) => {
          const levelColor = { ERROR: '#F87171', WARNING: '#FCD34D', INFO: '#34D399', DEBUG: '#64748B' }[log.log_level] || '#94A3B8';
          const ts = log.created_at ? new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
          const isSuccess = log.message?.includes('✅') || log.message?.includes('🎉') || log.message?.includes('Successfully');
          return (
            <div key={log.id || i} style={{ marginBottom: 5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: '#0EA5E9', fontSize: 9, opacity: 0.6, flexShrink: 0, marginTop: 1, minWidth: 48 }}>{ts}</span>
              <span style={{ color: levelColor, fontSize: 8, fontWeight: 800, flexShrink: 0, width: 64, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.02em' }}>{log.agent_name || 'watchdog'}</span>
              <span style={{ flex: 1, wordBreak: 'break-word', color: isSuccess ? '#34D399' : '#CBD5E1', fontSize: 11.5 }}>{log.message}</span>
            </div>
          );
        })}
      </div>
      <style>{`
        .sc-dark::-webkit-scrollbar { width: 5px; }
        .sc-dark::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .sc-dark::-webkit-scrollbar-track { background: #0F172A; }
        @keyframes pulsate { 0% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0.4; transform: scale(1); } }
      `}</style>
    </div>
  );
}

/* ─── Build plain-text content for RAG upload ─── */
function buildReportText(c, query, generatedAt) {
  const exc = c.excerpt || {};
  const treat = c.treatment || {};
  return [
    'JURINEX CITATION INTELLIGENCE REPORT',
    `Query: ${query || '—'}`, `Generated: ${generatedAt || '—'}`, '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `CASE NAME: ${c.caseName}`,
    `PRIMARY CITATION: ${c.primaryCitation || '—'}`,
    `EQUIVALENT CITATIONS: ${(c.alternateCitations || []).join('; ') || '—'}`,
    `COURT: ${c.court || '—'}`, `CORAM: ${c.coram || '—'}`,
    `BENCH TYPE: ${c.benchType || '—'}`, `DATE: ${c.dateOfJudgment || '—'}`,
    `STATUTORY PROVISIONS: ${(c.statutes || []).join(', ') || '—'}`, '',
    'RATIO DECIDENDI:', c.ratio || '—', '',
    `SOURCE EXCERPT (${exc.para || 'Para'}):`,
    (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—', '',
    'SUBSEQUENT TREATMENT:',
    `  Followed In: ${treat.followed ?? 0} cases`,
    `  Distinguished In: ${treat.distinguished ?? 0} cases`,
    `  Overruled By: ${treat.overruled ?? 0} cases`,
    ...(treat.followedList?.length ? [`  Followed: ${treat.followedList.join(', ')}`] : []),
    ...(treat.distinguishedList?.length ? [`  Distinguished: ${treat.distinguishedList.join(', ')}`] : []),
    '', `VERIFICATION: ${c.verificationStatusLabel || c.verificationStatus || '—'}`,
    `CONFIDENCE: ${c.confidence || 0}%`, `SOURCE: ${c.fetchedFrom || c.sourceLabel || '—'}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

/* ─── Build full report plain text (all citations) for auto-upload to case folder ─── */
function buildFullReportText(reportFormat, query) {
  const citations = reportFormat?.citations || [];
  const generatedAt = reportFormat?.generatedAt || '';
  const header = [
    'JURINEX CITATION REPORT — FULL REPORT',
    `Query: ${query || '—'}`,
    `Generated: ${generatedAt || '—'}`,
    `Total citations: ${citations.length}`,
    '',
    '═══════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const sections = citations.map((c, i) => {
    const one = buildReportText(c, query, generatedAt);
    return `[Citation ${i + 1} of ${citations.length}]\n${one}\n`;
  });
  return header + sections.join('\n');
}

/* ─── Escape for HTML ─── */
function esc(s) {
  if (s == null || s === '') return '—';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Build full report HTML — exact match to ReportDoc UI layout ─── */
/* NOTE: Uses <table> for ALL multi-column layouts — html2canvas does not reliably
   render display:grid or multi-column display:flex, but renders <table> correctly. */
function buildFullReportHtml(reportFormat, query) {
  const citations = reportFormat?.citations || [];
  const generatedAt = reportFormat?.generatedAt || '';

  const baseStyles = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Source+Sans+3:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;background:#EAECF0;color:#0F172A;font-size:12px;padding:20px 14px 40px}
.serif{font-family:'Source Serif 4','Georgia',serif}
.sans{font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif}
.paper{background:#FFFFFF;border:1px solid #D4D9E2;border-radius:6px;overflow:hidden;margin-bottom:18px}
.inner{padding:26px 32px 22px}
.lbl{font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px}
.sub-h{font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;margin:14px 0 7px}
.chip{display:inline-block;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;padding:2px 8px;border-radius:3px;margin:2px 3px 2px 0}
.ratio-block{border-left:3px solid #21C1B6;background:#F0FFFE;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:15px;font-style:italic;line-height:2;color:#0F172A}.headnote-block{border-left:3px solid #21C1B6;background:#F0FFFE;border:1px solid #99E6E3;padding:16px 20px;border-radius:4px}
.prop-box{border:1px solid #E2E8F0;background:#F8FAFC;padding:11px 14px;border-radius:4px}
.excerpt-box{border:1px solid #D4E2E8;background:#FFFDFB;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:14px;line-height:2;color:#1B2A4A;border-radius:4px}
@media print{.paper{page-break-inside:avoid}.paper+.paper{page-break-before:always}}
`;

  const titleHtml = `
<div style="background:#FFFFFF;border:1px solid #D4D9E2;border-radius:6px;padding:40px 24px;text-align:center;margin-bottom:18px">
  <div class="serif" style="font-size:22px;font-weight:700;color:#1B2A4A;margin-bottom:8px">JURINEX CITATION REPORT</div>
  <div class="sans" style="font-size:13px;color:#334155;margin-top:8px">${esc(query)}</div>
  <div class="sans" style="font-size:11px;color:#64748B;margin-top:14px">Generated: ${esc(generatedAt)}</div>
  <div class="sans" style="font-size:11px;color:#64748B;margin-top:6px">${citations.length} citation(s)</div>
</div>`;

  const citationBlocks = citations.map((c, idx) => {
    const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
    const exc = c.excerpt || {};
    const treat = c.treatment || {};
    const followedList = treat.followedList || [];
    const distinguishedList = treat.distinguishedList || [];
    const overruledList = treat.overruledList || [];
    const reversedList = treat.reversedList || [];
    const reliedOnList = treat.reliedOnList || [];
    const appliedList = treat.appliedList || [];
    const citedList = treat.citedList || [];
    const referredList = treat.referredList || [];
    const approvedList = treat.approvedList || [];
    const score = (c.proposition || {}).matchScore ?? 0;
    const verdict = (c.proposition || {}).verdict || 'REVIEW';
    const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
    const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
    const excerptText = (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—';
    const courtLine = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified'
      ? 'IN THE SUPREME COURT OF INDIA' : `IN THE ${(c.court || '').toUpperCase()}`;
    const showJuris = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified';

    // YELLOW banner — uses <table> for 2-col claim/actual section
    const yellowBanner = c.verificationStatus === 'YELLOW' ? `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;margin-bottom:18px"><tr>
  <td style="padding:11px 6px 11px 14px;width:22px;vertical-align:top"><span style="font-size:14px">&#9888;</span></td>
  <td style="padding:11px 14px 11px 4px;vertical-align:top">
    <div class="sans" style="font-size:10px;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Review Suggested — Source Attached</div>
    <div class="sans" style="font-size:11px;color:#92400E;line-height:1.55;margin-bottom:9px">This citation exists but the way it was used may not precisely match the holding. Please verify independently before relying on it in court.</div>
    <div class="sans" style="font-size:9px;color:#92400E;font-weight:700;margin-bottom:3px">Proposition Alignment: ${score}%</div>
    <div style="height:6px;background:#FDE68A;border-radius:3px;margin-bottom:10px"><div style="height:6px;width:${score}%;background:${score >= 75 ? '#D97706' : '#EF4444'};border-radius:3px"></div></div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;padding-right:4px;vertical-align:top">
        <div style="background:#FFFDE7;border:1px solid #FDE68A;border-radius:4px;padding:8px 10px">
          <div class="sans" style="font-size:8px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">What was claimed</div>
          <div class="serif" style="font-size:11px;color:#1E293B;line-height:1.55;font-style:italic">"${esc((c.proposition || {}).query || query || '—')}"</div>
        </div>
      </td>
      <td style="width:50%;padding-left:4px;vertical-align:top">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:4px;padding:8px 10px">
          <div class="sans" style="font-size:8px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Actual holding</div>
          <div class="serif" style="font-size:11px;color:#1E293B;line-height:1.55">${esc((c.ratio || '—').slice(0, 220))}${(c.ratio || '').length > 220 ? '…' : ''}</div>
        </div>
      </td>
    </tr></table>
  </td>
</tr></table>` : '';

    // STALE banner
    const staleBanner = c.verificationStatus === 'STALE' ? `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;margin-bottom:18px"><tr>
  <td style="padding:11px 6px 11px 14px;width:22px;vertical-align:top"><span style="font-size:14px">&#8635;</span></td>
  <td style="padding:11px 14px 11px 4px;vertical-align:top">
    <div class="sans" style="font-size:10px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Freshness Check Pending</div>
    <div class="sans" style="font-size:11px;color:#7C2D12;line-height:1.55">${esc(c.staleReason || 'This citation was previously verified but a recent development may have affected its validity. We are re-checking.')}</div>
    <div class="sans" style="font-size:10px;color:#EA580C;margin-top:4px;font-weight:600">Do not rely on this citation until the check completes.</div>
  </td>
</tr></table>` : '';

    // Judges list (no flex — simple block divs)
    const judgesHtml = judges.length > 0
      ? judges.map(j => `<div style="margin-bottom:5px"><span style="color:#94A3B8;font-size:10px">&#9711;</span> <span class="serif" style="font-size:12px;color:#1E293B">${esc(j)}</span></div>`).join('')
      : `<span class="serif" style="font-size:12px;color:#94A3B8">—</span>`;

    // Statutes chips (inline-block)
    const statutesHtml = (c.statutes || []).length
      ? (c.statutes || []).map(st => `<span class="chip">${esc(st)}</span>`).join('')
      : `<span class="serif" style="font-size:12px;color:#94A3B8">—</span>`;

    // 3-stat treatment box — table columns
    const ovrBg = overruledList.length ? '#FEF2F2' : '#F8FAFC';
    const ovrCol = overruledList.length ? '#991B1B' : '#475569';
    const ovrBdr = overruledList.length ? '#FECACA' : '#E2E8F0';
    const treatStats3 = `
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:10px"><tr>
  <td style="background:#F0FDF4;border-right:1px solid #BBF7D0;padding:12px 18px;vertical-align:top;width:33%">
    <div class="serif" style="font-size:28px;font-weight:700;color:#166534;line-height:1">${followedList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin-top:4px">Followed In</div>
    <div class="sans" style="font-size:10px;color:#166534;margin-top:2px">Cases</div>
  </td>
  <td style="background:#FFFBEB;border-right:1px solid ${ovrBdr};padding:12px 18px;vertical-align:top;width:33%">
    <div class="serif" style="font-size:28px;font-weight:700;color:#92400E;line-height:1">${distinguishedList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#92400E;margin-top:4px">Distinguished In</div>
    <div class="sans" style="font-size:10px;color:#92400E;margin-top:2px">Cases</div>
  </td>
  <td style="background:${ovrBg};padding:12px 18px;vertical-align:top;width:34%">
    <div class="serif" style="font-size:28px;font-weight:700;color:${ovrCol};line-height:1">${overruledList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ovrCol};margin-top:4px">Overruled By</div>
    <div class="sans" style="font-size:10px;color:${ovrCol};margin-top:2px">Cases</div>
  </td>
</tr></table>`;

    // Secondary treatment pills — inline-block spans (no flex)
    const secondaryTreats = [
      { list: reliedOnList, label: 'Relied On', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' },
      { list: appliedList, label: 'Applied', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' },
      { list: citedList, label: 'Cited', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' },
      { list: referredList, label: 'Referred To', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' },
      { list: reversedList, label: 'Reversed', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' },
      { list: approvedList, label: 'Approved', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' },
    ].filter(p => p.list.length > 0);
    const secondaryHtml = secondaryTreats.length > 0 ? `
<div style="margin-bottom:10px">
  ${secondaryTreats.map(p => `<span style="display:inline-block;background:${p.bg};border:1px solid ${p.bdr};border-radius:5px;padding:4px 10px;margin:3px 4px 3px 0"><span style="font-size:13px;font-weight:800;color:${p.col}">${p.list.length}</span> <span style="font-size:9px;font-weight:700;color:${p.col};text-transform:uppercase;letter-spacing:.07em">${p.label}</span></span>`).join('')}
</div>` : '';

    // Treatment case rows — table
    const treatRows = [
      ...followedList.map(n => ({ n, type: 'FOLLOWED', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' })),
      ...distinguishedList.map(n => ({ n, type: 'DISTINGUISHED', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' })),
      ...overruledList.map(n => ({ n, type: 'OVERRULED', col: '#991B1B', bg: '#FEF2F2', bdr: '#FECACA' })),
      ...reversedList.map(n => ({ n, type: 'REVERSED', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' })),
      ...reliedOnList.map(n => ({ n, type: 'RELIED ON', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' })),
      ...appliedList.map(n => ({ n, type: 'APPLIED', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' })),
      ...citedList.map(n => ({ n, type: 'CITED', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' })),
      ...referredList.map(n => ({ n, type: 'REFERRED TO', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' })),
      ...approvedList.map(n => ({ n, type: 'APPROVED', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' })),
    ];
    const treatRowsHtml = treatRows.length > 0
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:6px">${treatRows.map((item, i) => `<tr style="background:#FFFFFF"><td style="padding:9px 14px;border-bottom:${i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none'};vertical-align:top"><div class="serif" style="font-size:13px;font-weight:600;color:#1E293B">${esc(item.n)}</div></td><td style="padding:9px 14px;border-bottom:${i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none'};vertical-align:top;text-align:right;width:1%;white-space:nowrap"><span style="display:inline-block;background:${item.bg};color:${item.col};border:1px solid ${item.bdr};font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;padding:2px 8px;border-radius:2px;letter-spacing:.06em">${item.type}</span></td></tr>`).join('')}</table>`
      : `<div style="font-size:11px;color:#94A3B8;padding:8px 0;font-style:italic">No subsequent treatment references found in judgment text.</div>`;

    // Source link
    const srcKey = c.source || 'unknown';
    const srcTxt = srcKey === 'local' ? 'Local DB' : srcKey === 'indian_kanoon' ? 'Indian Kanoon' : srcKey === 'google' ? 'Google Search (Gemini)' : (c.sourceApplication || c.sourceLabel || 'Unknown Source');
    const srcLinkUrl = c.importSourceLink || c.sourceUrl || c.officialSourceLink;
    const srcLinkHtml = srcLinkUrl ? `<div class="sans" style="font-size:9px;color:#94A3B8;margin-bottom:5px">Source: ${esc(srcTxt)} &middot; <a href="${esc(srcLinkUrl)}" style="color:#1D4ED8">Open document</a></div>` : '';

    return `
<div class="paper">
  <div class="inner">
    ${staleBanner}
    ${yellowBanner}

    <div style="text-align:center;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid #E2E8F0">
      <div class="serif" style="font-size:11px;font-weight:700;letter-spacing:.22em;color:#0C4A6E;text-transform:uppercase">${esc(courtLine)}</div>
      ${showJuris ? '<div class="sans" style="font-size:9px;letter-spacing:.14em;color:#94A3B8;text-transform:uppercase;margin-top:4px">CRIMINAL APPELLATE JURISDICTION</div>' : ''}
    </div>

    <h1 class="serif" style="text-align:center;font-size:21px;font-weight:700;color:#0F172A;line-height:1.3;margin-bottom:18px">${esc(c.caseName)}</h1>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;margin-bottom:16px;overflow:hidden"><tr>
      <td style="width:160px;padding:10px 14px;border-right:1px solid #E2E8F0;vertical-align:top">
        <div class="lbl">Primary Citation</div>
        <div class="serif" style="font-size:13px;font-weight:700;color:#0F172A">${esc(c.primaryCitation || '—')}</div>
      </td>
      <td style="padding:10px 14px;border-right:1px solid #E2E8F0;vertical-align:top">
        <div class="lbl">Equivalent Citations</div>
        <div class="serif" style="font-size:11.5px;color:#334155;line-height:1.5">${esc((c.alternateCitations || []).join('; ') || '—')}</div>
      </td>
      <td style="width:155px;padding:10px 14px;vertical-align:top">
        <div class="lbl">Date of Judgment</div>
        <div class="serif" style="font-size:12px;font-weight:600;color:#0F172A">${esc(c.dateOfJudgment || '—')}</div>
      </td>
    </tr></table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px"><tr>
      <td style="width:50%;padding-right:8px;vertical-align:top">
        <div class="lbl">Coram / Bench</div>
        <div style="margin-top:4px">${judgesHtml}</div>
        ${c.benchType && c.benchType !== '—' ? `<div class="sans" style="font-size:9px;color:#64748B;margin-top:2px">${esc(c.benchType)}</div>` : ''}
      </td>
      <td style="width:50%;padding-left:8px;vertical-align:top">
        <div class="lbl">Statutory Provisions</div>
        <div style="margin-top:4px">${statutesHtml}</div>
      </td>
    </tr></table>

    ${c.headnote && c.headnote.trim() ? `<div style="margin:22px 0 10px;border-left:3px solid #21C1B6;padding-left:9px"><span class="sans" style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1B2A4A">Judgment Headnote</span></div><div class="headnote-block">${c.headnote.split('\n').filter(l=>l.trim()).map(l=>`<div class="serif" style="font-size:14px;color:#1B2A4A;line-height:1.9;margin-bottom:9px">${esc(l)}</div>`).join('')}</div>` : ''}
    <div style="margin:22px 0 10px;border-left:3px solid #21C1B6;padding-left:9px">
      <span class="sans" style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1B2A4A">I. Legal Analysis &amp; Ratio</span>
    </div>
    <div class="ratio-block">"${esc(c.ratio || '—')}"</div>

    <div class="sub-h">Source Excerpt (${esc(exc.para || 'Para —')})</div>
    <div class="excerpt-box">"${esc(excerptText)}"</div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;padding-top:14px;border-top:1px solid #E2E8F0"><tr>
      <td style="vertical-align:bottom">
        <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.15em;color:#1B2A4A;text-transform:uppercase;margin-bottom:4px">Jurinex Legal Intelligence Report</div>
        <div class="sans" style="font-size:9px;color:#94A3B8;margin-bottom:2px">Generated on ${esc(generatedAt || '—')}</div>
        ${srcLinkHtml}
        <span style="display:inline-block;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:3px;padding:2px 9px">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#16A34A;vertical-align:middle;margin-right:4px"></span><span class="sans" style="font-size:8px;font-weight:700;color:#15803D;letter-spacing:.07em">AUTHENTICATED RESEARCH DOCUMENT</span>
        </span>
      </td>
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:12px">
        <div class="sans" style="font-size:9px;color:#94A3B8">Citation ${idx + 1} of ${citations.length}</div>
      </td>
    </tr></table>
  </div>
</div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>${titleHtml}${citationBlocks.join('')}</body></html>`;
}


/* ─── Build a plain-SVG citation network string for print HTML ─── */
async function renderHtmlToPdfBlob(html, options = {}) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:210mm',
    'min-height:297mm',
    'border:none',
    'opacity:0.01',
    'pointer-events:none',
    'background:#fff',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(iframe);

  try {
    const frameDoc = iframe.contentDocument;
    if (!frameDoc) throw new Error('Unable to initialize PDF render frame.');

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    await new Promise((resolve) => {
      if (iframe.contentWindow?.document?.readyState === 'complete') {
        resolve();
        return;
      }
      iframe.onload = () => resolve();
      setTimeout(resolve, 800);
    });

    if (frameDoc.fonts?.ready) {
      try { await frameDoc.fonts.ready; } catch { /* no-op */ }
    }

    const images = Array.from(frameDoc.images || []);
    await Promise.all(images.map((img) => (
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })
    )));

    const sourceNode = frameDoc.body;
    if (!sourceNode || !sourceNode.childNodes.length) {
      throw new Error('Generated PDF content is empty.');
    }

    return await html2pdf()
      .set({
        margin: options.margin ?? 10,
        filename: options.filename || '',
        enableLinks: options.enableLinks ?? false,
        pagebreak: { mode: ['css', 'legacy'] },
        html2canvas: {
          scale: options.scale ?? 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.max(sourceNode.scrollWidth, 1024),
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
          compress: true,
        },
      })
      .from(sourceNode)
      .outputPdf('blob');
  } finally {
    iframe.remove();
  }
}

function buildPrintNetworkSvg(c) {
  const cites     = (c.ikCiteList    || []).slice(0, 7);
  const citedBy   = (c.ikCitedByList || []).slice(0, 7);
  const citeExtra = Math.max(0, (c.ikCiteList    || []).length - 7);
  const cbyExtra  = Math.max(0, (c.ikCitedByList || []).length - 7);
  if (!cites.length && !citedBy.length) return '';

  const VW = 860, VH = 420, CX = VW / 2, CY = VH / 2;
  const ORBIT = 210, CR = 36, NR = 20;
  const CITE_LX = 14, CBY_LX = VW - 14;
  const toRad = d => (d * Math.PI) / 180;
  const svgEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const trim = (s, n = 30) => !s ? '—' : s.length > n ? s.slice(0, n - 1) + '…' : s;

  const placeArc = (items, s0, e0) => {
    if (!items.length) return [];
    const s = toRad(s0), e = toRad(e0);
    return items.map((item, i) => {
      const t = items.length === 1 ? 0.5 : i / (items.length - 1);
      const a = s + t * (e - s);
      return {
        ...item,
        x: CX + ORBIT * Math.cos(a),
        y: CY + ORBIT * Math.sin(a),
        label: item.title || `Doc #${item.tid}`,
        url: item.url || (item.tid ? `https://indiankanoon.org/doc/${item.tid}/` : null),
      };
    });
  };

  const cnodes  = placeArc(cites,   135, 225);
  const cbnodes = placeArc(citedBy, -45,  45);

  const ep = (x1, y1, x2, y2, r1, r2) => {
    const dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x1: x1 + (dx / d) * r1, y1: y1 + (dy / d) * r1, x2: x2 - (dx / d) * r2, y2: y2 - (dy / d) * r2 };
  };

  const centerWords = (c.caseName || '').split(/\s+/).filter(Boolean);
  let cl1 = '', cl2 = '';
  for (const w of centerWords) {
    if (!cl1 && w.length <= 12) { cl1 = w; continue; }
    if (cl1 && !cl2 && (cl1 + ' ' + w).length <= 12) { cl1 += ' ' + w; continue; }
    if (!cl2 && w.length <= 12) { cl2 = w; continue; }
    if (cl2 && (cl2 + ' ' + w).length <= 12) { cl2 += ' ' + w; continue; }
    break;
  }
  if (!cl1) cl1 = (c.caseName || '').slice(0, 12);

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%">`);
  parts.push(`<defs>
    <marker id="pnarrc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2563EB" opacity="0.85"/></marker>
    <marker id="pnarrcb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#0D9488" opacity="0.85"/></marker>
    <radialGradient id="pncgrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#2C4066"/><stop offset="100%" stop-color="#1B2A4A"/></radialGradient>
  </defs>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${ORBIT}" fill="none" stroke="#D4E8EE" stroke-width="0.8" stroke-dasharray="4 6"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${ORBIT * 0.52}" fill="none" stroke="#D4E8EE" stroke-width="0.6" stroke-dasharray="3 8"/>`);

  cnodes.forEach(n => parts.push(`<polyline points="${n.x - NR - 2},${n.y} ${CITE_LX + 160},${n.y}" fill="none" stroke="#93C5FD" stroke-width="0.9" stroke-dasharray="3 3" opacity="0.7"/>`));
  cbnodes.forEach(n => parts.push(`<polyline points="${n.x + NR + 2},${n.y} ${CBY_LX - 160},${n.y}" fill="none" stroke="#6EE7B7" stroke-width="0.9" stroke-dasharray="3 3" opacity="0.7"/>`));

  cnodes.forEach(n => { const p = ep(CX, CY, n.x, n.y, CR + 2, NR + 2); parts.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="#2563EB" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="5 3" marker-end="url(#pnarrc)"/>`); });
  cbnodes.forEach(n => { const p = ep(n.x, n.y, CX, CY, NR + 2, CR + 2); parts.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="#0D9488" stroke-width="1.5" stroke-opacity="0.45" marker-end="url(#pnarrcb)"/>`); });

  parts.push(`<circle cx="${CX}" cy="${CY}" r="${CR + 16}" fill="#21C1B6" fill-opacity="0.06"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${CR + 8}" fill="#21C1B6" fill-opacity="0.11"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${CR}" fill="url(#pncgrad)" stroke="#21C1B6" stroke-width="2.5"/>`);
  parts.push(`<text x="${CX}" y="${CY + (cl2 ? -6 : 3)}" text-anchor="middle" font-size="9" font-weight="700" fill="#FFFFFF" font-family="'Source Sans 3',sans-serif">${svgEsc(cl1)}</text>`);
  if (cl2) parts.push(`<text x="${CX}" y="${CY + 8}" text-anchor="middle" font-size="8.5" font-weight="600" fill="#CBD5E1" font-family="'Source Sans 3',sans-serif">${svgEsc(cl2)}</text>`);

  cnodes.forEach(n => {
    const abbr = (n.label || '').split(/\s+/).slice(0, 2).join(' ').slice(0, 10);
    const inner = `<circle cx="${n.x}" cy="${n.y}" r="${NR + 4}" fill="transparent"/>
      <circle cx="${n.x}" cy="${n.y}" r="${NR}" fill="#EFF6FF" stroke="#2563EB" stroke-width="1.8"/>
      <text x="${n.x}" y="${n.y + 3.5}" text-anchor="middle" font-size="7" fill="#1E40AF" font-family="'Source Sans 3',sans-serif" font-weight="700">${svgEsc(abbr)}</text>
      <text x="${CITE_LX + 158}" y="${n.y + 4}" text-anchor="end" font-size="9" fill="#1E3A8A" font-family="'Source Sans 3',sans-serif" font-weight="600">${svgEsc(trim(n.label, 30))}</text>`;
    parts.push(n.url ? `<a href="${svgEsc(n.url)}" target="_blank">${inner}</a>` : `<g>${inner}</g>`);
  });

  cbnodes.forEach(n => {
    const abbr = (n.label || '').split(/\s+/).slice(0, 2).join(' ').slice(0, 10);
    const inner = `<circle cx="${n.x}" cy="${n.y}" r="${NR + 4}" fill="transparent"/>
      <circle cx="${n.x}" cy="${n.y}" r="${NR}" fill="#F0FDFA" stroke="#0D9488" stroke-width="1.8"/>
      <text x="${n.x}" y="${n.y + 3.5}" text-anchor="middle" font-size="7" fill="#0F766E" font-family="'Source Sans 3',sans-serif" font-weight="700">${svgEsc(abbr)}</text>
      <text x="${CBY_LX - 158}" y="${n.y + 4}" text-anchor="start" font-size="9" fill="#0F766E" font-family="'Source Sans 3',sans-serif" font-weight="600">${svgEsc(trim(n.label, 30))}</text>`;
    parts.push(n.url ? `<a href="${svgEsc(n.url)}" target="_blank">${inner}</a>` : `<g>${inner}</g>`);
  });

  if (citeExtra > 0) parts.push(`<text x="${CITE_LX + 80}" y="${VH - 14}" text-anchor="middle" font-size="10" fill="#2563EB" font-family="'Source Sans 3',sans-serif" font-weight="700">+${citeExtra} more</text>`);
  if (cbyExtra > 0) parts.push(`<text x="${CBY_LX - 80}" y="${VH - 14}" text-anchor="middle" font-size="10" fill="#0D9488" font-family="'Source Sans 3',sans-serif" font-weight="700">+${cbyExtra} more</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

/* ─── Generate print window with only this citation ─── */
async function downloadCitationPDF(c, query, generatedAt) {
  const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
  const exc = c.excerpt || {};
  const treat = c.treatment || {};
  const score = (c.proposition || {}).matchScore ?? 0;
  const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
  const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
  const excerptText = (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—';
  const courtLine = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified'
    ? 'IN THE SUPREME COURT OF INDIA' : `IN THE ${(c.court || '').toUpperCase()}`;
  const showJuris = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified';

  // Source URL and label for footer "Open document" link
  const srcUrl = c.importSourceLink || c.sourceUrl || c.officialSourceLink || null;
  const srcLabel = c.source === 'local' ? 'Local DB'
    : c.source === 'indian_kanoon' ? 'Indian Kanoon'
    : c.source === 'google' ? 'Google Search'
    : (c.source === 'web' || c.sourceTier === 'web' || c._source === 'web_tier3') ? 'Web (Verified)'
    : (c.sourceApplication || c.sourceLabel || 'Source');
  const caseNameHtml = srcUrl
    ? `<a href="${srcUrl}" target="_blank" style="color:inherit;text-decoration:none;border-bottom:2px solid #21C1B6">${c.caseName}</a>`
    : c.caseName;

  // SVG citation network (empty string if no data)
  const graphSvg = buildPrintNetworkSvg(c);
  const graphSection = graphSvg
    ? `<div class="sec-h">III. Citation Network</div>
<div style="border:1px solid #C5E4EE;border-radius:6px;overflow:hidden;margin-bottom:14px">
  <div style="display:flex;justify-content:space-between;padding:7px 14px;background:#EEF6FA;border-bottom:1px solid #C5E4EE">
    <span style="font-size:10px;font-weight:700;color:#1E40AF;font-family:'Source Sans 3',sans-serif">← CASES CITED (${(c.ikCiteList || []).length})</span>
    <span style="font-size:9px;color:#64748B;font-style:italic;font-family:'Source Serif 4',serif">${(c.caseName || '').slice(0, 60)}</span>
    <span style="font-size:10px;font-weight:700;color:#0F766E;font-family:'Source Sans 3',sans-serif">CITED BY (${(c.ikCitedByList || []).length}) →</span>
  </div>
  <div style="background:#F8FBFD">${graphSvg}</div>
</div>`
    : '';

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${c.caseName} — Jurinex Citation Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Source+Sans+3:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;background:#fff;padding:36px 48px;color:#0F172A;font-size:12px}
a{color:inherit;text-decoration:underline;text-decoration-color:#21C1B6}
.court{text-align:center;font-family:'Source Serif 4',serif;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#0C4A6E;margin-bottom:4px}
.juris{text-align:center;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px}
h1{font-family:'Source Serif 4',serif;font-size:20px;font-weight:700;text-align:center;margin:0 0 16px;color:#0F172A;line-height:1.3}
.grid3{display:grid;grid-template-columns:155px 1fr 150px;border:1px solid #E2E8F0;border-radius:4px;margin-bottom:14px;overflow:hidden}
.cell{padding:9px 13px;border-right:1px solid #E2E8F0}.cell:last-child{border-right:none}
.lbl{font-size:7px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px}
.val{font-family:'Source Serif 4',serif;font-size:12px;font-weight:700;color:#0F172A}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}
.sec-h{border-left:3px solid #21C1B6;padding-left:9px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1B2A4A;margin:20px 0 10px}
.ratio{border-left:3px solid #21C1B6;background:#F0FFFE;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:15px;font-style:italic;line-height:2;color:#0F172A}.headnote{border-left:3px solid #21C1B6;background:#F0FFFE;border:1px solid #99E6E3;padding:16px 20px;border-radius:4px}
.sub-h{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;margin:12px 0 5px}
.prop{border:1px solid #E2E8F0;background:#F8FAFC;padding:10px 14px;border-radius:4px}
.match{display:inline-block;color:#fff;font-size:8px;font-weight:700;padding:2px 9px;border-radius:3px;margin-right:8px;letter-spacing:.06em}
.excerpt{border:1px solid #D4E2E8;background:#FFFDFB;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:14px;line-height:2;color:#1B2A4A;border-radius:4px}
.chip{display:inline-block;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;margin:2px 3px 2px 0}
.treats{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:10px}
.tstat{padding:10px 16px}.tcount{font-family:'Source Serif 4',serif;font-size:26px;font-weight:700;line-height:1}
.footer{margin-top:20px;padding-top:12px;border-top:1px solid #E2E8F0}
.auth{display:inline-flex;align-items:center;gap:4px;background:#F0FDF4;border:1px solid #BBF7D0;padding:2px 9px;border-radius:3px;font-size:7px;font-weight:700;color:#15803D;letter-spacing:.07em;margin-top:6px}
@media print{body{padding:20px 24px}@page{size:A4 portrait;margin:1cm}}
</style></head><body>
<div class="court">${courtLine}</div>
${showJuris ? '<div class="juris">CRIMINAL APPELLATE JURISDICTION</div>' : ''}
<h1>${caseNameHtml}</h1>
<div class="grid3">
  <div class="cell"><div class="lbl">Primary Citation</div><div class="val" style="font-size:13px">${c.primaryCitation || '—'}</div></div>
  <div class="cell"><div class="lbl">Equivalent Citations</div><div class="val" style="font-size:11px;font-weight:400">${(c.alternateCitations || []).join('; ') || '—'}</div></div>
  <div class="cell"><div class="lbl">Date of Judgment</div><div class="val" style="font-size:12px">${c.dateOfJudgment || '—'}</div></div>
</div>
<div class="grid2">
  <div><div class="lbl">Coram / Bench</div><div style="margin-top:4px">${judges.map(j => `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><span style="color:#94A3B8;font-size:10px">◉</span><span style="font-family:'Source Serif 4',serif;font-size:12px">${j}</span></div>`).join('') || '—'}</div>${c.benchType && c.benchType !== '—' ? `<div style="font-size:9px;color:#64748B;margin-top:3px">${c.benchType}</div>` : ''}</div>
  <div><div class="lbl">Statutory Provisions</div><div style="margin-top:4px">${(c.statutes || []).map(s => `<span class="chip">${s}</span>`).join('') || '—'}</div></div>
</div>
${c.headnote && c.headnote.trim() ? `<div class="sec-h">Judgment Headnote</div><div class="headnote">${c.headnote.split('\n').filter(l=>l.trim()).map(l=>`<div style="font-family:'Source Serif 4',serif;font-size:14px;color:#1B2A4A;line-height:1.9;margin-bottom:9px">${l}</div>`).join('')}</div>` : ''}
<div class="sec-h">I. Legal Analysis &amp; Ratio</div>
<div class="ratio">"${c.ratio || '—'}"</div>
<div class="sub-h">Proposition Verification</div>
<div class="prop">
  <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748B;margin-bottom:4px">Query</div>
  <div style="font-family:'Source Serif 4',serif;font-size:12px;color:#1E293B;margin-bottom:8px">${(c.proposition || {}).query || query || '—'}</div>
  <span class="match" style="background:${matchColor}">${matchLabel}</span>
  <span style="font-size:9px;color:#64748B">Semantic Similarity: ${(score / 100).toFixed(2)}</span>
</div>
<div class="sub-h">Source Excerpt (${exc.para || 'Para —'})</div>
<div class="excerpt">"${excerptText}"</div>
<div class="sec-h" style="margin-top:20px">II. Subsequent Treatment</div>
<div class="treats">
  <div class="tstat" style="background:#F0FDF4;border-right:1px solid #BBF7D0"><div class="tcount" style="color:#166534">${treat.followed ?? 0}</div><div style="font-size:8px;font-weight:700;color:#166534;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Followed In</div><div style="font-size:9px;color:#166534">Cases</div></div>
  <div class="tstat" style="background:#FFFBEB;border-right:1px solid #FDE68A"><div class="tcount" style="color:#92400E">${treat.distinguished ?? 0}</div><div style="font-size:8px;font-weight:700;color:#92400E;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Distinguished In</div><div style="font-size:9px;color:#92400E">Cases</div></div>
  <div class="tstat" style="background:#F8FAFC"><div class="tcount" style="color:#475569">${treat.overruled ?? 0}</div><div style="font-size:8px;font-weight:700;color:#475569;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Overruled By</div><div style="font-size:9px;color:#475569">Cases</div></div>
</div>
${graphSection}
<div class="footer">
  <div style="font-size:8px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#1B2A4A;margin-bottom:3px">Jurinex Legal Intelligence Report</div>
  <div style="font-size:8px;color:#94A3B8;margin-bottom:2px">Generated on ${generatedAt || '—'}</div>
  ${srcUrl ? `<div style="font-size:8px;color:#94A3B8;margin-bottom:4px">Source: ${srcLabel} &middot; <a href="${srcUrl}" target="_blank" style="color:#1D4ED8;text-decoration:none">Open document</a></div>` : ''}
  <div class="auth">● AUTHENTICATED RESEARCH DOCUMENT</div>
</div>
</body></html>`;
  html = buildFullReportHtml({ citations: [c], generatedAt }, query);
  const safeName = (c.caseName || 'citation')
    .slice(0, 60)
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'citation';
  const blob = await renderHtmlToPdfBlob(html, {
    filename: `${safeName}.pdf`,
    scale: 2,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `citation_${safeName}_${Date.now()}.pdf`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── Full citation report doc view ─── */
function ReportDoc({ report, query, cases = [], onViewFullJudgment, onFetchFullJudgment, initialPerspective = 'all', initialDimension = 'all', onPerspectiveChange }) {
  const [redesignNotifyStatus, setRedesignNotifyStatus] = useState({});
  const redesignGeneratedAt = report?.report_format?.generatedAt || '';

  const redesignHandleNotifyMe = async (ticketId) => {
    if (!ticketId) return;
    setRedesignNotifyStatus((prev) => ({ ...prev, [ticketId]: 'sending' }));
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const userId = String(user.id || user.user_id || localStorage.getItem('userId') || 'anonymous');
    try {
      await citationApi.notifyMeOnHitl(ticketId, userId);
    } catch {
      // keep the report interactive even if notify registration fails
    }
    setRedesignNotifyStatus((prev) => ({ ...prev, [ticketId]: 'done' }));
  };

  return (
    <RedesignedCitationReportDoc
      report={report}
      query={query}
      initialPerspective={initialPerspective}
      initialDimension={initialDimension}
      onPerspectiveChange={onPerspectiveChange}
      onViewFullJudgment={onViewFullJudgment}
      onFetchFullJudgment={onFetchFullJudgment}
      onDownloadCitation={(citation) => downloadCitationPDF(citation, query, redesignGeneratedAt)}
      onNotifyMe={redesignHandleNotifyMe}
      notifyStatus={redesignNotifyStatus}
    />
  );

  const [sel, setSel] = useState(new Set());
  const [atcCitId, setAtcCitId] = useState(null);
  const [atcCase, setAtcCase] = useState('');
  const [atcStatus, setAtcStatus] = useState(null); // null | 'uploading' | 'done' | {error:string}
  const [atcPreviewUrl, setAtcPreviewUrl] = useState(null); // blob URL for inline PDF preview
  const [redExpanded, setRedExpanded] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState({}); // ticketId → 'done'|'sending'
  const [exportWarnId, setExportWarnId] = useState(null); // citation id awaiting export confirm
  const [origDocModal, setOrigDocModal] = useState(null); // { url, caseName, isPdf }
  const [perspectiveFilter, setPerspectiveFilter] = useState(initialPerspective || 'all');
  const [selectedCourt, setSelectedCourt] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const rawCitations = report?.report_format?.citations || [];
  const allCitations = rawCitations.map((c, idx) => {
    const partyArguments = c.partyArguments || c.party_arguments || {};
    const badgeText = `${c.partyBadge || ''} ${c.party_badge || ''}`;
    const inferredFromArguments = (() => {
      const hasAppellant = Array.isArray(partyArguments.appellant) && partyArguments.appellant.length > 0;
      const hasRespondent = Array.isArray(partyArguments.respondent) && partyArguments.respondent.length > 0;
      const hasCourt = Boolean(partyArguments.court);
      if (hasAppellant && !hasRespondent && !hasCourt) return 'appellant';
      if (hasRespondent && !hasAppellant && !hasCourt) return 'respondent';
      if (hasCourt && !hasAppellant && !hasRespondent) return 'court';
      if (hasAppellant && hasRespondent) return 'neutral';
      return '';
    })();
    const inferredParty = c.argumentParty
      || c.argument_party
      || inferredFromArguments
      || c.partyBadge
      || c.party_badge
      || badgeText
      || c.perspective
      || 'neutral';
    const normalizedParty = normalizePerspectiveKey(inferredParty, 'neutral');
    const normalizedPerspective = normalizePerspectiveKey(c.perspective || report?.report_format?.perspective || 'all', 'all');
    return {
      ...c,
      id: c.id || c.canonicalId || c.canonical_id || `citation_${idx}`,
      argumentParty: ['appellant', 'respondent', 'court', 'neutral'].includes(normalizedParty) ? normalizedParty : 'neutral',
      perspective: ['all', 'appellant', 'respondent', 'court', 'neutral'].includes(normalizedPerspective) ? normalizedPerspective : 'all',
      partyArguments,
    };
  });
  const generatedAt = report?.report_format?.generatedAt || '';
  const kwByRoute = report?.report_format?.searchKeywordsByRoute || {};
  const normKeywords = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
  const kwLocal = normKeywords(kwByRoute.local);
  const kwIK = normKeywords(kwByRoute.indian_kanoon || kwByRoute.indianKanoon);
  const kwGoogle = normKeywords(kwByRoute.google);

  // Split citations into 4 buckets
  const citations = allCitations.filter(c => ['GREEN', 'YELLOW', 'STALE'].includes(c.verificationStatus));
  const pendingCits = allCitations.filter(c => c.verificationStatus === 'PENDING');
  const redCits = allCitations.filter(c => c.verificationStatus === 'RED');
  const primaryListCitations = citations.length > 0 ? citations : [...pendingCits, ...redCits];
  const searchableCitations = primaryListCitations.map(c => {
    const normalizedCourt = normalizeCourtKey(c.court);
    const searchableText = normalizeSearchText([
      c.caseName,
      c.primaryCitation,
      c.court,
      c.argumentParty,
      c.partyBadge,
      c.sourceApplication,
      c.sourceLabel,
      c.ratio,
      c.excerpt?.text,
      ...(c.alternateCitations || []),
    ].filter(Boolean).join(' '));

    return {
      ...c,
      normalizedParty: normalizePerspectiveKey(c.argumentParty, 'neutral'),
      normalizedCourt,
      searchableText,
    };
  });

  const PARTY_BADGE_CFG = {
    appellant: { emoji: '🔵', label: 'RELIED ON BY APPELLANT', groupLabel: 'Appellant Citations', bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' },
    respondent: { emoji: '🟡', label: 'RELIED ON BY RESPONDENT', groupLabel: 'Respondent Citations', bg: '#FFFBEB', border: '#FDE68A', color: '#D97706' },
    court: { emoji: '🟢', label: "COURT'S RATIO", groupLabel: "Court's Analysis", bg: '#F0FDF4', border: '#BBF7D0', color: '#166534' },
    neutral: { emoji: '⚪', label: 'USED BY BOTH SIDES', groupLabel: 'Both Sides Citations', bg: '#F8FAFC', border: '#E2E8F0', color: '#64748B' },
  };
  const _PARTY_ORDER = ['appellant', 'respondent', 'court', 'neutral'];
  const availableCourts = Array.from(
    new Map(
      searchableCitations
        .filter(c => c.normalizedCourt !== 'unknown')
        .map(c => [c.normalizedCourt, c.court])
    ).entries()
  ).map(([value, label]) => ({ value, label }));
  const normalizedSearchTerm = normalizeSearchText(searchTerm);
  const filteredCitations = searchableCitations.filter(c => {
    if (
      perspectiveFilter !== 'all'
      && (c.verificationStatus === 'RED' || c.verificationStatus === 'PENDING')
    ) {
      return false;
    }
    const matchesParty = citationMatchesPerspectiveFilter(c, perspectiveFilter);
    const matchesCourt = selectedCourt === 'all' || c.normalizedCourt === selectedCourt;
    const matchesSearch = !normalizedSearchTerm || c.searchableText.includes(normalizedSearchTerm);
    return matchesParty && matchesCourt && matchesSearch;
  });
  const displayCitations = filteredCitations;

  useEffect(() => {
    // Prefer the header Party Filter (initialPerspective) over report_format.perspective so
    // "All" shows every tagged citation; per-party views only narrow the list client-side.
    const next = normalizePerspectiveKey(
      initialPerspective ?? report?.report_format?.perspective ?? 'all',
      'all',
    );
    setPerspectiveFilter(['all', 'appellant', 'respondent', 'court', 'neutral'].includes(next) ? next : 'all');
  }, [initialPerspective, report]);

  useEffect(() => {
    setSel(new Set());
  }, [report]);

  useEffect(() => {
    setSel(prev => {
      const visibleIds = new Set(displayCitations.map(c => c.id).filter(Boolean));
      return new Set([...prev].filter(id => visibleIds.has(id)));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayCitations]);

  useEffect(() => {
    if (typeof onPerspectiveChange === 'function') onPerspectiveChange(perspectiveFilter);
  }, [onPerspectiveChange, perspectiveFilter]);

  const toggle = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selCites = displayCitations.filter(c => sel.has(c.id));

  const handleNotifyMe = async (ticketId) => {
    if (!ticketId) return;
    setNotifyStatus(p => ({ ...p, [ticketId]: 'sending' }));
    const _nu = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const userId = String(_nu.id || _nu.user_id || localStorage.getItem('userId') || 'anonymous');
    try {
      await citationApi.notifyMeOnHitl(ticketId, userId);
    } catch { /* silent */ }
    setNotifyStatus(p => ({ ...p, [ticketId]: 'done' }));
  };

  const handleAddToCase = async (citation) => {
    if (!atcCase) return;
    setAtcStatus('uploading');
    // Revoke any previous preview blob
    setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    try {
      const cr = await documentApi.getCaseById(atcCase);
      const cd = cr?.case ?? cr;
      const folderName = resolveCaseFolderName(cd);
      if (!folderName) throw new Error('No folder found for this case. Please add a document to the case first to create its folder.');

      // Build PDF-ready HTML for this single citation (reuse existing builder)
      const singleHtml = buildFullReportHtml({ citations: [citation], generatedAt }, query);

      const blob = await renderHtmlToPdfBlob(singleHtml, {
        margin: 10,
        scale: 2,
      });

      const safeName = (citation.caseName || 'citation').slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
      const pdfName = `citation_${safeName}_${Date.now()}.pdf`;
      const file = new File([blob], pdfName, { type: 'application/pdf' });

      // Create blob URL for inline preview (before upload so we have it immediately)
      const previewUrl = URL.createObjectURL(blob);
      await documentApi.uploadDocuments(folderName, [file]);
      setAtcPreviewUrl(previewUrl);
      setAtcStatus('done');
    } catch (err) {
      setAtcStatus({ error: err.message || 'Upload failed' });
    }
  };

  if (!allCitations.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: g400 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No citations found</div>
      <div style={{ fontSize: 11 }}>Try a different query or broader search terms.</div>
    </div>
  );

  return (
    <>
      <div style={{ background: '#EAECF0', minHeight: '100vh', padding: '20px 14px 64px' }}>
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Source+Sans+3:wght@400;600;700&display=swap');
        @keyframes fdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .doc-selR{cursor:pointer;transition:background .12s}.doc-selR:hover{background:#F0FFFF !important}
        .doc-paper{background:#FFFFFF;border:1px solid #D4D9E2;box-shadow:0 2px 14px rgba(15,23,42,.07);border-radius:6px;overflow:hidden}
        .doc-serif{font-family:'Source Serif 4','Georgia',serif}
        .doc-sans{font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif}
        .doc-lbl{font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px}
        .doc-sec-h{display:flex;align-items:center;gap:0;margin:22px 0 12px;border-left:3px solid #21C1B6;padding-left:9px;font-family:'Source Sans 3',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1B2A4A}
        .doc-sub-h{font-family:'Source Sans 3',sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4B5E6E;margin:16px 0 8px}
        .doc-chip{display:inline-flex;align-items:center;border:1px solid #99E6E3;background:#F0FFFE;color:#0D7B76;font-family:'Source Sans 3',sans-serif;font-size:10px;font-weight:700;padding:3px 9px;border-radius:3px;margin:2px 3px 2px 0}
        .doc-ratio{border-left:3px solid #21C1B6;background:#F0FFFE;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:15px;font-style:italic;line-height:2;color:#0F172A;margin:0}
        .doc-prop{border:1px solid #D4E2E8;background:#F7FBFC;padding:13px 16px;border-radius:4px}
        .doc-excerpt{border:1px solid #D4E2E8;background:#FFFDFB;padding:16px 20px;font-family:'Source Serif 4',serif;font-size:14px;line-height:2;color:#1B2A4A;border-radius:4px}
        .doc-match{display:inline-flex;align-items:center;gap:5px;color:#FFFFFF;font-family:'Source Sans 3',sans-serif;font-size:10px;font-weight:700;letter-spacing:.07em;padding:3px 10px;border-radius:3px}
        .doc-treat-stat{display:flex;flex-direction:column;padding:12px 18px;flex:1;min-width:110px}
        .doc-case-row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 14px;gap:10px}
        .doc-case-badge{font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;padding:2px 8px;border-radius:2px;letter-spacing:.06em;white-space:nowrap;flex-shrink:0}
        .doc-foot-btn{font-family:'Source Sans 3',sans-serif;font-size:11px;font-weight:700;letter-spacing:.05em;padding:8px 18px;border-radius:4px;cursor:pointer;border:1px solid;text-transform:uppercase}
        .doc-headnote{border-left:3px solid #21C1B6;background:#F0FFFE;border:1px solid #99E6E3;border-left-width:3px;padding:16px 20px;border-radius:4px}
        .doc-headnote-line{font-family:'Source Serif 4',serif;font-size:14px;color:#1B2A4A;line-height:1.9;margin-bottom:10px}
        .doc-headnote-line:last-child{margin-bottom:0}
      `}</style>

        <div style={{ maxWidth: 740, margin: '0 auto' }}>

          {/* Citation point selector */}
          <div style={{ background: W, marginBottom: 14, border: '1px solid #D4D9E2', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 5px rgba(15,23,42,.06)' }}>
            <div style={{ background: N, padding: '9px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="doc-sans" style={{ fontSize: 10, letterSpacing: '0.14em', color: '#99E6E3', textTransform: 'uppercase', fontWeight: 700 }}>Citation Points</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="doc-sans" style={{ fontSize: 10, color: '#A5F3F0' }}>{sel.size} of {displayCitations.length} selected</span>
                {pendingCits.length > 0 && <span className="doc-sans" style={{ fontSize: 8, background: '#7C3AED', color: W, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>⏳ {pendingCits.length} pending</span>}
                {redCits.length > 0 && <span className="doc-sans" style={{ fontSize: 8, background: '#DC2626', color: W, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>❌ {redCits.length} unverified</span>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 10, padding: '10px 14px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB' }}>
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search case name, citation, ratio, source..."
                className="doc-sans"
                style={{ width: '100%', minWidth: 0, border: '1px solid #D4D9E2', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#334155', outline: 'none' }}
              />
              <select
                value={selectedCourt}
                onChange={e => setSelectedCourt(e.target.value)}
                className="doc-sans"
                style={{ width: '100%', border: '1px solid #D4D9E2', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#334155', background: W, outline: 'none' }}
              >
                <option value="all">All Courts</option>
                {availableCourts.map(court => (
                  <option key={court.value} value={court.value}>{court.label}</option>
                ))}
              </select>
            </div>

            {/* Grouped / filtered citation rows */}
            {displayCitations.length === 0 ? (
              <div style={{ padding: '26px 18px', textAlign: 'center', background: W, borderBottom: '1px solid #F1F4F8' }}>
                <div className="doc-sans" style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  No citations found for this filter
                </div>
                <div className="doc-sans" style={{ fontSize: 10, color: '#64748B' }}>
                  {citations.length > 0
                    ? 'Switch to All to review every verified citation in this report.'
                    : 'No verified citations were produced for this report. Review the pending or unverified citations shown here.'}
                </div>
              </div>
            ) : (() => {
              const sorted = perspectiveFilter === 'all'
                ? [...displayCitations].sort((a, b) => _PARTY_ORDER.indexOf(effectivePartyForSort(a)) - _PARTY_ORDER.indexOf(effectivePartyForSort(b)))
                : displayCitations;
              return sorted.map((c, idx) => {
                const curParty = effectivePartyForSort(c);
                const prevParty = idx > 0 ? effectivePartyForSort(sorted[idx - 1]) : null;
                const showGroupHeader = perspectiveFilter === 'all' && (idx === 0 || prevParty !== curParty);
                const pbCfg = PARTY_BADGE_CFG[curParty] || PARTY_BADGE_CFG.neutral;
                const s = SCFG[c.verificationStatus] || SCFG.YELLOW;
                const isSel = sel.has(c.id);
                const srcKey = c.source || 'unknown';
                let srcIcon = '🤖';
                let srcLabel = c.sourceApplication || c.sourceLabel || 'Unknown Source';
                if (srcKey === 'local') { srcIcon = '🏛'; srcLabel = 'Local DB'; }
                else if (srcKey === 'indian_kanoon') { srcIcon = '📚'; srcLabel = 'Indian Kanoon'; }
                else if (srcKey === 'google') { srcIcon = '🌐'; srcLabel = 'Google Search (Gemini)'; }
                else if (srcKey === 'web' || c.sourceTier === 'web' || c._source === 'web_tier3') { srcIcon = '🌍'; srcLabel = 'Web (Verified)'; }
                return (
                  <React.Fragment key={c.id}>
                    {showGroupHeader && (
                      <div style={{ padding: '5px 14px', background: pbCfg.bg, borderTop: idx > 0 ? '2px solid #E5E7EB' : 'none', borderBottom: `1px solid ${pbCfg.border}` }}>
                        <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: pbCfg.color, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                          {pbCfg.emoji} {pbCfg.groupLabel} ({sorted.filter(x => effectivePartyForSort(x) === curParty).length})
                        </span>
                      </div>
                    )}
                    <div className="doc-selR" onClick={() => toggle(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: isSel ? '#EEF2FF' : W, borderBottom: idx < sorted.length - 1 ? '1px solid #F1F4F8' : 'none' }}>
                      <div style={{ width: 14, height: 14, flexShrink: 0, border: `2px solid ${isSel ? T : '#C5CAD3'}`, background: isSel ? T : W, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isSel && <span style={{ color: W, fontSize: 9, lineHeight: 1, marginTop: -1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="doc-serif" style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.caseName}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="doc-sans" style={{ fontSize: 11, fontWeight: 700, color: T }}>{c.primaryCitation}</span>
                            {c.court && c.court !== 'Court not specified' && <><span style={{ color: '#CBD5E1' }}>·</span><span className="doc-sans" style={{ fontSize: 10, color: '#64748B' }}>{c.court}</span></>}
                            {/* Party badge chip */}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: pbCfg.bg, border: `1px solid ${pbCfg.border}`, color: pbCfg.color, fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 3, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                              {pbCfg.emoji} {pbCfg.label}
                            </span>
                          </div>
                          <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>{srcIcon}</span>
                            <span>{srcLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: s.bg, border: `1px solid ${s.border}`, padding: '2px 7px', borderRadius: 2, flexShrink: 0 }}>
                        <Dot c={s.dot} s={5} />
                        <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: s.text }}>{s.label}</span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}

            {/* Badge legend */}
            <div style={{ display: 'flex', gap: 10, padding: '7px 14px', background: '#F8FAFC', borderTop: '1px solid #E5E7EB', flexWrap: 'wrap' }}>
              {Object.values(PARTY_BADGE_CFG).map(cfg => (
                <span key={cfg.label} className="doc-sans" style={{ fontSize: 8, color: cfg.color, fontWeight: 600 }}>{cfg.emoji} {cfg.label}</span>
              ))}
            </div>
          </div>

          {selCites.length === 0 && (
            <div className="doc-paper" style={{ padding: '52px 32px', textAlign: 'center' }}>
              <div className="doc-serif" style={{ fontSize: 15, fontStyle: 'italic', color: '#9CA3AF' }}>Select a citation point above to view the full report.</div>
            </div>
          )}

          {citations.length === 0 && (pendingCits.length > 0 || redCits.length > 0) && (
            <div className="doc-paper" style={{ padding: '32px', textAlign: 'center', marginBottom: 18 }}>
              <div className="doc-serif" style={{ fontSize: 14, fontStyle: 'italic', color: '#9CA3AF' }}>
                No verified citations are available yet. Pending and unverified citations are shown in the main list for review.
              </div>
            </div>
          )}

          {selCites.map((c, idx) => {
            const score = (c.proposition || {}).matchScore ?? 0;
            const verdict = (c.proposition || {}).verdict || 'REVIEW';
            const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
            const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
            const treat = c.treatment || {};
            const followedList = treat.followedList || [];
            const distinguishedList = treat.distinguishedList || [];
            const overruledList = treat.overruledList || [];
            const reversedList = treat.reversedList || [];
            const reliedOnList = treat.reliedOnList || [];
            const appliedList = treat.appliedList || [];
            const citedList = treat.citedList || [];
            const referredList = treat.referredList || [];
            const approvedList = treat.approvedList || [];
            const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
            const excerptRaw = (c.excerpt || {}).text || '';
            const excerptDisplay = (() => {
              // Backend already strips most HTML/CSS noise; here we just normalise whitespace
              const t = excerptRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              return t || '—';
            })();
            const srcKey = c.source || 'unknown';
            let srcIcon = '🤖';
            let srcLabel = c.sourceApplication || c.sourceLabel || 'Unknown Source';
            if (srcKey === 'local') {
              srcIcon = '🏛';
              srcLabel = 'Local DB';
            } else if (srcKey === 'indian_kanoon') {
              srcIcon = '📚';
              srcLabel = 'Indian Kanoon';
            } else if (srcKey === 'google') {
              srcIcon = '🌐';
              srcLabel = 'Google Search (Gemini)';
            } else if (srcKey === 'web' || c.sourceTier === 'web' || c._source === 'web_tier3') {
              srcIcon = '🌍';
              srcLabel = 'Web (Verified)';
            }
            const treatRows = [
              ...followedList.map(name => ({ name, type: 'FOLLOWED', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' })),
              ...distinguishedList.map(name => ({ name, type: 'DISTINGUISHED', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' })),
              ...overruledList.map(name => ({ name, type: 'OVERRULED', col: '#991B1B', bg: '#FEF2F2', bdr: '#FECACA' })),
              ...reversedList.map(name => ({ name, type: 'REVERSED', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' })),
              ...reliedOnList.map(name => ({ name, type: 'RELIED ON', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' })),
              ...appliedList.map(name => ({ name, type: 'APPLIED', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' })),
              ...citedList.map(name => ({ name, type: 'CITED', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' })),
              ...referredList.map(name => ({ name, type: 'REFERRED TO', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' })),
              ...approvedList.map(name => ({ name, type: 'APPROVED', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' })),
            ];

            return (
              <div key={c.id} className="doc-paper" style={{ marginBottom: 18, animation: `fdIn .3s ease ${idx * .07}s both` }}>
                <div style={{ padding: '26px 32px 22px' }}>

                  {/* STALE warning banner */}
                  {c.verificationStatus === 'STALE' && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, padding: '11px 14px', marginBottom: 18 }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>🔄</span>
                      <div>
                        <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Freshness Check Pending</div>
                        <div className="doc-sans" style={{ fontSize: 11, color: '#7C2D12', lineHeight: 1.55 }}>
                          {c.staleReason || 'This citation was previously verified but a recent development may have affected its validity. We are re-checking.'}
                        </div>
                        <div className="doc-sans" style={{ fontSize: 10, color: '#EA580C', marginTop: 4, fontWeight: 600 }}>Do not rely on this citation until the check completes.</div>
                      </div>
                    </div>
                  )}

                  {/* YELLOW review banner */}
                  {c.verificationStatus === 'YELLOW' && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '11px 14px', marginBottom: 18 }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                      <div style={{ flex: 1 }}>
                        <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Review Suggested — Source Attached</div>
                        <div className="doc-sans" style={{ fontSize: 11, color: '#92400E', lineHeight: 1.55 }}>
                          This citation exists but the way it was used may not precisely match the holding. Please read the excerpt below and verify independently before relying on it in court.
                        </div>
                        {/* Alignment score bar */}
                        <div style={{ marginTop: 9 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span className="doc-sans" style={{ fontSize: 9, color: '#92400E', fontWeight: 700 }}>Proposition Alignment</span>
                            <span className="doc-sans" style={{ fontSize: 9, color: '#D97706', fontWeight: 700 }}>{score}%</span>
                          </div>
                          <div style={{ height: 6, background: '#FDE68A', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${score}%`, background: score >= 75 ? '#D97706' : '#EF4444', borderRadius: 3, transition: 'width .6s ease' }} />
                          </div>
                        </div>
                        {/* Side-by-side: claimed vs actual */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                          <div style={{ background: '#FFFDE7', border: '1px solid #FDE68A', borderRadius: 4, padding: '8px 10px' }}>
                            <div className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>What was claimed</div>
                            <div className="doc-serif" style={{ fontSize: 11, color: '#1E293B', lineHeight: 1.55, fontStyle: 'italic' }}>"{(c.proposition || {}).query || query || '—'}"</div>
                          </div>
                          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, padding: '8px 10px' }}>
                            <div className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Actual holding</div>
                            <div className="doc-serif" style={{ fontSize: 11, color: '#1E293B', lineHeight: 1.55 }}>{(c.ratio || '—').slice(0, 220)}{(c.ratio || '').length > 220 ? '…' : ''}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Court header */}
                  <CourtHeading court={c.court} />

                  {/* Case name */}
                  <h1 className="doc-serif" style={{ textAlign: 'center', fontSize: 21, fontWeight: 700, color: '#0F172A', lineHeight: 1.3, marginBottom: 10 }}>
                    {c.caseName}
                  </h1>

                  {/* Party perspective badge */}
                  {(() => {
                    const _party = effectivePartyForSort(c);
                    const _pbCfg = { appellant: { emoji: '🔵', label: 'RELIED BY APPELLANT', bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' }, respondent: { emoji: '🟡', label: 'RELIED BY RESPONDENT', bg: '#FFFBEB', border: '#FDE68A', color: '#D97706' }, court: { emoji: '🟢', label: "COURT'S RATIO", bg: '#F0FDF4', border: '#BBF7D0', color: '#166534' }, neutral: { emoji: '⚪', label: 'CITED BY BOTH PARTIES', bg: '#F8FAFC', border: '#E2E8F0', color: '#64748B' } }[_party] || { emoji: '⚪', label: 'CITED BY BOTH PARTIES', bg: '#F8FAFC', border: '#E2E8F0', color: '#64748B' };
                    const _dist = (c.subsequentTreatment?.distinguished || []).length > 0;
                    return (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: _pbCfg.bg, border: `1px solid ${_pbCfg.border}`, color: _pbCfg.color, fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 4, letterSpacing: '.05em' }}>
                          {_pbCfg.emoji} {_pbCfg.label}
                        </span>
                        {_dist && _party === 'respondent' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FFF7ED', border: '1px solid #FED7AA', color: '#C2410C', fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 4, letterSpacing: '.05em' }}>
                            🟠 DISTINGUISHED BY COURT
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Citation strip — 3 columns with dividers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 155px', border: '1px solid #E2E8F0', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>
                      <div className="doc-lbl">Primary Citation</div>
                      <div className="doc-serif" style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{c.primaryCitation || '—'}</div>
                    </div>
                    <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>
                      <div className="doc-lbl">Equivalent Citations</div>
                      <div className="doc-serif" style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.5 }}>{(c.alternateCitations || []).join('; ') || '—'}</div>
                    </div>
                    <div style={{ padding: '10px 14px' }}>
                      <div className="doc-lbl">Date of Judgment</div>
                      <div className="doc-serif" style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{c.dateOfJudgment || '—'}</div>
                    </div>
                  </div>

                  {/* Coram + Statutory Provisions */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
                    <div>
                      <div className="doc-lbl">Coram / Bench</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                        {judges.length > 0
                          ? judges.map((j, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <JudgeIcon />
                              <span className="doc-serif" style={{ fontSize: 12, color: '#1E293B' }}>{j}</span>
                            </div>
                          ))
                          : <span className="doc-serif" style={{ fontSize: 12, color: '#94A3B8' }}>—</span>
                        }
                        {c.benchType && c.benchType !== '—' && (
                          <div className="doc-sans" style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>{c.benchType}</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="doc-lbl">Statutory Provisions</div>
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap' }}>
                        {(c.statutes || []).length
                          ? (c.statutes || []).map((st, i) => <span key={i} className="doc-chip">{st}</span>)
                          : <span className="doc-serif" style={{ fontSize: 12, color: '#94A3B8' }}>—</span>
                        }
                      </div>
                    </div>
                  </div>

                  {/* Judgment Headnote */}
                  {c.headnote && c.headnote.trim() && (
                    <div style={{ marginTop: 22, marginBottom: 4 }}>
                      <div className="doc-sec-h">Judgment Headnote</div>
                      <div className="doc-headnote">
                        {c.headnote.split('\n').filter(l => l.trim()).map((line, i) => (
                          <div key={i} className="doc-headnote-line">{line}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Party Arguments */}
                  {c.partyArguments && (c.partyArguments.appellant?.length || c.partyArguments.respondent?.length || c.partyArguments.court) && (
                    <div style={{ marginTop: 22, marginBottom: 4 }}>
                      <div className="doc-sec-h">Party Arguments</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        {c.partyArguments.appellant?.length > 0 && (
                          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '11px 14px' }}>
                            <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>🔵 Appellant's Arguments</div>
                            {c.partyArguments.appellant.map((arg, i) => (
                              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                                <span className="doc-sans" style={{ fontSize: 10, color: '#1E40AF', fontWeight: 700, flexShrink: 0 }}>•</span>
                                <span className="doc-serif" style={{ fontSize: 11.5, color: '#1E293B', lineHeight: 1.55 }}>{arg}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {c.partyArguments.respondent?.length > 0 && (
                          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, padding: '11px 14px' }}>
                            <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>🟡 Respondent's Arguments</div>
                            {c.partyArguments.respondent.map((arg, i) => (
                              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                                <span className="doc-sans" style={{ fontSize: 10, color: '#B45309', fontWeight: 700, flexShrink: 0 }}>•</span>
                                <span className="doc-serif" style={{ fontSize: 11.5, color: '#1E293B', lineHeight: 1.55 }}>{arg}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {c.partyArguments.court && (
                        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderLeft: '3px solid #16A34A', borderRadius: 4, padding: '11px 14px' }}>
                          <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>🟢 Court's Conclusion</div>
                          <div className="doc-serif" style={{ fontSize: 12.5, color: '#1E293B', lineHeight: 1.65, fontStyle: 'italic' }}>{c.partyArguments.court}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* I. Legal Analysis & Ratio */}
                  <div className="doc-sec-h">I. Legal Analysis &amp; Ratio</div>
                  <blockquote className="doc-ratio">
                    "{c.ratio || '—'}"
                  </blockquote>

                  {/* Proposition Verification */}
                  <div className="doc-sub-h">Proposition Verification</div>
                  <div className="doc-prop">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: '#DBEAFE', color: '#1D4ED8', fontSize: 9, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>i</span>
                      <div>
                        <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Query</div>
                        <div className="doc-serif" style={{ fontSize: 12.5, color: '#1E293B', lineHeight: 1.65 }}>{(c.proposition || {}).query || query || '—'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span className="doc-match" style={{ background: matchColor }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,.65)', display: 'inline-block', flexShrink: 0 }} />
                        {matchLabel}
                      </span>
                      <span className="doc-sans" style={{ fontSize: 10, color: '#64748B' }}>
                        Semantic Similarity: {(score / 100).toFixed(2)} ({verdict.charAt(0) + verdict.slice(1).toLowerCase() + '-Sbert'})
                      </span>
                    </div>
                  </div>

                  {/* Source Excerpt */}
                  <div className="doc-sub-h">Source Excerpt ({(c.excerpt || {}).para || 'Para —'})</div>
                  <div className="doc-excerpt">
                    "{excerptDisplay}"
                  </div>

                  {/* III. Indian Kanoon Enrichment */}
                  {(c.originalCourtCopyUrl || (c.ikFragment && c.ikFragment.headline) || (c.ikCiteList && c.ikCiteList.length > 0) || (c.ikCitedByList && c.ikCitedByList.length > 0) || (c.ikDocMeta && Object.keys(c.ikDocMeta).length > 0)) && (
                    <div style={{ marginTop: 24 }}>
                      <div className="doc-sec-h">III. Indian Kanoon Enrichment</div>

                      {/* Original Court Copy */}
                      {c.originalCourtCopyUrl && (
                        <div style={{ marginBottom: 14 }}>
                          <div className="doc-sub-h">Original Court Copy</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              onClick={() => setOrigDocModal({ url: c.originalCourtCopyUrl, caseName: c.caseName, isPdf: c.isOriginalCopyPdf })}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 7,
                                padding: '7px 14px', background: N, color: '#FFFFFF',
                                borderRadius: 5, border: 'none', cursor: 'pointer',
                                fontSize: 12, fontWeight: 700, letterSpacing: '.04em',
                              }}
                            >
                              <span>📄</span>
                              <span>{c.isOriginalCopyPdf ? 'View Original PDF' : 'View Original Document'}</span>
                            </button>
                            <a
                              href={c.originalCourtCopyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '7px 12px', background: 'transparent', color: N,
                                borderRadius: 5, border: `1px solid ${N}`,
                                fontSize: 12, fontWeight: 600, textDecoration: 'none',
                              }}
                            >
                              <span>↗</span><span>Open in Tab</span>
                            </a>
                          </div>
                        </div>
                      )}

                      {/* IK Relevant Fragment */}
                      {c.ikFragment && c.ikFragment.headline && (
                        <div style={{ marginBottom: 14 }}>
                          <div className="doc-sub-h">Relevant Fragment (Indian Kanoon)</div>
                          <div style={{
                            background: '#F0FFFE', border: '1px solid #99E6E3',
                            borderLeft: '3px solid #21C1B6', borderRadius: 4,
                            padding: '12px 16px', fontSize: 13, color: '#1B2A4A', lineHeight: 1.8,
                            fontStyle: 'italic',
                          }}>
                            {c.ikFragment.headline}
                          </div>
                        </div>
                      )}

                      {/* IK Doc Metadata */}
                      {c.ikDocMeta && (c.ikDocMeta.publishdate || c.ikDocMeta.docsource || c.ikDocMeta.numcites != null) && (
                        <div style={{ marginBottom: 14 }}>
                          <div className="doc-sub-h">Document Metadata</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {c.ikDocMeta.publishdate && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Published</span>
                                <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.publishdate}</span>
                              </div>
                            )}
                            {c.ikDocMeta.docsource && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Court</span>
                                <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.docsource}</span>
                              </div>
                            )}
                            {c.ikDocMeta.numcites != null && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Total Citations</span>
                                <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.numcites}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* IK Citation Network */}
                      {((c.ikCiteList && c.ikCiteList.length > 0) || (c.ikCitedByList && c.ikCitedByList.length > 0)) && (
                        <div style={{ marginBottom: 14 }}>
                          <div className="doc-sub-h">Citation Network (Indian Kanoon)</div>
                          <InlineCitationNetwork c={c} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* IV. Subsequent Treatment */}
                  <div className="doc-sec-h" style={{ marginTop: 24 }}>IV. Subsequent Treatment</div>

                  {/* Primary 3 stats */}
                  <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                    {[
                      { count: followedList.length, label: 'Followed In', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' },
                      { count: distinguishedList.length, label: 'Distinguished In', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' },
                      { count: overruledList.length, label: 'Overruled By', col: overruledList.length ? '#991B1B' : '#475569', bg: overruledList.length ? '#FEF2F2' : '#F8FAFC', bdr: overruledList.length ? '#FECACA' : '#E2E8F0' },
                    ].map((p, i, arr) => (
                      <div key={i} className="doc-treat-stat" style={{ background: p.bg, borderRight: i < arr.length - 1 ? `1px solid ${p.bdr}` : 'none' }}>
                        <div className="doc-serif" style={{ fontSize: 28, fontWeight: 700, color: p.col, lineHeight: 1 }}>{p.count}</div>
                        <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: p.col, marginTop: 4 }}>{p.label}</div>
                        <div className="doc-sans" style={{ fontSize: 10, color: p.col, marginTop: 2 }}>Cases</div>
                      </div>
                    ))}
                  </div>

                  {/* Secondary treatment counts (relied on, applied, cited, referred, reversed, approved) */}
                  {(reliedOnList.length + appliedList.length + citedList.length + referredList.length + reversedList.length + approvedList.length) > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {[
                        { list: reliedOnList, label: 'Relied On', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' },
                        { list: appliedList, label: 'Applied', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' },
                        { list: citedList, label: 'Cited', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' },
                        { list: referredList, label: 'Referred To', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' },
                        { list: reversedList, label: 'Reversed', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' },
                        { list: approvedList, label: 'Approved', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' },
                      ].filter(p => p.list.length > 0).map((p, i) => (
                        <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: p.bg, border: `1px solid ${p.bdr}`, borderRadius: 5, padding: '4px 10px' }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: p.col }}>{p.list.length}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: p.col, textTransform: 'uppercase', letterSpacing: '.07em' }}>{p.label}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* All case rows */}
                  {treatRows.length > 0 ? (
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                      {treatRows.map((item, i) => (
                        <div key={i} className="doc-case-row" style={{ borderBottom: i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none', background: W }}>
                          <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{item.name}</div>
                          <span className="doc-case-badge" style={{ background: item.bg, color: item.col, border: `1px solid ${item.bdr}` }}>{item.type}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#94A3B8', padding: '8px 0', fontStyle: 'italic' }}>No subsequent treatment references found in judgment text.</div>
                  )}

                  {/* Footer */}
                  <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.15em', color: N, textTransform: 'uppercase', marginBottom: 4 }}>Jurinex Legal Intelligence Report</div>
                      <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 2 }}>Generated on {generatedAt || '—'}</div>
                      {(c.importSourceLink || c.sourceUrl || c.officialSourceLink) && (
                        <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                          <span>Source:</span>
                          <span>{srcIcon}</span>
                          <span>{srcLabel}</span>
                          <span style={{ color: '#CBD5E1' }}>·</span>
                          <a href={c.importSourceLink || c.sourceUrl || c.officialSourceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#1D4ED8', textDecoration: 'none' }}>Open document</a>
                        </div>
                      )}
                      {onViewFullJudgment && c.canonicalId && !String(c.canonicalId).startsWith('placeholder_') && (
                        <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 5 }}>
                          <button type="button" onClick={() => onViewFullJudgment(c.canonicalId, c.caseName)} style={{ background: 'none', border: 'none', padding: 0, color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>View complete judgment</button>
                        </div>
                      )}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 3 }}>
                        <Dot c="#16A34A" s={5} />
                        <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#15803D', letterSpacing: '.07em' }}>AUTHENTICATED RESEARCH DOCUMENT</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="doc-foot-btn"
                        style={{ background: '#F0F9FF', color: '#0369A1', borderColor: '#BAE6FD' }}
                        onClick={() => { setAtcCitId(atcCitId === c.id ? null : c.id); setAtcCase(''); setAtcStatus(null); setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }}>
                        + Add to Case Folder
                      </button>
                      {c.verificationStatus === 'YELLOW' && exportWarnId !== c.id ? (
                        <button className="doc-foot-btn" style={{ background: '#FFFBEB', color: '#D97706', borderColor: '#FDE68A' }}
                          onClick={() => setExportWarnId(c.id)}>
                          ⚠ Download PDF
                        </button>
                      ) : c.verificationStatus === 'YELLOW' && exportWarnId === c.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span className="doc-sans" style={{ fontSize: 9, color: '#92400E', maxWidth: 260, textAlign: 'right', lineHeight: 1.45 }}>I acknowledge this citation requires independent verification before use in court submissions.</span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="doc-foot-btn" style={{ background: '#D97706', color: W, borderColor: '#D97706' }}
                              onClick={() => { downloadCitationPDF(c, query, generatedAt); setExportWarnId(null); }}>
                              Confirm & Download
                            </button>
                            <button className="doc-foot-btn" style={{ background: W, color: '#64748B', borderColor: '#E2E8F0' }}
                              onClick={() => setExportWarnId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : c.verificationStatus === 'STALE' ? (
                        <button className="doc-foot-btn" style={{ background: '#FFF7ED', color: '#EA580C', borderColor: '#FED7AA', cursor: 'not-allowed', opacity: 0.7 }}
                          title="Cannot export while freshness check is pending">
                          🔄 Check Pending
                        </button>
                      ) : (
                        <button className="doc-foot-btn" style={{ background: N, color: W, borderColor: N }}
                          onClick={() => downloadCitationPDF(c, query, generatedAt)}>
                          Download PDF
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Add to Case Folder panel */}
                  {atcCitId === c.id && (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6 }}>
                      <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', marginBottom: 8, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                        Add Citation to Case Folder
                      </div>
                      {atcStatus === 'done' ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, marginBottom: atcPreviewUrl ? 10 : 0 }}>
                            <Dot c="#16A34A" s={7} />
                            <span className="doc-sans" style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>Successfully uploaded as PDF! The citation is now indexed for RAG queries on this case.</span>
                          </div>
                          {atcPreviewUrl && (
                            <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', marginTop: 4 }}>
                              <div style={{ background: N, padding: '7px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#BFDBFE' }}>PDF Preview — Uploaded to Case Folder</span>
                              </div>
                              <iframe
                                src={atcPreviewUrl}
                                style={{ width: '100%', height: 520, border: 'none', display: 'block', background: '#F8FAFC' }}
                                title="Citation Report PDF Preview"
                              />
                            </div>
                          )}
                        </div>
                      ) : atcStatus && atcStatus.error ? (
                        <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, fontSize: 11, color: '#991B1B', fontFamily: "'Source Sans 3',sans-serif" }}>
                          {atcStatus.error}
                        </div>
                      ) : (
                        <>
                          <div className="doc-sans" style={{ fontSize: 10, color: '#0C4A6E', marginBottom: 8, lineHeight: 1.5 }}>
                            Select a case from your cases to attach this citation. The report will be chunked, embedded, and indexed for AI search on that case.
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                              value={atcCase}
                              onChange={e => { setAtcCase(e.target.value); setAtcStatus(null); }}
                              disabled={atcStatus === 'uploading'}
                              title="Cases you have access to"
                              style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #BAE6FD', borderRadius: 4, fontSize: 11, outline: 'none', background: W, fontFamily: "'Source Sans 3',sans-serif", cursor: 'pointer' }}>
                              <option value="">— Select a case —</option>
                              {cases.map(cs => <option key={cs.id} value={cs.id}>{cs.case_title || cs.name || cs.id}</option>)}
                            </select>
                            <button
                              onClick={() => handleAddToCase(c)}
                              disabled={!atcCase || atcStatus === 'uploading'}
                              style={{ padding: '7px 18px', background: atcCase ? '#0369A1' : '#BAE6FD', color: W, border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: atcCase ? 'pointer' : 'default', fontFamily: "'Source Sans 3',sans-serif", display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              {atcStatus === 'uploading' ? <><Spin /> Uploading…</> : 'Upload & Index'}
                            </button>
                            <button onClick={() => { setAtcCitId(null); setAtcStatus(null); setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }}
                              style={{ padding: '7px 12px', background: 'transparent', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: "'Source Sans 3',sans-serif" }}>
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>
            );
          })}

          {/* ── UNDER VERIFICATION — PENDING citations ───────────────────── */}
          {pendingCits.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 1, background: '#DDD6FE' }} />
                <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  ⏳ Under Verification ({pendingCits.length})
                </span>
                <div style={{ flex: 1, height: 1, background: '#DDD6FE' }} />
              </div>
              <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ background: '#EDE9FE', padding: '10px 16px', borderBottom: '1px solid #DDD6FE' }}>
                  <div className="doc-sans" style={{ fontSize: 11, color: '#4C1D95', lineHeight: 1.55 }}>
                    ⏳ <strong>Under Verification.</strong> These citations were found on the web but could not be confirmed in authoritative sources. A legal expert is reviewing each one. Click "Notify Me" and we'll alert you when resolved.
                  </div>
                </div>
                {pendingCits.map((c, i) => {
                  const ticketId = c.hitlTicketId || '';
                  const nst = notifyStatus[ticketId];
                  const ps = c.priorityScore || 0;
                  return (
                    <div key={c.id} style={{ padding: '14px 16px', borderBottom: i < pendingCits.length - 1 ? '1px solid #EDE9FE' : 'none', background: W }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginBottom: 3 }}>{c.caseName || '—'}</div>
                          <div className="doc-sans" style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700, marginBottom: 2 }}>{c.primaryCitation || '—'}</div>
                          {c.importSourceLink && (
                            <div className="doc-sans" style={{ fontSize: 9, color: '#64748B' }}>
                              🌐 Found at: <a href={c.importSourceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#7C3AED', textDecoration: 'none' }}>{c.importSourceLink.slice(0, 60)}{c.importSourceLink.length > 60 ? '…' : ''}</a>
                            </div>
                          )}
                          {ps > 0 && (
                            <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginTop: 3 }}>
                              Review SLA: <span style={{ fontWeight: 700, color: ps >= 0.85 ? '#DC2626' : ps >= 0.70 ? '#D97706' : '#64748B' }}>{_slaLabel(ps)}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 3 }}>
                            <Dot c="#7C3AED" s={5} />
                            <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#4C1D95' }}>PENDING</span>
                          </div>
                          {ticketId && (
                            nst === 'done' ? (
                              <span className="doc-sans" style={{ fontSize: 9, color: '#16A34A', fontWeight: 600 }}>✓ You'll be notified</span>
                            ) : (
                              <button className="doc-foot-btn"
                                disabled={nst === 'sending'}
                                style={{ background: '#7C3AED', color: W, borderColor: '#7C3AED', opacity: nst === 'sending' ? 0.6 : 1 }}
                                onClick={() => handleNotifyMe(ticketId)}>
                                {nst === 'sending' ? 'Registering…' : '🔔 Notify Me'}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── UNVERIFIED CITATIONS — RED, collapsed ─────────────────────── */}
          {redCits.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 1, background: '#FECACA' }} />
                <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#DC2626', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  ❌ Unverified Citations ({redCits.length})
                </span>
                <div style={{ flex: 1, height: 1, background: '#FECACA' }} />
              </div>
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, overflow: 'hidden' }}>
                {/* Collapsed header */}
                <button type="button" onClick={() => setRedExpanded(p => !p)}
                  style={{ width: '100%', background: '#FEE2E2', border: 'none', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: redExpanded ? '1px solid #FECACA' : 'none' }}>
                  <div className="doc-sans" style={{ fontSize: 11, color: '#991B1B', lineHeight: 1.55, textAlign: 'left' }}>
                    ❌ <strong>Unverified — Manual Check Required.</strong> These citations could not be confirmed in our verified database or external sources. Do not use without independent verification from the primary source.
                  </div>
                  <span className="doc-sans" style={{ fontSize: 11, color: '#DC2626', flexShrink: 0, marginLeft: 12 }}>{redExpanded ? '▲ Hide' : '▼ Show'}</span>
                </button>
                {redExpanded && redCits.map((c, i) => (
                  <div key={c.id} style={{ padding: '14px 16px', borderBottom: i < redCits.length - 1 ? '1px solid #FECACA' : 'none', background: W }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginBottom: 3 }}>{c.caseName || '—'}</div>
                        <div className="doc-sans" style={{ fontSize: 10, color: '#DC2626', fontWeight: 700, marginBottom: 4 }}>{c.primaryCitation || '—'}</div>
                        {c.failureReason && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: '#FFF5F5', border: '1px solid #FECACA', borderRadius: 4, padding: '7px 10px' }}>
                            <span style={{ fontSize: 12, flexShrink: 0 }}>⚠</span>
                            <div className="doc-sans" style={{ fontSize: 10, color: '#991B1B', lineHeight: 1.55 }}>{c.failureReason}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 3, marginBottom: 6 }}>
                          <Dot c="#DC2626" s={5} />
                          <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#991B1B' }}>UNVERIFIED</span>
                        </div>
                        <div>
                          <button className="doc-foot-btn"
                            style={{ background: '#FEF2F2', color: '#DC2626', borderColor: '#FECACA', fontSize: 9 }}
                            title="Export blocked — this citation failed verification. Do not use in court submissions."
                            onClick={() => alert('⚠ Export blocked.\n\nThis citation could not be verified. Do not use in court submissions without independent verification from the primary source.')}>
                            ⛔ Export Blocked
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════
   CASE SEARCH TAB
══════════════════════════════════════════════════ */
// All India courts — Supreme Court and major High Courts
const COURTS = [
  'Supreme Court',
  'Delhi HC',
  'Bombay HC',
  'Madras HC',
  'Kolkata HC',
  'Karnataka HC',
  'Gujarat HC',
  'Allahabad HC',
  'Punjab & Haryana HC',
  'Rajasthan HC',
  'Telangana HC',
  'Andhra Pradesh HC',
  'Kerala HC',
  'Madhya Pradesh HC',
  'Chhattisgarh HC',
  'Jharkhand HC',
  'Bihar HC',
  'Uttarakhand HC',
  'Himachal Pradesh HC',
  'Orissa HC',
  'Patna HC',
  'Gauhati HC',
  'Jammu & Kashmir HC',
  'Sikkim HC',
  'Manipur HC',
  'Meghalaya HC',
  'Tripura HC',
  'Mizoram HC',
  'Nagaland HC',
  'Goa HC',
];
const AREAS = [];

// Case search tab temporarily disabled for build compatibility.
function CaseSearchTab() {
  const [query, setQuery] = useState('');
  const [courtFilter, setCourtFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [courtNameFilter, setCourtNameFilter] = useState(''); // free-text filter for court name
  const [areaLawFilter, setAreaLawFilter] = useState('');    // free-text filter for area of law
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vault, setVault] = useState([]); // saved canonical IDs

  // Apply court name and area of law text filters client-side
  const displayResults = (() => {
    let out = results;
    const courtLower = (courtNameFilter || '').trim().toLowerCase();
    const areaLower = (areaLawFilter || '').trim().toLowerCase();
    if (courtLower) {
      out = out.filter(r => (r.court || '').toLowerCase().includes(courtLower));
    }
    if (areaLower) {
      out = out.filter(r => (r.area || '').toLowerCase().includes(areaLower));
    }
    return out;
  })();

  // Load all on mount
  useEffect(() => { doSearch('', '', ''); }, []);

  const doSearch = useCallback(async (q, court, area) => {
    setLoading(true); setError(null);
    try {
      const data = await citationApi.searchJudgements({ q, court, area, limit: 200 });
      setResults(data.results || []);
      setTotal(data.total ?? (data.results || []).length);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => doSearch(query, courtFilter, areaFilter);

  const toggleVault = (id) => setVault(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);

  const matchColor = (pct) => {
    if (pct === null || pct === undefined) return g400;
    if (pct >= 80) return '#16A34A';
    if (pct >= 60) return '#D97706';
    return '#DC2626';
  };

  const courtMap = {};
  results.forEach(r => { if (r.court) courtMap[r.court] = (courtMap[r.court] || 0) + 1; });
  const areaMap = {};
  results.forEach(r => { if (r.area) areaMap[r.area] = (areaMap[r.area] || 0) + 1; });

  const triggerDownload = (blob, filename) => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 200);
    } catch (e) {
      console.error('[Export] Download failed:', e);
    }
  };
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(displayResults, null, 2)], { type: 'application/json' });
    triggerDownload(blob, 'case-search-results.json');
  };
  const exportCSV = () => {
    const rows = vault.length ? displayResults.filter(r => vault.includes(r.canonicalId)) : displayResults;
    const csv = ['Case Name,Citation,Court,Year,Area,Status'].concat(rows.map(r =>
      [r.caseName, r.primaryCitation, r.court, r.year, r.area, r.auditStatus].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    )).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'case-search-results.csv');
  };
  // Complete citation report — all AI citation report points
  const exportCompleteReport = () => {
    const rows = vault.length ? displayResults.filter(r => vault.includes(r.canonicalId)) : displayResults;
    const headers = 'Canonical ID,Case Name,Citation,Court,Coram,Date,Year,Area,Statutes,Ratio,Excerpt Para,Excerpt,Status,Confidence,Match %,Source,Source URL';
    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const csv = [headers].concat(rows.map(r => [
      r.canonicalId, r.caseName, r.primaryCitation, r.court, r.coram,
      r.dateOfJudgment ?? r.year, r.year, r.area,
      (Array.isArray(r.statutes) ? r.statutes.join('; ') : r.statutes) ?? '',
      r.ratio ?? '', r.excerptPara ?? '', r.excerpt ?? '',
      r.auditStatus ?? '', r.confidence ?? '', r.matchPct ?? '', r.source ?? '',
      r.sourceUrl ?? ''
    ].map(escapeCsv).join(','))).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'complete-citation-report.csv');
  };

  return (
    <>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${g200}`, background: g50, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px 12px', gap: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: N, display: 'flex', alignItems: 'center', gap: 6 }}>🔍 Filters</div>

          {/* Court name filter — type to filter displayed results */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Court Name</div>
            <input
              value={courtNameFilter}
              onChange={e => setCourtNameFilter(e.target.value)}
              placeholder="e.g. Delhi, Supreme"
              style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 5, border: `1px solid ${g300}`, outline: 'none', color: g700, marginBottom: 6 }}
            />
          </div>

          {/* Court filter — preset list */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Court (preset)</div>
            <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 4 }}>
              {['', ...COURTS].map(c => (
                <div key={c || 'all'} onClick={() => { setCourtFilter(c); doSearch(query, c, areaFilter); }}
                  style={{ padding: '5px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: courtFilter === c ? 700 : 400, color: courtFilter === c ? N : g600, background: courtFilter === c ? g200 : 'transparent', marginBottom: 2 }}>
                  {c || 'All Courts'}
                </div>
              ))}
            </div>
          </div>

          {/* Area of law filter — type to filter displayed results */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Area of Law</div>
            <input
              value={areaLawFilter}
              onChange={e => setAreaLawFilter(e.target.value)}
              placeholder="e.g. Criminal, Commercial"
              style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 5, border: `1px solid ${g300}`, outline: 'none', color: g700, marginBottom: 6 }}
            />
            <div style={{ maxHeight: 120, overflowY: 'auto' }}>
              {['', ...AREAS].map(a => (
                <div key={a || 'all'} onClick={() => { setAreaFilter(a); doSearch(query, courtFilter, a); }}
                  style={{ padding: '5px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: areaFilter === a ? 700 : 400, color: areaFilter === a ? N : g600, background: areaFilter === a ? g200 : 'transparent', marginBottom: 2 }}>
                  {a || 'All Areas'}
                </div>
              ))}
            </div>
          </div>

          {/* Citation Vault */}
          <div style={{ borderTop: `1px solid ${g200}`, paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>🗄 Citation Vault</div>
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: N }}>{displayResults.length}</div>
              <div style={{ fontSize: 10, color: g500 }}>{courtNameFilter || areaLawFilter ? 'Filtered citations' : 'Citations'}</div>
            </div>
            <button onClick={exportJSON}
              style={{ width: '100%', padding: '6px 0', background: N, color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
              🗃 Export JSON
            </button>
            <button onClick={exportCSV}
              style={{ width: '100%', padding: '6px 0', background: N, color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
              📋 Export CSV
            </button>
            <button onClick={exportCompleteReport}
              style={{ width: '100%', padding: '6px 0', background: '#166534', color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
              📄 Complete Citation Report
            </button>
            <button onClick={() => setVault([])}
              style={{ width: '100%', padding: '6px 0', background: W, color: '#DC2626', borderRadius: 6, border: '1px solid #FECACA', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              🗑 Reset Vault
            </button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Search bar */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${g200}`, display: 'flex', gap: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search cases, statutes, holdings… (AND, OR, NOT)"
              style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${g300}`, fontSize: 13, outline: 'none', color: g700 }}
            />
            <button onClick={handleSearch}
              style={{ padding: '10px 22px', background: N, color: W, borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              🔍 Search
            </button>
          </div>

          {/* Results */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
            {loading && <div style={{ textAlign: 'center', padding: 40, color: g400, fontSize: 13 }}><Spin /> Loading…</div>}
            {error && <div style={{ color: R, fontSize: 13, padding: 20 }}>{error}</div>}
            {!loading && !error && (
              <>
                <div style={{ fontSize: 12, color: g500, marginBottom: 10 }}>{displayResults.length} results{(courtNameFilter || areaLawFilter) ? ' (filtered)' : ''}</div>
                {displayResults.length === 0 && <div style={{ color: g400, fontSize: 13, textAlign: 'center', padding: 40 }}>No cases found.</div>}
                {displayResults.map((r, i) => {
                  const inVault = vault.includes(r.canonicalId);
                  const pct = r.matchPct;
                  const borderColor = pct >= 80 ? '#16A34A' : pct >= 60 ? '#D97706' : pct >= 40 ? '#DC2626' : g300;
                  return (
                    <div key={r.canonicalId || i} style={{ border: `1px solid ${g200}`, borderLeft: `3px solid ${borderColor}`, borderRadius: 8, padding: '12px 16px', marginBottom: 8, background: W, display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', transition: 'box-shadow .15s' }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px #0002'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                      onClick={() => toggleVault(r.canonicalId)}>
                      {/* Vault checkbox */}
                      <div style={{ flexShrink: 0, marginTop: 2 }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${inVault ? '#16A34A' : g300}`, background: inVault ? '#16A34A' : W, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: W }}>
                          {inVault ? '✓' : ''}
                        </span>
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: N, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.caseName}</div>
                        {r.primaryCitation && <div style={{ fontSize: 11, color: g500, marginBottom: 5 }}>{r.primaryCitation}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {/* Status badge temporarily disabled */}
                          {r.court && <span style={{ fontSize: 10, color: g600, background: g100, borderRadius: 4, padding: '2px 6px' }}>{r.court}</span>}
                          {r.year && <span style={{ fontSize: 10, color: g600, background: g100, borderRadius: 4, padding: '2px 6px' }}>{r.year}</span>}
                          {r.area && <span style={{ fontSize: 10, color: B, background: BS, borderRadius: 4, padding: '2px 6px' }}>{r.area}</span>}
                        </div>
                      </div>
                      {/* Match % */}
                      {pct !== null && pct !== undefined && (
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: matchColor(pct) }}>{pct}%</div>
                          <div style={{ fontSize: 9, color: g400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Match</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Original Court Copy PDF Modal ── */}
      {origDocModal && (
        <div
          onClick={() => setOrigDocModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.72)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '92vw', maxWidth: 1100, height: '88vh',
              background: '#fff', borderRadius: 10, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', background: N, color: '#fff', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📄</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}>
                    {origDocModal.isPdf ? 'Original Court Copy (PDF)' : 'Original Court Document'}
                  </div>
                  {origDocModal.caseName && (
                    <div style={{ fontSize: 10, opacity: 0.8, marginTop: 1 }}>{origDocModal.caseName}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a
                  href={origDocModal.url}
                  download
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 11px', background: 'rgba(255,255,255,0.15)',
                    color: '#fff', borderRadius: 4, textDecoration: 'none',
                    fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.3)',
                  }}
                >
                  ⬇ Download
                </a>
                <a
                  href={origDocModal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 11px', background: 'rgba(255,255,255,0.15)',
                    color: '#fff', borderRadius: 4, textDecoration: 'none',
                    fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.3)',
                  }}
                >
                  ↗ New Tab
                </a>
                <button
                  onClick={() => setOrigDocModal(null)}
                  style={{
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff', borderRadius: 4, padding: '5px 11px',
                    cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            {/* PDF iframe viewer */}
            <iframe
              src={origDocModal.url + (origDocModal.isPdf ? '#toolbar=1&navpanes=1' : '')}
              title="Original Court Copy"
              style={{ flex: 1, border: 'none', width: '100%' }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════ */
export default function CitationReportPage({ embedded = false }) {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { showQuotaError } = useTokenQuota();

  // Firm visibility: analytics only for FIRM_ADMIN; team for both FIRM_ADMIN and FIRM_USER
  const _storedUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
  const _accountType = (_storedUser?.account_type || '').toUpperCase();
  const isFirmAdmin = _accountType === 'FIRM_ADMIN';
  const isSuperAdmin = _accountType === 'SUPER_ADMIN';
  const isFirmUser = _accountType === 'FIRM_ADMIN' || _accountType === 'FIRM_USER';

  // tabs — analytics for firm admins and super admins; team for all firm users
  const TABS = [
    { id: 'research', label: '⚖️ AI Research' },
    { id: 'search', label: '🔍 Case Search' },
    { id: 'map', label: '🕸️ Citations Map' },
    ...(isFirmAdmin || isSuperAdmin ? [{ id: 'analytics', label: '📊 Analytics' }] : []),
    ...(isFirmUser ? [{ id: 'team', label: '👥 Team' }] : []),
  ];
  const [activeTab, setActiveTab] = useState('research');

  // chat
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef(null);

  // report
  const [report, setReport] = useState(null);
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [runLiveStatus, setRunLiveStatus] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [showReport, setShowReport] = useState(false);

  // live agent logs
  const [agentLogs, setAgentLogs] = useState([]);
  const [runId, setRunId] = useState(null);
  const [showFetchLog, setShowFetchLog] = useState(false);
  const [showCostPopup, setShowCostPopup] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [reportLogs, setReportLogs] = useState([]);
  const [reportLogsLoading, setReportLogsLoading] = useState(false);
  const logPollRef = useRef(null);
  const statusPollRef = useRef(null);
  const [fullJudgmentModal, setFullJudgmentModal] = useState(null); // null | { loading } | { error } | { caseName, fullText, sourceUrl }

  // citation graph (for Citations Map tab)
  const [citationGraph, setCitationGraph] = useState(null);
  const [citationGraphLoading, setCitationGraphLoading] = useState(false);
  const [citationGraphError, setCitationGraphError] = useState(null);

  // enterprise analytics (admin tab)
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // team workspace tab
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamReports, setTeamReports] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSelCase, setTeamSelCase] = useState('');

  // ── share report modal ──
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMembers, setShareMembers] = useState([]);
  const [shareMembersLoading, setShareMembersLoading] = useState(false);
  const [shareSelected, setShareSelected] = useState(new Set()); // Set<user_id string>
  const [shareEmailInput, setShareEmailInput] = useState('');
  const [shareEmailAdded, setShareEmailAdded] = useState([]); // [{email}]
  const [shareSaving, setShareSaving] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [shareExisting, setShareExisting] = useState([]); // current shared_with list

  // sidebar / case context
  const [cases, setCases] = useState([]);
  const [selCase, setSelCase] = useState('');
  const [selCaseName, setSelCaseName] = useState('');
  const [casesLoading, setCasesLoading] = useState(false);
  const [caseDropOpen, setCaseDropOpen] = useState(false);
  const caseDropRef = useRef(null);
  const [vaultCount, setVaultCount] = useState(0);
  const [queryCount, setQueryCount] = useState(0);
  const [refDocs, setRefDocs] = useState([]);
  const [selectedPerspective, setSelectedPerspective] = useState('all');
  const [representedSide, setRepresentedSide] = useState('');
  const [caseType, setCaseType] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [legalIssueFocus, setLegalIssueFocus] = useState('');
  const [caseContextStatus, setCaseContextStatus] = useState(null);
  const [caseDocumentCount, setCaseDocumentCount] = useState(0);
  const [caseContextError, setCaseContextError] = useState(null);
  const [caseContextReloadKey, setCaseContextReloadKey] = useState(0);

  const [customKeywordsInput, setCustomKeywordsInput] = useState('');
  const [suggestedKeywords, setSuggestedKeywords] = useState(null);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [selectedKeywordChips, setSelectedKeywordChips] = useState(new Set());
  const [selectedCaseChips, setSelectedCaseChips] = useState(new Set());
  const [runMode, setRunMode] = useState(null); // null | 'auto' | 'manual'
  const [manualSearchResults, setManualSearchResults] = useState(null);
  const [manualSearching, setManualSearching] = useState(false);
  const [useV1, setUseV1] = useState(false);
  const [selectedDimension, setSelectedDimension] = useState('all');
  const fileRef = useRef(null);
  // case-specific report history
  const [caseReports, setCaseReports] = useState([]);
  const [caseReportsLoading, setCaseReportsLoading] = useState(false);
  // Report auto-save to case folder: 'uploading' | 'processing' | 'done' | { error: string }
  const [reportSaveToCaseStatus, setReportSaveToCaseStatus] = useState(null);
  const [reportSaveToCaseProgress, setReportSaveToCaseProgress] = useState(0);

  const SUGS = ['What are the grounds for anticipatory bail in India?', 'Explain right to privacy under Indian Constitution', 'Legal position on internet shutdowns in India', 'Is triple talaq constitutional?', 'Key IBC cases on resolution plan approval', 'Environmental liability principles in Indian law'];
  const queryAnalysis = analyzeQueryIntent(input);

  const loadCases = useCallback(() => {
    setCasesLoading(true);
    documentApi.getCases().then(r => { const l = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []); setCases(Array.isArray(l) ? l : []); }).catch(() => setCases([])).finally(() => setCasesLoading(false));
  }, []);


  useEffect(() => { loadCases(); }, [loadCases]);

  // Close case dropdown on outside click
  useEffect(() => {
    if (!caseDropOpen) return;
    const handler = (e) => { if (caseDropRef.current && !caseDropRef.current.contains(e.target)) setCaseDropOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [caseDropOpen]);

  useEffect(() => {
    if (!reportId) return;
    citationApi.getReport(reportId)
      .then(d => {
        console.log('[CitationPage] getReport response:', reportId?.slice(0, 8), 'citations=', d?.report_format?.citations?.length, 'hasFormat=', !!d?.report_format);
        if (!d || !d.report_format) return;
        setReport(d);
        setQuery(d?.query || '');
        setSelectedPerspective(prev => normalizePerspectiveKey(d?.report_format?.perspective || prev || 'all', 'all'));
        setSelectedDimension('all');
        setShowReport(true);
      }).catch((e) => { console.error('[CitationPage] getReport failed:', e); });
  }, [reportId]);

  // Load case-specific reports when case selection changes
  useEffect(() => {
    if (!selCase) { setCaseReports([]); return; }
    const uid = resolveCitationUserId();
    setCaseReportsLoading(true);
    citationApi.listReportsByCase(selCase, uid)
      .then(async (r) => {
        const list = (r?.reports || []).filter(x => x.status !== 'pending_hitl');
        setCaseReports(list);
        // Auto-open latest report for selected case when user opens a case from dropdown.
        if (list.length > 0 && !reportId) {
          // Try reports in order until we find one that actually exists
          for (const candidate of list.slice(0, 3)) {
            const data = await citationApi.getReport(candidate.id).catch(() => null);
            if (data?.report_format) {
              setReport(data);
              setQuery(data.query || '');
              setSelectedPerspective(prev => normalizePerspectiveKey(data?.report_format?.perspective || prev || 'all', 'all'));
              setSelectedDimension('all');
              setShowReport(true);
              navigate(`/citation/reports/${candidate.id}`, { replace: true });
              break;
            }
          }
        }
      })
      .catch(() => setCaseReports([]))
      .finally(() => setCaseReportsLoading(false));
  }, [selCase, reportId, navigate]);

  // Load case context status when case selection changes
  useEffect(() => {
    if (!selCase) {
      setCaseContextStatus(null);
      setCaseDocumentCount(0);
      setCaseContextError(null);
      return;
    }
    setCaseContextStatus('loading');
    setCaseContextError(null);
    documentApi.getCaseById(selCase)
      .then(async (cr) => {
        const cd = cr?.case ?? cr;
        if (cd?.perspective) setRepresentedSide(cd.perspective.toLowerCase());
        if (cd?.case_type) setCaseType(cd.case_type);
        if (cd?.jurisdiction) setJurisdiction(cd.jurisdiction);

        const fn = resolveCaseFolderName(cd);
        if (!fn) {
          setCaseContextStatus('empty');
          setCaseDocumentCount(0);
          return;
        }
        try {
          const fr = await documentApi.getDocumentsInFolder(fn);
          const files = fr?.files ?? fr?.data ?? (Array.isArray(fr) ? fr : []);
          const validFiles = files.filter(f => f.summary || f.full_text_content || f.name);
          setCaseDocumentCount(validFiles.length);
          if (validFiles.length > 0) {
            setCaseContextStatus('loaded');
          } else {
            setCaseContextStatus('empty');
          }
        } catch (e) {
          setCaseContextStatus('failed');
          setCaseContextError(e.message || 'Failed to fetch folder contents');
        }
      })
      .catch(e => {
        setCaseContextStatus('failed');
        setCaseContextError(e.message || 'Failed to fetch case details');
      });
  }, [selCase, caseContextReloadKey]);

  useEffect(() => { chatRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, sending]);

  // Load enterprise analytics when Analytics tab is opened
  useEffect(() => {
    if (activeTab !== 'analytics') return;
    if (analytics && !analyticsError) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    citationApi.getEnterpriseAnalytics()
      .then(d => setAnalytics(d))
      .catch(err => setAnalyticsError(err.message || 'Failed to load analytics'))
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, analytics, analyticsError]);

  // Load team workspace data when Team tab opens (refetch each time so newly shared reports appear)
  useEffect(() => {
    if (activeTab !== 'team') return;
    setTeamLoading(true);
    citationApi.getFirmMembers()
      .catch(() => ({ members: [] }))
      .then(membersRes => {
        const members = membersRes.members || [];
        setTeamMembers(members);
        const memberIds = members.map(m => String(m.user_id)).filter(Boolean);
        return citationApi.getTeamReports(memberIds, teamSelCase || null).catch(() => ({ reports: [] }));
      })
      .then(reportsRes => setTeamReports(reportsRes.reports || []))
      .finally(() => setTeamLoading(false));
  }, [activeTab, teamSelCase]);

  // ── Share handlers ──
  const handleOpenShare = useCallback(async (reportId) => {
    setShareOpen(true);
    setShareDone(false);
    setShareError(null);
    setShareEmailInput('');
    // Load firm members if not yet loaded
    if (!shareMembers.length && !shareMembersLoading) {
      setShareMembersLoading(true);
      try {
        const res = await citationApi.getFirmMembers();
        const _storedU = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const myId = String(_storedU.id || '');
        setShareMembers((res.members || []).filter(m => String(m.user_id) !== myId));
      } catch { /* ignore */ }
      setShareMembersLoading(false);
    }
    // Load existing shares
    try {
      const res = await citationApi.getReportShares(reportId);
      const existing = res.shared_with || [];
      setShareExisting(existing);
      setShareSelected(new Set(existing.map(e => String(e.user_id)).filter(Boolean)));
      setShareEmailAdded(existing.filter(e => !e.user_id && e.email).map(e => ({ email: e.email })));
    } catch { /* ignore */ }
  }, [shareMembers.length, shareMembersLoading]);

  const handleShareAddEmail = () => {
    const email = shareEmailInput.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) return;
    if (shareEmailAdded.find(e => e.email === email)) return;
    setShareEmailAdded(prev => [...prev, { email }]);
    setShareEmailInput('');
  };

  const handleShareSend = async (reportId) => {
    if (shareSaving) return;
    setShareSaving(true);
    try {
      const memberMap = Object.fromEntries(shareMembers.map(m => [String(m.user_id), m]));
      const selectedEmails = new Set([...shareSelected].map(uid => (memberMap[uid] || {}).email).filter(Boolean));
      const entries = [
        // Firm members — only valid numeric/string user_ids (skip "null" / undefined)
        ...[...shareSelected]
          .filter(uid => uid && uid !== 'null' && uid !== 'undefined')
          .map(uid => {
            const m = memberMap[uid] || {};
            return { user_id: uid, email: m.email || '', username: m.username || m.email || uid };
          }),
        // Email-only additions — omit user_id entirely, skip if already covered by a selected member
        ...shareEmailAdded
          .filter(e => e.email && !selectedEmails.has(e.email))
          .map(e => ({ email: e.email, username: e.email })),
      ];
      await citationApi.shareReport(reportId, entries);
      setShareExisting(entries);
      setShareDone(true);
      setShareError(null);
      setTimeout(() => setShareOpen(false), 1800);
    } catch (err) {
      console.error('[Share] Failed to share report:', err);
      setShareDone(false);
      setShareError(err?.message || 'Failed to share report. Please try again.');
    }
    setShareSaving(false);
  };

  const toPlainText = useCallback((v) => {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(toPlainText).filter(Boolean).join('');
    if (typeof v === 'object') {
      if (typeof v.text === 'string' || typeof v.text === 'number') return String(v.text);
      if (v.type && v.text != null) return toPlainText(v.text);
    }
    try { return JSON.stringify(v); } catch { return String(v); }
  }, []);

  const addMsg = (role, text, extra = {}) => setMsgs(p => [...p, { role, text: toPlainText(text), ts: Date.now(), ...extra }]);

  const stopPolling = useCallback(() => {
    if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; }
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
  }, []);

  // Reset all report/input state when the user switches to a different case
  const resetForNewCase = useCallback(() => {
    stopPolling();
    setInput('');
    setReport(null);
    setQuery('');
    setShowReport(false);
    setMsgs([]);
    setReportError(null);
    setAgentLogs([]);
    setRunId(null);
    setSuggestedKeywords(null);
    setSelectedKeywordChips(new Set());
    setSelectedCaseChips(new Set());
    setCustomKeywordsInput('');
    setRunMode(null);
    setManualSearchResults(null);
    navigate('/citation/reports', { replace: true });
  }, [stopPolling, navigate]);

  useEffect(() => {
    return () => Object.values({ logPollRef, statusPollRef }).forEach(ref => {
      if (ref.current) clearInterval(ref.current);
    });
  }, []);

  const handleSuggestKeywords = async () => {
    if (suggestingKeywords) return;
    setSuggestingKeywords(true);
    setSuggestedKeywords(null);
    try {
      // Backend fetches all case chunks and summarizes them — just pass case_id
      const suggestions = await citationApi.suggestKeywords(
        selCase || null,
        input.trim() || selCaseName || null,
        null,
      );
      setSuggestedKeywords(suggestions);
    } catch (e) {
      console.warn('Keyword suggestion failed:', e);
    } finally {
      setSuggestingKeywords(false);
    }
  };

  const handleManualKeywordSearch = async () => {
    const keywords = customKeywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    if (!keywords.length) return;
    setManualSearching(true);
    setManualSearchResults(null);
    try {
      const data = await citationApi.manualSearchByKeywords(keywords, resolveCitationUserId(), selCase || null);
      setManualSearchResults({ type: 'keywords', data });
    } catch (e) { console.error(e); }
    finally { setManualSearching(false); }
  };

  const handleManualKeywordChipSearch = async () => {
    const keywords = [...selectedKeywordChips];
    if (!keywords.length) return;
    setManualSearching(true);
    setManualSearchResults(null);
    try {
      const data = await citationApi.manualSearchByKeywords(keywords, resolveCitationUserId(), selCase || null);
      setManualSearchResults({ type: 'keywords', data });
    } catch (e) { console.error(e); }
    finally { setManualSearching(false); }
  };

  const handleManualCaseSearch = async () => {
    const caseNames = [...selectedCaseChips];
    if (!caseNames.length) return;
    setManualSearching(true);
    setManualSearchResults(null);
    try {
      const data = await citationApi.manualFetchCaseJudgments(caseNames, resolveCitationUserId());
      setManualSearchResults({ type: 'cases', data });
    } catch (e) { console.error(e); }
    finally { setManualSearching(false); }
  };

  const handleSend = async (force = false, overrideCaseNames = null, overrideKeywords = null) => {
    const q = (input).trim();
    const isManual = runMode === 'manual';
    const hasContext = Boolean(selCase) || refDocs.length > 0 || (isManual && customKeywordsInput.trim());
    if (sending) return;
    if (!q && !hasContext) {
      addMsg('error', 'Please enter a query, select a case, enter manual facts, or attach reference documents before generating a report.');
      return;
    }
    if (!representedSide && (runMode === 'auto' || runMode === 'manual')) {
      addMsg('error', 'Please select who we are representing before starting the scan.');
      return;
    }

    setInput('');
    addMsg('user', q || 'Generate verified citation report from case context.');
    setSending(true); setGenerating(true); setReportError(null);
    setReportSaveToCaseStatus(null);
    setReportSaveToCaseProgress(0);
    setAgentLogs([]); setRunId(null);
    setRunLiveStatus(null); setStartTime(Date.now());
    setQueryCount(p => p + 1);
    stopPolling();

    try {
      // Resolve actual user ID from stored user object (auth stores under 'user' key as JSON)
      const uid = resolveCitationUserId();
      let ctx = null;
      if (selCase) {
        try {
          const cr = await documentApi.getCaseById(selCase);
          const cd = cr?.case ?? cr;
          const fn = resolveCaseFolderName(cd);
          if (fn) {
            const fr = await documentApi.getDocumentsInFolder(fn);
            const files = fr?.files ?? fr?.data ?? (Array.isArray(fr) ? fr : []);
            // Prefer the FULL extracted text over the short summary, and send it as
            // `content` (full document) — not `snippet` — so the pipeline extracts real
            // legal issues instead of cover-page/cause-title tokens. (summary is ~500 chars.)
            ctx = (Array.isArray(files) ? files : []).map(f => ({ name: f.originalname || f.name || 'doc', content: (f.full_text_content || f.summary || '').slice(0, 160000) })).filter(f => f.content || f.name);
          }
        } catch (e) { console.warn(e); }
      }
      // If a case is selected, ONLY use that case's files as context.
      // Reference docs are used only when no case is selected.
      if (!selCase && refDocs.length > 0) {
        ctx = (ctx || []).concat(
          refDocs.map(d => ({ name: d.name, content: d.content.slice(0, 160000) })),
        );
      }
      // If no real document content, send null so the backend fetches proper RAG chunks via case_id.
      // Sending just the case name as context causes Claude to generate generic keywords for every case.
      if (ctx && ctx.length === 0) ctx = null;

      // Start async pipeline — get run_id immediately
      const isManual = runMode === 'manual';
      const generationPerspective = representedSide || 'neutral';
      const activeApi = useV1 ? citationV1Api : citationApi;
      const apiQuery = isManual ? customKeywordsInput : (q || selCaseName || 'Find relevant citations for this case');
      
      let finalCtx = ctx;
      if (isManual) {
        finalCtx = customKeywordsInput;
      }
      
      const parsedKeywords = (!isManual && customKeywordsInput)
        ? customKeywordsInput.split(',').map(k => k.trim()).filter(Boolean)
        : null;
        
      const selKwArr = overrideKeywords ?? [...selectedKeywordChips];
      const selCnArr = overrideCaseNames ?? [...selectedCaseChips];
      if (import.meta.env.DEV) {
        console.groupCollapsed('[Citation] Submit Payload');
        console.table({
          mode: runMode || 'auto',
          case_id: isManual ? null : (selCase || null),
          represented_side: representedSide,
          case_type: caseType,
          preferred_court: jurisdiction,
          legal_issue_focus: legalIssueFocus,
          retrieval_method: 'indiankanoon',
          case_context_length: finalCtx?.length || 0,
        });
        console.groupEnd();
      }

      const startData = await activeApi.startReport(
        apiQuery,
        uid,
        isManual ? null : (selCase || null),
        finalCtx,
        generationPerspective,
        'indiankanoon',
        parsedKeywords?.length ? parsedKeywords : null,
        selKwArr.length ? selKwArr : null,
        selCnArr.length ? selCnArr : null,
        representedSide,
        caseType,
        jurisdiction,
        legalIssueFocus,
        runMode || 'auto'
      );
      const rid = startData.run_id;
      setRunId(rid);

      if (import.meta.env.DEV) {
        console.groupCollapsed(`[Citation][${rid}] Run Started`);
        console.log({ run_id: rid, report_id: startData.report_id });
        console.groupEnd();
      }

      // Poll agent logs — 1.5 s interval, non-overlapping.
      let lastLogTime = '';
      let lastProgressAt = Date.now();
      let logPollInFlight = false;
      logPollRef.current = setInterval(async () => {
        if (logPollInFlight) return;
        logPollInFlight = true;
        try {
          const logData = await activeApi.getRunLogs(rid, lastLogTime);
          const newLogs = logData.logs || [];
          if (newLogs.length > 0) {
            lastLogTime = newLogs[newLogs.length - 1].created_at;
            lastProgressAt = Date.now();
            setAgentLogs(prev => [...prev, ...newLogs]);
          }
        } catch (_) { }
        finally { logPollInFlight = false; }
      }, 1500);

      // Poll status every 2 s — matches backend 8-min timeout (CITATION_SYNC_PIPELINE_TIMEOUT_SECONDS=480)
      const pollStarted = Date.now();
      let statusPollInFlight = false;
      let statusPollErrors = 0;
      statusPollRef.current = setInterval(async () => {
        if (statusPollInFlight) return;
        if (Date.now() - pollStarted > 9 * 60 * 1000) {
          stopPolling();
          addMsg('error', '❌ Pipeline timed out after 9 minutes. Please try again.');
          setReportError('Pipeline timed out.');
          setSending(false); setGenerating(false);
          return;
        }
        // Fail-safe: no progress for 90 s → treat as stuck
        if (Date.now() - lastProgressAt > 90 * 1000) {
          stopPolling();
          addMsg('error', '❌ Citation generation seems stuck. Please retry once.');
          setReportError('Pipeline appears stuck (no progress updates).');
          setSending(false); setGenerating(false);
          return;
        }
        statusPollInFlight = true;
        try {
          const st = await activeApi.getRunStatus(rid);
          setRunLiveStatus(st);
          statusPollErrors = 0;
          lastProgressAt = Date.now();
          if (import.meta.env.DEV) {
            console.groupCollapsed(`[Citation] Status Poll [${st.status}]`);
            console.log({
              run_id: rid,
              status: st.status,
              stage: st.stage || 'unknown',
              message: st.message || '',
              elapsed_seconds: Math.floor((Date.now() - pollStarted) / 1000),
              estimated_cost: st.report_format?.runCostInr || 0
            });
            console.groupEnd();
          }
          const terminalSuccessStates = new Set(['completed', 'pending_hitl']);
          const terminalFailureStates = new Set(['failed', 'unknown']);
          if (terminalSuccessStates.has(st.status) || terminalFailureStates.has(st.status)) {
            stopPolling();
            // Final log fetch
            const finalLogs = await activeApi.getRunLogs(rid, lastLogTime);
            if (finalLogs.logs?.length) setAgentLogs(prev => [...prev, ...finalLogs.logs]);

            if (terminalSuccessStates.has(st.status)) {
              let rpt = null;
              if (st.report_format) {
                rpt = { report_id: st.report_id, report_format: st.report_format, run_id: rid };
              } else if (st.report_id) {
                rpt = await activeApi.getReport(st.report_id);
              }
              if (rpt) {
                setReport(rpt); setQuery(q);

                if (import.meta.env.DEV) {
                  console.groupCollapsed('[Citation] Final Report');
                  console.log({
                    result_status: rpt.report_format?.result_status || 'UNKNOWN',
                    message: rpt.report_format?.message || '',
                    recommended_count: rpt.report_format?.recommended_count || 0,
                    adverse_count: rpt.report_format?.adverse_count || 0,
                    caution_count: rpt.report_format?.caution_count || 0,
                    citation_count: rpt.report_format?.citations?.length || 0,
                    cost_summary: rpt.report_format?.cost_summary || {},
                    pipeline_diagnostics: rpt.report_format?.pipeline_diagnostics || {}
                  });
                  console.groupEnd();

                  if (rpt.report_format?.result_status === 'NO_RELIABLE_CITATION_FOUND') {
                    console.groupCollapsed('[Citation] No Result Diagnostics');
                    const diag = rpt.report_format?.pipeline_diagnostics || {};
                    console.table({
                      no_result_reason: diag.no_result_reason || rpt.report_format?.message || 'unknown',
                      issues_count: diag.issues_count || 0,
                      queries_count: diag.queries_count || 0,
                      raw_candidates_count: diag.raw_candidates_count || 0,
                      deduped_candidates_count: diag.deduped_candidates_count || 0,
                      fragment_checked_count: diag.fragment_checked_count || 0,
                      full_docs_fetched_count: diag.full_docs_fetched_count || 0,
                      rejected_count: diag.rejected_count || 0
                    });
                    console.groupEnd();
                  }
                }

                setSelectedPerspective(normalizePerspectiveKey(rpt?.report_format?.perspective || selectedPerspective || 'all', 'all'));
                setSelectedDimension('all');
                setVaultCount(p => p + (rpt?.report_format?.citations?.length || 0));
                if (st.report_id) navigate(`/citation/reports/${st.report_id}`, { replace: true });
                if (selCase) {
                  citationApi.listReportsByCase(selCase, uid).then(r => setCaseReports((r?.reports || []).filter(r => r.status !== 'pending_hitl'))).catch(() => { });
                }
              }
            } else {
              const pipelineError = st.error || 'Pipeline failed';
              const normalized = String(pipelineError).toLowerCase();
              const suppressWatchdogMissingQuery =
                normalized.includes('watchdog failed') &&
                normalized.includes('query or keyword_sets or dimensions required');
              // Check if the pipeline error string contains a known quota error code
              const embeddedQuotaCode = [...QUOTA_ERROR_CODES].find(c => pipelineError.includes(c));
              if (embeddedQuotaCode) {
                const syntheticErr = new Error(pipelineError);
                syntheticErr.code = embeddedQuotaCode;
                syntheticErr.isQuotaError = true;
                syntheticErr.details = {};
                showQuotaError(syntheticErr);
              } else if (!suppressWatchdogMissingQuery) {
                addMsg('error', `❌ Pipeline failed: ${pipelineError}`);
              }
              setReportError(pipelineError);
            }
            setSending(false); setGenerating(false);
          }
        } catch (_) {
          statusPollErrors += 1;
          if (statusPollErrors >= 4) {
            stopPolling();
            addMsg('error', '❌ Backend is not responding right now. Please retry.');
            setReportError('Run status polling failed repeatedly.');
            setSending(false); setGenerating(false);
          }
        }
        finally { statusPollInFlight = false; }
      }, 2000);

    } catch (e) {
      stopPolling();
      if (!showQuotaError(e)) {
        addMsg('error', `❌ ${e.message}`);
        setReportError(e.message);
      }
      setSending(false); setGenerating(false);
    }
  };

  // Load citation graph when user switches to Citations Map tab
  useEffect(() => {
    if (activeTab !== 'map') return;
    const citations = report?.report_format?.citations || [];
    if (!citations.length) {
      setCitationGraph(null);
      setCitationGraphError(null);
      return;
    }
    const target = citations[0];
    const cid = target?.canonicalId;
    if (!cid) {
      setCitationGraph(null);
      setCitationGraphError('No canonical ID available for this report.');
      return;
    }
    setCitationGraphLoading(true);
    setCitationGraphError(null);
    citationApi.getCaseCitationGraph(cid)
      .then(g => setCitationGraph(g))
      .catch(err => setCitationGraphError(err.message || 'Failed to load citation graph'))
      .finally(() => setCitationGraphLoading(false));
  }, [activeTab, report]);

  const handleFile = async (files) => {
    for (const f of Array.from(files).slice(0, 3)) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!['txt', 'md', 'json', 'csv', 'html'].includes(ext)) continue;
      const content = await f.text();
      setRefDocs(p => [...p.filter(d => d.name !== f.name), { name: f.name, content: content.slice(0, 15000), size: f.size }]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleToggleFetchLog = async () => {
    if (showFetchLog) { setShowFetchLog(false); return; }
    setShowFetchLog(true);
    const rid = report?.run_id || report?.report_format?.metadata?.run_id || runId;
    if (!rid || reportLogs.length > 0) return;
    setReportLogsLoading(true);
    try {
      const base = window.CITATION_API_BASE || CITATION_SERVICE_URL;
      const res = await fetch(`${base}/citation/runs/${rid}/logs?limit=500`);
      const data = await res.json();
      setReportLogs(data.logs || []);
    } catch (e) {
      setReportLogs([]);
    } finally {
      setReportLogsLoading(false);
    }
  };

  const handleDeleteReport = async (rId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this citation report? This cannot be undone.')) return;
    const uid = resolveCitationUserId();
    try {
      await citationApi.deleteReport(rId, uid);
      if (reportId === rId || (report && report.id === rId)) {
        setReport(null);
        setShowReport(false);
        navigate('/citation', { replace: true });
      }
      if (selCase) {
        const list = await citationApi.listReportsByCase(selCase, uid).catch(() => []);
        setCaseReports((list?.reports || list || []).filter(r => r.status !== 'pending_hitl'));
      }
    } catch (err) {
      window.alert(err.message || 'Failed to delete report');
    }
  };

  const handleViewFullJudgment = useCallback(async (canonicalId, caseName) => {
    setFullJudgmentModal({ loading: true, caseName: caseName || 'Judgment' });
    try {
      const data = await citationApi.getJudgementFullText(canonicalId);
      if (!data || !data.success) {
        setFullJudgmentModal({ error: true, caseName: caseName || 'Judgment' });
        return;
      }
      setFullJudgmentModal({
        caseName: data.case_name || caseName,
        fullText: data.full_text || '',
        sourceUrl: data.source_url || '',
        source: data.source || 'local_db',
        ikResourceUrl: data.ik_resource_url || data.source_url || '',
        isLocalAdmin: !!data.is_local_admin,
        pdfBucketPath: data.pdf_bucket_path || '',
      });
    } catch {
      setFullJudgmentModal({ error: true, caseName: caseName || 'Judgment' });
    }
  }, []);

  const fetchFullJudgmentInline = useCallback(async (canonicalId, caseName) => {
    const data = await citationApi.getJudgementFullText(canonicalId);
    if (!data || !data.success) {
      throw new Error('Failed to fetch judgment');
    }
    return {
      caseName: data.case_name || caseName || 'Judgment',
      fullText: data.full_text || '',
      sourceUrl: data.source_url || '',
      source: data.source || 'local_db',
      ikResourceUrl: data.ik_resource_url || data.source_url || '',
      isLocalAdmin: !!data.is_local_admin,
      pdfBucketPath: data.pdf_bucket_path || '',
    };
  }, []);

  /* ── If showing full report page ── */
  if (showReport && report) {
    const currentReportId = report?.report_id || report?.id || reportId;
    const reportPerspective = normalizePerspectiveKey(report?.report_format?.perspective || selectedPerspective || 'all', 'all');
    return (
      <ReportErrorBoundary onClose={() => { setShowReport(false); setShowCostPopup(false); setShowDetailModal(false); }}>
      <div style={{ fontFamily: "'DM Sans',sans-serif", display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ background: g50, borderBottom: `1px solid ${g200}`, padding: '10px 24px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setShowReport(false); setMsgs([]); }}
              style={{ padding: '8px 0', border: 'none', background: 'transparent', fontSize: 13, color: N, fontWeight: 700, cursor: 'pointer' }}
            >
              ← Back to Research
            </button>
            <span style={{ color: g300 }}>|</span>
            <span style={{ fontSize: 12, color: g400, display: 'flex', alignItems: 'center', gap: 6 }}>
              {report?.report_format?.result_status === 'NO_RELIABLE_CITATION_FOUND' ? (
                <span style={{ color: '#DC2626', fontWeight: 500 }}>
                  ⚠️ {report.report_format.message || 'No safe citations found after strict filtering.'}
                </span>
              ) : (
                <span>
                  Suggested Citations for Review · 
                  <span style={{ fontWeight: 600, color: '#059669', marginLeft: 4 }}>{report?.report_format?.recommended_count ?? report?.report_format?.citations?.length ?? 0} recommended</span>
                  {report?.report_format?.adverse_count > 0 && <span style={{ fontWeight: 600, color: '#DC2626' }}> · {report.report_format.adverse_count} adverse</span>}
                  {report?.report_format?.caution_count > 0 && <span style={{ fontWeight: 600, color: '#D97706' }}> · {report.report_format.caution_count} caution</span>}
                </span>
              )}
              {report?.report_format?.runCostInr != null && Number(report.report_format.runCostInr) > 0 && (
                <button 
                  onClick={() => setShowCostPopup(true)}
                  style={{ background: 'transparent', border: 'none', color: g500, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
                >
                  · Est. run cost ₹{Number(report.report_format.runCostInr).toFixed(2)}
                </button>
              )}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {showCostPopup && (
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                <div style={{ background: W, padding: 24, borderRadius: 12, width: 600, maxWidth: '94%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: 18, color: N }}>Run Cost Breakdown — end to end</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(() => {
                      const cs = report?.report_format?.cost_summary || {};
                      const rates = cs.rates || {};
                      const ik = cs.ik_breakdown || [];
                      const ai = cs.ai_breakdown || [];
                      const ikRates = rates.indian_kanoon_per_call_inr || {};
                      const inr = (n) => `₹${Number(n || 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
                      const f2 = (n) => `₹${Number(n || 0).toFixed(2)}`;
                      const isEmbed = (m) => String(m || '').includes('embedding');
                      const rateFor = (row) => {
                        if (row.service === 'gemini') return isEmbed(row.model) ? (rates.gemini_embedding || {}) : (rates.gemini || {});
                        if (row.service === 'claude') return rates.claude || {};
                        return {};
                      };
                      return (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                            <span>Total run cost</span>
                            <span>{f2(report.report_format.runCostInr)}</span>
                          </div>
                          {rates.inr_per_usd ? (
                            <div style={{ fontSize: 11, color: g500, marginTop: -6 }}>FX: ₹{rates.inr_per_usd}/USD · AI priced in USD × FX · Indian Kanoon priced in INR/call</div>
                          ) : null}

                          {/* AI models */}
                          {ai.length > 0 && (
                            <div style={{ padding: 12, background: g50, borderRadius: 8 }}>
                              <div style={{ fontWeight: 600, marginBottom: 8, color: N }}>AI models — {f2(cs.ai_total_inr)}</div>
                              {ai.map((row, idx) => {
                                const r = rateFor(row);
                                const tin = Number(row.input_tokens || 0), tout = Number(row.output_tokens || 0);
                                return (
                                  <div key={idx} style={{ fontSize: 12.5, color: g600, marginBottom: 10, borderBottom: idx < ai.length - 1 ? `1px solid ${g200}` : 'none', paddingBottom: 6 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: N, fontWeight: 600 }}>
                                      <span>{row.model} <span style={{ color: g400, fontWeight: 400 }}>· {Number(row.calls || 0)} call(s)</span></span>
                                      <span>{f2(row.cost_inr)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>{tin.toLocaleString()} input × ₹{r.input_per_1m_inr ?? '?'}/1M</span>
                                      <span>{inr((tin / 1e6) * (r.input_per_1m_inr || 0))}</span>
                                    </div>
                                    {!isEmbed(row.model) && (
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{tout.toLocaleString()} output × ₹{r.output_per_1m_inr ?? '?'}/1M</span>
                                        <span>{inr((tout / 1e6) * (r.output_per_1m_inr || 0))}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Indian Kanoon */}
                          {ik.length > 0 && (
                            <div style={{ padding: 12, background: g50, borderRadius: 8 }}>
                              <div style={{ fontWeight: 600, marginBottom: 8, color: N }}>Indian Kanoon API — {f2(cs.ik_total_inr)}</div>
                              {ik.map((row, idx) => {
                                const rate = ikRates[row.operation];
                                return (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: g600 }}>
                                    <span>{Number(row.hits || 0)} × {row.operation}{rate != null ? ` @ ₹${rate}/call` : ''}</span>
                                    <span>{f2(row.cost_inr)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {(!ai.length && !ik.length) && (
                            <div style={{ fontSize: 13, color: g500 }}>No billable calls recorded for this run.</div>
                          )}

                          {/* Rate card */}
                          {(rates.gemini || rates.indian_kanoon_per_call_inr) && (
                            <div style={{ fontSize: 11, color: g500, lineHeight: 1.6 }}>
                              <div style={{ fontWeight: 600, color: g600, marginBottom: 2 }}>Rate card</div>
                              {rates.gemini && <div>{rates.gemini.model}: ₹{rates.gemini.input_per_1m_inr}/1M in · ₹{rates.gemini.output_per_1m_inr}/1M out</div>}
                              {rates.gemini_embedding && <div>{rates.gemini_embedding.model}: ₹{rates.gemini_embedding.input_per_1m_inr}/1M in (embeddings)</div>}
                              {ikRates.search != null && <div>Indian Kanoon: search ₹{ikRates.search} · doc ₹{ikRates.document} · fragment ₹{ikRates.fragment} · meta ₹{ikRates.meta}/call</div>}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setShowCostPopup(false)}
                      style={{ padding: '8px 16px', background: N, color: W, border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
            {showDetailModal && (
              <PipelineDetailModal report={report} onClose={() => setShowDetailModal(false)} />
            )}
            <button
              onClick={() => setShowDetailModal(true)}
              style={{
                padding: '6px 12px', fontSize: 11, fontWeight: 600, color: '#3730A3',
                background: '#EEF2FF', border: '1px solid #C7D2FE',
                borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}
              title="Inspect the full pipeline data flow: what the AI read, the issues/summary it built, the keyword searches, results and re-ranking"
            >
              <span style={{ fontSize: 12 }}>🔬</span>
              Detailed View
            </button>
            {(report?.run_id || report?.report_format?.metadata?.run_id || runId) && (
              <button
                onClick={handleToggleFetchLog}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  color: showFetchLog ? '#0F766E' : '#374151',
                  background: showFetchLog ? '#F0FDF4' : W,
                  border: `1px solid ${showFetchLog ? '#6EE7B7' : g200}`,
                  borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                }}
                title="Show IK API fetch log for this report"
              >
                <span style={{ fontSize: 12 }}>📋</span>
                {showFetchLog ? 'Hide Log' : 'Fetch Log'}
              </button>
            )}
            <button
              onClick={() => handleOpenShare(currentReportId)}
              style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: N, background: W, border: `1px solid ${g200}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Share this report with firm members"
            >
              <span style={{ fontSize: 13 }}>🔗</span> Share
            </button>
            <button
              onClick={() => handleDeleteReport(currentReportId)}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, color: '#B71C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, cursor: 'pointer' }}
              title="Delete this report"
            >
              Delete report
            </button>
            </div>
          </div>
        </div>
        {/* ── Report save to case folder: uploading / processing until complete ── */}
        {reportSaveToCaseStatus && (
          <div
            style={{
              background: reportSaveToCaseStatus === 'done' ? '#F0FDF4' : typeof reportSaveToCaseStatus === 'object' && reportSaveToCaseStatus?.error ? '#FEF2F2' : '#EFF6FF',
              borderBottom: `1px solid ${reportSaveToCaseStatus === 'done' ? '#BBF7D0' : typeof reportSaveToCaseStatus === 'object' ? '#FECACA' : '#BFDBFE'}`,
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
              fontSize: 13,
            }}
          >
            {reportSaveToCaseStatus === 'uploading' && (
              <>
                <span style={{ color: '#1E40AF' }}>📤 Uploading report PDF to case folder…</span>
              </>
            )}
            {reportSaveToCaseStatus === 'processing' && (
              <>
                <span style={{ color: '#1E40AF' }}>⏳ Processing report (chunking & embeddings)…</span>
                <span style={{ color: '#3B82F6', fontWeight: 600 }}>{Math.round(reportSaveToCaseProgress)}%</span>
              </>
            )}
            {reportSaveToCaseStatus === 'done' && (
              <span style={{ color: '#166534', fontWeight: 600 }}>✓ Report PDF saved to case folder and ready for search.</span>
            )}
            {typeof reportSaveToCaseStatus === 'object' && reportSaveToCaseStatus?.error && (
              <span style={{ color: '#991B1B' }}>Report PDF could not be saved to case folder: {reportSaveToCaseStatus.error}</span>
            )}
          </div>
        )}
        {/* ── Pipeline Fetch Log — tabular ── */}
        {showFetchLog && (
          <div style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', maxHeight: 380, overflowY: 'auto', flexShrink: 0 }}>
            {/* Header bar */}
            <div style={{
              padding: '8px 16px', background: '#1E293B',
              display: 'flex', alignItems: 'center', gap: 10,
              position: 'sticky', top: 0, zIndex: 1,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#38BDF8', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                📋 Pipeline Fetch Log
              </span>
              <span style={{ fontSize: 10, color: '#64748B' }}>
                {(report?.run_id || report?.report_format?.metadata?.run_id) ? `run: ${(report.run_id || report.report_format.metadata.run_id).slice(0, 8)}…` : ''}
              </span>
              {reportLogsLoading && (
                <span style={{ fontSize: 10, color: '#38BDF8', marginLeft: 4 }}>Loading…</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94A3B8' }}>
                {reportLogs.length} {reportLogs.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {/* Table */}
            {reportLogsLoading && reportLogs.length === 0 ? (
              <div style={{ padding: '16px 20px', fontSize: 12, color: '#94A3B8' }}>Loading logs…</div>
            ) : reportLogs.length === 0 ? (
              <div style={{ padding: '16px 20px', fontSize: 12, color: '#94A3B8' }}>No logs found for this run.</div>
            ) : (
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontSize: 11, fontFamily: "'DM Sans', sans-serif",
              }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1', position: 'sticky', top: 41, zIndex: 1 }}>
                    {['#', 'Time (IST)', 'Agent', 'Level', 'Message'].map((col, ci) => (
                      <th key={ci} style={{
                        padding: '6px 10px', textAlign: 'left',
                        fontWeight: 700, fontSize: 10, color: '#475569',
                        letterSpacing: '.05em', textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        width: ci === 0 ? 36 : ci === 1 ? 78 : ci === 2 ? 90 : ci === 3 ? 70 : 'auto',
                        borderRight: ci < 4 ? '1px solid #E2E8F0' : 'none',
                      }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportLogs.map((log, i) => {
                    const isAdmin = log.message?.includes('admin') || log.message?.includes('Admin') || log.message?.includes('judgment-service-embeddings');
                    const isIK    = log.agent_name === 'fetcher' || log.message?.includes('/doc/') || log.message?.includes('CACHE');
                    const isOk    = log.message?.startsWith('✅') || log.message?.startsWith('🎉');
                    const levelMeta = {
                      ERROR:   { bg: '#FEF2F2', color: '#DC2626', badge: '#FCA5A5' },
                      WARNING: { bg: '#FFFBEB', color: '#D97706', badge: '#FDE68A' },
                      INFO:    { bg: isAdmin ? '#ECFDF5' : isOk ? '#F0FDF4' : 'transparent', color: '#059669', badge: '#6EE7B7' },
                      DEBUG:   { bg: '#F8FAFC', color: '#94A3B8', badge: '#CBD5E1' },
                    }[log.log_level] || { bg: 'transparent', color: '#64748B', badge: '#E2E8F0' };

                    const ts = log.created_at
                      ? new Date(log.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                          hour12: false, timeZone: 'Asia/Kolkata',
                        })
                      : '—';

                    return (
                      <tr key={log.id || i} style={{
                        background: levelMeta.bg,
                        borderBottom: '1px solid #F1F5F9',
                        transition: 'background .1s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = levelMeta.bg; }}
                      >
                        {/* # */}
                        <td style={{ padding: '5px 10px', color: '#CBD5E1', fontVariantNumeric: 'tabular-nums', borderRight: '1px solid #F1F5F9', textAlign: 'right' }}>
                          {i + 1}
                        </td>
                        {/* Time */}
                        <td style={{ padding: '5px 10px', color: '#0EA5E9', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderRight: '1px solid #F1F5F9' }}>
                          {ts}
                        </td>
                        {/* Agent */}
                        <td style={{ padding: '5px 10px', borderRight: '1px solid #F1F5F9' }}>
                          <span style={{
                            display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                            background: isIK ? '#EFF6FF' : isAdmin ? '#ECFDF5' : '#F8FAFC',
                            color: isIK ? '#3B82F6' : isAdmin ? '#059669' : '#64748B',
                            fontSize: 10, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
                          }}>
                            {log.agent_name || '—'}
                          </span>
                        </td>
                        {/* Level */}
                        <td style={{ padding: '5px 10px', borderRight: '1px solid #F1F5F9' }}>
                          <span style={{
                            display: 'inline-block', padding: '1px 7px', borderRadius: 4,
                            background: levelMeta.badge + '44',
                            color: levelMeta.color,
                            fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                          }}>
                            {log.log_level || '—'}
                          </span>
                        </td>
                        {/* Message */}
                        <td style={{
                          padding: '5px 10px',
                          color: log.log_level === 'ERROR' ? '#DC2626' : isAdmin ? '#065F46' : isIK ? '#1E40AF' : '#334155',
                          lineHeight: 1.5, wordBreak: 'break-word', maxWidth: 0,
                        }}>
                          {log.message}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {report?.report_format?.result_status === 'NO_RELIABLE_CITATION_FOUND' ? (
            <div style={{ padding: 40, maxWidth: 600, margin: '0 auto' }}>
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h2 style={{ margin: '0 0 12px 0', fontSize: 18, color: '#991B1B' }}>No reliable supporting citation found in this run</h2>
                <p style={{ margin: 0, fontSize: 14, color: '#DC2626' }}>{report.report_format.message}</p>
              </div>

              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#334155' }}>Pipeline Diagnostics</h3>
                {report?.report_format?.pipeline_diagnostics ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#475569' }}>Case context:</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingLeft: 12, borderLeft: '2px solid #CBD5E1' }}>
                        <div style={{ fontSize: 13, color: '#64748B' }}>case_id:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', wordBreak: 'break-all' }}>{report.report_format.pipeline_diagnostics.case_id ?? 'N/A'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>case name:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.case_name ?? 'N/A'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>context character count:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.case_context_chars ?? '0'}</div>
                      </div>
                    </div>
                    
                    <div>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#475569' }}>Indian Kanoon search:</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingLeft: 12, borderLeft: '2px solid #CBD5E1' }}>
                        <div style={{ fontSize: 13, color: '#64748B' }}>issues extracted:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.issues_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>queries generated:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.queries_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>raw candidates:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.raw_candidates_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>deduped candidates:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.deduped_candidates_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>fragments checked:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.fragment_checked_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>full docs fetched:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.full_docs_fetched_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>recommended count:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.recommended_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>adverse count:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.adverse_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>caution count:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.caution_count ?? '0'}</div>
                        <div style={{ fontSize: 13, color: '#64748B' }}>rejected count:</div><div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{report.report_format.pipeline_diagnostics.rejected_count ?? '0'}</div>
                      </div>
                      
                      {report.report_format.pipeline_diagnostics.raw_candidates_count === 0 && report.report_format.pipeline_diagnostics.queries?.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <h5 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#475569' }}>Generated Queries (0 results):</h5>
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#64748B', fontFamily: 'monospace' }}>
                            {report.report_format.pipeline_diagnostics.queries.map((q, i) => {
                              // Supports both the legacy string form and the new dict form
                              // ({query_id, query_type, query_string, is_fallback, docs_count, doctypes}).
                              if (typeof q === 'string') return <li key={i}>{q}</li>;
                              const qStr = q.query_string || q.formInput || q.query || '';
                              const hits = q.docs_count ?? q.result_count;
                              return (
                                <li key={q.query_id || i}>
                                  {qStr || '—'}
                                  {q.query_type ? <span style={{ color: '#94A3B8' }}> · {q.query_type}{q.is_fallback ? ' (fallback)' : ''}</span> : null}
                                  {q.doctypes ? <span style={{ color: '#94A3B8' }}> · {q.doctypes}</span> : null}
                                  {hits != null ? <span style={{ color: hits === 0 ? '#DC2626' : '#059669' }}> · {hits} hits</span> : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#475569' }}>Failure reason:</h4>
                      <div style={{ paddingLeft: 12, borderLeft: '2px solid #CBD5E1', fontSize: 13, fontWeight: 600, color: '#991B1B' }}>
                        {report.report_format.pipeline_diagnostics.no_result_reason || report.report_format.message || 'Unknown reason'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#64748B' }}>Diagnostics data not available.</div>
                )}
              </div>

              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 24 }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#92400E' }}>Suggestions</h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#B45309', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <li>Check if the correct represented side is selected.</li>
                  <li>Verify the case context is fully loaded and relevant.</li>
                  <li>Try adding a specific citation focus or legal issue manually.</li>
                  <li>Try selecting a broader jurisdiction if no specific court was matched.</li>
                  <li>Retry the scan if Indian Kanoon or document service was temporarily unavailable.</li>
                </ul>
              </div>
            </div>
          ) : (
            <ReportDoc
              report={report}
              query={query}
              cases={cases}
              onViewFullJudgment={handleViewFullJudgment}
              onFetchFullJudgment={fetchFullJudgmentInline}
              initialPerspective={selectedPerspective}
              initialDimension={selectedDimension}
              onPerspectiveChange={setSelectedPerspective}
            />
          )}
        </div>

        {/* ── Share Report Modal ── */}
        {shareOpen && (() => {
          const totalSelected = shareSelected.size + shareEmailAdded.length;
          return (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 24 }}
              onClick={() => setShareOpen(false)}
            >
              <div
                style={{ background: W, borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.22)', width: '100%', maxWidth: 460, fontFamily: "'DM Sans',sans-serif", overflow: 'hidden' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${g100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: N }}>Share Report</div>
                    <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Share with your firm members — they can view this report</div>
                  </div>
                  <button onClick={() => setShareOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: g400, lineHeight: 1, padding: '0 0 0 8px' }}>×</button>
                </div>

                {/* Email input with autocomplete */}
                {(() => {
                  const q = shareEmailInput.trim().toLowerCase();
                  const suggestions = q.length === 0 ? [] : [...shareMembers]
                    .filter(m => {
                      const uid = String(m.user_id);
                      if (shareSelected.has(uid)) return false;
                      const name = (m.username || '').toLowerCase();
                      const email = (m.email || '').toLowerCase();
                      return name.includes(q) || email.includes(q);
                    })
                    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));

                  const handleSuggestionClick = (m) => {
                    const uid = m.user_id != null ? String(m.user_id) : null;
                    if (uid && uid !== 'null') {
                      setShareSelected(prev => { const s = new Set(prev); s.add(uid); return s; });
                    } else if (m.email) {
                      // No user_id — treat as email-only addition
                      setShareEmailAdded(prev => prev.find(e => e.email === m.email) ? prev : [...prev, { email: m.email }]);
                    }
                    setShareEmailInput('');
                  };

                  return (
                    <div style={{ padding: '14px 24px 0' }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Add people by name or email…"
                            value={shareEmailInput}
                            onChange={e => setShareEmailInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (suggestions.length > 0) handleSuggestionClick(suggestions[0]);
                                else handleShareAddEmail();
                              }
                              if (e.key === 'Escape') setShareEmailInput('');
                            }}
                            style={{ flex: 1, padding: '9px 13px', fontSize: 13, border: `1.5px solid ${suggestions.length > 0 ? N : g200}`, borderRadius: suggestions.length > 0 ? '8px 8px 0 0' : 8, outline: 'none', color: N, fontFamily: 'inherit', transition: 'border-color .15s' }}
                            autoComplete="off"
                          />
                          <button
                            onClick={handleShareAddEmail}
                            style={{ padding: '9px 15px', fontSize: 13, fontWeight: 700, background: N, color: W, border: 'none', borderRadius: 8, cursor: 'pointer' }}
                          >Add</button>
                        </div>

                        {/* Autocomplete dropdown */}
                        {suggestions.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 48, background: W, border: `1.5px solid ${N}`, borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, overflow: 'hidden' }}>
                            {suggestions.map((m, i) => {
                              const name = m.username || m.email || String(m.user_id);
                              const initials = name.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
                              return (
                                <div
                                  key={m.user_id}
                                  onMouseDown={e => { e.preventDefault(); handleSuggestionClick(m); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? `1px solid ${g100}` : 'none', background: W, transition: 'background .1s' }}
                                  onMouseEnter={e => e.currentTarget.style.background = g50}
                                  onMouseLeave={e => e.currentTarget.style.background = W}
                                >
                                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: N, color: W, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                    {initials}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                    <div style={{ fontSize: 11, color: g400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Added email chips */}
                      {shareEmailAdded.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {shareEmailAdded.map((e, i) => (
                            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 12px', background: BS, color: B, borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                              {e.email}
                              <button onClick={() => setShareEmailAdded(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: B, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Firm members list */}
                <div style={{ padding: '12px 24px', maxHeight: 280, overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Firm Members</div>
                  {shareMembersLoading ? (
                    <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
                  ) : shareMembers.length === 0 ? (
                    <div style={{ fontSize: 12, color: g400, padding: '10px 0' }}>No other firm members found.</div>
                  ) : shareMembers.map(m => {
                    const uid = String(m.user_id);
                    const isChecked = shareSelected.has(uid);
                    const name = m.username || m.email || uid;
                    const initials = name.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
                    return (
                      <div
                        key={uid}
                        onClick={() => setShareSelected(prev => { const s = new Set(prev); s.has(uid) ? s.delete(uid) : s.add(uid); return s; })}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${g100}`, cursor: 'pointer', userSelect: 'none' }}
                      >
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: isChecked ? N : g100, color: isChecked ? W : g500, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, transition: 'background .15s' }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ fontSize: 11, color: g400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isChecked ? N : g300}`, background: isChecked ? N : W, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                          {isChecked && <span style={{ color: W, fontSize: 12, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Error message */}
                {shareError && (
                  <div style={{ padding: '10px 24px', background: RS, color: R, fontSize: 12, fontWeight: 600 }}>
                    {shareError}
                  </div>
                )}
                {/* Footer */}
                {shareDone ? (
                  <div style={{ padding: '14px 24px', borderTop: `1px solid ${g100}`, display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontSize: 13, fontWeight: 600 }}>
                    <span>✓</span> Report shared successfully!
                  </div>
                ) : (
                  <div style={{ padding: '14px 24px', borderTop: `1px solid ${g100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: g400 }}>
                      {totalSelected > 0 ? `${totalSelected} ${totalSelected === 1 ? 'person' : 'people'} selected` : 'Select people to share with'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setShareOpen(false)} style={{ padding: '8px 16px', fontSize: 13, border: `1px solid ${g200}`, borderRadius: 8, background: W, color: g600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      <button
                        onClick={() => handleShareSend(currentReportId)}
                        disabled={shareSaving || totalSelected === 0}
                        style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', fontFamily: 'inherit', cursor: totalSelected === 0 || shareSaving ? 'not-allowed' : 'pointer', background: totalSelected > 0 && !shareSaving ? N : g200, color: totalSelected > 0 && !shareSaving ? W : g400 }}
                      >
                        {shareSaving ? 'Sharing…' : `Share${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Full judgment modal */}
        {fullJudgmentModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15,23,42,.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 24,
            }}
            onClick={() => setFullJudgmentModal(null)}
          >
            <div
              style={{
                background: W,
                borderRadius: 12,
                boxShadow: '0 20px 60px rgba(0,0,0,.25)',
                maxWidth: 720,
                width: '100%',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                fontFamily: "'DM Sans',sans-serif",
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${g200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: N, margin: 0 }}>
                  {fullJudgmentModal.caseName || 'Complete judgment'}
                </h2>
                <button
                  type="button"
                  onClick={() => setFullJudgmentModal(null)}
                  style={{ padding: '6px 12px', border: 'none', background: g200, borderRadius: 6, fontSize: 12, fontWeight: 600, color: g700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20 }}>
                {fullJudgmentModal.loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 40, justifyContent: 'center' }}>
                    <Spin />
                    <span style={{ fontSize: 13, color: g500 }}>Loading judgment…</span>
                  </div>
                )}
                {fullJudgmentModal.error && (
                  <div style={{ padding: 24, textAlign: 'center', color: R, fontSize: 13 }}>
                    Could not load the complete judgment. It may not be available for this citation.
                  </div>
                )}
                {!fullJudgmentModal.loading && !fullJudgmentModal.error && (
                  <>
                    {fullJudgmentModal.source === 'indiankanoon_live' && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                        padding: '8px 12px', background: '#EFF6FF', borderRadius: 8,
                        border: '1px solid #BFDBFE', fontSize: 12, color: '#1D4ED8',
                        flexWrap: 'wrap',
                      }}>
                        <span style={{ fontWeight: 700 }}>Live from Indian Kanoon</span>
                        <span style={{ color: '#93C5FD' }}>·</span>
                        <span style={{ color: '#475569' }}>Not stored — fetched directly from IK API</span>
                        {fullJudgmentModal.ikResourceUrl && (
                          <>
                            <span style={{ color: '#93C5FD' }}>·</span>
                            <a
                              href={fullJudgmentModal.ikResourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1D4ED8', fontWeight: 600, textDecoration: 'underline' }}
                            >
                              View on Indian Kanoon ↗
                            </a>
                          </>
                        )}
                      </div>
                    )}
                    {fullJudgmentModal.isLocalAdmin && fullJudgmentModal.pdfBucketPath && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                        padding: '8px 12px', background: '#F0FDF4', borderRadius: 8,
                        border: '1px solid #BBF7D0', fontSize: 12, color: '#166534',
                        flexWrap: 'wrap',
                      }}>
                        <span style={{ fontWeight: 700 }}>Admin Upload</span>
                        <span style={{ color: '#86EFAC' }}>·</span>
                        <span style={{ color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {fullJudgmentModal.pdfBucketPath}
                        </span>
                        {/^https?:\/\//.test(fullJudgmentModal.pdfBucketPath) && (
                          <>
                            <span style={{ color: '#86EFAC' }}>·</span>
                            <a
                              href={fullJudgmentModal.pdfBucketPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#166534', fontWeight: 600, textDecoration: 'underline' }}
                            >
                              Open PDF ↗
                            </a>
                          </>
                        )}
                      </div>
                    )}
                    <div
                      style={{
                        fontFamily: "'Source Serif 4',Georgia,serif",
                        fontSize: 14,
                        lineHeight: 1.85,
                        color: '#1E293B',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {fullJudgmentModal.fullText || 'No full text available for this judgment.'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </ReportErrorBoundary>
    );
  }

  /* ── Main research page ── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: "'DM Sans',-apple-system,sans-serif", background: g50 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box}
        @keyframes fdUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes glow{0%,100%{box-shadow:0 8px 32px rgba(27,42,74,.18)}50%{box-shadow:0 12px 40px rgba(33,193,182,.22)}}
        .tab-c{cursor:pointer;border:none;background:transparent;display:flex;align-items:center;gap:6px;padding:12px 18px;font-size:13px;font-weight:500;color:${g400};border-bottom:2.5px solid transparent;transition:all .18s;font-family:'DM Sans',sans-serif;letter-spacing:.01em}
        .tab-c:hover{color:${g700}}
        .tab-c.on{color:${T};border-bottom-color:${T};font-weight:700}
        .sug{padding:8px 14px;background:${W};border:1px solid ${g200};border-radius:20px;font-size:12px;color:${g600};cursor:pointer;font-weight:600;transition:all .18s;font-family:'DM Sans',sans-serif;text-align:left}
        .sug:hover{border-color:${T};color:${N};background:#F0FEFB;transform:translateY(-1px)}
        .send-b{height:46px;padding:0 24px;background:linear-gradient(135deg,${T},${TD});color:${W};border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;white-space:nowrap;box-shadow:0 3px 10px rgba(33,193,182,.35);letter-spacing:.01em}
        .send-b:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(33,193,182,.45)}
        .send-b:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
        .chat-in{flex:1;height:46px;border:1.5px solid ${g200};border-radius:12px;padding:0 16px;font-size:13.5px;outline:none;transition:all .2s;font-family:'DM Sans',sans-serif;color:${g700};background:${g50}}
        .chat-in:focus{border-color:${T};background:${W};box-shadow:0 0 0 3px rgba(33,193,182,.1)}
        .chat-in:disabled{opacity:.55}
        .sel-in{width:100%;padding:10px 12px;border:1.5px solid ${g200};border-radius:10px;font-size:12px;outline:none;font-family:'DM Sans',sans-serif;cursor:pointer;color:${g700};background:${W};transition:border-color .18s}
        .sel-in:focus{border-color:${T}}
        .view-rep-btn{display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:7px 14px;background:${T};color:${W};border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .15s}
        .view-rep-btn:hover{opacity:.88}
        .ref-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#F0FDFB;border:1px solid #99F6E4;border-radius:14px;font-size:10px;color:#0F766E;font-weight:600;margin:2px}
        .sc::-webkit-scrollbar{width:4px}.sc::-webkit-scrollbar-thumb{background:${g200};border-radius:8px}
        .persp-sel{height:46px;padding:0 12px;border-radius:12px;border:1.5px solid ${g200};font-size:12px;color:${g700};background:${W};outline:none;cursor:pointer;font-family:'DM Sans',sans-serif;transition:border-color .18s}
        .persp-sel:focus{border-color:${T}}
        .case-card{padding:10px 12px;background:${W};border:1.5px solid ${g200};border-radius:10px;cursor:pointer;transition:all .18s;display:flex;flex-direction:column;gap:3px}
        .case-card:hover{border-color:${T};background:#F0FEFB;transform:translateX(2px);box-shadow:0 2px 8px rgba(33,193,182,.12)}
        .sidebar-label{font-size:10px;font-weight:700;color:${g400};text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
        .attach-icon-btn{width:46px;height:46px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${g200};border-radius:12px;cursor:pointer;font-size:18px;background:${W};transition:all .18s;flex-shrink:0}
        .attach-icon-btn:hover{border-color:${T};background:#F0FEFB;transform:translateY(-1px)}
      `}</style>

      {/* AI Research tab */}
      {activeTab === 'research' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: suggestedKeywords ? `280px 1fr 340px` : '1fr 340px', gap: 0, overflow: 'hidden', transition: 'grid-template-columns .25s ease' }}>

          {/* ── LEFT suggestions panel (appears after Suggest Keywords, hidden in manual mode) ── */}
          {suggestedKeywords && (() => {
            const kwGroups = [
              { label: 'Statute / Section',  key: 'statute_keywords',   color: '#3B6FE8', isCase: false },
              { label: 'Legal Principle',     key: 'principle_keywords', color: '#7C3AED', isCase: false },
              { label: 'Fact Pattern',        key: 'fact_keywords',      color: '#0891B2', isCase: false },
              { label: 'Related Cases',       key: 'case_keywords',      color: '#6D28D9', isCase: true  },
            ];
            const totalSelected = selectedKeywordChips.size + selectedCaseChips.size;
            const handleChipClick = (kw, isCase) => {
              const setter = isCase ? setSelectedCaseChips : setSelectedKeywordChips;
              setter(prev => {
                const next = new Set(prev);
                if (next.has(kw)) next.delete(kw); else next.add(kw);
                return next;
              });
            };
            return (
              <div className="sc" style={{ borderRight: `1px solid ${g200}`, background: `linear-gradient(180deg,#F0F4FF 0%,${g50} 100%)`, overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'fdUp .22s ease' }}>
                {/* Header */}
                <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${g200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: W }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: N, letterSpacing: '-.01em' }}>Keyword Suggestions</div>
                    <div style={{ fontSize: 10, color: g400, marginTop: 1 }}>Click to select — bypasses AI generation</div>
                  </div>
                  <button
                    onClick={() => { setSuggestedKeywords(null); setSelectedKeywordChips(new Set()); setSelectedCaseChips(new Set()); }}
                    style={{ width: 22, height: 22, border: 'none', background: g100, borderRadius: '50%', color: g500, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}
                  >×</button>
                </div>
                {/* Selection badge */}
                {totalSelected > 0 ? (
                  <div style={{ padding: '6px 14px', background: '#ECFDF5', borderBottom: `1px solid #A7F3D0`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11 }}>⚡</span>
                    <span style={{ fontSize: 10, color: '#065F46', fontWeight: 700 }}>
                      {totalSelected} selected — AI query generation bypassed
                      {selectedCaseChips.size > 0 && ` · ${selectedCaseChips.size} case name(s) searched by title on IK`}
                    </span>
                  </div>
                ) : (
                  <div style={{ padding: '6px 14px', background: '#EEF2FF', borderBottom: `1px solid #E0E7FF`, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11 }}>🔍</span>
                    <span style={{ fontSize: 10, color: '#4338CA', fontWeight: 600 }}>Claude + Google Grounding</span>
                  </div>
                )}
                {/* Chip groups */}
                <div style={{ padding: '10px 12px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {kwGroups.map(grp => {
                    const kws = suggestedKeywords[grp.key] || [];
                    if (!kws.length) return null;
                    const selectedSet = grp.isCase ? selectedCaseChips : selectedKeywordChips;
                    return (
                      <div key={grp.key} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: grp.color, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                          {grp.label}
                          {grp.isCase && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 600, color: g400, textTransform: 'none' }}>searched by title on IK</span>}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {kws.map((kw, i) => {
                            const selected = selectedSet.has(kw);
                            return (
                              <button
                                key={i}
                                onClick={() => handleChipClick(kw, grp.isCase)}
                                title={selected ? 'Click to deselect' : 'Click to select for direct IK search'}
                                style={{
                                  padding: '4px 10px',
                                  background: selected ? grp.color : W,
                                  color: selected ? W : g700,
                                  border: `1.5px solid ${grp.color}`,
                                  borderRadius: 20,
                                  fontSize: 11,
                                  fontFamily: "'DM Sans',sans-serif",
                                  cursor: 'pointer',
                                  fontWeight: selected ? 700 : 500,
                                  transition: 'all .15s',
                                  textAlign: 'left',
                                  lineHeight: 1.4,
                                  boxShadow: selected ? `0 2px 8px ${grp.color}55` : 'none',
                                }}
                              >
                                {selected ? '✓ ' : '+ '}{kw}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sticky Generate footer ── */}
                {(selectedKeywordChips.size > 0 || selectedCaseChips.size > 0) && (
                  <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${g200}`, background: W, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {selectedKeywordChips.size > 0 && (
                      <button
                        onClick={() => handleSend(true, null, [...selectedKeywordChips])}
                        disabled={sending}
                        style={{ width: '100%', padding: '10px 0', background: sending ? g200 : `linear-gradient(135deg,${T},${TD})`, color: sending ? g400 : W, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: "'DM Sans',sans-serif", boxShadow: sending ? 'none' : `0 4px 14px rgba(33,193,182,.35)`, transition: 'all .2s' }}
                      >
                        {sending ? <><Spin /> Generating…</> : <>⚡ Generate Report &nbsp;<span style={{ background: 'rgba(255,255,255,.25)', borderRadius: 6, padding: '1px 7px', fontSize: 11 }}>{selectedKeywordChips.size} keyword{selectedKeywordChips.size > 1 ? 's' : ''}</span></>}
                      </button>
                    )}
                    {selectedCaseChips.size > 0 && (
                      <button
                        onClick={() => handleSend(true, [...selectedCaseChips], null)}
                        disabled={sending}
                        style={{ width: '100%', padding: '9px 0', background: sending ? g200 : `linear-gradient(135deg,#6D28D9,#7C3AED)`, color: sending ? g400 : W, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: "'DM Sans',sans-serif", boxShadow: sending ? 'none' : `0 4px 14px rgba(109,40,217,.3)`, transition: 'all .2s' }}
                      >
                        {sending ? <><Spin /> Generating…</> : <>⚖️ Generate from Cases &nbsp;<span style={{ background: 'rgba(255,255,255,.25)', borderRadius: 6, padding: '1px 7px', fontSize: 11 }}>{selectedCaseChips.size}</span></>}
                      </button>
                    )}
                    {selectedKeywordChips.size > 0 && selectedCaseChips.size > 0 && (
                      <button
                        onClick={() => handleSend(true, [...selectedCaseChips], [...selectedKeywordChips])}
                        disabled={sending}
                        style={{ width: '100%', padding: '8px 0', background: 'transparent', color: T, border: `1.5px solid ${T}`, borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all .2s' }}
                      >
                        Generate with All Selected
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Chat area */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, background: W, borderRight: `1px solid ${g200}` }}>
            {/* Messages — scrollable */}
            <div className="sc" style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: `linear-gradient(180deg,#EEF4FF 0%,${W} 42%)` }}>
              {sending && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', animation: 'fdUp .35s ease', padding: '40px 28px' }}>
                  {/* Pulse ring + icon */}
                  <div style={{ position: 'relative', marginBottom: 24 }}>
                    <div style={{ position: 'absolute', inset: -20, borderRadius: '50%', background: `radial-gradient(circle,rgba(33,193,182,.18) 0%,transparent 70%)`, animation: 'glow 2s ease-in-out infinite' }} />
                    <div style={{ width: 80, height: 80, borderRadius: 22, background: `linear-gradient(145deg,${N} 0%,${TD} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, boxShadow: `0 10px 32px rgba(27,42,74,.3)`, animation: 'glow 2.5s ease-in-out infinite', position: 'relative' }}>⚖️</div>
                  </div>

                  <h3 style={{ fontSize: 20, fontWeight: 800, color: N, marginBottom: 6, letterSpacing: '-.02em', textAlign: 'center' }}>Generating Citations…</h3>
                  <p style={{ fontSize: 12, color: g400, marginBottom: 16, textAlign: 'center' }}>
                    {selCaseName && runMode === 'auto' ? `Analysing case context for "${selCaseName.length > 40 ? selCaseName.slice(0,38)+'…' : selCaseName}"` : 'Processing case context…'}
                  </p>

                  {/* Run Info */}
                  <div style={{ display: 'flex', gap: 24, marginBottom: 24, fontSize: 11, color: g500, fontFamily: 'monospace', background: g50, padding: '8px 16px', borderRadius: 8, border: `1px solid ${g100}` }}>
                    {runId && <span>ID: {runId.split('-')[0]}...</span>}
                    {startTime && <span>Elapsed: {Math.floor((Date.now() - startTime) / 1000)}s</span>}
                    {runLiveStatus?.report_format?.runCostInr != null ? (
                      <span style={{ color: '#059669', fontWeight: 600 }}>Cost: ₹{Number(runLiveStatus.report_format.runCostInr).toFixed(2)}</span>
                    ) : (
                      <span>Cost: pending</span>
                    )}
                  </div>

                  {/* Progress steps derived from agentLogs */}
                  {(() => {
                    const STEPS = [
                      { id: 'start',     label: 'Starting pipeline',            keywords: ['start', 'initializ', 'begin', 'run_id'] },
                      { id: 'docs',      label: 'Loading case documents',       keywords: ['document', 'folder', 'file', 'context', 'fetch'] },
                      { id: 'dims',      label: 'Extracting keywords',          keywords: ['keyword', 'dimension', 'extract', 'legal dim', 'identify'] },
                      { id: 'search',    label: 'Searching citation database',  keywords: ['search', 'query', 'ik', 'indiakant', 'retriev'] },
                      { id: 'verify',    label: 'Verifying citations',          keywords: ['verif', 'watchdog', 'status', 'check', 'valid'] },
                      { id: 'build',     label: 'Building report',              keywords: ['build', 'report', 'generat', 'compil', 'format'] },
                    ];
                    const latestMsg = agentLogs.length > 0 ? agentLogs[agentLogs.length - 1].message?.toLowerCase() || '' : '';
                    let activeIdx = agentLogs.length === 0 ? 0 : 0;
                    for (let i = STEPS.length - 1; i >= 0; i--) {
                      if (STEPS[i].keywords.some(k => latestMsg.includes(k))) { activeIdx = i; break; }
                    }
                    if (agentLogs.length > 0 && activeIdx === 0) activeIdx = Math.min(1, STEPS.length - 1);
                    const pct = Math.min(96, Math.round(((activeIdx + (agentLogs.length > 0 ? 0.6 : 0)) / STEPS.length) * 100));
                    return (
                      <div style={{ width: '100%', maxWidth: 480 }}>
                        {/* % bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: g500 }}>Progress</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: T }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, background: g100, borderRadius: 6, marginBottom: 22, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${T},${TD})`, borderRadius: 6, transition: 'width 1s ease', boxShadow: `0 0 8px rgba(33,193,182,.4)` }} />
                        </div>
                        {/* Steps */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {STEPS.map((s, i) => {
                            const done = i < activeIdx;
                            const active = i === activeIdx;
                            return (
                              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: active ? `linear-gradient(135deg,rgba(33,193,182,.08),rgba(27,42,74,.04))` : done ? 'transparent' : 'transparent', border: active ? `1.5px solid rgba(33,193,182,.3)` : `1px solid ${done ? 'transparent' : g100}`, transition: 'all .3s' }}>
                                <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? T : active ? `linear-gradient(135deg,${T},${TD})` : g100, boxShadow: active ? `0 0 10px rgba(33,193,182,.4)` : 'none', transition: 'all .3s' }}>
                                  {done ? (
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke={W} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  ) : active ? (
                                    <Spin />
                                  ) : (
                                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: g300 }} />
                                  )}
                                </div>
                                <span style={{ fontSize: 12.5, fontWeight: active ? 700 : done ? 600 : 500, color: active ? N : done ? g500 : g300, flex: 1 }}>{s.label}</span>
                                {done && <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke={T} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                {active && <span style={{ fontSize: 9, fontWeight: 800, color: T, textTransform: 'uppercase', letterSpacing: '.08em' }}>Running</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {!sending && msgs.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', minHeight: '100%', animation: 'fdUp .4s ease', padding: '40px 32px 24px' }}>

                  {/* Icon */}
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <div style={{ position: 'absolute', inset: -18, borderRadius: 42, background: `radial-gradient(circle,rgba(33,193,182,.12) 0%,transparent 70%)` }} />
                    <div style={{ width: 68, height: 68, borderRadius: 20, background: `linear-gradient(145deg,${N} 0%,${TD} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, position: 'relative', animation: 'glow 3s ease-in-out infinite', boxShadow: `0 8px 28px rgba(27,42,74,.28)` }}>⚖️</div>
                  </div>

                  <h3 style={{ fontSize: 21, fontWeight: 800, color: N, marginBottom: 4, letterSpacing: '-.03em', lineHeight: 1.2, textAlign: 'center' }}>Citation Assistant</h3>
                  <p style={{ fontSize: 12, color: g500, maxWidth: 380, lineHeight: 1.7, margin: '0 auto 20px', textAlign: 'center' }}>
                    Find suggested citations supporting the selected side. AI-assisted legal research. Always verify before court use.
                  </p>

                  {/* ── Custom case selector card ── */}
                  <div ref={caseDropRef} style={{ width: '100%', maxWidth: 580, position: 'relative' }}>
                    {/* Card */}
                    <div style={{ background: W, borderRadius: 16, border: `1.5px solid ${caseDropOpen ? T : g200}`, boxShadow: caseDropOpen ? `0 0 0 3px rgba(33,193,182,.12), 0 6px 24px rgba(27,42,74,.1)` : `0 3px 16px rgba(27,42,74,.07)`, transition: 'border-color .2s, box-shadow .2s' }}>

                      {/* Card header stripe */}
                      <div style={{ padding: '10px 16px 8px', borderBottom: `1px solid ${g100}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: T, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: N, textTransform: 'uppercase', letterSpacing: '.1em' }}>Case Context</span>
                      </div>

                      {/* Trigger button */}
                      <button
                        type="button"
                        onClick={() => !casesLoading && setCaseDropOpen(o => !o)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'transparent', border: 'none', cursor: casesLoading ? 'default' : 'pointer', gap: 10, fontFamily: "'DM Sans',sans-serif" }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: selCase ? `linear-gradient(135deg,${T},${TD})` : `linear-gradient(135deg,${g100},${g200})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0, transition: 'background .25s' }}>
                            {selCase ? '📂' : '📁'}
                          </div>
                          <div style={{ textAlign: 'left', minWidth: 0 }}>
                            {selCase ? (
                              <>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selCaseName}</div>
                                {caseContextStatus === 'loading' && <div style={{ fontSize: 10.5, color: g500, fontWeight: 600, marginTop: 2 }}>⏳ Loading case context...</div>}
                                {caseContextStatus === 'loaded' && <div style={{ fontSize: 10.5, color: T, fontWeight: 600, marginTop: 2 }}>✓ Case context active ({caseDocumentCount} document{caseDocumentCount !== 1 ? 's' : ''})</div>}
                                {caseContextStatus === 'empty' && <div style={{ fontSize: 10.5, color: '#D97706', fontWeight: 600, marginTop: 2 }}>⚠️ Case context is missing or empty</div>}
                                {caseContextStatus === 'failed' && <div style={{ fontSize: 10.5, color: '#DC2626', fontWeight: 600, marginTop: 2 }}>❌ {caseContextError || 'Failed to load case context'}</div>}
                              </>
                            ) : (
                              <div style={{ fontSize: 13, color: g400, fontWeight: 500 }}>{casesLoading ? 'Loading cases…' : cases.length === 0 ? 'No cases found' : 'Select a case…'}</div>
                            )}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {selCase && (
                            <span
                              onClick={e => { e.stopPropagation(); resetForNewCase(); setSelCase(''); setSelCaseName(''); setCaseDropOpen(false); }}
                              style={{ width: 20, height: 20, borderRadius: '50%', background: g100, color: g500, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}
                            >×</span>
                          )}
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ transform: caseDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform .22s', color: caseDropOpen ? T : g400 }}>
                            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </button>

                      {/* Active case — confirmation bar only */}
                      {selCase && caseContextStatus === 'loaded' && (
                        <div style={{ margin: '0 12px 12px' }}>
                          <div style={{ padding: '8px 12px', background: `linear-gradient(135deg,rgba(33,193,182,.08),rgba(27,42,74,.05))`, border: `1px solid rgba(33,193,182,.25)`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke={T} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            <span style={{ fontSize: 11, color: N, fontWeight: 600 }}>Case context loaded — ready to generate report</span>
                          </div>
                        </div>
                      )}
                      {selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && (
                        <div style={{ margin: '0 12px 12px' }}>
                          <div style={{ padding: '12px', background: '#FEF2F2', border: `1px solid #FCA5A5`, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 600 }}>Case context is missing or empty. Citation scan cannot run because there is no case text to analyze.</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setCaseContextReloadKey(key => key + 1); }} style={{ padding: '6px 12px', fontSize: 11, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Retry loading case context</button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setRunMode('manual'); }} style={{ padding: '6px 12px', fontSize: 11, background: '#fff', color: '#DC2626', border: '1px solid #DC2626', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Use manual facts instead</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Dropdown panel */}
                    {caseDropOpen && cases.length > 0 && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: W, borderRadius: 14, border: `1.5px solid ${T}`, boxShadow: `0 10px 36px rgba(27,42,74,.18)`, zIndex: 100, overflow: 'hidden', animation: 'fdUp .16s ease' }}>
                        <div style={{ padding: '6px 8px', maxHeight: 260, overflowY: 'auto' }} className="sc">
                          {cases.map((c, idx) => {
                            const name = c.case_title || c.name || c.id;
                            const isSel = selCase === c.id;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { resetForNewCase(); setSelCase(c.id); setSelCaseName(name); setCaseDropOpen(false); }}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, border: 'none', background: isSel ? `linear-gradient(135deg,rgba(33,193,182,.1),rgba(27,42,74,.06))` : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background .14s', fontFamily: "'DM Sans',sans-serif", marginBottom: idx < cases.length - 1 ? 2 : 0 }}
                                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = g50; }}
                                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                              >
                                <div style={{ width: 34, height: 34, borderRadius: 8, background: isSel ? `linear-gradient(135deg,${N},${TD})` : `linear-gradient(135deg,${N},${NL})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                                  ⚖️
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, color: isSel ? N : g700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                  {c.created_at && <div style={{ fontSize: 10, color: g400, marginTop: 1 }}>{new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
                                </div>
                                {isSel && (
                                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                                    <path d="M3 8l4 4 6-7" stroke={T} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mode selector */}
                  {runMode === null && (
                    <div style={{ width: '100%', maxWidth: 580, marginTop: 14, display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => { setSuggestedKeywords(null); setSelectedKeywordChips(new Set()); setSelectedCaseChips(new Set()); setRunMode('auto'); }}
                        style={{ flex: 1, padding: '14px 16px', background: W, border: `1.5px solid ${g100}`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif", transition: 'border-color .2s, box-shadow .2s', boxShadow: '0 2px 10px rgba(27,42,74,.06)' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = T; e.currentTarget.style.boxShadow = `0 4px 20px rgba(33,193,182,.18)`; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = g100; e.currentTarget.style.boxShadow = '0 2px 10px rgba(27,42,74,.06)'; }}
                      >
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,rgba(33,193,182,.15),rgba(33,193,182,.05))`, border: `1px solid rgba(33,193,182,.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⚡</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: N, marginBottom: 3 }}>Automatic</div>
                            <div style={{ fontSize: 11, color: g400, lineHeight: 1.55 }}>AI extracts keywords, searches Indian Kanoon & validates all citations automatically.</div>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => setRunMode('manual')}
                        style={{ flex: 1, padding: '14px 16px', background: W, border: `1.5px solid ${g100}`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans',sans-serif", transition: 'border-color .2s, box-shadow .2s', boxShadow: '0 2px 10px rgba(27,42,74,.06)' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = T; e.currentTarget.style.boxShadow = `0 4px 20px rgba(33,193,182,.18)`; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = g100; e.currentTarget.style.boxShadow = '0 2px 10px rgba(27,42,74,.06)'; }}
                      >
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,rgba(27,42,74,.1),rgba(27,42,74,.04))`, border: `1px solid rgba(27,42,74,.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🔍</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: N, marginBottom: 3 }}>Manual</div>
                            <div style={{ fontSize: 11, color: g400, lineHeight: 1.55 }}>Search using typed legal facts/issues instead of uploaded case context.</div>
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                  {runMode !== null && (
                    <button
                      onClick={() => { setRunMode(null); setManualSearchResults(null); setSuggestedKeywords(null); setSelectedKeywordChips(new Set()); setSelectedCaseChips(new Set()); }}
                      style={{ fontSize: 11, color: T, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8, paddingLeft: 0, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}
                    >← Change mode</button>
                  )}

                  {/* Form fields for both modes */}
                  {runMode !== null && (
                    <div style={{ width: '100%', maxWidth: 580, marginTop: 12 }}>
                      {/* Manual mode specific field */}
                      {runMode === 'manual' && (
                        <>
                          <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                            Case facts / issue text *
                          </div>
                          <textarea
                            className="inp"
                            value={customKeywordsInput}
                            onChange={(e) => setCustomKeywordsInput(e.target.value)}
                            placeholder="Enter the facts or legal issues of your case..."
                            rows={4}
                            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12, resize: 'vertical', padding: '10px 12px', border: `1.5px solid ${g200}`, borderRadius: 10, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: g50, outline: 'none' }}
                            onFocus={e => { e.target.style.borderColor = T; e.target.style.boxShadow = `0 0 0 3px rgba(33,193,182,.1)`; }}
                            onBlur={e => { e.target.style.borderColor = g200; e.target.style.boxShadow = 'none'; }}
                          />
                        </>
                      )}

                      <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                        Who are we representing? *
                      </div>
                      <select
                        className="sel-in"
                        value={representedSide}
                        onChange={(e) => setRepresentedSide(e.target.value)}
                        style={{ height: 42, marginBottom: 12, borderColor: !representedSide ? '#EF4444' : undefined }}
                      >
                        <option value="" disabled>Select represented side</option>
                        <option value="petitioner">Petitioner</option>
                        <option value="respondent">Respondent</option>
                        <option value="appellant">Appellant</option>
                        <option value="accused">Accused / Applicant</option>
                        <option value="complainant">Complainant</option>
                        <option value="plaintiff">Plaintiff</option>
                        <option value="defendant">Defendant</option>
                        <option value="state">State / Prosecution</option>
                        <option value="opposite_party">Opposite Party</option>
                        <option value="neutral">Neutral research only</option>
                      </select>
                      {representedSide === 'neutral' && (
                        <div style={{ fontSize: 11, color: '#D97706', marginBottom: 12, marginTop: -6 }}>
                          ⚠️ Neutral research may return citations for both sides. For drafting, select the represented side.
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                            Matter type (optional)
                          </div>
                          <select
                            className="sel-in"
                            value={caseType}
                            onChange={(e) => setCaseType(e.target.value)}
                            style={{ height: 42, width: '100%' }}
                          >
                            <option value="">Any</option>
                            <option value="writ">Writ / Constitutional</option>
                            <option value="criminal">Criminal</option>
                            <option value="civil">Civil</option>
                            <option value="service">Service</option>
                            <option value="property">Property</option>
                            <option value="family">Family</option>
                            <option value="consumer">Consumer</option>
                            <option value="tax">Tax</option>
                            <option value="arbitration">Arbitration</option>
                            <option value="company">Company</option>
                            <option value="labour">Labour</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                            Preferred court (optional)
                          </div>
                          <input
                            className="inp"
                            value={jurisdiction}
                            onChange={(e) => setJurisdiction(e.target.value)}
                            placeholder="e.g. Supreme Court"
                            style={{ width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px', border: `1.5px solid ${g200}`, borderRadius: 10, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: g50, outline: 'none' }}
                            onFocus={e => { e.target.style.borderColor = T; e.target.style.boxShadow = `0 0 0 3px rgba(33,193,182,.1)`; }}
                            onBlur={e => { e.target.style.borderColor = g200; e.target.style.boxShadow = 'none'; }}
                          />
                        </div>
                      </div>

                      <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                        Citation focus / legal issue (optional)
                      </div>
                      <textarea
                        className="inp"
                        value={legalIssueFocus}
                        onChange={(e) => setLegalIssueFocus(e.target.value)}
                        placeholder="Example: delay and laches in writ petition, natural justice before termination"
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12, resize: 'vertical', padding: '10px 12px', border: `1.5px solid ${g200}`, borderRadius: 10, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: g50, outline: 'none' }}
                        onFocus={e => { e.target.style.borderColor = T; e.target.style.boxShadow = `0 0 0 3px rgba(33,193,182,.1)`; }}
                        onBlur={e => { e.target.style.borderColor = g200; e.target.style.boxShadow = 'none'; }}
                      />

                      <div style={{ fontSize: 10, fontWeight: 700, color: g400, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                        Judgment Source
                      </div>
                      <div style={{ padding: '12px', background: g50, border: `1px solid ${g200}`, borderRadius: 10, marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: N, marginBottom: 4 }}>Indian Kanoon</div>
                        <div style={{ fontSize: 11, color: g500, lineHeight: 1.5 }}>
                          Indian Kanoon retrieves candidate judgments. JuriNex ranks them by relevance, side-support, authority, and risk.
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Estimated cost before scan</div>
                        <div style={{ fontSize: 13, color: '#334155', fontWeight: 600, marginBottom: 4 }}>Estimated Indian Kanoon max: ₹7.80</div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>AI token cost will depend on shortlisted judgments and model usage. Actual cost will be shown after the run.</div>
                      </div>
                      <button
                        onClick={() => handleSend(true)}
                        disabled={sending || (!representedSide) || (runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) || (runMode === 'manual' && !customKeywordsInput.trim()) || (runMode === 'auto' && !selCase)}
                        title={(!representedSide) ? "Please select who we are representing to start the scan" : (runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) ? "Case context is missing. Please add reference documents or use manual mode." : (runMode === 'manual' && !customKeywordsInput.trim()) ? "Please enter facts or legal issues" : (runMode === 'auto' && !selCase) ? "Select a case first." : ""}
                        style={{ width: '100%', padding: '13px 0', background: (sending || (!representedSide) || (runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) || (runMode === 'manual' && !customKeywordsInput.trim()) || (runMode === 'auto' && !selCase)) ? g300 : `linear-gradient(135deg,${T},${TD})`, color: W, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: (sending || (!representedSide) || (runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) || (runMode === 'manual' && !customKeywordsInput.trim()) || (runMode === 'auto' && !selCase)) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: (sending || (!representedSide) || (runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) || (runMode === 'manual' && !customKeywordsInput.trim()) || (runMode === 'auto' && !selCase)) ? 'none' : `0 4px 16px rgba(33,193,182,.35)`, transition: 'all .2s', fontFamily: "'DM Sans',sans-serif" }}
                      >
                        {sending ? <><Spin /> Generating…</> : <>⚡ Start {runMode === 'auto' ? 'Automatic' : 'Manual'} Scan</>}
                      </button>
                      {(!representedSide) && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 8, textAlign: 'center' }}>Select who we are representing.</div>}
                      {(runMode === 'auto' && !selCase) && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 8, textAlign: 'center' }}>Select a case first.</div>}
                      {(runMode === 'auto' && selCase && (caseContextStatus === 'empty' || caseContextStatus === 'failed') && refDocs.length === 0) && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 8, textAlign: 'center' }}>Case context is missing.</div>}
                      {(runMode === 'manual' && !customKeywordsInput.trim()) && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 8, textAlign: 'center' }}>Enter manual facts to continue.</div>}
                      
                      {runMode === 'auto' && (
                        <div style={{ fontSize: 11, color: g400, marginTop: 6, textAlign: 'center' }}>
                          AI generates keywords from your case context and runs the full citation pipeline.
                        </div>
                      )}

                      {/* Manual search results */}
                      {manualSearchResults && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: N }}>
                              {manualSearchResults.type === 'cases'
                                ? `${manualSearchResults.data?.results?.length || 0} judgment(s) found`
                                : `${manualSearchResults.data?.total || manualSearchResults.data?.results?.length || 0} result(s)`}
                            </div>
                            {(() => {
                              const found = (manualSearchResults.data?.results || []).filter(r => r.source !== 'not_found');
                              if (!found.length) return null;
                              const onClick = () => {
                                if (manualSearchResults.type === 'cases') {
                                  const names = found.map(r => r.matched_title || r.case_name).filter(Boolean);
                                  handleSend(true, names, null);
                                } else {
                                  const kws = [...new Set(found.map(r => r.matched_keyword).filter(Boolean))];
                                  handleSend(true, null, kws.length ? kws : null);
                                }
                              };
                              return (
                                <button
                                  onClick={onClick}
                                  disabled={sending}
                                  style={{ padding: '6px 14px', background: sending ? g300 : `linear-gradient(135deg,${T},${TD})`, color: W, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans',sans-serif", boxShadow: sending ? 'none' : `0 2px 8px rgba(33,193,182,.3)` }}
                                >
                                  {sending ? <><Spin /> Generating…</> : <>⚡ Generate Full Report</>}
                                </button>
                              );
                            })()}
                          </div>
                          {(manualSearchResults.data?.results || []).map((r, i) => {
                            const canonicalId = r.canonical_id || (r.ik_tid ? `ik:${r.ik_tid}` : null);
                            const displayName = r.matched_title || r.case_name;
                            return (
                              <div key={i} style={{ padding: '12px 14px', background: W, border: `1px solid ${g200}`, borderRadius: 10, marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: N }}>{displayName}</div>
                                <div style={{ fontSize: 11, color: g400, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  {r.metadata?.court && <span>{r.metadata.court}</span>}
                                  {r.metadata?.date && <span>· {r.metadata.date}</span>}
                                  <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                    background: r.source === 'local_db' ? '#F0FDF4' : (r.source === 'indian_kanoon' || r.source === 'indiankanoon_live') ? '#EFF6FF' : (r.source === 'web' || r.sourceTier === 'web' || r._source === 'web_tier3') ? '#F0F9FF' : '#FFF7ED',
                                    color: r.source === 'local_db' ? '#065F46' : (r.source === 'indian_kanoon' || r.source === 'indiankanoon_live') ? '#1D4ED8' : (r.source === 'web' || r.sourceTier === 'web' || r._source === 'web_tier3') ? '#0C4A6E' : '#92400E' }}>
                                    {r.source === 'local_db' ? 'Local DB' : (r.source === 'indian_kanoon' || r.source === 'indiankanoon_live') ? 'Indian Kanoon' : (r.source === 'web' || r.sourceTier === 'web' || r._source === 'web_tier3') ? '🌍 Web (Verified)' : 'Google'}
                                  </span>
                                </div>
                                {r.snippet && <div style={{ fontSize: 12, color: g600, marginTop: 6, lineHeight: 1.6 }}>{String(r.snippet).slice(0, 300)}…</div>}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                                  {canonicalId && (
                                    <button
                                      onClick={() => handleViewFullJudgment(canonicalId, displayName)}
                                      style={{ fontSize: 11, fontWeight: 700, color: W, background: `linear-gradient(135deg,${T},${TD})`, border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                                    >View Full Judgment</button>
                                  )}
                                  {r.source_url && (
                                    <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T, fontWeight: 600 }}>View on Indian Kanoon →</a>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!sending && msgs.map((m, i) => (
                <div key={i} style={{ marginBottom: 14, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', animation: 'fdUp .25s ease' }}>
                  {m.role === 'user' ? (
                    <div style={{ maxWidth: '80%', padding: '11px 16px', background: `linear-gradient(135deg,${N},${NL})`, color: W, borderRadius: '14px 14px 2px 14px', fontSize: 13, lineHeight: 1.65, boxShadow: '0 2px 10px rgba(27,42,74,.2)' }}>{toPlainText(m.text)}</div>
                  ) : m.role === 'status' ? (
                    <div style={{ background: g50, border: `1px solid ${g200}`, borderRadius: '14px 14px 14px 2px', padding: '11px 16px', fontSize: 12, color: g500, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Spin /> {toPlainText(m.text)}
                    </div>
                  ) : (
                    <div style={{ maxWidth: '84%', padding: '11px 16px', background: m.role === 'error' ? RS : g50, border: `1px solid ${m.role === 'error' ? '#FECACA' : g200}`, borderRadius: '14px 14px 14px 2px', fontSize: 13, color: m.role === 'error' ? R : g700, lineHeight: 1.7 }}>
                      <span dangerouslySetInnerHTML={{ __html: toPlainText(m.text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatRef} />
            </div>

          </div>

          {/* Sidebar — reports + dimensions only (case selector moved to center) */}
          <div className="sc" style={{ overflowY: 'auto', padding: '16px 14px', background: `linear-gradient(180deg,#EEF4FF 0%,${g50} 100%)`, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Selected case indicator — compact */}
            {selCase && (
              <div style={{ background: W, borderRadius: 12, border: `1.5px solid rgba(33,193,182,.3)`, boxShadow: '0 2px 10px rgba(33,193,182,.1)', overflow: 'hidden' }}>
                <div style={{ padding: '7px 12px', background: `linear-gradient(135deg,rgba(33,193,182,.12),rgba(33,193,182,.04))`, borderBottom: `1px solid rgba(33,193,182,.15)`, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: T, boxShadow: `0 0 0 2.5px rgba(33,193,182,.25)`, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: T, textTransform: 'uppercase', letterSpacing: '.1em' }}>Active Case</span>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${N},${TD})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>📂</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selCaseName || selCase}</div>
                  </div>
                  <button
                    onClick={() => { resetForNewCase(); setSelCase(''); setSelCaseName(''); }}
                    style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', border: 'none', background: g100, color: g500, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, transition: 'all .15s' }}
                    title="Clear case"
                    onMouseEnter={e => { e.currentTarget.style.background = '#FEE2E2'; e.currentTarget.style.color = '#DC2626'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = g100; e.currentTarget.style.color = g500; }}
                  >×</button>
                </div>
              </div>
            )}

            {/* Case-specific reports */}
            {selCase && (
              <div style={{ background: W, borderRadius: 14, border: `1px solid ${g100}`, boxShadow: '0 2px 10px rgba(27,42,74,.06)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${g100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: g50 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: `linear-gradient(135deg,${T},${TD})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, boxShadow: `0 2px 6px rgba(33,193,182,.25)` }}>📋</div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: N }}>Reports</span>
                  </div>
                  {caseReportsLoading && <Spin />}
                </div>
                <div style={{ padding: '8px 8px 10px' }}>
                {!caseReportsLoading && caseReports.length === 0 ? (
                  <div style={{ fontSize: 11, color: g400, textAlign: 'center', padding: '18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 24, opacity: .3 }}>📋</div>
                    <span>No reports yet. Generate one above.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {caseReports.map(r => (
                      <div key={r.id}
                        className="case-card"
                        onClick={async () => {
                          const data = await citationApi.getReport(r.id).catch(() => null);
                          if (data) {
                            setReport(data);
                            setQuery(data.query || '');
                            setSelectedPerspective(prev => normalizePerspectiveKey(data?.report_format?.perspective || prev || 'all', 'all'));
                            setSelectedDimension('all');
                            setShowReport(true);
                            navigate(`/citation/reports/${r.id}`, { replace: true });
                          }
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {(() => {
                              const caseName = r.case_id ? (cases.find(x => x.id === r.case_id)?.case_title || cases.find(x => x.id === r.case_id)?.name) : null;
                              const raw = caseName || r.query || 'Citation Report';
                              return raw.length > 36 ? raw.slice(0, 34) + '…' : raw;
                            })()}
                          </div>
                          <button type="button" onClick={(e) => handleDeleteReport(r.id, e)} title="Delete"
                            style={{ flexShrink: 0, padding: '2px 7px', fontSize: 9, fontWeight: 700, color: '#DC2626', background: 'transparent', border: '1px solid #FECACA', borderRadius: 4, cursor: 'pointer' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                          <span style={{ fontSize: 10, color: g400 }}>
                            {r.created_at ? new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : ''}
                          </span>
                          <span style={{ fontSize: 10, color: T, fontWeight: 700 }}>{r.citation_count ?? '?'} citations</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </div>
            )}

            {/* Report dimensions — shown after report is generated */}
            {report && (report?.report_format?.dimensionGroups || []).length > 0 && (
              <div style={{ background: W, borderRadius: 14, padding: '13px 13px 10px', border: `1px solid ${g200}`, boxShadow: '0 2px 8px rgba(27,42,74,.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>⚖️</div>
                  <div className="sidebar-label" style={{ marginBottom: 0 }}>Keywords</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(report.report_format.dimensionGroups).map((dg, idx) => (
                    <button key={String(dg.dimension_id ?? idx)} type="button" onClick={() => { setSelectedDimension((dg.name || '').trim() || String(dg.dimension_id ?? 'all')); setShowReport(true); }}
                      style={{ width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: `1px solid ${g200}`, background: g50, cursor: 'pointer', color: N, fontSize: 11, fontWeight: 600, transition: 'all .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = T; e.currentTarget.style.background = '#F0FEFB'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = g200; e.currentTarget.style.background = g50; }}>
                      <div style={{ fontSize: 9.5, color: T, fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.06em' }}>🔑 KW {idx + 1}</div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dg.name || `Keyword Group ${idx + 1}`}</div>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: g400, textAlign: 'center' }}>
                  {(report.report_format.citations || []).length} citations · {(report.report_format.dimensionGroups || []).length} keyword groups
                </div>
              </div>
            )}

            {/* Empty sidebar state — no case selected yet */}
            {!selCase && !report && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '28px 12px', gap: 8, background: W, borderRadius: 14, border: `1px solid ${g100}` }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: g50, border: `1px solid ${g100}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📋</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: N }}>No case selected</div>
                <div style={{ fontSize: 10.5, color: g400, lineHeight: 1.6, maxWidth: 160 }}>Select a case in the centre panel to see your reports here</div>
              </div>
            )}

            {/* Disclaimer */}
            <div style={{ padding: '10px 12px', background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)', border: '1px solid #FDE68A', borderRadius: 10, marginTop: 'auto' }}>
              <div style={{ fontSize: 10, color: '#78350F', lineHeight: 1.65, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, color: W, fontWeight: 800, marginTop: 0.5 }}>!</div>
                <span><span style={{ fontWeight: 800, color: '#92400E' }}>AI research only.</span> Always verify citations independently before court proceedings.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Citations Map tab */}
      {activeTab === 'map' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20 }}>
          {!report && (
            <div style={{ margin: '0 auto', textAlign: 'center', color: g400 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No report selected</div>
              <div style={{ fontSize: 12 }}>Generate a verified citation report first, then open the Citations Map.</div>
            </div>
          )}
          {report && (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: N, display: 'flex', alignItems: 'center', gap: 6 }}>✦ Citation Relationships</div>
                  <div style={{ fontSize: 11, color: g400 }}>Explore how landmark cases connect — click any node for details</div>
                </div>
                <div style={{ fontSize: 10, color: g400 }}>
                  {report.report_format?.citations?.length ? (
                    <>Showing map for: <span style={{ fontWeight: 600, color: N }}>
                      {report.report_format.citations[0].caseName || report.report_format.citations[0].citation || report.report_format.citations[0].canonicalId}
                    </span></>
                  ) : 'No citations available in this report.'}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, borderRadius: 8, border: `1px solid ${g200}`, background: W, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {citationGraphLoading && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Spin />
                    <span style={{ fontSize: 13, color: g500 }}>Loading citation map…</span>
                  </div>
                )}
                {citationGraphError && !citationGraphLoading && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: R, fontSize: 12 }}>
                    {citationGraphError}
                  </div>
                )}
                {!citationGraphLoading && !citationGraphError && citationGraph && (citationGraph.nodes || []).length === 0 && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: g400, fontSize: 12 }}>
                    No citation relationships found in the graph for this judgment yet.
                  </div>
                )}
                {!citationGraphLoading && !citationGraphError && citationGraph && (citationGraph.nodes || []).length > 0 && (() => {
                  const grEdges = citationGraph.edges || [];
                  const centerId = (citationGraph.nodes.find(n => n.role === 'center') || citationGraph.nodes[0])?.id;
                  const followsCount = grEdges.filter(e => e.type === 'FOLLOWS' && e.to === centerId).length;
                  const distinguishesCount = grEdges.filter(e => e.type === 'DISTINGUISHES' && e.to === centerId).length;
                  const overrulesCount = grEdges.filter(e => e.type === 'OVERRULES' && e.to === centerId).length;
                  return (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
                      {/* Treatment counts + legend */}
                      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                        {[
                          { color: '#16A34A', bg: '#F0FDF4', label: 'Followed In', count: followsCount },
                          { color: '#E65100', bg: '#FFF3E0', label: 'Distinguished In', count: distinguishesCount },
                          { color: '#B71C1C', bg: '#FFF5F5', label: 'Overruled By', count: overrulesCount },
                        ].map(({ color, bg, label, count }) => (
                          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: bg, border: `1px solid ${color}33`, borderRadius: 6, padding: '3px 10px' }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color }}>{count}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color, lineHeight: 1.2 }}>{label}<br />Cases</span>
                          </span>
                        ))}
                        <span style={{ fontSize: 10, color: g400, marginLeft: 4 }}>· Node colors match relationship type</span>
                      </div>
                      {/* Canvas graph */}
                      <div style={{ flex: 1, minHeight: 400, position: 'relative' }}>
                        <CitationGraphSVG nodes={citationGraph.nodes} edges={citationGraph.edges} />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Case Search tab */}
      {activeTab === 'search' && <CaseSearchTab />}

      {/* Analytics tab */}
      {activeTab === 'analytics' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 20 }}>
          {/* ── Header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: N, letterSpacing: -0.3 }}>Enterprise Analytics</div>
              <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Usage insights for your legal team</div>
            </div>
            <button
              onClick={() => { setAnalytics(null); setAnalyticsError(null); }}
              style={{ fontSize: 11, color: T, background: 'none', border: `1px solid ${g200}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}
            >
              ↻ Refresh
            </button>
          </div>

          {analyticsLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Spin />
              <span style={{ fontSize: 13, color: g500 }}>Loading analytics…</span>
            </div>
          )}

          {!analyticsLoading && analyticsError && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: R, fontSize: 13 }}>
              {analyticsError}
            </div>
          )}

          {!analyticsLoading && !analyticsError && analytics && (() => {
            const sum = analytics.summary || {};
            const trend = analytics.volume_trend || [];
            const team = analytics.team_activity || [];
            const timeSavedHrs = Math.round((sum.total_time_saved_minutes || 0) / 60);

            // ── Area chart helpers ──
            const vbW = 560, vbH = 260;
            const ml = 52, mr = 16, mt = 16, mb = 32;
            const iW = vbW - ml - mr;
            const iH = vbH - mt - mb;
            const baseY = mt + iH;

            const maxRaw = Math.max(...trend.map(t => Math.max(t.queries || 0, t.citations || 0)), 1);
            // Round up maxY to nice intervals (e.g. 200, 400, 1200) matching the reference chart
            const step = maxRaw <= 200 ? 50 : maxRaw <= 1200 ? 200 : Math.ceil(maxRaw / 6 / 100) * 100;
            const maxY = Math.ceil(maxRaw / step) * step || step;
            const yTicks = 6;

            const xFor = (idx) => ml + (iW * (trend.length <= 1 ? 0.5 : idx / (trend.length - 1)));
            const yFor = (v) => baseY - (iH * Math.min(v, maxY) / maxY);

            // Smooth bezier path
            const smoothPath = (coords) => {
              if (!coords.length) return '';
              if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;
              let d = `M ${coords[0].x},${coords[0].y}`;
              for (let i = 1; i < coords.length; i++) {
                const cp1x = (coords[i - 1].x + coords[i].x) / 2;
                d += ` C ${cp1x},${coords[i - 1].y} ${cp1x},${coords[i].y} ${coords[i].x},${coords[i].y}`;
              }
              return d;
            };

            const areaPath = (coords, color) => {
              if (!coords.length) return null;
              const line = smoothPath(coords);
              const last = coords[coords.length - 1];
              const first = coords[0];
              const closed = `${line} L ${last.x},${baseY} L ${first.x},${baseY} Z`;
              return closed;
            };

            const qCoords = trend.map((t, i) => ({ x: xFor(i), y: yFor(t.queries || 0), v: t.queries || 0 }));
            const cCoords = trend.map((t, i) => ({ x: xFor(i), y: yFor(t.citations || 0), v: t.citations || 0 }));
            const qLinePath = smoothPath(qCoords);
            const cLinePath = smoothPath(cCoords);
            const qAreaPath = areaPath(qCoords);
            const cAreaPath = areaPath(cCoords);

            const CHART_QUERIES = '#1B2A4A';   // Dark blue for Queries
            const CHART_CITATIONS = '#1B5E20'; // Dark green for Citations

            return (
              <>
                {/* ── Stat Cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 14 }}>
                  {[
                    { label: 'Queries This Month', value: sum.total_queries ?? 0, icon: '🔍', iconBg: '#EBF4FF', color: '#0D47A1' },
                    { label: 'Citations Accessed', value: sum.total_citations ?? 0, icon: '📄', iconBg: '#F0F9F0', color: '#1B5E20' },
                    { label: 'Time Saved', value: `${timeSavedHrs} hrs`, icon: '⏱️', iconBg: '#FFF8E1', color: '#E65100' },
                    { label: 'Team Members', value: team.length || (sum.active_users ?? 0), icon: '👥', iconBg: '#F5F0FF', color: '#6B21A8' },
                  ].map(({ label, value, icon, iconBg, color }) => (
                    <div key={label} style={{ background: W, borderRadius: 14, padding: '16px 20px', border: `1px solid ${g200}`, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                        {icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
                        <div style={{ fontSize: 11, color: g400, marginTop: 3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Chart + Team ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'stretch' }}>

                  {/* Area Chart */}
                  <div style={{ background: W, borderRadius: 14, padding: '20px 20px 12px', border: `1px solid ${g200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: N }}>Research Volume Trend</div>
                        <div style={{ fontSize: 11, color: g400 }}>Queries vs citations (last 6 months)</div>
                      </div>
                      <div style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: g600, fontWeight: 500 }}>
                          <span style={{ width: 24, height: 10, background: CHART_QUERIES, borderRadius: 2, display: 'inline-block' }} />
                          Queries
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: g600, fontWeight: 500 }}>
                          <span style={{ width: 24, height: 10, background: CHART_CITATIONS, borderRadius: 2, display: 'inline-block' }} />
                          Citations
                        </span>
                      </div>
                    </div>

                    {!trend.length ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: g400, fontSize: 12, minHeight: 160 }}>
                        Not enough data yet. Generate a few reports to see trends.
                      </div>
                    ) : (
                      <svg width="100%" viewBox={`0 0 ${vbW} ${vbH}`} style={{ overflow: 'visible', display: 'block' }}>
                        <defs>
                          <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_QUERIES} stopOpacity="0.18" />
                            <stop offset="100%" stopColor={CHART_QUERIES} stopOpacity="0.02" />
                          </linearGradient>
                          <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_CITATIONS} stopOpacity="0.22" />
                            <stop offset="100%" stopColor={CHART_CITATIONS} stopOpacity="0.02" />
                          </linearGradient>
                        </defs>

                        {/* Horizontal grid lines + Y-axis labels */}
                        {Array.from({ length: yTicks + 1 }, (_, i) => {
                          const fraction = i / yTicks;
                          const yVal = Math.round(maxY * fraction);
                          const yPos = baseY - iH * fraction;
                          return (
                            <g key={i}>
                              <line x1={ml} y1={yPos} x2={ml + iW} y2={yPos}
                                stroke={i === 0 ? g300 : g100} strokeWidth={i === 0 ? 1 : 1} />
                              <text x={ml - 8} y={yPos + 4} fontSize={10} fill={g400} textAnchor="end" fontFamily="inherit">
                                {yVal >= 1000 ? `${Math.round(yVal / 100) / 10}k` : yVal}
                              </text>
                            </g>
                          );
                        })}

                        {/* Filled areas */}
                        {qAreaPath && <path d={qAreaPath} fill="url(#gQ)" />}
                        {cAreaPath && <path d={cAreaPath} fill="url(#gC)" />}

                        {/* Smooth lines (drawn above areas for prominence) */}
                        <path d={qLinePath} fill="none" stroke={CHART_QUERIES} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d={cLinePath} fill="none" stroke={CHART_CITATIONS} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                        {/* Data points */}
                        {qCoords.map((p, i) => (
                          <circle key={`q${i}`} cx={p.x} cy={p.y} r={5} fill={CHART_QUERIES} stroke={W} strokeWidth="2.5">
                            <title>{trend[i].label}: {p.v} queries</title>
                          </circle>
                        ))}
                        {cCoords.map((p, i) => (
                          <circle key={`c${i}`} cx={p.x} cy={p.y} r={5} fill={CHART_CITATIONS} stroke={W} strokeWidth="2.5">
                            <title>{trend[i].label}: {p.v} citations</title>
                          </circle>
                        ))}

                        {/* X-axis labels */}
                        {trend.map((t, i) => (
                          <text key={i} x={xFor(i)} y={baseY + 18} fontSize={11} fill={g400} textAnchor="middle" fontFamily="inherit">
                            {t.label}
                          </text>
                        ))}
                      </svg>
                    )}
                  </div>

                  {/* Team Activity */}
                  <div style={{ background: W, borderRadius: 14, padding: '20px', border: `1px solid ${g200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: N, marginBottom: 2 }}>Team Activity</div>
                    <div style={{ fontSize: 11, color: g400, marginBottom: 14 }}>Last 30 days</div>

                    {/* Header row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr', fontSize: 11, fontWeight: 700, color: g500, borderBottom: `1.5px solid ${g200}`, paddingBottom: 8, marginBottom: 2 }}>
                      <span>Member</span>
                      <span style={{ textAlign: 'right' }}>Queries</span>
                      <span style={{ textAlign: 'right' }}>Citations</span>
                      <span style={{ textAlign: 'right' }}>Saved</span>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: 240 }}>
                      {team.map((m, idx) => (
                        <div key={`${m.user_id}-${idx}`} style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr',
                          fontSize: 13,
                          padding: '10px 0',
                          borderBottom: `1px solid ${g100}`,
                          alignItems: 'center',
                        }}>
                          <span style={{ color: N, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.user_id}>
                            {[m.username || m.display_name || m.user_id || 'Unknown', m.auth_type && m.auth_type !== '—' ? `(${m.auth_type})` : null, m.role && m.role !== '—' ? m.role : null].filter(Boolean).join(' · ')}
                          </span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{m.queries}</span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{m.citations}</span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{Math.round((m.time_saved_minutes || 0) / 60)}</span>
                        </div>
                      ))}
                      {!team.length && (
                        <div style={{ padding: '20px 0', fontSize: 12, color: g400, textAlign: 'center' }}>No team activity yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Team Workspace Tab ── */}
      {activeTab === 'team' && (() => {
        const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const myId = String(_u.id || _u.user_id || '');
        const memberMap = Object.fromEntries(teamMembers.map(m => [String(m.user_id), m]));
        const totalCitations = teamReports.reduce((s, r) => s + (r.citation_count || 0), 0);

        const fmtDate = (iso) => {
          if (!iso) return '';
          const d = new Date(iso);
          return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        };

        const getInitials = (nameOrEmail = '') =>
          nameOrEmail.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

        const getAuthorName = (userId) => {
          const m = memberMap[String(userId)];
          if (m) return m.username || m.email || String(userId);
          if (String(userId) === myId) {
            return _u.username || _u.email || 'You';
          }
          return `User ${userId}`;
        };

        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 20, overflowY: 'auto' }}>
            {/* Header */}
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: N, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>👥</span> Team Workspace
              </div>
              <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Collaborate on research, share findings</div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
              {[
                { icon: '📁', value: teamLoading ? '…' : teamReports.length, label: 'SHARED RESEARCH' },
                { icon: '👥', value: teamLoading ? '…' : `${teamMembers.length + 1}/10`, label: 'SEATS USED' },
                { icon: '📚', value: teamLoading ? '…' : totalCitations, label: 'LIBRARY CITATIONS' },
              ].map(({ icon, value, label }) => (
                <div key={label} style={{ background: W, border: `1px solid ${g200}`, borderRadius: 12, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                  <span style={{ fontSize: 28 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: N, lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: g400, marginTop: 4, letterSpacing: .5, textTransform: 'uppercase' }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Body: shared library + members */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>

              {/* Shared Research Library */}
              <div style={{ background: W, border: `1px solid ${g200}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${g100}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📁</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: N }}>Shared Research Library</span>
                  <select
                    value={teamSelCase}
                    onChange={e => setTeamSelCase(e.target.value)}
                    title="Filter by your cases — only reports linked to cases you have access to"
                    style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12, border: `1px solid ${g200}`, borderRadius: 8, background: W, color: N, cursor: 'pointer' }}
                  >
                    <option value="">All shared reports</option>
                    {cases.map(c => (
                      <option key={c.id} value={c.id}>{c.case_title || c.name || c.id}</option>
                    ))}
                  </select>
                </div>
                {teamLoading ? (
                  <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
                ) : teamReports.length === 0 ? (
                  <div style={{ padding: '24px 20px', fontSize: 13, color: g400, textAlign: 'center' }}>
                    No shared research yet. Share a report with your team to see it here.
                  </div>
                ) : (
                  <div>
                    {teamReports.filter(r => r.status !== 'pending_hitl').slice(0, 20).map((r, idx) => {
                      const authorName = getAuthorName(r.user_id);
                      const authorInitials = getInitials(authorName);
                      const isSharedWithMe = String(r.user_id) !== myId;
                      const caseName = r.case_id ? (cases.find(x => x.id === r.case_id)?.case_title || cases.find(x => x.id === r.case_id)?.name || r.case_id) : null;
                      const reportStatus = (r.status || 'completed').toLowerCase();
                      const isComplete = reportStatus === 'completed';
                      return (
                        <div
                          key={r.id}
                          onClick={() => { window.location.href = `/citation/reports/${r.id}`; }}
                          style={{ padding: '14px 20px', borderBottom: idx < teamReports.length - 1 ? `1px solid ${g100}` : 'none', cursor: 'pointer', transition: 'background .12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = g50}
                          onMouseLeave={e => e.currentTarget.style.background = W}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: N, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {caseName || r.query || 'Citation Report'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              {isSharedWithMe && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', padding: '2px 6px', borderRadius: 4, letterSpacing: '.05em' }}>Shared</span>
                              )}
                              <span style={{ fontSize: 9, fontWeight: 700, color: isComplete ? '#166534' : '#92400E', background: isComplete ? '#DCFCE7' : '#FEF3C7', padding: '2px 6px', borderRadius: 4 }}>
                                {isComplete ? 'Complete' : 'Pending'}
                              </span>
                            </div>
                          </div>
                          {caseName && (
                            <div style={{ fontSize: 12, color: T, fontWeight: 600, marginBottom: 4 }}>
                              📁 {caseName}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: g400, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 18, height: 18, borderRadius: '50%', background: N, color: W, fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{authorInitials}</span>
                              {isSharedWithMe ? <>Shared by {authorName}</> : authorName}
                            </span>
                            <span>·</span>
                            <span>{fmtDate(r.created_at)}</span>
                            <span>·</span>
                            <span>{r.citation_count || 0} citations</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Team Members */}
              <div style={{ background: W, border: `1px solid ${g200}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${g100}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: N }}>Team Members</span>
                </div>
                {/* Current user always first; exclude current user from teamMembers to avoid duplicate key */}
                {[
                  { user_id: myId, username: _u.username || _u.email || 'You', email: _u.email || '', role: 'FIRM_ADMIN', isMe: true },
                  ...teamMembers.filter(m => String(m.user_id) !== String(myId)).map(m => ({ ...m, isMe: false })),
                ].map((m, idx, arr) => {
                  const name = m.username || m.email || String(m.user_id);
                  const initials = getInitials(name);
                  const role = (m.role || 'STAFF').toLowerCase().replace('_', ' ');
                  const displayRole = m.isMe ? 'Super Admin' : role === 'firm_admin' ? 'Super Admin' : role.charAt(0).toUpperCase() + role.slice(1);
                  const isOnline = m.isMe; // Only show current user as definitely online
                  return (
                    <div key={m.isMe ? 'me' : (m.user_id || idx)} style={{ padding: '12px 20px', borderBottom: idx < arr.length - 1 ? `1px solid ${g100}` : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: N, color: W, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}{m.isMe ? ' (Admin)' : ''}
                        </div>
                        <div style={{ fontSize: 11, color: g400 }}>{displayRole}</div>
                      </div>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: isOnline ? '#22C55E' : g300, flexShrink: 0 }} title={isOnline ? 'Online' : 'Offline'} />
                    </div>
                  );
                })}
                {!teamLoading && teamMembers.length === 0 && (
                  <div style={{ padding: '16px 20px', fontSize: 12, color: g400 }}>No other members in your firm yet.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Other tabs placeholder */}
      {activeTab !== 'research' && activeTab !== 'map' && activeTab !== 'search' && activeTab !== 'analytics' && activeTab !== 'team' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: g400 }}>
          <div style={{ fontSize: 40 }}>{TABS.find(t => t.id === activeTab)?.label.split(' ')[0]}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: g600 }}>{TABS.find(t => t.id === activeTab)?.label.replace(/^\S+\s/, '')}</div>
          <div style={{ fontSize: 12 }}>Coming soon</div>
        </div>
      )}

      {/* Full judgment modal — also needed in onboarding/manual view */}
      {fullJudgmentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 }} onClick={() => setFullJudgmentModal(null)}>
          <div style={{ background: W, borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxWidth: 720, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${g200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: N, margin: 0 }}>{fullJudgmentModal.caseName || 'Complete judgment'}</h2>
              <button type="button" onClick={() => setFullJudgmentModal(null)} style={{ padding: '6px 12px', border: 'none', background: g200, borderRadius: 6, fontSize: 12, fontWeight: 600, color: g700, cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20 }}>
              {fullJudgmentModal.loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 40, justifyContent: 'center' }}>
                  <Spin /><span style={{ fontSize: 13, color: g500 }}>Loading judgment…</span>
                </div>
              )}
              {fullJudgmentModal.error && (
                <div style={{ padding: 24, textAlign: 'center', color: R, fontSize: 13 }}>Could not load the complete judgment. It may not be available for this citation.</div>
              )}
              {!fullJudgmentModal.loading && !fullJudgmentModal.error && (
                <>
                  {fullJudgmentModal.source === 'indiankanoon_live' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE', fontSize: 12, color: '#1D4ED8', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>Live from Indian Kanoon</span>
                      <span style={{ color: '#93C5FD' }}>·</span>
                      <span style={{ color: '#475569' }}>Not stored — fetched directly from IK API</span>
                      {fullJudgmentModal.ikResourceUrl && (<><span style={{ color: '#93C5FD' }}>·</span><a href={fullJudgmentModal.ikResourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1D4ED8', fontWeight: 600, textDecoration: 'underline' }}>View on Indian Kanoon ↗</a></>)}
                    </div>
                  )}
                  {fullJudgmentModal.isLocalAdmin && fullJudgmentModal.pdfBucketPath && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: '#F0FDF4', borderRadius: 8, border: '1px solid #BBF7D0', fontSize: 12, color: '#166534', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>Admin Upload</span>
                      <span style={{ color: '#86EFAC' }}>·</span>
                      <span style={{ color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all' }}>{fullJudgmentModal.pdfBucketPath}</span>
                      {/^https?:\/\//.test(fullJudgmentModal.pdfBucketPath) && (<><span style={{ color: '#86EFAC' }}>·</span><a href={fullJudgmentModal.pdfBucketPath} target="_blank" rel="noopener noreferrer" style={{ color: '#166534', fontWeight: 600, textDecoration: 'underline' }}>Open PDF ↗</a></>)}
                    </div>
                  )}
                  <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 14, lineHeight: 1.85, color: '#1E293B', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {fullJudgmentModal.fullText || 'No full text available for this judgment.'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
