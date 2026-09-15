const MarketingPromo = require('../models/MarketingPromo');

async function getHeaderPromos(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const promos = await MarketingPromo.getHeaderPromos();
    return res.json({ success: true, promos });
  } catch (error) {
    console.error('[MarketingPromo] header fetch failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load promotions right now.' });
  }
}

module.exports = { getHeaderPromos };
