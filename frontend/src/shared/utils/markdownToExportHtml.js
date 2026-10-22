/**
 * Markdown → clean static HTML for exports (branded PDF / Word).
 *
 * The on-screen preview renders tables through InteractiveTable, which
 * paginates rows (only the current page is in the DOM) and puts header text
 * inside sort <button>s (stripped by the export pipeline). Exports must
 * therefore be generated from the raw markdown, not from cloned preview DOM.
 *
 * Renders the same GFM subset as the backend merged-document builders:
 * headings, paragraphs, bullet/numbered lists, pipe tables, fenced code
 * blocks, and inline **bold** / *italic* / `code`.
 */

const INLINE_TOKEN_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HR_RE = /^\s*([-*_]\s*){3,}$/;

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline **bold** / *italic* / `code` → HTML (everything else escaped). */
export function inlineMarkdownToHtml(text) {
  return String(text ?? '')
    .split(INLINE_TOKEN_RE)
    .map((token) => {
      if (!token) return '';
      if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
        return `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
      }
      if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
        return `<em>${escapeHtml(token.slice(1, -1))}</em>`;
      }
      if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
        return `<code>${escapeHtml(token.slice(1, -1))}</code>`;
      }
      return escapeHtml(token);
    })
    .join('');
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/**
 * Render markdown to static HTML. headingOffset shifts markdown heading levels
 * (e.g. 1 → answer `##` becomes `<h3>` so it nests under a section heading).
 */
export function markdownToExportHtml(markdown, { headingOffset = 0 } = {}) {
  const out = [];
  const lines = String(markdown ?? '').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
      continue;
    }

    // Table block
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      const header = splitTableRow(rows[0]);
      const body = rows.slice(1).filter((r) => !TABLE_SEP_RE.test(r));
      const html = [
        '<table><thead><tr>',
        ...header.map((c) => `<th>${inlineMarkdownToHtml(c)}</th>`),
        '</tr></thead><tbody>',
        ...body.map((r) =>
          `<tr>${splitTableRow(r).map((c) => `<td>${inlineMarkdownToHtml(c)}</td>`).join('')}</tr>`),
        '</tbody></table>',
      ];
      out.push(html.join(''));
      continue;
    }

    // Heading
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingOffset);
      const text = heading[2].trim().replace(/^\*+|\*+$/g, '').trim();
      out.push(`<h${level}>${inlineMarkdownToHtml(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) { i += 1; continue; }

    // Consecutive bullet / numbered items become one list
    if (BULLET_RE.test(line) || NUMBERED_RE.test(line)) {
      const numbered = NUMBERED_RE.test(line);
      const pattern = numbered ? NUMBERED_RE : BULLET_RE;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(`<li>${inlineMarkdownToHtml(pattern.exec(lines[i])[1])}</li>`);
        i += 1;
      }
      const tag = numbered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Plain paragraph — join soft-wrapped lines until a structural break
    const para = [line.trim()];
    i += 1;
    while (
      i < lines.length
      && lines[i].trim()
      && !HEADING_RE.test(lines[i])
      && !BULLET_RE.test(lines[i])
      && !NUMBERED_RE.test(lines[i])
      && !TABLE_ROW_RE.test(lines[i])
      && !lines[i].trimStart().startsWith('```')
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inlineMarkdownToHtml(para.join(' '))}</p>`);
  }

  return out.join('\n');
}
