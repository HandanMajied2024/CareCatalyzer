import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PATIENTS } from '../src/data/patients.ts';
import { applyCallOutcomeToPatient } from '../src/utils/riskEngine.ts';

test('cancelling records the reason without inventing a coordinator promise', () => {
  const patient = INITIAL_PATIENTS.find((item) => item.callStatus === 'Pending Call');
  assert(patient);

  const cancelled = applyCallOutcomeToPatient(patient, {
    callStatus: 'Appointment Cancelled',
    barrierCategory: 'Transport',
    barrierSummary: 'Patient asked to cancel because no transport was available.',
  });

  assert.equal(cancelled.callStatus, 'Appointment Cancelled');
  assert.equal(cancelled.verifiedBarrier, 'Transport');
  assert.equal(cancelled.humanCoordinatorRequested, false);
  assert.equal(cancelled.goal3AtRisk, true);
  assert(cancelled.riskScore >= patient.riskScore);
  assert.match(cancelled.recommendedAction ?? '', /cancelled/i);
});

test('coordinator follow-up is shown only after it is explicitly promised', () => {
  const patient = INITIAL_PATIENTS.find((item) => item.callStatus === 'Pending Call');
  assert(patient);

  const followUp = applyCallOutcomeToPatient(patient, {
    callStatus: 'Follow-Up Required (Human Callback Queued)',
    barrierCategory: 'Transport',
    barrierSummary: 'Patient needs transport support.',
    humanCoordinatorRequested: true,
  });

  assert.equal(followUp.humanCoordinatorRequested, true);
  assert.equal(followUp.callStatus, 'Follow-Up Required (Human Callback Queued)');
});
