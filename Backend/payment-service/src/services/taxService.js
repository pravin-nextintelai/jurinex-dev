'use strict';
/**
 * Tax treatment for subscription purchases (Indian GST).
 *
 * Configuration (environment):
 *   GST_ENABLED                 'true' (default) | 'false'  — 'false' records no tax split.
 *   GST_RATE_PERCENT            default 18
 *   GST_PRICE_BASIS             'inclusive' (default; plan prices already include GST) | 'exclusive'
 *   BUSINESS_STATE              name or GST state code of the supplier (e.g. "Maharashtra" or "27")
 *   GST_DEFAULT_SUPPLY_TYPE     'intra' (default → CGST+SGST) | 'inter' (→ IGST) used when the customer's
 *                               state cannot be determined or BUSINESS_STATE is not configured.
 *
 * Place of supply:
 *   customer state == business state → intra-state → CGST + SGST (half rate each)
 *   customer state != business state → inter-state → IGST (full rate)
 *   non-INR currency                 → no GST split recorded (export of service; rule noted in metadata)
 */
const gst = require('../utils/gst');

// GST state codes (name → code). Names are matched case-insensitively after trimming.
const STATE_CODES = Object.freeze({
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'orissa': '21', 'chhattisgarh': '22', 'madhya pradesh': '23',
  'gujarat': '24', 'dadra and nagar haveli and daman and diu': '26', 'daman and diu': '26',
  'dadra and nagar haveli': '26', 'maharashtra': '27', 'andhra pradesh': '37', 'karnataka': '29',
  'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34',
  'pondicherry': '34', 'andaman and nicobar islands': '35', 'telangana': '36', 'ladakh': '38',
});

const CODE_TO_NAME = Object.freeze(
  Object.entries(STATE_CODES).reduce((acc, [name, code]) => {
    if (!acc[code]) acc[code] = name.replace(/\b\w/g, (c) => c.toUpperCase());
    return acc;
  }, {})
);

function normalizeStateInput(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, '0');
    return CODE_TO_NAME[code] ? { code, name: CODE_TO_NAME[code] } : null;
  }
  const key = raw.toLowerCase().replace(/[&]/g, 'and').replace(/\s+/g, ' ').replace(/\./g, '');
  const code = STATE_CODES[key];
  if (code) return { code, name: CODE_TO_NAME[code] };
  // "Mumbai, Maharashtra" / "Pune - Maharashtra" style values: take the last recognisable token
  const parts = key.split(/[,\-/|]/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (STATE_CODES[parts[i]]) return { code: STATE_CODES[parts[i]], name: CODE_TO_NAME[STATE_CODES[parts[i]]] };
  }
  return null;
}

function readConfig(env = process.env) {
  const enabled = String(env.GST_ENABLED ?? 'true').toLowerCase() !== 'false';
  const ratePercent = env.GST_RATE_PERCENT === undefined || env.GST_RATE_PERCENT === '' ? 18 : env.GST_RATE_PERCENT;
  const basisRaw = String(env.GST_PRICE_BASIS || gst.BASIS.INCLUSIVE).toLowerCase();
  const basis = basisRaw === gst.BASIS.EXCLUSIVE ? gst.BASIS.EXCLUSIVE : gst.BASIS.INCLUSIVE;
  const defaultSupply = String(env.GST_DEFAULT_SUPPLY_TYPE || 'intra').toLowerCase() === 'inter' ? 'inter' : 'intra';
  return {
    enabled,
    gstRateBp: gst.percentToBp(ratePercent),
    basis,
    businessState: normalizeStateInput(env.BUSINESS_STATE),
    defaultSupplyType: defaultSupply,
  };
}

/**
 * @returns {{ supplyType: 'intra'|'inter', taxType: string, rule: string, customerState: object|null, businessState: object|null }}
 */
function resolveTaxTreatment({ customerState, currency = 'INR', config = readConfig() } = {}) {
  const customer = normalizeStateInput(customerState);
  const business = config.businessState;

  if (!config.enabled) {
    return { supplyType: null, taxType: gst.TAX_TYPE.NONE, rule: 'gst_disabled', customerState: customer, businessState: business };
  }
  if (String(currency || 'INR').toUpperCase() !== 'INR') {
    return { supplyType: null, taxType: gst.TAX_TYPE.NONE, rule: 'non_inr_currency', customerState: customer, businessState: business };
  }
  if (customer && business) {
    const intra = customer.code === business.code;
    return {
      supplyType: intra ? 'intra' : 'inter',
      taxType: intra ? gst.TAX_TYPE.CGST_SGST : gst.TAX_TYPE.IGST,
      rule: 'place_of_supply_match',
      customerState: customer,
      businessState: business,
    };
  }
  const supplyType = config.defaultSupplyType;
  return {
    supplyType,
    taxType: supplyType === 'inter' ? gst.TAX_TYPE.IGST : gst.TAX_TYPE.CGST_SGST,
    rule: !business ? 'default_supply_type_business_state_unset' : 'default_supply_type_customer_state_unknown',
    customerState: customer,
    businessState: business,
  };
}

/**
 * Build the full, storable tax breakdown for a purchase.
 *
 * @param {object} p
 * @param {number} [p.totalPaise]   charged amount (inclusive basis)
 * @param {number} [p.basicPaise]   pre-tax amount (exclusive basis)
 * @param {string} [p.currency='INR']
 * @param {string|null} [p.customerState]
 * @param {object} [p.customerStateSource] free-form provenance (e.g. { source: 'firms.state' })
 * @param {object} [p.config]
 * @param {Date}   [p.now]
 */
function buildTaxBreakdown(p = {}) {
  const config = p.config || readConfig();
  const currency = String(p.currency || 'INR').toUpperCase();
  const treatment = resolveTaxTreatment({ customerState: p.customerState, currency, config });
  const basis = treatment.taxType === gst.TAX_TYPE.NONE ? gst.BASIS.NONE : config.basis;

  const input = { basis, taxType: treatment.taxType, gstRateBp: config.gstRateBp };
  if (basis === gst.BASIS.EXCLUSIVE) {
    if (p.basicPaise === undefined || p.basicPaise === null) throw new TypeError('basicPaise required for exclusive basis');
    input.basicPaise = p.basicPaise;
  } else {
    // inclusive or none: the charged amount is the total
    const total = p.totalPaise !== undefined && p.totalPaise !== null ? p.totalPaise : p.basicPaise;
    if (total === undefined || total === null) throw new TypeError('totalPaise required');
    input.totalPaise = total;
  }

  const breakdown = gst.computeGstBreakdown(input);
  const calculatedAt = (p.now || new Date()).toISOString();

  return {
    ...breakdown,
    currency,
    calculatedAt,
    metadata: {
      basis: breakdown.basis,
      tax_type: breakdown.taxType,
      gst_rate_percent: gst.bpToPercentNumber(config.gstRateBp),
      supply_type: treatment.supplyType,
      rule: treatment.rule,
      customer_state: treatment.customerState ? treatment.customerState.name : null,
      customer_state_code: treatment.customerState ? treatment.customerState.code : null,
      customer_state_source: p.customerStateSource || null,
      business_state: treatment.businessState ? treatment.businessState.name : null,
      business_state_code: treatment.businessState ? treatment.businessState.code : null,
      rounding: 'half_up_integer_paise; SGST/IGST absorbs rounding so parts sum to total',
      calculated_at: calculatedAt,
    },
  };
}

/**
 * Recompute a breakdown for an already-known tax shape (used when the Razorpay amount differs from the
 * plan price, e.g. Razorpay-managed subscription charges). Keeps the same tax type/basis.
 */
function rebuildForAmount(previous, totalPaise, now = new Date()) {
  const config = readConfig();
  const basis = previous.taxType === gst.TAX_TYPE.NONE ? gst.BASIS.NONE : previous.basis;
  const breakdown = gst.computeGstBreakdown({
    basis: basis === gst.BASIS.EXCLUSIVE ? gst.BASIS.INCLUSIVE : basis, // amount charged is always the total here
    taxType: previous.taxType,
    gstRateBp: previous.gstRateBp || config.gstRateBp,
    totalPaise,
  });
  return {
    ...breakdown,
    currency: previous.currency,
    calculatedAt: now.toISOString(),
    metadata: { ...(previous.metadata || {}), calculated_at: now.toISOString(), recomputed_from_razorpay_amount: true },
  };
}

module.exports = {
  readConfig,
  normalizeStateInput,
  resolveTaxTreatment,
  buildTaxBreakdown,
  rebuildForAmount,
  STATE_CODES,
};
