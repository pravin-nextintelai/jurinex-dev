import React, { useState, useMemo } from 'react';
import { MessageSquare, Trash2, Clock, Search, X } from 'lucide-react';

/* ── Date helpers ────────────────────────────────────────────────────────── */
const formatRelativeTime = (value) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    const now = new Date();
    const diffS = Math.max(0, Math.floor((now - date) / 1000));
    if (diffS < 60)    return 'Just now';
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60)    return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24)    return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1)   return 'Yesterday';
    if (diffD < 7)     return `${diffD}d ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

const getGroupLabel = (value) => {
  if (!value) return 'Older';
  try {
    const date = new Date(value);
    const now = new Date();
    const diffMs = now - date;
    const diffH = diffMs / 3_600_000;
    if (diffH < 24)   return 'Today';
    if (diffH < 48)   return 'Yesterday';
    if (diffH < 168)  return 'This Week';
    return 'Older';
  } catch { return 'Older'; }
};

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];

/* ── Component ───────────────────────────────────────────────────────────── */
const ChatSessionList = ({ sessions, selectedSessionId, onSelectSession, onDeleteSession }) => {
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, query]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((s) => {
      const g = getGroupLabel(s.lastMessageAt);
      if (!map[g]) map[g] = [];
      map[g].push(s);
    });
    return map;
  }, [filtered]);

  /* ── Empty state ─────────────────────────────────────────────────────── */
  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'linear-gradient(135deg,#f0fdfb,#e0f7f5)' }}>
          <MessageSquare className="h-5 w-5" style={{ color: '#21C1B6' }} />
        </div>
        <p className="text-sm font-semibold text-gray-700 mb-1">No conversations yet</p>
        <p className="text-xs text-gray-400 leading-relaxed max-w-[160px]">
          Upload a document and ask a question to start chatting.
        </p>
      </div>
    );
  }

  const handleDelete = (e, id) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      onDeleteSession?.(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 focus-within:border-[#21C1B6] transition-colors">
          <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Grouped session list */}
      <div className="flex-1 overflow-y-auto space-y-1 pb-4 px-2">
        {filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-gray-400">No results for "{query}"</div>
        )}
        {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
          <div key={group}>
            {/* Date divider */}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{group}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Sessions in this group */}
            {grouped[group].map((session, idx) => {
              const isSelected = selectedSessionId === session.sessionId;
              const name = session.title && session.title !== 'Untitled session'
                ? session.title
                : `Session ${idx + 1}`;
              const isConfirming = confirmDelete === session.sessionId;

              return (
                <div
                  key={session.sessionId}
                  onClick={() => onSelectSession(session.sessionId)}
                  className={`group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer rounded-xl transition-all duration-150 ${
                    isSelected
                      ? 'shadow-sm'
                      : 'hover:bg-white hover:shadow-sm'
                  }`}
                  style={isSelected
                    ? { background: '#fff', border: '1px solid rgba(33,193,182,0.2)', boxShadow: '0 1px 8px rgba(33,193,182,0.10)' }
                    : { border: '1px solid transparent' }
                  }
                >
                  {/* Teal left accent for selected */}
                  {isSelected && (
                    <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: '#21C1B6' }} />
                  )}

                  {/* Icon */}
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                    isSelected ? 'bg-[#e0f7f5]' : 'bg-gray-100 group-hover:bg-[#e0f7f5]'
                  }`}>
                    <MessageSquare className="h-3 w-3" style={{ color: isSelected ? '#21C1B6' : '#9ca3af' }} />
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-5 line-clamp-2 transition-colors ${
                      isSelected ? 'text-gray-900' : 'text-gray-600 group-hover:text-gray-800'
                    }`}>
                      {name}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />
                      <span className="text-[10px] text-gray-400">
                        {formatRelativeTime(session.lastMessageAt)}
                      </span>
                      {Number(session.chat_count) > 1 && (
                        <span className="text-[10px] text-gray-400">
                          · {session.chat_count} Q&A
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, session.sessionId)}
                    title={isConfirming ? 'Click again to confirm delete' : 'Delete session'}
                    className={`opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 rounded-lg transition-all ${
                      isConfirming
                        ? 'opacity-100 bg-red-50 text-red-500 border border-red-200'
                        : 'text-gray-300 hover:text-red-400 hover:bg-red-50'
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatSessionList;
