const pool = require('../config/db');

/**
 * Insert a newsletter subscriber. Email is unique (lowercased).
 * If the email is already on the list, returns the existing row with
 * `already_subscribed: true` instead of creating a duplicate.
 */
async function create(data) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO newsletter_subscribers (
       email, ip_address, browser, os, device_type, user_agent, source, page_url
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [
      data.email,
      data.ip_address,
      data.browser,
      data.os,
      data.device_type,
      data.user_agent,
      data.source,
      data.page_url,
    ]
  );
  if (row) return { ...row, already_subscribed: false };

  const { rows: [existing] } = await pool.query(
    `SELECT * FROM newsletter_subscribers WHERE email = $1 LIMIT 1`,
    [data.email]
  );
  return existing ? { ...existing, already_subscribed: true } : null;
}

module.exports = { create };
