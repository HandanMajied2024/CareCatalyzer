import { FOCUS_REGIONS } from '../data/patients.ts';
import type {
  FocusRegionId,
  InterventionComparison,
  PatientRecord,
} from '../types/careconnect.ts';

export interface SimulationParams {
  regionId: FocusRegionId;
  severeWeatherActive: boolean;
  monthlyBudgetEur: number; // e.g., 10000 .. 60000
  coordinatorAdoptionPct: number; // 40 .. 100
}

/**
 * Computes transparent, uncertainty-bounded policy simulations driven directly by
 * live Tab 1/Tab 2 regional barrier rates and Goal 3 target-timeframe risk.
 */
export function runInterventionSimulation(
  patients: PatientRecord[],
  params: SimulationParams
): InterventionComparison[] {
  const regionPatients = patients.filter((p) => p.regionId === params.regionId);
  const regionMeta = FOCUS_REGIONS[params.regionId];

  const transportOrWeatherCount = regionPatients.filter(
    (p) => p.verifiedBarrier === 'Transport' || p.verifiedBarrier === 'Weather'
  ).length;
  const schedulingOrLangCount = regionPatients.filter(
    (p) =>
      p.verifiedBarrier === 'Scheduling' ||
      p.verifiedBarrier === 'Language' ||
      p.verifiedBarrier === 'Accessibility'
  ).length;
  const unreachedCount = regionPatients.filter((p) => p.callStatus === 'No Pick-Up').length;
  const ruralCount = regionPatients.filter((p) => p.distanceKm >= 100).length;

  const weatherMultiplier = params.severeWeatherActive
    ? 1 + regionMeta.winterExposureIndex * 0.45
    : 1.0;

  const budgetScale = Math.min(1.25, Math.max(0.55, params.monthlyBudgetEur / 32000));
  const adoptionScale = params.coordinatorAdoptionPct / 100;

  // 1. Shared Regional Medical Shuttle
  const shuttleEligible = Math.max(
    1,
    ruralCount + transportOrWeatherCount
  );
  const shuttleCost = Math.round(
    (params.regionId === 'OYS_LAPLAND' ? 28500 : params.regionId === 'KYS_SAVO' ? 21000 : 14500) *
      (0.7 + budgetScale * 0.3) *
      (params.severeWeatherActive ? 1.15 : 1.0)
  );
  const shuttleEff =
    (params.regionId === 'OYS_LAPLAND' ? 1.18 : params.regionId === 'KYS_SAVO' ? 1.05 : 0.68) *
    weatherMultiplier *
    adoptionScale *
    Math.min(1.15, budgetScale);

  const shuttleGainMid = Math.min(28, Math.round((9 + transportOrWeatherCount * 1.4) * shuttleEff));
  const shuttleDaysMid = Number(((2.4 + transportOrWeatherCount * 0.35) * shuttleEff).toFixed(1));
  const shuttleGapMid = Math.min(48, Math.round(shuttleGainMid * 1.45));

  // 2. Expanded Travel Vouchers & Upfront Kela Taxi Coverage
  const voucherEligible = Math.max(
    1,
    regionPatients.filter((p) => p.financialVulnerability || p.verifiedBarrier === 'Transport').length
  );
  const voucherCost = Math.round(
    (12500 + voucherEligible * 480) *
      (0.65 + budgetScale * 0.35) *
      (params.severeWeatherActive ? 1.22 : 1.0)
  );
  const voucherEff =
    (params.regionId === 'OYS_LAPLAND' ? 1.12 : params.regionId === 'KYS_SAVO' ? 0.96 : 0.88) *
    weatherMultiplier *
    adoptionScale *
    Math.min(1.15, budgetScale);

  const voucherGainMid = Math.min(26, Math.round((8 + voucherEligible * 0.9) * voucherEff));
  const voucherDaysMid = Number(((2.1 + transportOrWeatherCount * 0.28) * voucherEff).toFixed(1));
  const voucherGapMid = Math.min(44, Math.round(voucherGainMid * 1.38));

  // 3. Flexible Scheduling + Navigation / Eligible Remote Prep Consults
  const navEligible = Math.max(1, schedulingOrLangCount + unreachedCount + 2);
  const navCost = Math.round(
    (11000 + navEligible * 320) * (0.75 + budgetScale * 0.25)
  );
  const navEff =
    (params.regionId === 'HUS_UUSIMAA' ? 1.28 : params.regionId === 'KYS_SAVO' ? 1.12 : 0.85) *
    (params.severeWeatherActive ? 1.08 : 1.0) *
    adoptionScale *
    Math.min(1.15, budgetScale);

  const navGainMid = Math.min(27, Math.round((8.5 + schedulingOrLangCount * 1.1) * navEff));
  const navDaysMid = Number(((1.9 + schedulingOrLangCount * 0.25) * navEff).toFixed(1));
  const navGapMid = Math.min(46, Math.round(navGainMid * 1.4));

  return [
    {
      id: 'shared_shuttle',
      name: 'Shared Regional Medical Shuttle',
      shortName: 'Shared Medical Shuttle',
      mechanism:
        'Pools rural diagnostic & radiotherapy patients along scheduled winter-equipped regional corridors (e.g., Ivalo–Rovaniemi–OYS), preventing silent missed CT/biopsy slots when public buses do not align.',
      evidenceBase: [
        'Finland National Cancer Strategy 2026–2035 (Goal 3): closing >50 km NSCLC rural survival & palliative gaps.',
        'Nordic SVF / Pakkeforløb fast-track diagnostics: structured transit reduces pre-biopsy attrition in low-density counties.',
        'Kela medical transport pooling pilot benchmarks in Lapland & Kainuu.',
      ],
      assumptions: [
        'Synthetic model estimate assuming 4-wheel winter fleet availability and minimum 3 pooled riders per corridor.',
        `Severe weather toggle multiplies rural attrition sensitivity by ${weatherMultiplier.toFixed(2)}x based on regional winter index.`,
        'Requires prospective 90-day pilot validation with wellbeing services county (hyvinvointialue) dispatch.',
      ],
      estimatedCostEur: shuttleCost,
      costRangeText: `€${Math.round(shuttleCost * 0.85).toLocaleString()} – €${Math.round(shuttleCost * 1.18).toLocaleString()}/mo`,
      attendanceGainPctLow: Math.max(3, shuttleGainMid - 4),
      attendanceGainPctHigh: Math.min(35, shuttleGainMid + 5),
      daysSavedLow: Math.max(1.1, Number((shuttleDaysMid * 0.72).toFixed(1))),
      daysSavedHigh: Number((shuttleDaysMid * 1.32).toFixed(1)),
      equityGapReductionPctLow: Math.max(6, shuttleGapMid - 7),
      equityGapReductionPctHigh: Math.min(60, shuttleGapMid + 8),
      eligiblePatientsCount: shuttleEligible,
      actionTemplate: `Assign Shared Medical Shuttle pickup & reserve protected ${params.regionId} diagnostic slot`,
    },
    {
      id: 'travel_vouchers',
      name: 'Expanded Travel Vouchers & Upfront Kela Taxi',
      shortName: 'Kela Upfront Vouchers',
      mechanism:
        'Removes the upfront out-of-pocket co-pay and reimbursement wait by issuing instant digital Kela taxi authorizations during the AI call when Transport or Financial friction is detected.',
      evidenceBase: [
        'Kela matkakorvaus travel reimbursement statistics showing co-pay burden on low-income & 75+ pensioners.',
        'Finland Cancer Strategy 2026–2035 (Pillar 1 & 3): reducing financial toxicity and out-of-pocket diagnostic barriers.',
      ],
      assumptions: [
        'Synthetic estimate assuming digital voucher issuance integrates with regional Kela taxi dispatch at point of outreach.',
        'Per-trip cost scales with distance; severe winter conditions raise unit taxi surcharge by +22%.',
        'Requires Kela & wellbeing services county reimbursement agreement before production rollout.',
      ],
      estimatedCostEur: voucherCost,
      costRangeText: `€${Math.round(voucherCost * 0.82).toLocaleString()} – €${Math.round(voucherCost * 1.24).toLocaleString()}/mo`,
      attendanceGainPctLow: Math.max(3, voucherGainMid - 4),
      attendanceGainPctHigh: Math.min(32, voucherGainMid + 4),
      daysSavedLow: Math.max(1.0, Number((voucherDaysMid * 0.7).toFixed(1))),
      daysSavedHigh: Number((voucherDaysMid * 1.3).toFixed(1)),
      equityGapReductionPctLow: Math.max(5, voucherGapMid - 6),
      equityGapReductionPctHigh: Math.min(55, voucherGapMid + 7),
      eligiblePatientsCount: voucherEligible,
      actionTemplate: `Issue upfront Kela medical taxi voucher (matkakorvaus) & queue coordinator confirmation`,
    },
    {
      id: 'flexible_navigation',
      name: 'Flexible Scheduling + Navigation & Remote Prep',
      shortName: 'Flex Slots + Navigation',
      mechanism:
        'Combines Care Coordinator (nimetty työntekijä) multilingual navigation, extended evening/clustered clinic slots (TYÖOTE), and remote pre-biopsy prep consults to prevent unnecessary physical travel and work-shift conflicts.',
      evidenceBase: [
        'Finland Cancer Strategy 2026–2035 (Pillar 1): Named Care Coordinators & multilingual outreach narrow urban/immigrant delays.',
        'TYÖOTE & SVF outpatient coordination studies demonstrating faster diagnostic completion for working-age adults.',
      ],
      assumptions: [
        'Synthetic estimate assuming oncology imaging & infusion clinics allocate 15% evening/flex slot capacity.',
        'Remote prep consults apply only to clinically eligible pre-visit clearance (never replacing physical CT/biopsy).',
        'Requires local nurse-coordinator staffing validation prior to operational scale-up.',
      ],
      estimatedCostEur: navCost,
      costRangeText: `€${Math.round(navCost * 0.88).toLocaleString()} – €${Math.round(navCost * 1.15).toLocaleString()}/mo`,
      attendanceGainPctLow: Math.max(3, navGainMid - 3),
      attendanceGainPctHigh: Math.min(34, navGainMid + 4),
      daysSavedLow: Math.max(0.9, Number((navDaysMid * 0.72).toFixed(1))),
      daysSavedHigh: Number((navDaysMid * 1.28).toFixed(1)),
      equityGapReductionPctLow: Math.max(6, navGapMid - 6),
      equityGapReductionPctHigh: Math.min(58, navGapMid + 7),
      eligiblePatientsCount: navEligible,
      actionTemplate: `Schedule flexible slot + assign Care Coordinator (nimetty työntekijä) & remote prep`,
    },
  ];
}
