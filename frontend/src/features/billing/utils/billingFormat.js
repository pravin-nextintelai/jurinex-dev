/**
 * Number and date formatting helpers for billing documents (invoice / receipt PDFs).
 */

const ones = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function convertBelowThousand(num) {
  if (!num) return '';
  if (num < 20) return ones[num];
  const t = Math.floor(num / 10);
  const o = num % 10;
  return tens[t] + (o ? ` ${ones[o]}` : '');
}

function convertHundreds(num) {
  if (!num) return '';
  if (num < 100) return convertBelowThousand(num);
  const h = Math.floor(num / 100);
  const rest = num % 100;
  return `${ones[h]} hundred${rest ? ` ${convertBelowThousand(rest)}` : ''}`;
}

/**
 * Indian-system amount in words, sentence case: "Two thousand three hundred sixty rupees only".
 */
export function rupeesToWordsINR(amount) {
  const n = Math.round(Number(amount) * 100) / 100;
  let rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero rupees only';

  const parts = [];
  const crores = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakhs = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousands = Math.floor(rupees / 1000);
  rupees %= 1000;

  if (crores) parts.push(`${convertHundreds(crores)} crore`);
  if (lakhs) parts.push(`${convertHundreds(lakhs)} lakh`);
  if (thousands) parts.push(`${convertHundreds(thousands)} thousand`);
  if (rupees) parts.push(convertHundreds(rupees));

  let words = parts.length ? `${parts.join(' ').replace(/\s+/g, ' ').trim()} rupees` : '';
  if (paise > 0) words += `${words ? ' and ' : ''}${convertHundreds(paise)} paise`;
  words += ' only';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Oct 2026"; empty string for missing or invalid dates. */
export function formatDateLong(dateValue) {
  if (!dateValue) return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2,360.00" in Indian digit grouping; empty string for non-numbers. */
export function formatMoneyINR(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** Trims a GST rate like 9 or 18.5 to a short string without trailing zeros. */
export function formatRate(rate) {
  const n = Number(rate);
  if (Number.isNaN(n)) return '0';
  return String(Math.round(n * 100) / 100);
}
