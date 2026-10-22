const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/paymentController');

// Razorpay signs the RAW request body. This router is mounted in index.js BEFORE express.json(),
// and express.raw() here keeps req.body a Buffer even if the router is reused elsewhere.
// Configure in the Razorpay dashboard:  <payment-service public URL>/api/payments/webhooks/razorpay
router.post('/razorpay', express.raw({ type: () => true, limit: '1mb' }), handleWebhook);

module.exports = router;
