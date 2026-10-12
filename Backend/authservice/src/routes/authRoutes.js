const express = require('express');
const router = express.Router();
const { protect, softProtect } = require('../middleware/auth');

const { register, registerSoloLawyer, registerFirm, login, verifyOtpAndLogin, updateProfile, deleteAccount, logout, fetchProfile, getUserById, updateRazorpayCustomerId , firebaseGoogleSignIn, getUserInfo, getProfessionalProfile, updateProfessionalProfile, changePassword, setPassword, getAllActiveUsers, getAllUsers, createFirmStaff, getFirmStaff, getFirmInfo, pingActivity } = require('../controllers/authController');
const googleDriveRoutes = require('./googleDriveRoutes');
const { getReferralCodeStatus, getPublicReferralStatus } = require('../controllers/referralController');
const { referralStatusRateLimit } = require('../middleware/referralRateLimit');

// Sales Referrals (public): is this referral code valid? Rate-limited per IP, this route only.
router.get('/referral-codes/:code/status', referralStatusRateLimit, getReferralCodeStatus);
// Same check, mounted at /api/auth/public/referrals/:code/status as well (see index.js for /api/public/...)
router.get('/public/referrals/:code/status', referralStatusRateLimit, getPublicReferralStatus);

// Registration routes
router.post('/register', register); // Legacy endpoint
router.post('/register/solo', registerSoloLawyer);
router.post('/register/firm', registerFirm);

router.post('/login', login);

router.post('/verify-otp', verifyOtpAndLogin);



router.put('/update', protect, updateProfile);

router.delete('/delete', protect, deleteAccount);

router.post('/logout', protect, logout);

router.get('/profile', protect, fetchProfile);

router.get('/user-info', protect, getUserInfo);

router.get('/professional-profile', protect, getProfessionalProfile);
router.put('/professional-profile', protect, updateProfessionalProfile);

router.get('/users', protect, getAllUsers);
router.get('/users/active', protect, getAllActiveUsers);
router.get('/users/:userId', protect, getUserById);

router.put('/users/:id/razorpay-customer-id', protect, updateRazorpayCustomerId);

router.post('/google', firebaseGoogleSignIn);


router.put('/change-password', protect, changePassword);
router.post('/set-password', setPassword); // Public endpoint for first-time password setup
router.post('/activity/ping', softProtect, pingActivity);

// Device sessions — Settings → "Active sessions"
const { getActiveSessions, revokeSession, revokeSessions, revokeAllOtherSessions } = require('../controllers/sessionController');
router.get('/sessions', protect, getActiveSessions);
router.post('/sessions/revoke', protect, revokeSessions);          // selected devices
router.post('/sessions/revoke-all', protect, revokeAllOtherSessions); // all except current
router.delete('/sessions/:id', protect, revokeSession);

// Firm admin routes
router.post('/firm/staff', protect, createFirmStaff);
router.get('/firm/staff', protect, getFirmStaff);
router.get('/firm/info', protect, getFirmInfo);

// Google Drive OAuth routes
router.use('/', googleDriveRoutes);

// Public: list all professional roles for registration dropdowns
router.get('/roles', async (req, res) => {
  try {
    const pool = require('../config/db');
    const result = await pool.query('SELECT id, name FROM roles ORDER BY name ASC');
    res.json({ roles: result.rows });
  } catch (error) {
    console.error('[AuthRoutes] Error fetching roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
