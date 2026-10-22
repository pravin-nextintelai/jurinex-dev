import React from 'react';
import { CalendarClock } from 'lucide-react';

/** Compact button for the Files-panel header that opens the case chronology. */
const ChronologyButton = ({ onClick, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title="Case chronology"
    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-[#f0fdfb] disabled:opacity-50 disabled:cursor-not-allowed"
    style={{ color: '#21C1B6' }}
  >
    <CalendarClock className="w-3.5 h-3.5" />
    <span>Chronology</span>
  </button>
);

export default ChronologyButton;
