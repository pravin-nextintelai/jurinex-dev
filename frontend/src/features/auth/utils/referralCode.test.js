import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FieldState,
  MEMORY_MS,
  STORAGE_KEY,
  codeFromUrl,
  createLatestGuard,
  normalizeInput,
  readStoredReferral,
  resolveInitialReferral,
  stateForValue,
  stateFromStatus,
  submitDecision,
} from './referralCode.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => ({ ...data }),
  };
}

test('normalizeInput upper-cases, strips invalid characters and caps at 20', () => {
  assert.equal(normalizeInput(' sfy-7k2q '), 'SFY-7K2Q');
  assert.equal(normalizeInput('ab_c!d'), 'ABCD');
  assert.equal(normalizeInput('A'.repeat(30)).length, 20);
});

test('codeFromUrl reads ?ref= from the query string and from the hash part', () => {
  assert.equal(codeFromUrl({ search: '?ref=sfy-7k2q&x=1' }), 'SFY-7K2Q');
  assert.equal(codeFromUrl({ search: '', hash: '#/signup?ref=SFY-7K2Q' }), 'SFY-7K2Q');
  assert.equal(codeFromUrl({ search: '?other=1', hash: '#/signup' }), '');
});

test('priority: URL code wins over the stored one and is saved (F2, F5)', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ code: 'OLD-CODE1', savedAt: 1 }) });
  const r = resolveInitialReferral({ search: '?ref=NEW-CODE2', storage, now: 10 });
  assert.deepEqual(r, { code: 'NEW-CODE2', source: 'url' });
  assert.deepEqual(JSON.parse(storage.dump()[STORAGE_KEY]), { code: 'NEW-CODE2', savedAt: 10 });
});

test('stored code is used within 30 days and removed after (F3, F4)', () => {
  const young = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ code: 'SFY-7K2Q', savedAt: 1000 }) });
  assert.deepEqual(resolveInitialReferral({ search: '', storage: young, now: 1000 + MEMORY_MS - 1 }), { code: 'SFY-7K2Q', source: 'storage' });
  const old = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ code: 'SFY-7K2Q', savedAt: 1000 }) });
  assert.deepEqual(resolveInitialReferral({ search: '', storage: old, now: 1000 + MEMORY_MS }), { code: '', source: null });
  assert.equal(old.getItem(STORAGE_KEY), null);
});

test('URL code is also kept for the tab, and the tab copy wins over the 30-day memory (OTP steps)', () => {
  const storage = memoryStorage();
  const session = memoryStorage();
  resolveInitialReferral({ search: '?ref=SFY-7K2Q', storage, session, now: 5 });
  assert.deepEqual(JSON.parse(session.dump()[STORAGE_KEY]), { code: 'SFY-7K2Q', savedAt: 5 });
  const storage2 = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ code: 'OLD-CODE1', savedAt: 5 }) });
  assert.deepEqual(resolveInitialReferral({ search: '', storage: storage2, session, now: 6 }), { code: 'SFY-7K2Q', source: 'session' });
});

test('corrupt storage entries are dropped', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
  assert.equal(readStoredReferral(storage), null);
});

test('storage that throws never breaks the flow (F10)', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(resolveInitialReferral({ search: '?ref=SFY-7K2Q', storage: throwing }), { code: 'SFY-7K2Q', source: 'url' });
  assert.deepEqual(resolveInitialReferral({ search: '', storage: throwing }), { code: '', source: null });
});

test('status → state mapping, including 429 / network as Check failed', () => {
  assert.equal(stateFromStatus('ACTIVE'), FieldState.VALID);
  assert.equal(stateFromStatus('NOT_FOUND'), FieldState.INVALID);
  assert.equal(stateFromStatus('INVALID_FORMAT'), FieldState.INVALID);
  assert.equal(stateFromStatus('INACTIVE'), FieldState.INACTIVE);
  assert.equal(stateFromStatus('RATE_LIMITED'), FieldState.CHECK_FAILED);
  assert.equal(stateFromStatus(undefined), FieldState.CHECK_FAILED);
});

test('unchecked value states: hidden, empty, too short, needs check', () => {
  assert.equal(stateForValue('', false), FieldState.HIDDEN);
  assert.equal(stateForValue('', true), FieldState.EMPTY);
  assert.equal(stateForValue('ABC', true), FieldState.TOO_SHORT);
  assert.equal(stateForValue('ABCDEF', true), null);
});

test('submit rules (5.5): what is allowed and what goes in the payload', () => {
  assert.deepEqual(submitDecision(FieldState.HIDDEN, ''), { allowed: true, referralCode: undefined });
  assert.deepEqual(submitDecision(FieldState.EMPTY, ''), { allowed: true, referralCode: undefined });
  assert.deepEqual(submitDecision(FieldState.VALID, 'sfy-7k2q'), { allowed: true, referralCode: 'SFY-7K2Q' });
  assert.deepEqual(submitDecision(FieldState.CHECK_FAILED, 'SFY-7K2Q'), { allowed: true, referralCode: 'SFY-7K2Q' });
  assert.deepEqual(submitDecision(FieldState.CHECKING, 'SFY-7K2Q'), { allowed: false, wait: true });
  for (const s of [FieldState.TOO_SHORT, FieldState.INVALID, FieldState.INACTIVE]) {
    assert.deepEqual(submitDecision(s, 'SFY-7K2Q'), { allowed: false, referralCode: undefined });
  }
});

test('stale responses are ignored: only the latest request id applies (F6)', () => {
  const guard = createLatestGuard();
  const first = guard.next();
  const second = guard.next();
  assert.equal(guard.isLatest(first), false);
  assert.equal(guard.isLatest(second), true);
});
