import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { ensureTableSeparators, markdownTableComponents } from '@/shared/utils/markdownUtils';
import { sanitizeLegalDraftMarkdown, legalDraftComponents, canonicalizeFieldPlaceholders, fixInlineEmphasis, normalizeLegalDraftMarkdownForRender } from '../../utils/legalDraftRender';

// The drafter (and now the TipTap editor) emit inline styles the user can set — red
// placeholder spans (<span style="color:red;font-weight:bold;">[____ FIELD ____]</span>),
// per-block alignment (text-align on p / h1-h6 / td / th) and font family/size/colour
// spans. rehype-sanitize strips inline styles by default, so allow `style` on the
// elements that legitimately carry draft styling.
const _STYLED_TAGS = ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'div'];
const DRAFT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []), 'span'])],
  attributes: {
    ...defaultSchema.attributes,
    ..._STYLED_TAGS.reduce((acc, tag) => {
      acc[tag] = [...new Set([...((defaultSchema.attributes && defaultSchema.attributes[tag]) || []), 'style'])];
      return acc;
    }, {}),
  },
};

/**
 * Renders a legal draft (or a single draft section) with the dedicated draft
 * engine — sanitizes malformed pipe/table markdown, then applies court-document
 * styling. Deliberately separate from the chat's FormattedAssistantContent so the
 * general chat renderer's quirks can never break a draft again.
 */

const TT_SERIF = "'Times New Roman', 'Liberation Serif', Georgia, serif";

function ttAlign(attrs, fallback = 'justify') {
  const value = String((attrs && attrs.textAlign) || fallback || '').toLowerCase();
  return ['left', 'center', 'right', 'justify'].includes(value) ? value : fallback;
}

function renderTiptapInline(nodes, keyPrefix) {
  return (nodes || []).map((node, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'fieldPill') {
      const label = String(node.attrs?.label || 'FIELD').trim().toUpperCase();
      return <span key={key} style={{ color: 'red', fontWeight: 700 }}>[________ {label} ________]</span>;
    }
    if (node.type !== 'text') return renderTiptapBlock(node, key);
    let child = node.text || '';
    (node.marks || []).forEach((mark, markIdx) => {
      if (mark?.type === 'bold') child = <strong key={`${key}-b-${markIdx}`}>{child}</strong>;
      else if (mark?.type === 'italic') child = <em key={`${key}-i-${markIdx}`}>{child}</em>;
      else if (mark?.type === 'code') child = <code key={`${key}-c-${markIdx}`}>{child}</code>;
    });
    return <React.Fragment key={key}>{child}</React.Fragment>;
  });
}

function renderTiptapBlock(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'paragraph') {
    return (
      <p key={key} style={{ margin: '0 0 10px', fontFamily: TT_SERIF, fontSize: 15, lineHeight: 1.7, color: 'var(--draft-fg, #1a1a1a)', textAlign: ttAlign(node.attrs) }}>
        {renderTiptapInline(node.content, `${key}-in`)}
      </p>
    );
  }
  if (node.type === 'heading') {
    const level = Math.max(1, Math.min(Number(node.attrs?.level || 2), 6));
    const Tag = `h${Math.min(level, 3)}`;
    const size = level === 1 ? 18 : level === 2 ? 16 : 15;
    return (
      <Tag key={key} style={{ margin: level <= 2 ? '16px 0 8px' : '14px 0 6px', fontFamily: TT_SERIF, fontSize: size, fontWeight: 700, lineHeight: 1.45, color: 'var(--draft-fg, #111)', textAlign: ttAlign(node.attrs, 'left') }}>
        {renderTiptapInline(node.content, `${key}-in`)}
      </Tag>
    );
  }
  if (node.type === 'table') {
    return <table key={key} style={{ width: '100%', borderCollapse: 'collapse', margin: '8px 0 10px', fontFamily: TT_SERIF, fontSize: 14 }}>{(node.content || []).map((row, i) => renderTiptapBlock(row, `${key}-r-${i}`))}</table>;
  }
  if (node.type === 'tableRow') {
    return <tr key={key}>{(node.content || []).map((cell, i) => renderTiptapBlock(cell, `${key}-c-${i}`))}</tr>;
  }
  if (node.type === 'tableHeader' || node.type === 'tableCell') {
    const Tag = node.type === 'tableHeader' ? 'th' : 'td';
    return (
      <Tag key={key} style={{ border: '1px solid var(--draft-table-border, #d8d8d8)', padding: '6px 8px', verticalAlign: 'top', textAlign: ttAlign((node.content || [])[0]?.attrs, 'left'), fontWeight: node.type === 'tableHeader' ? 700 : 400 }}>
        {(node.content || []).map((child, i) => renderTiptapBlock(child, `${key}-b-${i}`))}
      </Tag>
    );
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const Tag = node.type === 'orderedList' ? 'ol' : 'ul';
    return <Tag key={key} style={{ margin: '0 0 12px', paddingLeft: 26, fontFamily: TT_SERIF, fontSize: 15, lineHeight: 1.7 }}>{(node.content || []).map((item, i) => renderTiptapBlock(item, `${key}-li-${i}`))}</Tag>;
  }
  if (node.type === 'listItem') {
    return <li key={key} style={{ margin: '4px 0' }}>{(node.content || []).map((child, i) => renderTiptapBlock(child, `${key}-b-${i}`))}</li>;
  }
  if (node.type === 'horizontalRule') {
    return <hr key={key} style={{ border: 0, borderTop: '1px solid var(--draft-line, #d8d8d8)', margin: '18px 0' }} />;
  }
  return <React.Fragment key={key}>{renderTiptapInline(node.content, `${key}-in`)}</React.Fragment>;
}

export function DraftTiptapDocumentView({ doc, content, className = '' }) {
  const nodes = Array.isArray(content) ? content : (doc?.content || []);
  if (!nodes.length) return null;
  return (
    <div className={`legal-draft-view ${className}`.trim()}>
      {nodes.map((node, idx) => renderTiptapBlock(node, `tt-${idx}`))}
    </div>
  );
}

const DraftDocumentView = React.memo(function DraftDocumentView({ raw, className = '' }) {
  const md = useMemo(() => {
    // 1) ensureTableSeparators first — gives genuine header+data tables their GFM
    //    separator so they survive; 2) then sanitize — flattens leftover orphan/
    //    signature pipe rows into clean lines instead of literal "|" text.
    const normalized = normalizeLegalDraftMarkdownForRender(fixInlineEmphasis(String(raw || '')));
    const withSeps = ensureTableSeparators(normalized);
    const cleaned = sanitizeLegalDraftMarkdown(withSeps).replace(/[ \t]*\[source:[^\]]*\]/gi, '').trim();
    // Turn any bare "[ BANK NAME ]" placeholders the model left behind into the
    // canonical red span so EVERY unfilled field renders red.
    return canonicalizeFieldPlaceholders(cleaned);
  }, [raw]);

  if (!md) return null;

  return (
    <div className={`legal-draft-view ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, DRAFT_SANITIZE_SCHEMA]]}
        components={{ ...markdownTableComponents, ...legalDraftComponents }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}, (prev, next) => prev.raw === next.raw && prev.className === next.className);

export default DraftDocumentView;
