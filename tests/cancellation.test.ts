import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PATIENTS } from '../src/data/patients.ts';
import { applyCallOutcomeToPatient } from '../src/utils/riskEngine.ts';

test('cancelling records the reason and raises a care-team follow-up', () => {
  const patient = INITIAL_PATIENTS.find((item) => item.callStatus === 'Pending Call');
  assert(patient);

  const cancelled = applyCallOutcomeToPatient(patient, {
    callStatus: 'Appointment Cancelled',
    barrierCategory: 'Transport',
    barrierSummary: 'Patient asked to cancel because no transport was available.',
  });

  assert.equal(cancelled.callStatus, 'Appointment Cancelled');
  assert.equal(cancelled.verifiedBarrier, 'Transport');
  assert.equal(cancelled.humanCoordinatorRequested, true);
  assert.equal(cancelled.goal3AtRisk, true);
  assert(cancelled.riskScore >= patient.riskScore);
  assert.match(cancelled.recommendedAction ?? '', /cancelled/i);
});
