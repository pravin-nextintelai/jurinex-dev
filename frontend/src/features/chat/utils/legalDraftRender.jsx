import React from 'react';

/**
 * Dedicated rendering engine for legal DRAFT documents (draft-from-template).
 *
 * The general chat markdown renderer keeps breaking draft structure — most visibly
 * when a model emits a signature / execution block as malformed pipe rows
 * ("| | | Place: Pune | … | | Advocate for the Plaintiff |") that GitHub-flavored
 * markdown renders as literal "|" characters. This module isolates draft rendering:
 *   - sanitizeLegalDraftMarkdown() repairs the markdown (converts orphan pipe rows to
 *     clean lines, keeps only genuine tables) BEFORE ReactMarkdown sees it;
 *   - draftLineAlign() gives court-document alignment (centered titles / cause title /
 *     VERSUS, right-aligned party role labels, justified body);
 *   - legalDraftComponents are a serif, court-styled ReactMarkdown component set,
 *     completely separate from the chat's aiMarkdownComponents.
 */

// ── alignment (content-driven, works for live + history) ─────────────────────
const _CENTER_RE = [
  /^IN THE (COURT|HIGH COURT|MATTER)\b/i,
  /^(COMMERCIAL |CIVIL |CRIMINAL )?(SUIT|PETITION|APPLICATION|APPEAL|CASE|COMPLAINT)\s+NO\.?/i,
  /^(VERSUS|VS\.?|V\/S\.?)$/i,
  /^BEFORE THE\b/i,
  /^IN THE MATTER OF\b/i,
  /^(PLAINT|PETITION|APPLICATION|WRIT PETITION|MEMORANDUM)\s+UNDER\b/i,
  /^(PRAYER|VERIFICATION|STATEMENT OF TRUTH|SYNOPSIS|INDEX|LIST OF DATES|LIST OF DOCUMENTS|MEMO OF PARTIES|AFFIDAVIT|VAKALATNAMA)\b.{0,40}$/i,
  /^AND FOR THIS ACT OF KINDNESS/i,
  /(AGREEMENT|DEED|INDENTURE|CONTRACT|WILL|TESTAMENT|MEMORANDUM OF UNDERSTANDING|LEASE|MOU)\s*$/i, // ALL-CAPS doc title
];
// A trailing party-role label line: "…Plaintiff", "...Defendant", "… Petitioner".
const _ROLE_RE = /^[.…\s]*[.…]\s*(the\s+)?(first|second|third)?\s*(plaintiff|defendant|petitioner|respondent|appellant|applicant|complainant|landlord|tenant|lessor|lessee|licensor|licensee|vendor|purchaser|party)s?\b/i;
const _LEFT_LEADIN_RE = /^(BY AND BETWEEN|BETWEEN|AND|WHEREAS|RECITALS?|NOW\s+(?:THIS|THE)\b.*|THIS\s+AGREEMENT\s+WITNESSETH|WITNESSETH\b)/i;

// Collapse whitespace INSIDE a bold/italic span — "** RENT AGREEMENT **" → "**RENT AGREEMENT**".
// A drafting model sometimes pads the emphasis markers with spaces; CommonMark then refuses to
// parse it (a space right after "**" is not a valid opening delimiter), so the title renders as
// LITERAL "**…**" instead of bold — and the trailing "**" also defeats the centered-title match
// in draftLineAlign. Trimming the inner spaces fixes both. Valid "**text**" is left unchanged.
export function fixInlineEmphasis(text) {
  if (!text) return text;
  return String(text)
    .replace(/\\\*\\\*[ \t]*([^*\n]+?)[ \t]*\\\*\\\*/g, '**$1**')
    .replace(/\\_\\_[ \t]*([^_\n]+?)[ \t]*\\_\\_/g, '__$1__')
    .replace(/\*\*[ \t]*([^*\n]+?)[ \t]*\*\*/g, '**$1**')
    .replace(/__[ \t]*([^_\n]+?)[ \t]*__/g, '__$1__');
}

export function draftLineAlign(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // Strip surrounding markdown emphasis / heading markers so a title still carrying a literal
  // "**" or "#" (a bold marker the renderer didn't parse) is recognised the same as clean text.
  const probe = (t.replace(/^[#>\s]+/, '').replace(/^(?:\*\*|\*|__|_|`)+/, '')
    .replace(/(?:\*\*|\*|__|_|`)+$/, '').trim()) || t;
  if (_ROLE_RE.test(probe)) return 'right';
  if (_LEFT_LEADIN_RE.test(probe)) return 'left';
  const isAllCaps = probe.length > 3 && probe === probe.toUpperCase() && /[A-Z]/.test(probe);
  for (const re of _CENTER_RE) {
    if (re.test(probe)) {
      // Only treat the ALL-CAPS doc-title rule as centered when the line is actually all-caps.
      if (re === _CENTER_RE[_CENTER_RE.length - 1] && !isAllCaps) continue;
      return 'center';
    }
  }
  return null;
}


const _STRUCTURAL_BOLD_RE = /^\s*\*\*\s*([^*\n]{2,140}?)\s*\*\*\s*(.*)$/;
const _LEGAL_LABEL_RUN_RE = /\s+(?=(?:\d+\.\s*)?(?:Witness\s+Name|Address|ID\s+Proof\s+No\.?|PAN\s+No\.?|Aadhaar\s+No\.?|Signature|Name|Date|Place)\s*:)/gi;

function _isStructuralHeadingText(text) {
  const cleaned = String(text || '').trim().replace(/[:\-–—]+$/, '').trim();
  if (cleaned.length < 3 || cleaned.length > 140) return false;
  const letters = cleaned.match(/[A-Za-z]/g) || [];
  if (!letters.length) return false;
  const upperRatio = letters.filter((ch) => ch === ch.toUpperCase()).length / letters.length;
  return upperRatio >= 0.78 || draftLineAlign(cleaned) === 'center';
}

function _isStandaloneStructuralHeading(text, trailing) {
  const heading = String(text || '').trim();
  if (!_isStructuralHeadingText(heading)) return false;
  // Only true document titles / court-title lines become heading nodes. Lead-in labels
  // such as BY AND BETWEEN, WHEREAS, SIGNATURES, ANNEXURE, etc. stay as bold left text
  // unless the content-driven alignment rules identify them as centered for this template.
  return draftLineAlign(heading) === 'center';
}

function _splitLegalLabelRuns(line) {
  const raw = String(line || '');
  if (/^\s*\|.*\|\s*$/.test(raw)) return [raw];
  if (!/(Witness\s+Name|Address|ID\s+Proof\s+No\.?|PAN\s+No\.?|Aadhaar\s+No\.?|Signature|Name|Date|Place)\s*:/i.test(raw)) {
    return [raw];
  }
  return raw
    .replace(_LEGAL_LABEL_RUN_RE, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeLegalDraftMarkdownForRender(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const structural = _STRUCTURAL_BOLD_RE.exec(line);
    if (structural) {
      const heading = structural[1].trim();
      const trailing = structural[2].trim();
      if (_isStandaloneStructuralHeading(heading, trailing)) {
        out.push(`## ${heading}`);
        if (trailing) {
          if (/^\(/.test(trailing)) out.push('', trailing);
          else out.push(..._splitLegalLabelRuns(trailing));
        }
        continue;
      }
      const rebuilt = `**${heading}**${trailing ? ` ${trailing}` : ''}`;
      out.push(..._splitLegalLabelRuns(rebuilt));
      continue;
    }
    out.push(..._splitLegalLabelRuns(line));
  }
  return out.join('\n');
}

// ── markdown sanitizer ───────────────────────────────────────────────────────
const _isSep = (l) => /^\|[\s\-:|]+\|$/.test(l.trim());
const _isPipeRow = (l) => {
  const s = l.trim();
  return s.startsWith('|') && s.endsWith('|') && s.length > 2;
};
// A pipe row is "structured" (a real table row) when it has multiple non-empty cells.
const _cellsOf = (l) =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Repair malformed markdown from a legal draft:
 *  - A contiguous block of pipe rows that has a separator row AND ≥2 non-separator rows
 *    is a genuine table → keep as-is.
 *  - Any other pipe row(s) (a lone signature/execution row, rows with mostly empty cells,
 *    no separator) → convert to clean lines: emit each non-empty cell on its own line.
 * This turns "| | | Place: Pune | Nexora… | | Date: ___ | … | Advocate for the Plaintiff |"
 * into readable, properly-structured lines instead of literal pipe text.
 */
export function sanitizeLegalDraftMarkdown(text) {
  const norm = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = norm.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!_isPipeRow(lines[i]) && !_isSep(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    // collect a contiguous pipe block (until a blank or non-pipe line)
    const block = [];
    let j = i;
    while (j < lines.length && lines[j].trim() !== '' && (_isPipeRow(lines[j]) || _isSep(lines[j]))) {
      block.push(lines[j]);
      j += 1;
    }
    const dataRows = block.filter((b) => !_isSep(b));
    const hasSep = block.some(_isSep);
    // After ensureTableSeparators() has run, a genuine table already has a separator
    // row and ≥2 data rows. A lone / erratic pipe row (a botched signature block) has
    // neither, so it is treated as orphan and flattened to clean lines.
    const looksLikeTable = hasSep && dataRows.length >= 2;
    if (looksLikeTable) {
      block.forEach((b) => out.push(b));
    } else {
      // orphan / malformed pipe rows → clean lines (drop empty cells, drop stray pipes)
      dataRows.forEach((r) => {
        const cells = _cellsOf(r).filter(Boolean);
        if (cells.length === 0) return;
        cells.forEach((c) => out.push(c));
      });
    }
    i = j;
  }
  // Legal paragraph numbers must stay LITERAL TEXT ("29. The Plaintiff…"), never become
  // markdown ordered lists — GFM renumbers list items (29. → 1.) and the app's global
  // list-style reset hides the markers entirely (the "numbering disappeared" bug).
  // Escaping the dot keeps the exact number in the justified paragraph, as filed.
  return out
    .map((l) => (_isPipeRow(l) || _isSep(l) ? l : l.replace(/^(\s*)(\d{1,3})\.(\s+)/, '$1$2\\.$3')))
    .join('\n');
}

// ── unfilled-field placeholder canonicaliser ─────────────────────────────────
// A drafter (and especially the single-call fallback path) often copies a template's bare
// bracket placeholders verbatim — "[ BANK NAME ]", "[ ACCOUNT NUMBER ]", "[ IFSC CODE ]",
// "[ UPI ID ____ ]" — instead of the canonical red span. Those render as ordinary black text
// and are NOT clickable fields. This normalises every ALL-CAPS field-label bracket to the
// SAME canonical red placeholder span the FieldPill node + .docx renderer already understand,
// so every unfilled field is red and fillable regardless of which draft path produced it.
//
// Deliberately conservative: it fires only on ALL-CAPS labels with ≥2 uppercase letters, so
// ordinary bracketed prose ("[sic]", "[2024]", "[Exhibit A]") and markdown links "[t](url)"
// are left alone; anything already inside a <span> (an existing red/styled placeholder) is
// protected so it is never wrapped twice.
const _FIELD_LABEL_RE = /^[A-Z0-9 ./&()%,'’-]+$/;
// Private-use sentinel: cannot occur in draft text and carries no "[", so the bracket pass
// can never touch a protected span. Fully restored before the function returns.
const _SPAN_OPEN = String.fromCharCode(0xE000);
const _SPAN_CLOSE = String.fromCharCode(0xE001);

function _normalizeFieldLabel(inner) {
  return String(inner).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function _isFieldLabel(inner) {
  const label = _normalizeFieldLabel(inner);
  if (label.length < 2) return false;
  if (!_FIELD_LABEL_RE.test(label)) return false;
  return (label.match(/[A-Z]/g) || []).length >= 2; // excludes [2024], [A], [i], and links
}

export function canonicalizeFieldPlaceholders(text) {
  if (!text) return text;
  // 1) protect existing spans so an already-red (or otherwise styled) placeholder is never
  //    wrapped twice.
  const spans = [];
  let s = String(text).replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, (m) => {
    spans.push(m);
    return `${_SPAN_OPEN}${spans.length - 1}${_SPAN_CLOSE}`;
  });
  // 2) wrap every bare ALL-CAPS field-label bracket in the canonical red placeholder span
  //    (skip markdown links — a "[" immediately followed by "](").
  s = s.replace(/\[([^\]\n]{1,60})\](?!\()/g, (full, inner) =>
    _isFieldLabel(inner)
      ? `<span style="color:red;font-weight:bold;">[________ ${_normalizeFieldLabel(inner)} ________]</span>`
      : full,
  );
  // 3) restore the protected spans
  return s.replace(new RegExp(`${_SPAN_OPEN}(\\d+)${_SPAN_CLOSE}`, 'g'), (_m, i) => spans[Number(i)]);
}

// ── court-styled ReactMarkdown component set (serif, isolated from chat) ──────
const _extract = (children) => {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(_extract).join('');
  if (typeof children === 'object' && children.props) return _extract(children.props.children);
  return '';
};

const SERIF = "'Times New Roman', 'Liberation Serif', Georgia, serif";

export const legalDraftComponents = {
  p: ({ node, children, ...props }) => {
    const align = draftLineAlign(_extract(children));
    return (
      <p
        style={{
          margin: '0 0 10px',
          fontFamily: SERIF,
          fontSize: '15px',
          lineHeight: 1.7,
          color: 'var(--draft-fg, #1a1a1a)',
          textAlign: align || 'justify',
        }}
        {...props}
      >
        {children}
      </p>
    );
  },
  h1: ({ node, children, ...props }) => (
    <h1 style={{ fontFamily: SERIF, fontSize: '18px', fontWeight: 700, margin: '18px 0 10px', textAlign: draftLineAlign(_extract(children)) || 'left', color: 'var(--draft-fg, #111)' }} {...props}>{children}</h1>
  ),
  h2: ({ node, children, ...props }) => (
    <h2 style={{ fontFamily: SERIF, fontSize: '16px', fontWeight: 700, margin: '16px 0 8px', textAlign: draftLineAlign(_extract(children)) || 'left', color: 'var(--draft-fg, #111)' }} {...props}>{children}</h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3 style={{ fontFamily: SERIF, fontSize: '15px', fontWeight: 700, margin: '14px 0 6px', textAlign: draftLineAlign(_extract(children)) || 'left', color: 'var(--draft-fg, #222)' }} {...props}>{children}</h3>
  ),
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px', paddingLeft: '26px', fontFamily: SERIF, fontSize: '15px', lineHeight: 1.7, listStyle: 'decimal', listStylePosition: 'outside' }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px', paddingLeft: '24px', fontFamily: SERIF, fontSize: '15px', lineHeight: 1.7, listStyle: 'disc', listStylePosition: 'outside' }} {...props} />,
  li: ({ node, ...props }) => <li style={{ margin: '4px 0' }} {...props} />,
  hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--draft-line, #d8d8d8)', margin: '18px 0' }} />,
};
