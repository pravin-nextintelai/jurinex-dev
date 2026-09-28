import React, { useState } from 'react';
import MemoryToggle from './MemoryToggle';
import MemoryNotice from './MemoryNotice';
import { DEFAULT_MEMORY_SETTINGS, MEMORY_TOGGLES } from '../../utils/memoryLabels';

/** The memory switches for this one case. They can narrow the account's settings, never widen them. */
const CaseMemorySettingsTab = ({ memory }) => {
  const caseValues = { ...DEFAULT_MEMORY_SETTINGS, ...(memory.overview?.settings?.case || {}) };
  const effective = { ...DEFAULT_MEMORY_SETTINGS, ...(memory.overview?.settings?.effective || {}) };
  const [pendingFlag, setPendingFlag] = useState(null);
  const [error, setError] = useState(null);

  const toggle = async (flag, value) => {
    setPendingFlag(flag);
    setError(null);
    const result = await memory.updateCaseSettings({ [flag]: value });
    setPendingFlag(null);
    if (!result.ok) setError(result.error);
  };

  const hintFor = (flag) =>
    caseValues[flag] && !effective[flag] ? 'Off in your account or firm settings, so it stays off here.' : null;

  return (
    <div>
      <p className="text-[11px] text-gray-500 mb-1">
        These apply to this case only. A setting that is off in your account, or turned off by your firm, stays off
        here.
      </p>
      {error && (
        <div className="my-2">
          <MemoryNotice tone="error">{error.message}</MemoryNotice>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        <MemoryToggle
          compact
          label="Memory for this case"
          description="Use this case's memory, instructions and earlier chats when answering."
          checked={caseValues.enabled}
          busy={pendingFlag === 'enabled'}
          hint={hintFor('enabled')}
          onChange={(value) => toggle('enabled', value)}
        />
        {MEMORY_TOGGLES.map((item) => (
          <MemoryToggle
            compact
            key={item.flag}
            label={item.label}
            description={item.description}
            checked={caseValues[item.flag]}
            busy={pendingFlag === item.flag}
            disabled={!caseValues.enabled}
            hint={hintFor(item.flag)}
            onChange={(value) => toggle(item.flag, value)}
          />
        ))}
      </div>
    </div>
  );
};

export default CaseMemorySettingsTab;
