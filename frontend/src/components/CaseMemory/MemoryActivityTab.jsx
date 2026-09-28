import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Hourglass,
  Lightbulb,
  PauseCircle,
  RefreshCw,
} from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import memoryApi, { describeMemoryError } from '../../services/memoryApi';
import { plural } from '../../utils/memoryLabels';

const TEAL = '#21C1B6';

// How each kind of outcome looks. "nothing" is the common case and stays quiet.
const OUTCOMES = {
  saved: { Icon: CheckCircle2, color: TEAL },
  suggested: { Icon: Lightbulb, color: '#d97706' },
  noticed: { Icon: Hourglass, color: '#6366f1' },
  nothing: { Icon: Circle, color: '#cbd5e1' },
  skipped: { Icon: PauseCircle, color: '#94a3b8' },
  off: { Icon: PauseCircle, color: '#d97706' },
  error: { Icon: AlertTriangle, color: '#ef4444' },
};

const whenLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
};

const dayLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const POLL_MS = 3000;

/**
 * Earlier messages memory has not read yet: from before memory could read them, or read
 * by an older version of it. Offers to read them now and shows progress while it runs.
 */
const EarlierMessages = ({ folderName, onFinished }) => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await memoryApi.getRereadStatus(folderName);
      setStatus(data);
      return data;
    } catch (err) {
      setError(describeMemoryError(err, "Couldn't check earlier messages."));
      return null;
    }
  }, [folderName]);

  useEffect(() => {
    load();
  }, [load]);

  const running = ['queued', 'running'].includes(status?.job?.state);

  // While a run is going, check on it; when it ends, the activity list has new rows.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(async () => {
      const data = await load();
      if (data && !['queued', 'running'].includes(data?.job?.state)) onFinished?.();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load, onFinished]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      setStatus(await memoryApi.startReread(folderName));
    } catch (err) {
      setError(describeMemoryError(err, "Couldn't start reading earlier messages."));
    } finally {
      setStarting(false);
    }
  };

  if (error) {
    return (
      <div className="mb-3">
        <MemoryNotice tone="error">{error.message}</MemoryNotice>
      </div>
    );
  }
  if (!status) return null;

  const job = status.job;
  if (running) {
    const planned = job.turns_planned || 0;
    return (
      <div className="mb-3 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2 flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: TEAL }} />
        <p className="text-[11px] text-gray-700">
          {job.state === 'queued'
            ? 'Waiting to read your earlier messages…'
            : `Reading your earlier messages${planned ? `: ${job.turns_read} of ${planned}` : '…'}`}
          {job.reviews ? `, ${plural(job.reviews, 'chat')} reviewed` : ''}
          {job.saved || job.suggested ? ` (${job.saved} saved, ${job.suggested} suggested so far)` : ''}
        </p>
      </div>
    );
  }

  const unread = status.unread || 0;
  const finished = job && ['done', 'stopped'].includes(job.state) && !job.automatic;
  if (!unread && !finished) return null;

  return (
    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      {finished && (
        <p className="text-[11px] text-gray-700">
          {job.state === 'stopped' && job.stopped_reason === 'model_unavailable'
            ? `Stopped after ${plural(job.turns_read, 'earlier message')}: the memory model was unavailable. Try again later.`
            : `Read ${plural(job.turns_read, 'earlier message')}${job.reviews ? ` and reviewed ${plural(job.reviews, 'chat')}` : ''}: ${job.saved} saved, ${job.suggested} suggested.`}
        </p>
      )}
      {unread > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-600">
            {plural(unread, 'earlier message')} in this case {unread === 1 ? "hasn't" : "haven't"} been read by memory yet.
            {' '}Nothing newer is overwritten, nothing you deleted comes back, and rules are only suggested.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white disabled:opacity-60"
            style={{ backgroundColor: TEAL }}
          >
            {starting ? 'Starting…' : 'Read them now'}
          </button>
        </div>
      )}
    </div>
  );
};

const itemLine = (item) => {
  switch (item.kind) {
    case 'fact': {
      const from = item.document ? ` from ${item.document}${item.page ? ` p.${item.page}` : ''}` : '';
      if (item.merged_from) return `Added to what ${item.section_label} already held${from}: ${item.text}`;
      return `${item.updated ? 'Updated' : 'Saved'} in ${item.section_label}${from}: ${item.text}`;
    }
    case 'merged':
      return `Combined ${plural(item.count, 'line')} saying the same fact into one, in ${item.section_label}: ${item.text}`;
    case 'removed_repeat':
      return `Removed a repeat of your line “${item.kept}”: ${item.text}`;
    case 'moved':
      return `Moved to ${item.to_label}: ${item.text}`;
    case 'instruction':
      return `Saved to ${item.scope === 'user' ? 'your standing instructions' : "this case's instructions"}: ${item.text}`;
    case 'suggestion':
      if (item.scope === 'about_you') return `Noticed across your cases, about you (Settings → Memory): ${item.text}`;
      return `Suggested${item.scope === 'user' ? ' for all your cases (Settings → Memory)' : ''}: ${item.text}`;
    case 'noticed':
      return `Counting: “${item.text}” (asked ${item.count} of ${item.needed} times before it is suggested)`;
    case 'about_you':
      return `Remembered about you: ${item.text}`;
    case 'made_room':
      return `Forgot an unused fact about you to make room: ${item.text}`;
    case 'tidied':
      return `Tidied what it knows about you: ${item.lines_before} facts into ${item.lines_after}`;
    case 'filled_in':
      return `Filled in ${plural(item.added + item.updated, 'line')} from the case details`;
    case 'uploaded':
      return `After processing: ${item.documents.join(', ')}`;
    case 'reviewed':
      if (item.trigger === 'reread') return `Reviewed an earlier chat of ${plural(item.turns, 'message')}`;
      return item.trigger === 'after_break'
        ? `Reviewed ${plural(item.turns, 'message')} from your previous chat in this case`
        : `Reviewed your last ${plural(item.turns, 'message')} together`;
    default:
      return item.text || '';
  }
};

/**
 * What memory did with each of your recent turns in this case, and why.
 *
 * Most turns keep nothing, because most messages are questions, and an empty memory
 * panel otherwise looks the same as a broken one. Each row here says which it was.
 */
const MemoryActivityTab = ({ folderName, refreshToken = 0 }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  // Shown by default: "why is memory empty?" is answered by exactly these rows.
  const [showQuiet, setShowQuiet] = useState(true);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await memoryApi.getActivity(folderName, 30);
      setState({ loading: false, data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: describeMemoryError(err, "Couldn't load memory activity.") });
    }
  }, [folderName]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const { loading, data, error } = state;
  const entries = data?.entries || [];
  const summary = data?.summary || {};
  const quiet = entries.filter((entry) => entry.outcome === 'nothing' || entry.outcome === 'skipped').length;
  const visible = showQuiet ? entries : entries.filter((entry) => entry.outcome !== 'nothing' && entry.outcome !== 'skipped');

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-gray-800">What memory did with your messages</h3>
          <p className="text-[11px] text-gray-400">
            JuriNex keeps what you state (a fact, a decision, how you want answers written), not what you ask.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Reload"
          className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-3">
          <MemoryNotice tone="error">{error.message}</MemoryNotice>
        </div>
      )}

      <EarlierMessages folderName={folderName} onFinished={load} />

      {loading && !data && (
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading activity…</span>
        </div>
      )}

      {data && entries.length === 0 && (
        <p className="text-[11px] text-gray-400 py-8 text-center">
          No messages in this case yet. Once you chat, each message shows here with what memory did about it.
        </p>
      )}

      {data && entries.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[11px] text-gray-500">
            <span className="font-semibold text-gray-700">Last {plural(summary.turns || 0, 'message')}:</span>
            {summary.saved ? <span>{summary.saved} saved</span> : null}
            {summary.suggested ? <span>{summary.suggested} suggested</span> : null}
            {summary.noticed ? <span>{summary.noticed} being counted</span> : null}
            <span>{(summary.nothing || 0) + (summary.skipped || 0)} with nothing to keep</span>
            {summary.error ? <span className="text-red-500">{summary.error} not checked</span> : null}
            {quiet > 0 && (
              <button
                type="button"
                onClick={() => setShowQuiet((on) => !on)}
                className="ml-auto font-semibold hover:underline"
                style={{ color: TEAL }}
              >
                {showQuiet ? 'Hide messages with nothing to keep' : `Show all ${entries.length}`}
              </button>
            )}
          </div>

          {visible.length === 0 && (
            <p className="text-[11px] text-gray-400 py-6 text-center">
              None of your recent messages had anything to keep.{' '}
              <button type="button" onClick={() => setShowQuiet(true)} className="font-semibold" style={{ color: TEAL }}>
                See why
              </button>
            </p>
          )}

          <ul className="space-y-1.5">
            {visible.map((entry) => {
              const look = OUTCOMES[entry.outcome] || OUTCOMES.nothing;
              const OutcomeIcon = look.Icon;
              return (
                <li key={entry.id || entry.created_at} className="rounded-lg border border-gray-100 px-3 py-2 bg-white">
                  <div className="flex items-start gap-2">
                    <OutcomeIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: look.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-800">{entry.headline}</p>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{whenLabel(entry.created_at)}</span>
                      </div>
                      {entry.reread && (
                        <p className="text-[10px] font-semibold text-indigo-500 mt-0.5">
                          {entry.asked_at ? `Earlier message from ${dayLabel(entry.asked_at)}, read again` : 'Earlier chat, read again'}
                        </p>
                      )}
                      {entry.question && (
                        <p className="text-[11px] text-gray-500 mt-0.5 break-words">
                          {entry.preset ? 'Saved prompt: ' : 'You: '}&ldquo;{entry.question}&rdquo;
                        </p>
                      )}
                      {entry.items.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {entry.items.map((item, index) => (
                            <li key={index} className="text-[11px] text-gray-700 break-words">
                              {itemLine(item)}
                              {item.spoken && (
                                <span className="block text-[10px] text-gray-400">You said: &ldquo;{item.spoken}&rdquo;</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {entry.reasons.map((reason) => (
                        <p key={reason} className="text-[10px] text-gray-400 mt-0.5">{reason}</p>
                      ))}
                      {entry.hint && <p className="text-[10px] text-gray-400 mt-0.5">{entry.hint}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

export default MemoryActivityTab;
