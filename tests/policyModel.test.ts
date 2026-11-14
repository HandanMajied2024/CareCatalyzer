import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialPolicy, simulatePolicy } from '../src/utils/policyModel.ts';

test('no added resources or funding preserves baseline access', () => {
  for (const inputs of [
    { ...initialPolicy, hospital: 0, cars: 0, mobile: 0 },
    { ...initialPolicy, budget: 0 },
  ]) {
    const result = simulatePolicy(inputs);
    assert.equal(result.additional, 0);
    assert.equal(result.treated, result.baselineTreated);
  }
});
test('winter reduces reach and increases waiting time', () => {
  const normal = simulatePolicy(initialPolicy);
  const winter = simulatePolicy({ ...initialPolicy, winter: true });
  assert(winter.treated <= normal.treated);
  assert(winter.wait >= normal.wait);
});
test('capacity and funded costs stay bounded across demand and budget levels', () => {
  for (let patients = 100; patients <= 10000; patients += 100) {
    for (const budget of [0, 10000, 180000, 1000000]) {
      const result = simulatePolicy({ ...initialPolicy, patients, budget });
      assert(result.access >= 0 && result.access <= 100);
      assert(result.treated <= patients);
      assert(result.totalCost <= budget * initialPolicy.months);
      assert(result.funding >= 0 && result.funding <= 1);
    }
  }
});
test('hospital capacity alone cannot resolve a transport bottleneck', () => {
  const baseline = simulatePolicy({ ...initialPolicy, hospital: 0, cars: 0, mobile: 0 });
  const hospitalOnly = simulatePolicy({ ...initialPolicy, hospital: 30, cars: 0, mobile: 0 });
  assert.equal(hospitalOnly.treated, baseline.treated);
});
