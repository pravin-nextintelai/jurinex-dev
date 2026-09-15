const pool = require('../config/db');

/**
 * contact_enquiries — website "Contact us" submissions.
 *
 * Reference numbers are `CE-YYYYMMDD-NNNNN` where the date is the IST calendar
 * day of submission and NNNNN restarts at 00001 each day. The per-day counter
 * is derived inside a transaction under an advisory lock, so concurrent
 * submissions can never collide (the UNIQUE constraint is the last line of
 * defence, not the strategy).
 */
const REFERENCE_PREFIX = 'CE';
const REFERENCE_PATTERN = '^CE-\\d{8}-\\d+$';

async function nextReferenceNo(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('contact_enquiries.reference_no'))");
  const { rows: [{ ist_date }] } = await client.query(
    "SELECT to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') AS ist_date"
  );
  const prefix = `${REFERENCE_PREFIX}-${ist_date}-`;
  const { rows: [{ next_seq }] } = await client.query(
    `SELECT COALESCE(MAX(regexp_replace(reference_no, '^.*-', '')::int), 0) + 1 AS next_seq
       FROM contact_enquiries
      WHERE reference_no LIKE $1
        AND reference_no ~ $2`,
    [`${prefix}%`, REFERENCE_PATTERN]
  );
  return `${prefix}${String(next_seq).padStart(5, '0')}`;
}

/**
 * Insert the enquiry and its "submitted" timeline entry atomically.
 * @returns the inserted contact_enquiries row
 */
async function create(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const referenceNo = await nextReferenceNo(client);

    const { rows: [enquiry] } = await client.query(
      `INSERT INTO contact_enquiries (
         reference_no, first_name, last_name, email, mobile_number,
         organisation_name, topic, message, marketing_consent, consent_given_at,
         source, page_url, ip_address, user_agent,
         status, priority, status_changed_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, CASE WHEN $9::boolean THEN NOW() ELSE NULL END,
         $10, $11, $12, $13,
         'new', 'normal', NOW()
       )
       RETURNING *`,
      [
        referenceNo,
        data.first_name,
        data.last_name,
        data.email,
        data.mobile_number,
        data.organisation_name,
        data.topic,
        data.message,
        data.marketing_consent,
        data.source,
        data.page_url,
        data.ip_address,
        data.user_agent,
      ]
    );

    await client.query(
      `INSERT INTO contact_enquiry_activities (
         enquiry_id, activity_type, to_value, note, occurred_at, actor_email, actor_role
       ) VALUES ($1, 'submitted', 'new', $2, $3, $4, 'visitor')`,
      [
        enquiry.id,
        `Enquiry submitted via ${data.source}` +
          (data.topic ? ` (topic: ${data.topic})` : '') +
          (data.marketing_consent ? ' — marketing consent given' : ''),
        enquiry.created_at,
        enquiry.email,
      ]
    );

    await client.query('COMMIT');
    return enquiry;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Double-submit guard: the same person sending the same message again within
 * `windowMinutes` (double-click, browser retry) returns the original enquiry
 * instead of creating a second lead for the marketing team to chase.
 */
async function findRecentDuplicate({ email, mobile_number, message }, windowMinutes) {
  const { rows } = await pool.query(
    `SELECT *
       FROM contact_enquiries
      WHERE LOWER(email) = LOWER($1)
        AND mobile_number = $2
        AND COALESCE(message, '') = COALESCE($3, '')
        AND created_at > NOW() - make_interval(mins => $4::int)
      ORDER BY created_at DESC
      LIMIT 1`,
    [email, mobile_number, message, windowMinutes]
  );
  return rows[0] || null;
}

module.exports = { create, findRecentDuplicate, REFERENCE_PREFIX };
