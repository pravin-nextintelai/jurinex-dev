const express = require('express');
const {
  createOneTimeOrder,
  verifyOneTimePayment,
  startSubscription,
  verifySubscription,
  testPlans,
  testRazorpayConnection,
  getUserPaymentHistory,
  checkAndDeductTokens,
  checkAndReserveTokensApi,
  commitTokensApi,
  rollbackTokensApi
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { checkTokenUsage } = require('../middleware/tokenAuth');
const { getAllPlans } = require('../controllers/userplanController');
const { getMonthlyPlans, startMonthlySubscription, verifyMonthlySubscription } = require('../controllers/monthlyPlansController');
const { getTopupPlans, createTopupOrder, verifyTopupPayment, deductTopupTokens, getTopupHistory } = require('../controllers/topupController');
const { getTokenQuotaStatus } = require('../controllers/tokenCheckController');
const { getStorageAddonPlans, createStorageAddonOrder, verifyStorageAddonPayment, getStorageAddonHistory } = require('../controllers/storageAddonController');
const router = express.Router();

router.use((req, res, next) => {
  console.log(`🔔 Payment route: ${req.method} ${req.originalUrl}`);
  if (req.originalUrl.includes('/topup/order/verify')) {
    console.log('[topup/verify] user:', req.user?.id, 'order:', req.body?.razorpay_order_id);
  }
  next();
});

router.route('/plans')
    .get(getAllPlans);

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: "Payments test route works",
    timestamp: new Date().toISOString(),
    env_check: {
      razorpay_key_configured: !!process.env.RAZORPAY_KEY_ID,
      razorpay_secret_configured: !!process.env.RAZORPAY_SECRET,
      node_env: process.env.NODE_ENV
    }
  });
});

router.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: "✅ Payment route is working",
    razorpay_configured: !!process.env.RAZORPAY_KEY_ID,
    timestamp: new Date().toISOString()
  });
});

router.get('/test-config', protect, testPlans); // DB + Razorpay plan sync check
router.get('/test-razorpay-connection', testRazorpayConnection); // Razorpay API check

router.post('/subscription/start', protect, startSubscription);
router.post('/subscription/verify', protect, verifySubscription);
router.post('/order/create', protect, createOneTimeOrder);
router.post('/order/verify', protect, verifyOneTimePayment);

router.get('/history', protect, getUserPaymentHistory);


router.post('/token-usage', protect, checkTokenUsage, checkAndDeductTokens);

router.post('/token/check-reserve', protect, checkAndReserveTokensApi);
router.post('/token/commit', protect, commitTokensApi);
router.post('/token/rollback', protect, rollbackTokensApi);

// ── Monthly Plans (new subscription flow with daily_token_limit) ──────────────
router.get('/monthly-plans', getMonthlyPlans);
router.post('/monthly-plans/subscribe/start', protect, startMonthlySubscription);
router.post('/monthly-plans/subscribe/verify', protect, verifyMonthlySubscription);

// ── Token Top-Up (one-time purchase when daily limit is exhausted) ─────────────
router.get('/topup-plans', getTopupPlans);
router.get('/daily-token-status', protect, getTokenQuotaStatus);
router.get('/token-quota-status', protect, getTokenQuotaStatus);
router.get('/topup/history', protect, getTopupHistory);
router.post('/topup/order/create', protect, createTopupOrder);
router.post('/topup/order/verify', protect, verifyTopupPayment);
router.post('/topup/deduct', protect, deductTopupTokens);

// ── Storage Add-On (purchase extra storage beyond plan limit) ─────────────────
router.get('/storage-addon/plans',         getStorageAddonPlans);
router.get('/storage-addon/history',       protect, getStorageAddonHistory);
router.post('/storage-addon/order/create', protect, createStorageAddonOrder);
router.post('/storage-addon/order/verify', protect, verifyStorageAddonPayment);

module.exports = router;
