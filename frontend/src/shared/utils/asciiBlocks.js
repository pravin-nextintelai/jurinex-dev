/**
 * ASCII-art → clean Markdown normalisation.
 *
 * Models (especially in Deep Research / deep multi-pass legal reports) like to
 * "draw" their output instead of writing Markdown:
 *
 *   ```
 *   +-------------------+------------------+
 *   | Risk Area         | Legal Exposure   |
 *   +-------------------+------------------+
 *   | Non-Registration  | Fine u/s 55(2)   |
 *   +-------------------+------------------+
 *   ```
 *
 * Inside a fenced block that renders as raw monospace text: no column borders,
 * no wrapping, clipped at the panel edge — the "odd looking" output. The same
 * happens with flow diagrams drawn from `|` and `v`, unicode box drawings, and
 * whole drafted documents wrapped in a bare fence.
 *
 * This module rewrites those blocks into real Markdown BEFORE the renderer sees
 * them: character-drawn tables become GFM pipe tables, flow diagrams become a
 * readable arrow chain, boxed/plain prose is unwrapped into normal text with
 * hard line breaks. Genuine code fences (```python, ```json, …) are never
 * touched, and a fence whose content actually looks like code is left alone
 * even when it carries no language tag.
 *
 * Pure string-in/string-out so it is unit-testable with `node --test`.
 */

// Any letter or digit in any script — the app also answers in Marathi/Hindi, so
// a Latin-only test would treat a Devanagari line as empty scaffolding.
const ALNUM_RE = /[\p{L}\p{N}]/u;

const BOX_VERTICAL_RE = /[│║┃╎╏┆┇┊┋]/g;
const BOX_HORIZONTAL_RE = /[─═━╌╍┄┅┈┉]/g;
const BOX_JUNCTION_RE = /[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬╭╮╯╰]/g;
const BOX_ANY_RE = /[│║┃╎╏┆┇┊┋─═━╌╍┄┅┈┉┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬╭╮╯╰]/;

const ARROW_SPLIT_RE = /\s*(?:-{1,3}>|={1,3}>|<-{1,3}|→|➜|➔|⇒|▶|►)\s*/;

// Fence info strings we are allowed to rewrite. Anything else (python, json,
// sql, mermaid, …) is genuine code/markup and is passed through verbatim.
const REWRITABLE_INFO = new Set([
  '', 'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'mkd',
  'ascii', 'asciiart', 'ascii-art', 'art', 'diagram', 'flow', 'flowchart',
  'table', 'tables', 'timeline', 'chart', 'output', 'raw', 'none',
  'document', 'doc', 'draft', 'legal',
]);

const OPEN_FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
const CLOSE_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

// Lines that read as source code rather than prose/table/diagram.
const CODE_SIGNALS = [
  /^\s*(?:def|class|function|return|import|from|package|public|private|protected|const|let|var|async|await|export|require|module|#include|using|namespace|SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/,
  /[;{}]\s*$/,
  /^\s*[)\]}]+[;,]?\s*$/,
  /=>|::|->\s*\w+\s*\(|\w+\([^)]*\)\s*\{/,
  /^\s*<\/?[A-Za-z][\w:-]*[\s/>]/,
  /^\s*(?:\$|>|#!)\s*\S/,
  /^\s*"[\w-]+"\s*:/,
];

/** A line drawn purely from table/border characters: `+-----+-----+`, `=====`. */
export function isBorderLine(line) {
  const t = String(line || '').trim();
  if (!t || ALNUM_RE.test(t)) return false;
  if (!/^[\s+\-=~_|:.*'"^]+$/.test(t)) return false;
  if (t.includes('+') && /[-=~]{2,}/.test(t)) return true;
  if (t.startsWith('|') && /[-=~]{3,}/.test(t)) return true;
  if (/^[_=]{5,}$/.test(t)) return true;
  return false;
}

/** A line that is only diagram scaffolding: `   |      |`, `  v    v`, `+--->`. */
export function isDecorationLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^[|\s]+$/.test(t)) return true;
  const tokens = t.split(/\s+/);
  return tokens.every((tok) => /^(?:[-=~|+<>^vV*/\\.'`:]{1,4}|[vV^]|\|)$/.test(tok));
}

function isPipeRow(line) {
  const t = String(line || '');
  return (t.match(/\|/g) || []).length >= 2 && ALNUM_RE.test(t);
}

function looksLikeCode(lines) {
  const meaningful = lines.filter((l) => l.trim());
  if (!meaningful.length) return false;
  const hits = meaningful.filter((l) => CODE_SIGNALS.some((re) => re.test(l))).length;
  return hits / meaningful.length >= 0.25;
}

/** Map unicode box drawings onto their ASCII equivalents so one path handles both. */
function normalizeBoxChars(line) {
  return String(line || '')
    .replace(BOX_VERTICAL_RE, '|')
    .replace(BOX_JUNCTION_RE, '+')
    .replace(BOX_HORIZONTAL_RE, '-');
}

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').trim();
}

/** Build a valid GFM table (header + separator + padded rows) from cell rows. */
function rowsToMarkdownTable(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((cells) => {
    const padded = cells.slice(0, width).map(escapeCell);
    if (cells.length > width) {
      padded[width - 1] = [padded[width - 1], ...cells.slice(width)].join(' ').trim();
    }
    while (padded.length < width) padded.push('');
    return `| ${padded.join(' | ')} |`;
  });
  const separator = `|${Array(width).fill(' --- ').join('|')}|`;
  return [normalized[0], separator, ...normalized.slice(1)];
}

/** Strip the block's common indentation and cap what remains below the 4-space
 *  threshold, so unwrapped text never turns into an indented code block. */
function dedent(lines) {
  const indents = lines
    .filter((l) => l.trim())
    .map((l) => (l.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => {
    const expanded = l.replace(/\t/g, '    ');
    const stripped = expanded.slice(common);
    const lead = (stripped.match(/^ */) || [''])[0].length;
    return lead >= 4 ? `   ${stripped.trimStart()}` : stripped;
  });
}

/**
 * Rewrite one block: character-drawn tables become GFM tables, everything else
 * stays as text (hard-wrapped so the original line structure survives).
 */
function unwrapBlock(rawLines) {
  const lines = dedent(rawLines).map(normalizeBoxChars);
  const out = [];
  let tableRows = [];
  let textRun = [];

  const flushText = () => {
    if (!textRun.length) return;
    if (out.length && out[out.length - 1] !== '') out.push('');
    // Backslash hard breaks keep the drafted layout without <br> or trailing
    // spaces (downstream normalisation trims line ends).
    textRun.forEach((line, i) => {
      out.push(i < textRun.length - 1 ? `${line}\\` : line);
    });
    out.push('');
    textRun = [];
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    if (tableRows.length === 1) {
      // A lone pipe line is not a table — keep it as text.
      textRun.push(`| ${tableRows[0].join(' | ')} |`);
      tableRows = [];
      flushText();
      return;
    }
    let rows = tableRows;
    // A drawn table often opens with a full-width banner row
    // ("|   RISK ASSESSMENT MATRIX   |") above the real header. Promote it to a
    // bold caption instead of letting it become the header row.
    const first = rows[0].filter((c) => c !== '');
    const widest = Math.max(...rows.map((r) => r.length));
    if (rows.length >= 3 && first.length === 1 && widest >= 2 && rows[1].length >= 2) {
      textRun.push(`**${first[0]}**`);
      flushText();
      rows = rows.slice(1);
    }
    if (out.length && out[out.length - 1] !== '') out.push('');
    rowsToMarkdownTable(rows).forEach((l) => out.push(l));
    out.push('');
    tableRows = [];
  };

  for (const line of lines) {
    if (isBorderLine(line)) continue;               // +----+----+ between rows
    if (isDecorationLine(line)) { flushTable(); continue; }

    if (isPipeRow(line)) {
      flushText();
      tableRows.push(splitCells(line));
      continue;
    }

    flushTable();
    const text = line.replace(/[|+]/g, ' ').replace(/[ \t]+$/, '');
    if (!text.trim()) {
      if (textRun.length) flushText();
      continue;
    }
    if (!ALNUM_RE.test(text)) continue;             // leftover scaffolding
    // Space-aligned columns ("01 July 2025      30 Sept 2025") must not collapse
    // into one run-on string — separate them visibly instead.
    const lead = (text.match(/^ */) || [''])[0];
    textRun.push(lead + text.trim().replace(/\s{3,}/g, ' · '));
  }

  flushTable();
  flushText();

  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Turn an ASCII flow diagram into a single readable arrow chain / step list. */
function diagramToFlow(rawLines) {
  const steps = [];
  for (const raw of rawLines) {
    const line = normalizeBoxChars(raw);
    if (!line.trim() || isBorderLine(line) || isDecorationLine(line)) continue;
    line.split(ARROW_SPLIT_RE).forEach((segment) => {
      segment.split(/\s{3,}/).forEach((piece) => {
        const cleaned = piece
          .replace(/^[\s|+*.\\/'`<>^-]+/, '')
          .replace(/[\s|+*\\/'`<>^-]+$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (cleaned && ALNUM_RE.test(cleaned)) steps.push(cleaned);
      });
    });
  }
  if (steps.length < 2) return null;
  if (steps.length <= 8) return [steps.join(' → ')];
  return steps.map((s) => `- ${s}`);
}

function classify(lines) {
  const content = lines.filter(
    (l) => l.trim() && !isBorderLine(l) && !isDecorationLine(l),
  );
  if (!content.length) return 'empty';
  if (looksLikeCode(content)) return 'code';

  const pipeRows = content.filter(isPipeRow);
  if (pipeRows.length >= 2 && pipeRows.length / content.length >= 0.5) return 'table';

  const joined = lines.join('\n');
  const hasArrows = ARROW_SPLIT_RE.test(joined);
  const hasScaffolding = lines.some((l) => l.trim() && isDecorationLine(l));
  const hasBoxes = BOX_ANY_RE.test(joined) || lines.some(isBorderLine);
  if (content.length >= 2 && (hasArrows || (hasScaffolding && hasBoxes) || hasScaffolding)) {
    return 'diagram';
  }
  if (hasBoxes) return 'prose';
  return 'plain';
}

/** Rewrite the body of one rewritable fence. Returns null to keep it fenced. */
function rewriteFenceBody(bodyLines) {
  const kind = classify(bodyLines.map(normalizeBoxChars));
  if (kind === 'code' || kind === 'empty') return null;
  if (kind === 'diagram') {
    const flow = diagramToFlow(bodyLines);
    if (flow) return flow;
    return unwrapBlock(bodyLines);
  }
  if (kind === 'table' || kind === 'prose') return unwrapBlock(bodyLines);
  // 'plain': prose that was fenced for no reason — unwrap so it renders as text.
  return unwrapBlock(bodyLines);
}

/** Drop ASCII scaffolding that models emit outside fences (borders, `| v |` rails). */
function cleanLooseLines(lines) {
  const out = [];
  for (const line of lines) {
    const normalized = BOX_ANY_RE.test(line) ? normalizeBoxChars(line) : line;
    const t = normalized.trim();
    if (!t) { out.push(line); continue; }
    // Only unambiguous ASCII-table borders — a Markdown `---` rule or a GFM
    // `| --- |` separator must survive untouched outside a fence.
    if (!ALNUM_RE.test(t) && t.includes('+') && /[-=]{2,}/.test(t)) continue;
    if (!ALNUM_RE.test(t) && BOX_ANY_RE.test(line)) continue;
    if (/^[|\s]{3,}$/.test(t) && !t.includes('-')) continue;
    if (/^[vV^\s]+$/.test(t) && t.length > 1 && /\s/.test(t)) continue;
    out.push(normalized);
  }
  return out;
}

/**
 * Main entry point: normalise every ASCII-art construct in a Markdown string.
 *
 * @param {string} text raw model output (may be a partial stream)
 * @returns {string} the same text with ASCII art rewritten as Markdown
 */
export function cleanAsciiArtBlocks(text) {
  if (!text || typeof text !== 'string') return text;
  if (!/```|~~~|\+[-=]{2,}|[│─┌└├╔║]/.test(text)) return text;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];

  let looseRun = [];
  let fenceOpen = null;   // { marker, info, indent }
  let fenceBody = [];
  let fenceHeader = '';

  const flushLoose = () => {
    if (!looseRun.length) return;
    cleanLooseLines(looseRun).forEach((l) => out.push(l));
    looseRun = [];
  };

  const closeFence = (closingLine) => {
    const rewritten = REWRITABLE_INFO.has(fenceOpen.info.toLowerCase())
      ? rewriteFenceBody(fenceBody)
      : null;
    if (rewritten) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      rewritten.forEach((l) => out.push(l));
      out.push('');
    } else {
      out.push(fenceHeader);
      fenceBody.forEach((l) => out.push(l));
      if (closingLine !== null) out.push(closingLine);
    }
    fenceOpen = null;
    fenceBody = [];
    fenceHeader = '';
  };

  for (const line of lines) {
    if (fenceOpen) {
      const close = line.match(CLOSE_FENCE_RE);
      if (close && close[1][0] === fenceOpen.marker[0] && close[1].length >= fenceOpen.marker.length) {
        closeFence(line);
      } else {
        fenceBody.push(line);
      }
      continue;
    }

    const open = line.match(OPEN_FENCE_RE);
    if (open) {
      flushLoose();
      fenceOpen = { marker: open[2], info: open[3] || '', indent: open[1] };
      fenceHeader = line;
      fenceBody = [];
      continue;
    }

    looseRun.push(line);
  }

  // A fence still open at the end of the buffer: mid-stream, or the model never
  // closed it. Rewrite it anyway so tables render while they stream in.
  if (fenceOpen) closeFence(null);
  flushLoose();

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export default cleanAsciiArtBlocks;
