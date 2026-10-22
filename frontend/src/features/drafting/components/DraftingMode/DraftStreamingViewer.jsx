// DraftStreamingViewer — renders a section-by-section streamed draft.
//
// Performance model (targets ~100 pages / ~200 sections without jank):
// 1. Token chunks NEVER cause React state updates. Section text lives in a
//    mutable ref map (`textStoreRef`); only the actively streaming section is
//    painted, via a requestAnimationFrame loop that writes textContent
//    directly (same trick as ChatModelPage's StreamingMarkdown).
// 2. Completed sections are frozen into React.memo cards keyed by a version
//    counter, so re-renders only touch the one section that just finished.
// 3. Off-screen cards are skipped by the browser entirely via
//    `content-visibility: auto` + `contain-intrinsic-size` — virtual
//    rendering without a windowing library or scroll-math bugs.
// 4. Collapsed accordion cards unmount their body, capping DOM size further.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle, ChevronDown, ChevronRight, Copy, Download,
  FileText, Loader2, AlertTriangle, Layers, BookOpenText,
} from 'lucide-react';
import {
  documentDefaults, normalizeFormat, parseContentBlocks,
  splitHeadingFromContent, ptToPx, parseInlineBold, stripInlineBold,
} from './draftFormatUtils';

/** Inline renderer: turns **bold** markers into real <strong> runs. */
const InlineText = ({ text }) => (
  <>
    {parseInlineBold(text).map((seg, i) =>
      seg.bold ? <strong key={i}>{seg.text}</strong> : <React.Fragment key={i}>{seg.text}</React.Fragment>)}
  </>
);
import { downloadDraftDocx } from './draftDocxExport';

const cardStyle = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 320px',
};

const bodyStyle = {
  whiteSpace: 'pre-wrap',
  fontFamily: "'Georgia', 'Times New Roman', serif",
  fontSize: '0.9rem',
  lineHeight: 1.75,
  color: '#1f2937',
  wordBreak: 'break-word',
};

/** Live section body — paints straight from the ref buffer on rAF ticks. */
const LiveSectionBody = ({ sectionId, textStoreRef }) => {
  const nodeRef = useRef(null);
  useEffect(() => {
    let raf;
    let lastLen = -1;
    const tick = () => {
      const text = textStoreRef.current.get(sectionId) || '';
      if (nodeRef.current && text.length !== lastLen) {
        nodeRef.current.textContent = text;
        lastLen = text.length;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sectionId, textStoreRef]);
  return (
    <div style={bodyStyle}>
      <span ref={nodeRef} />
      <span className="inline-block w-2 h-4 ml-0.5 bg-[#21C1B6] animate-pulse align-text-bottom rounded-sm" />
    </div>
  );
};

/** CSS text style from a normalized TextFormatSchema. */
const fmtStyle = (fmt, fontFamily) => ({
  fontFamily: `'${fontFamily}', 'Times New Roman', serif`,
  fontSize: `${ptToPx(fmt.fontSizePt)}px`,
  fontWeight: fmt.bold ? 700 : 400,
  textDecoration: fmt.underline ? 'underline' : 'none',
  textTransform: fmt.allCaps ? 'uppercase' : 'none',
  textAlign: fmt.alignment,
  lineHeight: 1.6,
  color: '#111827',
});

/** Bordered court-style table for a parsed markdown table block. */
const DraftTable = ({ block, bodyFmt, fontFamily }) => {
  const cellStyle = {
    border: '1px solid #111827',
    padding: '4px 8px',
    fontFamily: `'${fontFamily}', 'Times New Roman', serif`,
    fontSize: `${ptToPx(bodyFmt.fontSizePt)}px`,
    textAlign: 'left',
    verticalAlign: 'top',
  };
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {block.header.map((h, i) => (
              <th key={i} style={{ ...cellStyle, fontWeight: 700 }}><InlineText text={h} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => <td key={ci} style={cellStyle}><InlineText text={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Paragraphs + bordered tables from pipe-markdown content. */
const DraftBodyBlocks = ({ content, bodyFmt, fontFamily }) => (
  <>
    {parseContentBlocks(content).map((block, bi) =>
      block.type === 'table' ? (
        <DraftTable key={bi} block={block} bodyFmt={bodyFmt} fontFamily={fontFamily} />
      ) : (
        <div
          key={bi}
          style={{
            ...fmtStyle(bodyFmt, fontFamily),
            whiteSpace: 'pre-wrap',
            minHeight: block.text.trim() === '' ? '0.6em' : undefined,
          }}
        >
          <InlineText text={block.text} />
        </div>
      ))}
  </>
);

/** Frozen section body — memoized, only re-renders when its version changes. */
const CompletedSectionBody = memo(
  ({ text, bodyFmt, fontFamily, version }) => (
    <DraftBodyBlocks content={text} bodyFmt={bodyFmt} fontFamily={fontFamily} />
  ),
  (prev, next) => prev.version === next.version,
);
CompletedSectionBody.displayName = 'CompletedSectionBody';

/**
 * Live full-document body for monolithic streaming.
 *
 * Streams as PLAIN pre-wrap text (how Lucio/Harvey stream) — no block/table
 * parsing per repaint, which was O(document) 5×/second and made long drafts
 * feel frozen. The fully formatted A4 view takes over at document_end.
 * Direct textContent writes via rAF; follow-scroll keeps the tail visible
 * unless the user has scrolled up to read.
 */
const MonolithicLiveDocument = ({ textStoreRef, structure }) => {
  const defaults = documentDefaults(structure);
  const font = defaults.fontFamily;
  const textRef = useRef(null);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    let raf;
    let lastLen = -1;
    const tick = () => {
      const text = textStoreRef.current.get('__document__') || '';
      if (text.length !== lastLen && textRef.current) {
        // Display-only cleanup: hide bold markers and ATX # headings while
        // streaming; the buffer keeps the original text for post-repair.
        textRef.current.textContent = text
          .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
          .replace(/\*\*/g, '');
        lastLen = text.length;
        if (stickToBottomRef.current && scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [textStoreRef]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Re-stick only when the user returns to (near) the bottom.
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  return (
    <div ref={scrollRef} onScroll={onScroll}
      className="flex-1 min-h-0 overflow-y-auto bg-gray-200/70 px-4 py-6">
      <div
        className="mx-auto bg-white shadow-lg border border-gray-300"
        style={{ width: 'min(794px, 100%)', minHeight: '1000px', padding: '96px 96px' }}
      >
        {/* No synthetic title — only template-driven streamed body text. */}
        <div
          ref={textRef}
          style={{
            fontFamily: font,
            fontSize: `${defaults.baseFontSizePt}pt`,
            textAlign: 'justify',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.65,
          }}
        />
        <span className="inline-block w-2 h-4 ml-0.5 bg-[#21C1B6] animate-pulse align-text-bottom rounded-sm" />
      </div>
    </div>
  );
};

const SectionCard = memo(function SectionCard({
  section, isStreaming, isExpanded, onToggle, textStoreRef, version, structure,
}) {
  const defaults = documentDefaults(structure);
  const font = defaults.fontFamily;
  const bodyFmt = normalizeFormat(section.bodyFormat, {
    alignment: 'justify', fontSizePt: defaults.baseFontSizePt,
  });
  const status = section.status; // 'pending' | 'streaming' | 'done' | 'error'
  return (
    <div
      style={cardStyle}
      className={`rounded-xl border bg-white shadow-sm transition-colors ${
        isStreaming ? 'border-[#21C1B6] ring-1 ring-[#21C1B6]/30' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(section.sectionId)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        {isExpanded
          ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
        <span className="text-xs font-bold text-gray-400 w-8 flex-shrink-0">
          {String(section.index + 1).padStart(2, '0')}
        </span>
        <span className="flex-1 text-sm font-semibold text-gray-800 truncate">
          {section.heading}
        </span>
        {status === 'streaming' && <Loader2 className="h-4 w-4 text-[#21C1B6] animate-spin flex-shrink-0" />}
        {status === 'done' && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
        {status === 'error' && <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />}
        {status === 'pending' && <span className="text-[10px] text-gray-400 flex-shrink-0">queued</span>}
      </button>

      {isExpanded && (
        <div className="px-5 pb-4 border-t border-gray-100 pt-3">
          {status === 'error' && (
            <p className="mb-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {section.error || 'This section failed to generate. Use "Retry section" after the run finishes.'}
            </p>
          )}
          {isStreaming
            ? <LiveSectionBody sectionId={section.sectionId} textStoreRef={textStoreRef} />
            : (
              <CompletedSectionBody
                text={textStoreRef.current.get(section.sectionId) || ''}
                bodyFmt={bodyFmt}
                fontFamily={font}
                version={version}
              />
            )}
        </div>
      )}
    </div>
  );
});

/**
 * Merged "Full Document" view — an A4 page rendered with the template's exact
 * typography (font family, per-section alignment, point sizes, tables).
 * Memoized on `version`; each section block keeps content-visibility so
 * 100-page drafts stay smooth.
 */
const MergedDocumentView = memo(function MergedDocumentView({
  sections, textStoreRef, structure, version,
}) {
  const defaults = documentDefaults(structure);
  const font = defaults.fontFamily;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-200/70 px-4 py-6">
      {/* A4 sheet: 8.27in wide, 1in margins — matches the .docx export */}
      <div
        className="mx-auto bg-white shadow-lg border border-gray-300"
        style={{ width: 'min(794px, 100%)', minHeight: '1000px', padding: '96px 96px' }}
      >
        {/* Title comes only from template section content — never inject analysis metadata. */}
        {sections.map((s) => {
          const raw = (textStoreRef.current.get(s.sectionId) || '').trim();
          if (!raw) return null;
          if (s.sectionId === '__document__') {
            const bodyFmt = normalizeFormat(
              s.bodyFormat || { alignment: 'justify', font_size_pt: defaults.baseFontSizePt },
              { alignment: 'justify', fontSizePt: defaults.baseFontSizePt },
            );
            return (
              <div key={s.sectionId}>
                <DraftBodyBlocks content={raw} bodyFmt={bodyFmt} fontFamily={font} />
              </div>
            );
          }
          const headingFmt = normalizeFormat(s.headingFormat, {
            bold: true, fontSizePt: defaults.baseFontSizePt,
          });
          const bodyFmt = normalizeFormat(s.bodyFormat, {
            alignment: 'justify', fontSizePt: defaults.baseFontSizePt,
          });
          const { headingText, body } = splitHeadingFromContent(raw, s.heading);
          // Derived UI labels (headingVerbatim === false) are navigation-only:
          // print a heading only when the content itself restated the template's
          // real heading, or the heading is verbatim from the template.
          const printableHeading =
            s.headingVerbatim === false
              ? (headingText !== s.heading ? headingText : '')
              : headingText;
          const printableBody = s.headingVerbatim === false && printableHeading === '' ? raw : body;
          return (
            <section key={s.sectionId} style={cardStyle} className="mb-5">
              {printableHeading && (
                <div style={{ ...fmtStyle(headingFmt, font), marginBottom: '0.4rem' }}>
                  <InlineText text={printableHeading} />
                </div>
              )}
              {parseContentBlocks(printableBody).map((block, bi) =>
                block.type === 'table' ? (
                  <DraftTable key={bi} block={block} bodyFmt={bodyFmt} fontFamily={font} />
                ) : (
                  <div
                    key={bi}
                    style={{
                      ...fmtStyle(bodyFmt, font),
                      whiteSpace: 'pre-wrap',
                      minHeight: block.text.trim() === '' ? '0.6em' : undefined,
                    }}
                  >
                    <InlineText text={block.text} />
                  </div>
                ))}
              {s.status === 'error' && (
                <p className="mt-1 text-[11px] text-amber-600">⚠ This section failed to generate fully.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}, (prev, next) => prev.version === next.version && prev.sections === next.sections);

/**
 * @param {object} props
 * @param {Array}  props.sections         [{sectionId,index,heading,status,error}] in order
 * @param {string} props.streamingSectionId currently generating section (or null)
 * @param {object} props.textStoreRef     ref of Map(sectionId -> text)
 * @param {number} props.version          bump to invalidate completed-section memos
 * @param {string} props.documentTitle
 * @param {object} props.progress         {completed,total} | null
 * @param {string} props.statusMessage
 * @param {boolean} props.finished        generation over → auto-switch to merged document view
 */
const DraftStreamingViewer = ({
  sections, streamingSectionId, textStoreRef, version,
  documentTitle, progress, statusMessage, finished = false, structure = null,
  isMonolithic = false,
}) => {
  const [expanded, setExpanded] = useState(() => new Set());
  // Monolithic: always full-document view; section-wise: cards until done.
  const [view, setView] = useState(isMonolithic ? 'document' : 'sections');
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef(null);
  const containerRef = useRef(null);

  // Close the download menu on outside click.
  useEffect(() => {
    if (!showDownloadMenu) return undefined;
    const onDown = (e) => {
      if (!downloadMenuRef.current?.contains(e.target)) setShowDownloadMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showDownloadMenu]);

  useEffect(() => {
    if (isMonolithic) setView('document');
    else if (finished) setView('document');
  }, [finished, isMonolithic]);

  // Auto-expand the streaming section, auto-collapse finished ones the user
  // didn't open manually (keeps DOM small on long documents).
  const manualRef = useRef(new Set());
  useEffect(() => {
    if (!streamingSectionId) return;
    setExpanded((prev) => {
      const next = new Set([...prev].filter(
        (id) => manualRef.current.has(id) || id === streamingSectionId,
      ));
      next.add(streamingSectionId);
      return next;
    });
    // Keep the live card in view.
    const el = containerRef.current?.querySelector(`[data-sid="${streamingSectionId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [streamingSectionId]);

  const onToggle = useCallback((sectionId) => {
    manualRef.current.add(sectionId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
      return next;
    });
  }, []);

  const compile = useCallback((asMarkdown) => {
    const parts = [];
    // Do not prepend structure.document_title — that is analysis metadata, not
    // template body. Only drafted section/document text is exported.
    for (const s of sections) {
      const text = textStoreRef.current.get(s.sectionId) || '';
      if (!text.trim()) continue;
      if (
        asMarkdown
        && s.sectionId !== '__document__'
        && s.headingVerbatim !== false
        && !text.trim().toLowerCase().startsWith(String(s.heading || '').toLowerCase().slice(0, 40))
      ) {
        parts.push(`\n## ${s.heading}\n`);
      }
      parts.push(text.trim() + '\n');
    }
    return parts.join('\n');
  }, [sections, textStoreRef]);

  const downloadBlob = useCallback((content, mime, ext) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(documentTitle || 'draft').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'draft'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [documentTitle]);

  const safeName = useCallback((ext) =>
    `${(documentTitle || 'draft').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'draft'}.${ext}`,
  [documentTitle]);

  const handleDownload = useCallback(async (format) => {
    if (format === 'md') {
      downloadBlob(compile(true), 'text/markdown;charset=utf-8', 'md');
    } else if (format === 'txt') {
      downloadBlob(stripInlineBold(compile(false)), 'text/plain;charset=utf-8', 'txt');
    } else if (format === 'docx') {
      // Real Word document with the template's exact typography
      // (Times New Roman, alignment, point sizes, bordered tables, A4).
      try {
        await downloadDraftDocx(structure, sections, textStoreRef.current, safeName('docx'));
      } catch (e) {
        console.error('DOCX export failed:', e);
      }
    }
  }, [sections, compile, downloadBlob, textStoreRef, structure, safeName]);

  const copyAll = useCallback(async () => {
    try { await navigator.clipboard.writeText(compile(false)); } catch { /* clipboard denied */ }
  }, [compile]);

  const doneCount = useMemo(
    () => sections.filter((s) => s.status === 'done').length,
    [sections],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: title, progress, downloads */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <FileText className="h-4 w-4 text-[#21C1B6] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">{documentTitle || 'Draft Document'}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {statusMessage || (isMonolithic
              ? 'Drafting full document…'
              : (progress ? `${progress.completed}/${progress.total} sections drafted` : `${doneCount}/${sections.length} sections`))}
          </p>
        </div>
        {progress && progress.total > 0 && (
          <div className="w-28 bg-gray-100 rounded-full h-1.5 overflow-hidden flex-shrink-0">
            <div
              className="bg-[#21C1B6] h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
            />
          </div>
        )}
        {/* Sections ↔ Full Document toggle (section-wise only) */}
        {!isMonolithic && (
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden flex-shrink-0">
          <button type="button" onClick={() => setView('sections')} title="Section cards"
            className={`flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              view === 'sections' ? 'bg-[#E0F7F6] text-[#11766f]' : 'bg-white text-gray-500 hover:text-gray-700'
            }`}>
            <Layers className="h-3.5 w-3.5" /> Sections
          </button>
          <button type="button" onClick={() => setView('document')} title="Merged full document"
            className={`flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold transition-colors border-l border-gray-200 ${
              view === 'document' ? 'bg-[#E0F7F6] text-[#11766f]' : 'bg-white text-gray-500 hover:text-gray-700'
            }`}>
            <BookOpenText className="h-3.5 w-3.5" /> Full Document
          </button>
        </div>
        )}
        <button type="button" onClick={copyAll} title="Copy draft"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          <Copy className="h-4 w-4" />
        </button>
        <div className="relative flex-shrink-0" ref={downloadMenuRef}>
          <button type="button" title="Download"
            onClick={() => setShowDownloadMenu((s) => !s)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#21C1B6] hover:bg-[#1aa89e]">
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          {showDownloadMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-30 min-w-[140px]">
              <button type="button" onClick={() => { handleDownload('docx'); setShowDownloadMenu(false); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Word (.docx)</button>
              <button type="button" onClick={() => { handleDownload('md'); setShowDownloadMenu(false); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Markdown (.md)</button>
              <button type="button" onClick={() => { handleDownload('txt'); setShowDownloadMenu(false); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">Plain text (.txt)</button>
            </div>
          )}
        </div>
      </div>

      {/* Body: merged full document, or section accordion while drafting */}
      {view === 'document' ? (
        isMonolithic && streamingSectionId ? (
          <MonolithicLiveDocument
            textStoreRef={textStoreRef}
            structure={structure}
          />
        ) : (
        <MergedDocumentView
          sections={sections}
          textStoreRef={textStoreRef}
          version={version}
          structure={structure}
        />
        )
      ) : (
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50">
        {sections.map((s) => (
          <div key={s.sectionId} data-sid={s.sectionId}>
            <SectionCard
              section={s}
              isStreaming={s.sectionId === streamingSectionId}
              isExpanded={expanded.has(s.sectionId)}
              onToggle={onToggle}
              textStoreRef={textStoreRef}
              version={version}
              structure={structure}
            />
          </div>
        ))}
        {sections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm">{statusMessage || 'Preparing draft…'}</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default DraftStreamingViewer;
