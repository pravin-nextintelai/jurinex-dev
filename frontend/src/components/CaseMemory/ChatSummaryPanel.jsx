import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquareText, RefreshCw } from 'lucide-react';
import memoryApi, { describeMemoryError } from '../../services/memoryApi';
import { formatDate, plural } from '../../utils/memoryLabels';

/**
 * The running summary of the open chat, for reading only.
 *
 * This is not case memory. Case memory holds the case's durable facts and stays until
 * the advocate forgets them; this is a condensed record of one conversation, rewritten
 * after each answer so older turns can be carried without their full text. It is already
 * part of what that chat sends, so it is shown here and never added to the case blocks.
 */
const ChatSummaryPanel = ({ folderName, sessionId }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!folderName) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await memoryApi.getChatSummary(folderName, sessionId);
      setState({ loading: false, data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: describeMemoryError(err, "Couldn't read this chat's summary.") });
    }
  }, [folderName, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const { loading, data, error } = state;
  const summary = data?.summary || null;
  const recentTurns = data?.recent_turns || 3;

  let body = null;
  if (loading && !data) {
    body = (
      <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3 animate-spin" />
        Reading this chat&apos;s summary…
      </p>
    );
  } else if (error) {
    body = <p className="text-[11px] text-gray-400">{error.message}</p>;
  } else if (data && !data.enabled) {
    body = <p className="text-[11px] text-gray-400">Chat summaries are switched off for this service.</p>;
  } else if (!sessionId) {
    body = (
      <p className="text-[11px] text-gray-400">
        Open this panel from a chat to see that conversation&apos;s summary.
      </p>
    );
  } else if (!summary) {
    body = (
      <p className="text-[11px] text-gray-400">
        Nothing yet. The last {plural(recentTurns, 'turn')} are sent in full, so a summary starts once this chat
        grows past them.
      </p>
    );
  } else {
    body = (
      <>
        <button
          type="button"
          onClick={() => setOpen((on) => !on)}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-800"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? 'Hide' : 'Show'} the summary
        </button>
        {open && (
          <p className="mt-2 text-[11px] leading-relaxed text-gray-600 whitespace-pre-wrap break-words">
            {summary.summary}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-gray-100 px-3.5 py-3" style={{ background: '#fafafa' }}>
      <div className="flex items-start gap-2">
        <MessageSquareText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: '#21C1B6' }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h4 className="text-[11px] font-bold text-gray-700">This chat&apos;s running summary</h4>
            {summary && (
              <span className="text-[10px] text-gray-400">
                {plural(summary.covered_turns, 'earlier turn')} · {formatDate(summary.updated_at)}
              </span>
            )}
            <button
              type="button"
              onClick={load}
              disabled={loading}
              title="Reload"
              className="ml-auto p-0.5 rounded text-gray-300 hover:text-gray-500 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 mb-2">
            Written by JuriNex from this conversation so older turns travel compactly. It is sent with the chat
            already, and it is not case memory — it goes when the chat does.
          </p>
          {body}
        </div>
      </div>
    </div>
  );
};

export default ChatSummaryPanel;
