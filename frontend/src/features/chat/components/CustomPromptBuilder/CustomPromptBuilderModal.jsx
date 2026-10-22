import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X, Sparkles, Loader2, Send, Check, FolderPlus, Plus,
  Copy, ArrowRight, RefreshCw, ChevronDown,
  Target, FileSearch, LayoutList, ShieldCheck,
} from 'lucide-react';
import { generateCustomPrompt, addCustomPrompt } from '../../api/customPromptsService';
import { normalizeMarkdownFormatting, markdownTableComponents, markdownRehypePlugins } from '@/shared/utils/markdownUtils';
import '../../styles/CustomPromptBuilder.css';

const NEW_GROUP_VALUE = '__new__';

// Composer sizing — matches the ChatModel composer so long instructions behave
// identically here (grow to 200px, then scroll internally).
const INPUT_MIN_HEIGHT = 24;
const INPUT_MAX_HEIGHT = 200;

/** What to tell the builder so the prompt comes back right the first time. */
const GUIDE = [
  {
    icon: Target,
    label: 'The task',
    hint: 'What should it do every time it runs? “Review every loan agreement and summarise the repayment terms.”',
  },
  {
    icon: FileSearch,
    label: 'The source',
    hint: 'What should it look at? “The uploaded case documents” or “the conversation so far”.',
  },
  {
    icon: LayoutList,
    label: 'The output',
    hint: 'What shape do you want back? “A markdown table with one row per agreement.”',
  },
  {
    icon: ShieldCheck,
    label: 'The rules',
    hint: 'Anything it must always do or never do. “Cite the clause number; never guess a missing date.”',
  },
];

const EXAMPLE_INSTRUCTION =
  'Review every loan agreement in the uploaded case documents. For each one, give me the '
  + 'borrower, the repayment schedule and the interest rate, and flag any agreement that is '
  + 'missing a signature. Return it as a markdown table with one row per agreement, and cite '
  + 'the clause number for every finding.';

/** Generated prompts come back as markdown (bold labels, numbered steps, tables) —
 *  render it so the card reads the way the prompt will. */
// A prompt is prose the user reads, not source code — so nothing here gets a
// box, a tint or a monospace face. Fenced/inline code inherits the app's own
// font and is distinguished only by weight and colour.
const promptMarkdownComponents = {
  ...markdownTableComponents,
  p: ({ node, ...props }) => <p className="mb-2.5 last:mb-0" {...props} />,
  ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-2.5 space-y-1.5 last:mb-0 marker:text-slate-400" {...props} />,
  ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-2.5 space-y-1.5 last:mb-0 marker:text-slate-400" {...props} />,
  li: ({ node, ...props }) => <li className="pl-0.5" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900" {...props} />,
  em: ({ node, ...props }) => <em className="text-slate-600" {...props} />,
  a: ({ node, ...props }) => <a className="text-[#178E86] underline underline-offset-2" {...props} />,
  hr: ({ node, ...props }) => <hr className="my-3 border-slate-200" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className="pl-3 border-l-2 border-slate-200 text-slate-600 my-2.5" {...props} />
  ),
  h1: ({ node, ...props }) => <h1 className="text-[15px] font-semibold text-slate-900 mt-4 mb-2 first:mt-0" {...props} />,
  h2: ({ node, ...props }) => <h2 className="text-[14.5px] font-semibold text-slate-900 mt-4 mb-2 first:mt-0" {...props} />,
  h3: ({ node, ...props }) => <h3 className="text-[14px] font-semibold text-slate-900 mt-3 mb-1.5 first:mt-0" {...props} />,
  h4: ({ node, ...props }) => <h4 className="text-[13.5px] font-semibold text-slate-800 mt-3 mb-1.5 first:mt-0" {...props} />,
  // No background, no border, no monospace — just emphasis in the system font.
  code: ({ node, inline, ...props }) => (
    <code className="font-sans font-medium text-slate-900" {...props} />
  ),
  pre: ({ node, ...props }) => (
    <div className="mb-2.5 last:mb-0 whitespace-pre-wrap font-sans text-slate-800" {...props} />
  ),
};

// Generated prompts are structured with XML-ish section tags (<role>, <task>,
// <output_format>…). Those are plumbing for the executing model — the user
// should read the prompt as a document, so each opening tag becomes a section
// heading and each closing tag disappears. The raw tagged text is what gets
// saved, copied and run; only the on-screen rendering is cleaned up.
const INLINE_HTML_OK = new Set([
  'br', 'strong', 'em', 'sup', 'sub', 'del', 'span', 'u', 'mark', 'b', 'i', 'thinking',
]);
const TAG_LIKE = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)(\s[^>]*)?>/g;

const TAG_LABELS = {
  role: 'Role',
  context: 'Context',
  task: 'Task',
  jurisdiction_and_law: 'Jurisdiction & Law',
  constraints: 'Constraints',
  output_format: 'Output Format',
  quality_bar: 'Quality Bar',
  disclaimer_instruction: 'Disclaimer',
};

const titleCase = (raw) =>
  String(raw).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Turn <section> tags into readable headings. Inline formatting tags are left alone. */
const sectionsFromTags = (text) =>
  (text || '')
    .replace(/<\/([a-zA-Z][a-zA-Z0-9_-]*)>/g, (match, tag) =>
      INLINE_HTML_OK.has(String(tag).toLowerCase()) ? match : '\n')
    .replace(/<([a-zA-Z][a-zA-Z0-9_-]*)>/g, (match, tag) => {
      const key = String(tag).toLowerCase();
      if (INLINE_HTML_OK.has(key)) return match;
      return `\n\n### ${TAG_LABELS[key] || titleCase(tag)}\n\n`;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const ESCAPED_TAG_LINE = /^&lt;\/?[a-zA-Z][a-zA-Z0-9_-]*&gt;$/;

const escapeStructuralTags = (text) => {
  const escaped = (text || '').replace(TAG_LIKE, (match, tag) =>
    INLINE_HTML_OK.has(String(tag).toLowerCase())
      ? match
      : match.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );

  // A tag on its own line directly after a table row is otherwise parsed as
  // another row, so give every tag line its own blank-line breathing room.
  const out = [];
  const lines = escaped.split('\n');
  lines.forEach((line, i) => {
    const isTagLine = ESCAPED_TAG_LINE.test(line.trim());
    const prev = out[out.length - 1];
    if (isTagLine && prev !== undefined && prev.trim() !== '') out.push('');
    out.push(line);
    const next = lines[i + 1];
    if (isTagLine && next !== undefined && next.trim() !== '') out.push('');
  });
  return out.join('\n');
};

const PromptMarkdown = ({ text }) => (
  <div className="cpb-prompt-body font-sans text-[13.5px] text-slate-700 leading-[1.65] break-words">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={markdownRehypePlugins}
      components={promptMarkdownComponents}
    >
      {escapeStructuralTags(normalizeMarkdownFormatting(sectionsFromTags(text)))}
    </ReactMarkdown>
  </div>
);

const wordCount = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * Chat-style prompt builder.
 *
 * The user describes the task in a normal chat composer; the agent replies with
 * a ready-to-use prompt rendered as a card. From there the user either
 *   • accepts it — "Add to Prompt Group" saves it under a folder, where it shows
 *     up by name and can be run like any preset prompt, or
 *   • keeps chatting — "make it shorter", "also list hearing dates" — and the
 *     agent returns the full revised prompt each turn.
 *
 * Every refinement turn resends the whole conversation, so the agent revises its
 * own previous draft rather than starting over.
 */
const CustomPromptBuilderModal = ({ isOpen, onClose, groups = [], onSaved }) => {
  const [messages, setMessages] = useState([]);   // {id, role, text, prompt?}
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // save panel (opened from an assistant card)
  const [savingFor, setSavingFor] = useState(null); // the prompt object being saved
  const [saveName, setSaveName] = useState('');     // editable — defaults to the AI's name
  const [groupChoice, setGroupChoice] = useState(NEW_GROUP_VALUE);
  const [newGroupName, setNewGroupName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const lastSentRef = useRef('');   // for the Retry action after a failure

  useEffect(() => {
    if (!isOpen) return;
    setMessages([]);
    setInput('');
    setError('');
    setIsThinking(false);
    setSavingFor(null);
    setSaveName('');
    setNewGroupName('');
    setCopiedId(null);
    setGroupChoice(groups.length ? groups[0].id : NEW_GROUP_VALUE);
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Esc closes the dialog
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isThinking, savingFor]);

  // Grow with the text up to INPUT_MAX_HEIGHT, then scroll inside — same
  // behaviour as the ChatModel composer, so long instructions stay comfortable.
  const resizeInput = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(Math.max(ta.scrollHeight, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => { resizeInput(); }, [input, resizeInput]);

  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  const latestPrompt = [...messages].reverse().find((m) => m.role === 'assistant')?.prompt || null;

  const runTurn = useCallback(async (text) => {
    // History for the agent: assistant turns carry the prompt text they produced.
    const history = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? (m.prompt?.prompt_text || m.text) : m.text,
      })).filter((m) => m.role !== 'system'),
      { role: 'user', content: text },
    ];

    // The draft currently on screen — sent so the model edits exactly this text
    // rather than re-deriving a prompt from the conversation.
    const currentDraft =
      [...messages].reverse().find((m) => m.role === 'assistant')?.prompt?.prompt_text || null;

    setError('');
    setSavingFor(null);
    setIsThinking(true);
    try {
      const generated = await generateCustomPrompt(history, currentDraft);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: generated?.prompt_text || '',
          prompt: {
            name: generated?.name || 'Custom Prompt',
            description: generated?.description || '',
            prompt_text: generated?.prompt_text || '',
          },
        },
      ]);
    } catch (err) {
      setError(err?.message || 'Could not build the prompt. Please try again.');
    } finally {
      setIsThinking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;
    lastSentRef.current = text;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }]);
    setInput('');
    await runTurn(text);
  }, [input, isThinking, runTurn]);

  const handleRetry = useCallback(async () => {
    if (!lastSentRef.current || isThinking) return;
    // The failed user turn is already in the thread — replay it without re-adding.
    const history = messages.filter((m) => m.role !== 'system');
    setError('');
    setIsThinking(true);
    try {
      const generated = await generateCustomPrompt(
        history.map((m) => ({
          role: m.role,
          content: m.role === 'assistant' ? (m.prompt?.prompt_text || m.text) : m.text,
        })),
      );
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: generated?.prompt_text || '',
        prompt: {
          name: generated?.name || 'Custom Prompt',
          description: generated?.description || '',
          prompt_text: generated?.prompt_text || '',
        },
      }]);
    } catch (err) {
      setError(err?.message || 'Could not build the prompt. Please try again.');
    } finally {
      setIsThinking(false);
    }
  }, [messages, isThinking]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.prompt?.prompt_text || '');
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((c) => (c === msg.id ? null : c)), 1600);
    } catch { /* clipboard unavailable */ }
  };

  const isNewGroup = groupChoice === NEW_GROUP_VALUE;
  const groupReady = isNewGroup ? Boolean(newGroupName.trim()) : Boolean(groupChoice);
  const nameReady = Boolean(saveName.trim());

  const openSavePanel = (prompt) => {
    setSavingFor(prompt);
    setSaveName(prompt?.name || '');
  };

  const handleSave = async () => {
    if (!savingFor || !groupReady || !nameReady || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const saved = await addCustomPrompt({
        groupId: isNewGroup ? null : groupChoice,
        groupName: isNewGroup ? newGroupName.trim() : null,
        name: saveName.trim(),
        promptText: savingFor.prompt_text,
        description: savingFor.description || null,
      });
      const groupLabel = isNewGroup
        ? newGroupName.trim()
        : (groups.find((g) => g.id === groupChoice)?.name || 'your group');
      if (isNewGroup && saved?.group_id) {
        setGroupChoice(saved.group_id);
        setNewGroupName('');
      }
      setSavingFor(null);
      setSaveName('');
      setMessages((prev) => [...prev, {
        id: `s-${Date.now()}`,
        role: 'system',
        text: `Saved “${saved?.name || saveName.trim()}” to ${groupLabel}. Run it from that group, or keep refining to add another.`,
      }]);
      onSaved?.(saved);
    } catch (err) {
      setError(err?.message || 'Failed to save the prompt. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const hasDraft = assistantCount > 0;

  return (
    <div
      className="cpb-backdrop fixed inset-0 bg-slate-900/45 flex items-center justify-center z-[1200] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Prompt Builder"
    >
      <div className="cpb-panel bg-white rounded-2xl shadow-2xl ring-1 ring-slate-900/5 w-full max-w-2xl h-[min(660px,86vh)] flex flex-col overflow-hidden">

        {/* ── header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#21C1B6] to-[#12968D] text-white flex items-center justify-center shadow-sm shadow-[#21C1B6]/25">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Prompt Builder</h3>
            <p className="text-[11.5px] text-slate-400 leading-tight">
              {hasDraft ? 'Refine it, or save it to one of your groups' : "Describe the task — I'll write the prompt"}
            </p>
          </div>
          {hasDraft && (
            <span className="hidden sm:inline-flex items-center text-[10.5px] font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
              Draft {assistantCount}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* ── thread ──────────────────────────────────────────────────────── */}
        <div ref={threadRef} className="cpb-scroll flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/70">

          {messages.length === 0 && !isThinking && (
            <div className="min-h-full flex flex-col items-center justify-center text-center px-2 py-2">
              <span className="cpb-halo relative w-11 h-11 rounded-full bg-[#E0F7F6] text-[#21C1B6] flex items-center justify-center mb-2.5">
                <Sparkles className="h-5 w-5" />
              </span>
              <h4 className="text-[14px] font-semibold text-slate-800">What should this prompt do?</h4>
              <p className="text-[12.5px] text-slate-500 mt-1 max-w-md">
                Describe it in plain language. The more of these you mention, the better the prompt comes back.
              </p>

              <div className="w-full max-w-md mt-3.5 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden text-left">
                {GUIDE.map(({ icon: Icon, label, hint }) => (
                  <div key={label} className="flex items-start gap-2.5 px-3 py-2.5">
                    <span className="w-6 h-6 rounded-lg bg-slate-50 text-[#21C1B6] flex items-center justify-center flex-shrink-0 mt-px">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-800 leading-tight">{label}</p>
                      <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">{hint}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setInput(EXAMPLE_INSTRUCTION);
                  const ta = inputRef.current;
                  if (ta) {
                    ta.focus();
                    ta.style.height = 'auto';
                    ta.style.height = `${Math.min(ta.scrollHeight, INPUT_MAX_HEIGHT)}px`;
                  }
                }}
                className="group mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#21C1B6] hover:text-[#178E86] transition-colors"
              >
                Fill in an example that does all four
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="cpb-msg flex justify-end">
                  <div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md bg-gradient-to-br from-[#21C1B6] to-[#16A79D] text-white text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm">
                    {msg.text}
                  </div>
                </div>
              );
            }

            if (msg.role === 'system') {
              return (
                <div key={msg.id} className="cpb-msg flex justify-center">
                  <div className="max-w-[92%] px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-[12px] flex items-start gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 mt-px">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    <span>{msg.text}</span>
                  </div>
                </div>
              );
            }

            const isLatest = msg.prompt && msg.prompt === latestPrompt;
            const isSaving_ = savingFor === msg.prompt;
            return (
              <div key={msg.id} className="cpb-msg">
                <div
                  className={`rounded-xl bg-white overflow-hidden transition-all ${
                    isLatest
                      ? 'border border-[#21C1B6]/60 shadow-sm ring-1 ring-[#21C1B6]/10'
                      : 'border border-slate-200 opacity-75 hover:opacity-100'
                  }`}
                >
                  {/* card header */}
                  <div className="px-3.5 py-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/60">
                    <span className="text-[13px] font-semibold text-slate-900 flex-1 truncate">
                      {msg.prompt?.name}
                    </span>
                    <span className="text-[10.5px] text-slate-400 tabular-nums flex-shrink-0">
                      {wordCount(msg.prompt?.prompt_text)} words
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(msg)}
                      title="Copy prompt text"
                      className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors flex-shrink-0"
                    >
                      {copiedId === msg.id
                        ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {msg.prompt?.description && (
                    <p className="px-4 pt-2.5 text-[12.5px] text-slate-500 italic leading-snug">
                      {msg.prompt.description}
                    </p>
                  )}

                  <div className="cpb-scroll px-4 py-3 max-h-[22rem] overflow-y-auto">
                    <PromptMarkdown text={msg.prompt?.prompt_text} />
                  </div>

                  {/* footer / save panel */}
                  {isLatest && !isSaving_ && (
                    <div className="px-3.5 py-2 border-t border-slate-100 flex items-center justify-between gap-2 bg-slate-50/60">
                      <span className="text-[11px] text-slate-400 truncate">Looks right? Save it — or ask for changes below.</span>
                      <button
                        type="button"
                        onClick={() => openSavePanel(msg.prompt)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] active:scale-[0.97] shadow-sm flex-shrink-0 transition-all"
                      >
                        <Plus className="h-3 w-3" /> Add to Group
                      </button>
                    </div>
                  )}

                  {isSaving_ && (
                    <div className="px-3.5 py-3 border-t border-slate-100 bg-slate-50 space-y-2">
                      <label className="block text-[11px] font-medium text-slate-600">
                        Prompt name <span className="text-slate-400 font-normal">— this is what you'll see on the chip</span>
                      </label>
                      <input
                        type="text"
                        autoFocus
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && groupReady) handleSave(); }}
                        maxLength={200}
                        placeholder="e.g. Loan Obligation Summary"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-[12.5px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6] transition-shadow"
                      />

                      <label className="block text-[11px] font-medium text-slate-600 pt-0.5">Save under group</label>
                      <div className="relative">
                        <select
                          value={groupChoice}
                          onChange={(e) => setGroupChoice(e.target.value)}
                          className="w-full appearance-none pl-2.5 pr-8 py-1.5 border border-slate-300 rounded-lg text-[12.5px] bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6] transition-shadow"
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} ({g.prompts?.length ?? 0})
                            </option>
                          ))}
                          <option value={NEW_GROUP_VALUE}>+ New group…</option>
                        </select>
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      {isNewGroup && (
                        <div className="flex items-center gap-1.5">
                          <FolderPlus className="h-3.5 w-3.5 text-[#21C1B6] flex-shrink-0" />
                          <input
                            type="text"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && nameReady) handleSave(); }}
                            placeholder="New group name, e.g. Banking Prompts"
                            className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6] transition-shadow"
                          />
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setSavingFor(null)}
                          className="px-2.5 py-1 text-[12px] rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={!groupReady || !nameReady || isSaving}
                          className="inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-lg shadow-sm active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all"
                        >
                          {isSaving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : 'Save Prompt'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isThinking && (
            <div className="cpb-msg">
              {hasDraft ? (
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[12.5px] text-slate-500">
                  <span className="flex items-end gap-[3px]">
                    <i className="cpb-dot" /><i className="cpb-dot" /><i className="cpb-dot" />
                  </span>
                  Updating the prompt…
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/60">
                    <span className="flex items-end gap-[3px]">
                      <i className="cpb-dot" /><i className="cpb-dot" /><i className="cpb-dot" />
                    </span>
                    <span className="text-[12px] text-slate-500">Writing your prompt…</span>
                  </div>
                  <div className="px-3.5 py-3 space-y-2">
                    <div className="cpb-sheen h-2.5 rounded w-11/12" />
                    <div className="cpb-sheen h-2.5 rounded w-full" />
                    <div className="cpb-sheen h-2.5 rounded w-4/5" />
                    <div className="cpb-sheen h-2.5 rounded w-2/3" />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="cpb-msg flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 text-[12px]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isThinking}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}
        </div>

        {/* ── composer ────────────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-2.5 border-t border-slate-100 flex-shrink-0 bg-white">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 transition-all focus-within:border-[#21C1B6] focus-within:ring-2 focus-within:ring-[#21C1B6]/20">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              disabled={isThinking}
              onChange={(e) => {
                setInput(e.target.value);
                resizeInput();
                // Typing a new instruction means they want to keep refining —
                // fold the save panel away so the draft stays the focus.
                if (savingFor) { setSavingFor(null); setSaveName(''); }
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                hasDraft
                  ? 'What should I change? e.g. "make it shorter" or "also list hearing dates"'
                  : 'Describe what this prompt should do…'
              }
              className="cpb-scroll flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white bg-[#21C1B6] hover:bg-[#1AA49B] active:scale-95 shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:active:scale-100 flex-shrink-0 transition-all"
              aria-label="Send"
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-slate-400">
            <kbd className="font-sans font-medium text-slate-500">Enter</kbd> to send ·{' '}
            <kbd className="font-sans font-medium text-slate-500">Shift+Enter</kbd> for a new line ·{' '}
            <kbd className="font-sans font-medium text-slate-500">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
};

export default CustomPromptBuilderModal;
