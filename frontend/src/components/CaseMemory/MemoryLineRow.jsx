import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import { LINE_MAX_CHARS, TAG_STYLES, describeSource, describeUse, formatDate } from '../../utils/memoryLabels';

/** One remembered line: its origin tag, its text, where it came from, and edit/forget. */
const MemoryLineRow = ({ line, onSave, onDelete, disabled = false }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tag = TAG_STYLES[line.tag] || TAG_STYLES.stated;
  const meta = [describeSource(line), formatDate(line.updated_at || line.created_at), describeUse(line)]
    .filter(Boolean)
    .join(' · ');
  const hasChange = draft.trim() && draft.trim() !== String(line.text || '').trim();

  const startEditing = () => {
    setDraft(line.text || '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!hasChange) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(line, draft.trim());
    setSaving(false);
    if (result?.ok) setEditing(false);
    else setError(result?.error || { message: 'Could not save that change.' });
  };

  const forget = async () => {
    if (!window.confirm('Forget this line? It is deleted, not archived.')) return;
    setSaving(true);
    setError(null);
    const result = await onDelete(line);
    setSaving(false);
    if (!result?.ok) setError(result?.error || { message: 'Could not forget that line.' });
  };

  return (
    <li className="group rounded-lg border border-gray-100 px-3 py-2 hover:border-gray-200 transition-colors" style={{ background: '#fafafa' }}>
      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, LINE_MAX_CHARS))}
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
              {draft.length}/{LINE_MAX_CHARS} · saved as something you stated
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
                disabled={saving || !draft.trim()}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#21C1B6' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span
            className={`mt-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 ${tag.className}`}
            title={tag.hint}
          >
            {tag.label}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-700 break-words">{line.text}</p>
            {meta && <p className="text-[10px] text-gray-400 mt-0.5">{meta}</p>}
          </div>
          <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={startEditing}
              disabled={disabled || saving}
              title="Edit"
              aria-label="Edit this line"
              className="p-1 rounded hover:bg-white text-gray-400 hover:text-gray-600 disabled:opacity-40"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={forget}
              disabled={disabled || saving}
              title="Forget this line"
              aria-label="Forget this line"
              className="p-1 rounded hover:bg-white text-gray-400 hover:text-red-500 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
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

export default MemoryLineRow;
