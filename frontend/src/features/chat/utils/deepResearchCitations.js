/**
 * Turn Deep Research citation markers into compact superscript chips.
 *
 * The synthesis model cites evidence as literal text — "…is unregistered [S1][S3]."
 * Rendered as-is those brackets sit at full size inside the prose and break the
 * reading flow, especially when a sentence carries two or three of them.
 *
 * This rehype plugin rewrites every `[S<n>]` marker into
 *   <sup class="dr-cite" data-source-id="S1">S1</sup>
 * which the renderer styles as a small chip and wires up to scroll to the
 * matching validated-source card.
 *
 * Runs AFTER rehypeSanitize so the nodes it creates (which are ours, not the
 * model's) are never stripped. Text inside code/pre is left alone, and a marker
 * that has no matching source card simply renders as a non-interactive chip.
 */

const CITATION_RE = /\[(S[1-9]\d{0,3})\]/g;

// Never rewrite markers inside these — code samples and existing chips.
const SKIP_TAGS = new Set(['code', 'pre', 'sup', 'a']);

function citationChip(sourceId) {
  return {
    type: 'element',
    tagName: 'sup',
    properties: { className: ['dr-cite'], 'data-source-id': sourceId },
    children: [{ type: 'text', value: sourceId }],
  };
}

/**
 * Split one text node into text + chip nodes. Returns null when unchanged.
 *
 * `keepLeadingMarker` protects the "[S1]" label that OPENS a source-register
 * line ("- **[S1]** indiacode.nic.in — …"): that marker is the entry's own
 * label, not a citation pointing elsewhere, so it stays plain text.
 */
function splitTextNode(node, keepLeadingMarker = false) {
  const value = String(node.value || '');
  if (!value.includes('[')) return null;
  CITATION_RE.lastIndex = 0;
  if (!CITATION_RE.test(value)) return null;

  CITATION_RE.lastIndex = 0;
  const out = [];
  let cursor = 0;
  let match;
  let changed = false;
  while ((match = CITATION_RE.exec(value)) !== null) {
    if (keepLeadingMarker && match.index === 0) continue;
    if (match.index > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, match.index) });
    }
    out.push(citationChip(match[1]));
    cursor = match.index + match[0].length;
    changed = true;
  }
  if (!changed) return null;
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
}

/**
 * Recursively rewrite citation markers in a hast tree (mutates in place).
 *
 * `leadingSlot` marks a node that sits at the very start of a list item, so the
 * register's own "[S1]" label is preserved through wrappers such as <strong>.
 */
export function transformCitationTree(node, leadingSlot = false) {
  if (!node || !Array.isArray(node.children)) return node;
  if (node.type === 'element' && SKIP_TAGS.has(node.tagName)) return node;

  const isListItem = node.type === 'element' && node.tagName === 'li';
  const next = [];
  let changed = false;
  node.children.forEach((child, index) => {
    const childLeads = (isListItem || leadingSlot) && index === 0;
    if (child && child.type === 'text') {
      const replacement = splitTextNode(child, childLeads);
      if (replacement) {
        next.push(...replacement);
        changed = true;
        return;
      }
      next.push(child);
      return;
    }
    transformCitationTree(child, childLeads);
    next.push(child);
  });
  if (changed) node.children = next;
  return node;
}

export default function rehypeDeepResearchCitations() {
  return (tree) => transformCitationTree(tree);
}
