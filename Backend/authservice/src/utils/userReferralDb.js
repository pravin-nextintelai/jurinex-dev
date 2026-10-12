const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_FILE = path.join(
  __dirname, '..', 'models', 'migrations', 'create_user_referrals_table.sql'
);

/**
 * user_referrals schema — idempotent, run at startup (same pattern as
 * newsletterSubscriberDb). Holds referral attribution for SOLO signups, which
 * have no firm and therefore no row in the admin-owned tenant_referrals table.
 */
async function initializeUserReferralSchema() {
  try {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    await pool.query(sql);
    console.log('[Referral] user_referrals schema ensured');
  } catch (error) {
    console.error('[Referral] user_referrals schema init failed:', error.message);
  }
}

module.exports = { initializeUserReferralSchema };

if (require.main === module) {
  initializeUserReferralSchema()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
