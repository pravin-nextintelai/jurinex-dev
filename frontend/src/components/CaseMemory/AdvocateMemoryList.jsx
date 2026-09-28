import React, { useState } from 'react';
import { Plus, RefreshCw, Sparkles, Undo2, UserRound } from 'lucide-react';
import MemoryLineRow from './MemoryLineRow';
import MemoryNotice from './MemoryNotice';
import { ADVOCATE_CATEGORIES, LINE_MAX_CHARS, plural } from '../../utils/memoryLabels';

const TEAL = '#21C1B6';

/** Pick a category, type a fact about yourself, add it. */
const AddFact = ({ memory }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(ADVOCATE_CATEGORIES[0].id);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const example = ADVOCATE_CATEGORIES.find((item) => item.id === category)?.example || '';

  const reset = () => {
    setOpen(false);
    setDraft('');
    setError(null);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    const result = await memory.add(category, text);
    setBusy(false);
    if (result.ok) reset();
    else setError(result.error);
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
        Add something about you
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {ADVOCATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            title={item.description}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
              category === item.id ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            style={category === item.id ? { background: TEAL } : undefined}
          >
            {item.label}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, LINE_MAX_CHARS))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            reset();
          }
        }}
        rows={2}
        placeholder={`e.g. ${example}`}
        className="w-full text-xs text-gray-700 resize-none outline-none"
      />
      {error && (
        <div className="mt-2">
          <MemoryNotice tone={error.kind === 'conflict' ? 'warning' : 'error'} problems={error.problems || []}>
            {error.message}
          </MemoryNotice>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-[10px] text-gray-400">
          {draft.length}/{LINE_MAX_CHARS}
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
            onClick={submit}
            disabled={busy || !draft.trim()}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
            style={{ background: TEAL }}
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * What JuriNex remembers about the advocate, for every case: learned from what
 * they say about themselves in any case chat, or added here. Each line can be
 * edited or forgotten; a forgotten line JuriNex learned is not learned again.
 */
const AdvocateMemoryList = ({ memory, switchedOff = false }) => {
  const { lines, loading, loaded, error, limits, usedChars, canConsolidate, consolidation, reach } = memory;
  const [forgetting, setForgetting] = useState(false);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const fullness = Math.min(1, (Number(usedChars) || 0) / (limits.maxChars || 3000));
  const nearlyFull = fullness >= 0.8;

  const tidy = async () => {
    setBusy('tidy');
    setNotice(null);
    const result = await memory.consolidate();
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: 'error', error: result.error });
      return;
    }
    const { lines_before: before, lines_after: after, changed, error: why } = result.data || {};
    if (changed) {
      setNotice({ tone: 'success', message: `Tidied ${before} facts into ${after}. You can undo this.` });
    } else if (why === 'unavailable') {
      setNotice({ tone: 'info', message: "Tidying isn't available right now." });
    } else {
      setNotice({ tone: 'info', message: 'Nothing worth merging — each fact says something different.' });
    }
  };

  const undo = async () => {
    setBusy('undo');
    setNotice(null);
    const result = await memory.undoConsolidation();
    setBusy(null);
    setNotice(
      result.ok
        ? { tone: 'success', message: `Put back ${plural(result.data?.restored || 0, 'fact')}.` }
        : { tone: 'error', error: result.error },
    );
  };

  const forgetAll = async () => {
    if (!window.confirm('Forget everything JuriNex remembers about you? This is deleted, not archived.')) return;
    setForgetting(true);
    setNotice(null);
    const result = await memory.forgetAll();
    setForgetting(false);
    setNotice(result.ok ? { tone: 'success', message: 'JuriNex no longer remembers anything about you.' } : { tone: 'error', error: result.error });
  };

  return (
    <section className="mb-5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <UserRound className="w-3.5 h-3.5" style={{ color: TEAL }} />
            <h3 className="text-xs font-bold text-gray-800">What JuriNex knows about you</h3>
          </div>
          <p className="text-[11px] text-gray-400">
            Learned from what you tell JuriNex about yourself in any case chat, and used in every case. Nothing about a
            single matter is kept here.
          </p>
        </div>
        {loaded && lines.length > 0 && (
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            {lines.length} of {limits.maxLines}
          </span>
        )}
      </div>

      {/* Two different numbers: what the set holds, and what a question carries.
          Near the ceiling JuriNex merges overlapping facts rather than stopping at
          "full"; this is the same pass on request. */}
      {loaded && lines.length > 0 && (
        <div className="mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 w-10 flex-shrink-0">Stored</span>
            <div className="h-1 flex-1 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.round(fullness * 100)}%`, background: nearlyFull ? '#f59e0b' : TEAL }}
              />
            </div>
            <span className="text-[10px] text-gray-400 whitespace-nowrap">
              {usedChars}/{limits.maxChars}
            </span>
          </div>
          {reach.budgetChars > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-gray-400 w-10 flex-shrink-0">Sent</span>
              <div className="h-1 flex-1 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round(Math.min(1, reach.sentChars / reach.budgetChars) * 100)}%`,
                    background: '#94a3b8',
                  }}
                />
              </div>
              <span className="text-[10px] text-gray-400 whitespace-nowrap">
                {reach.sentChars}/{reach.budgetChars}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
            <span className="text-[10px] text-gray-400">
              {reach.unsentLines > 0
                ? `${plural(reach.unsentLines, 'fact')} won't fit in a question — JuriNex sends whichever suit it`
                : 'Every fact fits in a question'}
              {nearlyFull ? ' · nearly full' : ''}
            </span>
            <div className="flex items-center gap-2">
              {consolidation && (
                <button
                  type="button"
                  onClick={undo}
                  disabled={busy !== null}
                  title={`Put back the ${consolidation.lines_before} facts as they were`}
                  className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                  <Undo2 className="w-3 h-3" />
                  {busy === 'undo' ? 'Putting back…' : 'Undo the last tidy'}
                </button>
              )}
              {(canConsolidate || nearlyFull) && (
                <button
                  type="button"
                  onClick={tidy}
                  disabled={busy !== null}
                  title="Merge facts that say the same thing, so there is room for more"
                  className="flex items-center gap-1 text-[10px] font-semibold disabled:opacity-50"
                  style={{ color: TEAL }}
                >
                  {busy === 'tidy' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {busy === 'tidy' ? 'Tidying…' : 'Tidy these up'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {switchedOff && (
        <div className="mb-2">
          <MemoryNotice tone="info">
            “Remember me across cases” is off, so these are kept but not used, and nothing new is learned.
          </MemoryNotice>
        </div>
      )}
      {error && <MemoryNotice tone="error">{error.message}</MemoryNotice>}
      {notice && (
        <div className="mb-2">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}
      {!loaded && loading && (
        <div className="flex items-center gap-2 py-4 text-gray-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      )}
      {loaded && lines.length === 0 && (
        <p className="text-[11px] text-gray-400 py-3">
          Nothing yet. Tell JuriNex about your practice in any chat, for example “I mostly appear before the Aurangabad
          Bench”, or add it here.
        </p>
      )}

      {ADVOCATE_CATEGORIES.map((category) => {
        const rows = lines.filter((line) => line.category === category.id);
        if (!rows.length) return null;
        return (
          <div key={category.id} className="mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{category.label}</p>
            <ul className="space-y-1.5">
              {rows.map((line) => (
                <MemoryLineRow
                  key={line.id}
                  line={line}
                  onSave={(row, text) => memory.update(row, { text })}
                  onDelete={(row) => memory.remove(row)}
                />
              ))}
            </ul>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {loaded && lines.length < limits.maxLines ? <AddFact memory={memory} /> : <span />}
        {loaded && lines.length > 0 && (
          <button
            type="button"
            onClick={forgetAll}
            disabled={forgetting}
            className="mt-2 text-[11px] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            {forgetting ? 'Forgetting…' : 'Forget everything about me'}
          </button>
        )}
      </div>
    </section>
  );
};

export default AdvocateMemoryList;
