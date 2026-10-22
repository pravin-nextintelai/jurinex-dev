import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import FormattedAssistantContent from '@/features/chat/components/ChatInterface/FormattedAssistantContent';
import { Bot, Copy, MessageSquare, FileDown, RotateCcw } from 'lucide-react';
import DownloadPdf from '@/shared/components/DownloadPdf';
import { convertJsonToPlainText } from '@/shared/utils/jsonToPlainText';
import { AGENT_DRAFT_TEMPLATE_API } from '@/config/apiConfig.js';

const PAGE_BREAK_TOKEN = '__JURINEX_PAGE_BREAK__';

const normalizeForPagination = (text) =>
  convertJsonToPlainText(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]*[-=]{0,5}\s*PAGE[\s_/-]*BREAK\s*[-=]{0,5}[ \t]*/gi, `\n\n${PAGE_BREAK_TOKEN}\n\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitLargeBlockSafely = (block, maxWeight) => {
  if (!block || block.length <= maxWeight) return [block];

  const sentenceParts = block
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*"'-])/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return [block];
  }

  const output = [];
  let current = '';

  sentenceParts.forEach((sentence) => {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > maxWeight) {
      output.push(current);
      current = sentence;
      return;
    }
    current = candidate;
  });

  if (current) {
    output.push(current);
  }

  return output.length ? output : [block];
};

const paginateMarkdownContent = (text) => {
  const normalized = normalizeForPagination(text);
  if (!normalized) return [];

  const explicitPages = normalized
    .split(new RegExp(`\\n\\s*(?:\\f|${PAGE_BREAK_TOKEN})\\s*\\n`, 'g'))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (explicitPages.length > 1) {
    return explicitPages;
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const pages = [];
  let currentBlocks = [];
  let currentWeight = 0;
  const maxWeight = 3400;

  blocks.forEach((rawBlock) => {
    const candidateBlocks = splitLargeBlockSafely(rawBlock, maxWeight);

    candidateBlocks.forEach((block) => {
      const isHeading = /^#{1,6}\s/.test(block) || /^<h[1-6][\s>]/i.test(block);
      const isCode = /^```/.test(block) || /^<pre/i.test(block);
      const weight = Math.max(180, block.length + (isHeading ? 240 : 0) + (isCode ? 280 : 0));

      if (currentBlocks.length && currentWeight + weight > maxWeight) {
        pages.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentWeight = 0;
      }

      currentBlocks.push(block);
      currentWeight += weight;
    });
  });

  if (currentBlocks.length) {
    pages.push(currentBlocks.join('\n\n'));
  }

  return pages;
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function buildWordHtml(markdownText, title) {
  const lines = (markdownText || '').split('\n');
  const bodyParts = [];
  const safeTitle = (title || 'JuriNex Analysis').replace(/[<>&"]/g, ' ').trim();
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Header table (flexbox not reliable in Word — use table)
  bodyParts.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2pt solid #21C1B6;margin-bottom:16pt;padding-bottom:8pt"><tr>
<td><span style="font-size:18pt;font-weight:800;color:#21C1B6;font-family:Arial,sans-serif">JuriNex</span>&nbsp;<span style="font-size:9pt;font-weight:700;color:#6b7280;letter-spacing:.08em;font-family:Arial,sans-serif;text-transform:uppercase">Analysis</span></td>
<td align="right"><span style="font-size:9pt;color:#6b7280;font-family:Arial,sans-serif">${dateStr}</span></td>
</tr></table>`);

  for (const line of lines) {
    const stripped = line.trim();

    if (!stripped) {
      bodyParts.push('<p style="margin:0;font-size:6pt">&nbsp;</p>');
      continue;
    }

    // HR
    if (/^[-*_]{3,}$/.test(stripped)) {
      bodyParts.push('<hr style="border:0;border-top:1px solid #000;margin:10pt 0">');
      continue;
    }

    // Headings
    const hMatch = stripped.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const content = inlineMarkdown(hMatch[2]);
      const align = level === 1 ? 'center' : 'left';
      const size = level === 1 ? '14pt' : level === 2 ? '13pt' : '12pt';
      const upper = level <= 2 ? 'text-transform:uppercase;' : '';
      bodyParts.push(`<p style="font-family:'Times New Roman',serif;font-size:${size};font-weight:700;text-align:${align};${upper}margin:12pt 0 5pt">${content}</p>`);
      continue;
    }

    // Bold-only line
    const boldOnly = stripped.match(/^\*\*([^*]{3,})\*\*:?$/);
    if (boldOnly) {
      bodyParts.push(`<p style="font-family:'Times New Roman',serif;font-size:12pt;font-weight:700;margin:8pt 0 3pt">${escapeHtml(boldOnly[1])}</p>`);
      continue;
    }

    // Bullet
    if (/^[-*]\s/.test(stripped)) {
      const content = inlineMarkdown(stripped.slice(2));
      bodyParts.push(`<p style="font-family:'Times New Roman',serif;font-size:12pt;margin:2pt 0 2pt 18pt">&#8226;&nbsp;${content}</p>`);
      continue;
    }

    // Numbered list
    const numberedMatch = stripped.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      const content = inlineMarkdown(numberedMatch[2]);
      bodyParts.push(`<p style="font-family:'Times New Roman',serif;font-size:12pt;margin:2pt 0 2pt 18pt">${escapeHtml(numberedMatch[1])}.&nbsp;${content}</p>`);
      continue;
    }

    // Normal paragraph
    const content = inlineMarkdown(stripped);
    bodyParts.push(`<p style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.65;margin:0 0 5pt;text-align:justify">${content}</p>`);
  }

  // Clean HTML — no Word XML namespaces (those cause the "unreadable content" warning)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
  @page { margin: 1in 1in 1in 1.5in; size: A4 portrait; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000000; background: #ffffff; margin: 0; padding: 0; }
  p { orphans: 3; widows: 3; }
  strong, b { font-weight: 700; }
</style>
</head>
<body>
${bodyParts.join('\n')}
</body>
</html>`;
}

async function downloadAsWord(markdownText, title) {
  const name = (title || 'JuriNex_Analysis').replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 60);
  const html = buildWordHtml(markdownText, title);

  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    '';

  try {
    const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/drafts/chat_export/export/docx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ html_content: html }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.docx`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    }
  } catch {
    // fall through to HTML fallback
  }

  // Fallback: save the generated content as HTML instead of a fake .doc/.docx.
  // That avoids Word trying to parse a non-DOCX file as a real Word document.
  const bom = '\ufeff';
  const blob = new Blob([bom + html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// Court-document markdown components — Times New Roman, proper legal formatting
const DocumentViewer = ({
  selectedMessageId,
  currentResponse,
  animatedResponseContent,
  messages,
  handleCopyResponse,
  markdownOutputRef,
  isAnimatingResponse,
  showResponseImmediately,
  formatDate,
  markdownComponents,
  responseContainerRef,
  exportContentRef,
  suggestedQuestions = [],
  onSuggestedQuestionClick,
  onRetryMessage,
  retryDisabled = false,
}) => {
  const horizontalScrollRef = useRef(null);
  const stickyScrollbarRef = useRef(null);
  const [needsHorizontalScroll, setNeedsHorizontalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [isDownloadingWord, setIsDownloadingWord] = useState(false);
  const [visiblePageCount, setVisiblePageCount] = useState(1);

  useEffect(() => {
    const horizontalElement = horizontalScrollRef.current;
    const contentElement = markdownOutputRef?.current;

    if (!horizontalElement || !contentElement) return undefined;

    const updateScrollbarState = () => {
      const scrollWidth = contentElement.scrollWidth;
      const clientWidth = horizontalElement.clientWidth;
      const needsScroll = scrollWidth > clientWidth + 1;

      setNeedsHorizontalScroll(needsScroll);
      if (needsScroll) {
        setScrollbarWidth(scrollWidth);
      }
    };

    updateScrollbarState();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollbarState();
    });
    resizeObserver.observe(contentElement);
    resizeObserver.observe(horizontalElement);
    window.addEventListener('resize', updateScrollbarState);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollbarState);
    };
  }, [selectedMessageId, currentResponse, animatedResponseContent, markdownOutputRef]);

  useEffect(() => {
    if (!needsHorizontalScroll) return undefined;

    const horizontalElement = horizontalScrollRef.current;
    const stickyElement = stickyScrollbarRef.current;

    if (!horizontalElement || !stickyElement) return undefined;

    const syncSticky = () => {
      stickyElement.scrollLeft = horizontalElement.scrollLeft;
    };

    const syncContent = () => {
      horizontalElement.scrollLeft = stickyElement.scrollLeft;
    };

    stickyElement.scrollLeft = horizontalElement.scrollLeft;
    horizontalElement.addEventListener('scroll', syncSticky);
    stickyElement.addEventListener('scroll', syncContent);

    return () => {
      horizontalElement.removeEventListener('scroll', syncSticky);
      stickyElement.removeEventListener('scroll', syncContent);
    };
  }, [needsHorizontalScroll]);

  useEffect(() => {
    if (!responseContainerRef?.current) return undefined;
    const timeout = setTimeout(() => {
      if (responseContainerRef.current) {
        responseContainerRef.current.scrollTop = 0;
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [selectedMessageId, responseContainerRef]);

  const selectedMessage = messages.find((msg) => msg.id === selectedMessageId);
  const hasContent = currentResponse || animatedResponseContent;
  const isStreaming = selectedMessage?.isStreaming;
  const responseText = isAnimatingResponse
    ? animatedResponseContent
    : animatedResponseContent || currentResponse || '';
  const displayMessage = selectedMessage || {
    display_text_left_panel: 'Streaming response',
    question: 'Streaming response',
    timestamp: new Date().toISOString(),
  };
  const isLiveStream = isStreaming || isAnimatingResponse;
  const hasMeaningfulText = (text) => {
    const t = String(text || '').trim();
    if (!t) return false;
    return t.replace(/<[^>]+>/g, '').replace(/\|/g, '').replace(/-{3,}/g, '').replace(/\s/g, '').length > 0;
  };
  const pages = useMemo(() => {
    const text = (responseText || '').trim();
    if (!hasMeaningfulText(text)) return [];
    // During streaming use a single raw-text page — no expensive pagination yet.
    if (isLiveStream) return [text];
    return paginateMarkdownContent(responseText);
  }, [responseText, isLiveStream]);

  // Reset visible count whenever the message or page list changes.
  useEffect(() => {
    setVisiblePageCount(1);
  }, [selectedMessageId, pages.length]);

  // Progressively reveal subsequent pages so the UI thread is never blocked.
  useEffect(() => {
    if (isLiveStream || visiblePageCount >= pages.length) return undefined;
    const timer = setTimeout(() => {
      setVisiblePageCount((prev) => Math.min(prev + 1, pages.length));
    }, 60);
    return () => clearTimeout(timer);
  }, [pages.length, visiblePageCount, isLiveStream]);

  if ((!selectedMessageId && !hasContent) || (!hasContent && !isStreaming)) {
    return (
      <div className="flex items-center justify-center h-full rounded-[22px] bg-white/80 border border-[#e5dfd4]">
        <div className="text-center text-[#807868] px-6">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-base font-medium">Select a question to view the response</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white rounded-[24px] border border-[#e0d9ca]">
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-[#e3dccf] bg-white">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[18px] sm:text-[20px] font-medium text-[#2b3528] flex items-center gap-2 truncate">
                <Bot className="h-4 w-4 text-[#1f6b5f] shrink-0" />
                {displayMessage.display_text_left_panel || displayMessage.question || 'Response'}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onRetryMessage && (
                <button
                  onClick={() => onRetryMessage(selectedMessage)}
                  disabled={retryDisabled || !selectedMessage || isStreaming}
                  className="inline-flex items-center px-3 py-2 text-xs font-medium text-[#4e4a41] hover:text-[#1d1d1b] bg-white border border-[#ddd6c8] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Regenerate this response"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Retry
                </button>
              )}
              <button
                onClick={handleCopyResponse}
                className="inline-flex items-center px-3 py-2 text-xs font-medium text-[#4e4a41] hover:text-[#1d1d1b] bg-white border border-[#ddd6c8] rounded-md transition-colors"
                title="Copy AI Response"
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy
              </button>
              <button
                onClick={async () => {
                  if (isDownloadingWord || !responseText) return;
                  setIsDownloadingWord(true);
                  try {
                    await downloadAsWord(
                      responseText,
                      displayMessage.question || displayMessage.display_text_left_panel || 'JuriNex Analysis',
                    );
                  } finally {
                    setIsDownloadingWord(false);
                  }
                }}
                disabled={isDownloadingWord || !responseText}
                className="inline-flex items-center px-3 py-2 text-xs font-medium text-[#4e4a41] hover:text-[#1d1d1b] bg-white border border-[#ddd6c8] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download as Word document"
              >
                {isDownloadingWord ? (
                  <svg className="h-3.5 w-3.5 mr-1.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                ) : (
                  <FileDown className="h-3.5 w-3.5 mr-1.5" />
                )}
                Word
              </button>
              <DownloadPdf
                markdownOutputRef={markdownOutputRef}
                contentRef={exportContentRef}
                questionTitle={displayMessage.question || displayMessage.display_text_left_panel || 'AI_Analysis'}
              />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#807868]">
            <span className="truncate">
              {displayMessage.timestamp ? formatDate(displayMessage.timestamp) : 'Preparing response'}
            </span>
          </div>
        </div>
      </div>

      {/* Light canvas background so the preview feels like a document workspace */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-auto"
        style={{ background: '#ffffff', padding: '28px 24px' }}
        ref={responseContainerRef ?? null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
          <div ref={exportContentRef ?? null} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', width: '100%' }}>
            {pages.length ? pages.slice(0, visiblePageCount).map((pageContent, index) => (
              <div key={`page-wrap-${index}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* Page label */}
                <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '6px', userSelect: 'none', letterSpacing: '0.04em' }}>
                  Page {index + 1} of {pages.length}
                  {(isAnimatingResponse || isStreaming) && index === pages.length - 1 ? ' (receiving…)' : ''}
                </div>
                {/* A4 page — court document style */}
                <article
                  key={`response-page-${index + 1}`}
                  className="export-page"
                  style={{
                    width: '794px',
                    minHeight: '1123px',
                    background: '#ffffff',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
                    boxSizing: 'border-box',
                    // Court margins: 1.5in left (binding), 1in top/right/bottom
                    padding: '96px 96px 80px 120px',
                    fontFamily: '"Times New Roman", Times, serif',
                    fontSize: '12pt',
                    color: '#000',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Page header strip */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '8px',
                    marginBottom: '20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                      <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: '15pt', color: '#000000', letterSpacing: '-0.02em', lineHeight: 1 }}>JuriNex</span>
                      <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 600, fontSize: '8pt', color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Analysis</span>
                    </div>
                    <span style={{ fontFamily: 'Arial, sans-serif', fontSize: '8pt', color: '#9ca3af' }}>
                      {displayMessage.question
                        ? (displayMessage.question.length > 50 ? displayMessage.question.substring(0, 50) + '…' : displayMessage.question)
                        : 'AI Response'}
                    </span>
                  </div>

                  {/* Content */}
                  <div
                    style={{ flex: 1 }}
                    ref={index === 0 ? markdownOutputRef : undefined}
                  >
                    {isLiveStream ? (
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          margin: 0,
                          fontFamily: '"Times New Roman", Times, serif',
                          fontSize: '12pt',
                          lineHeight: 1.5,
                        }}
                      >
                        {pageContent}
                      </pre>
                    ) : (
                      <FormattedAssistantContent raw={pageContent} />
                    )}
                    {index === pages.length - 1 && isLiveStream && (
                      <span style={{ display: 'inline-block', width: '2px', height: '16px', background: '#21C1B6', marginLeft: '2px', verticalAlign: 'middle', animation: 'pulse 1s infinite' }} />
                    )}
                  </div>

                  {/* Page footer */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid #d1d5db',
                    paddingTop: '8px',
                    marginTop: '16px',
                    fontSize: '9pt',
                    fontFamily: 'Arial, sans-serif',
                    color: '#6b7280',
                  }}>
                    <span>JuriNex Analysis</span>
                    <span>Page {index + 1} of {pages.length}</span>
                  </div>
                </article>
              </div>
            )) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div
                  style={{
                    width: '794px',
                    minHeight: '240px',
                    background: '#ffffff',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
                    padding: '48px 64px',
                    boxSizing: 'border-box',
                    color: '#6b7280',
                    fontSize: '13pt',
                    fontFamily: 'Arial, sans-serif',
                    textAlign: 'center',
                  }}
                >
                  {isStreaming
                    ? 'Waiting for response text…'
                    : 'No response content was received. Try asking again or use a shorter question.'}
                </div>
              </div>
            )}
          </div>
          {!isStreaming && !isAnimatingResponse && suggestedQuestions.length > 0 && (
            <section style={{ width: '794px', background: '#f8fbfa', border: '1px solid #d7e8e1', borderRadius: '12px', padding: '16px 20px' }}>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#6f7f79', marginBottom: '4px' }}>Suggested Questions</p>
              <p style={{ fontSize: '13px', color: '#3e4b46', marginBottom: '10px' }}>Use these to dig deeper into the completed response.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestedQuestionClick?.(suggestion)}
                    style={{ textAlign: 'left', padding: '6px 14px', borderRadius: '999px', background: '#fff', border: '1px solid #c9ddd5', fontSize: '13px', color: '#20463f', cursor: 'pointer' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;
