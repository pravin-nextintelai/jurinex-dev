'use strict';
/**
 * GST arithmetic in integer paise.
 *
 * Never uses floating point for money. Rates are basis points (bp):
 *   1800 bp = 18.00 %, 900 bp = 9.00 %.
 *
 * Inclusive prices (the default for this project — plan prices already contain GST):
 *   basic = round(total * 10000 / (10000 + rate))
 *   CGST  = round(unroundedBasic * half)  == round(total * half / (10000 + rate))
 *   SGST  = total - basic - CGST            (absorbs the rounding so the parts add up)
 *   ₹100 → basic 84.75, CGST 7.63, SGST 7.62, total 100.00
 *
 * Exclusive prices:
 *   CGST = round(basic * half), SGST = round(basic * half), total = basic + CGST + SGST
 */

const BASIS = Object.freeze({ INCLUSIVE: 'inclusive', EXCLUSIVE: 'exclusive', NONE: 'none' });
const TAX_TYPE = Object.freeze({ CGST_SGST: 'CGST_SGST', IGST: 'IGST', NONE: 'NONE' });
const BP_SCALE = 10000n;

function toBigInt(value, label) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer (paise), got ${value}`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new TypeError(`${label} must be an integer (paise), got ${value}`);
}

/** round(n / d) with half-up rounding for non-negative n, positive d. */
function roundDiv(n, d) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  if (n < 0n) return -roundDiv(-n, d);
  return (n * 2n + d) / (d * 2n);
}

/**
 * Convert a rupee amount (number or string such as "100", "84.75", "1,234.5") to integer paise
 * without floating point drift. Strings are parsed digit by digit.
 */
function rupeesToPaise(value) {
  if (value === null || value === undefined || value === '') return 0;
  let str = typeof value === 'number' ? value.toFixed(2) : String(value).trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(str)) throw new TypeError(`Invalid money value: ${value}`);
  const negative = str.startsWith('-');
  if (negative) str = str.slice(1);
  const [whole = '0', frac = ''] = str.split('.');
  const fracPadded = (frac + '000').slice(0, 3); // keep a third digit for rounding
  let paise = BigInt(whole || '0') * 100n + BigInt(fracPadded.slice(0, 2) || '0');
  if (Number(fracPadded[2]) >= 5) paise += 1n;
  return Number(negative ? -paise : paise);
}

/** Integer paise → "84.75" (string, two decimals, no float). */
function paiseToRupeesString(paise) {
  const big = toBigInt(paise, 'paise');
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

/** Integer paise → JS number of rupees (for JSON responses and reports that already expect rupees). */
function paiseToRupeesNumber(paise) {
  return Number(paiseToRupeesString(paise));
}

/**
 * @param {object} input
 * @param {number|bigint|string} [input.totalPaise]  required for inclusive/none basis
 * @param {number|bigint|string} [input.basicPaise]  required for exclusive basis
 * @param {'inclusive'|'exclusive'|'none'} [input.basis='inclusive']
 * @param {'CGST_SGST'|'IGST'|'NONE'} [input.taxType='CGST_SGST']
 * @param {number} [input.gstRateBp=1800]  total GST rate in basis points
 * @returns {{
 *   basis: string, taxType: string, gstRateBp: number,
 *   basicPaise: number, cgstRateBp: number, cgstPaise: number, sgstRateBp: number, sgstPaise: number,
 *   igstRateBp: number, igstPaise: number, taxPaise: number, totalPaise: number
 * }}
 */
function computeGstBreakdown(input = {}) {
  const basis = input.basis || BASIS.INCLUSIVE;
  let taxType = input.taxType || TAX_TYPE.CGST_SGST;
  const gstRateBp = input.gstRateBp === undefined ? 1800 : Number(input.gstRateBp);

  if (!Object.values(BASIS).includes(basis)) throw new TypeError(`Unknown basis: ${basis}`);
  if (!Object.values(TAX_TYPE).includes(taxType)) throw new TypeError(`Unknown taxType: ${taxType}`);
  if (!Number.isInteger(gstRateBp) || gstRateBp < 0 || gstRateBp > BP_SCALE) {
    throw new RangeError(`gstRateBp must be an integer between 0 and 10000, got ${gstRateBp}`);
  }
  if (gstRateBp % 2 !== 0 && taxType === TAX_TYPE.CGST_SGST) {
    throw new RangeError('gstRateBp must be even to split equally into CGST and SGST');
  }

  const rate = BigInt(gstRateBp);
  const half = rate / 2n;
  const noTax = basis === BASIS.NONE || taxType === TAX_TYPE.NONE || rate === 0n;
  if (noTax) taxType = TAX_TYPE.NONE;

  let basic;
  let total;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;

  if (basis === BASIS.EXCLUSIVE) {
    if (input.basicPaise === undefined || input.basicPaise === null) {
      throw new TypeError('basicPaise is required for exclusive basis');
    }
    basic = toBigInt(input.basicPaise, 'basicPaise');
    if (basic < 0n) throw new RangeError('basicPaise must be >= 0');
    if (noTax) {
      total = basic;
    } else if (taxType === TAX_TYPE.CGST_SGST) {
      cgst = roundDiv(basic * half, BP_SCALE);
      sgst = roundDiv(basic * half, BP_SCALE);
      total = basic + cgst + sgst;
    } else {
      igst = roundDiv(basic * rate, BP_SCALE);
      total = basic + igst;
    }
  } else {
    if (input.totalPaise === undefined || input.totalPaise === null) {
      throw new TypeError('totalPaise is required for inclusive basis');
    }
    total = toBigInt(input.totalPaise, 'totalPaise');
    if (total < 0n) throw new RangeError('totalPaise must be >= 0');
    if (noTax) {
      basic = total;
    } else {
      const denom = BP_SCALE + rate;
      basic = roundDiv(total * BP_SCALE, denom);
      if (taxType === TAX_TYPE.CGST_SGST) {
        // CGST from the UNROUNDED basic: total * half / (10000 + rate)
        cgst = roundDiv(total * half, denom);
        sgst = total - basic - cgst; // remainder absorbs rounding
      } else {
        igst = total - basic;
      }
    }
  }

  const out = {
    basis,
    taxType,
    gstRateBp: noTax ? 0 : gstRateBp,
    basicPaise: Number(basic),
    cgstRateBp: taxType === TAX_TYPE.CGST_SGST ? Number(half) : 0,
    cgstPaise: Number(cgst),
    sgstRateBp: taxType === TAX_TYPE.CGST_SGST ? Number(half) : 0,
    sgstPaise: Number(sgst),
    igstRateBp: taxType === TAX_TYPE.IGST ? Number(rate) : 0,
    igstPaise: Number(igst),
    taxPaise: Number(cgst + sgst + igst),
    totalPaise: Number(total),
  };

  // Invariant: the parts must always add up exactly.
  if (out.basicPaise + out.cgstPaise + out.sgstPaise + out.igstPaise !== out.totalPaise) {
    throw new Error('GST breakdown invariant violated');
  }
  return out;
}

/** bp → percent string "9.00" */
function bpToPercentString(bp) {
  const big = toBigInt(bp, 'bp');
  return `${big / 100n}.${(big % 100n).toString().padStart(2, '0')}`;
}

/** bp → percent number 9 */
function bpToPercentNumber(bp) {
  return Number(bpToPercentString(bp));
}

/** percent (number|string, e.g. 18 or "9.5") → bp (integer) */
function percentToBp(percent) {
  return rupeesToPaise(percent); // same "two decimals → integer" conversion
}

module.exports = {
  BASIS,
  TAX_TYPE,
  computeGstBreakdown,
  rupeesToPaise,
  paiseToRupeesString,
  paiseToRupeesNumber,
  bpToPercentString,
  bpToPercentNumber,
  percentToBp,
  roundDiv,
};
