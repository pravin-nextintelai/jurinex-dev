import React, { useState } from 'react';
import { MessageSquareOff, MessageSquare, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import { INSTRUCTION_MAX_CHARS, INSTRUCTION_ORIGINS, formatDate } from '../../utils/memoryLabels';

const TEAL = '#21C1B6';

const Switch = ({ checked, onChange, disabled, label, busy }) => (
  <button
    type="button"
    role="switch"
    aria-checked={Boolean(checked)}
    aria-label={label}
    disabled={disabled || busy}
    onClick={() => onChange(!checked)}
    className={`relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
      checked ? 'bg-green-600' : 'bg-gray-200'
    } ${busy ? 'animate-pulse' : ''}`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`}
    />
  </button>
);

const Chip = ({ children, tone = 'gray', title }) => {
  const tones = {
    gray: 'bg-gray-100 text-gray-500',
    teal: 'bg-[#f0fdfb] text-[#0d9488]',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${tones[tone] || tones.gray}`}
      title={title}
    >
      {children}
    </span>
  );
};

/**
 * One instruction: its switch, its text, where it came from, where it is
 * switched off, and the actions for it.
 *
 * `caseSwitch` is for a universal instruction shown inside a case: the switch
 * then means "applies in this case" and sets a per-case override rather than
 * changing the instruction for every case.
 */
const InstructionRow = ({ item, instructions, caseSwitch, editable, sessionId, disabled }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text || '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const origin = INSTRUCTION_ORIGINS[item.origin] || INSTRUCTION_ORIGINS.user;
  const appliesHere = caseSwitch ? (item.case_override ?? item.enabled) : item.enabled;
  const mutedInChat = item.session_override === false;
  const globallyOff = caseSwitch && !item.enabled;

  const act = async (kind, action) => {
    setBusy(kind);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result?.ok) setError(result?.error || { message: 'Something went wrong.' });
    return result;
  };

  const toggle = (value) =>
    act('switch', () =>
      caseSwitch ? instructions.setOverride(item, 'case', value) : instructions.update(item, { enabled: value }),
    );

  const toggleMute = () =>
    act('mute', () => instructions.setOverride(item, 'session', mutedInChat ? null : false));

  const save = async () => {
    const text = draft.trim();
    if (!text || text === String(item.text || '').trim()) {
      setEditing(false);
      return;
    }
    const result = await act('save', () => instructions.update(item, { text }));
    if (result?.ok) setEditing(false);
  };

  const remove = async () => {
    if (!window.confirm('Remove this instruction? JuriNex stops following it straight away.')) return;
    await act('remove', () => instructions.remove(item));
  };

  return (
    <li
      className={`group rounded-lg border border-gray-100 px-3 py-2 hover:border-gray-200 transition-colors ${
        item.effective ? '' : 'opacity-75'
      }`}
      style={{ background: '#fafafa' }}
    >
      <div className="flex items-start gap-2.5">
        <Switch
          checked={appliesHere}
          onChange={toggle}
          busy={busy === 'switch'}
          disabled={disabled}
          label={caseSwitch ? 'Apply in this case' : 'Apply this instruction'}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, INSTRUCTION_MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setEditing(false);
                  }
                }}
                rows={2}
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/40"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-gray-400">
                  {draft.length}/{INSTRUCTION_MAX_CHARS}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={busy === 'save' || !draft.trim()}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
                    style={{ background: TEAL }}
                  >
                    {busy === 'save' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className={`text-xs break-words ${item.effective ? 'text-gray-700' : 'text-gray-500 line-through decoration-gray-300'}`}>
                {item.text}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <Chip title={origin.hint}>{origin.label}</Chip>
                {globallyOff && <Chip tone="slate" title="Switched off in Settings → Memory">Off everywhere</Chip>}
                {caseSwitch && item.case_override === false && <Chip tone="amber">Off for this case</Chip>}
                {caseSwitch && item.case_override === true && item.enabled === false && (
                  <Chip tone="teal">On for this case</Chip>
                )}
                {mutedInChat && <Chip tone="amber">Muted in this chat</Chip>}
                {item.updated_at && <span className="text-[10px] text-gray-400">{formatDate(item.updated_at)}</span>}
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
            {sessionId && (
              <button
                type="button"
                onClick={toggleMute}
                disabled={disabled || busy !== null}
                title={mutedInChat ? 'Use in this chat again' : 'Mute for this chat only'}
                aria-label={mutedInChat ? 'Use in this chat again' : 'Mute for this chat only'}
                className={`p-1 rounded hover:bg-white disabled:opacity-40 ${
                  mutedInChat ? 'text-amber-600' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {mutedInChat ? <MessageSquare className="w-3.5 h-3.5" /> : <MessageSquareOff className="w-3.5 h-3.5" />}
              </button>
            )}
            {editable && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(item.text || '');
                    setError(null);
                    setEditing(true);
                  }}
                  disabled={disabled || busy !== null}
                  title="Edit"
                  aria-label="Edit this instruction"
                  className="p-1 rounded hover:bg-white text-gray-400 hover:text-gray-600 disabled:opacity-40"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={disabled || busy !== null}
                  title="Remove"
                  aria-label="Remove this instruction"
                  className="p-1 rounded hover:bg-white text-gray-400 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-2">
          <MemoryNotice tone={error.kind === 'conflict' ? 'warning' : 'error'} problems={error.problems || []}>
            {error.message}
          </MemoryNotice>
        </div>
      )}
    </li>
  );
};

/** Type an instruction, polish it if you like, add it. */
const AddInstruction = ({ instructions, placeholder, onAdded }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [polished, setPolished] = useState(null); // { text } when a polished version is waiting
  const [usedPolish, setUsedPolish] = useState(false);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const reset = () => {
    setOpen(false);
    setDraft('');
    setPolished(null);
    setUsedPolish(false);
    setNotice(null);
  };

  const polish = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy('polish');
    setNotice(null);
    setPolished(null);
    const result = await instructions.polish(text);
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: 'error', error: result.error });
      return;
    }
    if (result.problems?.length) {
      setNotice({ tone: 'warning', message: result.problems[0].message });
      return;
    }
    if (result.error === 'unavailable') {
      setNotice({ tone: 'info', message: "Polish isn't available right now. You can still add it as written." });
      return;
    }
    if (!result.changed) {
      setNotice({ tone: 'success', message: 'Already clear as written.' });
      return;
    }
    setPolished({ text: result.polished });
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy('add');
    setNotice(null);
    const result = await instructions.add(text, { polished: usedPolish });
    setBusy(null);
    if (result.ok) {
      reset();
      onAdded?.(result.data);
    } else {
      setNotice({ tone: result.error?.kind === 'conflict' ? 'warning' : 'error', error: result.error });
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-[#f0fdfb]"
        style={{ color: TEAL }}
      >
        <Plus className="w-3.5 h-3.5" />
        Add an instruction
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value.slice(0, INSTRUCTION_MAX_CHARS));
          setUsedPolish(false);
          setPolished(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            reset();
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="w-full text-xs text-gray-700 resize-none outline-none"
      />
      {polished && (
        <div className="mt-2 rounded-lg border px-3 py-2" style={{ borderColor: '#99f6e4', background: '#f0fdfb' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3 h-3" style={{ color: TEAL }} />
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#0d9488' }}>
              Polished
            </span>
          </div>
          <p className="text-xs text-gray-700">{polished.text}</p>
          <div className="flex gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => {
                setDraft(polished.text);
                setUsedPolish(true);
                setPolished(null);
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
              style={{ background: TEAL }}
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setPolished(null)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div className="mt-2">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
        <span className="text-[10px] text-gray-400">
          {draft.length}/{INSTRUCTION_MAX_CHARS}
          {usedPolish ? ' · polished' : ''}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={reset}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={polish}
            disabled={busy !== null || !draft.trim()}
            title="Tidy the wording without changing what it asks"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'polish' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" style={{ color: TEAL }} />}
            Polish
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy !== null || !draft.trim()}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
            style={{ background: TEAL }}
          >
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * A set of instructions with a switch on each. Used for the case's own
 * instructions, for the advocate's universal ones in Settings, and for those
 * universal ones inside a case (where the switch is per case).
 */
const InstructionList = ({
  instructions,
  title,
  intro,
  placeholder,
  emptyText,
  caseSwitch = false,
  editable = true,
  disabled = false,
  onAdded,
}) => {
  const { items, loading, loaded, error, limits, sessionId } = instructions;
  const applying = items.filter((item) => item.effective).length;

  return (
    <section className="mb-5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-gray-800">{title}</h3>
          {intro && <p className="text-[11px] text-gray-400">{intro}</p>}
        </div>
        {loaded && items.length > 0 && (
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            {applying} of {items.length} applying{sessionId ? ' in this chat' : ''}
          </span>
        )}
      </div>

      {error && (
        <MemoryNotice tone="error">{error.message}</MemoryNotice>
      )}
      {!loaded && loading && (
        <div className="flex items-center gap-2 py-4 text-gray-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      )}
      {loaded && items.length === 0 && (
        <p className="text-[11px] text-gray-400 py-3">{emptyText}</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <InstructionRow
              key={item.id}
              item={item}
              instructions={instructions}
              caseSwitch={caseSwitch}
              editable={editable}
              sessionId={sessionId}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
      {editable && loaded && items.length < limits.maxItems && (
        <AddInstruction instructions={instructions} placeholder={placeholder} onAdded={onAdded} />
      )}
    </section>
  );
};

export default InstructionList;
