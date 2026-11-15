import { FOCUS_REGION_ORDER } from '../data/regions.ts';
import type { FocusRegionId, PatientRecord } from '../types/careconnect.ts';

// Goal 3 indicator (National Cancer Strategy 2026–2035; THL Ohjaus 21/2016):
// share of patients whose treatment starts within the target time (14/21/28 days).
// Computed from SYNTHETIC patients' pathway events. Finland publishes no regional figure yet.
export function isTreatmentOnTarget(p: PatientRecord): boolean {
  const projected = p.daysElapsed + Math.max(0, p.daysUntilAppointment);
  switch (p.callStatus) {
    case 'Appointment Cancelled':
      return false;
    case 'Confirmed Attending':
      return projected <= p.targetDaysTotal;
    case 'Follow-Up Required (Human Callback Queued)':
      if (p.verifiedBarrier === 'Transport' || p.verifiedBarrier === 'Weather' || p.verifiedBarrier === 'Financial') {
        // Handled by the agent in this session: Kela taxi / reimbursement arranged (~1 day).
        // Seeded follow-ups (lastUpdatedAt null) still have no ride arranged.
        return Boolean(p.lastUpdatedAt) && projected + 1 <= p.targetDaysTotal;
      }
      return projected + 5 <= p.targetDaysTotal;
    case 'No Pick-Up':
      return projected + 4 <= p.targetDaysTotal;
    default:
      // Not yet contacted: trips over 50 km without arranged transport are where pathways stall
      return p.distanceKm <= 50 && projected <= p.targetDaysTotal;
  }
}

export function goal3Share(patients: PatientRecord[]): { onTarget: number; total: number; percent: number } {
  const onTarget = patients.filter(isTreatmentOnTarget).length;
  return { onTarget, total: patients.length, percent: patients.length ? Math.round((onTarget / patients.length) * 100) : 0 };
}

export function goal3ByRegion(patients: PatientRecord[]): Record<FocusRegionId, ReturnType<typeof goal3Share>> {
  return Object.fromEntries(FOCUS_REGION_ORDER.map((id) => [id, goal3Share(patients.filter((p) => p.regionId === id))])) as Record<FocusRegionId, ReturnType<typeof goal3Share>>;
}
