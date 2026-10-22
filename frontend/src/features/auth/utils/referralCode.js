/**
 * Sales Referrals — pure logic for the signup page (no React, no network), so it
 * can be unit-tested: code normalisation, where the code comes from, the 30-day
 * memory in localStorage, stale-response handling and status → field state.
 *
 * Spec: docs/sales-referrals-user-api.md, section 5.
 */

export const STORAGE_KEY = 'jx_referral';
export const MEMORY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CODE_MAX_LENGTH = 20;
export const CODE_MIN_LENGTH = 6;
export const CODE_RE = /^[A-Z0-9-]{6,20}$/;

/** Field states (spec 5.4). */
export const FieldState = Object.freeze({
  HIDDEN: 'hidden',
  EMPTY: 'empty',
  TOO_SHORT: 'too_short',
  CHECKING: 'checking',
  VALID: 'valid',
  INVALID: 'invalid',
  INACTIVE: 'inactive',
  CHECK_FAILED: 'check_failed',
});

/** Upper-case, strip anything a code cannot contain, cap the length. */
export function normalizeInput(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, CODE_MAX_LENGTH);
}

export function normalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().slice(0, 50);
}

/** `?ref=` from the query string, or from the hash part (`#/signup?ref=…`). */
export function codeFromUrl({ search = '', hash = '' } = {}) {
  const read = (qs) => {
    try {
      const value = new URLSearchParams(qs).get('ref');
      return value ? normalizeCode(value) : '';
    } catch {
      return '';
    }
  };
  const fromSearch = read(search.startsWith('?') ? search : `?${search}`);
  if (fromSearch) return fromSearch;
  const idx = hash.indexOf('?');
  return idx >= 0 ? read(hash.slice(idx)) : '';
}

/** localStorage access that never throws (private mode, blocked storage). */
export function readStoredReferral(storage, now = Date.now()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const code = normalizeCode(parsed && parsed.code);
    const savedAt = Number(parsed && parsed.savedAt);
    if (!code || !Number.isFinite(savedAt)) {
      clearStoredReferral(storage);
      return null;
    }
    if (now - savedAt >= MEMORY_MS) {
      clearStoredReferral(storage);
      return null;
    }
    return { code, savedAt };
  } catch {
    return null;
  }
}

export function saveStoredReferral(storage, code, now = Date.now()) {
  try {
    if (storage && code) storage.setItem(STORAGE_KEY, JSON.stringify({ code: normalizeCode(code), savedAt: now }));
  } catch {
    /* private mode: the link code still works for this visit */
  }
}

export function clearStoredReferral(storage) {
  try {
    if (storage) storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Where the initial code comes from, in priority order:
 * 1. ?ref= in the URL (always wins; saved for 30 days and for this tab),
 * 2. the code kept for this tab (survives e-mail verification / OTP steps),
 * 3. the remembered code if younger than 30 days,
 * 4. nothing.
 * Returns { code, source: 'url' | 'session' | 'storage' | null }.
 */
export function resolveInitialReferral({ search, hash, storage, session, now = Date.now() } = {}) {
  const fromUrl = codeFromUrl({ search, hash });
  if (fromUrl) {
    saveStoredReferral(storage, fromUrl, now);
    saveStoredReferral(session, fromUrl, now);
    return { code: fromUrl, source: 'url' };
  }
  const kept = readStoredReferral(session, now);
  if (kept) return { code: kept.code, source: 'session' };
  const stored = readStoredReferral(storage, now);
  if (stored) return { code: stored.code, source: 'storage' };
  return { code: '', source: null };
}

/** Map a public status (ACTIVE / INACTIVE / NOT_FOUND / INVALID_FORMAT) or a failure to a field state. */
export function stateFromStatus(status) {
  switch (status) {
    case 'ACTIVE':
    case 'VALID':
      return FieldState.VALID;
    case 'INACTIVE':
      return FieldState.INACTIVE;
    case 'NOT_FOUND':
    case 'INVALID_FORMAT':
    case 'INVALID':
      return FieldState.INVALID;
    default:
      return FieldState.CHECK_FAILED; // 429, network error, unexpected body
  }
}

/** State for a value that has not been checked (yet). */
export function stateForValue(value, open) {
  const v = normalizeInput(value);
  if (!open) return FieldState.HIDDEN;
  if (!v) return FieldState.EMPTY;
  if (v.length < CODE_MIN_LENGTH) return FieldState.TOO_SHORT;
  return null; // long enough: needs a check
}

/** Submit rules (spec 5.4 / 5.5): can the form submit, and what goes in the payload. */
export function submitDecision(state, value) {
  const code = normalizeInput(value);
  switch (state) {
    case FieldState.HIDDEN:
    case FieldState.EMPTY:
      return { allowed: true, referralCode: undefined };
    case FieldState.VALID:
    case FieldState.CHECK_FAILED:
      return { allowed: true, referralCode: code };
    case FieldState.CHECKING:
      return { allowed: false, wait: true };
    default: // TOO_SHORT, INVALID, INACTIVE
      return { allowed: false, referralCode: undefined };
  }
}

/** Keeps only the latest in-flight request's result (spec 5.3, stale responses). */
export function createLatestGuard() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isLatest(id) {
      return id === current;
    },
  };
}
