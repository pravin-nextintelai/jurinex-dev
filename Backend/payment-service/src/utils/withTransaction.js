'use strict';
/**
 * Run `fn(client)` inside a real PostgreSQL transaction on a dedicated pooled client.
 *
 * The previous code issued BEGIN / COMMIT through `pool.query`, which can land on different
 * connections, so no statements were actually transactional. Always use this helper for
 * multi-statement payment writes.
 */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  let finished = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    finished = true;
    return result;
  } catch (err) {
    if (!finished) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be broken */ }
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
