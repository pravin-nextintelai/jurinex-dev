import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Download, Copy, Printer, Code, Check, Loader2 } from 'lucide-react';
import DraftEditor from './DraftEditor';
import { downloadAsPdf, downloadAsWord, downloadAsHtml, printResponse, getCleanText } from '@/shared/utils/responseExportUtils';

/**
 * DraftEditModal — opens a chat response in the TipTap editor so the user can edit it
 * (bold/italic/underline, alignment, fonts, colour, fill red field-pills) and export or
 * save it. Saves as MARKDOWN via the draft/update endpoint (best-effort: targets the
 * latest draft row for the session). Standalone twin of Draft Studio's final phase.
 */
export default function DraftEditModal({
  open,
  onClose,
  initialMarkdown,
  title,
  baseUrl,
  folderName,
  sessionId,
  authToken,
  downloadUrl,
  downloadName,
  onSaved,
}) {
  const editorRef = useRef(null);
  const finalRef = useRef(null);
  const saveSeqRef = useRef(0);
  const closeRef = useRef(null);
  const [editedMarkdown, setEditedMarkdown] = useState(null);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [docxBusy, setDocxBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (closeRef.current || onClose)?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const currentDoc = editedMarkdown != null ? editedMarkdown : String(initialMarkdown || '');
  const remainingFields = (currentDoc.match(/\[\s*_{2,}[^\]]*\]|\[[^\]]*_{2,}\s*\]/g) || []).length;
  const baseName = ((title || folderName || 'draft')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'draft';
  const exportEl = () => (editorRef.current?.getContentEl?.() || finalRef.current);
  const flashExportError = (e) => { setExportMsg(e?.message || 'Export failed.'); setTimeout(() => setExportMsg(''), 4500); };

  const saveDraft = async (md) => {
    if (!sessionId || !md || !md.trim()) return;
    const seq = ++saveSeqRef.current;
    setSaveState('saving');
    try {
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/draft/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify({ session_id: sessionId, markdown: md }),
      });
      if (seq !== saveSeqRef.current) return;
      setSaveState(resp.ok ? 'saved' : 'error');
    } catch {
      if (seq === saveSeqRef.current) setSaveState('error');
    }
  };

  const handleEditChange = (md) => { setEditedMarkdown(md); saveDraft(md); };

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
      await navigator.clipboard.writeText(getCleanText(exportEl(), currentDoc).trim());
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (e) { flashExportError(e); }
  };

  const downloadCourtDocx = async () => {
    try {
      const md = await persistBeforeExport();
      // ALWAYS regenerate from the current (cleaned) editor markdown — the passed
      // downloadUrl is the response's original .docx and may predate edits / contain the
      // old raw-HTML tables the editor now normalises away.
      setDocxBusy(true);
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/draft/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify({ markdown: md || currentDoc, title: title || 'Draft', filename: baseName }),
      });
      setDocxBusy(false);
      if (!resp.ok) throw new Error(`Word export failed (${resp.status}).`);
      const data = await resp.json();
      const url = data.download_url;
      const name = data.filename || `${baseName}.docx`;
      if (!url) throw new Error('No document available to download.');
      const a = document.createElement('a');
      a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { setDocxBusy(false); flashExportError(e); }
  };

  const requestClose = async () => {
    if (editedMarkdown != null && editorRef.current?.flush) {
      const md = editorRef.current.flush();
      await saveDraft(md);
      if (typeof onSaved === 'function') onSaved(sessionId || null);
    }
    onClose?.();
  };
  closeRef.current = requestClose;

  const tools = [
    { key: 'copy', label: copied ? 'Copied!' : 'Copy', icon: copied ? Check : Copy, onClick: onCopy },
    { key: 'pdf', label: 'PDF', icon: Download, onClick: () => runExport(() => downloadAsPdf(exportEl(), `${baseName}.pdf`)) },
    { key: 'word', label: 'Word (.doc)', icon: FileText, onClick: () => runExport(() => downloadAsWord(exportEl(), `${baseName}.doc`)) },
    { key: 'html', label: 'HTML', icon: Code, onClick: () => runExport(() => downloadAsHtml(exportEl(), `${baseName}.html`)) },
    { key: 'print', label: 'Print', icon: Printer, onClick: () => runExport(() => printResponse(exportEl())) },
  ];

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(2px)' }}
    >
      <div style={{ width: '96vw', maxWidth: 1280, height: '94vh', background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #ececec', background: 'linear-gradient(90deg,#f0fdfa,#ffffff)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0d9488', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <FileText size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Edit draft</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Click a red field to fill it · restyle · changes auto-save</div>
          </div>
          {remainingFields > 0 && (
            <span style={{ fontWeight: 600, fontSize: 12, color: '#c00000', background: '#fdecec', border: '1px solid #f3c9c9', borderRadius: 999, padding: '2px 10px' }}>
              {remainingFields} field{remainingFields === 1 ? '' : 's'} to fill
            </span>
          )}
          <button onClick={requestClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 6, borderRadius: 8, color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 12, background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <DraftEditor ref={editorRef} initialMarkdown={String(initialMarkdown || '')} onChange={handleEditChange} />
          </div>
          <div ref={finalRef} style={{ display: 'none' }} aria-hidden="true" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '14px 20px', borderTop: '1px solid #ececec', background: '#fff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tools.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={t.onClick} title={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 9, cursor: 'pointer' }}>
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
            <button onClick={downloadCourtDocx} disabled={docxBusy} title="Court-formatted Word (.docx) — includes your edits" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: docxBusy ? '#5eafa8' : '#0d9488', color: '#fff', fontWeight: 600, fontSize: 13, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: docxBusy ? 'wait' : 'pointer' }}>
              {docxBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download .docx
            </button>
            <button onClick={requestClose} style={{ border: '1px solid #d4d4d8', background: '#fff', color: '#475569', fontSize: 13, padding: '9px 16px', borderRadius: 10, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
