const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_FILE = path.join(
  __dirname, '..', 'models', 'migrations', 'create_newsletter_subscribers_table.sql'
);

/**
 * Newsletter-subscriber schema — idempotent, run at startup (same pattern as
 * contactEnquiryDb). Creates `newsletter_subscribers` in Auth_DB.
 */
async function initializeNewsletterSubscriberSchema() {
  try {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    await pool.query(sql);
    console.log('[Newsletter] schema ensured');
  } catch (error) {
    console.error('[Newsletter] schema init failed:', error.message);
  }
}

module.exports = { initializeNewsletterSubscriberSchema };

if (require.main === module) {
  initializeNewsletterSubscriberSchema()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
