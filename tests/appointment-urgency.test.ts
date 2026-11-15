import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBaselineRisk } from '../src/utils/riskEngine.ts';

const base = {
  age: 60,
  pathwayStage: 'Referral' as const,
  cancerStage: 'Stage I' as const,
  g8FrailtyScore: 17,
  distanceKm: 20,
  languageBarrier: false,
  financialVulnerability: false,
  accessibilityNeed: false,
  priorMissedCalls: 0,
  daysElapsed: 5,
  targetDaysTotal: 14,
};

test('a near appointment does not add urgency without a recorded access risk', () => {
  const result = computeBaselineRisk({ ...base, daysUntilAppointment: 2 });
  assert.equal(result.breakdown.appointmentTimingPoints, 0);
});

test('a near appointment adds coordination urgency when an access risk is recorded', () => {
  const result = computeBaselineRisk({
    ...base,
    financialVulnerability: true,
    daysUntilAppointment: 2,
  });
  assert.equal(result.breakdown.appointmentTimingPoints, 12);
});

test('an overdue appointment is urgent even without another access risk', () => {
  const result = computeBaselineRisk({ ...base, daysUntilAppointment: -1 });
  assert.equal(result.breakdown.appointmentTimingPoints, 15);
});
