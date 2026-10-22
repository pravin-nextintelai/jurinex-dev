# Drafting Mode — Frontend Developer Guide

> How the frontend consumes the drafting SSE stream, renders it at 100-page scale,
> and downloads a court-ready `.docx` — for developers extending or porting this module.
>
> Files: `draftingModeApi.js` (transport) → `draftStreamParser.js` (protocol) →
> `DraftingModal.jsx` (state) → `DraftStreamingViewer.jsx` (rendering) →
> `draftFormatUtils.js` + `draftDocxExport.js` (formatting + download).

---

## 1. Transport — SSE over `fetch` (not `EventSource`)

`EventSource` cannot POST a JSON body or send an `Authorization` header, so the stream
is consumed with `fetch` + `ReadableStream`:

```js
// services/draftingModeApi.js — streamDraftGeneration()
const res = await fetch(`${BASE}/${sessionId}/generate/stream`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
             Accept: 'text/event-stream' },
  body: JSON.stringify({ llm_name, section_ids, user_instructions }),
  signal,                                  // AbortController → Stop button
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });   // stream:true — chunk may split a UTF-8 char
  const frames = buffer.split('\n\n');                 // SSE frames end with a blank line
  buffer = frames.pop() || '';                         // keep the incomplete tail
  for (const frame of frames) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return;                // terminal sentinel
      if (payload === '[PING]') continue;              // keepalive
      onEvent(JSON.parse(payload));                    // typed event → parser
    }
  }
}
```

Rules that matter:
- **Buffer across reads.** A network chunk can end mid-frame; only split on `\n\n` and
  keep the remainder.
- **`decoder.decode(value, { stream: true })`** — without it a multi-byte character
  split across chunks becomes garbage.
- **Abort** via `AbortController`; treat `err.name === 'AbortError'` as user intent,
  not failure.
- Non-OK responses are checked *before* reading the stream (quota 429s go through
  `throwIfQuotaResponse`).

## 2. Event protocol → `DraftStreamParser`

The backend emits typed JSON events. The parser (`draftStreamParser.js`) turns them
into callbacks and owns the per-section text buffers (a `Map`, NOT React state):

| Event | Callback | What to do |
|---|---|---|
| `status` | `onStatus` | show `message` in the header (extraction heartbeat, audit, repairs) |
| `section_start` | `onSectionStart` | mark card `streaming`, set `streamingSectionId` |
| `chunk` | `onSectionText(sid, fullText)` | text delta — parser appends to its buffer; **no state update** |
| `section_end` | `onSectionEnd` | mark card `done`, bump progress, bump `version` |
| `section_replace` | `onSectionReplace` | expansion/repair/normalization rewrote a section — **replace** the buffer wholesale, bump `version` |
| `section_error` | `onSectionError` | mark card `error` with message |
| `grounding_report` | `onGroundingReport` | show "fixing N unsupported item(s)…" |
| `usage` / `cost` | `onCost` | render the ₹ breakdown panel (`cost` fires twice: provisional after sections, final after audit — later replaces earlier) |
| `chat_saved` | `onChatSaved` | show "Saved to chat history" badge |
| `done` | `onDone` | final status; switch to Full Document view |

Fallback: chunks also carry `[START_SECTION_i]…[END_SECTION_i]` markers in the text,
so the parser can split a plain marker-framed stream if typed metadata is absent —
markers are framing, always stripped from displayed content.

## 3. Rendering — why the UI survives 100 pages

The core invariant: **token chunks never cause React re-renders.**

```
SSE chunk ──► parser Map (textStoreRef.current)          ← mutable ref, no setState
                    │
   streaming card ──┴─► requestAnimationFrame loop reads the Map
                        and writes node.textContent directly
   finished card ─────► React.memo, invalidated only by a `version` counter
   off-screen card ───► CSS `content-visibility:auto` + `contain-intrinsic-size`
                        (browser skips layout/paint — no windowing library needed)
   collapsed card ────► body unmounted entirely
```

React state tracks only **section metadata** (`{sectionId, heading, status}` — a few
dozen small objects), so state updates happen per *section*, not per *token*.
`section_replace` is the one case where a buffer is overwritten: set the Map entry,
`setVersion(v => v + 1)` to invalidate the memoized card.

Two views share the same buffers:
- **Sections** (accordion) while generating — auto-expands the streaming card.
- **Full Document** (auto-active on `done`) — an A4 sheet (794 px wide, 96 px ≈ 1-inch
  padding) rendered with the typography captured by the template analyzer.

## 4. Formatting model — one parser for screen AND docx

Formatting comes from the backend's `template_structure`, not from the generated text:
each section carries `heading_format` / `body_format` (`{alignment, font_size_pt,
bold, underline, all_caps}`), plus document-level `base_font_family` (Times New Roman)
and `title_format`. Generated text is plain text + GitHub-style markdown tables.

`draftFormatUtils.js` is the single source of truth both renderers use:

```js
normalizeFormat(fmt, fallback)   // tolerant TextFormatSchema → {alignment, fontSizePt, bold, …}
documentDefaults(structure)      // font family, base pt size, title format
parseContentBlocks(content)      // text → [{type:'paragraph',text} | {type:'table',header,rows}]
splitHeadingFromContent(raw, h)  // avoid printing the heading twice
parseInlineBold(text)            // '**ANNEXURE P-1**' → [{text,bold}] segments
ptToPx(pt)                       // pt × 96/72 for the screen view
```

Two fidelity rules to preserve when editing:
- `headingVerbatim === false` means the heading is a **derived UI label** for an
  unlabeled template block ("Cause Title", "Preamble") — show it on the accordion card,
  **never print it** into the page view, the docx, or any compiled output.
- The screen view and the docx must consume the same `parseContentBlocks` output —
  that is what makes the download WYSIWYG.

## 5. Download to `.docx` — real OOXML via the `docx` package

`draftDocxExport.js` builds a genuine Word file client-side (no HTML-renamed-.doc):

```js
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         AlignmentType, WidthType, BorderStyle, convertInchesToTwip } from 'docx';

// 1. Page + default style
new Document({
  styles: { default: { document: { run: { font, size: basePt * 2 } } } },  // half-points!
  sections: [{
    properties: { page: {
      size:   { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },  // A4
      margin: { top/bottom/left/right: convertInchesToTwip(1) },                          // 1in
    }},
    children,   // built below
  }],
});

// 2. Per section: heading paragraph (its own format) + body blocks
for (const block of parseContentBlocks(body)) {
  if (block.type === 'table') children.push(tableFromBlock(block));   // real Word table,
  else children.push(new Paragraph({                                  // single black borders
    alignment: ALIGN[fmt.alignment],                    // JUSTIFIED / CENTER / LEFT / RIGHT
    spacing: { after: 120, line: 300 },                 // 1.25 line spacing (court style)
    children: parseInlineBold(block.text)               // '**x**' → bold TextRuns
      .map(seg => new TextRun({ text, font, size: pt * 2, bold: fmt.bold || seg.bold })),
  }));
}

// 3. Download
const blob = await Packer.toBlob(doc);
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: 'Draft.docx' });
document.body.appendChild(a); a.click(); a.remove();
URL.revokeObjectURL(url);
```

Gotchas learned the hard way:
- `docx` sizes are **half-points** (`12pt → size: 24`).
- Text preserves the template's line breaks — emit **one Paragraph per source line**
  (blank lines → empty spacing paragraphs), don't join into one run.
- Markdown/plain-text downloads reuse the same compiled content; strip `**` markers
  for `.txt` (`stripInlineBold`).
- Make the download menu **click-toggled**, not CSS `group-hover` — hover menus fail
  under automation and on touch devices.

## 6. State orchestration (`DraftingModal.jsx`)

```
phase: 'setup' → 'generating' → 'finished'
setup:      create session → upload template → poll GET /{sid} until status='ready'
            (retry via POST /{sid}/template/retry on 'analysis_failed')
generating: seed section cards from template_structure (so the outline shows with
            'queued' states before the first token), new DraftStreamParser, stream
finished:   auto-switch to Full Document; cost panel; "Saved to chat history" badge
```

Reset **everything** on modal open (buffers Map, cost, version, abort controller) —
stale buffers from a previous draft are the classic bug here. Always `abort()` on
unmount/close so the reader releases and the server generator cancels.

## 7. Porting checklist

1. SSE-over-fetch with frame buffering, `[DONE]`/`[PING]` sentinels, AbortController.
2. Parser owns per-section buffers in a ref Map; callbacks update only section metadata.
3. rAF paint for the live section; `version`-memoized finished cards;
   `content-visibility:auto` for off-screen ones.
4. Handle `section_replace` (expansion / audit repair / normalization) — buffers are
   replaceable at any time until `done`.
5. Formatting from `template_structure`, never inferred from text; respect
   `headingVerbatim`.
6. One block parser feeding both the page view and the `docx` builder (WYSIWYG).
7. `cost` events: provisional then final — render both, later wins.
