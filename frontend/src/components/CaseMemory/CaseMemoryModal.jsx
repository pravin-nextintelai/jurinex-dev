import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Brain,
  Lightbulb,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import useCaseMemory from '../../hooks/useCaseMemory';
import { DEFAULT_MEMORY_SETTINGS, plural } from '../../utils/memoryLabels';
import MemoryFactsTab from './MemoryFactsTab';
import CaseInstructionsTab from './CaseInstructionsTab';
import MemorySuggestionsTab from './MemorySuggestionsTab';
import MemoryActivityTab from './MemoryActivityTab';
import CaseMemorySettingsTab from './CaseMemorySettingsTab';
import MemoryTransferTab from './MemoryTransferTab';

const TABS = [
  { id: 'memory', label: 'Memory', Icon: Brain },
  { id: 'instructions', label: 'Instructions', Icon: ScrollText },
  { id: 'suggestions', label: 'Suggestions', Icon: Lightbulb },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal },
  { id: 'transfer', label: 'Export & import', Icon: ArrowDownUp },
];

/**
 * "What JuriNex knows about this case": memory, standing instructions,
 * suggestions, case-level switches and export/import, in the same modal frame
 * as the case Chronology.
 */
const CaseMemoryModal = ({ folderName, caseTitle, onClose, initialTab = 'memory', refreshToken = 0, sessionId = null }) => {
  const memory = useCaseMemory(folderName);
  const { reload } = memory;
  const [tab, setTab] = useState(initialTab);
  const seenRefreshRef = useRef(refreshToken);
  const title = caseTitle || folderName || 'Case';
  const effective = { ...DEFAULT_MEMORY_SETTINGS, ...(memory.overview?.settings?.effective || {}) };
  const lineCount = memory.overview?.line_count || 0;
  const pending = memory.proposals.length;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // The case page bumps refreshToken when a chat answer changed memory while
  // this panel is open.
  useEffect(() => {
    if (refreshToken === seenRefreshRef.current) return;
    seenRefreshRef.current = refreshToken;
    reload();
  }, [refreshToken, reload]);

  let subtitle = 'What JuriNex knows about this case';
  if (memory.autoSeeding) {
    subtitle = 'Filling in from the case details…';
  } else if (memory.overview) {
    subtitle = `${plural(lineCount, 'line')} remembered${pending ? ` · ${plural(pending, 'suggestion')} waiting` : ''}`;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Memory for ${title}`}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#f0fdfb' }}
          >
            <Brain className="w-4 h-4" style={{ color: '#21C1B6' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-800 truncate">Memory — {title}</h2>
            <p className="text-[11px] text-gray-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={memory.reload}
              disabled={memory.loading}
              title="Reload"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${memory.loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        {memory.overview && (
          <div
            className="flex gap-1 px-4 pt-1 border-b border-gray-100 overflow-x-auto flex-shrink-0"
            role="tablist"
            aria-label="Memory panel"
          >
            {TABS.map((item) => {
              const { id, label } = item;
              const TabIcon = item.Icon;
              const isActive = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive ? 'border-[#21C1B6] text-gray-800' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" style={isActive ? { color: '#21C1B6' } : undefined} />
                  {label}
                  {id === 'suggestions' && pending > 0 && (
                    <span
                      className="min-w-[1.1rem] px-1 rounded-full text-[10px] text-white"
                      style={{ background: '#21C1B6' }}
                    >
                      {pending}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {!memory.overview && memory.loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-xs">Loading memory…</span>
            </div>
          )}

          {!memory.overview && !memory.loading && memory.error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <p className="text-xs text-gray-500 max-w-sm">
                {memory.error.kind === 'not_found'
                  ? "JuriNex couldn't open this case's memory. You may not have access to this case, or it may have been deleted."
                  : memory.error.message}
              </p>
              <button
                type="button"
                onClick={memory.reload}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: '#21C1B6' }}
              >
                Try again
              </button>
            </div>
          )}

          {memory.overview && (
            <>
              {tab === 'memory' && (
                <MemoryFactsTab
                  memory={memory}
                  effective={effective}
                  folderName={folderName}
                  sessionId={sessionId}
                />
              )}
              {tab === 'instructions' && (
                <CaseInstructionsTab
                  effective={effective}
                  folderName={folderName}
                  sessionId={sessionId}
                  refreshToken={refreshToken}
                />
              )}
              {tab === 'suggestions' && <MemorySuggestionsTab memory={memory} />}
              {tab === 'activity' && <MemoryActivityTab folderName={folderName} refreshToken={refreshToken} />}
              {tab === 'settings' && <CaseMemorySettingsTab memory={memory} />}
              {tab === 'transfer' && <MemoryTransferTab memory={memory} caseTitle={title} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseMemoryModal;
