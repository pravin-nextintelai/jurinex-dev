const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadController(getHeaderPromos) {
  const sandbox = {
    module: { exports: {} },
    require: () => ({ getHeaderPromos }),
    console: { error() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/marketingPromoController.js'), 'utf8'), sandbox);
  return sandbox.module.exports.getHeaderPromos;
}
function response() {
  return {
    statusCode: 200, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}
test('public endpoint returns ordered promotions and event slots without requiring a user', async () => {
  const promos = [{ id: 2, kind: 'event', slots: [{ id: 3, seat_capacity: 20, seats_booked: 4 }] }, { id: 1, kind: 'offer', slots: [] }];
  const res = response();
  await loadController(async () => promos)({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.promos, promos);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('empty results return success so frontend can hide the banner', async () => {
  const res = response();
  await loadController(async () => [])({}, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.promos.length, 0);
});
test('database failures return a generic error without database details', async () => {
  const res = response();
  await loadController(async () => { throw new Error('private database details'); })({}, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(JSON.stringify(res.body).includes('private database details'), false);
});
