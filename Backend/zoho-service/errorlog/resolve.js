'use strict';
/** Resolve an optional dependency from the service that vendors this module. */
function resolveFrom(root, name) {
  try {
    return require(require.resolve(name, { paths: [root, __dirname] }));
  } catch (_) {
    return require(name); // NODE_PATH / global fallback
  }
}

module.exports = { resolveFrom };
