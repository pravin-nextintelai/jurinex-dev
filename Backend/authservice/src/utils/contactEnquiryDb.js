const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_FILE = path.join(
  __dirname, '..', 'models', 'migrations', 'create_contact_enquiries_tables.sql'
);

/**
 * Contact-enquiry schema — idempotent, run at startup (same pattern as
 * deviceSessionDb / userActivityDb). Creates `contact_enquiries` and
 * `contact_enquiry_activities` for the website "Contact us" form and the
 * marketing-admin follow-up workflow.
 */
async function initializeContactEnquirySchema() {
  try {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    await pool.query(sql);
    console.log('[ContactEnquiries] schema ensured');
  } catch (error) {
    console.error('[ContactEnquiries] schema init failed:', error.message);
  }
}

module.exports = { initializeContactEnquirySchema };

if (require.main === module) {
  initializeContactEnquirySchema()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
