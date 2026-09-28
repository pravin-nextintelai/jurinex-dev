import React from 'react';
import { Brain } from 'lucide-react';

/**
 * Compact Files-panel header button that opens the case's memory, beside Chronology.
 * `badge` marks that memory changed after a recent answer and has not been looked at.
 */
const MemoryButton = ({ onClick, disabled = false, badge = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={badge ? 'Memory changed after your last message. Open it to review.' : 'Case memory and instructions'}
    className="relative flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-[#f0fdfb] disabled:opacity-50 disabled:cursor-not-allowed"
    style={{ color: '#21C1B6' }}
  >
    <Brain className="w-3.5 h-3.5" />
    <span>Memory</span>
    {badge && (
      <>
        <span
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
          style={{ background: '#f59e0b' }}
          aria-hidden="true"
        />
        <span className="sr-only">(updated)</span>
      </>
    )}
  </button>
);

export default MemoryButton;
