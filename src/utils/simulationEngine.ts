import type { FocusRegionId, InterventionComparison, InterventionId, PatientRecord } from '../types/careconnect.ts';
import { FOCUS_REGIONS } from '../data/regions.ts';
export interface SimulationParams {
  regionId: FocusRegionId; severeWeatherActive: boolean;
  monthlyBudgetEur: number; coordinatorAdoptionPct: number;
}
export function getEligiblePatients(patients: PatientRecord[], regionId: FocusRegionId, interventionId: InterventionId) {
  return patients.filter(p => {
    if (p.regionId !== regionId || p.callStatus === 'Confirmed Attending' || p.callStatus === 'Appointment Cancelled') return false;
    if (interventionId === 'shared_shuttle') return p.distanceKm >= 100 || p.verifiedBarrier === 'Transport' || p.verifiedBarrier === 'Weather';
    if (interventionId === 'travel_vouchers') return p.financialVulnerability || p.verifiedBarrier === 'Transport' || p.verifiedBarrier === 'Financial';
    return p.humanCoordinatorRequested || p.callStatus === 'No Pick-Up' || p.verifiedBarrier === 'Scheduling' || p.verifiedBarrier === 'Language' || p.verifiedBarrier === 'Accessibility' || p.verifiedBarrier === 'Fear / Anxiety';
  });
}
// Planning assumptions only. No regional efficacy or clinical confidence intervals are inferred.
export function runInterventionSimulation(patients: PatientRecord[], params: SimulationParams): InterventionComparison[] {
  const plans = [
    { id: 'shared_shuttle' as const, name: 'Shared transport', mechanism: 'Group patients with compatible routes and appointment times.', unitCost: 80, distanceCost: 0.8, action: 'Review shared transport routes and appointment compatibility' },
    { id: 'travel_vouchers' as const, name: 'Travel support', mechanism: 'Review travel costs and available reimbursement or transport support.', unitCost: 40, distanceCost: 1.2, action: 'Review travel support eligibility and arrange assistance' },
    { id: 'flexible_navigation' as const, name: 'Care coordination', mechanism: 'Arrange callbacks, language assistance and suitable appointment times.', unitCost: 60, distanceCost: 0, action: 'Review callback, language and scheduling needs' },
  ];
  return plans.map(plan => {
    const eligible = getEligiblePatients(patients, params.regionId, plan.id);
    const weatherFactor = params.severeWeatherActive && plan.distanceCost > 0 ? 1.2 : 1;
    const cost = Math.round(eligible.reduce((total, p) => total + (plan.unitCost + p.distanceKm * plan.distanceCost) * weatherFactor, 0));
    return {
      id: plan.id, name: plan.name, shortName: plan.name, mechanism: plan.mechanism,
      evidenceBase: [],
      assumptions: ['Cost allowance per patient: €' + plan.unitCost + (plan.distanceCost ? ' + €' + plan.distanceCost + ' per recorded kilometre.' : '.'),
        'Confirm costs and availability with local providers.'],
      estimatedCostEur: cost, costRangeText: '€' + cost.toLocaleString('en-GB'),
      attendanceGainPctLow: 0, attendanceGainPctHigh: 0, daysSavedLow: 0, daysSavedHigh: 0,
      equityGapReductionPctLow: 0, equityGapReductionPctHigh: 0,
      eligiblePatientsCount: eligible.length,
      actionTemplate: plan.action + ' in ' + FOCUS_REGIONS[params.regionId].name + '.',
    };
  });
}
