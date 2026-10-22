import React, { useState, useMemo, useCallback, useId } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Download,
  Copy,
  Check,
} from 'lucide-react';
import '../styles/InteractiveTable.css';

/**
 * InteractiveTable
 * ----------------
 * Renders an AI/markdown table as an interactive, DeepSeek-style data grid:
 * column sort (asc / desc / none), global search, pagination, CSV export and
 * copy-to-clipboard. Adaptive — small tables render clean (no toolbar / paging),
 * larger tables progressively enable controls.
 *
 * Cells may contain the SAFE inline HTML that the markdown pipeline already
 * sanitised upstream (<strong>, <em>, <br>, <code>, <sup>, …). Display uses that
 * HTML; sort / filter / search / export operate on a stripped plain-text view so
 * formatting never corrupts comparisons or exported data.
 *
 * Props:
 *   headers   string[]            — column header labels (plain text)
 *   rows      string[][]          — row cells; each cell may contain safe inline HTML
 *   caption   string  (optional)  — caption rendered under the table
 *   pageSize  number  (optional)  — rows per page once pagination kicks in (default 10)
 */
const SORT_NONE = 'none';
const SORT_ASC = 'asc';
const SORT_DESC = 'desc';

// Show the search / export toolbar only once a table is big enough to need it.
const TOOLBAR_MIN_ROWS = 5;

function stripTags(html) {
  if (html == null) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a numeric/currency value out of a cell for number-aware sorting.
// Returns NaN when the cell is not predominantly numeric (e.g. "Rs. 38,22,500/-"
// → 3822500). Falls back to string compare when a column isn't numeric.
function toNumber(text) {
  if (!text) return NaN;
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
  // Reject values where digits are a small fraction of the text (mostly words).
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount / text.length < 0.3) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function csvEscape(value) {
  const v = value == null ? '' : String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const InteractiveTable = ({ headers, rows, caption = '', pageSize = 10 }) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: SORT_NONE });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);
  const tableId = useId();

  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  // Pre-compute the stripped plain-text grid once for search / sort / export.
  const textRows = useMemo(
    () => safeRows.map((row) => row.map((cell) => stripTags(cell))),
    [safeRows],
  );

  // Keep display rows and text rows paired through filtering / sorting.
  const indexedRows = useMemo(
    () => safeRows.map((row, i) => ({ row, text: textRows[i] })),
    [safeRows, textRows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return indexedRows;
    return indexedRows.filter(({ text }) =>
      text.some((cell) => cell.toLowerCase().includes(q)),
    );
  }, [indexedRows, search]);

  const sorted = useMemo(() => {
    const { key, direction } = sortConfig;
    if (key == null || direction === SORT_NONE) return filtered;
    const dir = direction === SORT_ASC ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a.text[key] ?? '';
      const bv = b.text[key] ?? '';
      const an = toNumber(av);
      const bn = toNumber(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return (an - bn) * dir;
      }
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [filtered, sortConfig]);

  const enablePaging = sorted.length > pageSize;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const visibleRows = useMemo(() => {
    if (!enablePaging) return sorted;
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, enablePaging, currentPage, pageSize]);

  const handleSort = useCallback((colIndex) => {
    setSortConfig((curr) => {
      if (curr.key !== colIndex) return { key: colIndex, direction: SORT_ASC };
      if (curr.direction === SORT_ASC) return { key: colIndex, direction: SORT_DESC };
      if (curr.direction === SORT_DESC) return { key: null, direction: SORT_NONE };
      return { key: colIndex, direction: SORT_ASC };
    });
    setPage(1);
  }, []);

  const handleSearch = useCallback((e) => {
    setSearch(e.target.value);
    setPage(1);
  }, []);

  const exportCSV = useCallback(() => {
    const lines = [
      safeHeaders.map(csvEscape).join(','),
      ...sorted.map(({ text }) => text.map(csvEscape).join(',')),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [safeHeaders, sorted]);

  const copyTSV = useCallback(async () => {
    const tsv = [
      safeHeaders.join('\t'),
      ...sorted.map(({ text }) => text.join('\t')),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context) — silently ignore.
    }
  }, [safeHeaders, sorted]);

  if (safeHeaders.length === 0 && safeRows.length === 0) return null;

  const showToolbar = safeRows.length >= TOOLBAR_MIN_ROWS;

  const sortIconFor = (colIndex) => {
    if (sortConfig.key !== colIndex) {
      return <ChevronsUpDown className="it-sort-icon it-sort-idle" size={14} aria-hidden="true" />;
    }
    return sortConfig.direction === SORT_ASC ? (
      <ChevronUp className="it-sort-icon" size={14} aria-hidden="true" />
    ) : (
      <ChevronDown className="it-sort-icon" size={14} aria-hidden="true" />
    );
  };

  return (
    <div className="it-wrapper" role="group" aria-label={caption || 'Data table'}>
      {showToolbar && (
        <div className="it-toolbar">
          <div className="it-search">
            <Search size={15} className="it-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="it-search-input"
              placeholder="Search table…"
              value={search}
              onChange={handleSearch}
              aria-label="Search table"
            />
          </div>
          <div className="it-toolbar-actions">
            <span className="it-count">
              {sorted.length} {sorted.length === 1 ? 'row' : 'rows'}
            </span>
            <button type="button" className="it-btn" onClick={copyTSV} title="Copy table">
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button type="button" className="it-btn" onClick={exportCSV} title="Export as CSV">
              <Download size={14} aria-hidden="true" />
              <span>CSV</span>
            </button>
          </div>
        </div>
      )}

      <div className="it-scroll">
        <table className="it-table">
          {safeHeaders.length > 0 && (
            <thead>
              <tr>
                {safeHeaders.map((header, idx) => (
                  <th key={`${tableId}-h-${idx}`} scope="col">
                    <button
                      type="button"
                      className="it-th-btn"
                      onClick={() => handleSort(idx)}
                      title="Sort column"
                    >
                      <span dangerouslySetInnerHTML={{ __html: header }} />
                      {sortIconFor(idx)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td className="it-empty" colSpan={Math.max(1, safeHeaders.length)}>
                  No matching rows.
                </td>
              </tr>
            ) : (
              visibleRows.map(({ row }, rIdx) => (
                <tr key={`${tableId}-r-${rIdx}`}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={`${tableId}-r-${rIdx}-c-${cIdx}`}
                      dangerouslySetInnerHTML={{ __html: cell }}
                    />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {caption && <div className="it-caption">{caption}</div>}

      {enablePaging && (
        <div className="it-pagination">
          <span className="it-page-info">
            Showing {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="it-page-controls">
            <button
              type="button"
              className="it-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span className="it-page-num">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="it-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InteractiveTable;
