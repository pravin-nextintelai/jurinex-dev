import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDeepResearchMessage,
  isDeepResearchMarker,
  mergeResearchStreamChunk,
  normalizeDeepResearchSources,
  reconcileDeepResearchStreamText,
  safeDeepResearchUrl,
} from './deepResearchSources.js';

test('allows only credential-free HTTPS source URLs', () => {
  assert.equal(safeDeepResearchUrl('https://sci.gov.in/judgment'), 'https://sci.gov.in/judgment');
  assert.equal(safeDeepResearchUrl('http://sci.gov.in/judgment'), null);
  assert.equal(safeDeepResearchUrl('javascript:alert(1)'), null);
  assert.equal(safeDeepResearchUrl('https://user:pass@example.com/'), null);
});

test('keeps valid Deep sources, rejects invalid states, and deduplicates canonical URLs', () => {
  const sources = normalizeDeepResearchSources([
    {
      source_type: 'deep_research_web', validation_status: 'valid',
      canonical_url: 'https://indiacode.nic.in/act', source_id: 'S1', title: 'Act', domain: 'spoof.invalid',
    },
    {
      source_type: 'deep_research_web', validation_status: 'valid',
      canonical_url: 'https://indiacode.nic.in/act', source_id: 'S2', title: 'Duplicate',
    },
    {
      source_type: 'deep_research_web', validation_status: 'blocked_address',
      canonical_url: 'https://127.0.0.1/', source_id: 'S3', title: 'Blocked',
    },
  ]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source_id, 'S1');
  assert.equal(sources[0].domain, 'indiacode.nic.in');
});

test('recognizes persisted Deep messages from structured citations', () => {
  const marker = { source_type: 'deep_research_meta', deep_research: true };
  assert.equal(isDeepResearchMessage({ deep_research: true }), true);
  assert.equal(isDeepResearchMessage({ citations: [{ source_type: 'deep_research_web' }] }), true);
  assert.equal(isDeepResearchMessage({ citations: [marker] }), true);
  assert.equal(isDeepResearchMarker(marker), true);
  assert.equal(isDeepResearchMessage({ citations: [{ filename: 'case.pdf' }] }), false);
});

test('uses the canonical Deep done answer even when it is shorter or empty', () => {
  assert.equal(
    reconcileDeepResearchStreamText('Long streamed draft with an invalid link', 'Short validated report'),
    'Short validated report',
  );
  assert.equal(reconcileDeepResearchStreamText('Transient draft', ''), '');
  assert.equal(reconcileDeepResearchStreamText('Stream fallback', undefined), 'Stream fallback');
});

test('replaces Deep snapshots while every non-Deep stream remains append-only', () => {
  assert.equal(mergeResearchStreamChunk('Draft one', 'Draft two', true, true), 'Draft two');
  assert.equal(mergeResearchStreamChunk('Draft one', ' plus delta', true, false), 'Draft one plus delta');
  assert.equal(mergeResearchStreamChunk('Research one', 'Research two', false, true), 'Research oneResearch two');
});
