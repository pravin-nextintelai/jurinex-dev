const ContactEnquiry = require('../models/ContactEnquiry');
const { getClientIp } = require('../utils/deviceInfo');
const { formatIST } = require('../utils/istTime');

/**
 * Public endpoint behind the landing page "Contact Jurinex" form.
 * Stores the enquiry for the marketing admin dashboard; no auth, no email.
 *
 * Abuse controls (no extra dependencies):
 *  - honeypot field  : bots that fill the hidden `website` field get a fake 201
 *  - per-IP throttle : RATE_LIMIT.max submissions per RATE_LIMIT.windowMs
 *  - duplicate guard : same email+mobile+message within DUPLICATE_WINDOW_MINUTES
 *                      returns the original reference instead of a second lead
 */

// "What is this about?" dropdown — slug → label. Slugs are what gets stored.
const TOPICS = Object.freeze({
  demo: 'Request a demo / walkthrough',
  pricing: 'Pricing & plans',
  onboarding: 'Onboarding & training',
  data_security: 'Data security & compliance',
  partnership: 'Partnership / enterprise',
  support: 'Existing customer support',
  other: 'Something else',
});

const LIMITS = Object.freeze({
  first_name: 100,
  last_name: 100,
  email: 255,
  mobile_number: 32,
  organisation_name: 255,
  message: 5000,
  source: 64,
  page_url: 2048,
  user_agent: 1000,
});

const RATE_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, max: 5 });
const DUPLICATE_WINDOW_MINUTES = 10;
const HONEYPOT_FIELDS = ['website', 'company_website'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DEFAULT_SOURCE = 'website_contact_form';

// ---------------------------------------------------------------------------
// Per-IP throttle (in-memory, per instance — good enough for a contact form)
// ---------------------------------------------------------------------------
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
  // Opportunistic cleanup so the map never grows unbounded.
  if (submissionsByIp.size > 5000) {
    for (const [key, stamps] of submissionsByIp) {
      if (!stamps.some((t) => t > cutoff)) submissionsByIp.delete(key);
    }
  }
  return { limited: false };
}

// ---------------------------------------------------------------------------
// Normalisation & validation
// ---------------------------------------------------------------------------
const str = (value, max) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
};

const toBool = (value) =>
  value === true || value === 1 ||
  ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase());

function normaliseTopic(raw) {
  return str(raw, 64).toLowerCase().replace(/[\s-]+/g, '_');
}

/** Keep digits (and one leading "+"); optionally prefix a separate country code. */
function normaliseMobile(raw, countryCode) {
  let number = str(raw, 40).replace(/[^\d+]/g, '');
  number = number.startsWith('+')
    ? `+${number.slice(1).replace(/\+/g, '')}`
    : number.replace(/\+/g, '');

  const cc = str(countryCode, 8).replace(/[^\d+]/g, '');
  if (cc && number && !number.startsWith('+')) {
    number = `${cc.startsWith('+') ? cc : `+${cc}`}${number.replace(/^0+/, '')}`;
  }
  return number;
}

function validate(body, req) {
  const errors = {};
  const values = {};

  values.first_name = str(body.first_name ?? body.name, LIMITS.first_name);
  if (!values.first_name) errors.first_name = 'Name is required';

  values.last_name = str(body.last_name ?? body.surname, LIMITS.last_name);
  if (!values.last_name) errors.last_name = 'Surname is required';

  values.email = str(body.email, LIMITS.email).toLowerCase();
  if (!values.email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address';

  values.mobile_number = normaliseMobile(body.mobile_number ?? body.mobile ?? body.phone, body.country_code);
  const digitCount = values.mobile_number.replace(/\D/g, '').length;
  if (!values.mobile_number) errors.mobile_number = 'Mobile number is required';
  else if (digitCount < 8 || digitCount > 15) errors.mobile_number = 'Enter a valid mobile number (8–15 digits)';
  else if (values.mobile_number.length > LIMITS.mobile_number) errors.mobile_number = 'Mobile number is too long';

  values.organisation_name =
    str(body.organisation_name ?? body.organization_name ?? body.organisation, LIMITS.organisation_name) || null;

  const topic = normaliseTopic(body.topic);
  if (!topic) values.topic = null;
  else if (TOPICS[topic]) values.topic = topic;
  else errors.topic = `Unknown topic. Allowed: ${Object.keys(TOPICS).join(', ')}`;

  values.message = str(body.message ?? body.additional_details, LIMITS.message) || null;

  values.marketing_consent = toBool(body.marketing_consent ?? body.consent);

  const source = str(body.source, LIMITS.source).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  values.source = source || DEFAULT_SOURCE;

  values.page_url = str(body.page_url || req.headers.referer || req.headers.referrer, LIMITS.page_url) || null;
  values.ip_address = getClientIp(req);
  values.user_agent = str(req.headers['user-agent'], LIMITS.user_agent) || null;

  return { values, errors };
}

const toPublic = (row) => ({
  id: row.id,
  reference_no: row.reference_no,
  status: row.status,
  topic: row.topic,
  topic_label: row.topic ? TOPICS[row.topic] || null : null,
  marketing_consent: row.marketing_consent,
  submitted_at: row.created_at,                 // ISO-8601 UTC
  submitted_at_ist: formatIST(row.created_at),  // "11 Sep 2026, 10:42 AM IST"
});

const thankYou = (firstName) =>
  `Thanks${firstName ? `, ${firstName}` : ''}. Your enquiry has been received — a member of the Jurinex team will reply within one working day.`;

// ---------------------------------------------------------------------------
// POST /api/auth/contact-enquiries
// ---------------------------------------------------------------------------
const submitContactEnquiry = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = getClientIp(req);

  try {
    // Honeypot: silently accept so the bot believes it succeeded.
    if (HONEYPOT_FIELDS.some((field) => str(body[field], 10))) {
      console.warn(`[ContactEnquiry] honeypot tripped from ${ip}`);
      return res.status(201).json({ success: true, message: thankYou() });
    }

    const limit = checkRateLimit(ip);
    if (limit.limited) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: 'Too many enquiries from this connection. Please try again in a few minutes.',
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

    const existing = await ContactEnquiry.findRecentDuplicate(values, DUPLICATE_WINDOW_MINUTES);
    if (existing) {
      console.log(`[ContactEnquiry] duplicate of ${existing.reference_no} from ${values.email}`);
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: `We already have your enquiry (${existing.reference_no}). No need to resend — our team will be in touch.`,
        enquiry: toPublic(existing),
      });
    }

    const enquiry = await ContactEnquiry.create(values);
    console.log(
      `[ContactEnquiry] ${enquiry.reference_no} · ${values.email} · topic=${values.topic || '-'} · ip=${ip}`
    );

    return res.status(201).json({
      success: true,
      message: thankYou(values.first_name),
      enquiry: toPublic(enquiry),
    });
  } catch (error) {
    console.error('[ContactEnquiry] submit failed:', error);
    return res.status(500).json({
      success: false,
      message: 'We could not save your enquiry right now. Please try again or email connect@jurinex.ai.',
    });
  }
};

module.exports = { submitContactEnquiry, TOPICS };
