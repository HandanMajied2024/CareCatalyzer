export type FocusRegionId = 'OYS_LAPLAND' | 'KYS_SAVO' | 'HUS_UUSIMAA';

export type PathwayStage = 'Referral' | 'Diagnostic Workup' | 'Treatment Initiation';

export type RiskTier =
  | 'Low'
  | 'Medium'
  | 'High Risk'
  | 'Very High Risk'
  | 'Urgent';

export type CallStatus =
  | 'Pending Call'
  | 'Calling Live'
  | 'Confirmed Attending'
  | 'Follow-Up Required (Human Callback Queued)'
  | 'No Pick-Up';

export type BarrierCategory =
  | 'Transport'
  | 'Weather'
  | 'Scheduling'
  | 'Accessibility'
  | 'Language'
  | 'Other';

export interface TranscriptLine {
  id: string;
  speaker: 'AI Coordinator' | 'Patient' | 'System';
  text: string;
  timestamp: string;
  probing?: boolean;
}

export interface RiskFactorBreakdown {
  pathwayUrgencyPoints: number;
  ageFrailtyPoints: number;
  distanceWeatherPoints: number;
  equityLanguagePoints: number;
  historyMissedPoints: number;
}

export interface PatientRecord {
  id: string;
  name: string;
  age: number;
  municipality: string;
  wellbeingCounty: string;
  regionId: FocusRegionId;
  positionXZ: [number, number];
  distanceKm: number;
  pathwayStage: PathwayStage;
  cancerDiagnosis: string;
  cancerStage: 'Stage I' | 'Stage II' | 'Stage III' | 'Stage IV';
  g8FrailtyScore: number; // 0..17 (<=14 indicates frailty)
  primaryLanguage: string;
  languageBarrier: boolean;
  financialVulnerability: boolean;
  accessibilityNeed: boolean;
  priorMissedCalls: number;
  targetDaysTotal: number;
  daysElapsed: number;
  daysUntilAppointment: number;
  appointmentType: string;
  appointmentTimeLabel: string;
  // Dynamic scoring & human-in-the-loop outreach state
  baselineScore: number;
  riskScore: number;
  scoreDelta: number;
  riskTier: RiskTier;
  riskBreakdown: RiskFactorBreakdown;
  goal3AtRisk: boolean;
  callStatus: CallStatus;
  aiDetectedBarrier: BarrierCategory | null;
  verifiedBarrier: BarrierCategory | null;
  overriddenByHuman: boolean;
  barrierSummary: string | null;
  recommendedAction: string | null;
  deployedOperationAction: string | null;
  clinicalNurseAlert: boolean;
  humanCoordinatorRequested: boolean;
  lastUpdatedAt: string | null;
  transcript: TranscriptLine[];
}

export interface FocusRegionMeta {
  id: FocusRegionId;
  shortLabel: string;
  name: string;
  finnishName: string;
  hubCity: string;
  hubHospital: string;
  hubXZ: [number, number];
  labelAnchorXZ: [number, number];
  polygonXZ: Array<[number, number]>;
  terrainFill: string;
  accentColor: string;
  profileTag: string;
  winterExposureIndex: number; // 0..1
  counties: string[];
  equityChallenge: string;
}

export interface CallTurnApiResponse {
  aiReply: string;
  outcome: 'continue_probe' | 'confirmed' | 'declined_classified' | 'no_answer';
  needsProbe: boolean;
  barrierCategory: BarrierCategory | null;
  barrierSummary: string | null;
  recommendedAction: string | null;
  clinicalNurseAlert: boolean;
  modelUsed?: string;
}

export interface TierMetadata {
  tier: RiskTier;
  min: number;
  max: number;
  color: string;
  badgeClasses: string;
}

export type InterventionId = 'shared_shuttle' | 'travel_vouchers' | 'flexible_navigation';

export interface InterventionComparison {
  id: InterventionId;
  name: string;
  shortName: string;
  mechanism: string;
  evidenceBase: string[];
  assumptions: string[];
  estimatedCostEur: number;
  costRangeText: string;
  attendanceGainPctLow: number;
  attendanceGainPctHigh: number;
  daysSavedLow: number;
  daysSavedHigh: number;
  equityGapReductionPctLow: number;
  equityGapReductionPctHigh: number;
  eligiblePatientsCount: number;
  actionTemplate: string;
}

export interface DeployedActionLog {
  id: string;
  deployedAt: string;
  regionId: FocusRegionId;
  interventionId: InterventionId;
  interventionName: string;
  severeWeatherActive: boolean;
  affectedPatientCount: number;
  taskSummary: string;
}
