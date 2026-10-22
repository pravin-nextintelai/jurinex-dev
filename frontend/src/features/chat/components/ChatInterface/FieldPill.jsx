import React, { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';

/**
 * FieldPill — an inline TipTap node that renders an UNFILLED red placeholder
 * (<span style="color:red;font-weight:bold;">[________ FIELD NAME ________]</span>) as a
 * clickable "field pill" the user can fill in.
 *
 * Key design point: the pill is an EDITING-ONLY affordance. Its serialized form
 * (renderHTML → editor.getHTML() → Turndown → markdown) is the SAME canonical red span,
 * so the saved markdown, the court .docx exporter, and the read-only renderer are all
 * unchanged — they keep seeing a normal red placeholder. Filling a pill replaces the whole
 * node with the typed value as plain text, so a filled field is ordinary black text.
 */

// Matches the placeholder body, tolerating one-sided underscore runs the model emits.
const BRACKET_RE = /\[\s*_{2,}\s*([^\]\n]*?)\s*_*\s*\]|\[\s*([^\]\n]*?)\s*_{2,}\s*\]/;

export function fieldLabelFromText(text) {
  const m = BRACKET_RE.exec(String(text || ''));
  if (!m) return '';
  return (m[1] || m[2] || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function pillPlaceholderText(label) {
  return `[________ ${label || 'FIELD'} ________]`;
}

function isRedPlaceholderSpan(el) {
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (!/color\s*:\s*red/.test(style) && el.getAttribute('data-field-pill') == null) return false;
  const txt = el.textContent || '';
  return /\[\s*_{2,}[^\]]*\]|\[[^\]]*_{2,}\s*\]/.test(txt);
}

// ── React node view: the clickable pill ──────────────────────────────────────
function PillView({ node, editor, getPos }) {
  const label = node.attrs.label || 'FIELD';
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const inputRef = useRef(null);
  const committedRef = useRef(false);   // guards Enter + blur both firing commit()

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    if (committedRef.current) return;   // already replaced (Enter fired, blur follows)
    const v = val.trim();
    setEditing(false);
    setVal('');
    if (!v || typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    committedRef.current = true;
    // Replace the pill with the typed value as an EXPLICITLY UNMARKED, LITERAL text node.
    // insertContentAt(string) would (a) inherit the pill's own bold mark — parsed from the
    // canonical span's font-weight:bold — so filled fields came out bold, and (b) HTML-parse
    // the value, so typing "<...>" or "&x;" got mangled. schema.text() sidesteps both.
    editor.chain().focus().command(({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, editor.schema.text(v));
      return true;
    }).run();
  };

  const cancel = () => { setEditing(false); setVal(''); };

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      {editing ? (
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          onBlur={commit}
          placeholder={label}
          contentEditable={false}
          data-field-pill-input=""
          style={{
            display: 'inline-block', minWidth: 120, font: 'inherit', color: '#111',
            border: '1px solid #c00000', borderRadius: 6, padding: '1px 6px',
            outline: 'none', background: '#fff',
          }}
        />
      ) : (
        <span
          contentEditable={false}
          title={`Click to fill: ${label}`}
          onClick={() => setEditing(true)}
          data-field-pill-chip=""
          style={{
            display: 'inline-block', cursor: 'text', color: '#c00000', fontWeight: 700,
            background: '#fdecec', border: '1px dashed #e2a3a3', borderRadius: 6,
            padding: '0 6px', margin: '0 1px', lineHeight: 1.5, whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          [ {label} ]
        </span>
      )}
    </NodeViewWrapper>
  );
}

// ── the node ─────────────────────────────────────────────────────────────────
export const FieldPill = Node.create({
  name: 'fieldPill',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: {
        default: 'FIELD',
        parseHTML: (el) => el.getAttribute('data-field-pill') || fieldLabelFromText(el.textContent),
        renderHTML: () => ({}), // label is baked into the text child, not an attr, on export
      },
    };
  },

  parseHTML() {
    return [
      {
        // Priority above the Color/Bold mark span rules so a red placeholder span becomes
        // a pill node, not colour-marked text. getAttrs returns false for ordinary spans.
        tag: 'span',
        priority: 200,
        getAttrs: (el) => (isRedPlaceholderSpan(el) ? { label: el.getAttribute('data-field-pill') || fieldLabelFromText(el.textContent) } : false),
      },
    ];
  },

  renderHTML({ node }) {
    // Canonical red-placeholder span — what getHTML()/Turndown/the docx renderer consume.
    return [
      'span',
      mergeAttributes({ 'data-field-pill': node.attrs.label || 'FIELD', style: 'color:red;font-weight:bold;' }),
      pillPlaceholderText(node.attrs.label),
    ];
  },

  renderText({ node }) {
    return pillPlaceholderText(node.attrs.label);
  },

  addNodeView() {
    // Let the DOM (our own handlers) handle events that originate INSIDE the pill — the
    // fill input's keystrokes and the chip's click — so ProseMirror never swallows them.
    // All other events (navigation, deletion of the whole pill) stay with ProseMirror.
    return ReactNodeViewRenderer(PillView, {
      stopEvent: ({ event }) => {
        const t = event && event.target;
        return !!(t && t.closest && t.closest('[data-field-pill-input], [data-field-pill-chip]'));
      },
    });
  },
});

export default FieldPill;
