import React, { useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { FieldPill } from './FieldPill';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { draftLineAlign, canonicalizeFieldPlaceholders, fixInlineEmphasis, normalizeLegalDraftMarkdownForRender } from '../../utils/legalDraftRender';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo2, Redo2, Type,
} from 'lucide-react';

/**
 * DraftEditor — an editable, court-styled TipTap surface for a finished legal draft.
 *
 * The draft is the single source of truth in MARKDOWN. This component converts that
 * markdown → HTML once for TipTap, lets the user restyle (bold/italic/underline,
 * alignment, font family/size, colour) and edit text, then converts the edited HTML
 * back to MARKDOWN on every change (debounced) so the parent can auto-save it.
 *
 * Fidelity notes:
 *  - Red placeholders (<span style="color:red;font-weight:bold;">[____ X ____]</span>)
 *    are normalised back to canonical form by a Turndown rule so the .docx renderer and
 *    the read-only view keep treating them as fillable blanks.
 *  - Paragraph numbers ("29.") are re-escaped by Turndown to "29\." so GFM never turns
 *    them into a renumbered <ol> (matches the read-only renderer's sanitizer).
 *  - Manual alignment on a block is preserved as a minimal inline-HTML wrapper (markdown
 *    has no alignment syntax); everything the renderer already aligns by content still
 *    works untouched.
 */

const SERIF = "'Times New Roman', 'Liberation Serif', Georgia, serif";

const FONT_OPTIONS = [
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
];
const SIZE_OPTIONS = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px'];
const COLOR_OPTIONS = [
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Red', value: '#c00000' },
  { label: 'Blue', value: '#1e3a8a' },
  { label: 'Green', value: '#166534' },
];

// ── markdown ⇄ html ──────────────────────────────────────────────────────────
// The saved markdown carries no alignment (kept clean for the .docx export), so the editor
// applies the SAME content-driven alignment the read-only view uses on load: centre the
// document title / court lines / VERSUS, right-align trailing party-role labels. TipTap's
// TextAlign extension parses `text-align` from the loaded HTML, so the editor shows the
// heading centred. (On save, Turndown drops it again — the renderer + docx re-centre by the
// same heuristic, so the round-trip stays clean.)
function applyEditorAlignment(html) {
  if (typeof window === 'undefined' || !window.DOMParser) return String(html || '');
  const root = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html').body;
  root.querySelectorAll('p, h1, h2, h3, h4').forEach((el) => {
    if (/text-align/i.test(el.getAttribute('style') || '')) return;   // respect explicit alignment
    const align = draftLineAlign(el.textContent || '');
    if (align && align !== 'left') {
      const style = (el.getAttribute('style') || '').trim();
      el.setAttribute('style', (style ? style.replace(/;?$/, ';') : '') + `text-align:${align}`);
    }
  });
  return root.innerHTML;
}

export function markdownToHtml(md) {
  // Repair space-padded bold ("** RENT AGREEMENT **" → "**RENT AGREEMENT**") so titles bold,
  // then canonicalise bare "[ BANK NAME ]" placeholders into the red span BEFORE parsing so the
  // FieldPill node turns every unfilled field into a clickable red pill (not black text).
  const normalized = normalizeLegalDraftMarkdownForRender(fixInlineEmphasis(String(md || '')));
  const html = marked.parse(canonicalizeFieldPlaceholders(normalized), { gfm: true, breaks: false, async: false });
  return applyEditorAlignment(html);
}

/**
 * Normalise TipTap's editor HTML into a shape turndown-plugin-gfm can convert to CLEAN
 * markdown (pipe tables), so the saved markdown stays exporter-safe (the court-.docx
 * builder is markdown-only and prints raw <table>/<colgroup> HTML literally).
 * TipTap emits: <colgroup>, colspan/rowspan="1" on every cell, <p> inside each cell, and
 * the header <th> row inside <tbody> (no <thead>) — all of which defeat gfm's table rule.
 */
function normalizeEditorHtml(html) {
  if (typeof window === 'undefined' || !window.DOMParser) return String(html || '');
  const root = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html').body;
  root.querySelectorAll('table').forEach((table) => {
    table.removeAttribute('style');
    table.querySelectorAll('colgroup').forEach((cg) => cg.remove());
    table.querySelectorAll('th, td').forEach((cell) => {
      if (cell.getAttribute('colspan') === '1') cell.removeAttribute('colspan');
      if (cell.getAttribute('rowspan') === '1') cell.removeAttribute('rowspan');
      cell.removeAttribute('style');
      // Unwrap the <p> wrapper(s) TipTap puts inside cells (multi-paragraph → <br>).
      const paras = Array.from(cell.children).filter((c) => c.tagName === 'P');
      if (paras.length) cell.innerHTML = paras.map((p) => p.innerHTML.trim()).join('<br>');
    });
    // Guarantee a <thead> header row so gfm always recognises the table (else it keeps
    // the whole table as raw HTML). Promote the first row's cells to <th> and wrap it.
    const tbody = table.querySelector('tbody');
    if (tbody && !table.querySelector('thead')) {
      const firstRow = tbody.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('td').forEach((cellTd) => {
          const th = root.ownerDocument.createElement('th');
          th.innerHTML = cellTd.innerHTML;
          cellTd.replaceWith(th);
        });
        const thead = root.ownerDocument.createElement('thead');
        thead.appendChild(firstRow);
        table.insertBefore(thead, tbody);
      }
    }
  });
  return root.innerHTML;
}

function buildTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  td.use(gfm);

  // Canonicalise red placeholders. This is the ONLY inline HTML we keep in the markdown —
  // the court-.docx builder and the read-only view both understand this exact red span.
  // The label is escaped: HTML-escape always (a "<"/"&" would emit non-well-formed HTML)
  // and pipe-escape inside a table cell (a "|" would split the GFM row on re-parse).
  td.addRule('redPlaceholder', {
    filter: (node) =>
      node.nodeName === 'SPAN' && /\[_{2,}[^\]]*_{2,}\]/.test(node.textContent || ''),
    replacement: (_content, node) => {
      let inCell = false;
      for (let p = node.parentNode; p; p = p.parentNode) {
        if (p.nodeName === 'TD' || p.nodeName === 'TH') { inCell = true; break; }
      }
      let t = String(node.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (inCell) t = t.replace(/\|/g, '\\|');
      return `<span style="color:red;font-weight:bold;">${t}</span>`;
    },
  });

  // Inside a table cell, keep line breaks as literal <br> (a markdown hard break "  \n"
  // would put a raw newline in a pipe cell and shatter the GFM table). The read-only view
  // and the .docx builder both render <br> inside cells.
  td.addRule('brInCell', {
    filter: (node) => {
      if (node.nodeName !== 'BR') return false;
      for (let p = node.parentNode; p; p = p.parentNode) {
        if (p.nodeName === 'TD' || p.nodeName === 'TH') return true;
      }
      return false;
    },
    replacement: () => '<br>',
  });

  // Everything else becomes CLEAN markdown: font/colour spans degrade to plain text and
  // block alignment is dropped (markdown can't express it — the renderer and the docx
  // builder both re-centre titles/VERSUS/role labels by content heuristics anyway). This
  // keeps the saved markdown portable and the .docx export free of literal HTML.
  return td;
}

export function htmlToMarkdown(html) {
  return buildTurndown().turndown(normalizeEditorHtml(html)).trim();
}

// ── toolbar ──────────────────────────────────────────────────────────────────
const btnBase = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, border: '1px solid #e2e8f0', background: '#fff',
  borderRadius: 7, cursor: 'pointer', color: '#475569', padding: 0,
};
const activeStyle = { background: '#ccfbf1', borderColor: '#0d9488', color: '#0f766e' };

function TBtn({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      aria-label={title}
      style={{ ...btnBase, ...(active ? activeStyle : null) }}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }) {
  if (!editor) return null;
  const sel = { height: 30, border: '1px solid #e2e8f0', borderRadius: 7, background: '#fff', color: '#475569', fontSize: 12, padding: '0 6px', cursor: 'pointer' };
  const divider = <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} />;
  return (
    <div style={{
      flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5,
      padding: '8px 10px', borderBottom: '1px solid #ececec', background: '#fbfbfa',
    }}>
      <TBtn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></TBtn>
      <TBtn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></TBtn>
      <TBtn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></TBtn>
      <TBtn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></TBtn>
      {divider}
      <select
        title="Paragraph style"
        style={sel}
        value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) }).run();
        }}
      >
        <option value="p">Body</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <select title="Font" style={sel} defaultValue="" onChange={(e) => { if (e.target.value) editor.chain().focus().setFontFamily(e.target.value).run(); e.target.selectedIndex = 0; }}>
        <option value="">Font</option>
        {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
      </select>
      <select title="Font size" style={sel} defaultValue="" onChange={(e) => { if (e.target.value) editor.chain().focus().setFontSize(e.target.value).run(); e.target.selectedIndex = 0; }}>
        <option value="">Size</option>
        {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('px', '')}</option>)}
      </select>
      <select title="Text colour" style={sel} defaultValue="" onChange={(e) => { if (e.target.value) editor.chain().focus().setColor(e.target.value).run(); e.target.selectedIndex = 0; }}>
        <option value="">Colour</option>
        {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {divider}
      <TBtn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={15} /></TBtn>
      <TBtn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={15} /></TBtn>
      <TBtn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={15} /></TBtn>
      <TBtn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={15} /></TBtn>
      {divider}
      <TBtn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></TBtn>
      <TBtn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></TBtn>
      {editor.isActive('table') && (
        <>
          {divider}
          <select
            title="Table actions (cursor is in a table)"
            style={{ ...sel, color: '#c0392b', borderColor: '#eabdb5' }}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              const c = editor.chain().focus();
              if (v === 'row-after') c.addRowAfter().run();
              else if (v === 'row-before') c.addRowBefore().run();
              else if (v === 'col-after') c.addColumnAfter().run();
              else if (v === 'col-before') c.addColumnBefore().run();
              else if (v === 'del-row') c.deleteRow().run();
              else if (v === 'del-col') c.deleteColumn().run();
              else if (v === 'del-table') c.deleteTable().run();
              e.target.value = '';
            }}
          >
            <option value="">Table…</option>
            <option value="row-after">Add row below</option>
            <option value="row-before">Add row above</option>
            <option value="col-after">Add column right</option>
            <option value="col-before">Add column left</option>
            <option value="del-row">Delete row</option>
            <option value="del-col">Delete column</option>
            <option value="del-table">Delete whole table</option>
          </select>
        </>
      )}
      {divider}
      <TBtn title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().run()}><Type size={15} /></TBtn>
      <TBtn title="Undo" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></TBtn>
      <TBtn title="Redo" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></TBtn>
    </div>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────
function isTiptapDoc(value) {
  return !!(
    value
    && typeof value === 'object'
    && value.type === 'doc'
    && Array.isArray(value.content)
  );
}

function normalizeTiptapDoc(value) {
  if (!isTiptapDoc(value)) return null;
  return {
    type: 'doc',
    content: value.content.length ? value.content : [{ type: 'paragraph' }],
  };
}

function stableJson(value) {
  try { return JSON.stringify(value || null); } catch { return ''; }
}

const DraftEditor = forwardRef(function DraftEditor({ initialMarkdown, initialTiptapJson, onChange, debounceMs = 900 }, ref) {
  const contentElRef = useRef(null);
  const debounceRef = useRef(null);
  const latestMdRef = useRef(String(initialMarkdown || ''));
  // Always call the LATEST onChange — the editor is created once, so a closure over the
  // first render's onChange would go stale (and miss the resolved session id).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const initialJson = useMemo(() => normalizeTiptapDoc(initialTiptapJson), [initialTiptapJson]);
  const initialHtml = useMemo(() => (initialJson ? null : markdownToHtml(initialMarkdown)), [initialJson, initialMarkdown]);
  const initialContent = initialJson || initialHtml;
  const initialContentKey = useMemo(
    () => (initialJson ? stableJson(initialJson) : String(initialHtml || '')),
    [initialJson, initialHtml],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      FieldPill,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        style: `font-family:${SERIF}; font-size:15px; line-height:1.7; color:#1a1a1a; outline:none; min-height:320px;`,
        class: 'legal-draft-editor',
        // Turn OFF the browser's native spellcheck so it stops drawing red squiggles under
        // names / addresses / dummy IDs — those are not part of the document.
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const md = htmlToMarkdown(ed.getHTML());
        latestMdRef.current = md;
        if (typeof onChangeRef.current === 'function') onChangeRef.current(md);
      }, debounceMs);
    },
  });

  // Reset content if the incoming draft changes identity (e.g. re-generated).
  useEffect(() => {
    if (!editor || !initialContent) return;
    const unchanged = initialJson
      ? stableJson(editor.getJSON()) === initialContentKey
      : editor.getHTML() === initialContentKey;
    if (unchanged) return;
    // Only reset when the editor is empty-ish or still matches the last saved value.
    // Once the user edits, incoming section/final events must not clobber their work.
    const cur = htmlToMarkdown(editor.getHTML());
    if (!cur.trim() || cur === latestMdRef.current) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
      latestMdRef.current = String(initialMarkdown || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContentKey, editor]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Expose the current markdown (flushed) + the rendered DOM node for exports.
  useImperativeHandle(ref, () => ({
    getMarkdown: () => (editor ? htmlToMarkdown(editor.getHTML()) : latestMdRef.current),
    flush: () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      const md = editor ? htmlToMarkdown(editor.getHTML()) : latestMdRef.current;
      latestMdRef.current = md;
      return md;
    },
    getContentEl: () => contentElRef.current,
  }), [editor]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      border: '1px solid #e6e6e6', borderRadius: 12, background: '#fff', overflow: 'hidden',
    }}>
      <style>{`
        .legal-draft-editor:focus { outline: none; }
        .legal-draft-editor p { margin: 0 0 11px; }
        .legal-draft-editor h1 { font-size: 19px; font-weight: 700; margin: 20px 0 11px; }
        .legal-draft-editor h2 { font-size: 16px; font-weight: 700; margin: 16px 0 8px; }
        .legal-draft-editor h3 { font-size: 15px; font-weight: 700; margin: 14px 0 6px; }
        .legal-draft-editor ol, .legal-draft-editor ul { margin: 0 0 12px; padding-left: 26px; }
        .legal-draft-editor li { margin: 4px 0; }
        .legal-draft-editor table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        .legal-draft-editor th, .legal-draft-editor td { border: 1px solid #d6d0c4; padding: 6px 10px; vertical-align: top; }
        .legal-draft-editor th { background: #f6f4ef; font-weight: 700; }
        .legal-draft-editor hr { border: 0; border-top: 1px solid #d8d8d8; margin: 18px 0; }
        .legal-draft-editor .selectedCell { background: #e6fffb; }
      `}</style>
      {/* Toolbar stays fixed; only the document page below it scrolls. */}
      <Toolbar editor={editor} />
      {/* Grey canvas that scrolls, holding a centred white "page" (Google-Docs feel). */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#f3f4f6', padding: '24px 16px' }}>
        <div
          ref={contentElRef}
          className="legal-draft-view"
          style={{
            maxWidth: 820, margin: '0 auto', background: '#fff', borderRadius: 2,
            padding: '52px 64px', boxShadow: '0 1px 5px rgba(0,0,0,0.14)', minHeight: 400,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});

export default DraftEditor;
