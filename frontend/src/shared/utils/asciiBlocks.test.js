import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanAsciiArtBlocks, isBorderLine, isDecorationLine } from './asciiBlocks.js';

test('rewrites a character-drawn table into a GFM pipe table', () => {
  const input = [
    'Here is the matrix:',
    '',
    '```',
    '+-------------------+---------------------------+',
    '| Risk Area         | Primary Legal Exposure    |',
    '+-------------------+---------------------------+',
    '| Non-Registration  | Criminal fine u/s 55(2)   |',
    '| Inadequate Stamp  | Impounding u/s 33         |',
    '+-------------------+---------------------------+',
    '```',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);

  assert.ok(!out.includes('```'), 'fence removed');
  assert.ok(!out.includes('+---'), 'ASCII borders removed');
  assert.match(out, /^\| Risk Area \| Primary Legal Exposure \|$/m);
  assert.match(out, /^\| --- \| --- \|$/m);
  assert.match(out, /^\| Non-Registration \| Criminal fine u\/s 55\(2\) \|$/m);
  assert.match(out, /^\| Inadequate Stamp \| Impounding u\/s 33 \|$/m);
});

test('emits exactly one separator row and keeps every data row', () => {
  const input = '```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n```';
  const rows = cleanAsciiArtBlocks(input).split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.filter((l) => /^\|[\s:|-]+\|$/.test(l)).length, 1);
  assert.equal(rows.length, 4);
});

test('pads short rows so the table stays aligned', () => {
  const input = '```\n| Old | New | Subject |\n| 420 IPC | 318 BNS |\n```';
  assert.match(cleanAsciiArtBlocks(input), /^\| 420 IPC \| 318 BNS \|\s+\|$/m);
});

test('converts a unicode box-drawn table too', () => {
  const input = [
    '```',
    '┌────────────┬────────────┐',
    '│ Court      │ Binding?   │',
    '├────────────┼────────────┤',
    '│ Supreme    │ Yes        │',
    '└────────────┴────────────┘',
    '```',
  ].join('\n');
  const out = cleanAsciiArtBlocks(input);
  assert.match(out, /^\| Court \| Binding\? \|$/m);
  assert.match(out, /^\| Supreme \| Yes \|$/m);
  assert.ok(!/[│┌└├]/.test(out), 'box characters removed');
});

test('turns an ASCII flow diagram into an arrow chain', () => {
  const input = [
    '```',
    'Demand notice served',
    '   | (payment not made within 15 days)',
    '   v',
    'Cause of action arises --> Complaint before Magistrate (within 30 days)',
    '```',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input).trim();
  assert.ok(!out.includes('```'));
  assert.equal(
    out,
    'Demand notice served → (payment not made within 15 days) → Cause of action arises → Complaint before Magistrate (within 30 days)',
  );
});

test('splits parallel diagram columns into separate steps', () => {
  const input = [
    '```',
    'Cognizance & summons          Trial u/s 143 NI Act',
    '   |                                 |',
    '   v                                 v',
    'Conviction                    Acquittal',
    '```',
  ].join('\n');
  const out = cleanAsciiArtBlocks(input).trim();
  assert.equal(out, 'Cognizance & summons → Trial u/s 143 NI Act → Conviction → Acquittal');
});

test('a long diagram becomes a step list rather than one endless line', () => {
  const steps = Array.from({ length: 10 }, (_, i) => `Stage ${i + 1}`);
  const input = ['```', steps.join('\n   v\n'), '```'].join('\n');
  const out = cleanAsciiArtBlocks(input);
  assert.match(out, /^- Stage 1$/m);
  assert.match(out, /^- Stage 10$/m);
  assert.ok(!out.includes('→'));
});

test('leaves genuine code fences untouched', () => {
  const python = '```python\ndef add(a, b):\n    return a + b\n```';
  assert.equal(cleanAsciiArtBlocks(python), python);

  const sql = '```sql\nSELECT * FROM cases WHERE id = 1;\n```';
  assert.equal(cleanAsciiArtBlocks(sql), sql);
});

test('leaves untagged fences alone when the content is really code', () => {
  const input = '```\nfunction total(rows) {\n  return rows.length;\n}\n```';
  assert.equal(cleanAsciiArtBlocks(input), input);

  const json = '```\n{\n  "section": "55(2)",\n  "act": "MRCA"\n}\n```';
  assert.equal(cleanAsciiArtBlocks(json), json);
});

test('unwraps a fenced draft into text with the line structure preserved', () => {
  const input = [
    '```',
    'LEAVE AND LICENSE AGREEMENT',
    '',
    'BY AND BETWEEN',
    'MR. RAMESH KRISHNARAO DESAI, aged about 52 years',
    'AND',
    'MS. PRIYA SURESH MALHOTRA, aged about 28 years',
    '```',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);
  assert.ok(!out.includes('```'), 'fence removed');
  assert.match(out, /^LEAVE AND LICENSE AGREEMENT$/m);
  assert.match(out, /^BY AND BETWEEN\\$/m, 'hard line break keeps the layout');
  assert.match(out, /^MS\. PRIYA SURESH MALHOTRA, aged about 28 years$/m);
});

test('deep-indented draft lines never become an indented code block', () => {
  const input = '```\n        Licensor: [Ramesh K. Desai]\n        Date: 01 July 2025\n```';
  const body = cleanAsciiArtBlocks(input).split('\n').filter(Boolean);
  body.forEach((line) => assert.ok(!/^ {4}/.test(line), `over-indented: "${line}"`));
});

test('keeps mixed blocks intact: caption text plus its table', () => {
  const input = [
    '```',
    'ANNEXURE-A: PROPERTY HANDOVER SCHEDULE',
    'Handover Date: 01 July 2025',
    '',
    '+------+-------------------+',
    '| S.No | Fixture           |',
    '+------+-------------------+',
    '| 1.   | Main Door Keys    |',
    '| 2.   | Society Gate Keys |',
    '+------+-------------------+',
    '```',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);
  assert.match(out, /^ANNEXURE-A: PROPERTY HANDOVER SCHEDULE\\$/m);
  assert.match(out, /^\| S\.No \| Fixture \|$/m);
  assert.match(out, /^\| 2\. \| Society Gate Keys \|$/m);
  assert.ok(!out.includes('+------'));
});

test('drops ASCII borders emitted outside a fence but keeps real markdown rules', () => {
  const input = [
    '## Findings',
    '',
    '+----------+----------+',
    '| Case | Year |',
    '| --- | --- |',
    '| Ramesh | 2024 |',
    '+----------+----------+',
    '',
    '---',
    '',
    'Next section.',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);
  assert.ok(!out.includes('+----------+'), 'ASCII borders dropped');
  assert.match(out, /^\| --- \| --- \|$/m, 'GFM separator preserved');
  assert.match(out, /^---$/m, 'thematic break preserved');
  assert.match(out, /^\| Ramesh \| 2024 \|$/m);
});

test('renders a table that is still streaming (fence not yet closed)', () => {
  const input = 'Report:\n\n```\n| Case | Year |\n| Ramesh | 2024 |';
  const out = cleanAsciiArtBlocks(input);
  assert.ok(!out.includes('```'));
  assert.match(out, /^\| Case \| Year \|$/m);
  assert.match(out, /^\| --- \| --- \|$/m);
});

test('is a no-op for plain markdown', () => {
  const md = '## Heading\n\nSome **bold** prose.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  assert.equal(cleanAsciiArtBlocks(md), md);
});

test('handles empty / non-string input', () => {
  assert.equal(cleanAsciiArtBlocks(''), '');
  assert.equal(cleanAsciiArtBlocks(null), null);
  assert.equal(cleanAsciiArtBlocks(undefined), undefined);
});

test('border and decoration predicates', () => {
  assert.ok(isBorderLine('+-----+-----+'));
  assert.ok(isBorderLine('|-----|-----|'));
  assert.ok(!isBorderLine('---'));
  assert.ok(!isBorderLine('| Case | Year |'));
  assert.ok(isDecorationLine('   |        |'));
  assert.ok(isDecorationLine('   v        v'));
  assert.ok(!isDecorationLine('v Cognizance'));
});

test('a full-width banner row becomes a caption, not the table header', () => {
  const input = [
    '```',
    '+--------------------------------------------------+',
    '|         RISK ASSESSMENT & MITIGATION MATRIX      |',
    '+-------------------+---------------------+--------+',
    '| Risk Area         | Legal Exposure      | Fix    |',
    '+-------------------+---------------------+--------+',
    '| Non-Registration  | Fine u/s 55(2)      | Register |',
    '+-------------------+---------------------+--------+',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);
  assert.match(out, /^\*\*RISK ASSESSMENT & MITIGATION MATRIX\*\*$/m, 'banner promoted to caption');
  assert.match(out, /^\| Risk Area \| Legal Exposure \| Fix \|$/m, 'real header row kept as header');
  assert.match(out, /^\| Non-Registration \| Fine u\/s 55\(2\) \| Register \|$/m);
});

test('space-aligned columns are separated, never run together', () => {
  const input = [
    '```',
    '01 July 2025            30 Sept 2025          01 May 2026',
    'v                       v                     v',
    '| Stage | Event |',
    '| Start | Handover |',
    '```',
  ].join('\n');

  const out = cleanAsciiArtBlocks(input);
  assert.match(out, /01 July 2025 · 30 Sept 2025 · 01 May 2026/);
  assert.ok(!out.includes('202530'), 'adjacent dates never merge');
  assert.match(out, /^\| Stage \| Event \|$/m);
});
