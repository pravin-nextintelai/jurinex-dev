import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import ChatSummaryPanel from './ChatSummaryPanel';
import MemoryLineRow from './MemoryLineRow';
import MemoryNotice from './MemoryNotice';
import { LINE_MAX_CHARS, MEMORY_SECTIONS, plural } from '../../utils/memoryLabels';

const noticeFor = (result) => ({
  tone: result.error?.kind === 'conflict' ? 'warning' : 'error',
  error: result.error,
});

/** "What JuriNex knows about this case": sections, lines, and the controls to change them. */
const MemoryFactsTab = ({ memory, effective, folderName, sessionId }) => {
  const {
    overview,
    sections,
    autoSeeding,
    loadSection,
    addLine,
    editLine,
    deleteLine,
    clearSection,
    forgetAll,
    seed,
  } = memory;

  const counts = useMemo(() => {
    const map = {};
    (overview?.sections || []).forEach((row) => {
      map[row.section] = Number(row.line_count) || 0;
    });
    return map;
  }, [overview]);

  const totalLines = overview?.line_count || 0;
  const [selected, setSelected] = useState(null);
  const active = selected || MEMORY_SECTIONS.find((section) => counts[section.id] > 0)?.id || 'summary';
  const activeMeta = MEMORY_SECTIONS.find((section) => section.id === active) || MEMORY_SECTIONS[0];
  const entry = sections[active];
  const lines = entry?.lines || [];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!entry) loadSection(active);
  }, [active, entry, loadSection]);

  const selectSection = (id) => {
    setSelected(id);
    setAdding(false);
    setDraft('');
    setNotice(null);
  };

  const submitLine = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setNotice(null);
    const result = await addLine(active, text);
    setBusy(false);
    if (result.ok) {
      setDraft('');
      setAdding(false);
    } else {
      setNotice(noticeFor(result));
    }
  };

  const handleClearSection = async () => {
    if (!window.confirm(`Forget every line in ${activeMeta.label}? They are deleted and cannot be recovered.`)) return;
    setBusy(true);
    setNotice(null);
    const result = await clearSection(active);
    setBusy(false);
    if (!result.ok) setNotice(noticeFor(result));
  };

  const handleForgetAll = async () => {
    if (
      !window.confirm(
        "Forget everything JuriNex remembers about this case, including its instructions and suggestions? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await forgetAll();
    setBusy(false);
    setNotice(
      result.ok
        ? { tone: 'success', message: "This case's memory has been cleared." }
        : { tone: 'error', error: result.error },
    );
  };

  const handleSeed = async () => {
    setBusy(true);
    setNotice(null);
    const result = await seed();
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', error: result.error });
      return;
    }
    const { added = 0, updated = 0, skipped_reason: reason } = result.report || {};
    if (reason === 'disabled_by_user') {
      setNotice({ tone: 'warning', message: 'Memory generation is turned off, so nothing was added.' });
    } else if (!added && !updated) {
      setNotice({ tone: 'info', message: 'Nothing new to add from the case details.' });
    } else {
      const parts = [added ? `added ${plural(added, 'line')}` : '', updated ? `updated ${plural(updated, 'line')}` : '']
        .filter(Boolean)
        .join(' and ');
      setNotice({ tone: 'success', message: `From the case details, JuriNex ${parts}.` });
    }
  };

  return (
    <div>
      {!effective.enabled && (
        <div className="mb-3">
          <MemoryNotice tone="warning">
            Memory is turned off, so JuriNex is not using this case&apos;s memory when it answers. You can still review
            and edit it here.
          </MemoryNotice>
        </div>
      )}
      {effective.enabled && !effective.write_enabled && (
        <div className="mb-3">
          <MemoryNotice tone="info">
            Generating memory from chats is off, so JuriNex won&apos;t add lines on its own. You can still add and
            edit them here.
          </MemoryNotice>
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}

      {totalLines === 0 && autoSeeding && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 mb-4 text-center">
          <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" style={{ color: '#21C1B6' }} />
          <p className="text-xs font-semibold text-gray-700">Filling in from the case details</p>
          <p className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto">
            JuriNex is reading this case&apos;s details, chronology and documents. It takes a few seconds.
          </p>
        </div>
      )}
      {totalLines === 0 && !autoSeeding && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 mb-4 text-center">
          <Sparkles className="w-5 h-5 mx-auto mb-2" style={{ color: '#21C1B6' }} />
          <p className="text-xs font-semibold text-gray-700">Nothing remembered about this case yet</p>
          <p className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto">
            {overview?.seed?.auto_seed === false
              ? "You cleared this case's memory, so JuriNex won't fill it in from the case details on its own. Facts and decisions you state in chat are still added as you work."
              : 'Facts and decisions you state in chat are added as you work, and JuriNex fills in what the case details, chronology and documents show. You can also add a line yourself.'}
          </p>
          <button
            type="button"
            onClick={handleSeed}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: '#21C1B6' }}
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            Fill from case details
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Memory sections">
        {MEMORY_SECTIONS.map((section) => {
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectSection(section.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                isActive
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#21C1B6] hover:text-[#0d9488]'
              }`}
              style={isActive ? { background: '#21C1B6' } : undefined}
            >
              {section.label}
              <span
                className={`min-w-[1.1rem] px-1 rounded-full text-[10px] ${
                  isActive ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {counts[section.id] || 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-gray-800">{activeMeta.label}</h3>
          <p className="text-[11px] text-gray-400">{activeMeta.description}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setNotice(null);
            }}
            disabled={busy || adding}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-[#f0fdfb] disabled:opacity-50"
            style={{ color: '#21C1B6' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add a line
          </button>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleClearSection}
              disabled={busy}
              title={`Forget every line in ${activeMeta.label}`}
              aria-label={`Forget every line in ${activeMeta.label}`}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* The chat's own running summary, next to the case summary it is often mistaken for. */}
      {active === 'summary' && <ChatSummaryPanel folderName={folderName} sessionId={sessionId} />}

      {adding && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-2.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, LINE_MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitLine();
            }}
            rows={2}
            placeholder={`One fact for ${activeMeta.label.toLowerCase()}, in your own words`}
            className="w-full text-xs text-gray-700 resize-none outline-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-gray-400">
              {draft.length}/{LINE_MAX_CHARS} · saved as something you stated
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft('');
                }}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitLine}
                disabled={busy || !draft.trim()}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#21C1B6' }}
              >
                {busy ? 'Saving…' : 'Save line'}
              </button>
            </div>
          </div>
        </div>
      )}

      {entry?.loading && !entry?.lines && (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      )}
      {entry?.error && (
        <MemoryNotice tone="error">{entry.error.message}</MemoryNotice>
      )}
      {entry && !entry.error && entry.lines && lines.length === 0 && !adding && (
        <p className="text-[11px] text-gray-400 py-6 text-center">Nothing recorded in {activeMeta.label} yet.</p>
      )}
      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <MemoryLineRow
              key={line.id}
              line={line}
              disabled={busy}
              onSave={(target, text) => editLine(active, target, text)}
              onDelete={(target) => deleteLine(active, target)}
            />
          ))}
        </ul>
      )}

      {totalLines > 0 && (
        <div className="mt-5 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] text-gray-400">A line you forget is deleted, not archived.</p>
          <button
            type="button"
            onClick={handleForgetAll}
            disabled={busy}
            className="text-[11px] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            Forget everything about this case
          </button>
        </div>
      )}
    </div>
  );
};

export default MemoryFactsTab;
