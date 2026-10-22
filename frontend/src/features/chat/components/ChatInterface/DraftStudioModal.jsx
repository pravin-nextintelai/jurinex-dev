import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Loader2, CheckCircle2, Download, ArrowLeft, Sparkles, AlertTriangle, Copy, Printer, Code, Check } from 'lucide-react';
import DraftDocumentView, { DraftTiptapDocumentView } from './DraftDocumentView';
import DraftEditor from './DraftEditor';
import { downloadAsPdf, downloadAsWord, downloadAsHtml, printResponse, getCleanText } from '@/shared/utils/responseExportUtils';
import { canonicalizeFieldPlaceholders, fixInlineEmphasis, normalizeLegalDraftMarkdownForRender } from '../../utils/legalDraftRender';
import { notifyResponseComplete, ensureNotificationPermission } from '@/shared/utils/responseNotifier';

function isTiptapDoc(value) {
  return !!(
    value
    && typeof value === 'object'
    && value.type === 'doc'
    && Array.isArray(value.content)
  );
}

function normalizeTiptapDoc(value) {
  if (!isTiptapDoc(value)) return null;
  return {
    type: 'doc',
    content: value.content.length ? value.content : [{ type: 'paragraph' }],
  };
}

function mergeSectionTiptapDoc(sectionList) {
  const content = [];
  (sectionList || []).forEach((section) => {
    if (!section) return;
    if (Array.isArray(section.tiptapContent)) {
      content.push(...section.tiptapContent);
      return;
    }
    if (isTiptapDoc(section.tiptapJson)) {
      content.push(...section.tiptapJson.content);
    }
  });
  return content.length ? { type: 'doc', content } : null;
}

function prepareSectionMarkdown(markdown) {
  return canonicalizeFieldPlaceholders(
    normalizeLegalDraftMarkdownForRender(fixInlineEmphasis(String(markdown || ''))),
  );
}

/**
 * Draft Studio — a dedicated popup for draft-from-template generation.
 *
 * It runs its OWN streaming request (isolated from the chat flow), shows each
 * template section as it is drafted (section-by-section), and — once generation
 * finishes — a "Create Final Draft" button merges the sections into the final,
 * court-styled document with a .docx download. All rendering goes through the
 * dedicated DraftDocumentView engine, so the chat renderer's bugs never touch it.
 */
export default function DraftStudioModal({
  open,
  onClose,
  baseUrl,
  folderName,
  question,
  template,        // { gcsPath, mimetype, filename }
  draftModel,      // '' | 'claude-opus-4-8' | 'claude-sonnet-5' | 'gemini-3.1-pro-preview'
  structureModel,  // '' (default gemini-3.1-pro) | any allowed model for Stage-A analysis
  guardianModel,   // '' (server default) | the model that AUDITS/repairs the draft (Stage D/E)
  sessionId,
  authToken,
  onSaved,
}) {
  const [sections, setSections] = useState([]);       // array indexed by section index
  const [outlineSections, setOutlineSections] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('generating'); // 'generating' | 'ready' | 'error'
  const [statusText, setStatusText] = useState('Starting…');
  const [finalAnswer, setFinalAnswer] = useState('');
  const [finalTiptapJson, setFinalTiptapJson] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState('draft.docx');
  const [phase, setPhase] = useState('sections');     // 'sections' | 'final'
  const [errorText, setErrorText] = useState('');
  const [copied, setCopied] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [editedMarkdown, setEditedMarkdown] = useState(null); // null = untouched by the editor
  const [savedSessionId, setSavedSessionId] = useState(sessionId || null);
  const [saveState, setSaveState] = useState('idle');  // idle | saving | saved | error
  const [docxBusy, setDocxBusy] = useState(false);
  const abortRef = useRef(null);
  const chunkBufRef = useRef('');
  const finalRef = useRef(null);                       // read-only fallback container
  const editorRef = useRef(null);                      // DraftEditor imperative handle
  const saveSeqRef = useRef(0);
  const closeRef = useRef(null);                       // latest handleClose (for Escape)

  const engineLabel =
    draftModel === 'claude-opus-4-8' ? 'Claude Opus'
      : draftModel === 'claude-sonnet-5' ? 'Claude Sonnet'
        : 'Gemini';

  const runGeneration = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      ensureNotificationPermission();
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken ? `Bearer ${authToken}` : '',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          question: question || 'Draft the document from the supporting files.',
          session_id: sessionId || undefined,
          llm_name: 'gemini',
          draft_mode: true,
          template_gcs_path: template?.gcsPath,
          template_mimetype: template?.mimetype,
          ...(draftModel ? { draft_model: draftModel } : {}),
          ...(structureModel ? { analysis_model: structureModel } : {}),
          ...(guardianModel ? { guardian_model: guardianModel } : {}),
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        setStatus('error');
        setErrorText(`The draft service returned ${resp.status}. Please try again.`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          handleEvent(evt);
        }
      }
      // stream ended without a done event → finalize from what we have
      setStatus((s) => (s === 'error' ? s : 'ready'));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatus('error');
        setErrorText('The connection was interrupted while drafting. Please try again.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, folderName, question, sessionId, template, draftModel, structureModel, guardianModel, authToken]);

  const handleEvent = (evt) => {
    const type = evt?.type;
    if (type === 'draft_outline') {
      if (typeof evt.total === 'number') setTotal(evt.total);
      setOutlineSections(Array.isArray(evt.sections) ? evt.sections : []);
    } else if (type === 'draft_section') {
      if (typeof evt.total === 'number') setTotal(evt.total);
      setSections((prev) => {
        const next = prev.slice();
        const markdown = evt.markdown || '';
        next[evt.index] = {
          index: evt.index,
          heading: evt.heading || `Section ${evt.index + 1}`,
          markdown,
          renderMarkdown: prepareSectionMarkdown(markdown),
          sectionId: evt.section_id || evt.sectionId || null,
          tiptapJson: normalizeTiptapDoc(evt.tiptap_json),
          tiptapContent: Array.isArray(evt.tiptap_content) ? evt.tiptap_content : null,
          legalSection: evt.legal_section || null,
          templateLayout: evt.template_layout || null,
        };
        return next;
      });
    } else if (type === 'thinking') {
      const t = String(evt.text || '').trim();
      if (t) setStatusText(t.split('\n').filter(Boolean).slice(-1)[0] || t);
    } else if (type === 'chunk') {
      chunkBufRef.current += evt.text || '';
    } else if (type === 'done') {
      const ans = evt.answer || chunkBufRef.current || '';
      if (ans) setFinalAnswer(ans);
      const docJson = normalizeTiptapDoc(evt.draft_tiptap_json);
      if (docJson) setFinalTiptapJson(docJson);
      if (evt.draft_download_url) setDownloadUrl(evt.draft_download_url);
      if (evt.draft_filename) setDownloadName(evt.draft_filename);
      setStatus('ready');
      setStatusText('Draft ready.');
      notifyResponseComplete({ title: 'Draft ready', body: 'JuriNex has finished generating your draft.' });
      // Remember the resolved session id (the backend may have created a new session) so
      // editor auto-saves can target the correct chat row.
      const resolvedSid = evt.session_id || sessionId || null;
      setSavedSessionId(resolvedSid);
      // Tell the parent the draft is persisted (so it can refresh the chat history).
      if (typeof onSaved === 'function') onSaved(resolvedSid);
    } else if (type === 'error') {
      setStatus('error');
      setErrorText(evt.message || 'The draft could not be generated.');
    }
  };

  useEffect(() => {
    runGeneration();
    return () => {
      try { abortRef.current?.abort(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape — via a ref so the latest flush-and-save close logic is used.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (closeRef.current || onClose)?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  const filled = sections.filter(Boolean);
  const doneCount = filled.length;
  const pct = total > 0 ? Math.min(100, Math.round((doneCount / total) * 100)) : (status === 'ready' ? 100 : 8);
  const mergedFromSections = filled.map((s) => s.renderMarkdown || prepareSectionMarkdown(s.markdown)).join('\n\n');
  const mergedTiptapDoc = normalizeTiptapDoc(finalTiptapJson) || mergeSectionTiptapDoc(filled);
  // Canonicalise bare "[ BANK NAME ]" placeholders into the red span at the SOURCE so every
  // consumer of the draft — the read-only view, the editor, the .docx/PDF export, and the
  // remaining-fields counter below — sees the same red, fillable placeholders. Idempotent:
  // an already-canonical span is protected, never wrapped twice.
  const finalDoc = canonicalizeFieldPlaceholders(fixInlineEmphasis(finalAnswer || mergedFromSections));
  const canCreate = status === 'ready' || (total > 0 && doneCount >= total);

  // ── export options (Copy / PDF / Word / HTML / Print) — operate on the EDITED draft ──
  const baseName = (
    (template?.filename ? template.filename.replace(/\.[^.]+$/, '') : (folderName || 'draft')) + '_draft'
  ).replace(/[^A-Za-z0-9._-]+/g, '_');
  const currentDoc = editedMarkdown != null ? editedMarkdown : finalDoc;
  // Count remaining unfilled fields (red placeholders) so the user knows what's left.
  const remainingFields = (currentDoc.match(/\[\s*_{2,}[^\]]*\]|\[[^\]]*_{2,}\s*\]/g) || []).length;
  // Exports capture the live edited editor DOM (falls back to the read-only container).
  const exportEl = () => (editorRef.current?.getContentEl?.() || finalRef.current);
  const flashExportError = (e) => {
    setExportMsg(e?.message || 'Export failed. Please try again.');
    setTimeout(() => setExportMsg(''), 4500);
  };

  // Persist the edited draft (MARKDOWN) back onto its saved chat row. Latest-write-wins.
  // Plain function (declared after the early `return null`, so it must NOT be a hook).
  const saveDraft = async (md) => {
    const sid = savedSessionId || sessionId;
    if (!sid || !md || !md.trim()) return;
    const seq = ++saveSeqRef.current;
    setSaveState('saving');
    try {
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/draft/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify({ session_id: sid, markdown: md }),
      });
      if (seq !== saveSeqRef.current) return;               // a newer save superseded this one
      setSaveState(resp.ok ? 'saved' : 'error');
    } catch {
      if (seq === saveSeqRef.current) setSaveState('error');
    }
  };

  // Auto-save fires from the editor's onChange (already debounced in DraftEditor).
  const handleEditChange = (md) => {
    setEditedMarkdown(md);
    saveDraft(md);
  };

  // Flush + save the newest edits before any export/download (auto-save on download).
  const persistBeforeExport = async () => {
    if (!editorRef.current?.flush) return currentDoc;
    const md = editorRef.current.flush();
    setEditedMarkdown(md);
    await saveDraft(md);
    return md;
  };
  const runExport = async (fn) => { try { await persistBeforeExport(); await fn(); } catch (e) { flashExportError(e); } };
  const onCopy = async () => {
    try {
      await persistBeforeExport();
      const text = getCleanText(exportEl(), currentDoc).trim();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { flashExportError(e); }
  };

  // Court-styled .docx: regenerate from the EDITED markdown so the download reflects edits
  // (the pre-generated URL is only valid for the untouched original).
  const downloadCourtDocx = async () => {
    try {
      const md = await persistBeforeExport();
      // Regenerate from the current (cleaned) editor markdown so the .docx always matches
      // what is on screen — the pipeline's original downloadUrl predates any edits.
      setDocxBusy(true);
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/draft/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify({ markdown: md || currentDoc, title: question || 'Draft', filename: baseName }),
      });
      setDocxBusy(false);
      if (!resp.ok) throw new Error(`Word export failed (${resp.status}).`);
      const data = await resp.json();
      const url = data.download_url;
      const name = data.filename || `${baseName}.docx`;
      if (!url) throw new Error('No document available to download yet.');
      const a = document.createElement('a');
      a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { setDocxBusy(false); flashExportError(e); }
  };

  const exportTools = [
    { key: 'copy', label: copied ? 'Copied!' : 'Copy', icon: copied ? Check : Copy, onClick: onCopy },
    { key: 'pdf', label: 'PDF', icon: Download, onClick: () => runExport(() => downloadAsPdf(exportEl(), `${baseName}.pdf`)) },
    { key: 'word', label: 'Word (.doc)', icon: FileText, onClick: () => runExport(() => downloadAsWord(exportEl(), `${baseName}.doc`)) },
    { key: 'html', label: 'HTML', icon: Code, onClick: () => runExport(() => downloadAsHtml(exportEl(), `${baseName}.html`)) },
    { key: 'print', label: 'Print', icon: Printer, onClick: () => runExport(() => printResponse(exportEl())) },
  ];

  // Final flush + save + history refresh when the modal closes (captures the last edit).
  const handleClose = async () => {
    if (editedMarkdown != null && editorRef.current?.flush) {
      const md = editorRef.current.flush();
      await saveDraft(md);
      if (typeof onSaved === 'function') onSaved(savedSessionId || sessionId || null);
    }
    onClose?.();
  };
  closeRef.current = handleClose;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        width: 'min(980px, 96vw)', maxHeight: '92vh', background: '#ffffff', borderRadius: '16px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px',
          borderBottom: '1px solid #ececec', background: 'linear-gradient(90deg,#f0fdfa,#ffffff)',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0d9488', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <FileText size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Draft Studio</div>
            <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {template?.filename ? `${template.filename} · ` : ''}{engineLabel} · section-by-section
            </div>
          </div>
          <button onClick={handleClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 6, borderRadius: 8, color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: '#eef2f1' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: status === 'error' ? '#dc2626' : '#14b8a6', transition: 'width .4s ease' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, background: '#fafafa' }}>
          {phase === 'sections' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, color: '#475569' }}>
                {status === 'error' ? (
                  <AlertTriangle size={16} color="#dc2626" />
                ) : status === 'ready' ? (
                  <CheckCircle2 size={16} color="#0d9488" />
                ) : (
                  <Loader2 size={16} className="animate-spin" color="#14b8a6" />
                )}
                <span style={{ whiteSpace: 'pre-wrap' }}>
                  {status === 'error' ? errorText
                    : status === 'ready' ? `All ${total || doneCount} sections drafted — ready to create the final document.`
                      : total > 0 ? `Drafting section ${Math.min(doneCount + 1, total)} of ${total} — ${statusText}`
                        : statusText}
                </span>
              </div>

              {filled.length === 0 && status !== 'error' && (
                <div style={{ padding: '28px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  {outlineSections.length ? 'Template outline ready. Drafting the first section…' : 'Analyzing the template and extracting the case facts…'}
                </div>
              )}

              {filled.length === 0 && outlineSections.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {outlineSections.slice(0, 8).map((s) => (
                    <div key={s.section_id || s.index} style={{ border: '1px dashed #dbe3e1', borderRadius: 10, background: '#fff', padding: '9px 12px', color: '#78908b', fontSize: 12 }}>
                      {Number(s.index) + 1}. {s.heading || `Section ${Number(s.index) + 1}`}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Skip sections emptied by cross-section table dedup (e.g. a duplicate
                    inventory table removed) so they don't render as a blank card. */}
                {filled.filter((s) => (s.markdown || '').trim()).map((s) => (
                  <div key={s.index} style={{
                    border: '1px solid #e6e6e6', borderRadius: 12, background: '#fff', overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                      background: '#f6faf9', borderBottom: '1px solid #eef2f1',
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#0d9488', background: '#ccfbf1',
                        borderRadius: 6, padding: '2px 8px', flex: 'none',
                      }}>{s.index + 1}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.heading}
                      </span>
                    </div>
                    <div style={{ padding: '10px 16px' }}>
                      {Array.isArray(s.tiptapContent) && s.tiptapContent.length ? (
                        <DraftTiptapDocumentView content={s.tiptapContent} />
                      ) : (
                        <DraftDocumentView raw={s.renderMarkdown || s.markdown} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, fontSize: 12, color: '#64748b' }}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>Editable draft</span>
                <span>— click a red field to fill it, restyle text, edit freely; changes auto-save.</span>
                {remainingFields > 0 && (
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#c00000', background: '#fdecec', border: '1px solid #f3c9c9', borderRadius: 999, padding: '2px 10px' }}>
                    {remainingFields} field{remainingFields === 1 ? '' : 's'} to fill
                  </span>
                )}
              </div>
              <div style={{ height: '68vh', minHeight: 380 }}>
                <DraftEditor
                  ref={editorRef}
                  initialMarkdown={finalDoc}
                  initialTiptapJson={mergedTiptapDoc}
                  onChange={handleEditChange}
                />
              </div>
              {/* Hidden read-only copy so exports still have a fallback element if needed. */}
              <div ref={finalRef} style={{ display: 'none' }} aria-hidden="true">
                <DraftDocumentView raw={currentDoc} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 20px', borderTop: '1px solid #ececec', background: '#fff',
        }}>
          {phase === 'sections' ? (
            <>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {doneCount}{total ? ` / ${total}` : ''} sections
              </span>
              <button
                onClick={() => setPhase('final')}
                disabled={!canCreate}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none',
                  background: canCreate ? '#0d9488' : '#cbd5e1', color: '#fff', fontWeight: 600,
                  fontSize: 14, padding: '10px 20px', borderRadius: 10, cursor: canCreate ? 'pointer' : 'not-allowed',
                }}
              >
                <Sparkles size={16} /> Create Final Draft
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, width: '100%' }}>
              <button
                onClick={() => setPhase('sections')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #d4d4d8', background: '#fff', color: '#475569', fontSize: 13, padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}
              >
                <ArrowLeft size={15} /> Back to sections
              </button>

              {/* Export toolbar — Copy / PDF / Word / HTML / Print (mirrors the chat toolbar) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {exportTools.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      onClick={t.onClick}
                      title={t.label}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        border: '1px solid #e2e8f0', background: '#fff', color: '#475569',
                        fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                      }}
                    >
                      <Icon size={13} /> {t.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {exportMsg && <span style={{ fontSize: 11, color: '#dc2626' }}>{exportMsg}</span>}
                {saveState === 'saving' && <span style={{ fontSize: 11, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Loader2 size={12} className="animate-spin" /> Saving…</span>}
                {saveState === 'saved' && <span style={{ fontSize: 11, color: '#0d9488', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Saved</span>}
                {saveState === 'error' && <span style={{ fontSize: 11, color: '#dc2626' }}>Save failed</span>}
                {(downloadUrl || finalDoc) && (
                  <button
                    onClick={downloadCourtDocx}
                    disabled={docxBusy}
                    title="Court-formatted Word (.docx) — Times New Roman, A4, 1 inch margins (includes your edits)"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: docxBusy ? '#5eafa8' : '#0d9488', color: '#fff', fontWeight: 600, fontSize: 13, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: docxBusy ? 'wait' : 'pointer' }}
                  >
                    {docxBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download .docx
                  </button>
                )}
                <button
                  onClick={handleClose}
                  style={{ border: '1px solid #d4d4d8', background: '#fff', color: '#475569', fontSize: 13, padding: '9px 16px', borderRadius: 10, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
