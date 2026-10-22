import assert from 'node:assert/strict';
import test from 'node:test';

import rehypeDeepResearchCitations, { transformCitationTree } from './deepResearchCitations.js';

const text = (value) => ({ type: 'text', value });
const el = (tagName, children, properties = {}) => ({
  type: 'element', tagName, properties, children,
});

function chipsOf(node) {
  const found = [];
  const walk = (n) => {
    if (n?.type === 'element' && n.tagName === 'sup') found.push(n);
    (n?.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

function textOf(node) {
  if (node?.type === 'text') return node.value;
  return (node?.children || []).map(textOf).join('');
}

test('rewrites a citation marker into a superscript chip', () => {
  const tree = el('div', [el('p', [text('The agreement is unregistered [S1].')])]);

  transformCitationTree(tree);
  const chips = chipsOf(tree);

  assert.equal(chips.length, 1);
  assert.equal(chips[0].tagName, 'sup');
  assert.deepEqual(chips[0].properties.className, ['dr-cite']);
  assert.equal(chips[0].properties['data-source-id'], 'S1');
  assert.equal(textOf(chips[0]), 'S1');
  // Surrounding prose survives intact, brackets removed.
  assert.equal(textOf(tree), 'The agreement is unregistered S1.');
});

test('handles several markers in one sentence', () => {
  const tree = el('p', [text('Both courts agree [S1][S3] on limitation [S12].')]);

  transformCitationTree(tree);

  assert.deepEqual(
    chipsOf(tree).map((c) => c.properties['data-source-id']),
    ['S1', 'S3', 'S12'],
  );
});

test('leaves ordinary bracketed text alone', () => {
  const samples = [
    '[unvalidated link removed]',
    'see [para 14] of the order',
    '[Section 55]',
    '[s1] lowercase is not a marker',
    '[S0] is out of range',
  ];
  for (const sample of samples) {
    const tree = el('p', [text(sample)]);
    transformCitationTree(tree);
    assert.equal(chipsOf(tree).length, 0, `unexpected chip in: ${sample}`);
    assert.equal(textOf(tree), sample);
  }
});

test('never rewrites markers inside code or links', () => {
  const tree = el('div', [
    el('code', [text('cite [S1] here')]),
    el('pre', [el('code', [text('[S2]'), text('[S3]')])]),
    el('a', [text('[S4]')]),
  ]);

  transformCitationTree(tree);

  assert.equal(chipsOf(tree).length, 0);
});

test('rewrites markers nested inside emphasis and table cells', () => {
  const tree = el('table', [
    el('tbody', [
      el('tr', [
        el('td', [el('strong', [text('Ramesh v. Priya [S2]')])]),
        el('td', [text('Binding [S5]')]),
      ]),
    ]),
  ]);

  transformCitationTree(tree);

  assert.deepEqual(
    chipsOf(tree).map((c) => c.properties['data-source-id']),
    ['S2', 'S5'],
  );
});

test('is a no-op for text with no citations', () => {
  const tree = el('p', [text('No sources were validated for this answer.')]);
  const before = JSON.stringify(tree);
  transformCitationTree(tree);
  assert.equal(JSON.stringify(tree), before);
});

test('the plugin export returns a transformer', () => {
  const transformer = rehypeDeepResearchCitations();
  const tree = el('p', [text('Held [S7].')]);
  transformer(tree);
  assert.equal(chipsOf(tree).length, 1);
});

test('tolerates empty and childless nodes', () => {
  assert.doesNotThrow(() => transformCitationTree(null));
  assert.doesNotThrow(() => transformCitationTree({ type: 'element', tagName: 'br' }));
  assert.doesNotThrow(() => transformCitationTree(el('p', [])));
});

test('keeps the [S1] label that opens a source-register line', () => {
  // "- **[S1]** indiacode.nic.in — Primary legal authority"
  const tree = el('ul', [
    el('li', [
      el('strong', [text('[S1]')]),
      text(' indiacode.nic.in — Primary legal authority'),
    ]),
  ]);

  transformCitationTree(tree);

  assert.equal(chipsOf(tree).length, 0, 'register label stays plain text');
  assert.ok(textOf(tree).startsWith('[S1]'));
});

test('still converts a citation later in a list item', () => {
  const tree = el('ul', [el('li', [text('The tenant prevails [S4] on this point.')])]);

  transformCitationTree(tree);

  assert.deepEqual(chipsOf(tree).map((c) => c.properties['data-source-id']), ['S4']);
});

test('a register line with a plain-text label is also preserved', () => {
  const tree = el('ul', [el('li', [text('[S2] indiankanoon.org — Secondary legal database [S3]')])]);

  transformCitationTree(tree);

  const ids = chipsOf(tree).map((c) => c.properties['data-source-id']);
  assert.deepEqual(ids, ['S3'], 'only the trailing marker becomes a chip');
  assert.ok(textOf(tree).startsWith('[S2]'));
});
