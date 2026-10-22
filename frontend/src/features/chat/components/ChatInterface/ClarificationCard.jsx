import React from 'react';
import { HelpCircle, Check } from 'lucide-react';

/**
 * Claude-Code-style clarifying-question card. Shown when the backend's
 * `done.clarification` says the model needs the user to pick an interpretation
 * before it can answer. Options are clickable only on the latest message;
 * the user can always ignore the options and type their own answer below.
 */
const ClarificationCard = ({ data, locked = false, pickedLabel = null, onSelect }) => {
  if (!data || !Array.isArray(data.options) || data.options.length === 0) return null;

  return (
    <div
      style={{
        border: '1.5px solid #99f6e4',
        background: '#f8fffe',
        borderRadius: '14px',
        padding: '16px 18px',
        margin: '4px 0',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
          style={{ background: '#ccfbf1', color: '#0f766e' }}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {data.header || 'Quick question'}
        </span>
      </div>

      <p className="text-[15px] font-semibold text-gray-900 mb-3" style={{ lineHeight: 1.55 }}>
        {data.question}
      </p>

      <div className="flex flex-col gap-2">
        {data.options.map((opt, i) => {
          const isPicked = pickedLabel != null && pickedLabel === opt.label;
          const disabled = locked || pickedLabel != null;
          return (
            <button
              key={`${i}-${opt.label}`}
              type="button"
              disabled={disabled && !isPicked}
              onClick={() => { if (!disabled && onSelect) onSelect(opt); }}
              className="text-left w-full transition-all"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '10px',
                border: `1.5px solid ${isPicked ? '#21C1B6' : '#e2e8f0'}`,
                background: isPicked ? '#f0fdfa' : '#ffffff',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled && !isPicked ? 0.55 : 1,
                boxShadow: isPicked ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
              }}
              onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = '#21C1B6'; }}
              onMouseLeave={(e) => { if (!disabled && !isPicked) e.currentTarget.style.borderColor = '#e2e8f0'; }}
            >
              <span
                style={{
                  minWidth: '22px', height: '22px', borderRadius: '50%',
                  border: `2px solid ${isPicked ? '#21C1B6' : '#cbd5e1'}`,
                  background: isPicked ? '#21C1B6' : '#fff',
                  color: isPicked ? '#fff' : '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700, flexShrink: 0, marginTop: '1px',
                }}
              >
                {isPicked ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold" style={{ color: isPicked ? '#0f766e' : '#111827' }}>
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="block text-xs text-gray-500 mt-0.5" style={{ lineHeight: 1.5 }}>
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {pickedLabel == null && !locked && (
        <p className="text-[11px] text-gray-400 mt-3 mb-0">
          Pick an option, or type your own answer in the box below.
        </p>
      )}
    </div>
  );
};

export default ClarificationCard;
