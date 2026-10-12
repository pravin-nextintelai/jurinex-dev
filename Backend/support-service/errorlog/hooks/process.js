'use strict';
/**
 * Process-level hooks: unhandledRejection, uncaughtException (record, flush,
 * keep the default exit behaviour when nobody else handles them), a
 * process.exit wrapper that waits up to 1.5 s for the queue, SIGTERM/SIGINT
 * flushing, and a node-cron wrapper for scheduled jobs.
 */
const { SOURCE } = require('../classify');

function install(recorder, cfg, writer) {
  const patched = [];
  const realExit = process.exit.bind(process);
  let exiting = false;

  function flushThenExit(code) {
    if (exiting) return;
    exiting = true;
    const t = setTimeout(() => realExit(code), 1500);
    if (t.unref) t.unref();
    Promise.resolve(writer.flush(1400)).catch(() => {}).then(() => realExit(code));
  }

  if (!process.exit.__errorlogWrapped) {
    const wrappedExit = function errorlogExit(code) {
      if (!exiting && writer.hasPending()) { flushThenExit(code === undefined ? process.exitCode || 0 : code); return undefined; }
      return realExit(code);
    };
    wrappedExit.__errorlogWrapped = true;
    process.exit = wrappedExit;
    patched.push('process.exit');
  }

  const onUncaught = (err, origin) => {
    try { recorder.recordError(err, { source: SOURCE.PROCESS, endpoint: `process:${origin || 'uncaughtException'}` }); } catch (_) { /* ignore */ }
    // Only our listener? Node would have crashed: keep that behaviour, after flushing.
    if (process.listenerCount('uncaughtException') <= 1) {
      try { process.stderr.write(`[errorlog] uncaught exception, exiting: ${err && err.stack ? err.stack : err}\n`); } catch (_) { /* ignore */ }
      flushThenExit(1);
    } else {
      writer.flush(1400).catch(() => {});
    }
  };
  const onUnhandled = (reason) => {
    try { recorder.recordError(reason instanceof Error ? reason : new Error(String(reason)), { source: SOURCE.PROCESS, endpoint: 'process:unhandledRejection' }); } catch (_) { /* ignore */ }
    if (process.listenerCount('unhandledRejection') <= 1) {
      try { process.stderr.write(`[errorlog] unhandled rejection, exiting: ${reason && reason.stack ? reason.stack : reason}\n`); } catch (_) { /* ignore */ }
      flushThenExit(1);
    } else {
      writer.flush(1400).catch(() => {});
    }
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  patched.push('process.uncaughtException', 'process.unhandledRejection');

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      if (process.listenerCount(sig) <= 1) flushThenExit(sig === 'SIGINT' ? 130 : 143);
      else writer.flush(1400).catch(() => {});
    });
  }
  patched.push('process.SIGTERM', 'process.SIGINT');

  try {
    const cron = require('../resolve').resolveFrom(cfg.root, 'node-cron');
    if (cron && typeof cron.schedule === 'function' && !cron.schedule.__errorlogWrapped) {
      const origSchedule = cron.schedule;
      const schedule = function errorlogCronSchedule(expr, fn, opts) {
        const name = (opts && opts.name) || String(expr);
        const wrapped = typeof fn === 'function' ? async function errorlogCronJob(...args) {
          try { return await fn.apply(this, args); } catch (err) {
            recorder.recordError(err, { source: SOURCE.JOB, endpoint: `cron:${name}` });
            throw err;
          }
        } : fn;
        return origSchedule.call(this, expr, wrapped, opts);
      };
      schedule.__errorlogWrapped = true;
      cron.schedule = schedule;
      patched.push('node-cron.schedule');
    }
  } catch (_) { /* node-cron not installed */ }

  return patched;
}

module.exports = { install };
