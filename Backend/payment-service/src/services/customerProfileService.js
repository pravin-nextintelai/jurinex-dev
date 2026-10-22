'use strict';
/**
 * Trusted, server-side customer details for a purchase (name, email, state) read from the auth
 * database. Best effort: every function resolves to nulls when AUTH_DATABASE_URL is missing or
 * the query fails, so a payment is never blocked by a profile lookup.
 */
const { Pool } = require('pg');

let authPool = null;
function getAuthPool() {
  const url = process.env.AUTH_DATABASE_URL || process.env.AUTH_DB_URL || null;
  if (!url) return null;
  if (!authPool) {
    authPool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000 });
    authPool.on('error', (err) => console.warn('[customerProfile] auth pool error:', err.message));
  }
  return authPool;
}

const PROFILE_SQL = `
  SELECT u.id, u.username, u.email, u.phone, u.location, u.account_type, u.is_blocked, u.is_active,
         u.approval_status, u.role,
         f.id AS firm_id, f.firm_name, f.state AS firm_state, f.gst_number AS firm_gst_number,
         f.city AS firm_city, f.pin_code AS firm_pin_code
    FROM users u
    LEFT JOIN LATERAL (
      SELECT fm.id, fm.firm_name, fm.state, fm.gst_number, fm.city, fm.pin_code
        FROM firms fm
       WHERE fm.admin_user_id = u.id
          OR fm.id IN (SELECT fu.firm_id FROM firm_users fu WHERE fu.user_id = u.id)
       ORDER BY (fm.admin_user_id = u.id) DESC, fm.created_at ASC
       LIMIT 1
    ) f ON TRUE
   WHERE u.id = $1
   LIMIT 1`;

/**
 * @returns {Promise<{id:number|null,name:string|null,email:string|null,phone:string|null,
 *   state:string|null,stateSource:string|null,firmName:string|null,gstNumber:string|null,
 *   userStatus:string|null,accountType:string|null}>}
 */
async function getCustomerProfile(userId, { pool = getAuthPool() } = {}) {
  const empty = {
    id: userId ?? null, name: null, email: null, phone: null, state: null, stateSource: null,
    firmName: null, gstNumber: null, userStatus: null, accountType: null,
  };
  if (!pool || !userId) return empty;
  try {
    const r = await pool.query(PROFILE_SQL, [Number(userId)]);
    const row = r.rows[0];
    if (!row) return empty;
    const state = row.firm_state || row.location || null;
    return {
      id: row.id,
      name: row.username || null,
      email: row.email || null,
      phone: row.phone || null,
      state,
      stateSource: row.firm_state ? 'firms.state' : (row.location ? 'users.location' : null),
      firmName: row.firm_name || null,
      gstNumber: row.firm_gst_number || null,
      userStatus: row.is_blocked ? 'blocked' : (row.is_active === false ? 'inactive' : (row.approval_status || 'active')),
      accountType: row.account_type || null,
    };
  } catch (err) {
    console.warn(`[customerProfile] lookup failed for user ${userId}:`, err.message);
    return empty;
  }
}

async function closeAuthPool() {
  if (authPool) {
    const p = authPool;
    authPool = null;
    await p.end().catch(() => {});
  }
}

module.exports = { getCustomerProfile, closeAuthPool };
