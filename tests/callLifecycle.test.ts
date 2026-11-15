import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_PATIENTS } from '../src/data/patients.ts';
import { finishPatientCall } from '../src/utils/callLifecycle.ts';

test('disconnection clears Calling Live and records the attempt', () => {
  const result = finishPatientCall({ ...INITIAL_PATIENTS[0], callStatus: 'Calling Live' });
  assert.equal(result.callStatus, 'Pending Call');
  assert.ok(result.lastUpdatedAt);
});

test('an interrupted retry preserves an existing follow-up obligation', () => {
  const result = finishPatientCall({ ...INITIAL_PATIENTS[0], callStatus: 'Calling Live' }, 'Follow-Up Required (Human Callback Queued)');
  assert.equal(result.callStatus, 'Follow-Up Required (Human Callback Queued)');
});

test('ending a call preserves every completed outcome and its score', () => {
  for (const status of ['Confirmed Attending', 'Appointment Cancelled', 'Follow-Up Required (Human Callback Queued)'] as const) {
    const patient = { ...INITIAL_PATIENTS[0], callStatus: status, riskScore: 42 };
    const result = finishPatientCall(patient);
    assert.equal(result.callStatus, status);
    assert.equal(result.riskScore, 42);
  }
});
