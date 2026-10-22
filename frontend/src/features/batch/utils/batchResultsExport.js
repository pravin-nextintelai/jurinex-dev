import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert markdown text to HTML for export (tables, bold, lists). */
export function markdownToExportHtml(text) {
  if (!text?.trim()) return '<p>—</p>';
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, text),
  );
}

/**
 * Build inner HTML for branded / plain PDF, Word, HTML export of batch job results.
 */
export function buildBatchResultsExportHtml({ title, model, results = [] }) {
  const safeTitle = escapeHtml(title || 'Batch Results');
  const meta = [
    model && model !== '—' ? `Model: ${escapeHtml(model)}` : null,
    `${results.length} quer${results.length === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean).join(' · ');

  const sections = results.map((r, index) => {
    const key = escapeHtml(r.request_key || `q-${index}`);
    const queryHtml = markdownToExportHtml(r.query_text || '');
    const responseHtml = markdownToExportHtml(r.response_text || '');
    return `
<section class="batch-export-item">
  <h2 style="font-size: 14pt; font-weight: 700; color: #1e293b; margin: 0 0 12pt; border-bottom: 1pt solid #e2e8f0; padding-bottom: 6pt;">
    ${index + 1}. ${key}
  </h2>
  <div style="margin-bottom: 16pt;">
    <p style="font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin: 0 0 8pt;">Query</p>
    <div style="padding: 10pt 12pt; background: #f8fafc; border: 1pt solid #e2e8f0; border-radius: 4pt;">${queryHtml}</div>
  </div>
  <div>
    <p style="font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin: 0 0 8pt;">Response</p>
    <div>${responseHtml}</div>
  </div>
</section>`;
  }).join('\n');

  return `
<div class="batch-results-export">
  <h1 style="font-size: 20pt; font-weight: 700; color: #0f172a; margin: 0 0 6pt;">${safeTitle}</h1>
  ${meta ? `<p style="font-size: 10pt; color: #64748b; margin: 0 0 24pt;">${meta}</p>` : ''}
  ${sections || '<p>No results on this page.</p>'}
</div>`;
}

export function batchExportFilename(displayName, ext) {
  const base = (displayName || 'batch-results')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 48) || 'batch-results';
  const date = new Date().toISOString().slice(0, 10);
  return `${base}_${date}.${ext}`;
}
