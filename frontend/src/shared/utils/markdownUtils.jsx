import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import InteractiveTable from '../components/InteractiveTable';
import { cleanAsciiArtBlocks } from './asciiBlocks';

// Permissive sanitize schema: allow the safe inline HTML the model/markdown
// utilities legitimately emit (bold/italic via <strong>/<em>, line breaks via
// <br>, superscript/subscript, strikethrough, span). Without this, rehypeSanitize
// strips <br> -> it renders as literal "<br>" text and breaks the markdown flow
// (which then misparses fragments as giant Setext headings).
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([
      ...(defaultSchema.tagNames || []),
      'br', 'strong', 'em', 'sup', 'sub', 'del', 'span', 'u', 'mark', 'b', 'i', 'thinking',
    ])
  ),
  attributes: {
    ...defaultSchema.attributes,
    span: ['className', 'style'],
    div: ['className', 'style'],
    p: ['className', 'style'],
    b: ['className', 'style'],
    i: ['className', 'style'],
    strong: ['className', 'style'],
    em: ['className', 'style'],
    thinking: ['className', 'style'],
  },
};

// Shared rehype plugin chain for every assistant-markdown surface.
//   rehypeRaw      — parse embedded HTML (<strong>, <em>, <br>, …) the utils inject
//   rehypeSanitize — keep only the safe tags above (XSS protection)
//   rehypeKatex    — render LaTeX math
export const markdownRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeKatex,
];

/**
 * Curated dictionary of legal/place terms that PDF text extraction commonly
 * splits across spaces (e.g. "Ex hibit" → "Exhibit"). Applied as whole-token,
 * case-insensitive joins ONLY — these split-forms never occur in clean prose,
 * so legitimate content is never altered. Extend as new fragments are observed.
 */
const OCR_WORD_FRAGMENTS = [
  [['Con', 'stitution'], 'Constitution'],
  [['Aur', 'ang', 'abad'], 'Aurangabad'],
  [['Mah', 'arashtra'], 'Maharashtra'],
  [['Jal', 'ga', 'on'], 'Jalgaon'],
  [['Nas', 'ik'], 'Nashik'],
  [['Nag', 'pur'], 'Nagpur'],
  [['Ex', 'hibit'], 'Exhibit'],
  [['Anand', 'w', 'ade'], 'Anandwade'],
  [['At', 'mar', 'am'], 'Atmaram'],
  [['On', 'kar'], 'Onkar'],
  [['K', 'ark', 'hana'], 'Karkhana'],
  [['Sak', 'har'], 'Sakhar'],
  [['Jud', 'ic', 'ature'], 'Judicature'],
  [['Amb', 'adas'], 'Ambadas'],
  [['Sug', 'nv'], 'Sugnv'],
  [['Jad', 'hav'], 'Jadhav'],
  [['Bab', 'ura', 'o'], 'Baburao'],
  [['D', 'adas', 'a', 'heb'], 'Dadasaheb'],
  [['Bot', 're'], 'Botre'],
  [['Nil', 'anga'], 'Nilanga'],
  [['Under', 'lying'], 'Underlying'],
  [['Pro', 'ceeding'], 'Proceeding'],
  [['initially', 'ref'], 'initially ref'],
  [['courtre', 'jected'], 'court rejected'],
  [['re', 'jected'], 'rejected'],
  [['den', 'ying'], 'denying'],
  [['strong', 'ly'], 'strongly'],
  [['cont', 'ending'], 'contending'],
  [['sure', 'ty'], 'surety'],
  [['imp', 'ug', 'ned'], 'impugned'],
  [['lac', 'un', 'ae'], 'lacunae'],
  [['W', 'rit'], 'Writ'],
  [['Ground', 's'], 'Grounds'],
  [['condition', 'ally'], 'conditionally'],
  [['Cred', 'ential'], 'Credential'],
  [['Infra', 'structure'], 'Infrastructure'],
  [['Reg', 'ist', 'rar'], 'Registrar'],
  [['Cor', 'poration'], 'Corporation'],
  [['Munic', 'ipal'], 'Municipal'],
  [['Pet', 'itioner'], 'Petitioner'],
  [['Respond', 'ent'], 'Respondent'],
  [['Particular', 's'], 'Particulars'],
  [['Ex', 'h'], 'Exh'],
  [['de', 'ems'], 'deems'],
  [['Source'], 'Source'],
  // Frequently-cited case-name fragments (safe: these split-forms never occur in
  // clean text). Party names are unbounded — add recurring ones here as observed.
  [['S', 'ura', 'j'], 'Suraj'],
  [['Sang', 'hi'], 'Sanghi'],
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OCR_WORD_FIXES = OCR_WORD_FRAGMENTS.map(([frags, repl]) => [
  new RegExp('\\b' + frags.map(escapeRegExp).join('\\s+') + '\\b', 'gi'),
  repl,
]);

// Curated set of common legal words used by the dictionary-backed rejoiner below.
// A run of alphabetic fragments separated by single spaces is rejoined ONLY when
// the joined form (lowercased) is in this set — so legitimate phrases ("High
// Court", "New York") are never merged, but PDF-split words are repaired.
const LEGAL_WORD_SET = new Set([
  'petitioner','respondent','plaintiff','defendant','appellant','applicant','accused',
  'complainant','opposite','parties','party','counsel','advocate','petitioners',
  'respondents','plaintiffs','defendants','appellants','applicants',
  'court','tribunal','bench','jurisdiction','nilanga','aurangabad','mumbai','pune',
  'nashik','nagpur','jalgaon','latur','osmanabad','solapur','dharashiv',
  'karkhana','sakhar','anandwade','atmaram','onkar','judicature','ambadas','sugnv','jadhav','baburao','dadasaheb','botre','nilanga','underlying','proceeding','initially','refused','rejected','denying','strongly','issued','notice',
  'suit','suits','petition','petitions','application','applications','notice','order',
  'orders','judgment','judgments','decree','decrees','filing','filed','exhibit',
  'exhibits','annexure','annexures','affidavit','affidavits','summons','plaint',
  'written','statement','reply','rejoinder','undertaking','hamipatra',
  'compliance','repayment','recover','recovery','principal','interest','amount','debt',
  'loan','execution','defence','defense','challenge','limitation','constitutional',
  'constitution','provisional','unconditional','conditional','injunction','stay','quash',
  'impugned','impugn','maintainable','maintainability','jurisdictional','territorial',
  'pecuniary','subject','cause','action','relief','reliefs','prayer','prayers','ground',
  'grounds','issue','issues','fact','facts','evidence','evidentiary','document','documents',
  'statutory','statute','statutes','section','sections','article','articles','rule','rules',
  'regulation','regulations','act','acts','code','citation','citations','precedent',
  'precedents','ratio','decidendi','obiter','dictum','hearing','proceedings','proceeding',
  'trial','appeal','appeals','revision','review','reference','transfer','withdrawal',
  'withdraw','deposit','summary','suit','suits','handloan','transaction','transactions','agreement',
  'contract','contracts','breach','performance','specific','damages','compensation',
  'indemnity','guarantee','guarantor','surety','mortgage','pledge','lease','tenancy',
  'tenant','landlord','ownership','possession','title','property','properties','movable',
  'immovable',
  'because','therefore','however','further','against','between','through','without',
  'within','about','before','after','during','while','being','having','thereof','herein',
  'hereunder','therein','thereunder','hereby','hereto','thereby','thereafter','hereafter',
  'whereby','wherein','whereof',
  // Stamp-duty / conveyancing vocabulary commonly split by OCR
  'stamp','stamps','deed','deeds','conveyance','accountant','collector','debts','tenants',
  'allottee','allottees','annul','annulment','merger','remedy','remedies','adjudication',
  'intimation','undervaluation','inspects','inspect','inspection','jln','colly','auction',
  'receiver','registration','valuation','stamped','engrossed','endorsement',
  // Recurring case-party / person names (extensible). Proper names are unbounded —
  // add observed ones here. Merged only when adjacent fragments form one of these.
  'krishnaji','atmaram','onkar','suraj','sanghi','rajmudra','sandeep','sanjay',
  'chaudhari','sharma','kulkarni','deshmukh','patil','joshi','bhosale','pawar',
  'gaikwad','jadhav','shinde','more','kale','sawant','mane','salunke','thorat',
  'wagh','nikam','borse','ingle','shaikh',
  // Common procedural verbs / terms frequently split by OCR
  'seeking','seek','seeks','denying','deny','denied','denies','rejected','reject',
  'rejects','refused','refuse','refuses','strongly','depositing','deposited','deposits',
  'contested','contest','contesting','granted','granting','grant','grants','alleging',
  'allege','alleged','alleges','defaulted','defaulting','default','defaults','returnable',
  'permission','permitted','permitting','permit','sham','sugarcane','abide','security',
  'safeguards','disposal','pending','suitable','terms','filed','moved',
]);

const FRAGMENT_RUN_RE = /(?<!\w)([A-Za-z]+(?:\s+[A-Za-z]+){0,19})(?!\w)/g;

/**
 * Rejoin PDF-extraction split words using the dictionary. A run of 2–5 alphabetic
 * fragments separated by single spaces is rejoined ONLY when the joined form is a
 * known legal word. Safe — never merges legitimate multi-word phrases.
 *   "com pliance" -> "compliance", "Def endant" -> "Defendant",
 *   "Aur ang abad" -> "Aurangabad", "rep ayment" -> "repayment".
 */
function rejoinSplitWords(text) {
  if (!text) return text;
  return text.replace(FRAGMENT_RUN_RE, (phrase) => {
    if (!phrase.includes(' ')) return phrase;
    const parts = phrase.split(' ');
    const out = [];
    let i = 0;
    // Scan the whole run and greedily merge any 2–5 ADJACENT fragments whose join
    // is a known legal word — so a split word ANYWHERE in the run is repaired
    // ("The St amps were" -> "The Stamps were"), not only at the start.
    while (i < parts.length) {
      let merged = null;
      for (const span of [5, 4, 3, 2]) {
        if (i + span <= parts.length) {
          const cand = parts.slice(i, i + span).join('');
          if (LEGAL_WORD_SET.has(cand.toLowerCase())) {
            merged = parts[i][0] === parts[i][0].toUpperCase()
              ? cand[0].toUpperCase() + cand.slice(1)
              : cand;
            i += span;
            break;
          }
        }
      }
      if (merged !== null) {
        out.push(merged);
      } else {
        out.push(parts[i]);
        i += 1;
      }
    }
    return out.join(' ');
  });
}

/**
 * Deterministically repairs OCR/PDF extraction artefacts in one text block that
 * has already been split out of fenced code. Safe, idempotent, never crosses
 * newlines, and is a no-op on already-clean text (Gemini/Claude output).
 *
 * Fixes: non-breaking hyphens, bracket/parenthesis spacing, spaces before
 * punctuation, doubled spaces, split numbers, known split words, and
 * spaced/mismatched bold/italic markers (incl. stray unclosed asterisks).
 */
function cleanOcrArtifacts(text) {
  let t = text;
  // 1. Unicode: NBSP → space; non-breaking/odd hyphens → "-" (collapse spaces)
  t = t.replace(/ /g, ' ').replace(/[ \t]*[‐‑][ \t]*/g, '-');
  // 2. Bracket/paren interior spacing: "( A )" → "(A)", "[ x ]" → "[x]"
  t = t.replace(/([(\[])[ \t]+/g, '$1').replace(/[ \t]+([)\]])/g, '$1');
  // 3. Remove space before . , ; : ! ?
  t = t.replace(/[ \t]+([.,;:!?])/g, '$1');
  // 3b. Collapse doubled punctuation (except ...)
  t = t.replace(/([.,;:!?])\1(?!\1)/g, '$1');
  // 4. Collapse 2+ spaces that follow a non-space (keeps list indentation intact)
  t = t.replace(/(\S)[ \t]{2,}/g, '$1 ');
  // 5. Merge split numbers: "201 6" → "2016", "100 72" → "10072"
  t = t.replace(/\b(\d{2,4}) (\d{1,2})\b/g, (m, a, b) => {
    const merged = a + b;
    return merged.length <= 6 ? merged : m;
  });
  // 6. Known split-word fixes (dictionary)
  for (const [re, repl] of OCR_WORD_FIXES) t = t.replace(re, repl);
  // 6b. Law-report abbreviation "Bom" — merged ONLY in a citation context (a
  //     following number), so a standalone "Ground B omits..." is never touched.
  t = t.replace(/\bB\s+om\s+(\d)/g, 'Bom $1');
  // 6c. Tighten spaced dates: "04 / 04 / 2024" → "04/04/2024"
  t = t.replace(/\b(\d{1,2})\s*([/\-])\s*(\d{1,2})\s*([/\-])\s*(\d{2,4}(?:\s+\d)?)\b/g, (m, d, s1, m1, s2, y) => {
    return `${d}${s1}${m1}${s2}${y.replace(/\s+/g, '')}`;
  });
  // 6d. Fix common merged words: "withdrawalcanbe" -> "withdrawal can be"
  t = t.replace(/\bwithdrawalcanbe\b/gi, 'withdrawal can be');
  t = t.replace(/\bissuednotice\b/gi, 'issued notice');
  t = t.replace(/\binitiallyrefused\b/gi, 'initially refused');
  t = t.replace(/\binitiallyref\s+used\b/gi, 'initially refused');
  t = t.replace(/\bcourtre\s+jected\b/gi, 'court rejected');
  t = t.replace(/\bArticle\s+227filed\b/gi, 'Article 227 filed');
  t = t.replace(/\bdefendon\b/gi, 'defend on');
  t = t.replace(/\bon07\/07\/2025\b/gi, 'on 07/07/2025');
  t = t.replace(/\bon04\/08\/2025\b/gi, 'on 04/08/2025');
  t = t.replace(/(\d{1,2})\s*\)se\s+eking/gi, '$1) seeking');
  // 6e. Dictionary-backed rejoiner for general split words ("com pliance" etc.)
  t = rejoinSplitWords(t);
  // 7. Tighten spaced/mismatched bold & italic. Horizontal whitespace only
  //    ([ \t], never \s) so markers can't pair across newlines. An OCR-spaced
  //    OPENER always sits at the start of a line or after whitespace/an opening
  //    bracket; a marker preceded by any other character is the CLOSER of an
  //    earlier phrase ("**s. 55(2)** of the Act, **Ramesh**"). Pairing that
  //    closer with the next opener would swallow the words between them.
  t = t
    .replace(/(?<![^\s([{"'“‘])\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, '**$1**')
    .replace(/(?<![^\s([{"'“‘])\*\*[ \t]+([^*\n]+?)\*\*/g, '**$1**')
    .replace(/(?<![^\s([{"'“‘])\*\*([^*\n]+?)[ \t]+\*\*/g, '**$1**')
    .replace(/(?<![^\s([{"'“‘])\*\*[ \t]+([^*\n]+?)[ \t]+\*(?!\*)/g, '**$1**')
    .replace(/(?<![^\s([{"'“‘])\*[ \t]+([^*\n]+?)[ \t]+\*(?!\*)/g, '*$1*');
  // 8. Strip a stray mid-line single "*" (unclosed italic). The (?<=\S) guard
  //    means a real list bullet at line start is never touched.
  t = t.replace(/(?<=\S)[ \t]+\*(?!\*)[ \t]+/g, ' ');
  return t;
}

/**
 * Convert LaTeX delimiters from \( ... \) and \[ ... \] to $ ... $ and $$ ... $$.
 * This ensures compatibility with remark-math and other markdown math plugins.
 */
export function preprocessLaTeX(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$\n$1\n$$$$') // Block math
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$'); // Inline math
}

/**
 * Structure that never appears inside a real display-math span: a blank line, a
 * table row or delimiter, an HTML tag, a markdown heading, or a bold marker.
 * Any of these means the `$$` pair fences prose the model mis-delimited.
 */
const NOT_MATH_STRUCTURE =
  /\n\s*\n|\n\s*\||\|\s*:?-{2,}|<\/?[a-zA-Z][^>]*>|\*\*|(?:^|\n)\s{0,3}#{1,6}\s/;

/**
 * Signals that genuinely indicate LaTeX. `\_` and `\\` are markdown escapes, so
 * a backslash only counts when followed by two or more letters (`\frac`, `\pi`).
 *
 * A bare `_` is deliberately NOT a signal. That was the old rule, and it broke
 * every drafted legal document: signature rules ("Signature: ______") and
 * escaped underscores made `$$ Society Seal $$` look like math, so KaTeX tried
 * to parse a whole table and failed on the first `&` ("TENANT'S EMPLOYMENT &
 * INCOME VERIFICATION"), rendering the answer as red unstructured text.
 */
const LATEX_SIGNAL = /\\(?![_\\])[a-zA-Z]{2,}|[\^_]\{|[A-Za-z0-9)\]}]\^[A-Za-z0-9(]/;

const spanIsRealMath = (inner) =>
  !NOT_MATH_STRUCTURE.test(inner) && LATEX_SIGNAL.test(inner);

/**
 * Models wrap seals, placeholders and emphasis in `$$ … $$` ("$$ Society Seal")
 * despite prompt rules forbidding it. remark-math reads `$$` as display math and
 * swallows everything up to the next `$$` — tables, headings and all — into one
 * broken KaTeX span, which renders red with literal `|` and `<strong>` showing.
 *
 * Spans that actually look like LaTeX are left alone so equations from
 * `preprocessLaTeX` still render. Everything else is unwrapped: a short span
 * becomes bold (the emphasis the model meant), a multi-block one just loses the
 * delimiters, because bolding it would swallow the tables inside.
 */
export function neutralizeNonMathDollarSpans(text) {
  const source = String(text || '');
  if (!source.includes('$$')) return source;

  const preserved = [];
  let out = source.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner) => {
    if (spanIsRealMath(inner)) {
      preserved.push(match);
      return `\uE000MATH${preserved.length - 1}\uE000`;
    }
    const body = inner.trim();
    if (!body) return '';
    return NOT_MATH_STRUCTURE.test(inner) || body.length > 200 ? body : `**${body}**`;
  });

  // An odd count leaves one `$$` dangling, and remark-math would open a math
  // span that swallows the rest of the chunk. Escape it to render literally.
  out = out.replace(/\$\$/g, '\\$\\$');
  return out.replace(/\uE000MATH(\d+)\uE000/g, (_, index) => preserved[Number(index)]);
}

/**
 * Tightens bold and italic markers by removing internal spaces and converts them
 * to HTML tags as a safety net for non-standard markdown output.
 */
/**
 * Drop unpaired `**` markers so they never render as literal asterisks. Used on
 * the markdown-only path, where the `<strong>` conversion (which absorbs valid
 * pairs) is deliberately skipped.
 */
// A ** span may legitimately cross a soft or hard line break inside one paragraph
// or list item — the backend emits exactly that when it un-fences a drafted block —
// but never across a blank line, heading, table row, fence or new list item.
const EMPHASIS_SCOPE_BREAK_RE = /^\s*(?:$|#{1,6}\s|\||>?\s*(?:[-*+]|\d{1,9}[.)])\s|```|~~~)/;

/**
 * Remove only the `**` markers that genuinely cannot pair, matching each closer to
 * the nearest open marker the way remark does. Deleting "the last **" per physical
 * line silently erased both halves of any bold span that wrapped a line.
 */
function dropUnpairableBold(chunk) {
  const open = [];
  const stray = [];
  for (let i = 0; i < chunk.length - 1; i++) {
    if (chunk[i] !== '*' || chunk[i + 1] !== '*') continue;
    const before = chunk[i - 1];
    const after = chunk[i + 2];
    const canClose = before !== undefined && !/\s/.test(before);
    const canOpen = after !== undefined && !/\s/.test(after);
    if (canClose && open.length) open.pop();
    else if (canOpen) open.push(i);
    else stray.push(i);
    i++; // consume both asterisks
  }
  const remove = new Set([...open, ...stray]);
  if (!remove.size) return chunk;
  let out = '';
  for (let i = 0; i < chunk.length; i++) {
    if (remove.has(i)) { i++; continue; }
    out += chunk[i];
  }
  return out;
}

function stripUnpairedBoldMarkers(text) {
  const lines = String(text).split('\n');
  const out = [];
  let scope = [];
  const flush = () => {
    if (scope.length) { out.push(dropUnpairableBold(scope.join('\n'))); scope = []; }
  };
  for (const line of lines) {
    if (EMPHASIS_SCOPE_BREAK_RE.test(line)) flush();
    scope.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * @param {string} text
 * @param {{html?: boolean}} [options] html=false keeps `**bold**` as Markdown
 *   instead of converting it to <strong> — required for surfaces that render
 *   with skipHtml (Deep Research), where HTML tags are stripped and the emphasis
 *   would be lost entirely.
 */
export function convertMarkdownMarkers(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  const { html = true } = options;

  let t = text;

  // 0. Fix a list bullet glued to bold/italic by OCR: "-**Case Type**" -> "- **Case Type**"
  //    so it renders as a proper list item instead of a stray leading dash.
  t = t.replace(/^(\s*)-(\*+)(?=\S)/gm, '$1- $2');

  // Markdown-only surfaces (Deep Research) skip the OCR "tightening" below: the
  // model's output is already clean markdown, and tightening a CLOSER against the
  // next OPENER ("**s. 55(2)** of the Act, **Ramesh**") eats the words between
  // them. remark renders **bold** / *italic* natively, so only stray unpaired
  // markers need removing.
  if (!html) return stripUnpairedBoldMarkers(t);

  // 1. Tighten spaced bold: "** text **" -> "**text**"
  //    SINGLE LINE ONLY. Crossing newlines here pairs the CLOSING ** of one
  //    phrase with the OPENING ** of the next list item ("**Bold**\n\n*   **Next"),
  //    which deletes the newlines between blocks and shifts every following
  //    emphasis pair — the whole document then renders as fused bold text.
  //    A potential OPENER must not be preceded by a word character (that would be
  //    the CLOSER of an earlier phrase, e.g. "Khune* (…) in *Complaint"), and a
  //    potential CLOSER must not be followed by one — otherwise the closer of one
  //    emphasis and the opener of the next get "tightened" together, eating the
  //    text between them.
  //    An OCR-spaced OPENER always sits at line start or after whitespace / an
  //    opening bracket; a marker preceded by anything else (")", ":", a letter)
  //    is the CLOSER of an earlier phrase — pairing it with the next opener
  //    ("**s. 55(2)** of the Act, **Ramesh**") swallows the words between them.
  t = t.replace(/(?<![^\s([{"'“‘])\*\*[ \t]+([^\n*][^\n]*?)[ \t]+\*\*(?![\w*])/g, '**$1**');
  t = t.replace(/(?<![^\s([{"'“‘])\*\*[ \t]+([^\n*][^\n]*?)\*\*(?![\w*])/g, '**$1**');
  t = t.replace(/(?<![^\s([{"'“‘])\*\*([^\n*][^\n]*?)[ \t]+\*\*(?![\w*])/g, '**$1**');

  // 2. Tighten spaced italics: "* text *" -> "*text*" (single line only)
  t = t.replace(/(?<![^\s([{"'“‘])\*[ \t]+([^ *\n][^*\n]*?)[ \t]+\*(?![\w*])/g, '*$1*');
  t = t.replace(/(?<![^\s([{"'“‘])\*[ \t]+([^ *\n][^*\n]*?)\*(?![\w*])/g, '*$1*');
  t = t.replace(/(?<![^\s([{"'“‘])\*([^ *\n][^*\n]*?)[ \t]+\*(?![\w*])/g, '*$1*');

  // 3. Convert to HTML tags as a safety net for "broken" markdown (e.g. *text*word)
  // Bold: **text** -> <strong>text</strong>. May wrap a single newline but must
  // never cross a blank line (paragraph/list boundary).
  t = t.replace(/\*\*(?=\S)((?:(?!\n\n)[\s\S])+?)(?<=\S)\*\*(?!\*)/g, '<strong>$1</strong>');

  // Italics: *text* -> <em>text</em> (never across lines)
  t = t.replace(/(?<!\*)\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)/g, '<em>$1</em>');

  // 4. Strip stray UNPAIRED ** that survived (e.g. "-Petitioner :**" from OCR).
  //    All valid bold is already <strong> above, so any remaining ** is junk and
  //    would otherwise render as literal "**".
  t = t.replace(/\*\*/g, '');

  return t;
}

/**
 * Normalises common AI/PDF formatting artifacts before passing markdown to a
 * renderer (ReactMarkdown or parseMarkdown). Produces ChatGPT/Claude-grade clean
 * output from OCR-fragmented model responses, while leaving clean text untouched.
 */
/**
 * Convert model-emitted <br> tags to real newlines OUTSIDE table rows, so they
 * render as line breaks instead of literal "<br>" text. Inside table rows (lines
 * starting with "|") <br> is kept — GFM cells cannot contain newlines, and the
 * sanitize schema allows <br> so it renders as an in-cell break.
 */
export function stripHtmlBreaks(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .split('\n')
    .map((line) => {
      if (line.trim().startsWith('|')) {
        // Inside a table row: keep <br> (renders in-cell via pre-wrap + sanitize).
        return line;
      }
      return line.replace(/<\s*br\s*\/?\s*>/gi, '\n');
    })
    .join('\n');
}

/**
 * Prevent Setext headings: a line of text immediately followed by a line of only
 * "=" or "-" characters becomes an <h1>/<h2> (which renders giant next to body
 * text). Insert a blank line before such underline-only lines so they become
 * thematic breaks instead. Table separators (which contain "|") are left alone.
 */
export function neutralizeSetextHeadings(text) {
  if (!text || typeof text !== 'string') return text;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i];
    const isUnderline = /^[=\-]{3,}$/.test(curr.trim()) && !curr.includes('|');
    if (isUnderline && out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push('');
    }
    out.push(curr);
  }
  return out.join('\n');
}

// ── Chain-of-thought / reasoning stripping ─────────────────────────────────
// DeepSeek (and other reasoning models) sometimes write their planning into the
// answer ("We need to produce… We already have a conversation history…") or wrap
// it in <think>/<thinking> tags. Strip it so the user sees only the final answer.
const THINK_TAG_RE = /<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi;
const OPEN_THINK_RE = /<\s*think(?:ing)?\s*>[\s\S]*$/i;
const REASONING_CUE_RE = /^\s*(?:we\s+need\s+to|we\s+already\s+have|we\s+also\s+have|we\s+have\s+a\s+conversation|we\s+should|we\s+must|we\s+can\s+(?:now|produce)|we\s+will\s+(?:now|produce)|let\s+me\b|let's\b|i\s+need\s+to|i\s+will\b|i'?ll\b|i\s+should\b|to\s+(?:produce|answer|begin|summari[sz]e)\b|the\s+user('?s)?\b|the\s+task\b|first,?\s+i\b|okay\b|alright\b|here'?s\s+my\s+plan|my\s+plan\b|thinking:|reasoning:|let\s+us\s+(?:produce|begin))/i;
const STRUCTURE_RE = /^[ \t]*(?:#{1,6}\s|\|)/m;

/**
 * @param {string} text
 * @param {{dropCueParagraphs?: boolean}} [options] dropCueParagraphs=false keeps the
 *   opening paragraph. The cue heuristic fires on ordinary legal prose — "The task of
 *   the Collector under Section 33 is limited…", "To answer whether…", "The user…" —
 *   and every Deep Research report has `##` headings, so its gate is always open. On
 *   that path it silently deleted the first paragraph, citation and all.
 *   <think>/<thinking> stripping stays unconditional.
 */
function stripReasoning(text, { dropCueParagraphs = true } = {}) {
  if (!text || typeof text !== 'string') return text;
  let s = text.replace(THINK_TAG_RE, '').replace(OPEN_THINK_RE, '').replace(/^\s+/, '');
  if (!s) return s;
  if (!dropCueParagraphs) return s.trim();
  const hasStructure = STRUCTURE_RE.test(s) || s.includes('Based on a meticulous analysis');
  if (!hasStructure) return s.trim();
  const paragraphs = s.split(/\n\s*\n/);
  while (paragraphs.length) {
    const head = paragraphs[0].replace(/^\s+/, '');
    if (head.startsWith('#') || head.startsWith('|') || head.includes('Based on a meticulous analysis')) break;
    if (REASONING_CUE_RE.test(head)) { paragraphs.shift(); continue; }
    break;
  }
  return paragraphs.join('\n\n').trim();
}

/**
 * @param {string} text
 * @param {{html?: boolean, repairOcr?: boolean}} [options]
 *   html=false keeps emphasis as Markdown (`**bold**`) instead of <strong>/<em>
 *     — for renderers using skipHtml.
 *   repairOcr=false skips the PDF/OCR salvage heuristics. They exist for text
 *     extracted from scanned documents and actively CORRUPT clean model prose:
 *     they merge separated numbers ("Section 17 1" → "Section 171", "in 2025 30
 *     days" → "202530 days"), rejoin words, and rewrite a numbered chronology
 *     into a table. Deep Research answers are model-authored, never OCR.
 */
export function normalizeMarkdownFormatting(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  const { repairOcr = true } = options;

  // Strip chain-of-thought / <think> blocks first so reasoning never renders.
  let t = stripReasoning(text, { dropCueParagraphs: repairOcr });

  // Rewrite ASCII art (character-drawn tables, box diagrams, fenced prose) into
  // real Markdown BEFORE any other converter runs — those blocks otherwise
  // render as clipped monospace text instead of tables/paragraphs.
  t = cleanAsciiArtBlocks(t);

  // Strip standalone placeholder lines (e.g. ":-----------------------" or "___________")
  // that models sometimes emit as empty form-fillers.
  t = t
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      // Keep very short lines, thematic breaks (---), and lines with actual alphanumeric content.
      if (trimmed.length < 10 || /^[=\-]{3,}$/.test(trimmed)) return true;
      // If a long line is purely placeholder symbols, it's noise.
      const hasContent = /[a-zA-Z0-9]/.test(trimmed);
      if (hasContent) return true;
      // If it's just symbols like :---___... it's a placeholder row/line.
      return !!trimmed.replace(/[\s\-:=_.]/g, '');
    })
    .join('\n');

  // Convert model-emitted inline HTML to markdown — renderers escape HTML, so
  // <strong>…</strong> would otherwise display as literal tag text.
  t = t
    .replace(/<\s*(strong|b)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '**$2**')
    .replace(/<\s*(em|i)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '*$2*')
    .replace(/&nbsp;/gi, ' ');

  // Repair tables the model collapsed onto ONE physical line (rows joined with
  // "| |" and the |:---| separator inline) — they'd otherwise render as raw
  // pipe text. Split leading prose from the table, then break rows apart.
  t = t.split('\n').map((line) => {
    if (!(/\|\s*:?-{2,}:?\s*\|/.test(line) && /\|\s+\|/.test(line))) return line;
    const firstPipe = line.indexOf('|');
    const prose = line.slice(0, firstPipe).trim();
    const table = line.slice(firstPipe).replace(/\|\s+\|\s*/g, '|\n|');
    return (prose ? `${prose}\n\n` : '') + table;
  }).join('\n');

  // Drop authorship/date metadata table rows the model copies from preset
  // templates ("| **Prepared By** | JuriNex … |", "| **Date** | 04 October 2024 |").
  // A chronology HEADER row ("| Date | Event |") has no digits, so it survives.
  t = t
    .replace(/^\|\s*\*{0,2}\s*(prepared\s+(by|for)|generated\s+on)\b[^\n]*$/gim, '')
    .replace(/^\|\s*\*{0,2}\s*date\s*\*{0,2}\s*\|[^|\n]*\d{4}[^|\n]*\|?\s*$/gim, '')
    // Removing rows can leave blank lines inside a table — rejoin the rows.
    .replace(/(\|[ \t]*)\n[ \t]*\n+([ \t]*\|)/g, '$1\n$2');

  // Inline prose form: "**Prepared By:** LEXIS — … **Date:** 09 October 2024"
  // (also plain, un-bolded). Strip the authorship segment up to the next
  // metadata label / bold marker / line end, then any long-form date that
  // follows a "Date:" label (template metadata style — legal facts use
  // dd.mm.yyyy, which is untouched).
  t = t
    .replace(/\*{0,2}\s*Prepared\s+(?:By|For)\s*:?\s*\*{0,2}\s*(?:(?!\*\*|\n|\||Date\s*:)[^\n|])*/gi, '')
    .replace(/\*{0,2}\s*Date\s*:?\s*\*{0,2}\s*\d{1,2}\s+[A-Z][a-z]+,?\s+\d{4}\.?/g, '')
    .replace(/\*{0,2}\s*Date\s*:?\s*\*{0,2}\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}\.?/g, '');

  // 0a. Collapse degenerate single-column "fragment tables" (one syllable per
  //     row) back into prose BEFORE the chronology/table converters run — they
  //     bail out when a pipe table is present, so this must come first.
  if (repairOcr) t = collapseFragmentedColumnTables(t);

  // 0. Remove model-emitted <br> in flowing text (outside table rows) FIRST,
  //    before any converter runs, so they never reach the renderer as raw HTML.
  const deBred = stripHtmlBreaks(t);
  // Split at fenced code blocks so we never mangle code samples
  // Run bold-date-list converter FIRST (catches "** DATE ** – desc" format),
  // then the numbered-chronology converter (catches "1. DATE desc" format).
  // Both are OCR-era salvage: on clean model prose they turn a perfectly good
  // numbered list into a table, so they stay off when repairOcr is false.
  const boldConverted = repairOcr ? convertBoldDateListToTable(deBred) : deBred;
  const chronologyNormalized = repairOcr
    ? convertNumberedChronologyToMarkdownTable(boldConverted)
    : boldConverted;
  const latexPreprocessed = preprocessLaTeX(chronologyNormalized);
  const parts = latexPreprocessed.split(/(```[\s\S]*?```)/g);
  const cleaned = repairOcr
    ? parts.map((part, i) => (i % 2 === 1 ? part : cleanOcrArtifacts(part))).join('')
    : parts.join('');
  const marked = convertMarkdownMarkers(cleaned, { html: options.html !== false });
  return neutralizeSetextHeadings(marked);
}

// ─── Bold-date list converter ──────────────────────────────────────────────
// Handles DeepSeek's  "** 15 - Feb - 2024 ** – Event description"  output.
// The model wraps dates in ** ** and separates the description with – or —.
//
// Regex breakdown:
//   \*{1,2}          opening ** or *
//   ([^*]+)          date content (everything inside **)
//   \*{1,2}          closing ** or *
//   ([^–—\n]*)       optional annotation e.g. "(stated as cause of action date)"
//   [–—]             em-dash / en-dash separator
//   (.+)             description text
const BOLD_DATE_LIST_LINE_RE = /^\s*\*{1,2}([^*\n]+?)\*{1,2}([^–—\n]*)[–—]+\s*(.+?)\s*$/;

// Date-like content check — prevents ordinary bold phrases triggering conversion
const DATE_IN_BOLD_RE = /\d{1,2}\s*[-/]\s*(?:[A-Za-z]{3,12}|\d{1,2})\s*[-/]\s*\d{2,4}/;

// Introductory/outro sentences that should be stripped when converting to a table
const BOLD_LIST_INTRO_RE = /^(?:here\s+is|below\s+is|the\s+following\s+is|i\s+have\s+prepared|this\s+is)\b.{0,120}(?:list|timeline|chronolog|summary|matrix)/i;
const BOLD_LIST_OUTRO_RE = /^(?:all\s+facts\s+are|note\s*:|source\s*:|if\s+you\s+need|the\s+above|you\s+can\s+ask)/i;

/**
 * Converts DeepSeek's bold-date list format into a GFM pipe table.
 *
 * Input:
 *   ** 15 - Feb - 2017 ** – Company was incorporated.
 *   ** 18 - Jan - 2021 ** – Petitioner transferred Rs. 10,00,000.
 *
 * Output:
 *   | S.No | Date | Particulars |
 *   |:-----|:-----|:------------|
 *   | 1. | 15-Feb-2017 | Company was incorporated. |
 *   | 2. | 18-Jan-2021 | Petitioner transferred Rs. 10,00,000. |
 */
export function convertBoldDateListToTable(text) {
  if (!text || typeof text !== 'string') return text;
  // Already contains a pipe table → leave alone
  if (/^\s*\|.+\|\s*$/m.test(text)) return text;
  // Quick check: must have at least one bold-date-dash pattern worth converting
  if (!BOLD_DATE_LIST_LINE_RE.test(text)) return text;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let pendingRows = [];
  let seqNo = 1;

  const flushPending = () => {
    if (pendingRows.length >= 2) {
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push('| S.No | Date | Particulars |');
      out.push('|:-----|:-----|:------------|');
      pendingRows.forEach(({ date, particulars }) => {
        out.push(`| ${seqNo++}. | ${date} | ${particulars} |`);
      });
      out.push('');
    } else {
      // Too few rows — emit as-is (don't convert a single bold line to a table)
      pendingRows.forEach(({ rawLine }) => out.push(rawLine));
    }
    pendingRows = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Strip intro/outro sentences that precede/follow the date list
    if (BOLD_LIST_INTRO_RE.test(trimmed)) continue;
    if (BOLD_LIST_OUTRO_RE.test(trimmed) && pendingRows.length === 0) continue;

    const match = line.match(BOLD_DATE_LIST_LINE_RE);
    if (match && DATE_IN_BOLD_RE.test(match[1])) {
      // match[1] = raw date string inside **
      // match[2] = optional annotation between ** and –
      // match[3] = description after –
      const annotation = match[2].trim().replace(/^\(|\)$/g, '').trim();
      const date = cleanChronologyDate(match[1]);
      let particulars = escapeMarkdownTableCell(match[3]);
      if (annotation) particulars = `[${annotation}] ${particulars}`;
      pendingRows.push({ date, particulars, rawLine: line });
    } else {
      // Non-matching line: attach to previous row if it looks like continuation text
      if (
        pendingRows.length &&
        trimmed &&
        !trimmed.startsWith('**') &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('|') &&
        !BOLD_LIST_OUTRO_RE.test(trimmed)
      ) {
        pendingRows[pendingRows.length - 1].particulars +=
          `<br>${escapeMarkdownTableCell(trimmed)}`;
      } else {
        flushPending();
        // Strip trailing outro lines that come after the converted block
        if (!BOLD_LIST_OUTRO_RE.test(trimmed)) {
          out.push(line);
        }
      }
    }
  }

  flushPending();
  return out.join('\n').trim();
}

// ─── Numbered chronology converter ────────────────────────────────────────
// Date separators allow '-', '/', OR space — so "15 Mar 2021" (the format DeepSeek
// emits for a "tabular" answer) is recognised, not just "15-Mar-2021". An optional
// Before/After/Between/By prefix covers "Before 21 Aug 2024" style rows. Only a
// numbered line that STARTS with a real date becomes a table row, so ordinary
// numbered lists ("1. The petitioner filed…") are never converted.
const CHRONOLOGY_LINE_RE = /^\s*(\d{1,4})\s*\.?\s+((?:(?:Before|After|Between|By|Circa)\s+)?(?:\d{1,2}\s*[-/ ]\s*[A-Za-z]{3,12}\s*[-/ ]\s*\d(?:\s*\d){1,3}|\d{1,2}\s*[-/ ]\s*\d{1,2}\s*[-/ ]\s*\d(?:\s*\d){1,3}|[A-Za-z]{3,12}\s+\d{1,2},\s*\d(?:\s*\d){1,3})|Not\s+Mention(?:ed)?(?:\s*\([^)]+\))?)\s+(.+?)\s*$/i;
const LOOSE_TABLE_HEADER_RE = /^\s*S\.?\s*No\.?\s+Date\s+Particulars?\s*$/i;
const LOOSE_TABLE_RULE_RE = /^\s*[-_=]{8,}\s*$/;

function cleanChronologyDate(value) {
  return String(value || '')
    .trim()
    .replace(/\s*([-/])\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\b(\d{2,3})\s+(\d{1,2})\b/g, (match, a, b) => {
      const merged = `${a}${b}`;
      return merged.length <= 4 ? merged : match;
    });
}

function escapeMarkdownTableCell(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?\s*>?/gi, '<br>')
    .replace(/\s+/g, ' ')
    .replace(/\s*<br>\s*/gi, '<br>')
    .trim()
    .replace(/\|/g, '\\|');
}

/**
 * DeepSeek sometimes emits timelines as numbered plain text:
 *   11. 26 - Mar - 2011 Administrative Board Resolution...
 * Convert ONLY date-led chronology blocks so normal numbered analysis / point-wise
 * lists from the user's prompt are left exactly as the model wrote them.
 */
export function convertNumberedChronologyToMarkdownTable(text) {
  const value = String(text || '');
  if (/^\s*\|.+\|\s*$/m.test(value)) return value;

  const lines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let pendingRows = [];

  const flushPending = () => {
    if (pendingRows.length >= 2) {
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push('| S.No | Date | Particulars |');
      out.push('|---|---|---|');
      pendingRows.forEach(({ serial, date, particulars }) => {
        out.push(`| ${escapeMarkdownTableCell(`${serial}.`)} | ${escapeMarkdownTableCell(date)} | ${escapeMarkdownTableCell(particulars)} |`);
      });
      out.push('');
    } else {
      pendingRows.forEach(({ serial, date, particulars }) => {
        out.push(`${serial}. ${date} ${particulars}`.trim());
      });
    }
    pendingRows = [];
  };

  lines.forEach((line) => {
    if (LOOSE_TABLE_HEADER_RE.test(line) || LOOSE_TABLE_RULE_RE.test(line)) {
      return;
    }
    // Strip bold markers around the whole line so "**9. 08/04/2024 ...**" still
    // matches the chronology pattern (a bolded row would otherwise break the run).
    const stripped = line.replace(/^\s*\*{1,2}/, '').replace(/\*{1,2}\s*$/, '');
    const match = stripped.match(CHRONOLOGY_LINE_RE);
    if (match) {
      pendingRows.push({
        serial: match[1].trim(),
        date: cleanChronologyDate(match[2]),
        particulars: match[3].trim(),
      });
      return;
    }
    if (!line.trim()) {
      // DeepSeek separates each numbered row with a BLANK line. Don't let that
      // flush the run — keep accumulating so consecutive date-rows form ONE table.
      if (pendingRows.length) return;
      out.push(line);
      return;
    }
    if (pendingRows.length) {
      pendingRows[pendingRows.length - 1].particulars += `<br>${line.trim()}`;
      return;
    }
    flushPending();
    out.push(line);
  });

  flushPending();
  return out.join('\n').trim();
}

/**
 * Repair degenerate single-column "fragment tables".
 *
 * When the source PDF text is split one syllable/word per line, DeepSeek
 * sometimes emits a single-column GFM table with one fragment per row, e.g.:
 *   | Proceedings |
 *   | Su |
 *   | it |
 *   | No |
 *   | . |
 *   | 04 |
 *   | 202 |
 *   | 4  |
 * which renders as a tall 1-column table of gibberish. We detect that shape
 * (single column, many rows, mostly tiny cells) and collapse the cells back into
 * a single prose line. The downstream OCR repair (cleanOcrArtifacts +
 * rejoinSplitWords) then merges the fragments ("Su it" -> "Suit", "202 4" ->
 * "2024", "No ." -> "No.").
 *
 * Conservative on purpose: a legitimate single-column list (cells are whole
 * words/names, > 3 chars) never triggers this.
 */
export function collapseFragmentedColumnTables(text) {
  if (!text || typeof text !== 'string' || !text.includes('|')) return text;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  const isTableLine = (l) => l.trim().startsWith('|');
  const isSeparator = (l) => /^\|?[\s:\-|]+\|?$/.test(l.trim()) && l.includes('-');

  const splitCells = (l) => {
    let s = l.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  };

  let i = 0;
  while (i < lines.length) {
    if (!isTableLine(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // Gather a contiguous block of table lines.
    const block = [];
    let j = i;
    while (j < lines.length && isTableLine(lines[j])) {
      block.push(lines[j]);
      j += 1;
    }

    const dataLines = block.filter((l) => !isSeparator(l));
    const dataRows = dataLines.map(splitCells);
    // Rows carrying exactly one non-empty cell (a fragment). A degenerate
    // "one syllable per row" table is MOSTLY these — even when the header row
    // itself has 2 columns (e.g. "| Aspect | Details |" with a one-word-per-row
    // body). Requiring EVERY row to be single-cell missed that case.
    const singleCellRows = dataRows.filter(
      (cells) => cells.filter((c) => c !== '').length <= 1
    );

    let collapsed = false;
    if (dataRows.length >= 5 && singleCellRows.length / dataRows.length >= 0.7) {
      const cells = singleCellRows
        .map((r) => r.find((c) => c !== '') ?? '')
        .filter((c) => c !== '');
      const shortCount = cells.filter((c) => c.length <= 3).length;
      const avgLen = cells.reduce((a, c) => a + c.length, 0) / (cells.length || 1);

      // Degenerate when most fragments are tiny (OCR syllable splitting),
      // never for a real table whose rows hold complete multi-word values.
      if (cells.length >= 4 && (shortCount / cells.length >= 0.4 || avgLen < 5)) {
        if (out.length && out[out.length - 1].trim() !== '') out.push('');
        out.push(cells.join(' '));
        out.push('');
        collapsed = true;
      }
    }

    if (!collapsed) {
      block.forEach((l) => out.push(l));
    }
    i = j;
  }

  return out.join('\n');
}

// A bullet or ordered-list marker, at any indent depth.
const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;

/**
 * Ensures GFM table separator rows are present so ReactMarkdown + remarkGfm
 * can render tables immediately, even during streaming when the AI emits header
 * and data rows before the separator row has arrived.
 *
 * GFM requires:
 *   | Header |
 *   | ------ |   ← separator; without it remarkGfm renders raw pipe text
 *   | Cell   |
 */
export function ensureTableSeparators(text, { preserveIndent = false } = {}) {
  if (!text) return text;

  // Normalize Windows line endings so split/join is consistent
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const out = [];
  let insertedSepForTable = false;
  let prevLineWasTableOrSep = false;
  let openFence = null;
  let inListBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i].trim();
    const next = (lines[i + 1] || '').trim();

    // Fenced code is copied through byte-for-byte — trimming/table repair inside
    // a code block destroys its indentation and can eat lines that look like
    // table scaffolding.
    const fenceMark = curr.match(/^(`{3,}|~{3,})/);
    if (openFence) {
      out.push(lines[i]);
      if (fenceMark && fenceMark[1][0] === openFence[0] && fenceMark[1].length >= openFence.length
          && curr.slice(fenceMark[1].length).trim() === '') {
        openFence = null;
      }
      continue;
    }
    if (fenceMark) {
      openFence = fenceMark[1];
      out.push(lines[i]);
      insertedSepForTable = false;
      prevLineWasTableOrSep = false;
      continue;
    }

    const isPipeDividerOnly = /^\|[\s\-:=|]+\|?$/.test(curr);
    const isLongDividerOnly = /^[\s\-:=|]{8,}$/.test(curr) && /[-=]/.test(curr);
    const isEmptyPipeRow =
      (curr.startsWith('|') || curr.endsWith('|') || (curr.match(/\|/g) || []).length >= 2) &&
      curr
        .split('|')
        .every((cell) => {
          const trimmed = cell.trim();
          if (!trimmed) return true;
          // Row is "empty" if a cell is just dashes, colons, dots, underscores, or spaces
          return !trimmed.replace(/[\s\-:=_.]/g, '');
        });

    const isTableRow =
      (curr.startsWith('|') || (curr.endsWith('|') && (curr.match(/\|/g) || []).length >= 1)) &&
      !/^\|?[\s\-:|]+\|?$/.test(curr);

    const isSeparatorRow = /^\|?[\s\-:|]+\|?$/.test(curr) && curr.includes('-');

    const isNextDataRow =
      next &&
      (next.startsWith('|') || (next.endsWith('|') && (next.match(/\|/g) || []).length >= 1)) &&
      !/^\|?[\s\-:|]+\|?$/.test(next);

    const isNextSeparator = next && /^\|?[\s\-:|]+\|?$/.test(next) && next.includes('-');
    const isOrphanedAlignmentFragment = /^:{1,3}$/.test(curr);

    // Models sometimes emit ASCII table scaffolding as content:
    // |----|----, repeated dashed lines, or rows with only blank cells.
    // Keep the single GFM separator that belongs to a table; drop the rest.
    // Also drop extra separator rows between data rows — GFM only needs one
    // separator immediately after the header row.
    if (
      (isEmptyPipeRow && !isSeparatorRow) ||
      (isPipeDividerOnly && !isSeparatorRow) ||
      (isLongDividerOnly && !isSeparatorRow) ||
      isOrphanedAlignmentFragment ||
      (isSeparatorRow && insertedSepForTable)
    ) {
      continue;
    }

    // Ensure a blank line before a table row when transitioning from non-table content.
    // remark-gfm parses tables more reliably when preceded by a blank line.
    if (isTableRow && !prevLineWasTableOrSep && out.length > 0) {
      const lastOut = out[out.length - 1].trim();
      if (lastOut !== '') {
        out.push('');
      }
    }

    // Track whether we are inside a list: a flush-left non-list line ends it,
    // an indented line continues it, a blank line leaves it open.
    if (LIST_ITEM_RE.test(lines[i])) inListBlock = true;
    else if (curr !== '' && !/^[ \t]/.test(lines[i])) inListBlock = false;

    // Fix missing leading/trailing pipes. Only table rows may be trimmed
    // unconditionally: trimming EVERY line flattens nested lists, tears a
    // numbered list into separate <ol> blocks and ejects list continuations.
    let fixedLine;
    if (isTableRow || isSeparatorRow) {
      fixedLine = lines[i].trim();
      if (isTableRow) {
        if (!fixedLine.startsWith('|')) fixedLine = '| ' + fixedLine;
        if (!fixedLine.endsWith('|')) fixedLine = fixedLine + ' |';
      }
    } else if (!preserveIndent) {
      fixedLine = lines[i].trim();
    } else if (!inListBlock) {
      // Outside a list, 4+ leading spaces would become an indented code block.
      fixedLine = lines[i]
        .replace(/^[ \t]+/, (ws) => (ws.length >= 4 ? '' : ws))
        .replace(/\s+$/, '');
    } else {
      // Inside a list the leading indent carries the nesting; only trailing
      // whitespace goes (it would otherwise emit a stray <br>).
      fixedLine = lines[i].replace(/\s+$/, '');
    }
    out.push(fixedLine);

    if (!isTableRow && !isSeparatorRow) {
      insertedSepForTable = false;
      prevLineWasTableOrSep = curr === '';  // blank lines reset table context
      continue;
    }

    if (isSeparatorRow) {
      insertedSepForTable = true;
      prevLineWasTableOrSep = true;
      continue;
    }

    prevLineWasTableOrSep = true;

    // Insert exactly one GFM separator after the header row.
    // We do this if it's a table row and we haven't inserted a separator yet.
    if (isTableRow && !insertedSepForTable) {
      const cols = (fixedLine.match(/\|/g) || []).length - 1;
      if (cols > 0) {
        out.push('|' + Array(cols).fill(' --- ').join('|') + '|');
        insertedSepForTable = true;
      }
    }
  }

  return out.join('\n');
}

/**
 * Split very long markdown into complete block chunks. Rendering one huge legal
 * response through ReactMarkdown can stall the browser, especially when the AI
 * emits large malformed table sections. Chunking keeps long answers visible.
 */
export function splitMarkdownIntoRenderChunks(text, maxChars = 100000) {
  const value = String(text || '');
  if (value.length <= maxChars) return [value];

  const blocks = value.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  blocks.forEach((block) => {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxChars || !current) {
      current = next;
      return;
    }
    chunks.push(current);
    current = block;
  });

  if (current) chunks.push(current);
  return chunks.length ? chunks : [value];
}

// ─── hast → InteractiveTable extraction ─────────────────────────────────────
// The markdown `table` override receives the post-sanitize hast node. We walk it
// to recover the header labels and row cells so they can be rendered as an
// interactive grid (sort / filter / search / paginate / export). Cell content is
// serialised back to the SAFE inline HTML the sanitize schema already permits, so
// bold labels, <br> in-cell breaks and inline code survive into the grid.

const SAFE_CELL_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'sup', 'sub', 'mark', 'del', 'u', 'code', 'br', 'span',
]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function findChild(node, tagName) {
  if (!node || !Array.isArray(node.children)) return null;
  return node.children.find((c) => c.type === 'element' && c.tagName === tagName) || null;
}

function findChildren(node, tagName) {
  if (!node || !Array.isArray(node.children)) return [];
  return node.children.filter((c) => c.type === 'element' && c.tagName === tagName);
}

// Serialise a hast cell node to safe inline HTML (text + whitelisted inline tags).
function hastCellToHtml(node) {
  if (!node) return '';
  if (node.type === 'text') return escapeHtml(node.value || '');
  if (node.type === 'element') {
    const tag = node.tagName;
    if (tag === 'br') return '<br>';
    const inner = (node.children || []).map(hastCellToHtml).join('');
    if (SAFE_CELL_TAGS.has(tag)) return `<${tag}>${inner}</${tag}>`;
    // Unknown / block tags (e.g. <a>, <p>): unwrap but keep their text content.
    return inner;
  }
  if (Array.isArray(node.children)) return node.children.map(hastCellToHtml).join('');
  return '';
}

/**
 * Extract { headers, rows } from a hast `table` node. Returns null when the node
 * isn't a usable table so the caller can fall back to static rendering.
 */
export function extractTableData(node) {
  if (!node || !Array.isArray(node.children)) return null;

  const thead = findChild(node, 'thead');
  const tbody = findChild(node, 'tbody');

  let headers = [];
  if (thead) {
    const headerRow = findChild(thead, 'tr');
    if (headerRow) {
      headers = findChildren(headerRow, 'th').map(hastCellToHtml);
      // Some tables put the header cells in <td>.
      if (headers.length === 0) headers = findChildren(headerRow, 'td').map(hastCellToHtml);
    }
  }

  const bodyRows = tbody ? findChildren(tbody, 'tr') : findChildren(node, 'tr');
  const rows = bodyRows.map((tr) =>
    [...findChildren(tr, 'td'), ...findChildren(tr, 'th')].map(hastCellToHtml),
  );

  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
}

/**
 * ReactMarkdown `components` override — matches AppAssistant's full MD_COMPONENTS
 * pattern so DeepSeek and Gemini tables render identically across all chat surfaces.
 *
 * Tables are upgraded to an interactive grid (sort / filter / search / paginate /
 * CSV export / copy) via InteractiveTable. The static thead/th/tbody/tr/td styles
 * below remain as a safe fallback when a table node can't be parsed.
 * The color palette uses the main chat's warm-gray scheme (not AppAssistant's teal).
 */
export const markdownTableComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    // react-markdown v10 no longer passes `inline`; a block is anything that
    // spans more than one line. Multi-line blocks must never get the red inline
    // pill styling — they render as a soft, wrapping card instead of monospace
    // text clipped at the panel edge.
    const isBlock = inline === false || String(children).includes('\n');
    if (!match && isBlock) {
      return (
        <code className={`md-code-block ${className || ''}`.trim()} {...props}>
          {children}
        </code>
      );
    }
    return !inline && match ? (
      <SyntaxHighlighter
        style={oneLight}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: '1em 0',
          borderRadius: '8px',
          fontSize: '13px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
        }}
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code
        className={className}
        style={{
          backgroundColor: '#f1f5f9',
          padding: '2px 4px',
          borderRadius: '4px',
          fontSize: '0.9em',
          fontFamily: 'monospace',
          color: '#e11d48',
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  table: ({ node, ...props }) => {
    // Upgrade parseable tables to the interactive grid; fall back to the static
    // styled table when the node can't be extracted (keeps streaming-safe).
    const data = extractTableData(node);
    if (data) {
      return (
        <InteractiveTable headers={data.headers} rows={data.rows} />
      );
    }
    return (
      <div className="md-table-scroll">
        <table {...props} />
      </div>
    );
  },
  thead: ({ node, ...props }) => <thead {...props} />,
  th: ({ node, ...props }) => <th {...props} />,
  tbody: ({ node, ...props }) => <tbody {...props} />,
  tr: ({ node, ...props }) => <tr {...props} />,
  td: ({ node, ...props }) => <td {...props} />,
  // IMPORTANT: Override hr to prevent gray bars from --- separators
  hr: ({ node, ...props }) => (
    <hr className="content-divider" {...props} />
  ),
  // Prevent raw pipe lines from showing as paragraphs
  p: ({ node, children, ...props }) => {
    const text = String(children);
    // Skip lines that are raw table rows (starts with |)
    if (text.trim().startsWith('|')) return null;
    return <p {...props}>{children}</p>;
  },
};
