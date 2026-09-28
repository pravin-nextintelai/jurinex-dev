import React from 'react';

/** A labelled switch row, styled like the toggles on the Settings page. */
const MemoryToggle = ({
  checked,
  onChange,
  label,
  description,
  hint = null,
  disabled = false,
  busy = false,
  compact = false,
}) => (
  <div className={`flex items-start justify-between gap-6 ${compact ? 'py-2.5' : 'py-4'} ${disabled ? 'opacity-50' : ''}`}>
    <div className="min-w-0 flex-1">
      <div className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-900`}>{label}</div>
      {description && (
        <div className={`${compact ? 'text-[11px]' : 'text-sm'} text-gray-500 mt-0.5`}>{description}</div>
      )}
      {hint && <div className="text-[11px] text-amber-700 mt-1">{hint}</div>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
        checked ? 'bg-green-600' : 'bg-gray-200'
      } ${busy ? 'animate-pulse' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>
);

export default MemoryToggle;
