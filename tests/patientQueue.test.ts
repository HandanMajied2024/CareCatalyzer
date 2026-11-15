import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginatePatients } from '../src/utils/pagination.ts';
import { summarizeCancellationReasons } from '../src/utils/cancellationReasons.ts';
import { INITIAL_PATIENTS } from '../src/data/patients.ts';
import { applyCallOutcomeToPatient } from '../src/utils/riskEngine.ts';

test('pagination caps each page at 30, covers the queue once, and clamps after filtering', () => {
  const records = Array.from({ length: 71 }, (_, i) => i);
  assert.deepEqual([1, 2, 3].flatMap(page => paginatePatients(records, page).items), records);
  assert.deepEqual(paginatePatients(records, 2).items, records.slice(30, 60));
  assert.equal(paginatePatients(records, 3).items.length, 11);
  const filtered = paginatePatients(records.slice(0, 2), 3);
  assert.equal(filtered.page, 1); assert.equal(filtered.from, 1); assert.equal(filtered.to, 2);
  assert.deepEqual(paginatePatients([], 4), { page: 1, pageCount: 1, items: [], from: 0, to: 0 });
});

test('cancellation breakdown excludes missed calls and follow-ups and counts unknown reasons', () => {
  const base = INITIAL_PATIENTS[0];
  const cancelled = (category: typeof base.verifiedBarrier) => ({ ...base, callStatus: 'Appointment Cancelled' as const, verifiedBarrier: category });
  const records = [cancelled('Transport'), cancelled('Transport'), cancelled('Fear / Anxiety'), cancelled('Financial'), cancelled(null),
    { ...base, callStatus: 'No Pick-Up' as const, verifiedBarrier: 'Scheduling' as const },
    { ...base, callStatus: 'Follow-Up Required (Human Callback Queued)' as const, verifiedBarrier: 'Scheduling' as const }];
  const summary = summarizeCancellationReasons(records);
  assert.equal(summary.total, 5);
  assert.equal(summary.groups.reduce((sum, group) => sum + group.count, 0), 5);
  assert.deepEqual(summary.mostCommon.map(group => group.category), ['Transport']);
  assert.equal(summary.groups.find(group => group.category === 'Transport')?.percent, 40);
  assert.equal(summary.groups.find(group => group.category === 'Other')?.count, 1);
  assert.equal(summary.groups.find(group => group.category === 'Scheduling')?.count, 0);
  assert.equal(summarizeCancellationReasons([]).mostCommon.length, 0);
});

test('live cancellation outcomes update reason counts and ties without inferring fear from profiles', () => {
  const base = INITIAL_PATIENTS[0];
  const afraid = applyCallOutcomeToPatient(base, { callStatus: 'Appointment Cancelled', barrierCategory: 'Fear / Anxiety', barrierSummary: 'Patient is scared of the procedure.' });
  const financial = applyCallOutcomeToPatient(base, { callStatus: 'Appointment Cancelled', barrierCategory: 'Financial', barrierSummary: 'Patient cannot afford travel.' });
  const summary = summarizeCancellationReasons([afraid, financial]);
  assert.equal(summary.total, 2);
  assert.equal(summary.mostCommon.length, 2);
  const attending = applyCallOutcomeToPatient(afraid, { callStatus: 'Confirmed Attending' });
  assert.equal(summarizeCancellationReasons([attending, financial]).total, 1);
});
