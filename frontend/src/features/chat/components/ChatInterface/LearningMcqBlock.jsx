import React, { useCallback, useEffect, useMemo, useState } from 'react';

const MAX_OPTIONS = 6;

/** @returns {'text' | 'options' | 'options_multi'} */
export function normalizeLearningUiMode(raw) {
  const u = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (u === 'options_multi' || u === 'optionsmulti' || u === 'multi' || u === 'checkbox' || u === 'checkboxes') {
    return 'options_multi';
  }
  if (u === 'options') return 'options';
  return 'text';
}

/**
 * Single-choice: selecting an option submits immediately (no separate submit button).
 * Multi-choice: checkboxes + "Submit selected answers".
 * onSubmit receives the text sent as the user's next message.
 */
export default function LearningMcqBlock({ mode, options, isStreaming, onSubmit, readOnly = false }) {
  const list = useMemo(() => {
    const arr = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
    return arr.slice(0, MAX_OPTIONS);
  }, [options]);

  const isMulti = mode === 'options_multi';
  const [selectedRadio, setSelectedRadio] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  const resetKey = useMemo(() => `${mode}|${list.join('\u0001')}|${readOnly ? 'ro' : 'rw'}`, [mode, list, readOnly]);

  useEffect(() => {
    setSelectedRadio(null);
    setChecked(new Set());
    setSubmitted(false);
  }, [resetKey]);

  const toggleMulti = useCallback((opt) => {
    if (readOnly || isStreaming || submitted) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }, [isStreaming, submitted, readOnly]);

  const pickSingleAndSubmit = useCallback(
    (opt) => {
      if (readOnly || isStreaming || submitted || !onSubmit || isMulti) return;
      const choice = String(opt || '').trim();
      if (!choice) return;
      setSelectedRadio(choice);
      onSubmit(choice);
      setSubmitted(true);
    },
    [readOnly, isStreaming, submitted, onSubmit, isMulti],
  );

  const handleMultiSubmit = useCallback(() => {
    if (readOnly || isStreaming || submitted || !onSubmit || !isMulti) return;
    const picks = list.filter((o) => checked.has(o));
    if (picks.length === 0) return;
    const body = picks.map((s, i) => `${i + 1}. ${s}`).join('\n');
    onSubmit(`I selected these options (multiple choice):\n${body}`);
    setSubmitted(true);
  }, [isMulti, readOnly, isStreaming, submitted, onSubmit, list, checked]);

  const canMultiSubmit = checked.size > 0;
  const multiSubmitDisabled =
    readOnly || isStreaming || submitted || !canMultiSubmit || typeof onSubmit !== 'function';

  if (!list.length) return null;

  if (readOnly) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}
        aria-label="Answer choices (previous turn)"
      >
        {list.map((opt, i) => (
          <div
            key={`ro-${i}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '14px 16px',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '15px',
              lineHeight: '1.55',
              color: '#64748b',
            }}
          >
            <span style={{ width: '18px', flexShrink: 0 }} aria-hidden />
            <span style={{ flex: 1, color: '#232323' }}>{opt}</span>
          </div>
        ))}
      </div>
    );
  }

  const rowBase = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    cursor: submitted ? 'default' : 'pointer',
    textAlign: 'left',
    transition: 'border-color 0.15s, background 0.15s',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#232323',
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}
      role={isMulti ? 'group' : 'radiogroup'}
      aria-label={isMulti ? 'Multiple choice — select all that apply' : 'Pick one answer — sends immediately'}
    >
      {list.map((opt, i) => {
        const id = `learning-opt-${isMulti ? 'm' : 's'}-${i}`;
        const selectedSingle = !isMulti && selectedRadio === opt;
        const selectedMulti = isMulti && checked.has(opt);
        const active = selectedSingle || selectedMulti;

        return (
          <label
            key={`${id}-${opt.slice(0, 24)}`}
            htmlFor={id}
            style={{
              ...rowBase,
              borderColor: active ? '#21C1B6' : '#e2e8f0',
              background: active ? '#f0fdfa' : '#ffffff',
              opacity: submitted && !active ? 0.55 : 1,
            }}
          >
            {isMulti ? (
              <input
                id={id}
                type="checkbox"
                checked={checked.has(opt)}
                onChange={() => toggleMulti(opt)}
                disabled={isStreaming || submitted}
                style={{
                  marginTop: '2px',
                  width: '17px',
                  height: '17px',
                  flexShrink: 0,
                  accentColor: '#21C1B6',
                  cursor: submitted ? 'default' : 'pointer',
                }}
              />
            ) : (
              <input
                id={id}
                type="radio"
                name="learning-single-mcq"
                checked={selectedRadio === opt}
                onChange={() => pickSingleAndSubmit(opt)}
                disabled={isStreaming || submitted}
                style={{
                  marginTop: '2px',
                  width: '17px',
                  height: '17px',
                  flexShrink: 0,
                  accentColor: '#21C1B6',
                  cursor: submitted ? 'default' : 'pointer',
                }}
              />
            )}
            <span style={{ flex: 1 }}>{opt}</span>
          </label>
        );
      })}

      {isMulti ? (
        <button
          type="button"
          onClick={handleMultiSubmit}
          disabled={multiSubmitDisabled}
          style={{
            marginTop: '6px',
            alignSelf: 'flex-start',
            padding: '10px 20px',
            borderRadius: '10px',
            border: '1px solid #21C1B6',
            background: multiSubmitDisabled ? '#f1f5f9' : '#21C1B6',
            color: multiSubmitDisabled ? '#94a3b8' : '#ffffff',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'Inter, system-ui, sans-serif',
            cursor: multiSubmitDisabled ? 'not-allowed' : 'pointer',
            boxShadow: multiSubmitDisabled ? 'none' : '0 1px 3px rgba(33, 193, 182, 0.25)',
          }}
        >
          Submit selected answers
        </button>
      ) : null}
    </div>
  );
}
