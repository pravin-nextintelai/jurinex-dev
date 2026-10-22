import React from 'react';
import FormattedAssistantContent from './FormattedAssistantContent';
import { X } from 'lucide-react';
import LearningMcqBlock, { normalizeLearningUiMode } from './LearningMcqBlock';

export default function LearningDetailPanel({ data, onOptionClick, onClose, isStreaming }) {
  if (!data) return null;

  const {
    feedback = '',
    content_hint: contentHint = '',
    question = '',
    ui_type: uiType = 'text',
    options = null,
  } = data;

  const optionList = Array.isArray(options) ? options : [];
  const normalizedUi = normalizeLearningUiMode(uiType);
  const showMcq =
    (normalizedUi === 'options' || normalizedUi === 'options_multi') && optionList.length > 0;

  const truncate = (t, max) => {
    const s = String(t || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max).trim()}...`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff', position: 'relative' }}>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            zIndex: 2,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#8c877f',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '44px 32px 56px' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto' }}>
          {feedback && feedback.trim() && (
            <div style={{ marginBottom: '14px' }}>
              <FormattedAssistantContent raw={truncate(feedback, 2000)} />
            </div>
          )}

          {contentHint && contentHint.trim() && (
            <div
              style={{
                margin: '8px 0 14px',
                padding: '8px 12px 8px 14px',
                borderLeft: '4px solid #2563eb',
                background: '#f3f4f6',
                borderRadius: '0 8px 8px 0',
              }}
            >
              <FormattedAssistantContent raw={truncate(contentHint, 900)} />
            </div>
          )}

          {question && question.trim() && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '14px',
                paddingTop: '14px',
                borderTop: '1px solid #f1f5f9',
                width: '100%',
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  textAlign: 'right',
                  background: '#f0fdfa',
                  border: '1px solid #21C1B6',
                  borderRadius: '18px 18px 4px 18px',
                  padding: '10px 14px',
                  boxShadow: '0 1px 3px rgba(33, 193, 182, 0.08)',
                }}
              >
                <FormattedAssistantContent raw={truncate(question, 800)} />
              </div>
            </div>
          )}

          {showMcq && (
            <LearningMcqBlock
              mode={normalizedUi === 'options_multi' ? 'options_multi' : 'options'}
              options={optionList}
              isStreaming={isStreaming}
              readOnly={false}
              onSubmit={onOptionClick}
            />
          )}
        </div>
      </div>
    </div>
  );
}
