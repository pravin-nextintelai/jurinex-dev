import React, { useState, useEffect, useRef, useCallback, useMemo, memo, useDeferredValue, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import FormattedAssistantContent from '@/features/chat/components/ChatInterface/FormattedAssistantContent';
import {
  uploadBatchFile,
  getFileStatus,
  createBatchJob,
  listBatchJobs,
  getBatchJob,
  getBatchJobResults,
  getBatchJobResult,
  getBatchJobConfig,
  cancelBatchJob,
  listSessions,
  createSession,
  renameSession,
  deleteSession,
  listSessionJobs,
  parseQueriesFromText,
  parseQueriesFromFile,
  STATUS_LABELS,
} from '../api/batchApi';
import BrandingDownloadModal from '@/features/branding/components/BrandingDownloadModal';
import { buildBatchResultsExportHtml, batchExportFilename } from '../utils/batchResultsExport';

// ── Design tokens ──────────────────────────────────────────────────────────────
const TEAL = '#21C1B6';
const TEAL_DARK = '#0d9488';
const TEAL_BG = '#f0fdfa';

const MODELS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Fastest' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Balanced' },
  { value: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   hint: 'Best quality' },
];

const STATUS_META = {
  CREATING:             { color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8', label: 'Creating'   },
  JOB_STATE_PENDING:    { color: '#2563EB', bg: '#EFF6FF', dot: '#3B82F6', label: 'Queued'     },
  JOB_STATE_RUNNING:    { color: '#D97706', bg: '#FFFBEB', dot: '#F59E0B', label: 'Running'    },
  JOB_STATE_SUCCEEDED:  { color: '#059669', bg: '#ECFDF5', dot: '#10B981', label: 'Completed'  },
  JOB_STATE_FAILED:     { color: '#DC2626', bg: '#FEF2F2', dot: '#EF4444', label: 'Failed'     },
  JOB_STATE_CANCELLED:  { color: '#64748B', bg: '#F8FAFC', dot: '#94A3B8', label: 'Cancelled'  },
  JOB_STATE_EXPIRED:    { color: '#EA580C', bg: '#FFF7ED', dot: '#F97316', label: 'Expired'    },
};
const getStatusMeta = (s) => STATUS_META[s] || { color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8', label: s || 'Unknown' };

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Micro components ───────────────────────────────────────────────────────────

const Spinner = ({ size = 14, color = TEAL }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    className="animate-spin shrink-0" style={{ color }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5"
      strokeDasharray="42" strokeDashoffset="14" strokeLinecap="round" />
  </svg>
);

const StatusPill = ({ status }) => {
  const m = getStatusMeta(status);
  const pulse = ['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'CREATING'].includes(status);
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
        style={{ background: m.dot }} />
      {m.label}
    </span>
  );
};

const Label = ({ children }) => (
  <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>{children}</p>
);

const Input = ({ className = '', ...props }) => (
  <input
    className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-xl transition-all outline-none
      border-[#E2E8F0] focus:border-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/10
      placeholder-[#CBD5E1] text-[#1E293B] ${className}`}
    {...props}
  />
);

const Select = ({ children, className = '', ...props }) => (
  <select
    className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-xl transition-all outline-none
      border-[#E2E8F0] focus:border-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/10
      text-[#1E293B] cursor-pointer appearance-none ${className}`}
    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
    {...props}
  >
    {children}
  </select>
);

// ── File upload zone ────────────────────────────────────────────────────────────
function FileUploadZone({ onFile, file, progress, status }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);

  const handle = (f) => {
    if (!f?.name?.toLowerCase().endsWith('.pdf')) { alert('Only PDF files are supported.'); return; }
    onFile(f);
  };

  const fileReady  = status?.status === 'ready';
  const fileProc   = ['processing', 'pending'].includes(status?.status);
  const fileFailed = status?.status === 'failed';

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed p-5 transition-all text-center
        ${drag ? 'border-[#21C1B6] bg-[#f0fdfa]' :
          fileReady ? 'border-emerald-300 bg-emerald-50/50' :
          fileFailed ? 'border-red-200 bg-red-50/40' :
          'border-[#E2E8F0] hover:border-[#21C1B6]/50 hover:bg-[#f8fffe]'}`}
    >
      <input ref={ref} type="file" accept=".pdf,application/pdf" className="hidden"
        onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />

      {file ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-100">
              <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-[#1E293B] truncate max-w-[160px]">{file.name}</p>
              <p className="text-[11px] text-[#94A3B8]">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          </div>
          {typeof progress === 'number' && progress < 100 && (
            <div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-1">
                <div className="h-1 rounded-full transition-all" style={{ width: `${progress}%`, background: TEAL }} />
              </div>
              <p className="text-[11px] text-[#94A3B8] mt-1">Uploading {progress}%…</p>
            </div>
          )}
          {progress === 100 && fileProc && (
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-blue-600">
              <Spinner size={11} color="#2563EB" /> Processing with{status?.is_scanned ? ' Document AI OCR…' : ' Gemini…'}
            </div>
          )}
          {fileReady && (
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-600 font-medium">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Ready · {status?.page_count > 0 ? `${status.page_count} pages` : 'Processed'}
              {status?.is_scanned && ' · OCR applied'}
            </div>
          )}
          {fileFailed && <p className="text-[11px] text-red-500">Processing failed — try again</p>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: TEAL_BG }}>
            <svg className="w-4 h-4" style={{ color: TEAL }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-xs text-[#475569]">Drop PDF or <span style={{ color: TEAL }} className="font-semibold">browse</span></p>
          <p className="text-[11px] text-[#94A3B8]">Scanned docs → Document AI OCR</p>
        </div>
      )}
    </div>
  );
}

// ── Results modal ──────────────────────────────────────────────────────────────
const PAGE_SIZE = 10;
const FETCH_TEXT_LIMIT = 100000;
const SERVER_CHUNK = 100000;
const DISPLAY_CHUNK = 40000;
const INITIAL_QUERY_DISPLAY = 8000;
const INITIAL_RESPONSE_DISPLAY = 40000;
const MARKDOWN_RENDER_CAP = 120000;

function formatCharCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

function looksLikeMarkdown(text) {
  const s = text || '';
  return (
    /^\s*#{1,6}\s/m.test(s) ||
    /^\s*[-*+]\s+/m.test(s) ||
    /^\s*\d+\.\s+/m.test(s) ||
    /\*\*[^*]+\*\*/.test(s) ||
    /__[^_]+__/.test(s) ||
    /^\s*\|.+\|/m.test(s) ||
    /\n\|.+\|\n/.test(s)
  );
}

function stripMarkdownPreview(text) {
  return (text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

/** Extend slice to a line boundary so markdown tables are not cut mid-row. */
function sliceForMarkdownDisplay(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  let end = maxLen;
  const lineEnd = text.indexOf('\n', end);
  if (lineEnd !== -1 && lineEnd - end < 800) end = lineEnd + 1;
  return text.slice(0, end);
}

/** Renders large text with formatted markdown tables and chunked loading. */
const PerformantText = memo(function PerformantText({
  text,
  enableMarkdown = false,
  serverTruncated = false,
  onLoadMore,
  totalLength = 0,
  initialDisplay = INITIAL_QUERY_DISPLAY,
  showAllInitially = false,
  contentMaxHeight = 'min(72vh, 720px)',
}) {
  const [shownLen, setShownLen] = useState(() => (
    showAllInitially && text ? text.length : initialDisplay
  ));
  const [useMd, setUseMd] = useState(() => enableMarkdown);
  const [loadingMore, setLoadingMore] = useState(false);
  const textKey = `${text?.length || 0}-${Boolean(serverTruncated)}`;

  useEffect(() => {
    setShownLen(showAllInitially && text ? text.length : initialDisplay);
    if (enableMarkdown) setUseMd(true);
  }, [textKey, enableMarkdown, initialDisplay, showAllInitially, text]);

  if (!text) {
    return <p className="text-sm text-[#94A3B8] italic">No content</p>;
  }

  const displayCap = useMd ? Math.min(shownLen, MARKDOWN_RENDER_CAP) : shownLen;
  const rawSlice = text.slice(0, Math.min(displayCap, text.length));
  const slice = useMd ? sliceForMarkdownDisplay(rawSlice, rawSlice.length) : rawSlice;
  const canExpandLocally = text.length > displayCap;
  const remainingLoaded = text.length - displayCap;
  const remainingTotal = totalLength > text.length ? totalLength - text.length : 0;

  const handleLoadMore = async () => {
    if (!onLoadMore) return;
    setLoadingMore(true);
    try { await onLoadMore(); } finally { setLoadingMore(false); }
  };

  return (
    <div className="min-w-0 h-full flex flex-col" style={{ contentVisibility: 'auto' }}>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ maxHeight: contentMaxHeight }}>
        {useMd ? (
          <div className="batch-md-content">
            <FormattedAssistantContent raw={slice} />
          </div>
        ) : (
          <p className="text-[15px] text-[#334155] leading-7 whitespace-pre-wrap break-words">
            {slice}{canExpandLocally || serverTruncated ? '…' : ''}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2 shrink-0">
        {enableMarkdown && (
          <button type="button" onClick={() => setUseMd(v => !v)}
            className="text-xs font-semibold text-[#64748B] hover:text-[#334155]">
            {useMd ? 'Plain text' : 'Formatted view'}
          </button>
        )}
        {canExpandLocally && (
          <>
            <button type="button" onClick={() => startTransition(() => setShownLen(l => l + DISPLAY_CHUNK))}
              className="text-xs font-semibold hover:underline" style={{ color: TEAL }}>
              Show more ({formatCharCount(remainingLoaded)} loaded)
            </button>
            <button type="button" onClick={() => startTransition(() => setShownLen(text.length))}
              className="text-xs font-semibold text-[#64748B] hover:text-[#334155]">
              Show all loaded ({formatCharCount(text.length)})
            </button>
          </>
        )}
        {serverTruncated && onLoadMore && (
          <button type="button" onClick={handleLoadMore} disabled={loadingMore}
            className="text-xs font-semibold hover:underline disabled:opacity-50" style={{ color: TEAL_DARK }}>
            {loadingMore ? 'Loading…' : `Load next ${formatCharCount(SERVER_CHUNK)}${remainingTotal ? ` (${formatCharCount(remainingTotal)} remaining)` : ''}`}
          </button>
        )}
        {useMd && displayCap < text.length && (
          <span className="text-[11px] text-[#94A3B8]">
            Formatted view capped at {formatCharCount(MARKDOWN_RENDER_CAP)} — use Show more or Plain text
          </span>
        )}
      </div>
    </div>
  );
});

const LIST_QUERY_PREVIEW_LIMIT = 8000;

const QueryAccordionItem = memo(function QueryAccordionItem({
  r,
  row,
  responseOpen,
  onToggleResponse,
  detailLoading,
  onLoadMoreChunk,
}) {
  const queryLabel = stripMarkdownPreview(row.query_text || r.request_key || '—').trim();

  return (
    <div className="border-b border-[#E2E8F0] last:border-b-0">
      <button
        type="button"
        onClick={onToggleResponse}
        aria-expanded={responseOpen}
        className={`w-full flex items-start justify-between gap-4 px-6 py-5 text-left transition-colors ${responseOpen ? 'bg-[#FAFBFC]' : 'hover:bg-[#FAFBFC]'}`}
      >
        <span className={`flex-1 min-w-0 text-[15px] font-medium text-[#1E293B] leading-relaxed ${responseOpen ? '' : 'line-clamp-2'}`}>
          {queryLabel}
        </span>
        <svg
          className={`w-5 h-5 shrink-0 text-[#64748B] transition-transform duration-200 mt-0.5 ${responseOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {responseOpen && (
        <div className="px-6 pb-6 bg-[#FAFBFC]">
          {row.query_truncated && (
            <div className="mb-4 pb-4 border-b border-[#E2E8F0]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Full query</p>
              <PerformantText
                key={`${r.request_key}-q-${row.query_text?.length || 0}`}
                text={row.query_text}
                serverTruncated={row.query_truncated}
                totalLength={r.query_length}
                showAllInitially
                contentMaxHeight="min(30vh, 280px)"
                onLoadMore={row.query_truncated ? () => onLoadMoreChunk(r.request_key, 'query') : undefined}
              />
            </div>
          )}

          {detailLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-[#94A3B8]">
              <Spinner size={18} />
              Loading response…
            </div>
          ) : (
            <div className="text-[15px] text-[#475569] leading-7">
              <PerformantText
                key={`${r.request_key}-r-${row.response_text?.length || 0}`}
                text={row.response_text}
                enableMarkdown
                serverTruncated={row.response_truncated}
                totalLength={r.response_length}
                showAllInitially
                contentMaxHeight="min(70vh, 640px)"
                onLoadMore={row.response_truncated ? () => onLoadMoreChunk(r.request_key, 'response') : undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function ResultsModal({ jobId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [detailLoadingKey, setDetailLoadingKey] = useState(null);
  const [detailsByKey, setDetailsByKey] = useState({});
  const pollRef = useRef(null);
  const deferredSearch = useDeferredValue(search);

  const fetchPage = useCallback((p) => {
    setLoading(true);
    setError('');
    return getBatchJobResults(jobId, p, PAGE_SIZE, {
      includeText: true,
      textLimit: LIST_QUERY_PREVIEW_LIMIT,
      fields: 'query',
    })
      .then(d => {
        const rows = d?.results || [];
        startTransition(() => {
          setData(d);
          setDetailsByKey({});
          setExpandedKey(null);
          const previews = {};
          rows.forEach(row => { previews[row.request_key] = row; });
          setDetailsByKey(previews);
        });
        if (d?.caching) {
          pollRef.current = setTimeout(() => fetchPage(p), 3000);
        }
        return d;
      })
      .catch(e => { setError(e.message); throw e; })
      .finally(() => setLoading(false));
  }, [jobId]);

  const loadResultDetail = useCallback(async (requestKey, { textLimit = FETCH_TEXT_LIMIT } = {}) => {
    setDetailLoadingKey(requestKey);
    try {
      const d = await getBatchJobResult(jobId, requestKey, { textLimit });
      const row = d?.results?.[0];
      if (row) {
        startTransition(() => {
          setDetailsByKey(prev => ({ ...prev, [requestKey]: { ...prev[requestKey], ...row } }));
          setData(prev => prev ? {
            ...prev,
            results: (prev.results || []).map(r =>
              r.request_key === requestKey ? { ...r, ...row } : r
            ),
          } : prev);
        });
      }
      return row;
    } finally {
      setDetailLoadingKey(null);
    }
  }, [jobId]);

  const loadMoreChunk = useCallback(async (requestKey, field) => {
    const current = detailsByKey[requestKey];
    const isResponse = field === 'response';
    const currentText = isResponse ? (current?.response_text || '') : (current?.query_text || '');
    const d = await getBatchJobResult(jobId, requestKey, {
      textLimit: SERVER_CHUNK,
      queryOffset: isResponse ? 0 : currentText.length,
      responseOffset: isResponse ? currentText.length : 0,
      fields: field,
    });
    const row = d?.results?.[0];
    if (!row) return;
    const merged = {
      ...(current || {}),
      ...(isResponse ? {
        response_text: currentText + (row.response_text || ''),
        response_truncated: row.response_truncated,
        response_length: row.response_length || current?.response_length,
      } : {
        query_text: currentText + (row.query_text || ''),
        query_truncated: row.query_truncated,
        query_length: row.query_length || current?.query_length,
      }),
    };
    startTransition(() => {
      setDetailsByKey(prev => ({ ...prev, [requestKey]: merged }));
      setData(prev => prev ? {
        ...prev,
        results: (prev.results || []).map(r =>
          r.request_key === requestKey ? { ...r, ...merged } : r
        ),
      } : prev);
    });
  }, [jobId, detailsByKey]);

  const handleToggleResponse = useCallback(async (requestKey) => {
    if (expandedKey === requestKey) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(requestKey);
    const cached = detailsByKey[requestKey];
    if (!cached?.response_text && !cached?.response_truncated) {
      await loadResultDetail(requestKey);
    }
  }, [expandedKey, detailsByKey, loadResultDetail]);

  useEffect(() => {
    fetchPage(page);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobId, page, fetchPage]);

  const totalCount = data?.total_count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const searchLower = deferredSearch.trim().toLowerCase();
  const paged = useMemo(() => {
    const rows = data?.results || [];
    if (!searchLower) return rows;
    return rows.filter(r =>
      r.request_key?.toLowerCase().includes(searchLower)
    );
  }, [data?.results, searchLower]);

  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportModalFormat, setExportModalFormat] = useState(null);
  const [exportContentHtml, setExportContentHtml] = useState('');
  const exportMenuRef = useRef(null);

  const fetchFullPageForExport = useCallback(async () => {
    const d = await getBatchJobResults(jobId, page, PAGE_SIZE, { textLimit: 0, includeText: true });
    return d?.results || [];
  }, [jobId, page]);

  const prepareDocumentExport = useCallback(async () => {
    setExporting(true);
    setError('');
    try {
      const rows = await fetchFullPageForExport();
      const html = buildBatchResultsExportHtml({
        title: data?.display_name || 'Batch Results',
        model: data?.model,
        results: rows,
      });
      setExportContentHtml(html);
      return html;
    } catch (e) {
      setError(e.message || 'Failed to prepare export');
      throw e;
    } finally {
      setExporting(false);
    }
  }, [fetchFullPageForExport, data?.display_name, data?.model]);

  const openBrandedExport = async (format) => {
    setExportMenuOpen(false);
    try {
      await prepareDocumentExport();
      setExportModalFormat(format);
    } catch { /* error shown in modal area */ }
  };

  const exportCsv = async () => {
    setExportMenuOpen(false);
    setExporting(true);
    try {
      const rows = await fetchFullPageForExport();
      const csvRows = [['Key', 'Query', 'Response', 'Status'],
        ...rows.map(r => [r.request_key,
          `"${(r.query_text || '').replace(/"/g, '""')}"`,
          `"${(r.response_text || '').replace(/"/g, '""')}"`, r.status])];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csvRows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
      a.download = batchExportFilename(data?.display_name, 'csv');
      a.click();
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDocClick = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [exportMenuOpen]);

  const shellClass = fullscreen
    ? 'w-full h-full max-w-none rounded-none'
    : 'w-[96vw] max-w-[1400px] sm:rounded-2xl h-[92vh] max-h-[92vh]';

  return (
    <div className={`fixed inset-0 z-50 flex justify-center ${fullscreen ? 'p-0' : 'p-2 sm:p-3'}`}
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className={`bg-white shadow-2xl flex flex-col overflow-hidden ${shellClass}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F1F5F9] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: TEAL_BG }}>
              <svg className="w-4 h-4" style={{ color: TEAL }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1E293B]">{data?.display_name || 'Batch Results'}</h2>
              <p className="text-xs text-[#94A3B8]">{data?.request_count?.toLocaleString()} requests</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFullscreen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] transition-colors"
              title={fullscreen ? 'Exit fullscreen' : 'Enlarge to fullscreen'}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {fullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                )}
              </svg>
              {fullscreen ? 'Exit full screen' : 'Enlarge'}
            </button>
            {data?.results?.length > 0 && (
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen(v => !v)}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {exporting ? 'Preparing…' : 'Export'}
                  <svg className="w-3 h-3 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 mt-1 w-44 py-1 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-20">
                    {[
                      { id: 'pdf', label: 'PDF (branding)' },
                      { id: 'word', label: 'Word (branding)' },
                      { id: 'html', label: 'HTML (branding)' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openBrandedExport(item.id)}
                        className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                      >
                        {item.label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-[#F1F5F9]" />
                    <button
                      type="button"
                      onClick={exportCsv}
                      className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#64748B] hover:bg-[#F8FAFC]"
                    >
                      CSV (raw data)
                    </button>
                  </div>
                )}
              </div>
            )}
            <button onClick={onClose}
              className="p-2 rounded-lg hover:bg-[#F1F5F9] transition-colors text-[#94A3B8]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar */}
        {(data?.results?.length || 0) > 0 && (
          <div className="px-6 py-3 border-b border-[#F8FAFC] shrink-0">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Search queries or responses…" value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="w-full pl-8 pr-4 py-2 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/20 focus:border-[#21C1B6] transition-all" />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
          {/* Caching state — shown until background download completes */}
          {!loading && data?.caching && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[#94A3B8]">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: TEAL_BG }}>
                <svg className="w-6 h-6 animate-spin" style={{ color: TEAL }} fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-[#334155]">Preparing your results…</p>
                <p className="text-xs text-[#94A3B8] mt-1">Downloading from Gemini. This takes a few seconds, please wait.</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#94A3B8]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {loading && !data?.caching && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#94A3B8] bg-white/80 z-10">
              <Spinner size={28} />
              <p className="text-sm">{page === 0 ? 'Fetching results…' : `Loading page ${page + 1}…`}</p>
            </div>
          )}
          {error && (
            <div className="m-6 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && !data?.caching && data?.status !== 'JOB_STATE_SUCCEEDED' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <StatusPill status={data?.status} />
              <p className="text-sm text-[#64748B]">Results will be available once the job completes.</p>
            </div>
          )}
          {!loading && !error && data?.status === 'JOB_STATE_SUCCEEDED' && paged.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[#94A3B8]">{search ? 'No results match your search on this page.' : 'No results on this page.'}</p>
            </div>
          )}
          {!error && paged.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto bg-white">
              <div className="max-w-5xl mx-auto w-full px-2 sm:px-4">
              {paged.map((r) => {
                const row = { ...r, ...detailsByKey[r.request_key] };
                return (
                  <QueryAccordionItem
                    key={r.request_key}
                    r={r}
                    row={row}
                    responseOpen={expandedKey === r.request_key}
                    onToggleResponse={() => handleToggleResponse(r.request_key)}
                    detailLoading={detailLoadingKey === r.request_key}
                    onLoadMoreChunk={loadMoreChunk}
                  />
                );
              })}
              </div>
            </div>
          )}
        </div>

        {/* Token usage footer — always visible when job succeeded */}
        {!loading && !error && data?.status === 'JOB_STATE_SUCCEEDED' && (
          <div className="shrink-0 border-t border-[#E2E8F0] bg-[#FAFBFC] px-6 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Model chip */}
              {data.model && data.model !== '—' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F0EDFF] border border-[#DDD6FE]">
                  <svg className="w-3 h-3 text-violet-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-semibold text-violet-700">{data.model}</span>
                </div>
              )}

              {/* Divider */}
              <div className="h-5 w-px bg-[#E2E8F0] hidden sm:block" />

              {/* Input tokens */}
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center bg-blue-50 shrink-0">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] leading-none">Input Tokens</p>
                  <p className="text-sm font-bold text-blue-600 leading-tight mt-0.5">
                    {(data.total_input_tokens || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Output tokens */}
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-50 shrink-0">
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] leading-none">Output Tokens</p>
                  <p className="text-sm font-bold text-emerald-600 leading-tight mt-0.5">
                    {(data.total_output_tokens || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Total tokens */}
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: TEAL_BG }}>
                  <svg className="w-3.5 h-3.5" style={{ color: TEAL }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] leading-none">Total Tokens</p>
                  <p className="text-sm font-bold leading-tight mt-0.5" style={{ color: TEAL_DARK }}>
                    {(data.total_tokens || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Per-query average */}
              {data.request_count > 0 && (data.total_tokens || 0) > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center bg-amber-50 shrink-0">
                    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] leading-none">Avg / Query</p>
                    <p className="text-sm font-bold text-amber-600 leading-tight mt-0.5">
                      {Math.round((data.total_tokens || 0) / data.request_count).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {/* Spacer + pagination */}
              <div className="flex-1" />
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#94A3B8]">{totalCount.toLocaleString()} results · {page + 1}/{totalPages}</span>
                  <div className="flex gap-1">
                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-[#E2E8F0] disabled:opacity-40 hover:bg-[#F1F5F9] transition-colors font-medium text-[#475569]">←</button>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-[#E2E8F0] disabled:opacity-40 hover:bg-[#F1F5F9] transition-colors font-medium text-[#475569]">→</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {exportModalFormat === 'pdf' && (
        <BrandingDownloadModal
          isOpen
          onClose={() => setExportModalFormat(null)}
          contentHtml={exportContentHtml}
          filename={batchExportFilename(data?.display_name, 'pdf')}
          format="pdf"
          module="batch-results"
        />
      )}
      {exportModalFormat === 'word' && (
        <BrandingDownloadModal
          isOpen
          onClose={() => setExportModalFormat(null)}
          contentHtml={exportContentHtml}
          filename={batchExportFilename(data?.display_name, 'docx')}
          format="word"
          module="batch-results"
        />
      )}
      {exportModalFormat === 'html' && (
        <BrandingDownloadModal
          isOpen
          onClose={() => setExportModalFormat(null)}
          contentHtml={exportContentHtml}
          filename={batchExportFilename(data?.display_name, 'html')}
          format="html"
          module="batch-results"
        />
      )}
    </div>
  );
}

// ── Job detail drawer (history + reuse) ───────────────────────────────────────
function JobDetailDrawer({ job, onClose, onReuseJob, onViewResults }) {
  const [config, setConfig]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [queryPage, setQueryPage] = useState(0);
  const Q_PAGE = 20;

  useEffect(() => {
    setLoading(true); setError(''); setConfig(null); setQueryPage(0);
    getBatchJobConfig(job.job_id)
      .then(setConfig)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [job.job_id]);

  const m = getStatusMeta(job.status);
  const succeeded = job.status === 'JOB_STATE_SUCCEEDED';
  const queries = config?.queries || [];
  const qTotalPages = Math.ceil(queries.length / Q_PAGE);
  const pagedQueries = queries.slice(queryPage * Q_PAGE, (queryPage + 1) * Q_PAGE);

  return (
    <div className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="bg-white w-full max-w-xl flex flex-col shadow-2xl"
        style={{ animation: 'slideInRight 0.22s ease-out' }}>

        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-[#F1F5F9]"
          style={{ background: `linear-gradient(135deg, ${TEAL_BG}, #fff)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-[#1E293B] truncate">{job.display_name || 'Untitled Job'}</h2>
                <StatusPill status={job.status} />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-[#94A3B8]">
                <span className="font-mono">{job.job_id?.slice(0, 10)}…</span>
                <span>·</span>
                <span>{timeAgo(job.created_at)}</span>
                {job.model && <><span>·</span><span className="text-violet-600 font-semibold">{job.model}</span></>}
              </div>
            </div>
            <button onClick={onClose}
              className="p-2 rounded-xl hover:bg-[#F1F5F9] text-[#94A3B8] transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Token stats row */}
          {(job.total_tokens > 0) && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50">
                <span className="text-[10px] font-bold uppercase text-blue-400">In</span>
                <span className="text-xs font-bold text-blue-600">{(job.total_input_tokens||0).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50">
                <span className="text-[10px] font-bold uppercase text-emerald-400">Out</span>
                <span className="text-xs font-bold text-emerald-600">{(job.total_output_tokens||0).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: TEAL_BG }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: TEAL }}>Total</span>
                <span className="text-xs font-bold" style={{ color: TEAL_DARK }}>{(job.total_tokens||0).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Spinner size={28} /><p className="text-sm text-[#94A3B8]">Loading job config…</p>
            </div>
          )}
          {error && <div className="m-5 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{error}</div>}

          {!loading && !error && config && (
            <div className="divide-y divide-[#F8FAFC]">

              {/* Linked file */}
              {config.file_info && (
                <div className="px-6 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#94A3B8] mb-2">Document File</p>
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0] bg-[#FAFBFC]">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-red-100 shrink-0">
                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1E293B] truncate">{config.file_info.original_filename}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${config.file_info.status === 'ready' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {config.file_info.status}
                        </span>
                        {config.file_info.page_count > 0 && <span className="text-[11px] text-[#94A3B8]">{config.file_info.page_count} pages</span>}
                        {config.file_info.is_scanned && <span className="text-[11px] text-amber-600 font-medium">OCR applied</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#94A3B8]">
                      {config.file_info.file_size_bytes > 0
                        ? `${(config.file_info.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                        : ''}
                    </span>
                  </div>
                </div>
              )}

              {/* System instruction */}
              {config.system_instruction && (
                <div className="px-6 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#94A3B8] mb-2">System Instruction</p>
                  <div className="p-3 rounded-xl bg-[#FAFBFC] border border-[#E2E8F0] text-sm text-[#475569] leading-relaxed">
                    {config.system_instruction}
                  </div>
                </div>
              )}

              {/* Queries */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#94A3B8]">
                    Queries
                    <span className="ml-2 px-2 py-0.5 rounded-full text-[10px]" style={{ background: TEAL_BG, color: TEAL }}>
                      {queries.length.toLocaleString()}
                    </span>
                  </p>
                  {qTotalPages > 1 && (
                    <div className="flex items-center gap-1 text-xs text-[#94A3B8]">
                      <button disabled={queryPage === 0} onClick={() => setQueryPage(p => p - 1)}
                        className="px-2 py-1 rounded border border-[#E2E8F0] disabled:opacity-40 hover:bg-[#F1F5F9] transition-colors">←</button>
                      <span>{queryPage + 1}/{qTotalPages}</span>
                      <button disabled={queryPage >= qTotalPages - 1} onClick={() => setQueryPage(p => p + 1)}
                        className="px-2 py-1 rounded border border-[#E2E8F0] disabled:opacity-40 hover:bg-[#F1F5F9] transition-colors">→</button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {pagedQueries.map((q, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#FAFBFC] border border-[#F1F5F9] hover:border-[#E2E8F0] transition-colors">
                      <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                        style={{ background: TEAL_BG, color: TEAL }}>
                        {queryPage * Q_PAGE + i + 1}
                      </span>
                      <p className="text-sm text-[#334155] leading-relaxed">{q}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t border-[#E2E8F0] bg-white px-6 py-4 space-y-2.5">
          <button
            onClick={() => { onReuseJob(config); onClose(); }}
            disabled={!config}
            className="w-full py-2.5 text-sm font-bold rounded-xl text-white transition-all
              disabled:opacity-40 flex items-center justify-center gap-2 hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reuse this Job
          </button>
          {succeeded && (
            <button
              onClick={() => { onViewResults(job.job_id); onClose(); }}
              className="w-full py-2.5 text-sm font-semibold rounded-xl border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] transition-colors flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              View Results
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Job card ───────────────────────────────────────────────────────────────────
function JobCard({ job, onRefresh, onViewResults, onCancel, onViewDetail }) {
  const m = getStatusMeta(job.status);
  const active = ['CREATING', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'].includes(job.status);
  const succeeded = job.status === 'JOB_STATE_SUCCEEDED';

  return (
    <div className="group bg-white rounded-xl border border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-sm transition-all overflow-hidden">
      {/* Left accent bar */}
      <div className="flex items-stretch">
        <div className="w-1 shrink-0 rounded-l-xl" style={{ background: m.dot }} />
        <div className="flex-1 px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-[#1E293B] truncate">{job.display_name || 'Untitled Job'}</p>
                <StatusPill status={job.status} />
                {job.model && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#F0EDFF] text-violet-600">
                    {job.model}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs text-[#94A3B8] font-mono">{job.job_id?.slice(0, 8)}…</span>
                <span className="text-xs text-[#94A3B8]">·</span>
                <span className="text-xs text-[#64748B] font-medium">{(job.request_count || 0).toLocaleString()} queries</span>
                {job.original_filename && (
                  <><span className="text-xs text-[#94A3B8]">·</span>
                  <span className="text-xs text-[#64748B] flex items-center gap-1">
                    <svg className="w-3 h-3 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    <span className="truncate max-w-[120px]">{job.original_filename}</span>
                  </span></>
                )}
                <span className="text-xs text-[#94A3B8]">·</span>
                <span className="text-xs text-[#94A3B8]">{timeAgo(job.created_at)}</span>
              </div>
              {job.total_tokens > 0 && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-blue-500 font-semibold">{(job.total_input_tokens||0).toLocaleString()} in</span>
                  <span className="text-[10px] text-[#CBD5E1]">·</span>
                  <span className="text-[10px] text-emerald-500 font-semibold">{(job.total_output_tokens||0).toLocaleString()} out</span>
                  <span className="text-[10px] text-[#CBD5E1]">·</span>
                  <span className="text-[10px] font-semibold" style={{ color: TEAL }}>{(job.total_tokens||0).toLocaleString()} total tokens</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* View detail button — always visible */}
              <button onClick={() => onViewDetail(job)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] hover:border-[#21C1B6] hover:text-[#21C1B6] transition-all">
                View
              </button>
              {succeeded && (
                <button onClick={() => onViewResults(job.job_id)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-all hover:opacity-90"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` }}>
                  Results
                </button>
              )}
              {active && (
                <button onClick={() => onCancel(job.job_id)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                  Cancel
                </button>
              )}
              <button onClick={() => onRefresh(job.job_id)}
                className="p-1.5 rounded-lg hover:bg-[#F1F5F9] transition-colors text-[#94A3B8]"
                title="Refresh status">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Session modals ───────────────────────────────────────────────────────────────
function SessionHistoryModal({ sessions, activeSessionId, onSelect, onDelete, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F5F9]">
          <div>
            <h3 className="text-base font-bold text-[#1E293B]">Session History</h3>
            <p className="text-xs text-[#94A3B8] mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F1F5F9] text-[#94A3B8]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <button type="button" onClick={() => onSelect(null)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-colors ${!activeSessionId
              ? 'bg-[#f0fdfa] border border-[#99f6e4]'
              : 'hover:bg-[#F8FAFC] border border-transparent'}`}>
            <div>
              <p className="text-sm font-semibold text-[#1E293B]">All Jobs</p>
              <p className="text-xs text-[#94A3B8]">Show every batch job</p>
            </div>
            {!activeSessionId && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: TEAL_BG, color: TEAL }}>Active</span>
            )}
          </button>
          {sessions.length === 0 ? (
            <p className="text-sm text-[#94A3B8] text-center py-8">No sessions yet. Create one to group your batch jobs.</p>
          ) : sessions.map(s => (
            <div key={s.session_id}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl transition-colors ${activeSessionId === s.session_id
                ? 'bg-[#f0fdfa] border border-[#99f6e4]'
                : 'hover:bg-[#F8FAFC] border border-transparent'}`}>
              <button type="button" onClick={() => onSelect(s.session_id)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-[#1E293B] truncate">{s.name}</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  {s.job_count} job{s.job_count !== 1 ? 's' : ''}
                  {(s.total_tokens || 0) > 0 && ` · ${(s.total_tokens || 0).toLocaleString()} tokens`}
                </p>
              </button>
              {activeSessionId === s.session_id && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: TEAL_BG, color: TEAL }}>Active</span>
              )}
              <button type="button" onClick={() => onDelete(s.session_id)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-[#CBD5E1] hover:text-red-400 shrink-0"
                title="Delete session">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewSessionModal({ name, onNameChange, onCreate, onClose, creating }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F5F9]">
          <h3 className="text-base font-bold text-[#1E293B]">New Session</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F1F5F9] text-[#94A3B8]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label>Session Name</Label>
            <Input
              value={name}
              onChange={e => onNameChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onCreate()}
              placeholder="e.g. Contract review — March batch"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]">
              Cancel
            </button>
            <button type="button" onClick={onCreate} disabled={!name.trim() || creating}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl text-white disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` }}>
              {creating ? 'Creating…' : 'Create Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat chip ──────────────────────────────────────────────────────────────────
function StatChip({ label, value, color = '#64748B', bg = '#F1F5F9' }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl" style={{ background: bg }}>
      <span className="text-base font-bold" style={{ color }}>{value}</span>
      <span className="text-xs font-medium" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BatchRequestPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);

  const [queryItems, setQueryItems]             = useState(['']);
  const [displayName, setDisplayName]           = useState('');
  const [model, setModel]                       = useState('gemini-2.0-flash');
  const [sysInstr, setSysInstr]                 = useState('');
  const [showSys, setShowSys]                   = useState(false);

  const [uploadedFile, setUploadedFile]         = useState(null);
  const [uploadProgress, setUploadProgress]     = useState(null);
  const [fileId, setFileId]                     = useState(null);
  const [fileStatus, setFileStatus]             = useState(null);
  const filePollerRef                           = useRef(null);

  const [submitting, setSubmitting]             = useState(false);
  const [submitError, setSubmitError]           = useState('');
  const [submitSuccess, setSubmitSuccess]       = useState('');

  const [jobs, setJobs]                         = useState([]);
  const [jobsLoading, setJobsLoading]           = useState(true);
  const [resultsJobId, setResultsJobId]         = useState(null);
  const [detailJob, setDetailJob]               = useState(null);
  const [refreshing, setRefreshing]             = useState(false);

  // Sessions
  const [sessions, setSessions]                 = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null); // null = All Jobs
  const [sessionJobs, setSessionJobs]           = useState([]);     // jobs for selected session
  const [sessionJobsLoading, setSessionJobsLoading] = useState(false);
  const [newSessionName, setNewSessionName]     = useState('');
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [creatingSession, setCreatingSession]   = useState(false);
  const [formSessionId, setFormSessionId]       = useState('');     // session for new job

  const queries = queryItems.map(q => q.trim()).filter(Boolean);

  // Derived stats
  const stats = {
    total:     jobs.length,
    running:   jobs.filter(j => ['CREATING','JOB_STATE_PENDING','JOB_STATE_RUNNING'].includes(j.status)).length,
    completed: jobs.filter(j => j.status === 'JOB_STATE_SUCCEEDED').length,
    failed:    jobs.filter(j => j.status === 'JOB_STATE_FAILED').length,
  };

  const refreshJobs = useCallback(async (silent = false) => {
    if (!silent) setJobsLoading(true);
    setRefreshing(true);
    try { const d = await listBatchJobs(); setJobs(d); } catch {}
    finally { setJobsLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    refreshJobs();
    listSessions().then(setSessions).catch(() => {});
    const iv = setInterval(() => refreshJobs(true), 20000);
    return () => clearInterval(iv);
  }, [refreshJobs]);

  // When user picks a session tab, load that session's jobs
  useEffect(() => {
    if (!selectedSessionId) { setSessionJobs([]); return; }
    setSessionJobsLoading(true);
    listSessionJobs(selectedSessionId)
      .then(setSessionJobs)
      .catch(() => setSessionJobs([]))
      .finally(() => setSessionJobsLoading(false));
  }, [selectedSessionId]);

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return;
    setCreatingSession(true);
    try {
      const s = await createSession(newSessionName.trim());
      setSessions(p => [s, ...p]);
      setFormSessionId(s.session_id);
      setSelectedSessionId(s.session_id);
      setNewSessionName('');
      setShowNewSessionModal(false);
    } catch (e) { alert(`Failed to create session: ${e.message}`); }
    finally { setCreatingSession(false); }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!confirm('Delete this session? Jobs in it will remain but become unsessioned.')) return;
    try {
      await deleteSession(sessionId);
      setSessions(p => p.filter(s => s.session_id !== sessionId));
      if (selectedSessionId === sessionId) setSelectedSessionId(null);
      if (formSessionId === sessionId) setFormSessionId('');
    } catch (e) { alert(`Failed to delete session: ${e.message}`); }
  };

  const refreshSingle = async (jobId) => {
    try { const j = await getBatchJob(jobId); setJobs(p => p.map(x => x.job_id === jobId ? { ...x, ...j } : x)); } catch {}
  };

  const handleFileSelected = async (file) => {
    setUploadedFile(file);
    setUploadProgress(0);
    setFileId(null);
    setFileStatus(null);
    if (filePollerRef.current) clearInterval(filePollerRef.current);
    try {
      const { file_id } = await uploadBatchFile(file, setUploadProgress);
      setFileId(file_id);
      setUploadProgress(100);
      filePollerRef.current = setInterval(async () => {
        try {
          const s = await getFileStatus(file_id);
          setFileStatus(s);
          if (s.status === 'ready' || s.status === 'failed') clearInterval(filePollerRef.current);
        } catch {}
      }, 3000);
    } catch (e) {
      setSubmitError(`Upload failed: ${e.message}`);
      setUploadProgress(null);
    }
  };
  useEffect(() => () => { if (filePollerRef.current) clearInterval(filePollerRef.current); }, []);

  const handleQueriesFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const p = await parseQueriesFromFile(f); setQueryItems(p.length ? p : ['']); }
    catch (e) { alert(`Could not read file: ${e.message}`); }
  };

  const handleSubmit = async () => {
    setSubmitError(''); setSubmitSuccess('');
    if (!displayName.trim()) { setSubmitError('Please enter a job name.'); return; }
    if (!queries.length)     { setSubmitError('Please enter at least one query.'); return; }
    if (queries.length > 200000) { setSubmitError('Maximum 200,000 queries per batch.'); return; }
    if (activeTab === 1 && fileId && fileStatus?.status !== 'ready') {
      setSubmitError('Document is still processing — please wait.'); return;
    }
    setSubmitting(true);
    try {
      const payload = { display_name: displayName.trim(), queries, model };
      if (activeTab === 1 && fileId && fileStatus?.status === 'ready') payload.file_id = fileId;
      if (sysInstr.trim()) payload.system_instruction = sysInstr.trim();
      if (formSessionId) payload.session_id = formSessionId;
      const job = await createBatchJob(payload);
      setSubmitSuccess(`Job "${displayName}" submitted successfully!`);
      setDisplayName(''); setQueryItems(['']);
      setTimeout(() => setSubmitSuccess(''), 5000);
      await refreshJobs();
      listSessions().then(setSessions).catch(() => {});
      if (selectedSessionId) listSessionJobs(selectedSessionId).then(setSessionJobs).catch(() => {});
    } catch (e) {
      setSubmitError(`Failed to submit: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (jobId) => {
    if (!confirm('Cancel this batch job?')) return;
    try { await cancelBatchJob(jobId); await refreshSingle(jobId); }
    catch (e) { alert(`Cancel failed: ${e.message}`); }
  };

  const handleReuseJob = (config) => {
    if (!config) return;
    setDisplayName(`${config.display_name || 'Job'} (copy)`);
    setModel(config.model || 'gemini-2.0-flash');
    setQueryItems(config.queries?.length ? config.queries : ['']);
    if (config.system_instruction) { setSysInstr(config.system_instruction); setShowSys(true); }
    else { setSysInstr(''); }
    if (config.file_info && config.file_info.status === 'ready') {
      setFileId(config.batch_file_id);
      setFileStatus(config.file_info);
      setUploadedFile({ name: config.file_info.original_filename, size: config.file_info.file_size_bytes || 0 });
      setUploadProgress(100);
      setActiveTab(1);
    } else {
      setActiveTab(0);
    }
    // Scroll form panel into view
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSubmitError('');
    setSubmitSuccess('');
  };

  const canSubmit = !submitting && queries.length > 0 && displayName.trim();
  const activeSession = sessions.find(s => s.session_id === (selectedSessionId || formSessionId));

  const handleSelectSession = (sessionId) => {
    setSelectedSessionId(sessionId);
    setFormSessionId(sessionId || '');
    setShowSessionHistory(false);
  };

  return (
    <div className="flex flex-col bg-[#F8FAFC]" style={{ height: '100%', minHeight: '100vh' }}>
      {showSessionHistory && (
        <SessionHistoryModal
          sessions={sessions}
          activeSessionId={selectedSessionId || formSessionId || null}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onClose={() => setShowSessionHistory(false)}
        />
      )}
      {showNewSessionModal && (
        <NewSessionModal
          name={newSessionName}
          onNameChange={setNewSessionName}
          onCreate={handleCreateSession}
          onClose={() => { setShowNewSessionModal(false); setNewSessionName(''); }}
          creating={creatingSession}
        />
      )}
      {resultsJobId && <ResultsModal jobId={resultsJobId} onClose={() => setResultsJobId(null)} />}
      {detailJob && (
        <JobDetailDrawer
          job={detailJob}
          onClose={() => setDetailJob(null)}
          onReuseJob={handleReuseJob}
          onViewResults={(id) => { setDetailJob(null); setResultsJobId(id); }}
        />
      )}

      {/* ── Top bar ── */}
      <div className="bg-white border-b border-[#E2E8F0] shrink-0">
        <div className="flex items-center gap-3 px-5 py-3.5">
          <button onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-[#F1F5F9] transition-colors text-[#64748B]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: TEAL_BG }}>
                <svg className="w-4 h-4" style={{ color: TEAL }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h1 className="text-base font-bold text-[#1E293B] leading-tight">Batch AI Requests</h1>
                <p className="text-xs text-[#94A3B8] leading-tight">Up to 200,000 queries per batch · 50% cheaper than real-time</p>
              </div>
            </div>
          </div>

          {/* Stats chips */}
          <div className="hidden md:flex items-center gap-2">
            <StatChip label="Total" value={stats.total} color="#475569" bg="#F1F5F9" />
            {stats.running > 0 && <StatChip label="Running" value={stats.running} color="#D97706" bg="#FFFBEB" />}
            {stats.completed > 0 && <StatChip label="Done" value={stats.completed} color="#059669" bg="#ECFDF5" />}
            {stats.failed > 0 && <StatChip label="Failed" value={stats.failed} color="#DC2626" bg="#FEF2F2" />}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
            style={{ background: TEAL_BG, color: TEAL_DARK }}>
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Gemini Batch API
          </div>
        </div>
      </div>

      {/* ── Body: two-column split ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT PANEL: Form ── */}
        <div className="w-full lg:w-[400px] xl:w-[440px] shrink-0 bg-white border-r border-[#E2E8F0] flex flex-col overflow-hidden">

          {/* Tab switcher */}
          <div className="px-5 pt-4 pb-3 shrink-0 border-b border-[#F1F5F9]">
            <div className="flex rounded-xl p-1 bg-[#F1F5F9]">
              {['Text Queries', 'Document + Queries'].map((t, i) => (
                <button key={i} onClick={() => setActiveTab(i)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === i
                    ? 'bg-white text-[#1E293B] shadow-sm'
                    : 'text-[#94A3B8] hover:text-[#64748B]'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable form body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* Job name */}
            <div>
              <Label>Job Name</Label>
              <Input placeholder="e.g. Legal clause analysis — batch 1"
                value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>

            {/* Model */}
            <div>
              <Label>Model</Label>
              <div className="grid grid-cols-1 gap-2">
                {MODELS.map(m => (
                  <label key={m.value}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all ${model === m.value
                      ? 'border-[#21C1B6] bg-[#f0fdfa]'
                      : 'border-[#E2E8F0] hover:border-[#CBD5E1]'}`}>
                    <input type="radio" name="model" value={m.value}
                      checked={model === m.value} onChange={() => setModel(m.value)} className="sr-only" />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${model === m.value ? 'border-[#21C1B6]' : 'border-[#CBD5E1]'}`}>
                      {model === m.value && <div className="w-2 h-2 rounded-full" style={{ background: TEAL }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${model === m.value ? 'text-[#0d9488]' : 'text-[#334155]'}`}>{m.label}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${model === m.value ? 'bg-[#ccfbf1] text-[#0d9488]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>{m.hint}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* PDF upload (tab 1) */}
            {activeTab === 1 && (
              <div>
                <Label>PDF Document</Label>
                <FileUploadZone onFile={handleFileSelected}
                  file={uploadedFile} progress={uploadProgress} status={fileStatus} />
                {fileStatus?.is_scanned && fileStatus?.status === 'ready' && (
                  <div className="flex items-center gap-1.5 mt-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                    <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <p className="text-[11px] text-amber-700 font-medium">Scanned PDF — Document AI OCR applied</p>
                  </div>
                )}
              </div>
            )}

            {/* Queries */}
            <div>
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#94A3B8]">Queries</p>
                  {queries.length > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: TEAL_BG, color: TEAL }}>
                      {queries.length.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {queryItems.length > 1 && (
                    <button onClick={() => setQueryItems([''])}
                      className="text-[11px] font-semibold text-[#94A3B8] hover:text-red-400 transition-colors">
                      Clear all
                    </button>
                  )}
                  <label className="flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                    style={{ color: TEAL }}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import TXT/CSV
                    <input type="file" accept=".txt,.csv" className="hidden" onChange={handleQueriesFile} />
                  </label>
                </div>
              </div>

              {/* Individual query rows (up to 20; above that show bulk summary) */}
              {queryItems.length <= 20 ? (
                <div className="space-y-2">
                  {queryItems.map((q, i) => (
                    <div key={i} className="flex items-start gap-2 group/row">
                      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold mt-2.5 shrink-0 select-none"
                        style={{ background: TEAL_BG, color: TEAL }}>
                        {i + 1}
                      </span>
                      <textarea
                        value={q}
                        rows={2}
                        onChange={e => {
                          const next = [...queryItems];
                          next[i] = e.target.value;
                          setQueryItems(next);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            setQueryItems(p => [...p.slice(0, i + 1), '', ...p.slice(i + 1)]);
                            setTimeout(() => {
                              const rows = document.querySelectorAll('[data-query-row]');
                              rows[i + 1]?.focus();
                            }, 30);
                          }
                          if (e.key === 'Backspace' && !q && queryItems.length > 1) {
                            e.preventDefault();
                            setQueryItems(p => p.filter((_, idx) => idx !== i));
                          }
                        }}
                        data-query-row
                        placeholder={i === 0 ? 'e.g. What is the limitation period?' : 'Enter your query…'}
                        className="flex-1 px-3 py-2 text-sm bg-[#FAFBFC] border border-[#E2E8F0] rounded-xl
                          focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/10 focus:border-[#21C1B6] focus:bg-white
                          transition-all resize-none text-[#1E293B] placeholder-[#CBD5E1] leading-relaxed"
                      />
                      <button
                        onClick={() => setQueryItems(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : [''])}
                        className="p-1.5 mt-2 rounded-lg transition-colors shrink-0 text-[#CBD5E1] hover:text-red-400 hover:bg-red-50
                          opacity-0 group-hover/row:opacity-100 focus:opacity-100">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {/* Add Query button */}
                  <button
                    onClick={() => setQueryItems(p => [...p, ''])}
                    className="mt-1 w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold
                      rounded-xl border-2 border-dashed border-[#E2E8F0] hover:border-[#21C1B6]/60
                      text-[#94A3B8] hover:text-[#21C1B6] hover:bg-[#f8fffe] transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Query
                  </button>
                </div>
              ) : (
                /* Bulk summary card for large imports */
                <div className="rounded-xl border border-[#E2E8F0] overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: TEAL_BG }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: TEAL }}>
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: TEAL_DARK }}>
                        {queryItems.length.toLocaleString()} queries loaded
                      </p>
                      <p className="text-[11px]" style={{ color: TEAL_DARK }}>Imported from file</p>
                    </div>
                    <button onClick={() => setQueryItems([''])}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 text-red-500 border border-red-100 transition-colors">
                      Clear
                    </button>
                  </div>
                  <div className="divide-y divide-[#F1F5F9] max-h-40 overflow-y-auto">
                    {queryItems.slice(0, 5).map((q, i) => (
                      <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                        <span className="text-[10px] font-bold shrink-0 mt-0.5" style={{ color: TEAL }}>{i + 1}</span>
                        <p className="text-xs text-[#475569] truncate">{q}</p>
                      </div>
                    ))}
                    {queryItems.length > 5 && (
                      <div className="px-4 py-2.5 text-[11px] text-[#94A3B8] text-center">
                        + {(queryItems.length - 5).toLocaleString()} more queries
                      </div>
                    )}
                  </div>
                </div>
              )}

              {queries.length > 100000 && (
                <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Large batch · processing may take up to 24 hours
                </p>
              )}
            </div>

            {/* System instruction */}
            <div>
              <button type="button" onClick={() => setShowSys(v => !v)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[#94A3B8] hover:text-[#64748B] transition-colors">
                <svg className={`w-3 h-3 transition-transform duration-200 ${showSys ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                SYSTEM INSTRUCTION <span className="font-normal normal-case">(optional)</span>
              </button>
              {showSys && (
                <textarea
                  value={sysInstr} onChange={e => setSysInstr(e.target.value)} rows={3}
                  placeholder="e.g. You are a legal expert specialising in Indian law. Be concise."
                  className="mt-2 w-full px-3.5 py-3 text-sm bg-white border border-[#E2E8F0] rounded-xl
                    focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/10 focus:border-[#21C1B6]
                    transition-all resize-none text-[#1E293B] placeholder-[#CBD5E1]"
                />
              )}
            </div>
          </div>

          {/* ── Pinned submit footer ── */}
          <div className="shrink-0 px-5 py-4 border-t border-[#F1F5F9] bg-white space-y-3">
            {submitError && (
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                <svg className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-red-600 leading-relaxed">{submitError}</p>
              </div>
            )}
            {submitSuccess && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-emerald-700 font-medium">{submitSuccess}</p>
              </div>
            )}
            {activeSession && (
              <p className="text-[11px] text-[#64748B] text-center">
                New jobs will be added to session <span className="font-semibold" style={{ color: TEAL_DARK }}>{activeSession.name}</span>
              </p>
            )}
            <button onClick={handleSubmit} disabled={!canSubmit}
              className="w-full py-3 text-sm font-bold rounded-xl text-white transition-all
                disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2
                hover:shadow-lg hover:-translate-y-px active:translate-y-0"
              style={{ background: canSubmit ? `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` : '#CBD5E1' }}>
              {submitting ? (
                <><Spinner size={15} color="white" /> Submitting…</>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {queries.length > 0 ? `Submit ${queries.length.toLocaleString()} Quer${queries.length === 1 ? 'y' : 'ies'}` : 'Submit Batch Job'}
                </>
              )}
            </button>
            <p className="text-center text-[11px] text-[#94A3B8]">
              Processed within 24 h · 50% cheaper than real-time
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL: Jobs list ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Jobs header */}
          <div className="shrink-0 bg-white border-b border-[#E2E8F0]">
            <div className="flex items-center justify-between px-6 pt-4 pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#1E293B]">Batch Jobs</h2>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  {selectedSessionId
                    ? `${sessionJobs.length} job${sessionJobs.length !== 1 ? 's' : ''} in session`
                    : `${jobs.length} job${jobs.length !== 1 ? 's' : ''} total`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowSessionHistory(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] hover:border-[#21C1B6] transition-all">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </button>
                <button type="button" onClick={() => setShowNewSessionModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-white transition-all hover:opacity-90"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  New Session
                </button>
                <button onClick={() => { refreshJobs(); listSessions().then(setSessions).catch(() => {}); if (selectedSessionId) listSessionJobs(selectedSessionId).then(setSessionJobs).catch(() => {}); }}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC] transition-all disabled:opacity-60">
                  <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>

            {activeSession && (
              <div className="flex items-center gap-2 px-6 pb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: TEAL_BG, color: TEAL_DARK }}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  {activeSession.name}
                </span>
                <button type="button" onClick={() => handleSelectSession(null)}
                  className="text-[11px] font-semibold text-[#94A3B8] hover:text-[#64748B]">
                  Clear filter
                </button>
              </div>
            )}
          </div>

          {/* Scrollable jobs */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {(selectedSessionId ? sessionJobsLoading : jobsLoading) ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Spinner size={28} />
                <p className="text-sm text-[#94A3B8]">Loading jobs…</p>
              </div>
            ) : (selectedSessionId ? sessionJobs : jobs).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: TEAL_BG }}>
                  <svg className="w-7 h-7" style={{ color: TEAL }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#334155]">
                    {selectedSessionId ? 'No jobs in this session' : 'No batch jobs yet'}
                  </p>
                  <p className="text-xs text-[#94A3B8] mt-1">
                    {selectedSessionId
                      ? 'Submit a batch job — it will be added to this session.'
                      : 'Submit your first batch job using the form on the left.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {(selectedSessionId ? sessionJobs : jobs).map(job => (
                  <JobCard key={job.job_id} job={job}
                    onRefresh={refreshSingle}
                    onViewResults={setResultsJobId}
                    onCancel={handleCancel}
                    onViewDetail={setDetailJob} />
                ))}
              </div>
            )}
          </div>

          {/* How it works — pinned footer */}
          <div className="shrink-0 border-t border-[#E2E8F0] bg-white px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8] mb-3">How It Works</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { n: '1', title: 'Submit', desc: 'Send up to 200k queries with an optional PDF for document context.', color: '#3B82F6' },
                { n: '2', title: 'Process', desc: 'Gemini runs your batch asynchronously within 24 hours at 50% cost.', color: TEAL },
                { n: '3', title: 'Results', desc: 'View and export structured query→response pairs as CSV.', color: '#8B5CF6' },
              ].map(s => (
                <div key={s.n} className="flex gap-2.5">
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                    style={{ background: s.color }}>{s.n}</div>
                  <div>
                    <p className="text-xs font-semibold text-[#334155]">{s.title}</p>
                    <p className="text-[11px] text-[#94A3B8] leading-relaxed mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
