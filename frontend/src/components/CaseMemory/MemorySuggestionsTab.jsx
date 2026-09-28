import React, { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import MemoryNotice from './MemoryNotice';
import SuggestionCard from './SuggestionCard';
import { formatDate, plural } from '../../utils/memoryLabels';

const KIND_LABELS = {
  instruction: 'For this case',
  preference: 'For every case',
};

// How many separate messages asked for this rule (the writer counts them).
const requestCount = (proposal) => Number(proposal?.source_ref?.request_count) || 0;

/** Standing rules JuriNex noticed in chat. Nothing changes until the advocate accepts one. */
const MemorySuggestionsTab = ({ memory }) => {
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const proposals = memory.proposals || [];

  const resolve = async (proposal, decision, text) => {
    setBusyId(proposal.id);
    setNotice(null);
    const result = await memory.resolveProposal(proposal.id, decision, text);
    setBusyId(null);
    if (!result.ok) {
      if (decision === 'accept') return result;
      setNotice({ tone: 'error', error: result.error });
      return result;
    }
    let message = 'Suggestion dismissed.';
    if (decision === 'accept') {
      message =
        result.data?.scope === 'user'
          ? 'Added to your standing instructions for every case.'
          : "Added to this case's instructions.";
    }
    setNotice({ tone: 'success', message });
    return result;
  };

  return (
    <div>
      <p className="text-[11px] text-gray-500 mb-3">
        JuriNex suggests a rule here when you state one in chat, such as &ldquo;from now on, answer in a table&rdquo;, or
        when you keep asking for the same thing. What you typed in chat is tidied into an instruction first: read it,
        edit it if you like, then add it. Nothing is saved until you do.
      </p>

      {notice && (
        <div className="mb-3">
          <MemoryNotice tone={notice.tone} problems={notice.error?.problems || []}>
            {notice.message || notice.error?.message}
          </MemoryNotice>
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <Lightbulb className="w-6 h-6 text-gray-300" />
          <p className="text-xs text-gray-500">No suggestions waiting.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {proposals.map((proposal) => (
            <SuggestionCard
              key={proposal.id}
              suggestion={proposal}
              scope={proposal.kind === 'preference' ? 'user' : 'case'}
              busy={busyId === proposal.id}
              acceptLabel={proposal.kind === 'preference' ? 'Apply in every case' : 'Add to instructions'}
              onAccept={(text) => resolve(proposal, 'accept', text)}
              onDismiss={() => resolve(proposal, 'reject')}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
                  style={{ background: '#f0fdfb', color: '#0d9488' }}
                >
                  {KIND_LABELS[proposal.kind] || 'Suggestion'}
                </span>
                {proposal.created_at && (
                  <span className="text-[10px] text-gray-400">{formatDate(proposal.created_at)}</span>
                )}
                {requestCount(proposal) > 1 && (
                  <span className="text-[10px] text-gray-500">Asked {plural(requestCount(proposal), 'time')}</span>
                )}
              </div>
            </SuggestionCard>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MemorySuggestionsTab;
