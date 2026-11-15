import { FOCUS_REGION_ORDER } from '../data/regions.ts';
import type { PatientRecord } from '../types/careconnect.ts';

export type RegionCategory = 'green' | 'yellow' | 'orange' | 'red';
export const REGION_CATEGORY_RULES: Record<RegionCategory, string> = {
  green: 'Below all yellow thresholds',
  yellow: '≥7 urgent OR ≥1 very risky OR ≥20 risky',
  orange: '≥15 urgent OR ≥30 very risky OR ≥40 risky',
  red: '≥30 urgent OR ≥50 very risky',
};
export function getRegionCategory(counts: { urgent: number; veryHigh: number; high: number }): RegionCategory {
  if (counts.urgent >= 30 || counts.veryHigh >= 50) return 'red';
  if (counts.urgent >= 15 || counts.veryHigh >= 30 || counts.high >= 40) return 'orange';
  if (counts.urgent >= 7 || counts.veryHigh >= 1 || counts.high >= 20) return 'yellow';
  return 'green';
}

export function getRegionalSummaries(patients: PatientRecord[]) {
  return FOCUS_REGION_ORDER.map(regionId => {
    const records = patients.filter(p => p.regionId === regionId);
    return {
      regionId, total: records.length,
      urgent: records.filter(p => p.riskTier === 'Urgent').length,
      veryHigh: records.filter(p => p.riskTier === 'Very High Risk').length,
      high: records.filter(p => p.riskTier === 'High Risk').length,
      followUp: records.filter(p => p.humanCoordinatorRequested).length,
      unanswered: records.filter(p => p.callStatus === 'No Pick-Up').length,
      confirmed: records.filter(p => p.callStatus === 'Confirmed Attending').length,
      barriers: records.filter(p => p.verifiedBarrier && p.callStatus !== 'Confirmed Attending').length,
    };
  }).sort((a, b) => b.urgent - a.urgent || b.veryHigh - a.veryHigh || a.regionId.localeCompare(b.regionId));
}
export function getAttentionRegions(patients: PatientRecord[]) {
  const summaries = getRegionalSummaries(patients);
  const maximum = summaries[0]?.urgent ?? 0;
  return maximum > 0 ? summaries.filter(region => region.urgent === maximum) : [];
}
