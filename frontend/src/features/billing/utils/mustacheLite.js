/**
 * Minimal Mustache-style renderer for the billing HTML templates.
 *
 * Supports the subset the templates use:
 *   {{path.to.value}}            HTML-escaped interpolation
 *   {{{path}}}                   raw (unescaped) interpolation
 *   {{#path}} ... {{/path}}      section: repeated for arrays, rendered once for truthy values
 *                                (objects push a new context frame), skipped when falsy / empty
 *   {{^path}} ... {{/path}}      inverted section: rendered when falsy / empty
 *   {{.}}                        the current item inside an array section
 *   {{! comment }}               dropped
 *
 * Lookups walk the context stack from innermost to outermost, as Mustache does.
 */

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE[ch]);
}

function lookup(stack, path) {
  if (path === '.') return stack[stack.length - 1];
  const keys = path.split('.');
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    let cur = stack[i];
    if (cur === null || cur === undefined || typeof cur !== 'object') continue;
    if (!(keys[0] in cur)) continue;
    for (const key of keys) {
      if (cur === null || cur === undefined) break;
      cur = cur[key];
    }
    return cur;
  }
  return undefined;
}

function isEmpty(value) {
  if (value === null || value === undefined || value === false) return true;
  if (value === 0 || value === '' || Number.isNaN(value)) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

const TAG = /\{\{\s*([#^/!{&]?)\s*([^}\s]*?)\s*\}?\}\}/g;

function tokenize(template) {
  const tokens = [];
  let last = 0;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(template)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: template.slice(last, m.index) });
    const sigil = m[1];
    const name = m[2];
    if (sigil === '!') {
      // comment: drop
    } else if (sigil === '#') tokens.push({ type: 'section', name, inverted: false });
    else if (sigil === '^') tokens.push({ type: 'section', name, inverted: true });
    else if (sigil === '/') tokens.push({ type: 'end', name });
    else if (sigil === '{' || sigil === '&') tokens.push({ type: 'raw', name });
    else tokens.push({ type: 'var', name });
    last = TAG.lastIndex;
  }
  if (last < template.length) tokens.push({ type: 'text', value: template.slice(last) });
  return tokens;
}

function buildTree(tokens) {
  const root = { children: [] };
  const stack = [root];
  for (const tok of tokens) {
    const parent = stack[stack.length - 1];
    if (tok.type === 'section') {
      const node = { ...tok, children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (tok.type === 'end') {
      if (stack.length === 1 || parent.name !== tok.name) {
        throw new Error(`mustacheLite: unexpected {{/${tok.name}}}`);
      }
      stack.pop();
    } else {
      parent.children.push(tok);
    }
  }
  if (stack.length !== 1) {
    throw new Error(`mustacheLite: unclosed section {{#${stack[stack.length - 1].name}}}`);
  }
  return root.children;
}

function renderNodes(nodes, stack) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
    } else if (node.type === 'var') {
      out += escapeHtml(toText(lookup(stack, node.name)));
    } else if (node.type === 'raw') {
      out += toText(lookup(stack, node.name));
    } else if (node.type === 'section') {
      const value = lookup(stack, node.name);
      const empty = isEmpty(value);
      if (node.inverted) {
        if (empty) out += renderNodes(node.children, stack);
      } else if (!empty) {
        if (Array.isArray(value)) {
          for (const item of value) out += renderNodes(node.children, [...stack, item]);
        } else if (typeof value === 'object') {
          out += renderNodes(node.children, [...stack, value]);
        } else {
          out += renderNodes(node.children, stack);
        }
      }
    }
  }
  return out;
}

const cache = new Map();

/**
 * Render a Mustache-style template string against a data object.
 * Parsed templates are cached by string identity so repeated downloads stay cheap.
 */
export function renderTemplate(template, data) {
  let tree = cache.get(template);
  if (!tree) {
    tree = buildTree(tokenize(template));
    cache.set(template, tree);
  }
  return renderNodes(tree, [data ?? {}]);
}
