/**
 * Rate limit for the public referral-code status check only:
 * 30 requests per IP per 60 seconds, in-memory store (per process), no Redis.
 * `app.set('trust proxy', true)` is set in index.js, so req.ip is the real client IP
 * behind the gateway / load balancer.
 */
const expressRateLimit = require('express-rate-limit');

const rateLimit = expressRateLimit.rateLimit || expressRateLimit;
// ipKeyGenerator (IPv6 subnet grouping) exists only in newer 7.x releases; fall back to the raw IP.
const ipKey = typeof expressRateLimit.ipKeyGenerator === 'function' ? expressRateLimit.ipKeyGenerator : (ip) => ip;
const { formatIST } = require('../utils/istTime');

const WINDOW_MS = 60 * 1000;
const LIMIT = 30;

function timestamp() {
  try {
    return formatIST(new Date());
  } catch (_) {
    return new Date().toISOString();
  }
}

const referralStatusRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'),
  handler: (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(429).json({
      errorCode: 'RATE_LIMITED',
      message: 'Too many attempts. Try again in a minute.',
      timestamp: timestamp(),
    });
  },
});

module.exports = { referralStatusRateLimit, WINDOW_MS, LIMIT };
