/**
 * Sales Referrals — customer-side service (no admin APIs here).
 *
 * - getPublicStatus(code)                       → { code, status, owner? }  for the public status API
 * - getCodeStatus(code)                         → 'VALID' | 'INVALID' | 'INACTIVE'  (legacy alias route)
 * - attributeSignup(client, firmId, code)       → inserts the tenant_referrals row INSIDE the caller's
 *                                                 transaction, under a SAVEPOINT; never throws
 * - recordSignupReferral(firmId, code)          → same, on its own short transaction; never throws
 *
 * Workspace = firm: tenant_referrals.tenant_id references firms.id (uuid, ON DELETE CASCADE).
 * code_id NULL means a Direct signup. A row is written for EVERY new firm.
 *
 * SOLO signups have no firm, so they get the same row in user_referrals (keyed on users.id,
 * created by utils/userReferralDb.js): attributeUserSignup / recordUserSignupReferral.
 * Never expose owner id, label, internal flag or notes.
 */
let defaultPool = null;
function getDefaultPool() {
  // Loaded lazily so unit tests with a fake pool never open the real database.
  if (!defaultPool) defaultPool = require('../config/db');
  return defaultPool;
}

const CODE_RE = /^[A-Z0-9-]{6,20}$/;
const MAX_RAW_LENGTH = 50;
const DEFAULT_CACHE_TTL_MS = 45 * 1000;

const PUBLIC_STATUS = Object.freeze({
  INVALID_FORMAT: 'INVALID_FORMAT',
  NOT_FOUND: 'NOT_FOUND',
  INACTIVE: 'INACTIVE',
  ACTIVE: 'ACTIVE',
});

const SIGNUP_RESULT = Object.freeze({
  ATTACHED: 'ATTACHED',
  DIRECT: 'DIRECT',
  INACTIVE: 'INACTIVE',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_FORMAT: 'INVALID_FORMAT',
});

/** Trim + upper-case. Returns '' when the value must be treated as absent. */
function normalizeCode(raw) {
  if (raw === undefined || raw === null || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_RAW_LENGTH) return '';
  return trimmed.toUpperCase();
}

function isValidFormat(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

function createReferralService({ pool: poolArg = null, logger = console, cacheTtlMs = DEFAULT_CACHE_TTL_MS, now = Date.now } = {}) {
  const pool = {
    query: (...a) => (poolArg || getDefaultPool()).query(...a),
    connect: () => (poolArg || getDefaultPool()).connect(),
  };
  const statusCache = new Map(); // code → { value, expiresAt }

  /** Public status API (section 1). Always resolves; reads at most one row. */
  async function getPublicStatus(raw) {
    const code = normalizeCode(raw);
    if (!isValidFormat(code)) return { code, status: PUBLIC_STATUS.INVALID_FORMAT };

    const cached = statusCache.get(code);
    if (cached && cached.expiresAt > now()) return cached.value;

    const result = await pool.query(
      `SELECT rc.active, so.name
         FROM referral_codes rc
         JOIN sales_owners so ON so.id = rc.owner_id
        WHERE rc.code = $1
        LIMIT 1`,
      [code]
    );
    let value;
    if (result.rows.length === 0) value = { code, status: PUBLIC_STATUS.NOT_FOUND };
    else if (!result.rows[0].active) value = { code, status: PUBLIC_STATUS.INACTIVE };
    else value = { code, status: PUBLIC_STATUS.ACTIVE, owner: { name: result.rows[0].name } };

    if (cacheTtlMs > 0) statusCache.set(code, { value, expiresAt: now() + cacheTtlMs });
    return value;
  }

  /** Legacy alias used by /api/auth/referral-codes/:code/status. */
  async function getCodeStatus(raw) {
    const { status } = await getPublicStatus(raw);
    if (status === PUBLIC_STATUS.ACTIVE) return 'VALID';
    if (status === PUBLIC_STATUS.INACTIVE) return 'INACTIVE';
    return 'INVALID';
  }

  /** Section 2 steps 1–2: which code_id (if any) a signup gets. */
  async function resolveCode(client, raw) {
    const code = normalizeCode(raw);
    if (!code) return { code: null, codeId: null, result: SIGNUP_RESULT.DIRECT };
    if (!isValidFormat(code)) return { code, codeId: null, result: SIGNUP_RESULT.INVALID_FORMAT };
    const found = await client.query('SELECT id, active FROM referral_codes WHERE code = $1 LIMIT 1', [code]);
    if (found.rows.length === 0) return { code, codeId: null, result: SIGNUP_RESULT.NOT_FOUND };
    if (!found.rows[0].active) return { code, codeId: null, result: SIGNUP_RESULT.INACTIVE };
    return { code, codeId: found.rows[0].id, result: SIGNUP_RESULT.ATTACHED };
  }

  const TARGETS = Object.freeze({
    firm: { table: 'tenant_referrals', idColumn: 'tenant_id', label: 'firmId' },
    user: { table: 'user_referrals', idColumn: 'user_id', label: 'userId' },
  });

  /** Section 2 step 3: exactly one row per firm (or per solo user); a repeat is a no-op. */
  async function insertReferralRow(client, target, id, codeId) {
    const r = await client.query(
      `INSERT INTO ${target.table} (${target.idColumn}, code_id, source, signed_up_at)
       VALUES ($1, $2, 'SIGNUP', NOW())
       ON CONFLICT (${target.idColumn}) DO NOTHING`,
      [id, codeId]
    );
    return r.rowCount === 1;
  }

  async function insertTenantReferral(client, firmId, codeId) {
    return insertReferralRow(client, TARGETS.firm, firmId, codeId);
  }

  async function insertUserReferral(client, userId, codeId) {
    return insertReferralRow(client, TARGETS.user, userId, codeId);
  }

  /**
   * Section 2 inside the caller's open transaction. A failure in here is rolled back to the
   * savepoint and logged with the id; the signup goes on. Returns
   * { code, codeId, result, recorded }.
   */
  async function attribute(client, target, id, raw) {
    let outcome = { code: normalizeCode(raw) || null, codeId: null, result: SIGNUP_RESULT.DIRECT, recorded: false };
    await client.query('SAVEPOINT referral');
    try {
      const resolved = await resolveCode(client, raw);
      const inserted = await insertReferralRow(client, target, id, resolved.codeId);
      await client.query('RELEASE SAVEPOINT referral');
      outcome = { ...resolved, recorded: inserted };
    } catch (err) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT referral');
      } catch (rollbackErr) {
        logger.warn(`[Referral] rollback to savepoint failed: ${target.label}=${id} ${rollbackErr.message}`);
      }
      logger.warn(`[Referral] attribution failed, signup continues: ${target.label}=${id} code=${outcome.code} ${err.message}`);
    }
    logger.info(`[Referral] signup ${target.label}=${id} code=${outcome.code} codeId=${outcome.codeId} result=${outcome.result}${outcome.recorded ? '' : ' (row not written)'}`);
    return outcome;
  }

  /** Firm (workspace) signup → tenant_referrals, inside the caller's transaction. */
  function attributeSignup(client, firmId, raw) {
    return attribute(client, TARGETS.firm, firmId, raw);
  }

  /** Solo signup (no firm) → user_referrals, inside the caller's transaction. */
  function attributeUserSignup(client, userId, raw) {
    return attribute(client, TARGETS.user, userId, raw);
  }

  /** Runs `fn(client)` on its own short transaction. Never throws. */
  async function onOwnTransaction(label, id, raw, fn) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const outcome = await fn(client);
      await client.query('COMMIT');
      return outcome;
    } catch (err) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      }
      logger.warn(`[Referral] attribution skipped: ${label}=${id} ${err.message}`);
      return { code: normalizeCode(raw) || null, codeId: null, result: SIGNUP_RESULT.DIRECT, recorded: false };
    } finally {
      if (client) client.release();
    }
  }

  /** Firm signup without an open transaction. Never throws. */
  function recordSignupReferral(firmId, raw) {
    return onOwnTransaction('firmId', firmId, raw, (client) => attributeSignup(client, firmId, raw));
  }

  /** Solo signup without an open transaction. Never throws. */
  function recordUserSignupReferral(userId, raw) {
    return onOwnTransaction('userId', userId, raw, (client) => attributeUserSignup(client, userId, raw));
  }

  return {
    normalizeCode,
    isValidFormat,
    getPublicStatus,
    getCodeStatus,
    resolveCode,
    insertTenantReferral,
    insertUserReferral,
    attributeSignup,
    attributeUserSignup,
    recordSignupReferral,
    recordUserSignupReferral,
    clearCache: () => statusCache.clear(),
  };
}

module.exports = Object.assign(createReferralService(), {
  createReferralService,
  normalizeCode,
  isValidFormat,
  CODE_RE,
  PUBLIC_STATUS,
  SIGNUP_RESULT,
});
