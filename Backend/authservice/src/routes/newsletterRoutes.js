const express = require('express');
const router = express.Router();
const { subscribeNewsletter } = require('../controllers/newsletterController');

// Public — landing page newsletter form. No auth, no token.
// Mounted at /api/auth/newsletter-subscribers (see index.js).
router.post('/', subscribeNewsletter);

module.exports = router;
