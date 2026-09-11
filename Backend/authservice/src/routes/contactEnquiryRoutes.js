const express = require('express');
const router = express.Router();
const { submitContactEnquiry } = require('../controllers/contactEnquiryController');

// Public — landing page "Contact Jurinex" form. No auth, no token.
// Mounted at /api/auth/contact-enquiries (see index.js).
router.post('/', submitContactEnquiry);

module.exports = router;
