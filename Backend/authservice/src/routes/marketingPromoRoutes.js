const router = require('express').Router();
const { getHeaderPromos } = require('../controllers/marketingPromoController');

// Public. Reads active header promotions and slots; never exposes bookings.
router.get('/header', getHeaderPromos);
module.exports = router;
