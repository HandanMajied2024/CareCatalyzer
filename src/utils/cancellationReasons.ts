import type { BarrierCategory, PatientRecord } from '../types/careconnect.ts';

export const CANCELLATION_REASON_LABELS: Record<BarrierCategory, string> = {
  Transport: 'Transportation', Scheduling: 'Time constraints', 'Fear / Anxiety': 'Fear or anxiety',
  Financial: 'Financial difficulty', Accessibility: 'Health or mobility', Weather: 'Weather',
  Language: 'Language', Other: 'Other / not specified',
};
// One recorded primary reason per cancellation; never guess from diagnosis, income or transcript keywords.
export function summarizeCancellationReasons(patients: PatientRecord[]) {
  const cancelled = patients.filter(p => p.callStatus === 'Appointment Cancelled');
  const groups = (Object.entries(CANCELLATION_REASON_LABELS) as [BarrierCategory, string][]).map(([category, label]) => {
    const count = cancelled.filter(p => (p.verifiedBarrier ?? 'Other') === category).length;
    return { category, label, count, percent: cancelled.length ? Math.round(count / cancelled.length * 100) : 0 };
  }).sort((a, b) => b.count - a.count);
  const mostCommon = groups.filter(group => group.count > 0 && group.count === groups[0]?.count);
  return { total: cancelled.length, groups, mostCommon };
}
