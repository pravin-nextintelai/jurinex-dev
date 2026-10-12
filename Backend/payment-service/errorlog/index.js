'use strict';
/**
 * Central error capture for JuriNex Node services.
 *
 *   const errorlog = require('./errorlog');
 *   const app = express();
 *   errorlog.install(app, { serviceName: 'payment-service', root: __dirname });
 *   ... routes ...
 *   app.use(errorlog.errorHandler({ passThrough: true })); // just before the existing error handler
 *   app.use((err, req, res, next) => { ... existing ... });
 *
 * Services with no error handler of their own use `errorlog.errorHandler()`
 * last; it answers with the existing format via `format` and never a stack.
 *
 * Rows are written to ERROR_LOG_DATABASE_URL (pg, separate pool of 2) or POSTed
 * to ERROR_LOG_INGEST_URL with X-Internal-Key. See docs/error-logging.md.
 */
const config = require('./config');
const context = require('./context');
const { Recorder } = require('./recorder');
const { Writer } = require('./writer');

let state = null;

function warn(msg) { try { process.stderr.write(`[errorlog] ${msg}\n`); } catch (_) { /* ignore */ } }

function install(app, opts = {}) {
  if (!state) {
    const cfg = config.load({ serviceName: opts.serviceName, root: opts.root });
    const httpHook = require('./hooks/http');
    const hooks = {};
    const writer = new Writer(cfg, opts.sink, httpHook.originals);
    const recorder = new Recorder(cfg, writer);
    state = { cfg, writer, recorder, hooks, apps: new Set(), httpHook };
    if (!cfg.enabled) {
      warn('disabled by ERROR_LOG_ENABLED');
    } else {
      const steps = [
        ['http', () => httpHook.install(recorder, cfg)],
        ['gemini', () => require('./hooks/gemini').install(recorder, cfg)],
        ['logger', () => require('./hooks/logger').install(recorder, cfg)],
        ['process', () => require('./hooks/process').install(recorder, cfg, writer)],
        ['asyncErrors', () => { const r = require('./hooks/asyncErrors').install(cfg); return r ? [r] : []; }],
      ];
      for (const [name, fn] of steps) { try { hooks[name] = fn() || []; } catch (e) { hooks[name] = []; warn(`${name} hook failed: ${e.message}`); } }
      writer.start();
    }
  }
  const { cfg, recorder, hooks } = state;
  if (app && cfg.enabled && !state.apps.has(app)) {
    state.apps.add(app);
    const express = require('./hooks/express');
    app.use(express.requestMiddleware(recorder, cfg));
    hooks.express = (hooks.express || []).concat(['requestMiddleware']);
  }
  const sink = state.writer.sink ? state.writer.sink.name : 'none';
  if (cfg.enabled) warn(`installed for ${cfg.serviceName} (${cfg.environment}) sink=${sink} hooks=${JSON.stringify(Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, v.length])))}`);
  return api;
}

function ensure() {
  if (!state) throw new Error('errorlog.install(app, opts) must be called first');
  return state;
}

function errorHandler(opts = {}) {
  const { recorder, cfg } = ensure();
  return require('./hooks/express').errorHandler(recorder, cfg, opts);
}

/** Router for browser-reported failures (cancelled / failed checkouts). Mount behind the service's auth middleware. */
function clientErrorRouter(opts = {}) {
  const { recorder, cfg } = ensure();
  return require('./hooks/clientReport').clientErrorRouter(recorder, cfg, opts);
}

const api = {
  install,
  errorHandler,
  clientErrorRouter,
  recordError: (err, opts) => (state ? state.recorder.recordError(err, opts) : null),
  record: (fields) => (state ? state.recorder.record(state.recorder.base(fields)) : null),
  flush: (ms) => (state ? state.writer.flush(ms) : Promise.resolve(true)),
  shutdown: (ms) => (state ? state.writer.shutdown(ms) : Promise.resolve()),
  stats: () => (state ? Object.assign({ service_name: state.cfg.serviceName, environment: state.cfg.environment, enabled: state.cfg.enabled, recorded_total: state.recorder.recordedTotal, hooks: state.hooks }, state.writer.stats()) : { enabled: false }),
  setUser: context.setUser,
  attach: context.attach,
  getRequestId: () => { const c = context.getContext(); return c ? c.requestId : null; },
  getContext: context.getContext,
  _state: () => state,
  _reset: () => { state = null; },
};

module.exports = api;
