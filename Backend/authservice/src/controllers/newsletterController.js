const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const { getClientIp, parseUserAgent } = require('../utils/deviceInfo');
const { formatIST } = require('../utils/istTime');

/**
 * Public endpoint behind the landing-page newsletter form.
 * Body is email only; IP, browser, OS, and IST subscribe time are captured
 * server-side from the request. No auth, no email send.
 *
 * Abuse controls (no extra dependencies):
 *  - honeypot field  : bots that fill the hidden `website` field get a fake 201
 *  - per-IP throttle : RATE_LIMIT.max submissions per RATE_LIMIT.windowMs
 *  - unique email    : same address returns the original subscription
 */

const LIMITS = Object.freeze({
  email: 255,
  source: 64,
  page_url: 2048,
  user_agent: 1000,
});

const RATE_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, max: 8 });
const HONEYPOT_FIELDS = ['website', 'company_website'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DEFAULT_SOURCE = 'website_newsletter';

const submissionsByIp = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT.windowMs;
  const recent = (submissionsByIp.get(ip) || []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + RATE_LIMIT.windowMs - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  recent.push(now);
  submissionsByIp.set(ip, recent);
  if (submissionsByIp.size > 5000) {
    for (const [key, stamps] of submissionsByIp) {
      if (!stamps.some((t) => t > cutoff)) submissionsByIp.delete(key);
    }
  }
  return { limited: false };
}

const str = (value, max) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
};

function validate(body, req) {
  const errors = {};
  const values = {};

  values.email = str(body.email, LIMITS.email).toLowerCase();
  if (!values.email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address';

  const source = str(body.source, LIMITS.source).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  values.source = source || DEFAULT_SOURCE;
  values.page_url = str(body.page_url || req.headers.referer || req.headers.referrer, LIMITS.page_url) || null;

  const ip = getClientIp(req);
  const userAgent = str(req.headers['user-agent'], LIMITS.user_agent) || null;
  const { browser, os, deviceType } = parseUserAgent(userAgent);

  values.ip_address = ip;
  values.user_agent = userAgent;
  values.browser = browser;
  values.os = os;
  values.device_type = deviceType;

  return { values, errors };
}

const toPublic = (row) => ({
  id: row.id,
  email: row.email,
  ip_address: row.ip_address,
  browser: row.browser,
  os: row.os,
  device_type: row.device_type,
  subscribed_at: row.subscribed_at,
  subscribed_at_ist: formatIST(row.subscribed_at),
});

const thankYou = () =>
  'Thanks for subscribing. You are on the Jurinex newsletter list.';

// POST /api/auth/newsletter-subscribers
const subscribeNewsletter = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = getClientIp(req);

  try {
    if (HONEYPOT_FIELDS.some((field) => str(body[field], 10))) {
      console.warn(`[Newsletter] honeypot tripped from ${ip}`);
      return res.status(201).json({ success: true, message: thankYou() });
    }

    const limit = checkRateLimit(ip);
    if (limit.limited) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: 'Too many subscribe attempts from this connection. Please try again in a few minutes.',
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }

    const { values, errors } = validate(body, req);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please fix the highlighted fields.',
        errors,
      });
    }

    const subscriber = await NewsletterSubscriber.create(values);
    if (!subscriber) {
      return res.status(500).json({
        success: false,
        message: 'We could not save your subscription right now. Please try again.',
      });
    }

    if (subscriber.already_subscribed) {
      console.log(`[Newsletter] already subscribed ${values.email} from ${ip}`);
      return res.status(200).json({
        success: true,
        already_subscribed: true,
        message: 'This email is already on the newsletter list.',
        subscriber: toPublic(subscriber),
      });
    }

    console.log(
      `[Newsletter] ${values.email} · ip=${values.ip_address} · ${values.browser} · ${values.os}`
    );

    return res.status(201).json({
      success: true,
      already_subscribed: false,
      message: thankYou(),
      subscriber: toPublic(subscriber),
    });
  } catch (error) {
    console.error('[Newsletter] subscribe failed:', error);
    return res.status(500).json({
      success: false,
      message: 'We could not save your subscription right now. Please try again.',
    });
  }
};

module.exports = { subscribeNewsletter };
