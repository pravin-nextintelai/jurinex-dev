import React, { useState, useEffect, useCallback } from 'react';
import { X, Wand2, Power } from 'lucide-react';
import PersonalizationSections, { IconButton } from './PersonalizationSections';
import { fmtDate } from './personalizationUtils';
import '../../styles/CustomPromptBuilder.css';
import '../../styles/Personalization.css';

/**
 * Slide-over drawer opened from the chat composer's wand button. The body is the
 * shared PersonalizationSections block (Instructions / Memory / Context); the
 * same block is mounted inline in the case page's right column.
 */
const PersonalizationModal = ({ isOpen, onClose, sessionId = null, folderName = null }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleStatus = useCallback((s) => setStatus(s), []);

  if (!isOpen) return null;

  const active = status?.active_instruction || null;

  return (
    <div
      className="cpb-backdrop fixed inset-0 bg-slate-900/35 z-[1200]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Personalization"
    >
      <aside className="pz-drawer absolute inset-y-0 right-0 w-full sm:w-[440px] bg-white shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#E0F7F6] text-[#21C1B6] flex items-center justify-center">
            <Wand2 className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-slate-900 leading-tight">Personalize</h2>
            <p className="text-[11.5px] text-slate-500 truncate">
              {folderName ? `Applies to every document chat · ${folderName}` : 'Applies to every document chat'}
            </p>
          </div>
          <span
            className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
            title={active ? `Active since ${fmtDate(active.created_at)}` : 'No instruction added yet'}
          >
            <Power className="h-3 w-3" />
            {active ? 'ON' : 'OFF'}
          </span>
          <IconButton title="Close" onClick={() => onClose?.()}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <PersonalizationSections
          className="cpb-scroll flex-1 overflow-y-auto"
          sessionId={sessionId}
          folderName={folderName}
          showContext
          onStatusChange={handleStatus}
        />
      </aside>
    </div>
  );
};

export default PersonalizationModal;
