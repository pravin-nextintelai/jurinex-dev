import React, { useMemo, useCallback } from 'react';
import FormattedAssistantContent from './FormattedAssistantContent';
import { Copy, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import LearningMcqBlock, { normalizeLearningUiMode } from './LearningMcqBlock';

const MAX_MARKDOWN_CHARS = 120000;

/**
 * Split "1️⃣ … 2️⃣ …" style option runs (Unicode keycap digits) into intro + option strings.
 * Used when the model puts choices in prose instead of `options: []`.
 */
function splitKeycapNumberedOptions(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  let matches = [...s.matchAll(/[1-9]\uFE0F\u20E3/g)];
  if (matches.length < 2) {
    matches = [...s.matchAll(/[1-9]\u20E3/g)];
  }
  if (matches.length < 2) return null;

  const firstIdx = matches[0].index;
  const intro = s.slice(0, firstIdx).trim();
  const options = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const labelLen = m[0].length;
    const bodyStart = m.index + labelLen;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : s.length;
    let body = s.slice(bodyStart, bodyEnd).trim();
    body = body.replace(/^\*\*|\*\*$/g, '').replace(/^\*|\*$/g, '').trim();
    if (body) options.push(body);
  }
  if (options.length < 2) return null;
  return { intro, options };
}

function clampMarkdown(text) {
  const t = String(text || '').trim();
  if (t.length <= MAX_MARKDOWN_CHARS) return t;
  return `${t.slice(0, MAX_MARKDOWN_CHARS)}\n\n[… truncated for display …]`;
}

export default function LearningChatBubble({ data, onViewFull, onOptionClick, isStreaming, optionsInteractionLocked = false }) {
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

  const fullQuestion = String(question || '').trim();
  const keycapSplit = useMemo(() => {
    if (optionList.length > 0) return null;
    return splitKeycapNumberedOptions(fullQuestion);
  }, [optionList.length, fullQuestion]);

  const mcqOptionList = optionList.length > 0 ? optionList : keycapSplit?.options || [];
  const mcqMode =
    optionList.length > 0 && normalizedUi === 'options_multi' ? 'options_multi' : 'options';
  const showMcq =
    mcqOptionList.length > 0 &&
    (optionList.length > 0
      ? normalizedUi === 'options' || normalizedUi === 'options_multi'
      : !!keycapSplit);

  const bodyFont = '"Times New Roman", Times, serif';
  const feedbackMd = clampMarkdown(String(feedback || '').trim());
  const hintMd = clampMarkdown(String(contentHint || '').trim());

  const copyFullResponse = useCallback(() => {
    const parts = [feedback, contentHint, question].map((s) => String(s || '').trim()).filter(Boolean);
    const text = parts.join('\n\n');
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }, [feedback, contentHint, question]);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 'min(100%, 900px)',
        margin: '0 auto',
        padding: '2px 0 12px',
        background: '#ffffff',
        fontFamily: bodyFont,
      }}
    >
      {feedbackMd ? (
        <div style={{ marginBottom: hintMd || fullQuestion || showMcq ? '4px' : '0' }}>
          <FormattedAssistantContent raw={feedbackMd} />
        </div>
      ) : null}

      {hintMd ? (
        <div style={{ margin: '10px 0 2px' }}>
          <FormattedAssistantContent raw={`**Hint:** ${hintMd}`} />
        </div>
      ) : null}

      {fullQuestion ? (
        <div style={{ width: '100%', textAlign: 'left', marginTop: '8px' }}>
          <div
            style={{
              height: '1px',
              background: '#e2e8f0',
              margin: '16px 0 10px',
              width: '100%',
            }}
          />
          {keycapSplit && keycapSplit.intro ? (
            <FormattedAssistantContent raw={`**Next:** ${clampMarkdown(keycapSplit.intro)}`} />
          ) : keycapSplit && !keycapSplit.intro ? (
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: 1.55,
                color: '#1f2937',
                fontFamily: bodyFont,
                fontWeight: 500,
              }}
            >
              Choose a topic below:
            </p>
          ) : (
            <FormattedAssistantContent raw={`**Next:** ${clampMarkdown(fullQuestion)}`} />
          )}
        </div>
      ) : null}

      {showMcq ? (
        <LearningMcqBlock
          mode={mcqMode}
          options={mcqOptionList}
          isStreaming={isStreaming}
          readOnly={optionsInteractionLocked}
          onSubmit={onOptionClick}
        />
      ) : null}

      {(feedbackMd || hintMd || fullQuestion) && !isStreaming ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '14px',
            paddingTop: '10px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <button
            type="button"
            onClick={copyFullResponse}
            title="Copy"
            style={actionBtnStyle}
          >
            <Copy className="h-4 w-4" />
          </button>
          <span style={{ width: '1px', height: '16px', background: '#e2e8f0', margin: '0 4px' }} aria-hidden />
          <button type="button" title="Helpful" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button type="button" title="Not helpful" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <ThumbsDown className="h-4 w-4" />
          </button>
          <button type="button" title="Regenerate" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {onViewFull ? (
        <button
          type="button"
          onClick={() => onViewFull(data)}
          style={{
            marginTop: '10px',
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: '13px',
            color: '#64748b',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          View full response
        </button>
      ) : null}
    </div>
  );
}

const actionBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px',
  border: 'none',
  borderRadius: '8px',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
};
