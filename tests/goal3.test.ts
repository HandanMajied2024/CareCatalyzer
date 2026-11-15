import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PATIENTS, FEATURED_DEMO_PATIENT_ID } from '../src/data/patients.ts';
import { goal3ByRegion, goal3Share, isTreatmentOnTarget } from '../src/utils/goal3.ts';
import { applyCallOutcomeToPatient } from '../src/utils/riskEngine.ts';
import { summarizeCancellationReasons } from '../src/utils/cancellationReasons.ts';

test('Goal 3 share is lower in Lapland than in Uusimaa (synthetic data matches the transport story)', () => {
  const byRegion = goal3ByRegion(INITIAL_PATIENTS);
  console.log('goal3', Object.entries(byRegion).map(([id, v]) => id + ':' + v.percent).join(' '), 'FI', goal3Share(INITIAL_PATIENTS).percent);
  assert.ok(byRegion['19'].percent < byRegion['01'].percent);
});

test('demo patient Matti Heikkinen (Kemi, Lapland) is pending and a transport fix raises Goal 3', () => {
  const matti = INITIAL_PATIENTS.find((p) => p.id === FEATURED_DEMO_PATIENT_ID)!;
  assert.equal(matti.name, 'Matti Heikkinen');
  assert.equal(matti.municipality, 'Kemi');
  assert.equal(matti.regionId, '19');
  assert.equal(matti.callStatus, 'Pending Call');
  assert.equal(isTreatmentOnTarget(matti), false);
  const helped = applyCallOutcomeToPatient(matti, { callStatus: 'Follow-Up Required (Human Callback Queued)', barrierCategory: 'Transport', humanCoordinatorRequested: true });
  assert.equal(isTreatmentOnTarget(helped), true);
});

test('Lapland cancellations are led by transport, Uusimaa by scheduling', () => {
  const lap = summarizeCancellationReasons(INITIAL_PATIENTS.filter((p) => p.regionId === '19'));
  const uus = summarizeCancellationReasons(INITIAL_PATIENTS.filter((p) => p.regionId === '01'));
  assert.equal(lap.mostCommon[0].category, 'Transport');
  assert.equal(uus.mostCommon[0].category, 'Scheduling');
});
