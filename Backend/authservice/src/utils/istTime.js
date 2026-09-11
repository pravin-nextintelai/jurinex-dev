/**
 * India Standard Time helpers. Timestamps are stored as TIMESTAMPTZ (UTC) and
 * rendered as IST for the marketing team — never store IST-shifted values.
 */
const IST_TIME_ZONE = 'Asia/Kolkata';

const displayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateStampFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "11 Sep 2026, 10:42 AM IST" — human-readable, for API responses and dashboards. */
function formatIST(value) {
  const d = toDate(value);
  if (!d) return null;
  const p = {};
  for (const part of displayFormatter.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const period = String(p.dayPeriod || '').toUpperCase();
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${period} IST`;
}

/** "20260911" — the IST calendar date, used for reference numbers. */
function istDateStamp(value = new Date()) {
  const d = toDate(value) || new Date();
  return dateStampFormatter.format(d).replace(/-/g, '');
}

module.exports = { IST_TIME_ZONE, formatIST, istDateStamp };
