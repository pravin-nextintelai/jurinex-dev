// Shared formatting helpers for Drafting Mode — used by both the page-style
// Full Document view and the .docx export so screen and file stay identical.

/** Normalize a TextFormatSchema coming from the backend (all fields optional). */
export const normalizeFormat = (fmt, fallback = {}) => ({
  alignment: fmt?.alignment || fallback.alignment || 'left',
  fontSizePt: Number(fmt?.font_size_pt || fallback.fontSizePt || 12),
  bold: Boolean(fmt?.bold ?? fallback.bold ?? false),
  underline: Boolean(fmt?.underline ?? fallback.underline ?? false),
  allCaps: Boolean(fmt?.all_caps ?? fallback.allCaps ?? false),
});

/** Document-level defaults from TemplateStructure (court-draft conventions). */
export const documentDefaults = (structure) => ({
  fontFamily: structure?.base_font_family || 'Times New Roman',
  baseFontSizePt: Number(structure?.base_font_size_pt || 12),
  titleFormat: normalizeFormat(structure?.title_format, {
    alignment: 'center', fontSizePt: 14, bold: true,
  }),
});

/**
 * Re-scope **bold** markers so they always open and close on the SAME line,
 * and drop unpaired stragglers. The model bolds multi-line spans (a court
 * heading across two lines); the per-line renderers and the docx exporter can
 * only handle single-line spans, so without this the asterisks show literally.
 * Also strips ATX markdown headings (# / ## / ###) Claude often emits.
 */
export const normalizeBoldMarkers = (content) => {
  let src = String(content || '');
  // Strip markdown ATX headings: "# IN THE COURT…" → "IN THE COURT…"
  src = src.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  if (!src.includes('**')) return src;
  const parts = src.split('**');
  const delims = parts.length - 1;
  const lastBoldIdx = 2 * Math.floor(delims / 2) - 1;
  let out = '';
  for (let k = 0; k < parts.length; k += 1) {
    if (k % 2 === 1 && k <= lastBoldIdx) {
      out += parts[k]
        .split('\n')
        .map((l) => (l.trim() ? `**${l}**` : l))
        .join('\n');
    } else {
      out += parts[k]; // stray delimiter (odd count) is dropped, never shown
    }
  }
  return out;
};

const isTableRow = (line) => {
  const t = line.trim();
  return t.startsWith('|') && t.slice(1).includes('|') && t.length > 2;
};

/** Blank lines BETWEEN pipe rows must not split one table into fragments. */
const nextTableRowIndex = (lines, j) => {
  let k = j;
  while (k < lines.length && lines[k].trim() === '') k += 1;
  return k < lines.length && isTableRow(lines[k]) ? k : -1;
};

const isSeparatorRow = (line) =>
  /^\|(\s*:?-{2,}:?\s*\|?)+\s*$/.test(line.trim());

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const normalizeTableRows = (header, rows) => {
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const fit = (row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push('');
    return next;
  };
  return {
    header: fit(header),
    rows: rows.map(fit),
  };
};

const DATE_CELL_RE =
  /^\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|~?[A-Za-z]{3}-\d{4}|\d{4}$/;
const HEADER_LABEL_RE = /^(date|particulars|s\.?\s*no\.?|event|description|amount|details)$/i;

const rowLooksLikeData = (cells) =>
  cells.length > 0 && DATE_CELL_RE.test((cells[0] || '').trim());

const rowLooksLikeHeader = (cells) =>
  cells.some((c) => HEADER_LABEL_RE.test((c || '').replace(/\*\*/g, '').trim()));

const defaultHeaderForWidth = (n) => {
  if (n === 2) return ['Date', 'Particulars'];
  if (n === 3) return ['S.No', 'Date', 'Particulars'];
  return Array.from({ length: n }, (_, k) => `Col ${k + 1}`);
};

const collectPipeRows = (lines, start) => {
  const rows = [];
  let j = start;
  while (j < lines.length) {
    if (isTableRow(lines[j])) {
      if (!isSeparatorRow(lines[j])) rows.push(splitRow(lines[j]));
      j += 1;
      continue;
    }
    // Tolerate blank lines inside the table when another row follows.
    const k = lines[j].trim() === '' ? nextTableRowIndex(lines, j) : -1;
    if (k === -1) break;
    j = k;
  }
  return { rows, next: j };
};

/**
 * Parse section content into ordered blocks:
 *   { type: 'paragraph', text }            — one source line (may be empty)
 *   { type: 'table', header: [...], rows: [[...], ...] }
 * Markdown pipe tables become structured table blocks; everything else stays
 * verbatim line-by-line so template line structure survives untouched.
 *
 * Supports GitHub tables (header + `|---|` separator) and bare pipe rows
 * (`| date | event |` per line) common in chronology / list-of-dates sections.
 */
export const parseContentBlocks = (content) => {
  const lines = normalizeBoldMarkers(String(content || '')).split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2;
      const { rows, next } = collectPipeRows(lines, i);
      blocks.push({ type: 'table', ...normalizeTableRows(header, rows) });
      i = next;
      continue;
    }
    if (isTableRow(lines[i])) {
      const { rows, next } = collectPipeRows(lines, i);
      if (rows.length >= 2) {
        let header;
        let bodyRows;
        if (rowLooksLikeHeader(rows[0]) && !rowLooksLikeData(rows[0])) {
          header = rows[0];
          bodyRows = rows.slice(1);
        } else {
          header = defaultHeaderForWidth(rows[0].length);
          bodyRows = rows;
        }
        if (bodyRows.length >= 1) {
          blocks.push({ type: 'table', ...normalizeTableRows(header, bodyRows) });
          i = next;
          continue;
        }
      }
    }
    blocks.push({ type: 'paragraph', text: lines[i] });
    i += 1;
  }
  return blocks;
};

/** Does drafted content already restate the section heading as its first line? */
export const contentStartsWithHeading = (content, heading) => {
  const first = String(content || '').trimStart().split('\n', 1)[0]?.trim().toLowerCase() || '';
  const h = String(heading || '').trim().toLowerCase();
  if (!h) return false;
  return first === h || first.startsWith(h.slice(0, Math.max(10, h.length)));
};

/** Strip the restated heading line so heading typography can be applied once. */
export const splitHeadingFromContent = (content, heading) => {
  if (!contentStartsWithHeading(content, heading)) {
    return { headingText: heading, body: String(content || '').trim() };
  }
  const text = String(content || '').trimStart();
  const nl = text.indexOf('\n');
  return {
    headingText: nl === -1 ? text.trim() : text.slice(0, nl).trim(),
    body: nl === -1 ? '' : text.slice(nl + 1).replace(/^\n+/, '').trimEnd(),
  };
};

export const ptToPx = (pt) => Math.round(pt * (96 / 72) * 100) / 100;

/**
 * Split a line into inline segments: [{ text, bold }].
 * The model occasionally emits markdown bold (**ANNEXURE P-1**) despite the
 * no-markdown rule — render it as real bold instead of literal asterisks.
 */
export const parseInlineBold = (text) => {
  const segments = [];
  const re = /\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let m;
  const src = String(text || '');
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) segments.push({ text: src.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) segments.push({ text: src.slice(last), bold: false });
  return segments.length ? segments : [{ text: src, bold: false }];
};

/** Strip markdown bold markers for plain-text outputs (.txt download). */
export const stripInlineBold = (text) =>
  normalizeBoldMarkers(String(text || ''))
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*\*/g, '');
