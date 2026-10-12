/**
 * Sales Referrals — public code status check (no auth, rate-limited).
 *
 * GET /api/public/referrals/:code/status
 *   → 200 { code, status: INVALID_FORMAT | NOT_FOUND | INACTIVE | ACTIVE, owner?: { name } }
 *   Always 200. Never returns owner id, label, internal flag or notes.
 *
 * GET /api/auth/referral-codes/:code/status   (earlier alias kept for the existing frontend)
 *   → 200 { status: VALID | INVALID | INACTIVE }
 */
const referralService = require('../services/referralCodes.service');

const getPublicReferralStatus = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await referralService.getPublicStatus(req.params.code);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Referral] public status check failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getReferralCodeStatus = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const status = await referralService.getCodeStatus(req.params.code);
    return res.status(200).json({ status });
  } catch (error) {
    console.error('[Referral] status check failed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { getPublicReferralStatus, getReferralCodeStatus };
