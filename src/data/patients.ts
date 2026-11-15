import type { PatientRecord, FocusRegionId, RiskTier, PathwayStage, BarrierCategory } from '../types/careconnect.ts';
import { computeBaselineRisk, applyCallOutcomeToPatient } from '../utils/riskEngine.ts';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER } from './regions.ts';
export { FOCUS_REGIONS, FOCUS_REGION_ORDER } from './regions.ts';
export const FEATURED_DEMO_PATIENT_ID = 'LUNG-19-01';

// Synthetic fixtures: deliberately exercise 2 red, 4 orange, 1 yellow and 12 green regions.
// These counts do not describe regional prevalence. Colours still come from live patient scores.
const regionalMix: Partial<Record<FocusRegionId, { urgent: number; veryHigh: number; high: number; total: number }>> = {
  '19': { urgent: 34, veryHigh: 8, high: 8, total: 60 },
  '01': { urgent: 30, veryHigh: 12, high: 12, total: 70 },
  '17': { urgent: 18, veryHigh: 10, high: 8, total: 48 },
  '11': { urgent: 16, veryHigh: 9, high: 8, total: 45 },
  '06': { urgent: 5, veryHigh: 32, high: 8, total: 55 },
  '02': { urgent: 3, veryHigh: 8, high: 42, total: 65 },
  '18': { urgent: 7, veryHigh: 5, high: 8, total: 32 },
};
const firstNames = ['Aino', 'Matti', 'Leena', 'Kari', 'Sofia', 'Juhani', 'Liisa', 'Oskari', 'Emma', 'Eero', 'Kaisa', 'Antti'];
const lastNames = ['Korhonen', 'Virtanen', 'Nieminen', 'Mäkinen', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lindberg'];
const appointments: Record<PathwayStage, string> = {
  Referral: 'Pulmonology intake', 'Diagnostic Workup': 'CT and biopsy assessment', 'Treatment Initiation': 'Treatment planning visit',
};
const cancellationExamples: { category: BarrierCategory; reason: string }[] = [
  { category: 'Transport', reason: 'Patient cancelled because no ride or public transport was available.' },
  { category: 'Scheduling', reason: 'Patient cancelled because work and caregiving commitments left no time for the appointment.' },
  { category: 'Fear / Anxiety', reason: 'Patient cancelled because they felt scared of the procedure and its results.' },
  { category: 'Financial', reason: 'Patient cancelled because they could not afford the travel expenses.' },
  { category: 'Accessibility', reason: 'Patient cancelled because mobility difficulties prevented travel.' },
  { category: 'Weather', reason: 'Patient cancelled because icy roads prevented safe travel.' },
  { category: 'Language', reason: 'Patient cancelled because they did not understand the appointment instructions.' },
  { category: 'Other', reason: 'Patient asked to cancel and chose not to disclose a reason.' },
];

// Profiles have distinct access needs and appointment timing. All scores and outcome deltas
// are calculated by the same risk engine used for calls; no score or map colour is overridden.
function createProfile(tier: RiskTier, seed: number) {
  const base = {
    age: 45 + seed % 20, pathwayStage: 'Referral' as PathwayStage,
    cancerStage: 'Stage II' as PatientRecord['cancerStage'], g8FrailtyScore: 17,
    distanceKm: 5 + seed % 30, languageBarrier: false, financialVulnerability: false,
    accessibilityNeed: false, priorMissedCalls: 0, daysElapsed: 3 + seed % 10,
    daysUntilAppointment: 9 + seed % 4, targetDaysTotal: 14,
  };
  if (tier === 'Urgent') return { ...base, age: 80 + seed % 8,
    pathwayStage: 'Treatment Initiation' as const, cancerStage: 'Stage III' as const,
    g8FrailtyScore: 9 + seed % 2, distanceKm: 90 + seed % 40,
    financialVulnerability: true, priorMissedCalls: 2, daysUntilAppointment: seed % 4, targetDaysTotal: 28 };
  if (tier === 'Very High Risk') return { ...base, age: 75 + seed % 5,
    pathwayStage: 'Treatment Initiation' as const, g8FrailtyScore: 11 + seed % 4,
    distanceKm: 40 + seed % 40, financialVulnerability: true, priorMissedCalls: 1,
    daysUntilAppointment: 4 + seed % 4, targetDaysTotal: 28 };
  if (tier === 'High Risk') return { ...base, age: 65 + seed % 10,
    pathwayStage: 'Diagnostic Workup' as const, g8FrailtyScore: 11 + seed % 4,
    distanceKm: 40 + seed % 40, financialVulnerability: true,
    daysUntilAppointment: 4 + seed % 4, targetDaysTotal: 21 };
  if (tier === 'Medium') return { ...base, age: 65 + seed % 10,
    pathwayStage: 'Treatment Initiation' as const, distanceKm: 40 + seed % 40, targetDaysTotal: 28 };
  return base;
}

let sequence = 0;
export const INITIAL_PATIENTS: PatientRecord[] = FOCUS_REGION_ORDER.flatMap((regionId, regionIndex) => {
  const region = FOCUS_REGIONS[regionId];
  const mix = regionalMix[regionId] ?? { urgent: 0, veryHigh: 0, high: 5 + regionIndex % 6, total: 20 + regionIndex % 10 };
  return Array.from({ length: mix.total }, (_, index) => {
    sequence += 1;
    const seed = regionIndex * 37 + index * 13;
    const tier: RiskTier = index < mix.urgent ? 'Urgent'
      : index < mix.urgent + mix.veryHigh ? 'Very High Risk'
      : index < mix.urgent + mix.veryHigh + mix.high ? 'High Risk'
      : index % 2 ? 'Medium' : 'Low';
    const profile = createProfile(tier, seed);
    const risk = computeBaselineRisk(profile);
    let patient: PatientRecord = {
      ...profile,
      id: 'LUNG-' + regionId + '-' + String(index + 1).padStart(2, '0'),
      name: firstNames[seed % firstNames.length] + ' ' + lastNames[(index + regionIndex) % lastNames.length],
      phoneNumber: '+358 40 000 ' + String(sequence).padStart(4, '0'),
      municipality: region.municipalities[index % region.municipalities.length],
      wellbeingCounty: '', regionId, positionXZ: [0, 0],
      cancerDiagnosis: 'Lung cancer pathway', primaryLanguage: regionId === '21' ? 'Swedish' : 'Finnish',
      appointmentType: appointments[profile.pathwayStage],
      appointmentTimeLabel: (profile.daysUntilAppointment === 0 ? 'Today' : 'In ' + profile.daysUntilAppointment + ' days') + ' at 09:00',
      baselineScore: risk.score, riskScore: risk.score, scoreDelta: 0,
      riskTier: risk.tier, riskBreakdown: risk.breakdown, goal3AtRisk: risk.goal3AtRisk,
      callStatus: 'Pending Call', aiDetectedBarrier: null, verifiedBarrier: null,
      overriddenByHuman: false, barrierSummary: null, recommendedAction: null,
      deployedOperationAction: null, clinicalNurseAlert: false, humanCoordinatorRequested: false,
      lastUpdatedAt: null, transcript: [],
    };
    if (tier === 'Urgent' || tier === 'Very High Risk') {
      if (index % 3 === 0) patient = applyCallOutcomeToPatient(patient, { callStatus: 'No Pick-Up' });
      else patient = applyCallOutcomeToPatient(patient, {
        callStatus: 'Follow-Up Required (Human Callback Queued)',
        barrierCategory: index % 2 ? 'Transport' : 'Weather',
        barrierSummary: index % 2 ? 'Transport assistance requested before the appointment.' : 'Weather has disrupted travel; assistance requested.',
        humanCoordinatorRequested: true,
      });
    } else if (tier === 'High Risk' && index % 3 === 0) {
      patient = applyCallOutcomeToPatient(patient, { callStatus: 'No Pick-Up' });
    } else if ((tier === 'High Risk' || tier === 'Medium') && index % 3 === 1) {
      patient = applyCallOutcomeToPatient(patient, {
        callStatus: 'Follow-Up Required (Human Callback Queued)', barrierCategory: 'Scheduling',
        barrierSummary: 'Appointment timing conflicts with other commitments; callback requested.', humanCoordinatorRequested: true,
      });
    } else if (tier === 'Low' && index % 3 === 0) {
      patient = applyCallOutcomeToPatient(patient, { callStatus: 'Confirmed Attending' });
    }
    // Seed genuine cancellation states in each region without changing its intended colour.
    // Low profiles become Medium; Urgent and Very High profiles remain in their existing tiers.
    if (tier === 'Low' || ((tier === 'Urgent' || tier === 'Very High Risk') && index % 5 === 0)) {
      const exampleIndex = index % 3 === 0 ? (regionIndex + index) % cancellationExamples.length : regionIndex % cancellationExamples.length;
      const example = cancellationExamples[exampleIndex];
      patient = applyCallOutcomeToPatient(patient, {
        callStatus: 'Appointment Cancelled', barrierCategory: example.category,
        barrierSummary: example.reason, humanCoordinatorRequested: false,
      });
    }
    return { ...patient, lastUpdatedAt: null };
  });
});
