import React, { useMemo } from 'react';
import { jsPDF } from 'jspdf';
import {
  X,
  Download,
  Printer,
  RefreshCw,
  CalendarClock,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import useChronology from '../hooks/useChronology';

const PHASE_LABELS = {
  pre_litigation: 'Pre-litigation',
  correspondence: 'Correspondence',
  institution: 'Institution',
  pending: 'Pending litigation',
  pleadings: 'Pleadings',
  interim: 'Interim',
  evidence: 'Evidence',
  listing: 'Listing / stand-over',
  hearing: 'Hearing',
  order: 'Order',
  appeal: 'Appeal',
  execution: 'Execution',
  other: 'Other',
};

const ROLE_LABELS = {
  petitioner: 'Petitioner',
  respondent: 'Respondent',
  official: 'Official record',
  impugned: 'Impugned',
  court: 'Court record',
  admitted: 'Admitted',
  disputed: 'Disputed',
};

/** `p. N · Exh. … · forum · case number · source file` */
const pinCite = (ev) =>
  [
    ev.sourcePage ? `p. ${ev.sourcePage}` : null,
    ev.exhibit || null,
    ev.forum || null,
    ev.caseNumber || null,
    ev.sourceDocument || null,
  ]
    .filter(Boolean)
    .join(' · ');

const displayDateFor = (node) => {
  const base = node.displayDate || node.date || '';
  if (node.precision === 'year') return `${base} (exact day not on record)`;
  return base;
};

const sortedDates = (tree) =>
  [...(tree?.dates || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

const ChronologyModal = ({ folderName, caseTitle, onClose }) => {
  const { tree, loading, rebuilding, error, rebuild } = useChronology(folderName);
  const title = caseTitle || folderName || 'Case';
  const dates = useMemo(() => sortedDates(tree), [tree]);

  const phaseLabel = (id) => {
    const fromTree = (tree?.phases || []).find((p) => p.id === id);
    return fromTree?.label || PHASE_LABELS[id] || id || '';
  };

  const isEmpty = !loading && !error && dates.length === 0;

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const maxW = pageW - margin * 2;
    let y = margin;

    const write = (text, size, style = 'normal', color = [17, 24, 39], gapAfter = 4, indent = 0) => {
      if (!text) return;
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(String(text), maxW - indent);
      lines.forEach((line) => {
        if (y + size + 2 > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin + indent, y);
        y += size + 3;
      });
      y += gapAfter;
    };

    write(`Chronology of Events — ${title}`, 15, 'bold', [17, 24, 39], 6);
    if (tree?.sourceDocuments?.length) {
      write(`Sources: ${tree.sourceDocuments.join(', ')}`, 9, 'normal', [107, 114, 128], 10);
    }

    dates.forEach((node) => {
      write(`${displayDateFor(node)}   [${phaseLabel(node.phase)}]`, 11, 'bold', [17, 24, 39], 2);
      if ((node.events || []).length >= 2 && node.summary) {
        write(node.summary, 9, 'italic', [75, 85, 99], 3, 10);
      }
      (node.events || []).forEach((ev) => {
        write(`• ${ev.title || 'Event'}${ev.disputed ? '  [DISPUTED]' : ''}`, 10, 'bold', [31, 41, 55], 1, 10);
        if (ev.particulars && ev.particulars !== ev.title) {
          write(ev.particulars, 9, 'normal', [55, 65, 81], 1, 18);
        }
        if (ev.sourceQuote) {
          write(`"${ev.sourceQuote}"`, 8, 'italic', [107, 114, 128], 1, 18);
        }
        const cite = pinCite(ev);
        if (cite) write(cite, 8, 'normal', [107, 114, 128], 4, 18);
      });
      y += 4;
    });

    const safe = String(title).replace(/[^\w\- ]+/g, '').trim().replace(/ +/g, '_') || 'Case';
    doc.save(`Chronology_${safe}.pdf`);
  };

  const handlePrint = () => {
    const esc = (s) =>
      String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = dates
      .map((node) => {
        const events = (node.events || [])
          .map((ev) => {
            const cite = pinCite(ev);
            return `<div style="margin:6px 0 10px 14px;">
              <div style="font-weight:600;">${esc(ev.title)}${ev.disputed ? ' <span style="color:#dc2626;">[DISPUTED]</span>' : ''}</div>
              ${ev.particulars && ev.particulars !== ev.title ? `<div>${esc(ev.particulars)}</div>` : ''}
              ${ev.sourceQuote ? `<div style="color:#6b7280;font-style:italic;">"${esc(ev.sourceQuote)}"</div>` : ''}
              ${cite ? `<div style="color:#6b7280;font-size:11px;">${esc(cite)}</div>` : ''}
            </div>`;
          })
          .join('');
        const summary =
          (node.events || []).length >= 2 && node.summary
            ? `<div style="font-style:italic;color:#4b5563;margin:2px 0 4px 14px;">${esc(node.summary)}</div>`
            : '';
        return `<div style="margin-bottom:14px;">
          <div style="font-weight:700;">${esc(displayDateFor(node))} <span style="font-weight:400;color:#6b7280;">— ${esc(phaseLabel(node.phase))}</span></div>
          ${summary}${events}
        </div>`;
      })
      .join('');
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Chronology — ${esc(title)}</title>
      <style>body{font-family:Georgia,serif;font-size:13px;color:#111827;max-width:760px;margin:32px auto;padding:0 16px;}</style>
      </head><body><h2>Chronology of Events — ${esc(title)}</h2>${body}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#f0fdfb' }}
          >
            <CalendarClock className="w-4 h-4" style={{ color: '#21C1B6' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-800 truncate">Chronology — {title}</h2>
            <p className="text-[11px] text-gray-400">
              {tree?.eventCount || 0} event{(tree?.eventCount || 0) === 1 ? '' : 's'}
              {tree?.sourceDocuments?.length
                ? ` · ${tree.sourceDocuments.length} source document${tree.sourceDocuments.length === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={rebuild}
              disabled={rebuilding || loading}
              title="Re-extract chronology from case documents"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${rebuilding ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={dates.length === 0}
              title="Download PDF"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={dates.length === 0}
              title="Print"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-xs">Loading chronology…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <p className="text-xs text-gray-500 max-w-sm">{error}</p>
              <button
                type="button"
                onClick={rebuild}
                disabled={rebuilding}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#21C1B6' }}
              >
                {rebuilding ? 'Building…' : 'Try rebuilding'}
              </button>
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <FileText className="w-6 h-6 text-gray-300" />
              <p className="text-xs text-gray-500 max-w-sm">
                No chronology has been extracted for this case yet. Build one from the uploaded
                documents — dates and events are grounded in the OCR text with page pin cites.
              </p>
              <button
                type="button"
                onClick={rebuild}
                disabled={rebuilding}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#21C1B6' }}
              >
                {rebuilding ? 'Building — this can take a minute…' : 'Build chronology'}
              </button>
            </div>
          )}

          {!loading && !error && dates.length > 0 && (
            <div className="relative pl-5">
              <div
                className="absolute left-[5px] top-1 bottom-1 w-px"
                style={{ background: '#e5e7eb' }}
              />
              {dates.map((node, i) => (
                <div key={node.date || i} className="relative mb-5">
                  <div
                    className="absolute -left-5 top-1 w-[11px] h-[11px] rounded-full border-2 border-white"
                    style={{ background: '#21C1B6', boxShadow: '0 0 0 1px #21C1B6' }}
                  />
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-gray-800">{displayDateFor(node)}</span>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: '#f0fdfb', color: '#0d9488' }}
                    >
                      {phaseLabel(node.phase)}
                    </span>
                  </div>
                  {(node.events || []).length >= 2 && node.summary && (
                    <p className="text-[11px] italic text-gray-500 mb-1.5">{node.summary}</p>
                  )}
                  {(node.events || []).map((ev, j) => (
                    <div
                      key={j}
                      className="mb-2 rounded-lg border border-gray-100 px-3 py-2"
                      style={{ background: '#fafafa' }}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-700">{ev.title}</span>
                        {ev.eventType && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">
                            {ev.eventType}
                          </span>
                        )}
                        {ev.sourceRole && ROLE_LABELS[ev.sourceRole] && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            {ROLE_LABELS[ev.sourceRole]}
                          </span>
                        )}
                        {ev.disputed && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                            Disputed
                          </span>
                        )}
                      </div>
                      {ev.particulars && ev.particulars !== ev.title && (
                        <p className="text-[11px] text-gray-600 mt-1">{ev.particulars}</p>
                      )}
                      {ev.sourceQuote && (
                        <p
                          className="text-[10px] italic text-gray-400 mt-1 pl-2"
                          style={{ borderLeft: '2px solid #e5e7eb' }}
                        >
                          &ldquo;{ev.sourceQuote}&rdquo;
                        </p>
                      )}
                      {pinCite(ev) && (
                        <p className="text-[10px] text-gray-400 mt-1">{pinCite(ev)}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChronologyModal;
