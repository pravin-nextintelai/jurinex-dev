import React, { useMemo } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import {
  formatChatResponseForDisplay,
  chatResponseLooksLikeHtml,
} from '@/shared/utils/formatChatResponse';
import rehypeDeepResearchCitations from '../../utils/deepResearchCitations';
import { safeDeepResearchUrl } from '../../utils/deepResearchSources';
import {
  ensureTableSeparators,
  markdownTableComponents,
  markdownRehypePlugins,
  neutralizeNonMathDollarSpans,
  normalizeMarkdownFormatting,
  splitMarkdownIntoRenderChunks,
} from '@/shared/utils/markdownUtils';
const DEEP_RESEARCH_SANITIZE_SCHEMA = {
  tagNames: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
  ],
  attributes: {
    a: ['href', 'title'],
    ol: ['start'],
    td: ['align'],
    th: ['align'],
  },
  protocols: { href: ['https'] },
};

// Citation chips are built AFTER sanitizing, so they are our nodes, not the model's.
const deepResearchRehypePlugins = [
  [rehypeSanitize, DEEP_RESEARCH_SANITIZE_SCHEMA],
  rehypeDeepResearchCitations,
];

/**
 * Deep output is untrusted live-web text, so a model-authored link must never be
 * clickable. Only URLs the server actually fetched and validated survive
 * `urlTransform` below with an href — everything else renders as inert text.
 */
// eslint-disable-next-line no-unused-vars -- `node` is dropped, not forwarded to the DOM
function DeepResearchAnchor({ children, href, node, ...props }) {
  if (!href) return <span>{children}</span>;
  return (
    <a
      className="dr-source-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      {...props}
    >
      {children}
    </a>
  );
}

/** First piece of text inside a node, used to spot a "[S1] …" register line. */
function leadingText(node) {
  if (!node) return '';
  if (node.type === 'text') return String(node.value || '');
  for (const child of node.children || []) {
    const text = leadingText(child);
    if (text.trim()) return text;
  }
  return '';
}

/** Tag "[S1] source…" lines so a citation chip can scroll straight to them. */
function DeepResearchListItem({ node, children, ...props }) {
  const match = /^\s*\[?(S\d{1,4})\]?/.exec(leadingText(node));
  if (!match) return <li {...props}>{children}</li>;
  return (
    <li data-source-anchor={match[1]} className="dr-source-line" {...props}>
      {children}
    </li>
  );
}

/** `[S1]` → a small chip that scrolls to its entry in the source list. */
function DeepResearchCitation({ node, children, ...props }) {
  const className = node?.properties?.className;
  const isCitation = Array.isArray(className)
    ? className.includes('dr-cite')
    : className === 'dr-cite';
  if (!isCitation) return <sup {...props}>{children}</sup>;

  const sourceId = String(node?.children?.[0]?.value || '').trim();
  const jumpToSource = (event) => {
    if (!/^S\d{1,4}$/.test(sourceId)) return;
    // Climb to the nearest ancestor that actually holds this entry. Several Deep
    // Research answers can share one thread and each lists its own [S1], so a
    // document-wide lookup would jump to the wrong message.
    let scope = event.currentTarget.parentElement;
    let entry = null;
    while (scope && !entry) {
      entry = scope.querySelector(`[data-source-anchor="${sourceId}"]`);
      scope = scope.parentElement;
    }
    if (!entry) return;
    entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entry.classList.add('dr-source-flash');
    setTimeout(() => entry.classList.remove('dr-source-flash'), 1400);
  };

  return (
    <sup
      className="dr-cite"
      role="button"
      tabIndex={0}
      title={`Jump to validated source ${sourceId}`}
      onClick={jumpToSource}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          jumpToSource(event);
        }
      }}
    >
      {sourceId}
    </sup>
  );
}

/** Deep Research reads as a document: plain tables, no data-grid toolbar. */
// eslint-disable-next-line no-unused-vars -- `node` is dropped, not forwarded to the DOM
function DeepResearchTable({ node, ...props }) {
  return (
    <div className="md-table-scroll">
      <table className="md-doc-table" {...props} />
    </div>
  );
}

const deepResearchMarkdownComponents = {
  ...markdownTableComponents,
  table: DeepResearchTable,
  sup: DeepResearchCitation,
  li: DeepResearchListItem,
  a: DeepResearchAnchor,
  img: () => null,
};

/** Canonical URLs the server fetched and validated for this answer. */
function validatedUrlSet(citations) {
  const urls = new Set();
  for (const citation of Array.isArray(citations) ? citations : []) {
    const url = safeDeepResearchUrl(citation?.canonical_url || citation?.url);
    if (url) urls.add(url);
  }
  return urls;
}

/**
 * Renders assistant text with secret-prompt HTML, legal banners, or markdown.
 *
 * Wrapped in React.memo so that parent re-renders (e.g. new message arriving,
 * streaming status changing) never trigger ReactMarkdown to re-parse historical
 * messages whose `raw` content has not changed.
 */
const FormattedAssistantContent = React.memo(
  function FormattedAssistantContent({
    raw,
    markdownComponents,
    className = '',
    forceSafeMarkdown = false,
    citations = null,
  }) {
    const content = useMemo(() => {
      let cleaned = formatChatResponseForDisplay(raw);
      if (!cleaned) return '';
      // Clean thinking content before rendering
      cleaned = cleaned.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '');
      if (/<(?:think|thinking)>/i.test(cleaned)) {
        cleaned = cleaned.split(/<(?:think|thinking)>/i)[0];
      }
      return cleaned;
    }, [raw]);

    // The answer's own "Validated sources" list is the single place sources are
    // shown, so its entries must be clickable — but only for URLs the server
    // actually validated. Any other link keeps an empty href and stays inert.
    const deepUrlTransform = useMemo(() => {
      const allowed = validatedUrlSet(citations);
      return (url) => {
        const safe = safeDeepResearchUrl(url);
        return safe && allowed.has(safe) ? safe : '';
      };
    }, [citations]);
    const markdownChunks = useMemo(
      () => splitMarkdownIntoRenderChunks(
        // Deep Research renders with skipHtml, so emphasis must stay Markdown —
        // converting it to <strong>/<em> there would strip the bold entirely.
        // Its text is model-authored, never OCR, so the PDF salvage heuristics
        // are skipped too: they merge numbers ("Section 17 1" → "Section 171")
        // and rewrite numbered chronologies into tables.
        // preserveIndent keeps list nesting alive: the shared table repair trims
        // every line, which flattened sub-bullets and tore numbered lists apart.
        ensureTableSeparators(normalizeMarkdownFormatting(neutralizeNonMathDollarSpans(content), {
          html: !forceSafeMarkdown,
          repairOcr: !forceSafeMarkdown,
        }), { preserveIndent: forceSafeMarkdown }),
      ),
      [content, forceSafeMarkdown],
    );

    if (!content) return null;

    // Legacy trusted document HTML remains unchanged. Deep live-web text is never HTML.
    if (!forceSafeMarkdown && chatResponseLooksLikeHtml(content)) {
      return (
        <div
          className={`formatted-assistant-html word-document-style ${className}`.trim()}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      );
    }

    return (
      <div className={`formatted-assistant-markdown ${className}`.trim()}>
        {markdownChunks.map((chunk, index) => (
          <ReactMarkdown
            key={`${index}-${chunk.length}`}
            remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
            rehypePlugins={forceSafeMarkdown ? deepResearchRehypePlugins : markdownRehypePlugins}
            skipHtml={forceSafeMarkdown}
            components={forceSafeMarkdown
              ? deepResearchMarkdownComponents
              : { ...markdownTableComponents, ...markdownComponents }}
            urlTransform={forceSafeMarkdown ? deepUrlTransform : undefined}
          >
            {chunk}
          </ReactMarkdown>
        ))}
      </div>
    );
  },
  // Only re-render when the displayed text or styling actually changes
  (prev, next) =>
    prev.raw === next.raw &&
    prev.className === next.className &&
    prev.forceSafeMarkdown === next.forceSafeMarkdown &&
    prev.markdownComponents === next.markdownComponents &&
    prev.citations === next.citations,
);

export default FormattedAssistantContent;
