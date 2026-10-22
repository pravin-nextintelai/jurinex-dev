import React, { useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  ensureTableSeparators,
  markdownRehypePlugins,
  normalizeMarkdownFormatting,
} from '@/shared/utils/markdownUtils';

const REMARK_PLUGINS = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

/**
 * Split markdown into stable top-level blocks on blank lines, keeping fenced
 * code blocks intact. Consecutive non-blank lines (a paragraph, a full table,
 * a list) stay together in one block.
 *
 * During streaming only the last block ever changes, so every completed block
 * hits the MarkdownBlock memo and is never re-parsed.
 */
export function splitMarkdownIntoBlocks(markdown) {
  const text = String(markdown || '');
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let current = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence && line.trim() === '') {
      if (current.length) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

const MarkdownBlock = memo(function MarkdownBlock({ text, components }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={markdownRehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

/**
 * Streaming-safe markdown renderer.
 *
 * - While `isStreaming` is true the raw GFM from the backend is rendered as-is
 *   (the model's output contract guarantees render-ready markdown), split into
 *   blocks so only the growing tail block re-parses on each paint.
 * - Once complete, the full normalization pipeline runs exactly once (memoized)
 *   and the result is frozen.
 */
const StreamingMarkdown = memo(function StreamingMarkdown({ content, isStreaming, components }) {
  const normalized = useMemo(
    () =>
      isStreaming
        ? String(content || '')
        : ensureTableSeparators(normalizeMarkdownFormatting(String(content || ''))),
    [content, isStreaming]
  );
  const blocks = useMemo(() => splitMarkdownIntoBlocks(normalized), [normalized]);
  return (
    <>
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} text={block} components={components} />
      ))}
    </>
  );
});

export default StreamingMarkdown;
