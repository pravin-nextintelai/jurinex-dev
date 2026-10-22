import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { X, Download, FileText, Plus, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getProfiles, refreshProfiles } from '../utils/brandingStorage';
import { normalizeBrandingProfile } from '../utils/brandingProfileDefaults';
import { getUserIdForDrafting } from '@/config/apiConfig';
import { downloadWithBranding } from '../utils/brandingExport';
import { downloadAsPdf, downloadAsWord, downloadAsHtml } from '@/shared/utils/responseExportUtils';

/**
 * BrandingDownloadModal
 *
 * Props:
 *   isOpen       — boolean
 *   onClose      — () => void
 *   contentRef   — React ref pointing at the DOM element to export
 *   contentHtml  — string (alternative to contentRef; raw HTML)
 *   filename     — string  e.g. "AI_Response_2024-01-01.pdf" or ".doc"
 *   format       — 'pdf' | 'word' | 'html'  (default 'pdf')
 *   xUserId      — string | number (required for branded PDF — Chromium print on server)
 *   module       — string (analytics tag, e.g. "chat", "analysis")
 *   onDirect     — optional async () => void; replaces the built-in "Quick Download"
 *                  behaviour (used by callers with their own plain export, e.g. merge)
 */
export default function BrandingDownloadModal({
  isOpen,
  onClose,
  contentRef,
  contentHtml,
  filename,
  format = 'pdf',
  xUserId,
  module: mod = 'download-modal',
  onDirect,
}) {
  const isPdf = format === 'pdf';
  const isWord = format === 'word';
  const isHtml = format === 'html';
  const defaultFilename = isWord ? 'document.docx' : isHtml ? 'document.html' : 'document.pdf';
  const resolvedFilename = filename || defaultFilename;
  const navigate = useNavigate();
  const [mode, setMode] = useState('direct');
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);
  const contentSnapshot = useRef(null);

  useLayoutEffect(() => {
    if (isOpen) contentSnapshot.current = contentRef?.current ?? null;
    else contentSnapshot.current = null;
  }, [isOpen, contentRef]);

  useEffect(() => {
    if (!isOpen) { setDone(false); setStatus(''); return; }
    const applyList = (all, { keepSelection } = {}) => {
      setProfiles(all);
      setSelectedId((prev) => {
        if (keepSelection && prev && all.some((p) => p.id === prev)) return prev;
        const def = all.find((p) => p.isDefault) || all[0] || null;
        return def?.id ?? null;
      });
      if (!keepSelection) setMode(all.length ? 'branded' : 'direct');
    };
    applyList(getProfiles()); // instant render from cache
    refreshProfiles().then((all) => applyList(all, { keepSelection: true })); // server truth
    setDone(false);
    setStatus('');
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;
  const canDownload = mode === 'direct' || (mode === 'branded' && selectedProfile != null);

  const handleDownload = async () => {
    setLoading(true);
    setDone(false);
    const resolvedUserId = xUserId ?? getUserIdForDrafting();
    try {
      let el = contentRef?.current ?? contentSnapshot.current ?? null;
      if (!el && String(contentHtml ?? '').trim()) {
        const tmp = document.createElement('div');
        tmp.innerHTML = contentHtml;
        el = tmp;
      }
      if (mode === 'direct') {
        if (onDirect) {
          setStatus(isPdf ? 'Generating PDF…' : isWord ? 'Generating Word document…' : 'Generating file…');
          await onDirect();
        } else {
          if (!el) throw new Error('Content not found. Scroll to the response and try again.');
          if (isPdf) {
            setStatus('Generating PDF…');
            await downloadAsPdf(el, resolvedFilename);
          } else if (isWord) {
            setStatus('Generating Word document…');
            downloadAsWord(el, resolvedFilename);
          } else {
            setStatus('Generating HTML file…');
            downloadAsHtml(el, resolvedFilename);
          }
        }
      } else {
        if (!el && !String(contentHtml ?? '').trim()) {
          throw new Error('Content not found. Scroll to the response and try again.');
        }
        setStatus(isPdf ? 'Generating branded PDF…' : isWord ? 'Applying branding…' : 'Generating branded HTML…');
        const profile = normalizeBrandingProfile(selectedProfile);
        await downloadWithBranding({
          element: el ?? undefined,
          contentHtml: el ? undefined : (contentHtml ?? ''),
          filename: resolvedFilename,
          type: isPdf ? 'pdf' : isWord ? 'word' : 'html',
          module: mod,
          profile,
          profileId: selectedProfile.id,
          xUserId: resolvedUserId ?? undefined,
        });
      }
      setDone(true);
      setStatus('');
      setTimeout(onClose, 900);
    } catch (err) {
      console.error('[BrandingDownloadModal]', err);
      setStatus(err?.message || 'Download failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            {isPdf ? <Download className="w-4 h-4 text-teal-600 flex-shrink-0" /> : <FileText className="w-4 h-4 text-teal-600 flex-shrink-0" />}
            {isPdf ? 'Download as PDF' : isWord ? 'Download as Word' : 'Download as HTML'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer focus:outline-none">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">

          {/* ── Mode selector ── */}
          <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all select-none ${mode === 'direct' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
            <input
              type="radio" name="dlMode" value="direct"
              checked={mode === 'direct'}
              onChange={() => setMode('direct')}
              className="mt-0.5 accent-teal-600 flex-shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Quick Download</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {isPdf ? 'Plain PDF without firm letterhead or styling' : isWord ? 'Plain Word document without firm letterhead or styling' : 'Plain HTML file without firm letterhead or styling'}
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all select-none ${mode === 'branded' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
            <input
              type="radio" name="dlMode" value="branded"
              checked={mode === 'branded'}
              onChange={() => setMode('branded')}
              className="mt-0.5 accent-teal-600 flex-shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Download with Branding</p>
              <p className="text-xs text-gray-500 mt-0.5">Apply your firm's letterhead, logo &amp; style</p>
            </div>
          </label>

          {/* ── Profile picker (only when branded mode) ── */}
          {mode === 'branded' && (
            <div className="pt-1">
              {profiles.length === 0 ? (
                <div className="flex flex-col items-center py-5 border border-dashed border-gray-200 rounded-xl text-center">
                  <FileText className="w-7 h-7 text-gray-300 mb-2" />
                  <p className="text-xs text-gray-500 mb-3">No branding profiles saved yet.</p>
                  <button
                    onClick={() => { onClose(); navigate('/branding/new'); }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create your first profile
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Select profile:</p>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {profiles.map((p) => (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg border cursor-pointer transition-all select-none ${selectedId === p.id ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                      >
                        <input
                          type="radio" name="profileId" value={p.id}
                          checked={selectedId === p.id}
                          onChange={() => setSelectedId(p.id)}
                          className="accent-teal-600 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.name || 'Unnamed Profile'}</p>
                          {p.firmName && <p className="text-xs text-gray-500 truncate">{p.firmName}</p>}
                        </div>
                        {p.isDefault && (
                          <span className="text-[10px] font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full flex-shrink-0">
                            Default
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => { onClose(); navigate('/branding/new'); }}
                    className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium cursor-pointer ml-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add new profile
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Status */}
          {status && !done && (
            <p className="text-xs text-center text-gray-500 pt-1">{status}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer focus:outline-none disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            onClick={handleDownload}
            disabled={loading || !canDownload || done}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer focus:outline-none min-w-[130px] justify-center"
          >
            {done ? (
              <><CheckCircle className="w-3.5 h-3.5" /> Downloaded!</>
            ) : loading ? (
              <><span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />{status || 'Processing…'}</>
            ) : isPdf ? (
              <><Download className="w-3.5 h-3.5" /> Download PDF</>
            ) : isWord ? (
              <><FileText className="w-3.5 h-3.5" /> Download Word</>
            ) : (
              <><FileText className="w-3.5 h-3.5" /> Download HTML</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
