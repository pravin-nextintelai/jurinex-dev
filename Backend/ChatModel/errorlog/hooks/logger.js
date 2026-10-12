'use strict';
/** console.error wrapper and a winston Console-transport patch: error-level logs that carry an Error. */
const { isInternal } = require('../context');
const { SOURCE } = require('../classify');
const { truncate } = require('../sanitize');

function firstString(args) {
  for (const a of args) if (typeof a === 'string') return truncate(a, 500);
  return undefined;
}

function install(recorder, cfg) {
  const patched = [];
  if (!console.error.__errorlogWrapped) {
    const orig = console.error;
    const wrapped = function errorlogConsoleError(...args) {
      try {
        if (!isInternal()) {
          const err = args.find((a) => a instanceof Error);
          if (err) recorder.recordError(err, { source: SOURCE.LOGGER, message: firstString(args), payload: { logger: 'console.error' } });
        }
      } catch (_) { /* never throw */ }
      return orig.apply(this, args);
    };
    wrapped.__errorlogWrapped = true;
    console.error = wrapped;
    patched.push('console.error');
  }
  try {
    const winston = require('../resolve').resolveFrom(cfg.root, 'winston');
    const Console = winston.transports && winston.transports.Console;
    if (Console && Console.prototype && !Console.prototype.log.__errorlogWrapped) {
      const origLog = Console.prototype.log;
      const LEVEL = Symbol.for('level');
      const wrappedLog = function errorlogWinstonLog(info, cb) {
        try {
          const level = info && (info[LEVEL] || info.level);
          if (level === 'error' && !isInternal()) {
            let err = null;
            if (info instanceof Error) err = info;
            else if (info && info.error instanceof Error) err = info.error;
            else if (info && typeof info.stack === 'string') { err = new Error(typeof info.message === 'string' ? info.message : 'error'); err.stack = info.stack; err.name = info.name || 'Error'; }
            if (err) recorder.recordError(err, { source: SOURCE.LOGGER, message: typeof info.message === 'string' ? truncate(info.message, 500) : undefined, payload: { logger: 'winston' } });
          }
        } catch (_) { /* never throw */ }
        return origLog.call(this, info, cb);
      };
      wrappedLog.__errorlogWrapped = true;
      Console.prototype.log = wrappedLog;
      patched.push('winston.transports.Console.log');
    }
  } catch (_) { /* winston not installed */ }
  return patched;
}

module.exports = { install };
