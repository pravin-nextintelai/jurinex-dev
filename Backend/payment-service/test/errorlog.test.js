'use strict';
/**
 * End-to-end tests for the Node errorlog module against real Express apps.
 *
 * Run from the service root:  node --test test/errorlog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

process.env.ENVIRONMENT = 'test';
process.env.SERVICE_NAME = 'errorlog-node-tests';
process.env.ERROR_LOG_CAPTURE_ALL = process.env.ERROR_LOG_CAPTURE_ALL || 'true';
process.env.IK_API_URL = 'https://api.indiankanoon.org';
process.env.ERROR_LOG_FLUSH_INTERVAL_MS = '50';
process.env.ERROR_LOG_STORE_4XX_PREFIXES = '/api/payments';
delete process.env.ERROR_LOG_DATABASE_URL;
delete process.env.ERROR_LOG_INGEST_URL;

const express = require('express');
const errorlog = require('../errorlog');
const { MemorySink } = require('../errorlog/writer');
const { withInternal } = require('../errorlog/context');
const sanitize = require('../errorlog/sanitize');
const gemini = require('../errorlog/hooks/gemini');

const expressMajor = parseInt(require('express/package.json').version.split('.')[0], 10);
const sink = new MemorySink();
const root = path.resolve(__dirname, '..');

// ── a fake upstream server (plays the citation API / payment service) ───────
let upstream; let upstreamPort; let lastUpstreamHeaders = null;
// ── a fake Gemini SDK surface patched through the real hook ─────────────────
class FakeModels {
  constructor() { this.mode = 'ok'; }
  async generateContentInternal(params) {
    if (this.mode === 'raise') { const e = new Error('{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}'); e.name = 'ApiError'; e.status = 429; throw e; }
    if (this.mode === 'safety') return { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }], usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 } };
    if (this.mode === 'empty') return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }] };
    if (this.mode === 'max') return { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] };
    return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'fine answer' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 } };
  }
  async generateContentStreamInternal(params) {
    const mode = this.mode;
    return (async function* gen() {
      yield { candidates: [{ content: { parts: [{ text: 'chunk ' }] } }] };
      if (mode === 'stream_raise') { const e = new Error('upstream unavailable'); e.status = 503; throw e; }
      yield { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'two' }] } }] };
    }());
  }
}

let app; let server; let port;

// The test client is not part of the service under test: mark its own HTTP
// calls internal so the outgoing-HTTP hook ignores them.
function request(method, p, { headers = {}, body } = {}) {
  return withInternal(() => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  }));
}

async function rows(expect, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await errorlog.flush(300);
    if (expect === undefined || sink.rows.length >= expect) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return sink.rows.slice();
}

test.before(async () => {
  upstream = http.createServer((req, res) => {
    lastUpstreamHeaders = req.headers;
    if (req.url.startsWith('/hang')) return; // never answers: timeout
    if (req.url.startsWith('/boom')) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'upstream broke' })); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = upstream.address().port;
  process.env.EXTERNAL_PROVIDERS = `127.0.0.1:${upstreamPort}=CITATION`;

  app = express();
  errorlog.install(app, { serviceName: 'errorlog-node-tests', root, sink });
  const patched = [];
  gemini.patchMethod(FakeModels.prototype, 'generateContentInternal', 'generate', new gemini.GeminiHook(errorlog._state().recorder, errorlog._state().cfg), 'models.', patched);
  gemini.patchMethod(FakeModels.prototype, 'generateContentStreamInternal', 'stream', new gemini.GeminiHook(errorlog._state().recorder, errorlog._state().cfg), 'models.', patched);
  assert.equal(patched.length, 2);

  app.use(express.json());
  app.get('/ok', (req, res) => res.json({ ok: true }));
  app.get('/throw', () => { throw new TypeError('boom: sync throw'); });
  app.get('/async-throw', async () => { await new Promise((r) => setTimeout(r, 5)); throw new RangeError('boom: async throw'); });
  app.get('/self-500', (req, res) => {
    try { JSON.parse('{bad'); } catch (e) { console.error('route handled it', e); }
    res.status(500).json({ success: false, message: 'we handled it ourselves' });
  });
  app.get('/recovered', (req, res) => { try { throw new Error('recovered'); } catch (e) { console.error('recovered fine', e); } res.json({ ok: true }); });
  app.get('/not-found-route', (req, res) => res.status(404).json({ error: 'nope' }));
  app.get('/gemini/:mode', async (req, res) => {
    const m = new FakeModels(); m.mode = req.params.mode;
    try { const r = await m.generateContentInternal({ model: 'gemini-2.5-flash', contents: 'hi' }); res.json({ text: r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text }); } catch (e) {
      if (req.query.fail === '0') return res.json({ recovered: true });
      res.status(500).json({ message: 'AI call failed' });
    }
  });
  app.get('/gemini-stream/:mode', async (req, res) => {
    const m = new FakeModels(); m.mode = req.params.mode;
    try { const out = []; for await (const c of await m.generateContentStreamInternal({ model: 'gemini-2.5-pro' })) out.push(c.candidates[0].content.parts[0].text); res.json({ out }); } catch (e) { res.status(500).json({ message: 'stream failed' }); }
  });
  app.get('/gemini-retry', async (req, res) => {
    const m = new FakeModels(); m.mode = 'raise';
    for (let i = 0; i < 3; i += 1) { try { await m.generateContentInternal({ model: 'gemini-2.5-flash' }); } catch (_) { /* retry */ } }
    res.status(500).json({ message: 'AI failed after retries' });
  });
  app.get('/citation/:kind', (req, res) => {
    const kind = req.params.kind;
    const u = `http://127.0.0.1:${upstreamPort}/${kind}?formInput=x&token=SECRET-TOKEN`;
    const r = http.get(u, { timeout: 300 }, (up) => {
      up.resume();
      up.on('end', () => (up.statusCode >= 500 && req.query.fail !== '0' ? res.status(502).json({ message: 'citation provider failed' }) : res.json({ status: up.statusCode })));
    });
    r.on('timeout', () => r.destroy(new Error('socket hang up (timeout)')));
    r.on('error', () => (req.query.fail === '0' ? res.json({ recovered: true }) : res.status(502).json({ message: 'citation provider unreachable' })));
  });
  app.get('/fetch-fail', async (req, res) => {
    try { await fetch(`http://127.0.0.1:${upstreamPort}/boom?key=SECRET`); } catch (_) { /* ignore */ }
    res.status(500).json({ message: 'fetch upstream failed' });
  });
  app.get('/forward', async (req, res) => { await fetch(`http://127.0.0.1:${upstreamPort}/ok`); res.json({ forwarded: lastUpstreamHeaders['x-request-id'] || null }); });
  app.get('/stream-fail', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: one\n\n');
    setTimeout(() => { errorlog.recordError(new Error('stream died'), { afterResponseStart: true }); res.end(); }, 10);
  });
  app.get('/secret-leak', () => { throw new Error('failed https://x.googleapis.com/v1?key=AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE password=hunter2'); });
  app.get('/user', (req, res) => { req.user = { id: 7, email: 'seven@example.com' }; throw new Error('after auth'); });

  // client-reported checkout errors behind a fake auth middleware, and 4xx on a stored prefix
  const fakeProtect = (req, res, next) => {
    if (req.headers.authorization === 'Bearer good') { req.user = { id: 42, email: 'adv@example.com' }; return next(); }
    return res.status(401).json({ message: 'Authentication token required' });
  };
  app.use('/api/payments/client-errors', fakeProtect, errorlog.clientErrorRouter());
  app.get('/api/payments/verify-bad', (req, res) => res.status(400).json({ success: false, message: 'Invalid payment signature' }));
  app.get('/api/payments/missing', (req, res) => res.status(404).json({ success: false, message: 'Plan not found' }));
  app.get('/api/other/bad', (req, res) => res.status(400).json({ message: 'bad request elsewhere' }));

  app.use(errorlog.errorHandler({ format: (err, status, rid) => ({ success: false, message: status >= 500 ? 'Internal server error' : err.message, request_id: rid }) }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => upstream.close(r));
  await errorlog.shutdown(500);
});

test.beforeEach(async () => { await errorlog.flush(300); sink.rows.length = 0; sink.auditRows.length = 0; sink.fail = false; });

test('audit log: one row per request with user, API, status and the linked error row', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig';
  assert.equal((await request('GET', '/ok', { headers: { authorization: `Bearer ${jwt}`, 'x-forwarded-for': '10.9.8.7' } })).status, 200);
  assert.equal((await request('GET', '/throw')).status, 500);
  assert.equal((await request('GET', '/user')).status, 500);
  assert.equal((await request('OPTIONS', '/ok')).status < 500, true);
  await rows(2);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && sink.auditRows.length < 3) { await errorlog.flush(300); await new Promise((r) => setTimeout(r, 20)); }
  const byEp = Object.fromEntries(sink.auditRows.map((a) => [a.endpoint, a]));
  assert.deepEqual(Object.keys(byEp).sort(), ['/ok', '/throw', '/user']);
  assert.equal(byEp['/ok'].status, 'SUCCESS');
  assert.equal(byEp['/ok'].status_code, 200);
  assert.equal(byEp['/ok'].user_id, '42');
  assert.equal(byEp['/ok'].user_email, 'adv@example.com');
  assert.equal(byEp['/ok'].ip_address, '10.9.8.7');
  assert.equal(byEp['/ok'].route, '/ok');
  assert.equal(byEp['/ok'].error_log_id, null);
  assert.ok(byEp['/ok'].duration_ms >= 0 && byEp['/ok'].request_id);
  assert.equal(byEp['/ok'].action, 'VIEW');
  assert.ok(byEp['/ok'].method);
  assert.equal(byEp['/throw'].status, 'FAILED');
  assert.equal(byEp['/throw'].status_code, 500);
  const throwRow = sink.rows.find((r) => r.endpoint === '/throw');
  assert.equal(byEp['/throw'].error_log_id, throwRow.id);
  assert.equal(byEp['/throw'].error_type, 'TypeError');
  assert.match(byEp['/throw'].error_message, /boom: sync throw/);
  assert.equal(byEp['/throw'].user_message, 'Internal server error');
  assert.equal(byEp['/ok'].error_type, null);
  assert.equal(byEp['/ok'].error_message, null);
  assert.equal(byEp['/throw'].request_id, throwRow.request_id);
  assert.equal(byEp['/throw'].action, 'VIEW');
  assert.equal(byEp['/user'].user_id, '7'); // req.user set by the route's auth wins
  assert.equal(byEp['/user'].resource_type, 'USER');
  assert.ok(!sink.auditRows.some((a) => a.http_method === 'OPTIONS'));
  assert.match(byEp['/throw'].stack_trace, /errorlog\.test\.js/);
  assert.equal(byEp['/ok'].stack_trace, null);
});

test('errors outside a request and client reports get FAILED audit rows too', async () => {
  errorlog.recordError(new Error('cron job exploded'), { source: 'JOB', endpoint: 'cron:nightly' });
  const r = await request('POST', '/api/payments/client-errors', { headers: { authorization: 'Bearer good' }, body: { kind: 'cancelled', flow: 'token-topup', message: 'Payment cancelled' } });
  assert.equal(r.status, 202);
  await rows(2);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && sink.auditRows.length < 2) { await errorlog.flush(300); await new Promise((res) => setTimeout(res, 20)); }
  const byEp = Object.fromEntries(sink.auditRows.map((a) => [a.endpoint, a]));
  assert.equal(byEp['cron:nightly'].status, 'FAILED');
  assert.match(byEp['cron:nightly'].error_message, /cron job exploded/);
  assert.equal(byEp['cron:nightly'].error_log_id, sink.rows.find((e) => e.endpoint === 'cron:nightly').id);
  assert.equal(byEp['client:token-topup'].status, 'FAILED');
  assert.equal(byEp['client:token-topup'].user_id, '42');
  assert.equal(byEp['client:token-topup'].error_type, 'PaymentCancelled');
  assert.ok(!byEp['/api/payments/client-errors']); // the carrier POST itself is not activity
});

test('unhandled sync throw -> one row with user_message, stack, user from JWT', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig';
  const r = await request('GET', '/throw', { headers: { authorization: `Bearer ${jwt}`, 'x-forwarded-for': '10.1.2.3, 10.0.0.1' } });
  assert.equal(r.status, 500);
  const body = JSON.parse(r.text);
  assert.equal(body.message, 'Internal server error');
  assert.equal(body.request_id, r.headers['x-request-id']);
  assert.match(String(r.headers['access-control-expose-headers'] || ''), /x-request-id/i);
  const out = await rows(1);
  assert.equal(out.length, 1, JSON.stringify(out.map((o) => o.error_type)));
  const ev = out[0];
  assert.equal(ev.error_type, 'TypeError');
  assert.match(ev.error_message, /boom: sync throw/);
  assert.equal(ev.user_message, 'Internal server error');
  assert.match(ev.stack_trace, /errorlog\.test\.js/);
  assert.equal(ev.status_code, 500);
  assert.equal(ev.http_method, 'GET');
  assert.equal(ev.endpoint, '/throw');
  assert.equal(ev.request_id, r.headers['x-request-id']);
  assert.equal(ev.user_id, '42');
  assert.equal(ev.user_email, 'adv@example.com');
  assert.equal(ev.ip_address, '10.1.2.3');
  assert.equal(ev.fingerprint.length, 64);
  assert.match(ev.method, /errorlog\.test/);
});

test('async handler rejection reaches the error handler (Express 4 patch / Express 5 native)', async () => {
  const r = await request('GET', '/async-throw');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].error_type, 'RangeError');
});

test('route that answers 500 itself -> row with the console.error exception', async () => {
  const r = await request('GET', '/self-500');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].user_message, 'we handled it ourselves');
  assert.equal(out[0].error_type, 'SyntaxError');
  assert.equal(out[0].source, 'LOGGER');
});

test('capture-all: recovered error is kept as WARNING, 404s get rows', async () => {
  assert.equal((await request('GET', '/recovered')).status, 200);
  assert.equal((await request('GET', '/not-found-route')).status, 404);
  assert.equal((await request('GET', '/no/such/route')).status, 404);
  const out = await rows(3);
  assert.equal(out.length, 3, JSON.stringify(out.map((o) => o.error_type)));
  assert.equal(out[0].error_type, 'Error');
  assert.equal(out[0].severity, 'WARNING');
  assert.equal(out[0].payload.recovered, true);
  assert.equal(out[0].status_code, 200);
  assert.equal(out[1].error_type, 'HttpErrorResponse404');
  assert.equal(out[1].user_message, 'nope');
  assert.equal(out[2].error_type, 'HttpErrorResponse404');
  assert.equal(out[2].endpoint, '/no/such/route');
});

test('capture-all off keeps only what the user got', async () => {
  const { Recorder } = require('../errorlog/recorder');
  const { RequestContext } = require('../errorlog/context');
  const { Writer } = require('../errorlog/writer');
  const cfg = Object.assign({}, errorlog._state().cfg, { captureAll: false, skipStatus: new Set([400, 401, 403, 404, 409, 422]), store4xxPrefixes: [] });
  const local = new MemorySink();
  const rec = new Recorder(cfg, new Writer(cfg, local));
  const run = (status, external) => {
    const ctx = new RequestContext({ requestId: 'r1', endpoint: '/x', httpMethod: 'GET' });
    const ev = rec.eventFromError(new Error('inner'));
    if (external) ev.source = 'EXTERNAL_API';
    ctx.pending.push(ev); ctx.statusCode = status; ctx.responseStarted = true;
    return rec.flushContext(ctx);
  };
  assert.equal(run(200), 0);
  assert.equal(run(200, true), 0);
  assert.equal(run(404), 0);
  assert.equal(run(500), 1);
  assert.equal(run(502, true), 1);
});

test('gemini exception + 500 -> exactly one merged row with provider fields', async () => {
  const r = await request('GET', '/gemini/raise');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  const ev = out[0];
  assert.equal(ev.source, 'EXTERNAL_API');
  assert.equal(ev.category, 'AI_PROVIDER');
  assert.equal(ev.severity, 'CRITICAL');
  assert.equal(ev.external_provider, 'GEMINI');
  assert.equal(ev.external_model, 'gemini-2.5-flash');
  assert.equal(ev.external_status_code, 429);
  assert.equal(ev.external_error_code, 'RESOURCE_EXHAUSTED');
  assert.equal(ev.external_endpoint, 'genai.models.generateContentInternal');
  assert.equal(ev.status_code, 500);
  assert.equal(ev.user_message, 'AI call failed');
  assert.ok(Number.isInteger(ev.latency_ms));
});

test('gemini failure recovered by the route is kept as WARNING with payload.recovered', async () => {
  assert.equal((await request('GET', '/gemini/raise?fail=0')).status, 200);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].external_provider, 'GEMINI');
  assert.equal(out[0].severity, 'CRITICAL'); // quota errors keep CRITICAL even when recovered
  assert.equal(out[0].payload.recovered, true);
  assert.equal(out[0].status_code, 200);
});

test('gemini safety / empty / max tokens classification', async () => {
  const hook = new gemini.GeminiHook(errorlog._state().recorder, errorlog._state().cfg);
  const t = Date.now();
  hook.inspect({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }], usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 } }, { model: 'm', sdkMethod: 'models.x', started: t });
  hook.inspect({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  ' }] } }] }, { model: 'm', sdkMethod: 'models.x', started: t });
  hook.inspect({ candidates: [] }, { model: 'm', sdkMethod: 'models.x', started: t });
  hook.inspect({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }, { model: 'm', sdkMethod: 'models.x', started: t });
  hook.inspect({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'fine' }] } }] }, { model: 'm', sdkMethod: 'models.x', started: t });
  hook.inspect({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [] }, { model: 'm', sdkMethod: 'models.x', started: t });
  const out = await rows(5);
  assert.deepEqual(out.map((o) => [o.category, o.severity, o.external_error_code]), [
    ['AI_SAFETY_BLOCK', 'WARNING', 'SAFETY'],
    ['AI_EMPTY_RESPONSE', 'ERROR', 'EMPTY_RESPONSE'],
    ['AI_EMPTY_RESPONSE', 'ERROR', 'NO_CANDIDATES'],
    ['AI_EMPTY_RESPONSE', 'WARNING', 'MAX_TOKENS'],
    ['AI_SAFETY_BLOCK', 'WARNING', 'PROHIBITED_CONTENT'],
  ]);
  assert.deepEqual(out[0].payload.tokens, { prompt_token_count: 5, total_token_count: 5 });
  assert.equal(out[0].payload.output_preview, undefined);
});

test('gemini stream failure', async () => {
  const r = await request('GET', '/gemini-stream/stream_raise');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].external_endpoint, 'genai.models.generateContentStreamInternal[stream]');
  assert.equal(out[0].external_status_code, 503);
});

test('gemini retries collapse into one row with attempts', async () => {
  const r = await request('GET', '/gemini-retry');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.attempts, 3);
});

test('citation upstream 500 via http.get -> merged row, query stripped, body not consumed', async () => {
  const r = await request('GET', '/citation/boom');
  assert.equal(r.status, 502);
  const out = await rows(1);
  assert.equal(out.length, 1);
  const ev = out[0];
  assert.equal(ev.source, 'EXTERNAL_API');
  assert.equal(ev.category, 'CITATION_PROVIDER');
  assert.equal(ev.external_provider, 'CITATION');
  assert.equal(ev.external_status_code, 500);
  assert.equal(ev.external_endpoint, `http://127.0.0.1:${upstreamPort}/boom`);
  assert.ok(!JSON.stringify(ev).includes('SECRET-TOKEN'));
  assert.equal(ev.status_code, 502);
  assert.equal(ev.user_message, 'citation provider failed');
  assert.equal(lastUpstreamHeaders['x-request-id'], r.headers['x-request-id']);
});

test('citation timeout -> TIMEOUT row', async () => {
  const r = await request('GET', '/citation/hang');
  assert.equal(r.status, 502);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'TIMEOUT');
  assert.equal(out[0].external_provider, 'CITATION');
});

test('citation failure recovered is kept as WARNING', async () => {
  assert.equal((await request('GET', '/citation/boom?fail=0')).status, 200);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].external_provider, 'CITATION');
  assert.equal(out[0].payload.recovered, true);
});

test('fetch upstream 500 recorded; x-request-id forwarded on fetch', async () => {
  const r = await request('GET', '/fetch-fail');
  assert.equal(r.status, 500);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].external_endpoint, `http://127.0.0.1:${upstreamPort}/boom`);
  const f = await request('GET', '/forward', { headers: { 'x-request-id': 'abc-123' } });
  assert.equal(JSON.parse(f.text).forwarded, 'abc-123');
  assert.equal(f.headers['x-request-id'], 'abc-123');
});

test('error after the response started is kept even though status is 200', async () => {
  const r = await request('GET', '/stream-fail');
  assert.equal(r.status, 200);
  const out = await rows(1);
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.after_response_start, true);
  assert.equal(out[0].payload.streaming, true);
});

test('secrets are masked in messages and stacks', async () => {
  await request('GET', '/secret-leak');
  const ev = (await rows(1))[0];
  assert.ok(!ev.error_message.includes('AIzaSy') && !ev.error_message.includes('hunter2'));
  assert.ok(!ev.stack_trace.includes('hunter2'));
  const p = sanitize.sanitizePayload({ password: 'x', nested: { api_key: 'k', list: Array.from({ length: 50 }, (_, i) => i) }, tokens: { prompt_token_count: 3 }, monkey: 'fine' });
  assert.equal(p.password, '***'); assert.equal(p.nested.api_key, '***'); assert.equal(p.monkey, 'fine');
  assert.deepEqual(p.tokens, { prompt_token_count: 3 });
  assert.equal(p.nested.list.length, 21);
  assert.equal(sanitize.stripQuery('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIza#f'), 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent');
});

test('req.user set by auth middleware wins for attribution', async () => {
  await request('GET', '/user');
  const ev = (await rows(1))[0];
  assert.equal(ev.user_id, '7');
  assert.equal(ev.user_email, 'seven@example.com');
});

test('sink failure never breaks the app and is counted', async () => {
  sink.fail = true;
  const r = await request('GET', '/throw');
  assert.equal(r.status, 500);
  await new Promise((res) => setTimeout(res, 200));
  await errorlog.flush(300);
  assert.ok(errorlog.stats().failed_batches >= 1);
  sink.fail = false;
});

test('ingest sink shape: every column present in toJson (errors and audit)', () => {
  const { toJson, COLUMNS, AUDIT_COLUMNS } = require('../errorlog/writer');
  const ev = errorlog._state().recorder.eventFromError(new Error('x'));
  const j = toJson(ev);
  for (const c of COLUMNS) assert.ok(c in j, c);
  assert.equal(typeof j.created_at, 'string');
  const { RequestContext } = require('../errorlog/context');
  const ctx = new RequestContext({ requestId: 'r', endpoint: '/a', httpMethod: 'GET' });
  ctx.statusCode = 200; ctx.responseStarted = true;
  const a = errorlog._state().recorder.auditRequest(ctx);
  assert.ok(a && a._table === 'audit');
  const aj = toJson(a);
  for (const c of AUDIT_COLUMNS) assert.ok(c in aj, c);
  assert.ok(!('_table' in aj));
});

test('client-reported Razorpay failure and cancel are stored with the user id', async () => {
  const failed = { flow: 'token-topup', kind: 'failed', message: 'Payment failed', plan_id: 7, plan_name: 'Starter', amount: 49900, currency: 'INR',
    razorpay: { error: { code: 'BAD_REQUEST_ERROR', description: 'Payment was unsuccessful', reason: 'payment_failed', step: 'payment_authorization', source: 'customer', metadata: { order_id: 'order_1', payment_id: 'pay_1' } } } };
  const r = await request('POST', '/api/payments/client-errors', { headers: { authorization: 'Bearer good' }, body: failed });
  assert.equal(r.status, 202);
  const body = JSON.parse(r.text);
  assert.ok(body.success && body.request_id);
  const out = await rows(1);
  assert.equal(out.length, 1);
  const ev = out[0];
  assert.equal(ev.user_id, '42');
  assert.equal(ev.user_email, 'adv@example.com');
  assert.equal(ev.error_type, 'PaymentFailed');
  assert.equal(ev.severity, 'ERROR');
  assert.equal(ev.source, 'EXTERNAL_API');
  assert.equal(ev.external_provider, 'RAZORPAY');
  assert.equal(ev.external_error_code, 'BAD_REQUEST_ERROR');
  assert.equal(ev.external_response, 'Payment was unsuccessful');
  assert.equal(ev.user_message, 'Payment failed');
  assert.equal(ev.endpoint, 'client:token-topup');
  assert.equal(ev.payload.order_id, 'order_1');
  assert.equal(ev.payload.payment_id, 'pay_1');
  assert.equal(ev.payload.plan_name, 'Starter');
  assert.equal(ev.payload.reason, 'payment_failed');
  assert.equal(ev.request_id, body.request_id);

  await request('POST', '/api/payments/client-errors', { headers: { authorization: 'Bearer good' }, body: { flow: 'storage-addon', kind: 'cancelled', message: 'Payment cancelled' } });
  const out2 = await rows(2);
  assert.equal(out2.length, 2);
  assert.equal(out2[1].error_type, 'PaymentCancelled');
  assert.equal(out2[1].severity, 'WARNING');
  assert.equal(out2[1].external_error_code, 'USER_CANCELLED');
  assert.equal(out2[1].user_id, '42');

  // unauthenticated: the service's own auth middleware answers 401 before our router;
  // in capture-all mode that 401 is a WARNING row like any other 4xx
  const unauth = await request('POST', '/api/payments/client-errors', { body: { flow: 'x', kind: 'failed' } });
  assert.equal(unauth.status, 401);
  const all = await rows(3);
  assert.equal(all.length, 3);
  assert.equal(all[2].error_type, 'HttpErrorResponse401');
  assert.equal(all[2].severity, 'WARNING');
});

test('client-reported browser errors: unhandled exception with stack, network failure', async () => {
  const r = await request('POST', '/api/payments/client-errors', { headers: { authorization: 'Bearer good' }, body: {
    kind: 'unhandled', flow: 'chat', message: 'Cannot read properties of undefined', page: '/chat/123',
    error: { name: 'TypeError', message: "Cannot read properties of undefined (reading 'map')", stack: 'TypeError: x\n    at ChatPanel (chat.jsx:10:5)' },
  } });
  assert.equal(r.status, 202);
  const n = await request('POST', '/api/payments/client-errors', { headers: { authorization: 'Bearer good' }, body: {
    kind: 'network', flow: 'fetch', url: `http://127.0.0.1:${upstreamPort}/search?token=SECRET`, error: { name: 'TypeError', message: 'Failed to fetch' },
  } });
  assert.equal(n.status, 202);
  const out = await rows(2);
  assert.equal(out.length, 2);
  assert.equal(out[0].error_type, 'TypeError');
  assert.equal(out[0].source, 'HTTP');
  assert.equal(out[0].user_id, '42');
  assert.equal(out[0].endpoint, 'client:chat');
  assert.match(out[0].stack_trace, /ChatPanel/);
  assert.equal(out[0].payload.page, '/chat/123');
  assert.equal(out[1].source, 'EXTERNAL_API');
  assert.equal(out[1].external_provider, 'CITATION');
  assert.equal(out[1].external_endpoint, `http://127.0.0.1:${upstreamPort}/search`);
  assert.ok(!JSON.stringify(out[1]).includes('SECRET'));
});

test('4xx answers get WARNING rows with the exact user message', async () => {
  assert.equal((await request('GET', '/api/payments/verify-bad')).status, 400);
  assert.equal((await request('GET', '/api/payments/missing')).status, 404);
  assert.equal((await request('GET', '/api/other/bad')).status, 400);
  const out = await rows(3);
  assert.equal(out.length, 3, JSON.stringify(out.map((o) => [o.endpoint, o.status_code])));
  assert.deepEqual(out.map((o) => [o.error_type, o.severity, o.user_message]), [
    ['HttpErrorResponse400', 'WARNING', 'Invalid payment signature'],
    ['HttpErrorResponse404', 'WARNING', 'Plan not found'],
    ['HttpErrorResponse400', 'WARNING', 'bad request elsewhere'],
  ]);
  assert.equal(out[0].endpoint, '/api/payments/verify-bad');
});

test('http ingest posts to /internal/error-logs not /audit', () => {
  const { ingestEndpoints } = require('../errorlog/writer');
  const { normalizeIngestUrl } = require('../errorlog/config');
  const a = ingestEndpoints('http://127.0.0.1:8092');
  assert.equal(a.url, 'http://127.0.0.1:8092/internal/error-logs');
  assert.equal(a.auditUrl, 'http://127.0.0.1:8092/internal/audit-logs');
  const b = ingestEndpoints('http://127.0.0.1:8092/api/files');
  assert.equal(b.url, 'http://127.0.0.1:8092/internal/error-logs');
  assert.equal(b.auditUrl, 'http://127.0.0.1:8092/internal/audit-logs');
  assert.equal(normalizeIngestUrl('http://localhost:8092/internal/audit-logs'), 'http://localhost:8092/internal/error-logs');
});

test('express version detected', () => {
  const hooks = errorlog.stats().hooks;
  assert.ok(Array.isArray(hooks.asyncErrors));
  assert.ok(hooks.http.includes('http.request') && hooks.http.includes('globalThis.fetch'));
  assert.ok(expressMajor === 4 || expressMajor === 5);
});
