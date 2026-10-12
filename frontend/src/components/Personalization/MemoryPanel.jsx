import React, { useCallback, useEffect, useState } from 'react';
import {
  Lock, ChevronDown, ChevronUp, Loader2, Search,
  Pencil, Trash2, Plus, Pin, PinOff, X, Check,
} from 'lucide-react';
import { toast } from 'react-toastify';
import {
  fetchMemoryTopics,
  rememberMemory,
  updateMemoryTopic,
  deleteMemoryTopic,
  searchMemory,
} from '../../services/personalizationService';
import { fmtDate } from './personalizationUtils';

const KIND_ORDER = ['profile', 'preferences', 'topics', 'areas', 'people'];
const KIND_LABEL = {
  profile: 'Profile',
  preferences: 'Preferences',
  topics: 'Topics',
  areas: 'Projects',
  people: 'People',
};

const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-[#21C1B6] hover:bg-[#1aa89e] text-white px-3 py-1.5 text-[12px] font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors';
const searchBtn =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:border-[#21C1B6] hover:text-[#127a72] disabled:opacity-50';

/**
 * Memory tab — shown only after Settings → Memory is on.
 *
 * FILES ONLY, the same shape as a Claude project memory: small subject notes the
 * assistant writes as you chat, which you can read, edit, pin and delete. Raw
 * conversations are NOT memory and are deliberately not shown here — chat history
 * lives in the chat UI.
 */
const MemoryPanel = ({
  folderName = null,
  status = null,
  statusLoading = false,
  pad = 'px-5 py-4',
  showContext = true,
  onRefresh = null,
}) => {
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [rememberText, setRememberText] = useState('');
  const [rememberScope, setRememberScope] = useState(folderName ? 'case' : 'global');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState(null);

  const extracting = Boolean(status?.memory?.extracting);
  const generateFromChats = Boolean(status?.memory?.generate_from_chats);
  const groupedTopics = KIND_ORDER
    .map((kind) => ({ kind, rows: topics.filter((t) => (t.kind || 'topics') === kind) }))
    .filter((g) => g.rows.length > 0);

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const rows = await fetchMemoryTopics(folderName);
      setTopics(Array.isArray(rows) ? rows : []);
    } catch {
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  }, [folderName]);

  useEffect(() => {
    loadTopics();
    setRememberScope(folderName ? 'case' : 'global');
    setEditingId(null);
    setSearchHits(null);
    setSearchQ('');
  }, [folderName, loadTopics]);

  useEffect(() => {
    if (!extracting) return undefined;
    const t = setTimeout(() => { loadTopics(); onRefresh?.(); }, 2500);
    return () => clearTimeout(t);
  }, [extracting, loadTopics, onRefresh]);

  const handleRemember = async () => {
    const text = rememberText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await rememberMemory({
        text,
        folderName: rememberScope === 'case' ? folderName : null,
      });
      setRememberText('');
      toast.success('Saved to memory.');
      await loadTopics();
      onRefresh?.();
    } catch (err) {
      toast.error(err?.message || 'Could not save that note.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditTitle(t.title || '');
    setEditContent(t.content || '');
    setNotesOpen(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateMemoryTopic(editingId, { title: editTitle.trim(), content: editContent.trim() });
      setEditingId(null);
      toast.success('Memory updated.');
      await loadTopics();
    } catch (err) {
      toast.error(err?.message || 'Could not update that note.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    try {
      await deleteMemoryTopic(t.id);
      toast.info(`Forgot “${t.title}”.`);
      if (editingId === t.id) setEditingId(null);
      await loadTopics();
      onRefresh?.();
    } catch (err) {
      toast.error(err?.message || 'Could not delete that note.');
    }
  };

  const handlePin = async (t) => {
    try {
      await updateMemoryTopic(t.id, { pinned: !t.pinned });
      await loadTopics();
    } catch (err) {
      toast.error(err?.message || 'Could not update pin.');
    }
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hits = await searchMemory(q, folderName);
      setSearchHits({ topics: Array.isArray(hits?.topics) ? hits.topics : [] });
    } catch (err) {
      toast.error(err?.message || 'Search failed.');
      setSearchHits({ topics: [] });
    } finally {
      setSearching(false);
    }
  };

  const TopicCard = ({ t }) => {
    const isCase = Boolean(t.folder_name);
    const editing = editingId === t.id;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-[12.5px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
              />
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12.5px] font-semibold text-slate-900 leading-snug">{t.title}</span>
                {t.path && (
                  <span className="font-mono text-[10px] text-slate-400 truncate max-w-[11rem]" title={t.path}>{t.path}</span>
                )}
                {t.pinned && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#127a72]">Pinned</span>
                )}
                {t.sensitive && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Sensitive</span>
                )}
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isCase ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {isCase ? 'This case' : 'All cases'}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1">
            {editing ? (
              <>
                <button type="button" className={ghostBtn} onClick={saveEdit} disabled={saving} title="Save">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                </button>
                <button type="button" className={ghostBtn} onClick={() => setEditingId(null)} title="Cancel">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button type="button" className={ghostBtn} onClick={() => handlePin(t)} title={t.pinned ? 'Unpin' : 'Pin'}>
                  {t.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className={ghostBtn} onClick={() => startEdit(t)} title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={ghostBtn} onClick={() => handleDelete(t)} title="Forget">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </>
            )}
          </div>
        </div>
        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12.5px] text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
          />
        ) : (
          <>
            {t.description ? (
              <p className="mt-1 text-[12px] text-slate-500 leading-snug">{t.description}</p>
            ) : null}
            <ul className="mt-1.5 space-y-1">
              {String(t.content || '').split('\n').filter((line) => line.trim()).map((line, i) => {
                const m = line.trim().match(/^[-*•]?\s*\[(stated|inferred)\]\s*(.*)$/i);
                const tag = m ? m[1].toLowerCase() : null;
                const body = m ? m[2] : line.replace(/^[-*•]\s*/, '');
                return (
                  <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-700 leading-snug">
                    {tag && (
                      <span className={`mt-0.5 flex-shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${
                        tag === 'stated' ? 'bg-[#E0F7F6] text-[#127a72]' : 'bg-slate-100 text-slate-500'
                      }`}
                      >
                        {tag}
                      </span>
                    )}
                    <span className="min-w-0">{body}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-1.5 text-[10.5px] text-slate-400">
          {t.origin === 'explicit' ? 'You saved this' : t.origin === 'edited' ? 'Edited by you' : 'Learned from chats'}
          {t.updated_at ? ` · ${fmtDate(t.updated_at)}` : ''}
        </div>
      </div>
    );
  };

  return (
    <section className={`cpb-msg ${pad} ${showContext ? 'border-b border-slate-100' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Memory</h3>
          <p className="text-[12px] text-slate-500 mt-1 leading-snug">
            Small subject files — profile, preferences, topics, projects, people. Chat loads a listing, then only the files that match.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11.5px] text-slate-600 flex-shrink-0">
          <Lock className="h-3 w-3" />
          Only you
        </span>
      </div>

      {extracting && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#E0F7F6] px-2 py-1 text-[11.5px] text-[#127a72]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating notes from this chat…
        </div>
      )}

      {topics.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-500 leading-snug">
          {statusLoading
            ? 'Loading…'
            : generateFromChats
              ? 'No files yet. Durable facts are filed after you chat — or save a note below, or say “remember this”.'
              : 'No files yet. Notes appear as you chat, or save one below or say “remember this”.'}
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500 leading-snug">
          {topics.length} file{topics.length === 1 ? '' : 's'}
          {generateFromChats ? ' · learning from chats' : ''}
        </p>
      )}

      <div className="mt-2.5">
        <textarea
          value={rememberText}
          onChange={(e) => setRememberText(e.target.value)}
          placeholder="Remember this…"
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
        />
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {folderName && (
            <>
              <button
                type="button"
                onClick={() => setRememberScope('case')}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  rememberScope === 'case'
                    ? 'bg-[#E0F7F6] text-[#127a72] border-[#21C1B6]/50'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                This case
              </button>
              <button
                type="button"
                onClick={() => setRememberScope('global')}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  rememberScope === 'global'
                    ? 'bg-[#E0F7F6] text-[#127a72] border-[#21C1B6]/50'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                All cases
              </button>
            </>
          )}
          <span className="flex-1" />
          <button type="button" onClick={handleRemember} disabled={saving || !rememberText.trim()} className={primaryBtn}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Save note
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1 flex-wrap -ml-2.5">
        <button type="button" onClick={() => setNotesOpen((v) => !v)} className={ghostBtn}>
          {notesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {notesOpen ? 'Hide files' : `Files${topics.length ? ` (${topics.length})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => { setSearchOpen((v) => !v); setSearchHits(null); }}
          className={ghostBtn}
        >
          <Search className="h-3.5 w-3.5" />
          Search files
        </button>
      </div>

      {searchOpen && (
        <div className="mt-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Search your memory files…"
              autoFocus
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30 focus:border-[#21C1B6]"
            />
            <button type="button" onClick={runSearch} disabled={searching || !searchQ.trim()} className={searchBtn}>
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </button>
          </div>
          {searchHits && (
            <div className="mt-2 space-y-2">
              {(searchHits.topics || []).length > 0 ? (
                <div className="space-y-2">
                  {searchHits.topics.map((t) => <TopicCard key={`s-${t.id}`} t={t} />)}
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">No memory file matched that.</p>
              )}
            </div>
          )}
        </div>
      )}

      {notesOpen && (
        <div className="mt-2 space-y-3">
          {topicsLoading && topics.length === 0 && (
            <div className="flex items-center gap-2 text-[12px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading files…
            </div>
          )}
          {groupedTopics.map((g) => (
            <div key={g.kind}>
              <div className="text-[10.5px] uppercase tracking-wide text-slate-500 mb-1.5">
                {KIND_LABEL[g.kind] || g.kind}
              </div>
              <div className="space-y-2">
                {g.rows.map((t) => <TopicCard key={t.id} t={t} />)}
              </div>
            </div>
          ))}
          {!topicsLoading && topics.length === 0 && (
            <p className="text-[12px] text-slate-500 leading-snug">No memory files yet.</p>
          )}
        </div>
      )}

    </section>
  );
};

export default MemoryPanel;
