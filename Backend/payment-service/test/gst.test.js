'use strict';
/**
 * GST rounding tests.  Run:  node --test test/gst.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const gst = require('../src/utils/gst');
const taxService = require('../src/services/taxService');

test('₹100 inclusive → basic 84.75, CGST 7.63, SGST 7.62, total 100.00 (spec example)', () => {
  const b = gst.computeGstBreakdown({ totalPaise: 10000, basis: 'inclusive', taxType: 'CGST_SGST', gstRateBp: 1800 });
  assert.equal(b.basicPaise, 8475);
  assert.equal(b.cgstPaise, 763);
  assert.equal(b.sgstPaise, 762);
  assert.equal(b.totalPaise, 10000);
  assert.equal(gst.paiseToRupeesString(b.basicPaise), '84.75');
  assert.equal(gst.paiseToRupeesString(b.cgstPaise), '7.63');
  assert.equal(gst.paiseToRupeesString(b.sgstPaise), '7.62');
  assert.equal(b.cgstRateBp, 900);
  assert.equal(b.sgstRateBp, 900);
  assert.equal(b.igstPaise, 0);
});

test('inclusive IGST: basic + IGST = total', () => {
  const b = gst.computeGstBreakdown({ totalPaise: 10000, basis: 'inclusive', taxType: 'IGST' });
  assert.equal(b.basicPaise, 8475);
  assert.equal(b.igstPaise, 1525);
  assert.equal(b.cgstPaise, 0);
  assert.equal(b.sgstPaise, 0);
  assert.equal(b.igstRateBp, 1800);
});

test('exclusive basis: GST added on top of the basic price', () => {
  const b = gst.computeGstBreakdown({ basicPaise: 10000, basis: 'exclusive', taxType: 'CGST_SGST' });
  assert.equal(b.basicPaise, 10000);
  assert.equal(b.cgstPaise, 900);
  assert.equal(b.sgstPaise, 900);
  assert.equal(b.totalPaise, 11800);
  const i = gst.computeGstBreakdown({ basicPaise: 99999, basis: 'exclusive', taxType: 'IGST' });
  assert.equal(i.igstPaise, 18000); // 17999.82 → 18000
  assert.equal(i.totalPaise, 117999);
});

test('no-tax cases: NONE tax type, basis none, zero rate, zero amount', () => {
  for (const input of [
    { totalPaise: 10000, taxType: 'NONE' },
    { totalPaise: 10000, basis: 'none' },
    { totalPaise: 10000, gstRateBp: 0 },
    { totalPaise: 0 },
  ]) {
    const b = gst.computeGstBreakdown(input);
    assert.equal(b.basicPaise, b.totalPaise);
    assert.equal(b.cgstPaise + b.sgstPaise + b.igstPaise, 0);
  }
});

test('invariant basic + CGST + SGST + IGST = total holds for every paise value 1..200000 (inclusive)', () => {
  for (let t = 1; t <= 200000; t += 1) {
    const b = gst.computeGstBreakdown({ totalPaise: t, taxType: 'CGST_SGST' });
    assert.equal(b.basicPaise + b.cgstPaise + b.sgstPaise, t, `sum mismatch at ${t}`);
    // SGST only ever absorbs ±1 paisa of rounding relative to CGST
    assert.ok(Math.abs(b.cgstPaise - b.sgstPaise) <= 1, `CGST/SGST differ by >1 paisa at ${t}`);
    const i = gst.computeGstBreakdown({ totalPaise: t, taxType: 'IGST' });
    assert.equal(i.basicPaise + i.igstPaise, t);
  }
});

test('known rupee amounts (inclusive, CGST+SGST)', () => {
  const cases = [
    // total, basic, cgst, sgst
    [1000, 847, 76, 77],          // ₹10.00
    [99900, 84661, 7619, 7620],   // ₹999.00
    [999900, 847373, 76264, 76263], // ₹9,999.00 (CGST from unrounded basic: 76263.56 → 76264)
    [1, 1, 0, 0],                 // 1 paisa
    [118, 100, 9, 9],             // ₹1.18
  ];
  for (const [total, basic, cgst, sgst] of cases) {
    const b = gst.computeGstBreakdown({ totalPaise: total });
    assert.deepEqual([b.basicPaise, b.cgstPaise, b.sgstPaise], [basic, cgst, sgst], `case ${total}`);
  }
});

test('money conversions never use float drift', () => {
  assert.equal(gst.rupeesToPaise('100'), 10000);
  assert.equal(gst.rupeesToPaise('84.75'), 8475);
  assert.equal(gst.rupeesToPaise('0.1'), 10);
  assert.equal(gst.rupeesToPaise('1,234.5'), 123450);
  assert.equal(gst.rupeesToPaise(999.0), 99900);
  assert.equal(gst.rupeesToPaise('19.995'), 2000); // third decimal rounds half up
  assert.equal(gst.rupeesToPaise(null), 0);
  assert.equal(gst.paiseToRupeesString(5), '0.05');
  assert.equal(gst.paiseToRupeesString(123456789), '1234567.89');
  assert.equal(gst.paiseToRupeesNumber(8475), 84.75);
  assert.equal(gst.percentToBp(18), 1800);
  assert.equal(gst.percentToBp('9.5'), 950);
  assert.equal(gst.bpToPercentString(900), '9.00');
  assert.throws(() => gst.computeGstBreakdown({ totalPaise: 10.5 }), /integer/);
  assert.throws(() => gst.computeGstBreakdown({ totalPaise: 100, gstRateBp: 1801 }), /even/);
});

test('taxService: place of supply decides CGST+SGST vs IGST', () => {
  const config = { enabled: true, gstRateBp: 1800, basis: 'inclusive', businessState: taxService.normalizeStateInput('Maharashtra'), defaultSupplyType: 'intra' };
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Maharashtra', config }).taxType, 'CGST_SGST');
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Mumbai, Maharashtra', config }).taxType, 'CGST_SGST');
  assert.equal(taxService.resolveTaxTreatment({ customerState: '27', config }).taxType, 'CGST_SGST');
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Delhi', config }).taxType, 'IGST');
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Karnataka', config }).rule, 'place_of_supply_match');
  // unknown customer state → configured default (intra)
  const unknown = taxService.resolveTaxTreatment({ customerState: 'soon', config });
  assert.equal(unknown.taxType, 'CGST_SGST');
  assert.equal(unknown.rule, 'default_supply_type_customer_state_unknown');
  // default can be switched to inter-state
  assert.equal(taxService.resolveTaxTreatment({ customerState: null, config: { ...config, defaultSupplyType: 'inter' } }).taxType, 'IGST');
  // non-INR → no GST split
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Delhi', currency: 'USD', config }).taxType, 'NONE');
  // disabled
  assert.equal(taxService.resolveTaxTreatment({ customerState: 'Delhi', config: { ...config, enabled: false } }).taxType, 'NONE');
});

test('taxService.buildTaxBreakdown stores metadata and the calculation timestamp', () => {
  const now = new Date('2026-10-15T10:00:00.000Z');
  const config = { enabled: true, gstRateBp: 1800, basis: 'inclusive', businessState: taxService.normalizeStateInput('Maharashtra'), defaultSupplyType: 'intra' };
  const b = taxService.buildTaxBreakdown({ totalPaise: 10000, customerState: 'Delhi', customerStateSource: { source: 'firms.state' }, config, now });
  assert.equal(b.taxType, 'IGST');
  assert.equal(b.igstPaise, 1525);
  assert.equal(b.calculatedAt, now.toISOString());
  assert.equal(b.metadata.customer_state_code, '07');
  assert.equal(b.metadata.business_state_code, '27');
  assert.equal(b.metadata.supply_type, 'inter');
  assert.equal(b.metadata.gst_rate_percent, 18);
  assert.deepEqual(b.metadata.customer_state_source, { source: 'firms.state' });

  const ex = taxService.buildTaxBreakdown({ basicPaise: 10000, customerState: 'Maharashtra', config: { ...config, basis: 'exclusive' }, now });
  assert.equal(ex.totalPaise, 11800);
  assert.equal(ex.basis, 'exclusive');
});

test('readConfig: defaults are inclusive, 18%, intra-state', () => {
  const c = taxService.readConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.gstRateBp, 1800);
  assert.equal(c.basis, 'inclusive');
  assert.equal(c.defaultSupplyType, 'intra');
  assert.equal(c.businessState, null);
  const d = taxService.readConfig({ GST_PRICE_BASIS: 'exclusive', BUSINESS_STATE: 'Maharashtra', GST_RATE_PERCENT: '12', GST_DEFAULT_SUPPLY_TYPE: 'inter' });
  assert.equal(d.basis, 'exclusive');
  assert.equal(d.businessState.code, '27');
  assert.equal(d.gstRateBp, 1200);
  assert.equal(d.defaultSupplyType, 'inter');
});
