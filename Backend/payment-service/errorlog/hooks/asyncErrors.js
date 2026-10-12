'use strict';
/**
 * Express 4 does not forward rejected promises from async handlers to the
 * error middleware; the request hangs. This patches the router Layer once so a
 * rejected handler calls next(err), the same thing `express-async-errors` does.
 * Express 5 handles this natively and is left alone.
 */
const { resolveFrom } = require('../resolve');

function install(cfg) {
  let version = null;
  try { version = resolveFrom(cfg.root, 'express/package.json').version; } catch (_) { return null; }
  const major = parseInt(String(version).split('.')[0], 10);
  if (major !== 4) return `express@${version} (native async errors)`;
  let Layer;
  try { Layer = resolveFrom(cfg.root, 'express/lib/router/layer'); } catch (_) { return null; }
  if (Layer.__errorlogPatched) return `express@${version} layer already patched`;

  Layer.prototype.handle_request = function handle_request(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
    return undefined;
  };
  Layer.prototype.handle_error = function handle_error(error, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(error);
    try {
      const out = fn(error, req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
    return undefined;
  };
  Layer.__errorlogPatched = true;
  return `express@${version} layer patched`;
}

module.exports = { install };
