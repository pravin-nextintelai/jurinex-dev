import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Search, Wand2, Sparkles, Loader2, Check, Pencil, Eye, Power,
  ChevronDown, ChevronUp, RefreshCw, MessageSquare, History, X,
} from 'lucide-react';
import { toast } from 'react-toastify';
import documentApi from '../../services/documentApi';
import {
  fetchPersonalizationStatus,
  fetchPersonalizationPrompts,
  generatePersonalInstruction,
  polishPersonalInstruction,
  activatePersonalInstruction,
  deactivatePersonalInstruction,
} from '../../services/personalizationService';
import { fmtDate, parseInstructionBlocks, toPlainInstruction } from './personalizationUtils';
import MemoryPanel from './MemoryPanel';
import '../../styles/CustomPromptBuilder.css';
import '../../styles/Personalization.css';

/**
 * Personalization sections — the stacked "project sidebar" block:
 *
 *   Instructions  User-written or generated rules. "Add to system" makes the
 *                 ACTIVE instruction the document chat always appends.
 *   Memory        Shown only when Memory is on. Topic notes + complete session
 *                 history. The ON/OFF switch is NOT here — Memory is one switch in
 *                 profile Settings → Memory (SettingsPage.jsx), which drives filing
 *                 and past-chat search together.
 *   Context       (optional) prompts that feed the instruction generator. On the
 *                 case page the Files card below plays this role.
 *
 * Used inline in the case page's right column (FolderDetailPage, ~330px wide —
 * everything here must wrap gracefully) and inside the composer drawer
 * (PersonalizationModal).
 */

const ORIGIN_LABEL = { generated: 'Generated', manual: 'Manual', polished: 'Polished' };

// Behaviour analysis (from the generator): the six core reads, then lists.
const BEHAVIOUR_ASPECTS = [
  ['tone', 'Tone you expect'],
  ['response_shape', 'Shape of a good answer'],
  ['depth_and_length', 'Depth & length'],
  ['language', 'Language'],
  ['expertise_level', 'Your expertise'],
  ['communication_style', 'How you ask'],
];

const EDITOR_PLACEHOLDER =
  'Write how you want answers, in your own words. For example:\n'
  + '- Always give dates and parties as a table\n'
  + '- Keep answers short unless I ask for detail\n'
  + '- Cite the section and the page number\n'
  + '- Reply in Hindi when I write in Hindi\n\n'
  + 'Or click Generate and edit the result.';

/** Structured plain-text instruction (section titles + hyphen bullets). */
const InstructionBody = ({ text }) => {
  const blocks = parseInstructionBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        if (b.type === 'title') {
          return (
            <div key={i} className="text-[13.5px] font-semibold text-slate-900 leading-snug">
              {b.text}
            </div>
          );
        }
        if (b.type === 'h') {
          return (
            <div
              key={i}
              className="text-[11px] font-semibold uppercase tracking-wide text-[#127a72] pt-1 first:pt-0"
            >
              {b.text}
            </div>
          );
        }
        if (b.type === 'snapshot') {
          return (
            <p key={i} className="text-slate-700 leading-relaxed">
              <span className="font-medium text-slate-800">User snapshot: </span>
              {b.text}
            </p>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="space-y-1 pl-0">
              {b.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 leading-relaxed">
                  <span className="mt-[7px] h-1 w-1 rounded-full bg-slate-400 flex-shrink-0" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-slate-700 leading-relaxed whitespace-pre-wrap">
            {b.text}
          </p>
        );
      })}
    </div>
  );
};

const SectionHeader = ({ title, subtitle, children }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{title}</h3>
      {subtitle && <p className="text-[12px] text-slate-500 mt-1 leading-snug">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-1 flex-shrink-0">{children}</div>}
  </div>
);

export const IconButton = ({ title, onClick, disabled = false, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    disabled={disabled}
    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
  >
    {children}
  </button>
);

const OriginBadge = ({ origin }) => (
  <span className="inline-flex items-center rounded-full bg-[#E0F7F6] text-[#127a72] px-2 py-0.5 text-[10.5px] font-semibold">
    {ORIGIN_LABEL[origin] || 'Manual'}
  </span>
);

const ConfidenceBar = ({ value }) => {
  const pct = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100);
  return (
    <span className="inline-flex items-center gap-1.5 flex-shrink-0" title={`Confidence ${pct}%`}>
      <span className="h-1.5 w-12 rounded-full bg-slate-200 overflow-hidden">
        <span className="block h-full rounded-full bg-[#21C1B6]" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10.5px] tabular-nums text-slate-500 w-7 text-right">{pct}%</span>
    </span>
  );
};

/** "What we noticed about you" — the generator's behaviour analysis, with evidence. */
const BehaviourPanel = ({ analysis, compact = false }) => {
  if (!analysis) return null;
  const core = BEHAVIOUR_ASPECTS
    .map(([key, label]) => [key, label, analysis[key]])
    .filter(([, , v]) => v && v.finding);
  const priorities = Array.isArray(analysis.priorities) ? analysis.priorities.filter((p) => p?.finding) : [];
  const dislikes = Array.isArray(analysis.dislikes) ? analysis.dislikes.filter((p) => p?.finding) : [];
  if (!core.length && !priorities.length && !dislikes.length && !analysis.summary) return null;
  return (
    <div className={`space-y-2.5 ${compact ? 'text-[12px]' : 'text-[12.5px]'}`}>
      {analysis.summary && (
        <p className="text-slate-700 leading-relaxed">{analysis.summary}</p>
      )}
      {core.length > 0 && (
        <ul className="space-y-1.5">
          {core.map(([key, label, v]) => (
            <li key={key} className="rounded-lg bg-white border border-slate-200 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</span>
                <ConfidenceBar value={v.confidence} />
              </div>
              <div className="text-slate-800 mt-0.5 leading-snug">{v.finding}</div>
              {v.evidence?.length > 0 && (
                <div className="text-[11px] text-slate-400 mt-0.5 truncate" title={v.evidence.join(' · ')}>
                  e.g. &ldquo;{v.evidence[0]}&rdquo;
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {priorities.length > 0 && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-slate-500 mb-1">What you insist on</div>
          <div className="flex flex-wrap gap-1">
            {priorities.map((p, i) => (
              <span
                key={`p-${i}`}
                title={p.evidence?.length ? `e.g. "${p.evidence[0]}"` : undefined}
                className="inline-flex items-center rounded-full bg-[#E0F7F6] text-[#127a72] px-2 py-0.5 text-[11px] font-medium"
              >
                {p.finding}
              </span>
            ))}
          </div>
        </div>
      )}
      {dislikes.length > 0 && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-slate-500 mb-1">What you dislike</div>
          <ul className="space-y-0.5">
            {dislikes.map((d, i) => (
              <li key={`d-${i}`} className="flex items-start gap-1.5 text-slate-700">
                <X className="h-3 w-3 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="min-w-0">
                  {d.finding}
                  {d.evidence?.length > 0 && (
                    <span className="text-[11px] text-slate-400"> — &ldquo;{d.evidence[0]}&rdquo;</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const SourcePill = ({ active, onClick, disabled, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
      active
        ? 'bg-[#E0F7F6] text-[#127a72] border-[#21C1B6]/50'
        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-800'
    }`}
  >
    {children}
  </button>
);

const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const tealGhostBtn = `${ghostBtn} text-[#127a72] hover:text-[#127a72] hover:bg-[#E0F7F6]`;
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-[#21C1B6] hover:bg-[#1aa89e] text-white px-3.5 py-1.5 text-[12px] font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors';
const outlineBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:border-[#21C1B6] hover:text-[#127a72] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

/** Normalise a /{folder}/chats row (same DB-backed list the chat history uses). */
const toPastSession = (s) => ({
  id: s?.session_id || s?.sessionId || s?.id || null,
  title: String(s?.title || s?.question || s?.prompt_label || '').trim() || 'Untitled chat',
  updatedAt: s?.updated_at || s?.updatedAt || s?.created_at || s?.createdAt || null,
  promptCount: [s?.chat_count, s?.message_count, s?.messageCount, s?.count]
    .map((v) => (v == null ? null : Number(v)))
    .find((v) => v != null && !Number.isNaN(v)) ?? null,
});

const PersonalizationSections = ({
  sessionId = null,
  folderName = null,
  showContext = true,
  compact = false,
  onStatusChange = null,
  className = '',
}) => {
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState(null);

  // Instructions editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [editorOrigin, setEditorOrigin] = useState('manual');
  const [editorPreview, setEditorPreview] = useState(false);
  const [editingActive, setEditingActive] = useState(false);
  const [working, setWorking] = useState(null); // 'generate' | 'polish' | 'save' | 'off' | 'rebuild' | 'import' | null
  const [showActive, setShowActive] = useState(false);
  const [showActiveBehaviour, setShowActiveBehaviour] = useState(false);
  // The generator's behaviour analysis for the draft on screen ("what we noticed").
  const [editorBehaviour, setEditorBehaviour] = useState(null);
  const [showBehaviour, setShowBehaviour] = useState(true);
  const textareaRef = useRef(null);

  // What the generator learns from: 'case' (this case's prompts — every case is
  // kept separate), 'session' (this chat), 'chat' (one older chat picked from the
  // list), or 'history' (prompts across all cases).
  const defaultSource = folderName ? 'case' : sessionId ? 'session' : 'history';
  const [source, setSource] = useState(defaultSource);
  // Where the saved instruction applies: this case only, or all the user's cases.
  const [applyScope, setApplyScope] = useState(folderName ? 'case' : 'global');
  const [pickedSession, setPickedSession] = useState(null); // { id, title } | null
  const [pastOpen, setPastOpen] = useState(false);
  const [pastSessions, setPastSessions] = useState([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastQuery, setPastQuery] = useState('');

  // Context
  const [prompts, setPrompts] = useState([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [promptQuery, setPromptQuery] = useState('');

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await fetchPersonalizationStatus(folderName);
      setStatus(s);
      setError(null);
      onStatusChange?.(s);
      return s;
    } catch (err) {
      setError(err?.message || 'Could not load personalization status.');
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, [onStatusChange, folderName]);

  const loadPrompts = useCallback(async () => {
    if (!showContext) return;
    setPromptsLoading(true);
    try {
      const rows = await fetchPersonalizationPrompts(sessionId, 40, folderName);
      setPrompts(Array.isArray(rows) ? rows : []);
    } catch {
      setPrompts([]);
    } finally {
      setPromptsLoading(false);
    }
  }, [sessionId, folderName, showContext]);

  useEffect(() => {
    loadStatus();
    loadPrompts();
    setSource(defaultSource);
    setApplyScope(folderName ? 'case' : 'global');
    setPickedSession(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, folderName]);

  // Auto-grow the editor between 140px and 320px.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || editorPreview) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(320, Math.max(140, el.scrollHeight))}px`;
  }, [editorText, editorOpen, editorPreview]);

  // Older chats of this case — the same DB-backed list the chat history shows.
  const loadPastSessions = useCallback(async () => {
    if (!folderName) return;
    setPastLoading(true);
    try {
      const data = await documentApi.getFolderChats(folderName);
      const raw = Array.isArray(data?.chats) ? data.chats : Array.isArray(data) ? data : [];
      const list = raw
        .map(toPastSession)
        .filter((s) => s.id && s.id !== sessionId)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      setPastSessions(list);
    } catch (err) {
      setError(err?.message || 'Could not load past chats.');
      setPastSessions([]);
    } finally {
      setPastLoading(false);
    }
  }, [folderName, sessionId]);

  const filteredPastSessions = useMemo(() => {
    const q = pastQuery.trim().toLowerCase();
    if (!q) return pastSessions;
    return pastSessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [pastSessions, pastQuery]);

  const handleGenerate = useCallback(async (overrides = {}) => {
    const src = overrides.source || source;
    const picked = overrides.picked !== undefined ? overrides.picked : pickedSession;
    let request;
    if (src === 'session' && sessionId) {
      request = [sessionId, { scope: 'session' }];
    } else if (src === 'chat' && picked?.id) {
      request = [picked.id, { scope: 'session' }];
    } else if (src === 'case' && folderName) {
      // This case only: its old chats → prompt log → this case's prompts → instruction.
      request = [null, { scope: 'history', importHistory: true, folderName }];
    } else {
      // All cases: same flow across the user's whole prompt history.
      request = [null, { scope: 'history', importHistory: true }];
    }
    setWorking('generate');
    setError(null);
    try {
      const res = await generatePersonalInstruction(...request);
      setEditorText(toPlainInstruction(res?.instruction_text || ''));
      setEditorOrigin('generated');
      setEditorPreview(true);
      setEditorBehaviour(res?.behaviour_analysis && typeof res.behaviour_analysis === 'object' ? res.behaviour_analysis : null);
      setShowBehaviour(true);
      if (res?.imported_prompts > 0) {
        toast.info(`${res.imported_prompts} prompt${res.imported_prompts === 1 ? '' : 's'} from your past chats added to the prompt log.`);
        loadStatus();
      }
    } catch (err) {
      setError(err?.message || 'Instruction generation failed.');
    } finally {
      setWorking(null);
    }
  }, [source, pickedSession, sessionId, folderName, loadStatus]);

  const openEditor = useCallback((text = '', origin = 'manual', isEditingActive = false, { autoGenerate = false, behaviour = null } = {}) => {
    setEditorText(text);
    setEditorOrigin(origin);
    setEditingActive(isEditingActive);
    setEditorPreview(false);
    setEditorOpen(true);
    setPastOpen(false);
    setEditorBehaviour(behaviour);
    setShowBehaviour(Boolean(behaviour));
    setError(null);
    if (autoGenerate) {
      const src = folderName ? 'case' : 'history';
      setSource(src);
      setPickedSession(null);
      handleGenerate({ source: src, picked: null });
    } else {
      setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [handleGenerate, folderName]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorText('');
    setEditorOrigin('manual');
    setEditingActive(false);
    setEditorPreview(false);
    setEditorBehaviour(null);
    setPastOpen(false);
    setPickedSession(null);
    setSource(defaultSource);
    setApplyScope(folderName ? 'case' : 'global');
  }, [defaultSource, folderName]);

  const chooseSource = useCallback((next) => {
    setSource(next);
    if (next !== 'chat') {
      setPickedSession(null);
      setPastOpen(false);
    }
  }, []);

  const togglePastPicker = useCallback(() => {
    const next = !pastOpen;
    setPastOpen(next);
    setPastQuery('');
    if (next) loadPastSessions();
  }, [pastOpen, loadPastSessions]);

  const handlePickPastSession = useCallback((s) => {
    const picked = { id: s.id, title: s.title };
    setPickedSession(picked);
    setSource('chat');
    setPastOpen(false);
    handleGenerate({ source: 'chat', picked });
  }, [handleGenerate]);

  const handlePolish = useCallback(async () => {
    const draft = editorText.trim();
    if (!draft) return;
    setWorking('polish');
    setError(null);
    try {
      const res = await polishPersonalInstruction(draft);
      setEditorText(toPlainInstruction(res?.instruction_text || ''));
      setEditorOrigin('polished');
      setEditorPreview(true);
    } catch (err) {
      setError(err?.message || 'Polishing failed.');
    } finally {
      setWorking(null);
    }
  }, [editorText]);

  const sourceSessionId = source === 'chat' ? (pickedSession?.id || null) : source === 'session' ? (sessionId || null) : null;

  const handleSave = useCallback(async (mode) => {
    const text = toPlainInstruction(editorText);
    if (!text) {
      setError('The instruction is empty.');
      return;
    }
    setWorking('save');
    setError(null);
    try {
      await activatePersonalInstruction({
        instructionText: text,
        mode,
        origin: editorOrigin,
        sourceProfileVersion: status?.profile?.version ?? 0,
        sourceSessionId,
        behaviourAnalysis: editorBehaviour,
        folderName: applyScope === 'case' ? folderName : null,
      });
      toast.success(
        mode === 'append'
          ? 'Appended to your active instruction.'
          : applyScope === 'case' && folderName
            ? 'Instruction added for this case.'
            : 'Instruction added for all your cases.',
      );
      closeEditor();
      setShowActive(false);
      setShowActiveBehaviour(false);
      await loadStatus();
    } catch (err) {
      setError(err?.message || 'Could not save the instruction.');
    } finally {
      setWorking(null);
    }
  }, [editorText, editorOrigin, editorBehaviour, status, sourceSessionId, applyScope, folderName, closeEditor, loadStatus]);

  const handleTurnOff = useCallback(async () => {
    setWorking('off');
    setError(null);
    try {
      const res = await deactivatePersonalInstruction(folderName);
      toast.info(res?.scope === 'case' ? 'Personalization turned off for this case.' : 'Personalization turned off for all your cases.');
      setShowActive(false);
      await loadStatus();
    } catch (err) {
      setError(err?.message || 'Could not turn personalization off.');
    } finally {
      setWorking(null);
    }
  }, [loadStatus, folderName]);

  const filteredPrompts = useMemo(() => {
    const q = promptQuery.trim().toLowerCase();
    const list = [...prompts].reverse(); // newest first
    if (!q) return list;
    return list.filter((p) => String(p.prompt_text || '').toLowerCase().includes(q));
  }, [prompts, promptQuery]);

  const busy = Boolean(working);
  const active = status?.active_instruction || null;
  const promptCount = status?.prompt_count ?? 0;
  const casePromptCount = status?.case_prompt_count ?? 0;
  const batchSize = status?.batch_size ?? 10;
  const nextIn = status?.prompts_until_next_profile_update ?? batchSize;
  const filled = Math.max(0, Math.min(batchSize, batchSize - nextIn));
  const pct = Math.round((filled / batchSize) * 100);
  const pad = compact ? 'px-4 py-3.5' : 'px-5 py-4';
  // The Memory switch lives in profile Settings → Memory, not here.
  const memoryEnabled = Boolean(status?.memory?.enabled);

  const generatingText = working === 'generate'
    ? (source === 'chat' && pickedSession
      ? `Reading how you work from "${pickedSession.title}" — tone, shape, depth…`
      : source === 'session'
        ? 'Reading how you work from this chat — tone, shape, depth…'
        : source === 'case'
          ? 'Reading how you work from this case’s prompts — tone, shape, depth, language…'
          : 'Reading how you work from your prompts across all cases — tone, shape, depth, language…')
    : 'Polishing your instruction…';

  return (
    <div className={className}>
      {error && (
        <div className="cpb-msg mx-4 mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 text-[12px]">
          {error}
        </div>
      )}

      {/* ── Instructions ─────────────────────────────────────────────────── */}
      <section className={`cpb-msg ${pad} border-b border-slate-100`}>
        <SectionHeader
          title="Instructions"
          subtitle={active
            ? undefined
            : folderName
              ? 'Add instructions so every answer in this case comes out the same way.'
              : "Add instructions to tailor the assistant's answers."}
        >
          <IconButton title="Write an instruction" onClick={() => openEditor('', 'manual', false)} disabled={busy || editorOpen}>
            <Plus className="h-4 w-4" />
          </IconButton>
        </SectionHeader>

        {active && !editorOpen && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 flex-wrap">
              <Check className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
              <span className="text-[12px] font-semibold text-slate-800">Active</span>
              <OriginBadge origin={active.origin} />
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  active.scope === 'case' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                }`}
                title={active.scope === 'case' ? 'Applies only to this case' : 'Applies to all your cases'}
              >
                {active.scope === 'case' ? 'This case' : 'All cases'}
              </span>
              <span className="ml-auto text-[11px] text-slate-400">{fmtDate(active.created_at)}</span>
            </div>
            <div className={`px-3 pb-2 text-[12.5px] text-slate-700 leading-[1.55] ${showActive ? '' : 'pz-clamp-4'}`}>
              <InstructionBody text={active.instruction_text || ''} />
            </div>
            {showActiveBehaviour && active.behaviour_json && (
              <div className="mx-3 mb-2 rounded-lg bg-slate-100/70 px-2.5 py-2">
                <div className="text-[10.5px] uppercase tracking-wide text-slate-500 mb-1.5">What we noticed about you</div>
                <BehaviourPanel analysis={active.behaviour_json} compact />
              </div>
            )}
            <div className="flex items-center gap-1 px-1.5 py-1.5 border-t border-slate-200/70 flex-wrap">
              <button type="button" onClick={() => setShowActive((v) => !v)} className={ghostBtn}>
                {showActive ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showActive ? 'Less' : 'More'}
              </button>
              {active.behaviour_json && (
                <button
                  type="button"
                  onClick={() => setShowActiveBehaviour((v) => !v)}
                  title="What the assistant noticed about how you work"
                  className={ghostBtn}
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" />
                  Noticed
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => openEditor('', 'generated', false, { autoGenerate: true })}
                disabled={busy}
                title="Generate a fresh instruction from your past prompts"
                className={tealGhostBtn}
              >
                <Wand2 className="h-3.5 w-3.5" />
                New
              </button>
              <button
                type="button"
                onClick={() => openEditor(toPlainInstruction(active.instruction_text || ''), active.origin || 'manual', true)}
                disabled={busy}
                className={ghostBtn}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={handleTurnOff}
                disabled={busy}
                className={`${ghostBtn} hover:text-red-600 hover:bg-red-50`}
              >
                {working === 'off' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                Turn off
              </button>
            </div>
          </div>
        )}

        {editorOpen && (
          <div className="mt-3 rounded-xl border border-[#21C1B6]/70 ring-4 ring-[#21C1B6]/10 bg-white overflow-hidden">
            {/* toolbar */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-100 bg-slate-50/70 flex-wrap">
              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={busy || (source === 'chat' && !pickedSession)}
                title={source === 'chat'
                  ? (pickedSession ? `Generate from the prompts of "${pickedSession.title}"` : 'Pick an older chat below first')
                  : source === 'session'
                    ? 'Generate from this chat’s prompts'
                    : 'Generate from your past prompts across chats'}
                className={tealGhostBtn}
              >
                {working === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {editorText.trim() ? 'Regenerate' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={handlePolish}
                disabled={busy || !editorText.trim()}
                title="Tidy what you wrote into a clear, structured instruction — keeps every preference you stated"
                className={tealGhostBtn}
              >
                {working === 'polish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Polish
              </button>
              <span className="flex-1" />
              {editorOrigin !== 'manual' && <OriginBadge origin={editorOrigin} />}
            </div>

            {/* what to learn from */}
            {!editingActive && (
              <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-slate-100 flex-wrap">
                <span className="text-[11px] text-slate-500 mr-0.5">Learn from:</span>
                {folderName && (
                  <SourcePill
                    active={source === 'case'}
                    disabled={busy}
                    onClick={() => chooseSource('case')}
                    title="Only this case's prompts, across all its chats (its old chats are added to your memory log first)"
                  >
                    <History className="h-3 w-3" />
                    This case
                  </SourcePill>
                )}
                {sessionId && (
                  <SourcePill active={source === 'session'} disabled={busy} onClick={() => chooseSource('session')} title="Only this chat's prompts">
                    <MessageSquare className="h-3 w-3" />
                    This chat
                  </SourcePill>
                )}
                {folderName && (
                  <SourcePill
                    active={source === 'chat'}
                    disabled={busy}
                    onClick={togglePastPicker}
                    title="One older chat of this case"
                  >
                    <MessageSquare className="h-3 w-3" />
                    <span className="max-w-[9rem] truncate">{pickedSession ? pickedSession.title : 'Older chat'}</span>
                    {pastOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </SourcePill>
                )}
                <SourcePill
                  active={source === 'history'}
                  disabled={busy}
                  onClick={() => chooseSource('history')}
                  title="Your prompts across all cases"
                >
                  All cases
                </SourcePill>
                {pickedSession && (
                  <button
                    type="button"
                    onClick={() => chooseSource(defaultSource === 'chat' ? 'history' : defaultSource)}
                    disabled={busy}
                    title="Clear the picked chat"
                    aria-label="Clear the picked chat"
                    className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {/* older-chat list — inline (not floating) so it never gets clipped by the column */}
            {pastOpen && !editingActive && (
              <div className="border-b border-slate-100 bg-slate-50/60">
                <div className="px-2.5 pt-2 pb-1.5">
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-500 mb-1.5">Pick an older chat to learn from</div>
                  <input
                    type="text"
                    value={pastQuery}
                    onChange={(e) => setPastQuery(e.target.value)}
                    placeholder="Search chats…"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
                  />
                </div>
                <div className="cpb-scroll max-h-44 overflow-y-auto pb-1">
                  {pastLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chats…
                    </div>
                  ) : filteredPastSessions.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-slate-500">
                      {pastQuery ? 'No chats match your search.' : 'No older chats in this case yet.'}
                    </div>
                  ) : (
                    filteredPastSessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handlePickPastSession(s)}
                        disabled={busy}
                        className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-[#E0F7F6]/60 transition-colors disabled:opacity-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-slate-800 truncate">{s.title}</span>
                          <span className="block text-[11px] text-slate-400">
                            {fmtDate(s.updatedAt)}
                            {s.promptCount != null && ` · ${s.promptCount} prompt${s.promptCount === 1 ? '' : 's'}`}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* what the generator noticed — shown above the draft it produced */}
            {editorBehaviour && working !== 'generate' && (
              <div className="border-b border-slate-100 bg-slate-50/60">
                <button
                  type="button"
                  onClick={() => setShowBehaviour((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#21C1B6] flex-shrink-0" />
                  <span className="text-[12px] font-semibold text-slate-800 flex-1">What we noticed about you</span>
                  {showBehaviour ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </button>
                {showBehaviour && (
                  <div className="cpb-scroll px-3 pb-3 max-h-[18rem] overflow-y-auto">
                    <BehaviourPanel analysis={editorBehaviour} compact />
                  </div>
                )}
              </div>
            )}

            {working === 'generate' || working === 'polish' ? (
              <div className="px-3.5 py-3">
                <div className="flex items-center gap-2 text-[12px] text-slate-600 mb-2.5">
                  <span className="inline-flex gap-1">
                    <i className="cpb-dot" /><i className="cpb-dot" /><i className="cpb-dot" />
                  </span>
                  {generatingText}
                </div>
                <div className="space-y-2">
                  <div className="cpb-sheen h-2.5 rounded w-5/12" />
                  <div className="cpb-sheen h-2.5 rounded w-11/12" />
                  <div className="cpb-sheen h-2.5 rounded w-full" />
                  <div className="cpb-sheen h-2.5 rounded w-3/4" />
                </div>
              </div>
            ) : editorPreview ? (
              <div className="cpb-scroll px-3.5 py-3 max-h-[20rem] overflow-y-auto text-[12.5px] text-slate-700 leading-[1.6]">
                <InstructionBody text={editorText} />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={editorText}
                onChange={(e) => { setEditorText(e.target.value); if (editorOrigin !== 'manual') setEditorOrigin('manual'); }}
                disabled={busy}
                placeholder={EDITOR_PLACEHOLDER}
                spellCheck
                className="cpb-scroll w-full resize-none px-3.5 py-3 text-[13px] leading-relaxed text-slate-800 placeholder:text-slate-400 font-sans focus:outline-none disabled:opacity-60"
                style={{ minHeight: 140, maxHeight: 320 }}
              />
            )}

            {folderName && !editingActive && (
              <div className="flex items-center gap-1 px-2.5 py-1.5 border-t border-slate-100 flex-wrap">
                <span className="text-[11px] text-slate-500 mr-0.5">Apply to:</span>
                <SourcePill
                  active={applyScope === 'case'}
                  disabled={busy}
                  onClick={() => setApplyScope('case')}
                  title="Only chats in this case follow this instruction"
                >
                  This case
                </SourcePill>
                <SourcePill
                  active={applyScope === 'global'}
                  disabled={busy}
                  onClick={() => setApplyScope('global')}
                  title="Every case without its own instruction follows this one"
                >
                  All my cases
                </SourcePill>
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-2 border-t border-slate-100 bg-slate-50/70 flex-wrap">
              <IconButton
                title={editorPreview ? 'Edit text' : 'Preview'}
                onClick={() => setEditorPreview((v) => !v)}
                disabled={busy || !editorText.trim()}
              >
                {editorPreview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </IconButton>
              <button type="button" onClick={closeEditor} disabled={working === 'save'} className={ghostBtn}>
                Cancel
              </button>
              <span className="flex-1" />
              {active && !editingActive && (
                <button
                  type="button"
                  onClick={() => handleSave('append')}
                  disabled={busy || !editorText.trim()}
                  title="Keep the current instruction and add this one after it"
                  className={outlineBtn}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Append
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSave('replace')}
                disabled={busy || !editorText.trim()}
                title={active ? 'Replace the current instruction with this one' : 'Make this the assistant’s instruction'}
                className={primaryBtn}
              >
                {working === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {active ? (editingActive ? 'Save changes' : 'Replace & add') : 'Add to system'}
              </button>
            </div>
          </div>
        )}

        {!active && !editorOpen && (
          <div className="mt-3 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => openEditor('', 'generated', false, { autoGenerate: true })}
              disabled={busy}
              title={folderName
                ? 'Reads this case’s prompts and writes an instruction for you to review'
                : 'Reads your past prompts and writes an instruction for you to review'}
              className={`${primaryBtn} w-full justify-center py-2`}
            >
              <Wand2 className="h-4 w-4" />
              {folderName ? 'Generate from this case’s prompts' : 'Generate from my past prompts'}
            </button>
            <button
              type="button"
              onClick={() => openEditor('', 'manual', false)}
              disabled={busy}
              className={`${ghostBtn} w-full justify-center border border-dashed border-slate-300 hover:border-[#21C1B6]`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Write my own
            </button>
          </div>
        )}
      </section>

      {/* Memory has no controls here on purpose: it is ONE switch in profile
          Settings → Memory. This panel only shows the files once it is on. */}
      {!memoryEnabled && (
        <section className={`cpb-msg ${pad} border-b border-slate-100`}>
          <p className="text-xs leading-relaxed text-slate-500">
            Memory is off. Turn it on in{' '}
            <button
              type="button"
              onClick={() => { window.location.href = '/settings'; }}
              className="font-semibold text-[#21C1B6] underline underline-offset-2 hover:text-[#1AA49B]"
            >
              Settings → Memory
            </button>
            .
          </p>
        </section>
      )}

      {memoryEnabled && (
        <MemoryPanel
          folderName={folderName}
          status={status}
          statusLoading={statusLoading}
          pad={pad}
          showContext={showContext}
          onRefresh={loadStatus}
        />
      )}

      {/* ── Context (optional) ───────────────────────────────────────────── */}
      {showContext && (
        <section className={`cpb-msg ${pad}`}>
          <SectionHeader title="Context">
            <IconButton title="Search prompts" onClick={() => { setShowSearch((v) => !v); setPromptQuery(''); }}>
              <Search className="h-4 w-4" />
            </IconButton>
            <IconButton title="Refresh" onClick={() => { loadStatus(); loadPrompts(); }} disabled={statusLoading || promptsLoading}>
              <RefreshCw className={`h-4 w-4 ${statusLoading || promptsLoading ? 'animate-spin' : ''}`} />
            </IconButton>
          </SectionHeader>

          <div className="mt-3">
            <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full rounded-full bg-[#21C1B6] transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500">
              {folderName
                ? `${casePromptCount} prompt${casePromptCount === 1 ? '' : 's'} in this case · ${promptCount} total · ${nextIn} more until the next style-profile update`
                : `${promptCount} prompt${promptCount === 1 ? '' : 's'} for the instruction generator · ${nextIn} more until the next style-profile update`}
            </p>
          </div>

          {showSearch && (
            <input
              type="text"
              value={promptQuery}
              onChange={(e) => setPromptQuery(e.target.value)}
              placeholder="Search your prompts…"
              autoFocus
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
            />
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-wide text-slate-500">
              {sessionId ? 'This session' : folderName ? 'This case' : 'Recent prompts'}
            </span>
            <span className="text-[11px] text-slate-400">{filteredPrompts.length}</span>
          </div>

          {filteredPrompts.length === 0 ? (
            <p className="mt-2 text-[12px] text-slate-500 leading-snug">
              {promptsLoading
                ? 'Loading…'
                : promptQuery
                  ? 'No prompts match your search.'
                  : 'Ask something in this chat — your prompts appear here and feed the instruction generator.'}
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {filteredPrompts.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 min-h-[76px] flex flex-col hover:border-slate-300 transition-colors"
                  title={p.prompt_text}
                >
                  <span className="pz-clamp-3 text-[12px] text-slate-700 leading-snug flex-1">{p.prompt_text}</span>
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-slate-400">
                    <MessageSquare className="h-3 w-3" />
                    {fmtDate(p.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default PersonalizationSections;
