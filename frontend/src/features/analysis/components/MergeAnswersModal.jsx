import React, { useMemo, useRef, useState, useCallback, memo } from 'react';
import {
  X, GripVertical, ArrowUp, ArrowDown, Trash2, Download, Copy,
  FileText, CheckSquare, Square, Layers,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { formatChatResponseForDisplay } from '@/shared/utils/formatChatResponse';
import { markdownTableComponents } from '@/shared/utils/markdownUtils';
import StreamingMarkdown from './StreamingMarkdown';
import documentApi from '@/shared/api/documentApi';
import BrandingDownloadModal from '@/features/branding/components/BrandingDownloadModal';
import { markdownToExportHtml, escapeHtml } from '@/shared/utils/markdownToExportHtml';

// A Q&A is preset-triggered when the row carries the secret-prompt flag OR a
// prompt_label (older API responses only returned the label, not the flag).
const originBadge = (msg) => {
  const isPreset = Boolean(
    msg.used_secret_prompt || msg.isSecretPrompt || msg.secret_id || String(msg.prompt_label || '').trim()
  );
  return isPreset
    ? {
        label: `Preset: ${String(msg.prompt_label || '').trim() || msg.question || 'Preset'}`,
        className: 'bg-purple-50 text-purple-700 border-purple-200',
      }
    : { label: 'Custom question', className: 'bg-gray-100 text-gray-600 border-gray-200' };
};

/** Light markdown→plain-text for the "Copy as plain text" action. */
function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/[┌└├┤┬┴┼│─┐┘]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Memoized per section: reorders re-render only moved items, and selection
// changes never re-parse existing sections' markdown.
const PreviewSection = memo(function PreviewSection({ index, question, answer, source, showQuestion }) {
  const content = useMemo(() => formatChatResponseForDisplay(answer), [answer]);
  return (
    <section className="mb-8">
      {showQuestion && (
        <h2 className="text-lg font-bold text-gray-900 border-b border-gray-200 pb-1 mb-3">
          {index + 1}. {question}
        </h2>
      )}
      <div className="formatted-assistant-markdown text-sm text-justify">
        <StreamingMarkdown content={content} isStreaming={false} components={markdownTableComponents} />
      </div>
      {source && <p className="mt-2 text-[11px] italic text-gray-500">Source: {source}</p>}
    </section>
  );
});

const MergeAnswersModal = ({ isOpen, onClose, messages, defaultTitle, sourceName }) => {
  const [assembly, setAssembly] = useState([]); // ordered message ids
  const [title, setTitle] = useState(defaultTitle || 'Merged Legal Analysis');
  const [includeQuestions, setIncludeQuestions] = useState(true);
  const [brandingExport, setBrandingExport] = useState(null); // {format:'pdf'|'word', contentHtml} | null
  const dragIndexRef = useRef(null);

  const answered = useMemo(
    () => (messages || []).filter((m) => String(m.answer || '').trim() && !m.isStreaming),
    [messages]
  );
  const byId = useMemo(() => new Map(answered.map((m) => [m.id, m])), [answered]);
  const selectedSet = useMemo(() => new Set(assembly), [assembly]);
  const assembledMessages = useMemo(
    () => assembly.map((id) => byId.get(id)).filter(Boolean),
    [assembly, byId]
  );

  const idByString = useMemo(() => new Map(answered.map((m) => [String(m.id), m.id])), [answered]);

  const toggle = useCallback((id) => {
    setAssembly((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const selectAll = () => setAssembly((prev) => [...prev, ...answered.map((m) => m.id).filter((id) => !prev.includes(id))]);
  const clearAll = () => setAssembly([]);
  const move = (index, delta) => {
    setAssembly((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeAt = (index) => setAssembly((prev) => prev.filter((_, i) => i !== index));

  // Insert a Q&A (dragged from the session list) at a position in the document.
  const addAt = useCallback((rawId, index = null) => {
    const id = idByString.get(String(rawId));
    if (id == null) return;
    setAssembly((prev) => {
      const next = prev.filter((x) => x !== id);
      const at = index == null || index > next.length ? next.length : index;
      next.splice(at, 0, id);
      return next;
    });
  }, [idByString]);

  // Drop on a specific document item: external drag inserts there, internal drag reorders.
  const handleItemDrop = (e, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();
    const externalId = e.dataTransfer.getData('text/qa-id');
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (externalId && from == null) {
      addAt(externalId, dropIndex);
      return;
    }
    if (from == null || from === dropIndex) return;
    setAssembly((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
  };

  // Drop on the column background: external drag appends, internal drag moves to end.
  const handleContainerDrop = (e) => {
    e.preventDefault();
    const externalId = e.dataTransfer.getData('text/qa-id');
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (externalId && from == null) {
      addAt(externalId);
    } else if (from != null) {
      setAssembly((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.push(moved);
        return next;
      });
    }
  };

  const buildSections = () =>
    assembledMessages.map((m) => ({
      question: String(m.display_text_left_panel || m.question || '').trim(),
      answer: String(m.answer || ''),
      source: sourceName || null,
    }));

  // Direct (unbranded) export via the backend merged-document builders.
  const handleDirectExport = async (format) => {
    if (format === 'pdf') {
      await documentApi.exportMergedPdf(title, buildSections(), includeQuestions);
    } else {
      await documentApi.exportMergedDocx(title, buildSections(), includeQuestions);
    }
  };

  // Merged document as HTML for the branded export path, built from the raw
  // markdown — NOT the preview DOM: InteractiveTable paginates rows (only the
  // current page exists in the DOM) and keeps header text inside sort buttons
  // that the export pipeline strips, so cloned previews lose table content.
  const buildMergedContentHtml = () => {
    const parts = [
      `<h1 style="text-align:center;">${escapeHtml((title || 'Merged Legal Analysis').trim())}</h1>`,
    ];
    buildSections().forEach((section, index) => {
      if (includeQuestions) {
        parts.push(`<h2>${index + 1}. ${escapeHtml(section.question || `Question ${index + 1}`)}</h2>`);
      }
      parts.push(markdownToExportHtml(formatChatResponseForDisplay(section.answer), { headingOffset: 1 }));
      if (section.source) {
        parts.push(`<p><em>Source: ${escapeHtml(section.source)}</em></p>`);
      }
    });
    return parts.join('\n');
  };

  const safeFilename = (ext) =>
    `${String(title || 'Merged_Legal_Analysis').replace(/[^\w\- ]+/g, '').trim().replace(/ /g, '_') || 'Merged_Legal_Analysis'}.${ext}`;

  const openExportModal = (format) => {
    if (!assembledMessages.length) return;
    setBrandingExport({ format, contentHtml: buildMergedContentHtml() });
  };

  const handleCopyPlainText = async () => {
    if (!assembledMessages.length) return;
    const text = [
      title,
      '',
      ...assembledMessages.flatMap((m, i) => [
        ...(includeQuestions ? [`${i + 1}. ${m.display_text_left_panel || m.question}`] : []),
        '',
        markdownToPlainText(formatChatResponseForDisplay(m.answer)),
        sourceName ? `Source: ${sourceName}` : '',
        '',
      ]),
    ].filter((line) => line !== null).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied as plain text.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#21C1B6]" />
            <h2 className="text-base font-semibold text-gray-900">Merge Answers into Document</h2>
            <span className="text-xs text-gray-500">{assembly.length} of {answered.length} selected</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500" title="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Column 1 — session Q&A selection */}
          <div className="w-full lg:w-[26%] border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col min-h-0 max-h-[38vh] lg:max-h-none flex-shrink-0 lg:flex-shrink">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Session Q&A</span>
              <div className="flex gap-1">
                <button onClick={selectAll} className="text-[11px] px-2 py-0.5 rounded text-[#21C1B6] hover:bg-[#E0F7F6] font-medium">Select all</button>
                <button onClick={clearAll} className="text-[11px] px-2 py-0.5 rounded text-gray-500 hover:bg-gray-100 font-medium">Clear</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {answered.length === 0 && (
                <p className="text-xs text-gray-400 text-center mt-8 px-4">No answered questions in this session yet.</p>
              )}
              {answered.map((m) => {
                const badge = originBadge(m);
                const checked = selectedSet.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    draggable
                    onDragStart={(e) => {
                      dragIndexRef.current = null;
                      e.dataTransfer.setData('text/qa-id', String(m.id));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Tick to add, or drag into the document order"
                    className={`w-full text-left p-2 rounded-lg border transition-colors cursor-grab active:cursor-grabbing ${
                      checked ? 'border-[#21C1B6] bg-[#E0F7F6]/60' : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {checked
                        ? <CheckSquare className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                        : <Square className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 line-clamp-2">
                          {m.display_text_left_panel || m.question}
                        </p>
                        <span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Column 2 — assembly / reorder */}
          <div className="w-full lg:w-[26%] border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col min-h-0 bg-gray-50/50 max-h-[38vh] lg:max-h-none flex-shrink-0 lg:flex-shrink">
            <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Document Order</span>
              <span className="ml-2 text-[10px] text-gray-400 normal-case">drag to reorder</span>
            </div>
            <div
              className="flex-1 overflow-y-auto p-2 space-y-1.5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleContainerDrop}
            >
              {assembledMessages.length === 0 && (
                <p className="text-xs text-gray-400 text-center mt-8 px-4">
                  Tick or drag answers from the session list to assemble your document.
                </p>
              )}
              {assembledMessages.map((m, index) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) => {
                    dragIndexRef.current = index;
                    e.dataTransfer.setData('text/plain', '');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleItemDrop(e, index)}
                  className="flex items-center gap-1.5 p-2 rounded-lg border border-gray-200 bg-white cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-[#21C1B6] w-5 flex-shrink-0">{index + 1}.</span>
                  <p className="text-xs text-gray-800 line-clamp-2 flex-1 min-w-0">
                    {m.display_text_left_panel || m.question}
                  </p>
                  <div className="flex flex-col flex-shrink-0">
                    <button onClick={() => move(index, -1)} disabled={index === 0}
                      className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up">
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button onClick={() => move(index, 1)} disabled={index === assembledMessages.length - 1}
                      className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down">
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button onClick={() => removeAt(index)} className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0" title="Remove from document">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Column 3 — live preview */}
          <div className="flex-1 flex flex-col min-h-[300px] lg:min-h-0">
            <div className="px-4 py-2 border-b border-gray-100 flex-shrink-0 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Preview</span>
              <div className="flex items-center rounded-lg border border-gray-200 p-0.5 bg-gray-50" title="Choose whether the merged document shows the prompt above each answer">
                <button
                  onClick={() => setIncludeQuestions(true)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    includeQuestions ? 'bg-white text-[#21C1B6] shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  With prompt
                </button>
                <button
                  onClick={() => setIncludeQuestions(false)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    !includeQuestions ? 'bg-white text-[#21C1B6] shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Without prompt
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-gray-100 p-4">
              {assembledMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">Nothing selected yet</p>
                    <p className="text-xs text-gray-400 mt-1">Pick answers from the session list to build your document.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm max-w-3xl mx-auto px-8 py-8">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Document title"
                    className="w-full text-center text-2xl font-bold text-gray-900 border-0 border-b-2 border-transparent focus:border-[#21C1B6] focus:outline-none mb-1 pb-1"
                  />
                  <p className="text-center text-[11px] text-gray-400 mb-8">
                    {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} · {assembledMessages.length} section(s)
                  </p>
                  {assembledMessages.map((m, index) => (
                    <PreviewSection
                      key={m.id}
                      index={index}
                      question={m.display_text_left_panel || m.question}
                      answer={m.answer}
                      source={sourceName}
                      showQuestion={includeQuestions}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 flex-shrink-0 bg-white">
          <p className="text-xs text-gray-500">
            Merging never modifies the original session history.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyPlainText}
              disabled={!assembledMessages.length}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy className="h-4 w-4" /> Copy as plain text
            </button>
            <button
              onClick={() => openExportModal('pdf')}
              disabled={!assembledMessages.length}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-[#21C1B6] border border-[#21C1B6] hover:bg-[#E0F7F6] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              Download .pdf
            </button>
            <button
              onClick={() => openExportModal('word')}
              disabled={!assembledMessages.length}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              Download .docx
            </button>
          </div>
        </div>
      </div>

      {brandingExport && (
        <BrandingDownloadModal
          isOpen
          onClose={() => setBrandingExport(null)}
          contentHtml={brandingExport.contentHtml}
          filename={safeFilename(brandingExport.format === 'word' ? 'docx' : 'pdf')}
          format={brandingExport.format}
          module="merge-answers"
          onDirect={() => handleDirectExport(brandingExport.format === 'word' ? 'docx' : 'pdf')}
        />
      )}
    </div>
  );
};

export default MergeAnswersModal;
