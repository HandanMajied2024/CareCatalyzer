import type {
  BarrierCategory,
  CallStatus,
  PathwayStage,
  PatientRecord,
  RiskFactorBreakdown,
  RiskTier,
  TierMetadata,
} from '../types/careconnect.ts';

export const RISK_TIERS: TierMetadata[] = [
  {
    tier: 'Low',
    min: 0,
    max: 20,
    color: '#059669',
    badgeClasses: 'bg-cc-green-soft text-black border-cc-green',
  },
  {
    tier: 'Medium',
    min: 21,
    max: 40,
    color: '#0284C7',
    badgeClasses: 'bg-cc-blue-soft text-black border-cc-blue',
  },
  {
    tier: 'High Risk',
    min: 41,
    max: 60,
    color: '#D97706',
    badgeClasses: 'bg-cc-yellow-soft text-black border-cc-yellow',
  },
  {
    tier: 'Very High Risk',
    min: 61,
    max: 80,
    color: '#EA580C',
    badgeClasses: 'bg-cc-red-soft text-black border-cc-red',
  },
  {
    tier: 'Urgent',
    min: 81,
    max: 100,
    color: '#DC2626',
    badgeClasses: 'bg-cc-red text-white border-cc-red',
  },
];

export const BARRIER_CATEGORIES: BarrierCategory[] = [
  'Transport',
  'Weather',
  'Scheduling',
  'Accessibility',
  'Language',
  'Other',
];

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getRiskTier(score: number): RiskTier {
  const s = clampScore(score);
  if (s <= 20) return 'Low';
  if (s <= 40) return 'Medium';
  if (s <= 60) return 'High Risk';
  if (s <= 80) return 'Very High Risk';
  return 'Urgent';
}

export function getTierMeta(tier: RiskTier): TierMetadata {
  return RISK_TIERS.find((t) => t.tier === tier) ?? RISK_TIERS[0];
}

export function getTierColor(tier: RiskTier): string {
  return getTierMeta(tier).color;
}

export function computeGoal3AtRisk(params: {
  daysElapsed: number;
  daysUntilAppointment: number;
  targetDaysTotal: number;
  callStatus: CallStatus;
}): boolean {
  if (params.callStatus === 'Appointment Cancelled') return true;
  const projectedDays = params.daysElapsed + params.daysUntilAppointment;
  if (params.callStatus === 'Follow-Up Required (Human Callback Queued)') {
    return projectedDays + 5 > params.targetDaysTotal;
  }
  if (params.callStatus === 'No Pick-Up') {
    return projectedDays + 4 > params.targetDaysTotal;
  }
  return projectedDays >= params.targetDaysTotal - 1;
}

export function computeBaselineRisk(params: {
  age: number;
  pathwayStage: PathwayStage;
  cancerStage: PatientRecord['cancerStage'];
  g8FrailtyScore: number;
  distanceKm: number;
  languageBarrier: boolean;
  financialVulnerability: boolean;
  accessibilityNeed: boolean;
  priorMissedCalls: number;
  daysElapsed: number;
  daysUntilAppointment: number;
  targetDaysTotal: number;
}): { score: number; tier: RiskTier; breakdown: RiskFactorBreakdown; goal3AtRisk: boolean } {
  // 1. Pathway & clinical stage urgency (0..28)
  let pathwayUrgencyPoints = 8;
  if (params.pathwayStage === 'Diagnostic Workup') pathwayUrgencyPoints = 15;
  if (params.pathwayStage === 'Treatment Initiation') pathwayUrgencyPoints = 19;
  if (params.cancerStage === 'Stage III') pathwayUrgencyPoints += 5;
  if (params.cancerStage === 'Stage IV') pathwayUrgencyPoints += 8;

  // 2. Age & G8 frailty (0..20)
  let ageFrailtyPoints = 0;
  if (params.age >= 80) ageFrailtyPoints += 10;
  else if (params.age >= 75) ageFrailtyPoints += 7;
  else if (params.age >= 65) ageFrailtyPoints += 3;

  if (params.g8FrailtyScore <= 10) ageFrailtyPoints += 10;
  else if (params.g8FrailtyScore <= 14) ageFrailtyPoints += 5;

  // 3. Geographic distance & northern winter exposure (0..24)
  let distanceWeatherPoints = 2;
  if (params.distanceKm >= 350) distanceWeatherPoints = 24;
  else if (params.distanceKm >= 180) distanceWeatherPoints = 18;
  else if (params.distanceKm >= 90) distanceWeatherPoints = 11;
  else if (params.distanceKm >= 40) distanceWeatherPoints = 6;

  // 4. Equity, language & accessibility (0..16)
  let equityLanguagePoints = 0;
  if (params.languageBarrier) equityLanguagePoints += 7;
  if (params.financialVulnerability) equityLanguagePoints += 5;
  if (params.accessibilityNeed) equityLanguagePoints += 4;

  // 5. Missed call history & Goal 3 timeframe tightness (0..12)
  let historyMissedPoints = Math.min(6, params.priorMissedCalls * 3);
  const bufferDays = params.targetDaysTotal - (params.daysElapsed + params.daysUntilAppointment);
  if (bufferDays <= 2) historyMissedPoints += 6;
  else if (bufferDays <= 5) historyMissedPoints += 3;

  const total = clampScore(
    pathwayUrgencyPoints +
      ageFrailtyPoints +
      distanceWeatherPoints +
      equityLanguagePoints +
      historyMissedPoints
  );

  return {
    score: total,
    tier: getRiskTier(total),
    breakdown: {
      pathwayUrgencyPoints,
      ageFrailtyPoints,
      distanceWeatherPoints,
      equityLanguagePoints,
      historyMissedPoints,
    },
    goal3AtRisk: computeGoal3AtRisk({
      daysElapsed: params.daysElapsed,
      daysUntilAppointment: params.daysUntilAppointment,
      targetDaysTotal: params.targetDaysTotal,
      callStatus: 'Pending Call',
    }),
  };
}

export function getDefaultActionForBarrier(
  category: BarrierCategory,
  patient: PatientRecord
): string {
  switch (category) {
    case 'Transport':
      return patient.distanceKm >= 120
        ? `Hold ${patient.pathwayStage} slot (never cancel); issue upfront Kela medical taxi voucher or Shared Regional Shuttle pickup for ${patient.municipality} (${patient.distanceKm} km).`
        : `Hold slot & arrange Kela subsidized patient transport into ${patient.regionId === 'OYS_LAPLAND' ? 'OYS/Rovaniemi' : patient.regionId === 'KYS_SAVO' ? 'KYS Kuopio' : 'HUS Meilahti'}.`;
    case 'Weather':
      return `Activate winter storm contingency: preserve fast-track slot, pair Kela 4WD medical transport or shift pre-visit prep to remote telehealth.`;
    case 'Scheduling':
      return `Hold slot & move to flexible evening/bundled diagnostic block; coordinate TYÖOTE occupational flexibility if employed.`;
    case 'Accessibility':
      return `URGENT nurse/frailty check: arrange wheelchair-accessible medical transport, escort support, or Kotisairaala home-hospital assessment.`;
    case 'Language':
      return `Assign Care Coordinator (nimetty työntekijä) + certified ${patient.primaryLanguage} interpreter to confirm fast-track preparation instructions.`;
    case 'Other':
      return `Queue Care Coordinator (nimetty työntekijä) human callback within 4 hours while keeping appointment protected.`;
  }
}

export function applyCallOutcomeToPatient(
  patient: PatientRecord,
  outcome: {
    callStatus: CallStatus;
    barrierCategory?: BarrierCategory | null;
    barrierSummary?: string | null;
    recommendedAction?: string | null;
    clinicalNurseAlert?: boolean;
    overriddenByHuman?: boolean;
    humanCoordinatorRequested?: boolean;
  }
): PatientRecord {
  let deltaFromBaseline = 0;
  let humanCoordinatorRequested =
    outcome.humanCoordinatorRequested ?? patient.humanCoordinatorRequested;
  let clinicalNurseAlert = Boolean(outcome.clinicalNurseAlert);
  let aiDetectedBarrier = patient.aiDetectedBarrier;
  let verifiedBarrier = patient.verifiedBarrier;
  let barrierSummary = outcome.barrierSummary ?? patient.barrierSummary;
  let recommendedAction = outcome.recommendedAction ?? patient.recommendedAction;

  if (outcome.callStatus === 'Confirmed Attending') {
    deltaFromBaseline = -14;
    aiDetectedBarrier = null;
    verifiedBarrier = null;
    barrierSummary = 'Patient confirmed attendance. The fast-track appointment is held.';
    recommendedAction =
      patient.distanceKm >= 120
        ? 'Confirm Kela travel reimbursement eligibility via SMS reminder.'
        : 'Standard digital check-in active; no pathway delay expected.';
    clinicalNurseAlert = false;
  } else if (outcome.callStatus === 'Appointment Cancelled') {
    deltaFromBaseline = 20;
    const cat = outcome.barrierCategory ?? 'Other';
    aiDetectedBarrier = cat;
    verifiedBarrier = cat;
    humanCoordinatorRequested = true;
    barrierSummary = outcome.barrierSummary ?? 'Patient cancelled after being asked for the reason.';
    recommendedAction =
      outcome.recommendedAction ??
      'Appointment cancelled in the demo schedule; notify the care team and offer rescheduling support.';
  } else if (outcome.callStatus === 'No Pick-Up') {
    deltaFromBaseline = 14;
    humanCoordinatorRequested = true;
    barrierSummary =
      outcome.barrierSummary ??
      'Automated outreach unanswered / voicemail; Care Coordinator callback queued.';
    recommendedAction =
      outcome.recommendedAction ??
      'Send SMS callback link + trigger human Care Coordinator (nimetty työntekijä) outreach within 2 hours.';
  } else if (outcome.callStatus === 'Follow-Up Required (Human Callback Queued)') {
    const cat: BarrierCategory = outcome.barrierCategory ?? 'Other';
    if (!outcome.overriddenByHuman) {
      aiDetectedBarrier = cat;
    }
    verifiedBarrier = cat;
    humanCoordinatorRequested = true;

    if (cat === 'Accessibility') {
      deltaFromBaseline = 20;
      clinicalNurseAlert = outcome.clinicalNurseAlert ?? true;
    } else if (cat === 'Transport' || cat === 'Weather') {
      deltaFromBaseline = 15;
    } else if (cat === 'Language') {
      deltaFromBaseline = 12;
    } else if (cat === 'Scheduling') {
      deltaFromBaseline = 8;
    } else {
      deltaFromBaseline = 10;
    }

    recommendedAction =
      outcome.recommendedAction || getDefaultActionForBarrier(cat, patient);
  }

  const nextScore = clampScore(patient.baselineScore + deltaFromBaseline);
  const actualDelta = nextScore - patient.baselineScore;
  const nextTier = getRiskTier(nextScore);
  const goal3AtRisk = computeGoal3AtRisk({
    daysElapsed: patient.daysElapsed,
    daysUntilAppointment: patient.daysUntilAppointment,
    targetDaysTotal: patient.targetDaysTotal,
    callStatus: outcome.callStatus,
  });

  return {
    ...patient,
    riskScore: nextScore,
    scoreDelta: actualDelta,
    riskTier: nextTier,
    goal3AtRisk,
    callStatus: outcome.callStatus,
    aiDetectedBarrier,
    verifiedBarrier,
    overriddenByHuman: Boolean(outcome.overriddenByHuman || patient.overriddenByHuman),
    barrierSummary,
    recommendedAction,
    clinicalNurseAlert,
    humanCoordinatorRequested,
    lastUpdatedAt: new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}
