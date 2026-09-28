import React, { useState } from 'react';
import { Check, Pencil, RefreshCw, Sparkles, X } from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import memoryApi, { describeMemoryError } from '../../services/memoryApi';
import { INSTRUCTION_MAX_CHARS } from '../../utils/memoryLabels';

const TEAL = '#21C1B6';

/** The wording offered for saving: the tidied version when there is one. */
const suggestedText = (suggestion) => {
  const polished = String(suggestion?.source_ref?.polished || '').trim();
  return polished || String(suggestion?.text || '').trim();
};

/**
 * One suggestion, with the wording the advocate would be saving.
 *
 * What was said in chat is often a half sentence, so JuriNex offers a tidied
 * version. The advocate reads it, edits it or polishes it again, and only then
 * adds it; nothing is saved until they press the button.
 */
const SuggestionCard = ({
  suggestion,
  scope = 'case',
  busy = false,
  onAccept,
  onDismiss,
  acceptLabel,
  // A fact about the advocate is not an instruction, so there is nothing to polish.
  polishable = true,
  children,
}) => {
  const offered = suggestedText(suggestion);
  const spoken = String(suggestion?.text || '').trim();
  const [draft, setDraft] = useState(offered);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(null);
  const [notice, setNotice] = useState(null);

  const disabled = busy || working !== null;

  const polish = async () => {
    setWorking('polish');
    setNotice(null);
    try {
      const result = await memoryApi.polishInstruction(draft, scope);
      if (result?.problems?.length) setNotice({ tone: 'warning', message: result.problems[0].message });
      else if (result?.error === 'unavailable') setNotice({ tone: 'info', message: "Polish isn't available right now." });
      else if (!result?.changed) setNotice({ tone: 'success', message: 'Already clear as written.' });
      else {
        setDraft(result.polished);
        setNotice({ tone: 'success', message: 'Tidied. Add it, or edit it first.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', error: describeMemoryError(err, "Couldn't polish that right now.") });
    } finally {
      setWorking(null);
    }
  };

  const accept = async () => {
    const text = draft.trim();
    if (!text) return;
    setWorking('accept');
    setNotice(null);
    const result = await onAccept(text);
    setWorking(null);
    if (result && !result.ok) setNotice({ tone: 'error', error: result.error });
  };

  return (
    <li className="rounded-lg border border-gray-100 px-3 py-2.5" style={{ background: '#fafafa' }}>
      {children}

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, INSTRUCTION_MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(offered);
              setEditing(false);
            }
          }}
          rows={2}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/40"
        />
      ) : (
        <p className="text-xs text-gray-700 break-words">{draft}</p>
      )}

      {!editing && spoken && draft.trim() !== spoken && (
        <p className="text-[10px] text-gray-400 mt-1 break-words">You said: &ldquo;{spoken}&rdquo;</p>
      )}

      {notice && (
        <div className="mt-2">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-gray-400">{editing ? `${draft.length}/${INSTRUCTION_MAX_CHARS}` : ''}</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onDismiss()}
            disabled={disabled}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => setEditing((on) => !on)}
            disabled={disabled}
            title="Change the wording before adding it"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Pencil className="w-3 h-3" />
            {editing ? 'Done' : 'Edit'}
          </button>
          {polishable && (
            <button
              type="button"
              onClick={polish}
              disabled={disabled || !draft.trim()}
              title="Tidy the wording without changing what it asks"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {working === 'polish' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" style={{ color: TEAL }} />
              )}
              Polish
            </button>
          )}
          <button
            type="button"
            onClick={accept}
            disabled={disabled || !draft.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
            style={{ background: TEAL }}
          >
            <Check className="w-3.5 h-3.5" />
            {working === 'accept' ? 'Adding…' : acceptLabel || 'Add to instructions'}
          </button>
        </div>
      </div>
    </li>
  );
};

export default SuggestionCard;
