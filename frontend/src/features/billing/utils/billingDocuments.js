/**
 * Builds the invoice / receipt PDFs from the HTML templates in ../templates.
 *
 * Flow: payment row  ->  template data (buildInvoiceData / buildReceiptData)
 *       template data ->  HTML string (renderBillingDocument)
 *       HTML string   ->  PDF download via html2pdf (downloadBillingPdf)
 */
import html2pdf from 'html2pdf.js';
import taxInvoiceTemplate from '../templates/tax-invoice.html?raw';
import paymentReceiptTemplate from '../templates/payment-receipt.html?raw';
import { renderTemplate } from './mustacheLite';
import { rupeesToWordsINR, formatDateLong, formatMoneyINR, formatRate } from './billingFormat';

/**
 * Seller details printed on every document. Empty strings hide the matching line
 * in the template, so fill in the address, GSTIN and SAC code once they are confirmed.
 */
export const BILLING_COMPANY = {
  name: 'JuriNex',
  tagline: 'Digital legal technology platform',
  address: '',
  country: 'India',
  email: 'support@jurinex.com',
  gstin: '',
  sac: '',
  place_of_supply: '',
};

const PAID_STATUSES = new Set(['captured', 'completed', 'paid', 'success', 'succeeded', 'authorized']);

const METHOD_LABELS = {
  razorpay: 'Razorpay',
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay later',
};

function clean(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s === '—' || s === '-' || s.toUpperCase() === 'N/A' ? '' : s;
}

function paymentMethodLabel(method) {
  const m = clean(method);
  if (!m) return '';
  return METHOD_LABELS[m.toLowerCase()] || m.charAt(0).toUpperCase() + m.slice(1);
}

function statusInfo(status) {
  const s = clean(status).toLowerCase();
  if (!s) return { label: '', paid: false };
  if (PAID_STATUSES.has(s)) return { label: 'Paid', paid: true };
  if (s === 'refunded' || s === 'partially_refunded') return { label: 'Refunded', paid: false };
  if (s === 'pending' || s === 'created' || s === 'attempted') return { label: 'Pending', paid: false };
  if (s === 'failed' || s === 'cancelled' || s === 'canceled') return { label: s === 'failed' ? 'Failed' : 'Cancelled', paid: false };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), paid: false };
}

/**
 * Resolve taxable value, GST lines and total for a payment row.
 * Prefers the stored breakdown (basic / CGST / SGST / IGST in rupees from the payments table);
 * falls back to the historical 18% inclusive split only for rows that have none.
 */
function resolveTax(tx, amountRupees) {
  const hasStored = tx.basic_amount !== null && tx.basic_amount !== undefined;
  const total = hasStored
    ? Number(tx.total_amount ?? amountRupees) || 0
    : Number(amountRupees) || 0;

  if (hasStored) {
    const type = tx.tax_type || (Number(tx.igst_amount) > 0 ? 'IGST' : 'CGST_SGST');
    const taxable = Number(tx.basic_amount) || 0;
    const cgst = type === 'CGST_SGST' ? Number(tx.cgst_amount || 0) : 0;
    const sgst = type === 'CGST_SGST' ? Number(tx.sgst_amount || 0) : 0;
    const igst = type === 'IGST' ? Number(tx.igst_amount || 0) : 0;
    const cgstRate = type === 'CGST_SGST' ? Number(tx.cgst_rate || 0) : 0;
    const sgstRate = type === 'CGST_SGST' ? Number(tx.sgst_rate || 0) : 0;
    const igstRate = type === 'IGST' ? Number(tx.igst_rate || 0) : 0;
    const gstAmount = cgst + sgst + igst;
    const gstRate = type === 'IGST' ? igstRate : cgstRate + sgstRate;
    const roundOff = Math.round((total - (taxable + gstAmount)) * 100) / 100;
    const note = type === 'NONE'
      ? 'No GST applied to this transaction.'
      : tx.tax_basis === 'exclusive' ? 'GST is added on the plan price.' : 'Plan price is inclusive of GST.';
    return {
      taxable, cgst, sgst, igst, cgstRate, sgstRate, igstRate, gstAmount, gstRate, total,
      roundOff: Math.abs(roundOff) >= 0.01 ? roundOff : 0,
      note, hasGst: type !== 'NONE',
    };
  }

  const gstRate = 18;
  const taxable = total > 0 ? total / (1 + gstRate / 100) : 0;
  const gstAmount = total - taxable;
  return {
    taxable, cgst: gstAmount / 2, sgst: gstAmount / 2, igst: 0,
    cgstRate: 9, sgstRate: 9, igstRate: 0, gstAmount, gstRate, total, roundOff: 0,
    note: 'GST shown is indicative (18% inclusive split).', hasGst: true,
  };
}

function buildCustomer(customer) {
  const c = customer || {};
  const cityStatePin = [c.city, c.state, c.pincode || c.pin || c.postal_code].map(clean).filter(Boolean).join(', ');
  return {
    name: clean(c.name) || 'Customer',
    address: clean(c.address),
    city_state_pin: cityStatePin,
    email: clean(c.email),
    phone: clean(c.phone || c.mobile),
    gstin: clean(c.gstin),
  };
}

function buildItem(tx, tax, kind) {
  const name = clean(tx.plan_name) || (kind === 'receipt' ? 'Subscription payment' : 'Subscription');
  const period = tx.start_date && tx.end_date
    ? `${formatDateLong(tx.start_date)} to ${formatDateLong(tx.end_date)}`
    : '';
  const description = clean(tx.plan_description) || period;
  return {
    index: 1,
    name,
    description,
    sac: BILLING_COMPANY.sac,
    qty: 1,
    unit: '',
    rate: formatMoneyINR(tax.taxable),
    taxable: formatMoneyINR(tax.taxable),
    gst_amount: formatMoneyINR(tax.gstAmount),
    gst_rate: formatRate(tax.gstRate),
    total: formatMoneyINR(tax.total),
  };
}

function buildTotals(tax, grandLabel) {
  return {
    total_qty: 1,
    taxable: formatMoneyINR(tax.taxable),
    cgst: tax.cgst ? formatMoneyINR(tax.cgst) : '',
    cgst_rate: formatRate(tax.cgstRate),
    sgst: tax.sgst ? formatMoneyINR(tax.sgst) : '',
    sgst_rate: formatRate(tax.sgstRate),
    igst: tax.igst ? formatMoneyINR(tax.igst) : '',
    igst_rate: formatRate(tax.igstRate),
    round_off: tax.roundOff ? formatMoneyINR(tax.roundOff) : '',
    grand_total_label: grandLabel,
    grand_total: formatMoneyINR(tax.total),
    amount_in_words: rupeesToWordsINR(tax.total),
  };
}

function companyData(logoSrc) {
  return { ...BILLING_COMPANY, logo_src: logoSrc || '' };
}

/**
 * @param {object} opts
 * @param {object} opts.transaction  payment row (see paymentController list query for the shape)
 * @param {number} opts.amountRupees amount in rupees, used when the row has no stored tax breakdown
 * @param {string} opts.logoSrc      resolved image URL for the brand mark
 * @param {object} opts.customer     { name, email, phone, address, city, state, pincode, gstin }
 */
export function buildInvoiceData({ transaction: tx, amountRupees, logoSrc, customer }) {
  const tax = resolveTax(tx, amountRupees);
  const status = statusInfo(tx.payment_status || tx.status);
  const paymentMethod = paymentMethodLabel(tx.payment_method);
  const receiptNo = clean(tx.razorpay_receipt);

  return {
    company: companyData(logoSrc),
    customer: buildCustomer(customer),
    invoice: {
      // Application-generated number from app_invoices; never derived from Razorpay ids.
      number: clean(tx.app_invoice_number) || 'Invoice number pending',
      date: formatDateLong(tx.app_invoice_issued_at || tx.payment_date || tx.created_at) || formatDateLong(new Date()),
      order_id: clean(tx.razorpay_order_id),
      place_of_supply: BILLING_COMPANY.place_of_supply,
      reverse_charge: tax.hasGst ? 'No' : '',
      status_label: status.label,
      paid: status.paid,
      payment_method: paymentMethod,
      payment_id: clean(tx.razorpay_payment_id),
      receipt: receiptNo,
    },
    items: [buildItem(tx, tax, 'invoice')],
    totals: buildTotals(tax, 'Grand total'),
    terms: [
      tax.note,
      'Payment was processed digitally. This invoice is issued against the payment referenced above.',
      'Subscription credits and storage are subject to the JuriNex terms of service.',
    ],
  };
}

export function buildReceiptData({ transaction: tx, amountRupees, logoSrc, customer }) {
  const tax = resolveTax(tx, amountRupees);
  const status = statusInfo(tx.payment_status || tx.status);
  const paymentMethod = paymentMethodLabel(tx.payment_method);
  const invoiceNo = clean(tx.app_invoice_number);
  const paymentId = clean(tx.razorpay_payment_id);
  const gatewayReceipt = clean(tx.razorpay_receipt);

  const notes = [];
  if (invoiceNo) notes.push(`This receipt acknowledges payment received against invoice ${invoiceNo}.`);
  else notes.push('This receipt acknowledges payment received for the item listed above.');
  notes.push(tax.note);
  notes.push('Please retain this receipt for your records.');

  return {
    company: companyData(logoSrc),
    customer: buildCustomer(customer),
    receipt: {
      number: gatewayReceipt || paymentId || (tx.id ? `RCPT-${tx.id}` : 'Receipt'),
      date: formatDateLong(tx.payment_date || tx.created_at) || formatDateLong(new Date()),
      invoice_number: invoiceNo,
      order_id: clean(tx.razorpay_order_id),
      payment_id: paymentId,
      payment_status: status.label,
      status_label: status.paid ? 'Paid' : status.label,
      paid: status.paid,
      payment_method: paymentMethod,
      gateway_receipt: gatewayReceipt && gatewayReceipt !== paymentId ? gatewayReceipt : '',
    },
    items: [buildItem(tx, tax, 'receipt')],
    totals: buildTotals(tax, 'Amount received'),
    terms: notes,
  };
}

const TEMPLATES = {
  invoice: taxInvoiceTemplate,
  receipt: paymentReceiptTemplate,
};

/**
 * Render the full HTML document for a billing document.
 * @param {'invoice'|'receipt'} kind
 */
export function renderBillingDocument(kind, data) {
  const template = TEMPLATES[kind];
  if (!template) throw new Error(`Unknown billing document kind: ${kind}`);
  return renderTemplate(template, data);
}

/**
 * The templates are full HTML documents. html2pdf injects markup into a <div>, where <html>, <head>
 * and <body> are dropped by the parser, so body-level styles are retargeted to a wrapper class and
 * the on-screen chrome (grey backdrop, drop shadow, outer margin) is removed for the PDF page.
 */
function toPdfFragment(documentHtml) {
  const styles = (documentHtml.match(/<style[\s\S]*?<\/style>/gi) || [])
    .join('\n')
    .replace(/\bhtml\s*,\s*body\b/g, '.jx-doc')
    .replace(/(^|[\s}])body(\s*\{)/g, '$1.jx-doc$2');
  const bodyMatch = documentHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : documentHtml;
  const overrides = `
<style>
  .jx-doc { background: #fff; }
  .jx-doc .page { margin: 0; box-shadow: none; height: 296.8mm; min-height: 0; }
</style>`;
  return `${styles}\n${overrides}\n<div class="jx-doc">${body}</div>`;
}

function safeFileName(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

/**
 * Build and download a billing PDF.
 * @param {'invoice'|'receipt'} kind
 * @param {Parameters<typeof buildInvoiceData>[0]} opts
 */
export function downloadBillingPdf(kind, opts) {
  const data = kind === 'invoice' ? buildInvoiceData(opts) : buildReceiptData(opts);
  const html = toPdfFragment(renderBillingDocument(kind, data));
  const number = kind === 'invoice' ? data.invoice.number : data.receipt.number;
  const filename = `${kind}_${safeFileName(number)}.pdf`;

  return html2pdf()
    .set({
      margin: 0,
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      // windowWidth keeps the template's narrow-screen media query from firing in small browser windows.
      html2canvas: { scale: 2, useCORS: true, windowWidth: 1200, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    })
    .from(html, 'string')
    .save();
}
