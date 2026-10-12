/**
 * Sales Referrals — customer side.
 * Run: node --test test/referralCodes.test.js
 *
 * The service runs against fake pool/clients that record every query, so no database
 * is needed. The public route + rate limit run through a real Express app on an
 * ephemeral port.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://unused:unused@127.0.0.1:1/unused';

const { createReferralService, normalizeCode, isValidFormat } = require('../src/services/referralCodes.service');

/** Fake pool: `rowsByQuery` maps a SQL fragment → rows | function(params) → rows | Error. */
function fakePool(rowsByQuery) {
  const calls = [];
  const pool = {
    calls,
    released: 0,
    async query(sql, params) {
      calls.push({ sql, params });
      const key = Object.keys(rowsByQuery).find((k) => sql.includes(k));
      const v = key ? rowsByQuery[key] : [];
      if (v instanceof Error) throw v;
      const rows = typeof v === 'function' ? v(params) : v;
      return { rows, rowCount: rows.length };
    },
    async connect() {
      return { query: pool.query.bind(pool), release() { pool.released += 1; } };
    },
  };
  return pool;
}

function makeLogger() {
  return { lines: [], info(m) { this.lines.push(`INFO ${m}`); }, warn(m) { this.lines.push(`WARN ${m}`); }, error() {} };
}

const firstWords = (pool, n) => pool.calls.map((c) => c.sql.trim().split(/\s+/).slice(0, n).join(' '));

test('normalisation: trim + upper-case; absent for null, non-string, empty, > 50 chars', () => {
  assert.equal(normalizeCode(' sfy-7k2q '), 'SFY-7K2Q');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(123), '');
  assert.equal(normalizeCode('   '), '');
  assert.equal(normalizeCode('x'.repeat(51)), '');
  assert.equal(isValidFormat('SFY-7K2Q'), true);
  assert.equal(isValidFormat('SFY_7K2Q'), false);
  assert.equal(isValidFormat('ab'), false);
});

test('status API: ACTIVE (with owner name), INACTIVE, NOT_FOUND, INVALID_FORMAT, lower-case normalised', async () => {
  const rows = { 'SFY-7K2Q': [{ active: true, name: 'Priya Shah', owner_id: 'o1', label: 'secret', internal: true }], 'OLD-CODE1': [{ active: false, name: 'X' }] };
  const pool = fakePool({ 'FROM referral_codes rc': (params) => rows[params[0]] || [] });
  const svc = createReferralService({ pool, logger: makeLogger() });

  assert.deepEqual(await svc.getPublicStatus('sfy-7k2q'), { code: 'SFY-7K2Q', status: 'ACTIVE', owner: { name: 'Priya Shah' } });
  assert.deepEqual(await svc.getPublicStatus('OLD-CODE1'), { code: 'OLD-CODE1', status: 'INACTIVE' });
  assert.deepEqual(await svc.getPublicStatus('NOPE-0000'), { code: 'NOPE-0000', status: 'NOT_FOUND' });
  assert.deepEqual(await svc.getPublicStatus(' ab '), { code: 'AB', status: 'INVALID_FORMAT' });
  assert.deepEqual(await svc.getPublicStatus('SFY_7K2Q'), { code: 'SFY_7K2Q', status: 'INVALID_FORMAT' });
  assert.deepEqual(pool.calls[0].params, ['SFY-7K2Q']);
  assert.match(pool.calls[0].sql, /JOIN sales_owners so ON so\.id = rc\.owner_id/);
  // malformed codes never reach the database
  assert.equal(pool.calls.filter((c) => c.params && c.params[0] === 'AB').length, 0);
});

test('status API: short cache — a repeat lookup within the TTL does not hit the database', async () => {
  let t = 1000;
  const pool = fakePool({ 'FROM referral_codes rc': [{ active: true, name: 'Priya Shah' }] });
  const svc = createReferralService({ pool, logger: makeLogger(), cacheTtlMs: 45000, now: () => t });
  await svc.getPublicStatus('SFY-7K2Q');
  await svc.getPublicStatus('SFY-7K2Q');
  assert.equal(pool.calls.length, 1);
  t += 46000;
  await svc.getPublicStatus('SFY-7K2Q');
  assert.equal(pool.calls.length, 2);
});

test('legacy alias maps ACTIVE→VALID, INACTIVE→INACTIVE, everything else→INVALID', async () => {
  const rows = { 'SFY-7K2Q': [{ active: true, name: 'P' }], 'OLD-CODE1': [{ active: false, name: 'P' }] };
  const svc = createReferralService({ pool: fakePool({ 'FROM referral_codes rc': (p) => rows[p[0]] || [] }), logger: makeLogger() });
  assert.equal(await svc.getCodeStatus('SFY-7K2Q'), 'VALID');
  assert.equal(await svc.getCodeStatus('OLD-CODE1'), 'INACTIVE');
  assert.equal(await svc.getCodeStatus('NOPE-0000'), 'INVALID');
  assert.equal(await svc.getCodeStatus('ab'), 'INVALID');
});

test('public controller answers 200 with exactly code/status/owner and Cache-Control no-store', async () => {
  const svc = createReferralService({ pool: fakePool({ 'FROM referral_codes rc': [{ active: true, name: 'Priya Shah', owner_id: 'o1', label: 'l', internal: true, notes: 'n' }] }), logger: makeLogger() });
  const sandbox = { module: { exports: {} }, require: () => svc, console: { error() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/referralController.js'), 'utf8'), sandbox);
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await sandbox.module.exports.getPublicReferralStatus({ params: { code: 'sfy-7k2q' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body), '{"code":"SFY-7K2Q","status":"ACTIVE","owner":{"name":"Priya Shah"}}');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('register with active code → tenant_referrals row with that code_id, source SIGNUP, inside the caller transaction', async () => {
  const pool = fakePool({ 'SELECT id, active FROM referral_codes': [{ id: 'code-uuid-1', active: true }], 'INSERT INTO tenant_referrals': [{}] });
  const logger = makeLogger();
  const svc = createReferralService({ pool, logger });
  const client = await pool.connect();
  const out = await svc.attributeSignup(client, 'firm-uuid', 'sfy-7k2q');
  assert.deepEqual(out, { code: 'SFY-7K2Q', codeId: 'code-uuid-1', result: 'ATTACHED', recorded: true });
  assert.deepEqual(firstWords(pool, 3), ['SAVEPOINT referral', 'SELECT id, active', 'INSERT INTO tenant_referrals', 'RELEASE SAVEPOINT referral']);
  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO tenant_referrals'));
  assert.deepEqual(insert.params, ['firm-uuid', 'code-uuid-1']);
  assert.match(insert.sql, /'SIGNUP'/);
  assert.match(insert.sql, /ON CONFLICT \(tenant_id\) DO NOTHING/);
  assert.ok(logger.lines.some((l) => l.includes('firmId=firm-uuid') && l.includes('code=SFY-7K2Q') && l.includes('codeId=code-uuid-1') && l.includes('result=ATTACHED')));
});

test('register with inactive / unknown / malformed / no code → row with code_id NULL and the right result', async () => {
  const cases = [
    ['OLD-CODE1', [{ id: 'c-old', active: false }], 'INACTIVE', 'OLD-CODE1'],
    ['UNKNOWN-99', [], 'NOT_FOUND', 'UNKNOWN-99'],
    ['ab', [], 'INVALID_FORMAT', 'AB'],
    [undefined, [], 'DIRECT', null],
    [null, [], 'DIRECT', null],
    [123, [], 'DIRECT', null],
    ['X'.repeat(500), [], 'DIRECT', null],
  ];
  for (const [raw, rows, expected, code] of cases) {
    const pool = fakePool({ 'SELECT id, active FROM referral_codes': rows, 'INSERT INTO tenant_referrals': [{}] });
    const svc = createReferralService({ pool, logger: makeLogger() });
    const out = await svc.attributeSignup(await pool.connect(), 'firm-uuid', raw);
    assert.deepEqual(out, { code, codeId: null, result: expected, recorded: true }, String(raw));
    const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO tenant_referrals'));
    assert.deepEqual(insert.params, ['firm-uuid', null], String(raw));
  }
});

test('a failing referral insert rolls back to the savepoint, logs the firm id and never throws', async () => {
  const pool = fakePool({ 'SELECT id, active FROM referral_codes': [{ id: 'code-uuid-1', active: true }], 'INSERT INTO tenant_referrals': new Error('relation does not exist') });
  const logger = makeLogger();
  const svc = createReferralService({ pool, logger });
  const out = await svc.attributeSignup(await pool.connect(), 'firm-uuid', 'SFY-7K2Q');
  assert.deepEqual(out, { code: 'SFY-7K2Q', codeId: null, result: 'DIRECT', recorded: false });
  assert.ok(firstWords(pool, 4).includes('ROLLBACK TO SAVEPOINT referral'));
  assert.ok(logger.lines.some((l) => l.startsWith('WARN') && l.includes('firmId=firm-uuid')));
});

test('duplicate insert for the same firm is a no-op (ON CONFLICT DO NOTHING → recorded false)', async () => {
  let inserted = 0;
  const pool = fakePool({
    'SELECT id, active FROM referral_codes': [],
    'INSERT INTO tenant_referrals': () => { inserted += 1; return inserted === 1 ? [{}] : []; },
  });
  const svc = createReferralService({ pool, logger: makeLogger() });
  const client = await pool.connect();
  assert.equal((await svc.attributeSignup(client, 'firm-uuid', null)).recorded, true);
  assert.equal((await svc.attributeSignup(client, 'firm-uuid', null)).recorded, false);
});

test('solo signup with active code → user_referrals row keyed on users.id, source SIGNUP', async () => {
  const pool = fakePool({ 'SELECT id, active FROM referral_codes': [{ id: 'code-uuid-1', active: true }], 'INSERT INTO user_referrals': [{}] });
  const logger = makeLogger();
  const svc = createReferralService({ pool, logger });
  const out = await svc.recordUserSignupReferral(103, 'prav-7dqj');
  assert.deepEqual(out, { code: 'PRAV-7DQJ', codeId: 'code-uuid-1', result: 'ATTACHED', recorded: true });
  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO user_referrals'));
  assert.deepEqual(insert.params, [103, 'code-uuid-1']);
  assert.match(insert.sql, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert.equal(pool.calls.some((c) => c.sql.includes('tenant_referrals')), false);
  assert.deepEqual(firstWords(pool, 1), ['BEGIN', 'SAVEPOINT', 'SELECT', 'INSERT', 'RELEASE', 'COMMIT']);
  assert.ok(logger.lines.some((l) => l.includes('userId=103') && l.includes('result=ATTACHED')));
});

test('solo signup without a code → user_referrals row with code_id NULL (Direct)', async () => {
  const pool = fakePool({ 'INSERT INTO user_referrals': [{}] });
  const svc = createReferralService({ pool, logger: makeLogger() });
  const out = await svc.recordUserSignupReferral(104, undefined);
  assert.deepEqual(out, { code: null, codeId: null, result: 'DIRECT', recorded: true });
  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO user_referrals'));
  assert.deepEqual(insert.params, [104, null]);
});

test('recordSignupReferral (no caller transaction) wraps the same work in BEGIN/COMMIT and releases the client', async () => {
  const pool = fakePool({ 'SELECT id, active FROM referral_codes': [{ id: 'code-uuid-1', active: true }] });
  const svc = createReferralService({ pool, logger: makeLogger() });
  const out = await svc.recordSignupReferral('firm-uuid', 'SFY-7K2Q');
  assert.equal(out.result, 'ATTACHED');
  assert.deepEqual(firstWords(pool, 1), ['BEGIN', 'SAVEPOINT', 'SELECT', 'INSERT', 'RELEASE', 'COMMIT']);
  assert.equal(pool.released, 1);
});

test('registerFirm: a failure after the firms insert rolls the whole transaction back (no tenant_referrals row left)', async () => {
  // Drive the real controller with a fake pool whose firm_users insert fails.
  const pool = fakePool({
    'SELECT * FROM firms WHERE email': [],
    'SELECT * FROM users WHERE email': [],
    'INSERT INTO users': [{ id: 7, email: 'f@x.com' }],
    'INSERT INTO firms': [{ id: 'firm-uuid', firm_name: 'F', email: 'f@x.com', approval_status: 'PENDING' }],
    'INSERT INTO firm_users': new Error('firm_users insert failed'),
  });
  const { registerFirm } = loadAuthControllerWithPool(pool);
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await registerFirm({ body: { firm_name: 'F', registering_advocate_name: 'A', firm_type: 'Registered', email: 'f@x.com', mobile: '9999999999', referralCode: 'SFY-7K2Q' } }, res);
  assert.equal(res.statusCode, 500);
  const words = firstWords(pool, 1);
  assert.ok(words.includes('BEGIN') && words.includes('ROLLBACK'));
  assert.ok(!words.includes('COMMIT'));
  assert.equal(pool.calls.some((c) => c.sql.includes('INSERT INTO tenant_referrals')), false);
  assert.equal(pool.released, 1);
});

test('registerFirm: happy path commits user, firm, firm_user and the referral row; response carries referral {code,status}', async () => {
  const pool = fakePool({
    'SELECT * FROM firms WHERE email': [],
    'SELECT * FROM users WHERE email': [],
    'INSERT INTO users': [{ id: 7, email: 'f@x.com' }],
    'INSERT INTO firms': [{ id: 'firm-uuid', firm_name: 'F', email: 'f@x.com', approval_status: 'PENDING' }],
    'INSERT INTO firm_users': [{}],
    'SELECT id, active FROM referral_codes': [{ id: 'code-uuid-1', active: true }],
  });
  const { registerFirm } = loadAuthControllerWithPool(pool);
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await registerFirm({ body: { firm_name: 'F', registering_advocate_name: 'A', firm_type: 'Registered', email: 'f@x.com', mobile: '9999999999', referralCode: 'sfy-7k2q' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.stringify(res.body.referral), '{"code":"SFY-7K2Q","status":"ATTACHED"}');
  assert.equal(res.body.firm.id, 'firm-uuid');
  const words = firstWords(pool, 3);
  assert.ok(words.indexOf('BEGIN') >= 0 && words.indexOf('BEGIN') < words.indexOf('INSERT INTO users')); // writes happen inside the transaction
  assert.ok(words.includes('INSERT INTO tenant_referrals'));
  assert.equal(words[words.length - 1], 'COMMIT');
  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO tenant_referrals'));
  assert.equal(JSON.stringify(insert.params), JSON.stringify(['firm-uuid', 'code-uuid-1'])); // array created in the sandbox realm
});

test('rate limit: the 31st public status check from one IP within a minute returns 429 RATE_LIMITED', async () => {
  const express = require('express');
  const { referralStatusRateLimit } = require('../src/middleware/referralRateLimit');
  const app = express();
  app.set('trust proxy', true);
  app.get('/api/public/referrals/:code/status', referralStatusRateLimit, (req, res) => res.json({ code: 'AB', status: 'INVALID_FORMAT' }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const get = (ip) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/public/referrals/ab/status', headers: { 'x-forwarded-for': ip }, agent: false }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let body = null; try { body = JSON.parse(t); } catch (_) { body = { raw: t.slice(0, 300) }; } resolve({ status: res.statusCode, body, headers: res.headers }); });
    }).on('error', reject);
  });
  try {
    for (let i = 0; i < 30; i += 1) assert.equal((await get('203.0.113.9')).status, 200);
    const blocked = await get('203.0.113.9');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.errorCode, 'RATE_LIMITED');
    assert.ok(blocked.body.message && blocked.body.timestamp);
    assert.equal(blocked.headers['cache-control'], 'no-store');
    assert.equal((await get('203.0.113.10')).status, 200); // keyed on the real client IP
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

/**
 * Load authController.js in a sandbox where ../config/db is the fake pool and the
 * side-effect modules (Brevo, Firebase, OTP, …) are stubs. Models and the referral
 * service are the real files, re-required against the same fake pool.
 */
function loadAuthControllerWithPool(pool) {
  const src = path.join(__dirname, '../src');
  const cache = new Map();
  const stubs = {
    '../services/brevoService': { syncContactToBrevo() {} },
    '../services/otpService': { createAndSendOTP() {}, verifyOTP() {}, sendPasswordSetEmail() {} },
    '../config/firebase': {},
    'google-auth-library': { OAuth2Client: class {} },
    '../utils/deviceInfo': { collectDeviceInfo() { return {}; }, lookupGeoLocation() { return {}; } },
    '../utils/jwt': { generateToken: () => 'token' },
    '../utils/authAccess': { getAuthDenial: () => null },
    'bcryptjs': { hash: async () => 'hashed', compare: async () => true },
  };
  function sandboxRequire(fromDir) {
    return (name) => {
      if (name === '../config/db') return pool;
      if (stubs[name]) return stubs[name];
      if (!name.startsWith('.')) return require(name);
      const file = require.resolve(path.resolve(fromDir, name));
      if (!file.startsWith(src)) return require(file);
      if (cache.has(file)) return cache.get(file);
      const sandbox = { module: { exports: {} }, exports: {}, require: sandboxRequire(path.dirname(file)), console: { log() {}, warn() {}, error() {}, info() {} }, process, Buffer, setTimeout, clearTimeout, __dirname: path.dirname(file), __filename: file };
      sandbox.exports = sandbox.module.exports;
      cache.set(file, sandbox.module.exports);
      vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
      cache.set(file, sandbox.module.exports);
      return sandbox.module.exports;
    };
  }
  return sandboxRequire(path.join(src, 'controllers'))('./authController');
}
