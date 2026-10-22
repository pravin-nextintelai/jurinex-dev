// DraftingModal — the "Drafting Mode" workflow launched from the chat input.
//
// Steps:
//   1. Upload a template  → backend analyzes layout asynchronously (polled)
//   2. Upload supporting documents (facts source; cached server-side if large)
//   3. Pick the Gemini model + optional instructions → Generate
//   4. DraftStreamingViewer renders the section-by-section SSE stream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileText, FileUp, Loader2,
  Play, Square, Trash2, X, Layers, BookOpen,
} from 'lucide-react';
import {
  createDraftingSession,
  uploadDraftTemplate,
  uploadSupportingDocuments,
  waitForTemplateAnalysis,
  streamDraftGeneration,
  retryTemplateAnalysis,
} from '../../api/draftingModeApi';
import DraftStreamParser, { MONOLITHIC_DOCUMENT_ID } from './draftStreamParser';
import DraftStreamingViewer from './DraftStreamingViewer';
import { notifyResponseComplete, ensureNotificationPermission } from '@/shared/utils/responseNotifier';

const MODEL_OPTIONS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', hint: 'LOWEST COST — fast frontier drafting ($0.50/M in, $3/M out) — default' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'Anthropic — excellent legal drafting ($3/M in, $15/M out; intro $2/$10 till Aug 2026)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Anthropic — fast, precise drafting ($3/M in, $15/M out)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'Anthropic flagship — deepest legal reasoning ($5/M in, $25/M out)' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', hint: 'Anthropic Opus previous gen ($5/M in, $25/M out)' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', hint: 'Anthropic Opus older gen ($5/M in, $25/M out)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', hint: 'SOTA reasoning — deepest drafts (₹ higher: $2–4/M in, $12–18/M out)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', hint: 'Latest Flash — near-Pro quality ($1.50/M in, $9/M out)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'High quality — complex legal drafts' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Fast and capable — good default' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', hint: 'Fastest — simple documents' },
];

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.tiff';
const MAX_TEMPLATE_MB = 20;
const MAX_DOC_MB = 50;
const MAX_DOCS = 50;

const fmtSize = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const DraftingModal = ({ open, onClose }) => {
  // Workflow state
  const [phase, setPhase] = useState('setup'); // setup | generating | finished
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);

  // Step 1 — template
  const [templateFile, setTemplateFile] = useState(null);
  const [analysisState, setAnalysisState] = useState('idle'); // idle | uploading | analyzing | ready | failed
  const [structure, setStructure] = useState(null);

  // Step 2 — supporting docs
  const [docs, setDocs] = useState([]); // {name,size} confirmed on server
  const [docsUploading, setDocsUploading] = useState(false);

  // Step 3 — generation settings
  const [model, setModel] = useState(MODEL_OPTIONS[0].id);
  const [draftingStrategy, setDraftingStrategy] = useState('sectionwise');
  const [instructions, setInstructions] = useState('');
  // Session fact memory: persisted server-side with inventory-level authority.
  const [confirmedFacts, setConfirmedFacts] = useState('');

  // Streaming state — text lives in refs; React state only tracks section metadata.
  const [sections, setSections] = useState([]);
  const [streamingSectionId, setStreamingSectionId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [savedToHistory, setSavedToHistory] = useState(false);
  // INR/USD cost breakdown streamed by the backend after all passes finish.
  const [draftCost, setDraftCost] = useState(null);
  const [showCostDetails, setShowCostDetails] = useState(false);
  // 4-stage pipeline review packet (missing/conflicting/unverified fields,
  // discrepancy report) — what the human reviewer reads before filing.
  const [reviewPacket, setReviewPacket] = useState(null);
  const [showReviewDetails, setShowReviewDetails] = useState(false);
  const [isMonolithicRun, setIsMonolithicRun] = useState(false);
  const [version, setVersion] = useState(0);
  const textStoreRef = useRef(new Map());
  const abortRef = useRef(null);

  const templateInputRef = useRef(null);
  const docsInputRef = useRef(null);

  // Reset everything when the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setPhase('setup'); setSessionId(null); setError(null);
    setTemplateFile(null); setAnalysisState('idle'); setStructure(null);
    setDocs([]); setDocsUploading(false);
    setSections([]); setStreamingSectionId(null); setProgress(null);
    setStatusMessage(''); setInstructions(''); setDraftingStrategy('sectionwise');
    setSavedToHistory(false); setDraftCost(null);
    setShowCostDetails(false); setConfirmedFacts(''); setIsMonolithicRun(false);
    setReviewPacket(null); setShowReviewDetails(false);
    textStoreRef.current = new Map();
    return () => abortRef.current?.abort();
  }, [open]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const res = await createDraftingSession(model);
    setSessionId(res.session_id);
    return res.session_id;
  }, [sessionId, model]);

  // ── Step 1: template upload + async analysis polling ────────────────────
  const runTemplateAnalysis = useCallback(async (sid) => {
    setAnalysisState('analyzing');
    const session = await waitForTemplateAnalysis(sid);
    setStructure(session.template_structure);
    setAnalysisState('ready');
  }, []);

  const handleTemplateSelected = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_TEMPLATE_MB * 1024 * 1024) {
      setError(`Template exceeds the ${MAX_TEMPLATE_MB} MB limit.`);
      return;
    }
    setTemplateFile(file);
    setStructure(null);
    setAnalysisState('uploading');
    try {
      const sid = await ensureSession();
      await uploadDraftTemplate(sid, file);
      await runTemplateAnalysis(sid);
    } catch (err) {
      setAnalysisState('failed');
      setError(err.message || 'Template analysis failed.');
    }
  }, [ensureSession, runTemplateAnalysis]);

  const handleTemplateRetry = useCallback(async () => {
    if (!sessionId || analysisState !== 'failed') return;
    setError(null);
    setAnalysisState('analyzing');
    try {
      await retryTemplateAnalysis(sessionId);
      await runTemplateAnalysis(sessionId);
    } catch (err) {
      setAnalysisState('failed');
      setError(err.message || 'Template analysis failed.');
    }
  }, [sessionId, analysisState, runTemplateAnalysis]);

  // ── Step 2: supporting docs ──────────────────────────────────────────────
  const handleDocsSelected = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (docs.length + files.length > MAX_DOCS) {
      setError(`At most ${MAX_DOCS} supporting documents per draft (${docs.length} already added).`);
      return;
    }
    const oversized = files.find((f) => f.size > MAX_DOC_MB * 1024 * 1024);
    if (oversized) {
      setError(`"${oversized.name}" exceeds the ${MAX_DOC_MB} MB per-document limit.`);
      return;
    }
    setError(null);
    setDocsUploading(true);
    try {
      const sid = await ensureSession();
      const res = await uploadSupportingDocuments(sid, files);
      setDocs((prev) => [...prev, ...(res.added || [])]);
    } catch (err) {
      setError(err.message || 'Supporting document upload failed.');
    } finally {
      setDocsUploading(false);
    }
  }, [ensureSession]);

  // ── Step 3/4: generation ─────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!sessionId || analysisState !== 'ready' || !structure) return;
    setError(null);
    setSavedToHistory(false);
    setDraftCost(null);
    setPhase('generating');
    const isMono = draftingStrategy === 'monolithic';
    setIsMonolithicRun(isMono);
    setReviewPacket(null);
    setShowReviewDetails(false);

    if (isMono) {
      // One streaming document — not per-section workers.
      const docSection = {
        sectionId: MONOLITHIC_DOCUMENT_ID,
        index: 0,
        heading: structure.document_title || 'Full draft',
        headingLevel: 1,
        headingFormat: structure.title_format,
        bodyFormat: { alignment: 'justify', font_size_pt: structure.base_font_size_pt || 12 },
        containsTable: false,
        headingVerbatim: false,
        status: 'streaming',
        error: null,
      };
      setSections([docSection]);
      textStoreRef.current = new Map([[MONOLITHIC_DOCUMENT_ID, '']]);
      setStreamingSectionId(MONOLITHIC_DOCUMENT_ID);
      setProgress(null);
      setStatusMessage('Drafting full document in one pass…');
    } else {
    // Seed section cards from the analyzed structure so the user sees the
    // full outline (with queued states) before the first token arrives.
    const seeded = (structure.sections || []).map((s) => ({
      sectionId: s.section_id,
      index: s.index,
      heading: s.heading,
      headingLevel: s.heading_level,
      // Typography captured from the template — drives the page view + .docx.
      headingFormat: s.heading_format,
      bodyFormat: s.body_format,
      containsTable: s.contains_table,
      // False = derived UI label (unlabeled template block) — never printed
      // into the document; only real template headings render.
      headingVerbatim: s.heading_verbatim !== false,
      status: 'pending',
      error: null,
    }));
    setSections(seeded);
    textStoreRef.current = new Map();
    setProgress({ completed: 0, total: seeded.length });
    setStatusMessage('Starting generation…');
    }

    const parser = new DraftStreamParser({
      onDraftStart: () => setIsMonolithicRun(true),
      onDocumentEnd: (evt) => {
        // Single-response mode: the whole draft stays ONE document — the
        // template drives its formatting inside the prompt; no section split.
        setStreamingSectionId(null);
        setSections((prev) => prev.map((s) => ({ ...s, status: 'done' })));
        setVersion((v) => v + 1);
        setStatusMessage(
          `Full document drafted (${(evt.chars || 0).toLocaleString()} chars) — finishing…`,
        );
      },
      onStatus: (evt) => setStatusMessage(evt.message || ''),
      onSectionStart: ({ sectionId }) => {
        setStreamingSectionId(sectionId);
        setSections((prev) => prev.map((s) =>
          s.sectionId === sectionId ? { ...s, status: 'streaming' } : s));
      },
      onSectionText: (sectionId, fullText) => {
        textStoreRef.current.set(sectionId, fullText);
      },
      onSectionEnd: ({ sectionId, completed, total }) => {
        setStreamingSectionId(null);
        setVersion((v) => v + 1); // freeze the finished card
        setSections((prev) => prev.map((s) =>
          s.sectionId === sectionId ? { ...s, status: 'done' } : s));
        if (typeof completed === 'number') setProgress({ completed, total });
      },
      onSectionError: (evt) => {
        setStreamingSectionId(null);
        setSections((prev) => prev.map((s) =>
          s.sectionId === evt.section_id ? { ...s, status: 'error', error: evt.message } : s));
      },
      onSectionReplace: (evt) => {
        // Expansion / grounding-repair rewrote a section: refresh its card.
        textStoreRef.current.set(evt.section_id, evt.text || '');
        setVersion((v) => v + 1);
      },
      onDocumentReplace: (evt) => {
        // Monolithic one-pass revision rewrote the whole document.
        textStoreRef.current.set(MONOLITHIC_DOCUMENT_ID, evt.text || '');
        setVersion((v) => v + 1);
      },
      onGroundingReport: (evt) => {
        const n = evt.violations?.length || 0;
        if (n > 0) setStatusMessage(`Zero-hallucination audit: fixing ${n} unsupported item(s)…`);
      },
      onCost: (evt) => {
        setDraftCost({
          ...evt,
          provisional: evt.provisional === true,
          final: evt.final === true,
        });
      },
      onScorecard: (evt) => {
        if (evt.checks_failed > 0) {
          setStatusMessage(`Quality scorecard: ${evt.checks_failed}/${evt.checks_run} checks flagged (see server log)`);
        }
      },
      onDiscrepancyReport: (evt) => {
        const n = evt.unsupportedCount || 0;
        if (n > 0) setStatusMessage(`Verification pass: ${n} statement(s) with no source support — see review packet.`);
      },
      onReviewPacket: (evt) => {
        setReviewPacket(evt);
      },
      onChatSaved: () => {
        // Backend also stored the compiled draft as a chat-history turn.
        setSavedToHistory(true);
      },
      onDone: (evt) => {
        setPhase('finished');
        notifyResponseComplete({ title: 'Draft ready', body: 'JuriNex has finished generating your draft.' });
        setDraftCost((prev) => (prev ? { ...prev, provisional: false, final: true } : prev));
        setStatusMessage(
          isMono || evt.drafting_strategy === 'monolithic'
            ? (evt.status === 'completed'
              ? 'Draft complete — full document ready.'
              : 'Draft finished with issues — see document view.')
            : (evt.status === 'completed'
              ? `Draft complete — ${evt.sections_completed}/${evt.sections_total} sections.`
              : `Finished with issues — ${evt.sections_completed}/${evt.sections_total} sections succeeded.`),
        );
      },
      onError: (evt) => setError(evt.message || 'Generation error.'),
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      ensureNotificationPermission();
      await streamDraftGeneration(
        sessionId,
        {
          llmName: model,
          draftingStrategy,
          userInstructions: instructions.trim() || undefined,
          confirmedFacts: confirmedFacts.trim() || undefined,
        },
        (evt) => parser.handleEvent(evt),
        controller.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Draft stream failed.');
    } finally {
      setStreamingSectionId(null);
      setVersion((v) => v + 1);
      setPhase('finished');
    }
  }, [sessionId, analysisState, structure, model, draftingStrategy, instructions, confirmedFacts]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose?.();
  }, [onClose]);

  if (!open) return null;

  const canGenerate = analysisState === 'ready' && !!structure && phase === 'setup';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ height: phase === 'setup' ? 'auto' : '86vh', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#f0fdfa] flex items-center justify-center">
            <Layers className="h-4 w-4 text-[#21C1B6]" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-gray-800">Drafting Mode</h2>
            <p className="text-[11px] text-gray-500">Template-driven, fact-grounded document drafting</p>
          </div>
          {phase === 'generating' && !draftCost?.final && (
            <button type="button" onClick={handleStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100">
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button type="button" onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 flex-shrink-0">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {phase === 'setup' ? (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            {/* ── Step 1: Template ── */}
            <div>
              <p className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#21C1B6]" /> 1 · Template document
              </p>
              <input ref={templateInputRef} type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => { handleTemplateSelected(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button"
                onClick={() => {
                  if (analysisState === 'failed' && sessionId) {
                    handleTemplateRetry();
                  } else {
                    templateInputRef.current?.click();
                  }
                }}
                disabled={analysisState === 'uploading' || analysisState === 'analyzing'}
                className={`w-full rounded-xl border-2 border-dashed px-4 py-4 text-left transition-colors ${
                  analysisState === 'ready' ? 'border-green-200 bg-green-50/50' : 'border-gray-200 hover:border-[#21C1B6] hover:bg-[#f0fdfa]/40'
                }`}>
                {!templateFile ? (
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    <FileUp className="h-4 w-4" /> Upload the template (PDF, DOCX, TXT — max {MAX_TEMPLATE_MB} MB)
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs">
                    {(analysisState === 'uploading' || analysisState === 'analyzing') && (
                      <Loader2 className="h-4 w-4 text-[#21C1B6] animate-spin flex-shrink-0" />
                    )}
                    {analysisState === 'ready' && <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
                    {analysisState === 'failed' && <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                    <span className="font-semibold text-gray-800 truncate">{templateFile.name}</span>
                    <span className="text-gray-400 flex-shrink-0">{fmtSize(templateFile.size)}</span>
                    <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">
                      {analysisState === 'uploading' && 'Uploading…'}
                      {analysisState === 'analyzing' && 'Analyzing layout & placeholders…'}
                      {analysisState === 'ready' && `${structure?.sections?.length || 0} sections detected`}
                      {analysisState === 'failed' && 'Analysis failed — click to retry'}
                    </span>
                  </span>
                )}
              </button>
              {analysisState === 'ready' && structure && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-700">
                    {structure.document_title} <span className="text-gray-400 font-normal">· {structure.document_type}</span>
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                    {(structure.sections || []).slice(0, 8).map((s) => s.heading).join(' · ')}
                    {(structure.sections || []).length > 8 ? ' · …' : ''}
                  </p>
                </div>
              )}
            </div>

            {/* ── Step 2: Supporting documents ── */}
            <div>
              <p className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-[#21C1B6]" /> 2 · Supporting documents
                <span className="font-normal text-gray-400">(facts source — optional but recommended)</span>
              </p>
              <input ref={docsInputRef} type="file" accept={ACCEPT} multiple className="hidden"
                onChange={(e) => { handleDocsSelected(e.target.files); e.target.value = ''; }} />
              <button type="button" onClick={() => docsInputRef.current?.click()} disabled={docsUploading}
                className="w-full rounded-xl border-2 border-dashed border-gray-200 hover:border-[#21C1B6] hover:bg-[#f0fdfa]/40 px-4 py-3 text-left">
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {docsUploading ? <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" /> : <FileUp className="h-4 w-4" />}
                  {docsUploading
                    ? 'Uploading…'
                    : `Add case files, agreements, evidence… (up to ${MAX_DOCS} documents, ${MAX_DOC_MB} MB each)`}
                </span>
              </button>
              {docs.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {docs.map((d) => (
                    <li key={d.doc_id} className="flex items-center gap-2 text-[11px] text-gray-600 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
                      <FileText className="h-3 w-3 text-gray-400 flex-shrink-0" />
                      <span className="truncate flex-1">{d.name}</span>
                      <span className="text-gray-400 flex-shrink-0">{fmtSize(d.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {docs.length === 0 && (
                <p className="mt-1.5 text-[10px] text-amber-600">
                  Without supporting documents, placeholders stay as template blanks (____) — nothing is invented.
                </p>
              )}
            </div>

            {/* ── Step 3: Engine + instructions ── */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-gray-700 mb-1.5">3 · Drafting method</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    draftingStrategy === 'monolithic'
                      ? 'border-[#21C1B6] bg-[#f0fffe]'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <span className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <input
                        type="radio"
                        name="draftingStrategy"
                        value="monolithic"
                        checked={draftingStrategy === 'monolithic'}
                        onChange={() => setDraftingStrategy('monolithic')}
                        className="accent-[#21C1B6]"
                      />
                      Monolithic (one-shot)
                    </span>
                    <span className="text-[10px] text-gray-500 pl-5">
                      Faster, single-pass draft. Best for shorter documents.
                    </span>
                  </label>
                  <label className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    draftingStrategy === 'sectionwise'
                      ? 'border-[#21C1B6] bg-[#f0fffe]'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <span className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <input
                        type="radio"
                        name="draftingStrategy"
                        value="sectionwise"
                        checked={draftingStrategy === 'sectionwise'}
                        onChange={() => setDraftingStrategy('sectionwise')}
                        className="accent-[#21C1B6]"
                      />
                      Section-wise
                    </span>
                    <span className="text-[10px] text-gray-500 pl-5">
                      Drafts each section separately for better accuracy on long or complex documents.
                    </span>
                  </label>
                </div>
              </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold text-gray-700 mb-1.5">Model</p>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none focus:border-[#21C1B6]">
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">
                  {MODEL_OPTIONS.find((m) => m.id === model)?.hint}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-700 mb-1.5">
                  Draft focus <span className="font-normal text-gray-400">(what this draft should emphasize)</span>
                </p>
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  placeholder={"e.g. Commercial suit for recovery of money only — not damages/injunction.\nPlaintiff = Nexora; Defendant = Aarav. Stress unpaid invoices and 18% interest.\nDo not infer nature of business."}
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-[#21C1B6] resize-none" />
                <p className="mt-1 text-[10px] text-gray-400">
                  The system follows the template structure and source documents, and prioritizes what you type here (relief, parties, emphasis).
                </p>
                <p className="text-xs font-bold text-gray-700 mt-2 mb-1">Confirmed facts <span className="font-normal text-gray-400">(remembered for this matter)</span></p>
                <textarea value={confirmedFacts} onChange={(e) => setConfirmedFacts(e.target.value)}
                  rows={2} placeholder="e.g. Defendant's business is NOT stated — do not infer it"
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-[#21C1B6] resize-none" />
              </div>
              </div>
            </div>

            {/* Generate */}
            <div className="flex justify-end pt-1 pb-1">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  canGenerate ? 'bg-[#21C1B6] text-white hover:bg-[#1aa89e]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                <Play className="h-4 w-4" /> Generate Draft
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <DraftStreamingViewer
              sections={sections}
              streamingSectionId={streamingSectionId}
              textStoreRef={textStoreRef}
              version={version}
              documentTitle={structure?.document_title}
              progress={progress}
              statusMessage={statusMessage}
              finished={phase === 'finished'}
              structure={structure}
              isMonolithic={isMonolithicRun}
            />
            {reviewPacket && (() => {
              const f = reviewPacket.fields || {};
              const s = f.summary || {};
              const unsupported = (reviewPacket.discrepancies || [])
                .filter((d) => d.verdict === 'NO_SOURCE_SUPPORT_FOUND');
              const provenance = reviewPacket.provenance || [];
              const ocrDocs = reviewPacket.ingestion?.ocrDerivedDocs || [];
              const issueCount =
                (s.missing || 0) + (s.conflicts || 0) + (s.unverified || 0) +
                unsupported.length + provenance.length +
                (f.extractionError ? 1 : 0) + (reviewPacket.verificationError ? 1 : 0);
              const clean = issueCount === 0;
              return (
                <div className={`px-5 py-2 border-t flex-shrink-0 ${
                  clean ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'
                }`}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <span className={`font-bold text-xs ${clean ? 'text-green-800' : 'text-amber-800'}`}>
                      {clean
                        ? 'Review packet: all checks clear — facts verified against source.'
                        : `Review packet — ${issueCount} item(s) to confirm before filing`}
                    </span>
                    <span className="text-gray-600">
                      Fields: {s.verified ?? 0} verified · {s.missing ?? 0} missing ·{' '}
                      {s.conflicts ?? 0} conflict{(s.conflicts ?? 0) === 1 ? '' : 's'} ·{' '}
                      {s.unverified ?? 0} unverified
                    </span>
                    {unsupported.length > 0 && (
                      <span className="font-semibold text-red-700">
                        {unsupported.length} draft statement(s) without source support
                      </span>
                    )}
                    {ocrDocs.length > 0 && (
                      <span className="text-gray-500">OCR-derived: {ocrDocs.join(', ')}</span>
                    )}
                    {reviewPacket.runId && (
                      <span className="text-gray-400">run {reviewPacket.runId}</span>
                    )}
                    {!clean && (
                      <button type="button"
                        onClick={() => setShowReviewDetails((v) => !v)}
                        className="ml-auto px-2 py-0.5 rounded-lg border border-amber-400 text-amber-800 font-semibold hover:bg-amber-100">
                        {showReviewDetails ? 'Hide review items' : 'Review items'}
                      </button>
                    )}
                  </div>
                  {showReviewDetails && !clean && (
                    <div className="mt-2 border-t border-amber-100 pt-2 max-h-56 overflow-y-auto space-y-2 text-[11px] text-gray-700">
                      {f.extractionError && (
                        <p className="text-red-700 font-semibold">
                          Grounded extraction failed: {f.extractionError} (draft used the fact inventory only)
                        </p>
                      )}
                      {reviewPacket.verificationError && (
                        <p className="text-red-700 font-semibold">
                          Verification pass failed: {reviewPacket.verificationError}
                        </p>
                      )}
                      {(f.missing || []).length > 0 && (
                        <div>
                          <p className="font-bold text-gray-600 mb-0.5">Missing fields (not in any source — left blank in the draft)</p>
                          <p>{f.missing.map((m) => m.field).join(', ')}</p>
                        </div>
                      )}
                      {(f.conflicts || []).length > 0 && (
                        <div>
                          <p className="font-bold text-gray-600 mb-0.5">Conflicting sources (resolve before filing)</p>
                          {f.conflicts.map((c, i) => (
                            <p key={i}>
                              <span className="font-semibold">{c.field}</span>: “{c.value}” ({c.source})
                              {' '}vs “{c.conflictingValue}” ({c.conflictingSource})
                            </p>
                          ))}
                        </div>
                      )}
                      {(f.unverifiedCitations || []).length > 0 && (
                        <div>
                          <p className="font-bold text-gray-600 mb-0.5">Unverified citations (value withheld from the draft unless the inventory confirms it)</p>
                          {f.unverifiedCitations.map((u, i) => (
                            <p key={i}>
                              <span className="font-semibold">{u.field}</span>: “{u.value}” — {u.source || 'source unknown'}
                              {u.flag === 'unverifiable_ocr' ? ' (OCR document — cannot be machine-checked)' : ''}
                            </p>
                          ))}
                        </div>
                      )}
                      {unsupported.length > 0 && (
                        <div>
                          <p className="font-bold text-red-700 mb-0.5">Discrepancy report — NO SOURCE SUPPORT FOUND (draft not auto-modified)</p>
                          {unsupported.map((d, i) => (
                            <p key={i}>“{d.draft_quote}”{d.note ? ` — ${d.note}` : ''}</p>
                          ))}
                        </div>
                      )}
                      {provenance.length > 0 && (
                        <div>
                          <p className="font-bold text-gray-600 mb-0.5">Inventory provenance flags</p>
                          {provenance.map((p, i) => (
                            <p key={i}>“{p.value || p.label}” — {p.reason}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {draftCost?.inr && (
              <div className="px-5 py-2 border-t border-gray-100 bg-[#f8fffe] flex-shrink-0">
                {(draftCost.templateCost || draftCost.draftOnlyCost) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-600 mb-1 pb-1 border-b border-gray-100">
                    <span>
                      Template cost: <span className="font-semibold text-gray-700">₹{(draftCost.templateCost?.inr ?? 0).toFixed(2)}</span>
                      <span className="text-gray-400"> ({draftCost.templateCost?.calls ?? 0} call{draftCost.templateCost?.calls === 1 ? '' : 's'} — one-time, reused on every regenerate)</span>
                    </span>
                    <span>
                      Draft cost: <span className="font-semibold text-gray-700">₹{(draftCost.draftOnlyCost?.inr ?? 0).toFixed(2)}</span>
                      <span className="text-gray-400"> ({draftCost.draftOnlyCost?.calls ?? 0} call{draftCost.draftOnlyCost?.calls === 1 ? '' : 's'} — this generation)</span>
                    </span>
                    <span className="font-bold text-gray-800">
                      Total: ₹{(draftCost.grandTotal?.inr ?? draftCost.inr.total)?.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
                  <span className="font-bold text-gray-800 text-xs">
                    Draft cost: ₹{draftCost.inr.total?.toFixed(2)}
                    {draftCost.provisional && !draftCost.final && (
                      <span className="font-normal text-amber-600"> (so far — audit running…)</span>
                    )}
                    {draftCost.final && (
                      <span className="font-normal text-green-700"> (final)</span>
                    )}
                    <span className="font-normal text-gray-400"> (${draftCost.usd?.total?.toFixed(4)} @ ₹{draftCost.usdToInr}/$)</span>
                  </span>
                  <span>Input ₹{draftCost.inr.input?.toFixed(2)} <span className="text-gray-400">({(draftCost.tokens?.newInput ?? 0).toLocaleString()} tok)</span></span>
                  <span>Output ₹{draftCost.inr.output?.toFixed(2)} <span className="text-gray-400">({(draftCost.tokens?.output ?? 0).toLocaleString()} tok)</span></span>
                  <span>Cache read ₹{draftCost.inr.cacheRead?.toFixed(2)} <span className="text-gray-400">({(draftCost.tokens?.cached ?? 0).toLocaleString()} tok)</span></span>
                  <span>Cache storage ₹{draftCost.inr.cacheStorage?.toFixed(2)}
                    <span className="text-gray-400">
                      {draftCost.final
                        ? ` (${draftCost.cacheLifespanMinutes ?? '—'} min run)`
                        : ` (est. ${draftCost.cacheLifespanMinutes ?? '—'} min incl. TTL)`}
                    </span>
                  </span>
                  {(draftCost.inr.cacheSetup ?? 0) > 0 && (
                    <span>Cache setup ₹{draftCost.inr.cacheSetup?.toFixed(2)}</span>
                  )}
                  {(draftCost.inr.savings ?? 0) > 0 && (
                    <span className="font-semibold text-green-600">
                      Saved ₹{draftCost.inr.savings?.toFixed(2)} via caching
                    </span>
                  )}
                  <span className="text-gray-400">Model: {draftCost.model}</span>
                  {(draftCost.calls?.length ?? 0) > 0 && (
                    <button type="button"
                      onClick={() => setShowCostDetails((s) => !s)}
                      className="ml-auto px-2 py-0.5 rounded-lg border border-[#21C1B6] text-[#11766f] font-semibold hover:bg-[#E0F7F6]">
                      {showCostDetails ? 'Hide details' : 'Cost details'}
                    </button>
                  )}
                </div>
                {showCostDetails && draftCost.byStage && (
                  <div className="mt-2 border-t border-gray-100 pt-2 max-h-56 overflow-y-auto">
                    {/* Per-stage: where input/output tokens are consumed */}
                    <table className="w-full text-[10px] text-gray-600 mb-2">
                      <thead>
                        <tr className="text-left text-gray-400">
                          <th className="py-0.5 pr-2 font-semibold">Stage (agent)</th>
                          <th className="text-right pr-2">Calls</th>
                          <th className="text-right pr-2">Input tok</th>
                          <th className="text-right pr-2">Output tok</th>
                          <th className="text-right pr-2">Cached tok</th>
                          <th className="text-right">₹</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(draftCost.byStage).map(([stage, a]) => (
                          <tr key={stage} className="border-t border-gray-50">
                            <td className="py-0.5 pr-2 font-semibold text-gray-700 capitalize">{stage.replace('_', ' ')}</td>
                            <td className="text-right pr-2">{a.calls}</td>
                            <td className="text-right pr-2">{a.input.toLocaleString()}</td>
                            <td className="text-right pr-2">{a.output.toLocaleString()}</td>
                            <td className="text-right pr-2">{a.cached.toLocaleString()}</td>
                            <td className="text-right font-semibold">₹{a.inr.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Every individual API call */}
                    <p className="text-[10px] font-bold text-gray-500 mb-1">Every API call ({draftCost.calls.length})</p>
                    <div className="space-y-0.5">
                      {draftCost.calls.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span className="w-20 flex-shrink-0 capitalize text-gray-400">{c.stage.replace('_', ' ')}</span>
                          <span className="flex-1 truncate text-gray-600">{c.label}</span>
                          <span className="flex-shrink-0 text-gray-400">{c.model.replace('gemini-', '')}</span>
                          <span className="flex-shrink-0">in {c.input.toLocaleString()}</span>
                          <span className="flex-shrink-0">out {c.output.toLocaleString()}</span>
                          {c.cached > 0 && <span className="flex-shrink-0 text-teal-600">cache {c.cached.toLocaleString()}</span>}
                          <span className="flex-shrink-0 font-semibold text-gray-700 w-14 text-right">₹{c.inr.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {phase === 'finished' && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-white flex-shrink-0">
                <button type="button"
                  onClick={() => { setPhase('setup'); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
                  <Trash2 className="h-3.5 w-3.5" /> New draft settings
                </button>
                {savedToHistory && (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved to chat history
                  </span>
                )}
                <button type="button" onClick={handleClose}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gray-800 hover:bg-gray-700">
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftingModal;
