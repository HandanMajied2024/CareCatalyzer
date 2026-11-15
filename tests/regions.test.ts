import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PATIENTS } from '../src/data/patients.ts';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER, REGION_MAP_PATHS } from '../src/data/regions.ts';
import { getAttentionRegions, getRegionalSummaries, getRegionCategory } from '../src/utils/regionalSummary.ts';
import { getEligiblePatients, runInterventionSimulation } from '../src/utils/simulationEngine.ts';
import { applyCallOutcomeToPatient, computeBaselineRisk, getRiskTier, clampScore } from '../src/utils/riskEngine.ts';

test('mock patient scores produce exactly the requested regional colour distribution', () => {
  const summaries = getRegionalSummaries(INITIAL_PATIENTS);
  const counts = { red: 0, orange: 0, yellow: 0, green: 0 };
  for (const region of summaries) counts[getRegionCategory(region)] += 1;
  assert.deepEqual(counts, { red: 2, orange: 4, yellow: 1, green: 12 });
  assert.deepEqual(summaries.filter(r => getRegionCategory(r) === 'red').map(r => r.regionId).sort(), ['01', '19']);
  for (const patient of INITIAL_PATIENTS) {
    const computed = computeBaselineRisk(patient);
    assert.equal(patient.baselineScore, computed.score);
    assert.deepEqual(patient.riskBreakdown, computed.breakdown);
    assert.equal(patient.riskScore, clampScore(patient.baselineScore + patient.scoreDelta));
    assert.equal(patient.riskTier, getRiskTier(patient.riskScore));
    assert.equal(applyCallOutcomeToPatient(patient, {
      callStatus: patient.callStatus, barrierCategory: patient.verifiedBarrier,
    }).riskScore, patient.riskScore);
  }
});

test('official 19 regions each have distinct valid geometry and patient records', () => {
  assert.equal(FOCUS_REGION_ORDER.length, 19);
  assert.equal(FOCUS_REGIONS['21'].name, 'Åland');
  assert.equal(new Set(Object.values(REGION_MAP_PATHS)).size, 19);
  for (const id of FOCUS_REGION_ORDER) {
    assert.match(REGION_MAP_PATHS[id], /^M/);
    assert.doesNotMatch(REGION_MAP_PATHS[id], /NaN|Infinity/);
    const patients = INITIAL_PATIENTS.filter(p => p.regionId === id);
    assert.ok(patients.length > 0);
    for (const p of patients) assert.ok(FOCUS_REGIONS[id].municipalities.includes(p.municipality));
  }
  assert.equal(new Set(INITIAL_PATIENTS.map(p => p.id)).size, INITIAL_PATIENTS.length);
  assert.equal(new Set(INITIAL_PATIENTS.map(p => p.phoneNumber)).size, INITIAL_PATIENTS.length);
  assert.equal(getRegionalSummaries(INITIAL_PATIENTS).reduce((sum, r) => sum + r.total, 0), INITIAL_PATIENTS.length);
});
test('regional colours use inclusive thresholds and never decrease as counts grow', () => {
  const base = { urgent: 0, veryHigh: 0, high: 0 };
  assert.equal(getRegionCategory(base), 'green');
  for (const [field, transitions] of [
    ['urgent', [[6, 'green'], [7, 'yellow'], [14, 'yellow'], [15, 'orange'], [20, 'orange'], [21, 'orange'], [29, 'orange'], [30, 'red']]],
    ['veryHigh', [[0, 'green'], [1, 'yellow'], [29, 'yellow'], [30, 'orange'], [49, 'orange'], [50, 'red']]],
    ['high', [[19, 'green'], [20, 'yellow'], [39, 'yellow'], [40, 'orange'], [50, 'orange']]],
  ] as const) for (const [count, category] of transitions) assert.equal(getRegionCategory({ ...base, [field]: count }), category);
  assert.equal(getRegionCategory({ urgent: 7, veryHigh: 50, high: 40 }), 'red');
  assert.equal(getRegionCategory({ urgent: 0, veryHigh: 1, high: 40 }), 'orange');
});
test('priority responds to call outcomes and highlights all ties', () => {
  const base = INITIAL_PATIENTS[0];
  const a = { ...base, id: 'a', regionId: '01' as const, baselineScore: 70, riskScore: 84, riskTier: 'Urgent' as const };
  const b = { ...a, id: 'b', regionId: '19' as const };
  assert.deepEqual(getAttentionRegions([a, b]).map(r => r.regionId).sort(), ['01', '19']);
  const confirmed = applyCallOutcomeToPatient(a, { callStatus: 'Confirmed Attending' });
  assert.deepEqual(getAttentionRegions([confirmed, b]).map(r => r.regionId), ['19']);
  assert.deepEqual(getAttentionRegions([]), []);
  assert.equal(getRegionalSummaries([]).length, 19);
  assert.deepEqual(getAttentionRegions([{ ...a, riskTier: 'Low' }]), []);
});
test('support eligibility is regional, unique and excludes closed appointments', () => {
  const base = { ...INITIAL_PATIENTS[0], regionId: '19' as const, distanceKm: 200, verifiedBarrier: 'Transport' as const, callStatus: 'Pending Call' as const };
  const records = [base, { ...base, id: 'other', regionId: '01' as const }, { ...base, id: 'done', callStatus: 'Confirmed Attending' as const }, { ...base, id: 'cancelled', callStatus: 'Appointment Cancelled' as const }];
  assert.equal(getEligiblePatients(records, '19', 'shared_shuttle').length, 1);
  const plans = runInterventionSimulation(records, { regionId: '19', severeWeatherActive: false, monthlyBudgetEur: 32000, coordinatorAdoptionPct: 100 });
  assert.equal(plans[0].eligiblePatientsCount, 1);
  assert.equal(plans[0].estimatedCostEur, 240);
  for (const plan of runInterventionSimulation([], { regionId: '21', severeWeatherActive: true, monthlyBudgetEur: 32000, coordinatorAdoptionPct: 100 })) {
    assert.equal(plan.eligiblePatientsCount, 0); assert.equal(plan.estimatedCostEur, 0);
  }
});
