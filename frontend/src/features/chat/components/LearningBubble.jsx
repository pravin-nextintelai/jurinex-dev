import React from 'react';
import LearningMcqBlock, { normalizeLearningUiMode } from './ChatInterface/LearningMcqBlock';

export default function LearningBubble({ payload, isStreaming, onOptionSelect }) {
  if (!payload) return null;

  const {
    feedback = '',
    content_hint: contentHint = '',
    question = '',
    ui_type: uiType = 'text',
    options = null,
  } = payload;

  const optionList = Array.isArray(options) ? options : [];
  const normalizedUi = normalizeLearningUiMode(uiType);
  const showMcq =
    (normalizedUi === 'options' || normalizedUi === 'options_multi') && optionList.length > 0;

  return (
    <div className="learning-card">
      {feedback ? <p className="learning-feedback">{feedback}</p> : null}
      {contentHint ? (
        <div className="learning-hint">
          <span className="learning-hint-icon">💡</span>
          <span>{contentHint}</span>
        </div>
      ) : null}
      {question ? (
        <p className="learning-question">{question}</p>
      ) : null}
      {showMcq ? (
        <LearningMcqBlock
          mode={normalizedUi === 'options_multi' ? 'options_multi' : 'options'}
          options={optionList}
          isStreaming={isStreaming}
          readOnly={false}
          onSubmit={onOptionSelect}
        />
      ) : null}
    </div>
  );
}
