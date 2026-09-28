import React, { useEffect, useRef } from 'react';
import MemoryNotice from './MemoryNotice';
import InstructionList from './InstructionList';
import useInstructions from '../../hooks/useInstructions';

const CASE_PLACEHOLDER = 'e.g. Refer to the accused as "the Applicant" throughout.';

/**
 * Standing orders for one case, plus the advocate's universal instructions as
 * they apply here. Every instruction has a switch; a universal one can be
 * switched off for this case only, and any of them muted for the open chat.
 */
const CaseInstructionsTab = ({ effective, folderName, sessionId, refreshToken = 0 }) => {
  const caseInstructions = useInstructions('case', { folderName, sessionId });
  const universal = useInstructions('user', { folderName, sessionId });
  const seenRefreshRef = useRef(refreshToken);

  // A chat answer saved an instruction while this tab was open.
  useEffect(() => {
    if (refreshToken === seenRefreshRef.current) return;
    seenRefreshRef.current = refreshToken;
    caseInstructions.reload();
    universal.reload();
  }, [refreshToken, caseInstructions, universal]);

  return (
    <div>
      {!effective.instructions_enabled && (
        <div className="mb-3">
          <MemoryNotice tone="warning">
            Case instructions are turned off, so JuriNex won&apos;t apply them. Turn them back on in Settings, or in this
            case&apos;s Settings tab.
          </MemoryNotice>
        </div>
      )}
      <p className="text-[11px] text-gray-500 mb-4">
        JuriNex follows these in every chat here. They can narrow how it works, but never switch off its checks. Asking
        for a way of working in chat does not change anything straight away: JuriNex counts how often you ask. A rule you
        state (&ldquo;from now on&hellip;&rdquo;, &ldquo;always&hellip;&rdquo;) appears under Suggestions and is added
        here once you ask for it again; something you keep asking for is suggested, then added, as you repeat it.
        {sessionId ? ' Mute one for this chat only from the icon on its row.' : ''}
      </p>

      <InstructionList
        instructions={caseInstructions}
        title="For this case"
        intro="Apply in this case only."
        placeholder={CASE_PLACEHOLDER}
        emptyText="No instructions for this case yet. Add one, or accept a suggestion."
      />

      <InstructionList
        instructions={universal}
        title="Your standing instructions"
        intro="Apply in every case. Switch one off here if it doesn't suit this matter; edit them in Settings → Memory."
        emptyText="You have no standing instructions yet. Add them in Settings → Memory, or ask for the same thing “in all my cases…” more than once in chat."
        caseSwitch
        editable={false}
      />
    </div>
  );
};

export default CaseInstructionsTab;
