import documentApi from '../api/documentApi';

/**
 * Strips markdown syntax from raw text so clipboard gets clean readable content.
 * Used as a fallback when the rendered DOM ref is unavailable.
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    // Fenced code blocks — keep content, drop fences
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, '$1')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Bold + italic combinations
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Italic
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Links — keep label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Images — drop
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Blockquotes
    .replace(/^>\s+/gm, '')
    // Unordered list bullets
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    // Ordered list numbers
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Gets clean plain text from a rendered DOM element.
 * Falls back to stripMarkdown on raw text when the element is not mounted.
 */
export function getCleanText(domElement, rawFallback) {
  if (domElement) {
    return domElement.innerText || domElement.textContent || '';
  }
  // Fallback: strip HTML tags then markdown
  if (rawFallback) {
    const tmp = document.createElement('div');
    tmp.innerHTML = rawFallback;
    const fromHtml = tmp.innerText;
    // If it looks like HTML was parsed, return it; otherwise strip markdown
    return fromHtml !== rawFallback ? fromHtml : stripMarkdown(rawFallback);
  }
  return '';
}

/**
 * Loads html2pdf.js from CDN (once) and resolves when ready.
 * html2pdf renders via canvas so all fonts, emojis, and Unicode render correctly.
 */
const HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

export async function loadHtml2Pdf() {
  if (window.html2pdf) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HTML2PDF_CDN}"]`);
    if (existing) { setTimeout(resolve, 200); return; }
    const script = document.createElement('script');
    script.src = HTML2PDF_CDN;
    script.onload = () => setTimeout(resolve, 150);
    script.onerror = () => reject(new Error('Failed to load PDF library. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

// Shared typography for HTML download and Print
const EXPORT_STYLES_BASE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  h1 { font-size: 18pt; font-weight: 700; color: #111827; margin: 18pt 0 9pt; border-bottom: 1pt solid #e5e7eb; padding-bottom: 5pt; }
  h2 { font-size: 15pt; font-weight: 700; color: #111827; margin: 14pt 0 8pt; }
  h3 { font-size: 13pt; font-weight: 600; color: #374151; margin: 12pt 0 6pt; }
  h4, h5, h6 { font-size: 11pt; font-weight: 600; color: #374151; margin: 10pt 0 4pt; }
  p { margin: 0 0 9pt; text-align: justify; text-justify: inter-word; line-height: 1.75; page-break-inside: avoid; }
  ul, ol { margin: 6pt 0 10pt; padding-left: 20pt; }
  li { margin-bottom: 4pt; line-height: 1.65; page-break-inside: avoid; }
  blockquote { border-left: 3pt solid #3b82f6; padding: 8pt 12pt; margin: 10pt 0; background: #eff6ff; color: #1e40af; font-style: italic; page-break-inside: avoid; }
  code { font-family: 'Courier New', monospace; font-size: 9.5pt; background: #f3f4f6; padding: 1pt 3pt; border-radius: 2pt; }
  pre { background: #1f2937; color: #f9fafb; padding: 10pt; border-radius: 3pt; font-family: 'Courier New', monospace; font-size: 9pt; margin: 10pt 0; white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
  strong, b { font-weight: 700; }
  em, i { font-style: italic; }
  hr { border: none; border-top: 1pt solid #e5e7eb; margin: 14pt 0; }
  img { max-width: 100%; height: auto; page-break-inside: avoid; }
  .html2pdf__page-break { page-break-before: always; }
`;

// Table styles shared by both PDF and non-PDF exports
const TABLE_STYLES_SHARED = `
  table { border-collapse: collapse; margin: 10pt 0; page-break-inside: auto; }
  thead { display: table-header-group; }
  tbody tr:nth-child(even) td { background: #f9fafb; }
`;

// Table styles for HTML + Print (scrollable wide tables are fine)
const TABLE_STYLES_HTML = `
  ${TABLE_STYLES_SHARED}
  .md-table-scroll { overflow-x: auto; }
  table { width: max-content; min-width: 100%; font-size: 10.5pt; }
  th { border: 1pt solid #9ca3af; padding: 6pt 8pt; background: #f3f4f6; font-weight: 700; text-align: left; color: #1f2937; white-space: nowrap; }
  td { border: 1pt solid #d1d5db; padding: 6pt 8pt; vertical-align: top; color: #374151; }
`;

// Table styles for PDF — must fit within A4 page width, no scrolling
const TABLE_STYLES_PDF = `
  ${TABLE_STYLES_SHARED}
  table { width: 100%; max-width: 100%; font-size: 8.5pt; table-layout: fixed; }
  th { border: 0.75pt solid #9ca3af; padding: 4pt 5pt; background: #f3f4f6; font-weight: 700; text-align: left; color: #1f2937; word-break: break-word; overflow-wrap: break-word; white-space: normal; }
  td { border: 0.75pt solid #d1d5db; padding: 4pt 5pt; vertical-align: top; color: #374151; word-break: break-word; overflow-wrap: break-word; }
`;

/**
 * Clones the element and removes UI chrome + oklch() colors (canvas can't parse them).
 * When forPdf=true also unwraps .md-table-scroll divs — html2canvas captures only the
 * *visible* portion of overflow:auto containers, clipping the right columns in PDF output.
 */
function cloneForExport(element, forPdf = false) {
  const cloned = element.cloneNode(true);
  cloned.querySelectorAll('button, .ai-message-actions, .chat-thread-card__footer').forEach(el => el.remove());

  if (forPdf) {
    // Replace every scroll-wrapper with its children so the full table is captured
    cloned.querySelectorAll('.md-table-scroll').forEach(wrapper => {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    });
    // Also remove inline styles that would push the layout beyond the A4 page:
    // table width/max-content AND th/td white-space:nowrap (inline styles override the
    // PDF stylesheet's white-space:normal, widening the layout and shifting the canvas).
    cloned.querySelectorAll('table, th, td').forEach(el => el.removeAttribute('style'));
    cloned.querySelectorAll('table').forEach(tbl => {
      tbl.style.width = '100%';
    });
  }

  [cloned, ...cloned.querySelectorAll('*')].forEach(el => {
    if (el.hasAttribute && el.hasAttribute('style')) {
      const safe = el.getAttribute('style')
        .split(';')
        .filter(s => s.trim() && !s.toLowerCase().includes('oklch'))
        .join(';');
      if (safe) el.setAttribute('style', safe);
      else el.removeAttribute('style');
    }
  });
  return cloned;
}

function buildExportHtmlString(cloned, forPdf = false) {
  const bodyStyle = forPdf
    // Explicit A4 pixel width (not max-width:100% + overflow:hidden): the string source
    // renders in a container sized to the REAL browser window, so percentage widths +
    // windowWidth:794 disagree and html2canvas captures a shifted/clipped strip.
    ? `font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.75;color:#1f1f1f;background:#fff;text-rendering:optimizeLegibility;padding:0;margin:0;width:${A4_WIDTH_PX}px;`
    : 'font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.75;color:#1f1f1f;background:#fff;text-rendering:optimizeLegibility;padding:24pt 32pt;';
  const tableStyles = forPdf ? TABLE_STYLES_PDF : TABLE_STYLES_HTML;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${EXPORT_STYLES_BASE}
body { ${bodyStyle} }
${tableStyles}
@media print { body { padding: 0; } pre { white-space: pre-wrap; } }
</style>
</head>
<body>
${cloned.innerHTML}
</body>
</html>`;
}

// A4 at 96 dpi — tells html2canvas to assume this viewport width so
// percentage widths compute to A4 dimensions, not the user's monitor width.
const A4_WIDTH_PX = Math.round(210 * 96 / 25.4); // ≈ 794

// ── DOM → GFM markdown ────────────────────────────────────────────────────────
// The rendered response DOM originates from markdown, so its structure maps
// back cleanly. This feeds the backend PDF builder, which produces real
// selectable-text PDFs (the html2canvas path rasterizes the DOM to images).

const MD_SKIP_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'IFRAME', 'IMG', 'INPUT', 'SELECT']);
const MD_BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'PRE', 'BLOCKQUOTE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'FIGURE', 'HEADER', 'FOOTER', 'MAIN',
]);

function mdInline(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += child.textContent.replace(/\s+/g, ' '); continue; }
    if (child.nodeType !== 1 || MD_SKIP_TAGS.has(child.tagName)) continue;
    const tag = child.tagName;
    if (tag === 'BR') { out += ' '; continue; }
    const inner = mdInline(child).replace(/\s+/g, ' ').trim();
    if (!inner) continue;
    if (tag === 'STRONG' || tag === 'B') out += `**${inner}**`;
    else if (tag === 'EM' || tag === 'I') out += `*${inner}*`;
    else if (tag === 'CODE') out += `\`${inner}\``;
    else out += mdInline(child);
  }
  return out;
}

function mdTable(tableEl) {
  const trs = Array.from(tableEl.querySelectorAll('tr'));
  if (!trs.length) return null;
  const cellText = (cell) => mdInline(cell).replace(/\s+/g, ' ').replace(/\|/g, '¦').trim();
  const toRow = (tr) =>
    `| ${Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map(cellText).join(' | ')} |`;
  const nCols = Math.max(1, trs[0].children.length);
  const rows = [toRow(trs[0]), `|${Array(nCols).fill(' --- ').join('|')}|`];
  trs.slice(1).forEach((tr) => rows.push(toRow(tr)));
  return rows.join('\n');
}

function mdBlocks(el, out) {
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      const t = child.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    if (child.nodeType !== 1 || MD_SKIP_TAGS.has(child.tagName)) continue;
    const tag = child.tagName;
    const headingMatch = /^H([1-6])$/.exec(tag);
    if (headingMatch) {
      const t = mdInline(child).trim();
      if (t) out.push(`${'#'.repeat(Number(headingMatch[1]))} ${t}`);
      continue;
    }
    if (tag === 'P' || tag === 'BLOCKQUOTE') {
      const t = mdInline(child).trim();
      if (t) out.push(t);
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      const lines = [];
      let n = 1;
      Array.from(child.children).forEach((li) => {
        if (li.tagName !== 'LI') return;
        const t = mdInline(li).replace(/\s+/g, ' ').trim();
        if (t) lines.push(tag === 'OL' ? `${n++}. ${t}` : `- ${t}`);
      });
      if (lines.length) out.push(lines.join('\n'));
      continue;
    }
    if (tag === 'TABLE') {
      const table = mdTable(child);
      if (table) out.push(table);
      continue;
    }
    if (tag === 'PRE') {
      const code = child.textContent.replace(/```/g, '');
      if (code.trim()) out.push(`\`\`\`\n${code.replace(/\n+$/, '')}\n\`\`\``);
      continue;
    }
    if (tag === 'HR') continue;
    // Generic container: recurse when it holds block children, else treat as a paragraph.
    const hasBlockChild = Array.from(child.children).some((c) => MD_BLOCK_TAGS.has(c.tagName));
    if (hasBlockChild) {
      mdBlocks(child, out);
    } else {
      const t = mdInline(child).replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  }
}

/** Converts a rendered response element back to GFM markdown. */
export function domToMarkdown(element) {
  const cloned = cloneForExport(element, false);
  const out = [];
  mdBlocks(cloned, out);
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Downloads a DOM element as a properly formatted PDF.
 * Primary path: convert the DOM back to markdown and let the backend build a
 * real text-based PDF (selectable text, proper tables and page breaks).
 * Fallback: the legacy html2pdf.js canvas capture, only if the backend fails.
 */
export async function downloadAsPdf(element, filename = 'AI_Response.pdf') {
  if (!element) throw new Error('No content to export.');

  try {
    const markdown = domToMarkdown(element);
    if (!markdown) throw new Error('No convertible content found.');
    const base = String(filename).replace(/\.pdf$/i, '');
    const title = base.replace(/_/g, ' ').replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '').trim() || 'AI Response';
    await documentApi.exportMergedPdf(
      title,
      [{ question: title, answer: markdown, source: null }],
      false,
      /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`
    );
    return;
  } catch (err) {
    console.error('[responseExport] Backend PDF export failed, falling back to canvas render:', err);
  }

  await loadHtml2Pdf();
  if (document.fonts) await document.fonts.ready;

  const htmlString = buildExportHtmlString(cloneForExport(element, true), true);

  const opt = {
    margin: [12, 14, 12, 14],
    filename,
    image: { type: 'jpeg', quality: 0.97 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: A4_WIDTH_PX,   // render at A4 width so tables lay out correctly
      width: A4_WIDTH_PX,         // capture exactly the A4-wide layout, not the real window
      x: 0,
      y: 0,
      scrollX: 0,                 // ignore the host page's scroll offsets — a scrolled
      scrollY: 0,                 // parent shifts the capture and clips the content
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['h1', 'h2', 'h3', 'h4', 'tr', 'li', 'blockquote', 'pre'] },
  };

  await window.html2pdf().set(opt).from(htmlString, 'string').save();
}

/**
 * Downloads a DOM element as a plain Word (.doc) file without branding.
 * For branded Word export use downloadWithBranding({ type: 'word' }).
 */
export function downloadAsWord(element, filename = 'AI_Response.doc') {
  if (!element) throw new Error('No content to export.');
  const cloned = cloneForExport(element, false);
  const wordDoc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>Document</title>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.7; color: #1f1f1f; margin: 1in; }
h1 { font-size: 18pt; font-weight: bold; color: #111827; margin: 18pt 0 8pt; }
h2 { font-size: 15pt; font-weight: bold; color: #111827; margin: 14pt 0 7pt; }
h3 { font-size: 13pt; font-weight: bold; color: #374151; margin: 12pt 0 6pt; }
h4, h5, h6 { font-size: 11pt; font-weight: bold; color: #374151; margin: 10pt 0 4pt; }
p { margin: 0 0 10pt; }
ul, ol { margin: 0 0 10pt; padding-left: 20pt; }
li { margin-bottom: 4pt; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
th, td { border: 1pt solid #d1d5db; padding: 6pt 8pt; font-size: 10pt; vertical-align: top; }
th { background: #f3f4f6; font-weight: bold; }
blockquote { border-left: 3pt solid #3b82f6; padding-left: 12pt; margin: 10pt 0; color: #4b5563; font-style: italic; }
strong { font-weight: 700; }
em { font-style: italic; }
code { font-family: 'Courier New', monospace; font-size: 9pt; background: #f3f4f6; padding: 1pt 3pt; }
pre { background: #1f2937; color: #f9fafb; padding: 10pt; font-family: 'Courier New', monospace; font-size: 9pt; white-space: pre-wrap; }
</style>
</head>
<body>
${cloned.innerHTML}
</body>
</html>`;
  const blob = new Blob([`﻿${wordDoc}`], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a DOM element as a self-contained HTML file.
 * Tables stay scrollable in the browser — no width constraint needed.
 */
export function downloadAsHtml(element, filename = 'AI_Response.html') {
  if (!element) throw new Error('No content to export.');
  const htmlString = buildExportHtmlString(cloneForExport(element, false), false);
  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Opens the response in a new window and triggers the browser print dialog.
 */
export function printResponse(element) {
  if (!element) throw new Error('No content to print.');
  const htmlString = buildExportHtmlString(cloneForExport(element, false), false);
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.open();
  win.document.write(htmlString);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}
