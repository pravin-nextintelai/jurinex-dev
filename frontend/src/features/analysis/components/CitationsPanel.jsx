// import React, { useState, useEffect } from 'react';
// import { FileText, X, ExternalLink } from 'lucide-react';
// import apiService from '@/shared/api/api';
// import { API_BASE_URL } from '@/config/apiConfig';

// const CitationsPanel = ({ citations = [], fileId, folderName, onClose, onCitationClick }) => {
//   const [expandedCitations, setExpandedCitations] = useState({});
//   const [loadingCitations, setLoadingCitations] = useState({});

//   const formatPageLabel = (citation) => {
//     if (citation.pageStart && citation.pageEnd && citation.pageStart !== citation.pageEnd) {
//       return `Pages ${citation.pageStart}-${citation.pageEnd}`;
//     } else if (citation.page || citation.pageStart) {
//       return `Page ${citation.page || citation.pageStart}`;
//     }
//     return null;
//   };

//   const formatSource = (citation) => {
//     const pageLabel = formatPageLabel(citation);
//     if (pageLabel) {
//       return `${citation.filename} - ${pageLabel}`;
//     }
//     return citation.filename || 'Unknown Document';
//   };

//   const handleCitationClick = (citation) => {
//     if (onCitationClick) {
//       onCitationClick(citation);
//     } else {
//       if (citation.viewUrl) {
//         window.open(citation.viewUrl, '_blank');
//       } else if (citation.fileId) {
//         const page = citation.page || citation.pageStart || 1;
//         const url = `${API_BASE_URL}/api/files/${citation.fileId}/view#page=${page}`;
//         window.open(url, '_blank');
//       }
//     }
//   };

//   const truncateText = (text, maxLength = 150) => {
//     if (!text) return '';
//     if (text.length <= maxLength) return text;
//     return text.substring(0, maxLength).trim() + '...';
//   };

//   return (
//     <div className="h-full flex flex-col bg-white border-l border-gray-200 shadow-xl rounded-l-2xl" style={{ width: '380px', maxWidth: '380px' }}>
//       <div className="px-4 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
//         <h2 className="text-lg font-semibold text-gray-900">Sources</h2>
//         <button
//           type="button"
//           className="text-gray-400 hover:text-gray-500 p-1 rounded-md hover:bg-gray-100 transition-colors"
//           onClick={onClose}
//           aria-label="Close sources panel"
//         >
//           <X className="h-5 w-5" />
//         </button>
//       </div>

//       <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
//               {!citations || citations.length === 0 ? (
//                 <div className="flex items-center justify-center h-full">
//                   <p className="text-gray-500 text-sm">No sources found for this response.</p>
//                 </div>
//               ) : (
//                 citations.map((citation, idx) => {
//                   const pageLabel = formatPageLabel(citation);
//                   const source = formatSource(citation);
//                   const textSnippet = truncateText(citation.text);

//                   return (
//                     <div
//                       key={idx}
//                       className="citation-item bg-white rounded-lg shadow-sm border border-gray-200 p-4"
//                     >
//                       <div className="flex items-center mb-2">
//                         <FileText className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
//                         <div className="flex-1 min-w-0">
//                           <span className="filename text-sm font-medium text-gray-800 truncate block">
//                             {citation.filename || 'Unknown Document'}
//                           </span>
//                           {pageLabel && (
//                             <span className="page-badge text-xs text-gray-500">
//                               • {pageLabel}
//                             </span>
//                           )}
//                         </div>
//                       </div>

//                       {textSnippet && (
//                         <p className="citation-text text-sm text-gray-600 mb-3">
//                           {textSnippet}
//                         </p>
//                       )}

//                       <button
//                         onClick={() => handleCitationClick(citation)}
//                         className="view-link inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
//                       >
//                         <ExternalLink className="h-4 w-4 mr-2" />
//                         View on {pageLabel || 'Document'}
//                       </button>
//                     </div>
//                   );
//                 })
//               )}
//             </div>
//     </div>
//   );
// };

// export default CitationsPanel;

import React, { useMemo, useRef, useState } from 'react';
import { FileText, X, ExternalLink, Scale, ChevronDown, ChevronRight } from 'lucide-react';
import { API_BASE_URL } from '@/config/apiConfig';
import { isDeepResearchSource, normalizeDeepResearchSources } from '@/features/chat/utils/deepResearchSources';

function toPlainText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(toPlainText).filter(Boolean).join('');
  if (typeof v === 'object') {
    if (typeof v.text === 'string' || typeof v.text === 'number') return String(v.text);
    // Common LLM content-part shape: { type: 'text', text: '...' }
    if (v.type && v.text != null) return toPlainText(v.text);
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ── Source & audit config (mirrors CitationReportPage) ─────────────────────
const SOURCE_CFG = {
  local:          { icon: '🏛', label: 'Local DB',          bg: '#EFF4FF', border: '#C7D7FA', color: '#1A3A6B' },
  indian_kanoon:  { icon: '📚', label: 'Indian Kanoon API', bg: '#F0FDF4', border: '#BBF7D0', color: '#15532D' },
  google:         { icon: '🌐', label: 'Google Search',     bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
  web:            { icon: '🌍', label: 'Web (Verified)',    bg: '#F0F9FF', border: '#BFDBFE', color: '#0C4A6E' },
};

const AUDIT_CFG = {
  VERIFIED:               { label: 'Verified',     dot: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', color: '#15532D' },
  VERIFIED_WITH_WARNINGS: { label: 'Verified ⚠',  dot: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', color: '#15532D' },
  NEEDS_REVIEW:           { label: 'Needs Review', dot: '#D97706', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
  QUARANTINED:            { label: 'Quarantined',  dot: '#DC2626', bg: '#FEF2F2', border: '#FECACA', color: '#991B1B' },
  not_audited:            { label: 'Not Audited',  dot: '#9CA3AF', bg: '#F9FAFB', border: '#E5E7EB', color: '#6B7280' },
};

const STATUS_CFG = {
  GREEN:  { label: 'VERIFIED',       dot: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', text: '#15532D' },
  YELLOW: { label: 'REVIEW ADVISED', dot: '#D97706', bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' },
  RED:    { label: 'UNVERIFIED',     dot: '#DC2626', bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' },
};

function SourceBadge({ source }) {
  const cfg = SOURCE_CFG[source] || { icon: '❓', label: source || 'Unknown', bg: '#F9FAFB', border: '#E5E7EB', color: '#6B7280' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      padding: '1px 6px', borderRadius: 2,
      fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: cfg.color,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function AuditBadge({ status }) {
  const cfg = AUDIT_CFG[status] || AUDIT_CFG.not_audited;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      padding: '1px 6px', borderRadius: 2,
      fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: cfg.color,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, display: 'inline-block', flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

// True when the citation came from the citation service (has judgment-level fields)
function isJudgmentCitation(c) {
  return !!(c.caseName || c.primaryCitation || c.source || c.auditStatus || c.verificationStatus);
}

function normalizeSourceKey(citation) {
  const st = String(citation?.source_type || citation?.sourceType || '').trim().toLowerCase();
  if (st === 'admin' || st === 'admin_upload' || st === 'adminupload' || st === 'manual_upload' || st === 'judgment_upload') {
    return 'local';
  }
  if (citation?.isLocalAdmin === true || citation?.is_local_admin === true) {
    return 'local';
  }
  if (
    citation?.sourceTier === 'web' ||
    citation?._source === 'web_tier3' ||
    st === 'web'
  ) {
    return 'web';
  }
  return citation?.source || citation?.sourceType || '';
}

function courtTierRank(citation) {
  const c = String(citation?.court || citation?.court_code || '').toLowerCase();
  if (c.includes('supreme')) return 3;
  if (c.includes('high')) return 2;
  if (c.includes('district') || c.includes('sessions') || c.includes('magistrate') || c.includes('munsiff') || c.includes('civil judge')) return 1;
  return 0;
}

function normalizeDimensionId(raw) {
  if (raw === undefined || raw === null || raw === '') return '__none__';
  return String(raw);
}

function getCitationDimensionMeta(c) {
  const rawId = c.dimension_id ?? c.dimensionId ?? c._dimension_id;
  const id = normalizeDimensionId(rawId);
  const name = c.dimension_name ?? c.dimensionName ?? c._dimension_name ?? null;
  return { id, name: typeof name === 'string' ? name : name != null ? String(name) : null };
}

/**
 * @param {Array} citations
 * @param {Array<{ dimension_id?: any, dimensionId?: any, dimension_name?: string, dimensionName?: string, name?: string }>|null|undefined} dimensions
 *   When set, every dimension is shown even if it has no citations (empty sections).
 */
function buildDimensionSections(citations, dimensions) {
  const list = Array.isArray(citations) ? citations : [];

  if (dimensions && dimensions.length > 0) {
    const byKey = new Map();
    for (const d of dimensions) {
      const raw = d.dimension_id ?? d.dimensionId;
      const key = normalizeDimensionId(raw);
      const label =
        d.dimension_name ||
        d.dimensionName ||
        d.name ||
        (key === '__none__' ? 'General' : `Dimension ${key}`);
      byKey.set(key, { key, name: label, citations: [] });
    }
    const extras = new Map();
    for (const c of list) {
      const { id, name } = getCitationDimensionMeta(c);
      if (byKey.has(id)) {
        byKey.get(id).citations.push(c);
      } else {
        if (!extras.has(id)) {
          extras.set(id, {
            key: id,
            name: name || (id === '__none__' ? 'General' : `Dimension ${id}`),
            citations: [],
          });
        }
        extras.get(id).citations.push(c);
      }
    }
    return [...byKey.values(), ...extras.values()];
  }

  const grouped = list.reduce((acc, c) => {
    const { id, name } = getCitationDimensionMeta(c);
    if (!acc.map.has(id)) {
      const defaultName = id === '__none__' ? 'General' : (name || `Issue ${id}`);
      acc.map.set(id, { key: id, name: defaultName, citations: [] });
      acc.order.push(id);
    }
    const entry = acc.map.get(id);
    if (name) {
      if (id === '__none__') entry.name = name;
      else if (entry.name === `Issue ${id}`) entry.name = name;
    }
    entry.citations.push(c);
    return acc;
  }, { map: new Map(), order: [] });
  return grouped.order.map((id) => grouped.map.get(id));
}

// ── Judgment citation card ─────────────────────────────────────────────────
function JudgmentCitationCard({ citation, index }) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CFG[citation.verificationStatus] || STATUS_CFG.YELLOW;
  const sourceKey = normalizeSourceKey(citation);

  return (
    <div style={{
      background: '#FAFAFA',
      border: '1px solid #E5E7EB',
      borderLeft: `3px solid ${statusCfg.dot}`,
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '10px 12px',
          textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8,
        }}
      >
        <Scale size={14} color="#1A3A6B" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 12, fontWeight: 600, color: '#111',
            lineHeight: 1.4, marginBottom: 4,
          }}>
            {citation.caseName || 'Unknown Case'}
          </div>
          {citation.primaryCitation && citation.primaryCitation !== '—' && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#6B7280', marginBottom: 5 }}>
              {citation.primaryCitation}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Verification status pill */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              background: statusCfg.bg, border: `1px solid ${statusCfg.border}`,
              padding: '1px 6px', borderRadius: 2,
              fontFamily: 'monospace', fontSize: 8, fontWeight: 700, color: statusCfg.text,
              letterSpacing: '0.06em',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusCfg.dot, display: 'inline-block' }} />
              {statusCfg.label}
            </span>
            {citation.confidence != null && (
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF' }}>
                {citation.confidence}%
              </span>
            )}
            <SourceBadge source={sourceKey} />
            {sourceKey === 'web' && citation.authorityTier && (
              <span style={{
                fontFamily: 'monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                padding: '1px 5px', borderRadius: 2,
                background: citation.authorityTier === 'T1' ? '#F0FDF4' : '#F0F9FF',
                border: `1px solid ${citation.authorityTier === 'T1' ? '#BBF7D0' : '#BFDBFE'}`,
                color: citation.authorityTier === 'T1' ? '#065F46' : '#0C4A6E',
              }}>
                {citation.authorityTier}
              </span>
            )}
            <AuditBadge status={citation.auditStatus} />
          </div>
        </div>
        <span style={{ color: '#9CA3AF', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid #EBEBEB', padding: '10px 12px', background: '#FFF' }}>
          {/* Court & date */}
          {(citation.court || citation.dateOfJudgment) && (
            <div style={{ marginBottom: 8 }}>
              {citation.court && citation.court !== '—' && (
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#374151', marginBottom: 2 }}>
                  <span style={{ color: '#9CA3AF' }}>Court: </span>{citation.court}
                </div>
              )}
              {citation.dateOfJudgment && citation.dateOfJudgment !== '—' && (
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#374151' }}>
                  <span style={{ color: '#9CA3AF' }}>Date: </span>{citation.dateOfJudgment}
                </div>
              )}
              {citation.coram && citation.coram !== '—' && (
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#374151' }}>
                  <span style={{ color: '#9CA3AF' }}>Coram: </span>{citation.coram}
                </div>
              )}
            </div>
          )}

          {/* Ratio */}
          {citation.ratio && citation.ratio !== 'Ratio decidendi not extracted.' && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
                Ratio Decidendi
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
                {citation.ratio.length > 300 ? citation.ratio.slice(0, 300) + '…' : citation.ratio}
              </div>
            </div>
          )}

          {/* Librarian status */}
          {citation.librarianStatus && citation.librarianStatus !== 'not_validated' && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                Librarian
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#6B7280' }}>
                {citation.librarianStatus.replace(/_/g, ' ')}
              </div>
            </div>
          )}

          {/* IK: Original Court Copy */}
          {citation.originalCourtCopyUrl && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
                Original Court Copy
              </div>
              <a
                href={citation.originalCourtCopyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', background: '#1E3A8A', color: '#FFF',
                  borderRadius: 4, textDecoration: 'none',
                  fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                }}
              >
                <ExternalLink size={10} />
                {citation.isOriginalCopyPdf ? 'Open PDF (Court Copy)' : 'View Original Document'}
              </a>
            </div>
          )}

          {/* IK: Relevant Fragment */}
          {citation.ikFragment && citation.ikFragment.headline && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
                IK Relevant Fragment
              </div>
              <div style={{
                background: '#F0F9FF', border: '1px solid #BAE6FD', borderLeft: '2px solid #0369A1',
                borderRadius: 3, padding: '6px 8px', fontFamily: 'Georgia, serif',
                fontSize: 10, color: '#0C4A6E', lineHeight: 1.6, fontStyle: 'italic',
              }}>
                {citation.ikFragment.headline.length > 250
                  ? citation.ikFragment.headline.slice(0, 250) + '…'
                  : citation.ikFragment.headline}
              </div>
            </div>
          )}

          {/* IK: Citation counts */}
          {((citation.ikCiteList && citation.ikCiteList.length > 0) || (citation.ikCitedByList && citation.ikCitedByList.length > 0)) && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {citation.ikCiteList && citation.ikCiteList.length > 0 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 3 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: '#0369A1' }}>{citation.ikCiteList.length}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.06em' }}>Cases Cited</span>
                </div>
              )}
              {citation.ikCitedByList && citation.ikCitedByList.length > 0 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 3 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: '#15803D' }}>{citation.ikCitedByList.length}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.06em' }}>Cited By</span>
                </div>
              )}
            </div>
          )}

          {/* Source URL / footer */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6,
            borderTop: '1px dashed #E8E8E8', flexWrap: 'wrap',
          }}>
            <SourceBadge source={sourceKey} />
            <AuditBadge status={citation.auditStatus} />
            {citation.sourceUrl && citation.sourceUrl !== '—' && (
              <a
                href={citation.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontFamily: 'monospace', fontSize: 9, color: '#1A3A6B',
                  textDecoration: 'none',
                }}
              >
                <ExternalLink size={10} />
                View Source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Document citation card (original behaviour) ────────────────────────────
function DocumentCitationCard({ citation, onCitationClick }) {
  const formatPageLabel = (c) => {
    if (c.pageStart && c.pageEnd && c.pageStart !== c.pageEnd) return `Pages ${c.pageStart}-${c.pageEnd}`;
    if (c.page || c.pageStart) return `Page ${c.page || c.pageStart}`;
    return null;
  };

  const pageLabel = formatPageLabel(citation);
  const rawText = toPlainText(citation.text);
  const textSnippet = rawText
    ? (rawText.length > 150 ? rawText.slice(0, 150).trim() + '...' : rawText)
    : '';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center mb-2">
        <FileText className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-800 truncate block">
            {citation.filename || 'Unknown Document'}
          </span>
          {pageLabel && (
            <span className="text-xs text-gray-500">• {pageLabel}</span>
          )}
        </div>
      </div>

      {textSnippet && (
        <p className="text-sm text-gray-600 mb-3">{textSnippet}</p>
      )}

      <button
        onClick={() => onCitationClick(citation)}
        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        View on {pageLabel || 'Document'}
      </button>
    </div>
  );
}

// Citations for one dimension (same judgment / document split as before)
function DimensionCitationsBody({ citations, handleDocCitationClick, reactKeyPrefix = '' }) {
  const judgmentCitations = [...citations.filter(isJudgmentCitation)].sort((a, b) => {
    const tierDiff = courtTierRank(b) - courtTierRank(a);
    if (tierDiff !== 0) return tierDiff;
    const confA = Number(a?.confidence ?? 0);
    const confB = Number(b?.confidence ?? 0);
    return confB - confA;
  });
  const documentCitations = citations.filter((c) => !isJudgmentCitation(c));
  const hasJudgments = judgmentCitations.length > 0;
  const p = reactKeyPrefix ? `${reactKeyPrefix}-` : '';

  return (
    <>
      {hasJudgments && (
        <div>
          {documentCitations.length > 0 && (
            <div style={{
              fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 8, paddingBottom: 4, borderBottom: '1px dashed #E5E7EB',
            }}>
              Legal Citations
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {judgmentCitations.map((c, idx) => (
              <JudgmentCitationCard key={`${p}j-${c.id ?? idx}`} citation={c} index={idx + 1} />
            ))}
          </div>
        </div>
      )}

      {documentCitations.length > 0 && (
        <div>
          {hasJudgments && (
            <div style={{
              fontFamily: 'monospace', fontSize: 8, color: '#9CA3AF',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 8, paddingTop: 4, paddingBottom: 4,
              borderBottom: '1px dashed #E5E7EB',
              borderTop: '1px dashed #E5E7EB',
            }}>
              Case File Documents
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {documentCitations.map((c, idx) => (
              <DocumentCitationCard
                key={`${p}d-${c.fileId ?? c.viewUrl ?? idx}`}
                citation={c}
                onCitationClick={handleDocCitationClick}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────
const CitationsPanel = ({ citations = [], dimensions = null, fileId, folderName, onClose, onCitationClick }) => {
  const deepSources = useMemo(
    () => (Array.isArray(citations) ? citations.filter(isDeepResearchSource) : []),
    [citations],
  );
  const handleDocCitationClick = (citation) => {
    if (onCitationClick) {
      onCitationClick(citation);
    } else {
      if (citation.viewUrl) {
        window.open(citation.viewUrl, '_blank');
      } else if (citation.fileId) {
        const page = citation.page || citation.pageStart || 1;
        window.open(`${API_BASE_URL}/api/files/${citation.fileId}/view#page=${page}`, '_blank');
      }
    }
  };

  const dimensionSections = useMemo(
    () => buildDimensionSections(citations, dimensions),
    [citations, dimensions],
  );

  const [collapsedDims, setCollapsedDims] = useState({});
  const toggleDim = (key) => {
    setCollapsedDims((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const isDimOpen = (key) => !collapsedDims[key];

  const judgmentTotal = useMemo(
    () => (Array.isArray(citations) ? citations.filter(isJudgmentCitation).length : 0),
    [citations],
  );
  const documentTotal = useMemo(
    () => (Array.isArray(citations) ? citations.filter((c) => !isJudgmentCitation(c)).length : 0),
    [citations],
  );
  const hasAnyJudgments = judgmentTotal > 0;

  const showGlobalEmpty =
    (!citations || citations.length === 0) &&
    (!dimensions || dimensions.length === 0);
  const scrollRefs = useRef({});
  const scrollToDimension = (key) => {
    const el = scrollRefs.current[key];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (deepSources.length > 0) {
    return (
      <div className="h-full flex flex-col bg-white border-l border-gray-200 shadow-xl rounded-l-2xl" style={{ width: '380px', maxWidth: '380px' }}>
        <div className="px-4 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Validated Sources</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-500 p-1 rounded-md hover:bg-gray-100 transition-colors"
            onClick={onClose}
            aria-label="Close sources panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* A plain list, not cards — Deep Research sources render as text everywhere. */}
        <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin' }}>
          <ul className="flex flex-col gap-3 text-sm">
            {normalizeDeepResearchSources(deepSources).map((source) => (
              <li key={`${source.source_id}-${source.canonical_url}`} className="leading-snug">
                <span className="font-semibold text-gray-900">[{source.source_id}]</span>{' '}
                <a
                  href={source.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="text-teal-700 underline underline-offset-2 hover:text-teal-900"
                >
                  {source.title}
                </a>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {source.authority_label} · {source.domain}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200 shadow-xl rounded-l-2xl" style={{ width: '380px', maxWidth: '380px' }}>
      {/* Header */}
      <div className="px-4 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Sources</h2>
          {hasAnyJudgments && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {judgmentTotal > 0 && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#6B7280', letterSpacing: '0.08em' }}>
                  {judgmentTotal} judgment{judgmentTotal !== 1 ? 's' : ''}
                </span>
              )}
              {documentTotal > 0 && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#6B7280', letterSpacing: '0.08em' }}>
                  · {documentTotal} document{documentTotal !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="text-gray-400 hover:text-gray-500 p-1 rounded-md hover:bg-gray-100 transition-colors"
          onClick={onClose}
          aria-label="Close sources panel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 p-3" style={{ minHeight: 0 }}>
        {showGlobalEmpty ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">No sources found for this response.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, height: '100%', minHeight: 0 }}>
            <div
              style={{
                width: 110,
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                background: '#F9FAFB',
                padding: 8,
                overflowY: 'auto',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 6, letterSpacing: '.05em' }}>
                KEYWORDS
              </div>
              {dimensionSections.map((section, idx) => (
                <button
                  key={`side-${section.key}`}
                  type="button"
                  onClick={() => scrollToDimension(section.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 7px',
                    borderRadius: 6,
                    border: '1px solid #E5E7EB',
                    background: '#FFF',
                    marginBottom: 6,
                    cursor: 'pointer',
                    fontSize: 10,
                    color: '#374151',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0F766E' }}>🔑 {idx + 1}</div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.name}</div>
                </button>
              ))}
            </div>

            <div className="overflow-y-auto" style={{ scrollbarWidth: 'thin', flex: 1, minHeight: 0, paddingRight: 2 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {dimensionSections.map((section) => {
                  const open = isDimOpen(section.key);
                  const count = section.citations.length;
                  return (
                    <div
                      key={section.key}
                      ref={(el) => { scrollRefs.current[section.key] = el; }}
                      style={{
                        border: '1px solid #E5E7EB',
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: '#FAFAFA',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDim(section.key)}
                        aria-expanded={open}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 12px',
                          background: '#F3F4F6',
                          border: 'none',
                          borderBottom: open ? '1px solid #E5E7EB' : 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ color: '#6B7280', flexShrink: 0, display: 'flex' }}>
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: 'system-ui, sans-serif',
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#111827',
                            lineHeight: 1.35,
                          }}>
                            {section.name}
                          </div>
                          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#9CA3AF', marginTop: 2 }}>
                            {count} citation{count !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </button>
                      {open && (
                        <div style={{ padding: 12, background: '#FFF' }}>
                          {count === 0 ? (
                            <p className="text-gray-500 text-sm" style={{ margin: 0 }}>
                              No citations found for this issue
                            </p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <DimensionCitationsBody
                                citations={section.citations}
                                handleDocCitationClick={handleDocCitationClick}
                                reactKeyPrefix={section.key}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CitationsPanel;