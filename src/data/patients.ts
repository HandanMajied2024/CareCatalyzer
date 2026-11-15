import type { PatientRecord, FocusRegionId, RiskTier, PathwayStage, BarrierCategory } from '../types/careconnect.ts';
import { computeBaselineRisk, applyCallOutcomeToPatient, getRiskTier, clampScore } from '../utils/riskEngine.ts';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER } from './regions.ts';
export { FOCUS_REGIONS, FOCUS_REGION_ORDER } from './regions.ts';
// SYNTHETIC DEMO DATA. No real patients. Regional statistics elsewhere are public aggregates.
// Demo path: Patients -> Lapland + Pending -> Matti Heikkinen (Kemi) -> Call patient.
export const FEATURED_DEMO_PATIENT_ID = 'LUNG-19-45';
const DEMO_PATIENT = { id: FEATURED_DEMO_PATIENT_ID, name: 'Matti Heikkinen', municipality: 'Kemi' };

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

// Approximate road distance (km) from each municipality to the regional care team
// (hub city first). Hub-city patients get a short local distance from the seed.
const MUNICIPALITY_KM: Record<FocusRegionId, [number, number]> = {
  '01': [18, 50], '02': [55, 65], '04': [50, 55], '05': [35, 45], '06': [17, 35],
  '07': [35, 12], '08': [55, 50], '09': [37, 95], '10': [100, 85], '11': [85, 75],
  '12': [100, 120], '13': [60, 45], '14': [25, 60], '15': [100, 80], '16': [40, 45],
  '17': [75, 215], '18': [105, 110], '19': [330, 115], '21': [8, 20],
};
function realisticDistanceKm(regionId: FocusRegionId, municipalityIndex: number, seed: number) {
  if (municipalityIndex === 0) return 4 + seed % 22;
  return MUNICIPALITY_KM[regionId][municipalityIndex - 1] + seed % 9 - 4;
}

// Synthetic barrier mix per region type. Sparse northern/eastern regions: distance and
// transport dominate (in line with Finnish evidence that lung cancer patients living >50 km
// from treatment have ~1.5x 12-month mortality). Metro regions: scheduling, fear, language.
type BarrierWeights = Partial<Record<BarrierCategory, number>>;
const SPARSE_REGIONS = new Set<FocusRegionId>(['19', '18', '17', '12', '10', '11', '09', '16']);
const METRO_REGIONS = new Set<FocusRegionId>(['01', '02', '06']);
const BARRIER_MIX: Record<'sparse' | 'metro' | 'mixed', BarrierWeights> = {
  sparse: { Transport: 46, Weather: 12, Financial: 10, Scheduling: 10, 'Fear / Anxiety': 8, Accessibility: 8, Other: 4, Language: 2 },
  metro: { Scheduling: 30, 'Fear / Anxiety': 22, Language: 20, Transport: 8, Financial: 8, Accessibility: 6, Other: 6 },
  mixed: { Transport: 26, Scheduling: 22, 'Fear / Anxiety': 15, Financial: 12, Accessibility: 10, Weather: 6, Language: 4, Other: 5 },
};
export function regionBarrierProfile(regionId: FocusRegionId): 'sparse' | 'metro' | 'mixed' {
  return SPARSE_REGIONS.has(regionId) ? 'sparse' : METRO_REGIONS.has(regionId) ? 'metro' : 'mixed';
}
// Largest-remainder apportionment, then interleaved so neighbouring records differ.
function apportionBarriers(weights: BarrierWeights, count: number): BarrierCategory[] {
  const entries = Object.entries(weights) as [BarrierCategory, number][];
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  const counts = entries.map(([category, w]) => {
    const exact = (w / totalWeight) * count;
    return { category, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let missing = count - counts.reduce((sum, c) => sum + c.n, 0);
  [...counts].sort((a, b) => b.rest - a.rest).forEach(c => { if (missing > 0) { c.n += 1; missing -= 1; } });
  const out: BarrierCategory[] = [];
  while (out.length < count) for (const c of counts) if (c.n > 0) { out.push(c.category); c.n -= 1; }
  return out;
}
const FOLLOW_UP_SUMMARY: Record<BarrierCategory, string> = {
  Transport: 'No suitable transport to the appointment; Kela taxi help requested.',
  Weather: 'Winter road conditions disrupted travel; assistance requested.',
  Scheduling: 'Appointment timing conflicts with other commitments; callback requested.',
  'Fear / Anxiety': 'Patient feels anxious about the procedure; nurse call requested.',
  Financial: 'Travel costs are a worry; Kela reimbursement help requested.',
  Accessibility: 'Mobility difficulties make travel hard; escort requested.',
  Language: 'Instructions were unclear; interpreter requested.',
  Other: 'Patient asked for a callback without giving a reason.',
};

let sequence = 0;
function buildPatient(regionId: FocusRegionId, index: number, tier: RiskTier, seed: number,
  profile: ReturnType<typeof createProfile>, phoneSequence: number, barrierOverride?: BarrierCategory): PatientRecord {
  const region = FOCUS_REGIONS[regionId];
  const regionIndex = FOCUS_REGION_ORDER.indexOf(regionId);
    const risk = computeBaselineRisk(profile);
    let patient: PatientRecord = {
      ...profile,
      id: 'LUNG-' + regionId + '-' + String(index + 1).padStart(2, '0'),
      name: firstNames[seed % firstNames.length] + ' ' + lastNames[(index + regionIndex) % lastNames.length],
      phoneNumber: '+358 40 000 ' + String(phoneSequence).padStart(4, '0'),
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
    if ((tier === 'Low' && index % 3 !== 0) || ((tier === 'Urgent' || tier === 'Very High Risk') && index % 5 === 0)) {
      const exampleIndex = index % 3 === 0 ? (regionIndex + index) % cancellationExamples.length : regionIndex % cancellationExamples.length;
      const example = cancellationExamples[exampleIndex];
      patient = applyCallOutcomeToPatient(patient, {
        callStatus: 'Appointment Cancelled', barrierCategory: example.category,
        barrierSummary: example.reason, humanCoordinatorRequested: false,
      });
    }
    if (barrierOverride && (patient.callStatus === 'Appointment Cancelled' || patient.callStatus === 'Follow-Up Required (Human Callback Queued)')) {
      const cancelled = patient.callStatus === 'Appointment Cancelled';
      patient = applyCallOutcomeToPatient(patient, {
        callStatus: patient.callStatus, barrierCategory: barrierOverride,
        barrierSummary: cancelled ? cancellationExamples.find(e => e.category === barrierOverride)!.reason : FOLLOW_UP_SUMMARY[barrierOverride],
        humanCoordinatorRequested: patient.humanCoordinatorRequested,
        clinicalNurseAlert: barrierOverride === 'Accessibility' && !cancelled ? true : patient.clinicalNurseAlert,
      });
    }
    return { ...patient, lastUpdatedAt: null };
}

// Pick realistic distances. Where a distance or the regional barrier label changes the score band,
// adjust the other synthetic access flags so the intended risk tier (and thus the regional colour
// fixture checked by tests/regions.test.ts) stays the same.
function withRealisticDistance(regionId: FocusRegionId, index: number, tier: RiskTier, seed: number,
  phoneSequence: number, targetTier: RiskTier, barrierOverride?: BarrierCategory): PatientRecord {
  const baseProfile = createProfile(tier, seed);
  const probe = buildPatient(regionId, index, tier, seed, baseProfile, phoneSequence, barrierOverride);
  const distanceKm = realisticDistanceKm(regionId, index % 3, seed);
  const delta = probe.riskScore - probe.baselineScore;
  const baseScore = computeBaselineRisk(baseProfile).score;
  let best: { profile: typeof baseProfile; diff: number } | null = null;
  for (const languageBarrier of [baseProfile.languageBarrier, !baseProfile.languageBarrier])
    for (const financialVulnerability of [baseProfile.financialVulnerability, !baseProfile.financialVulnerability])
      for (const accessibilityNeed of [baseProfile.accessibilityNeed, !baseProfile.accessibilityNeed])
        for (const priorMissedCalls of [baseProfile.priorMissedCalls, 0, 1, 2])
          for (const g8FrailtyScore of [baseProfile.g8FrailtyScore, 17, 13, 10])
            for (const daysUntilAppointment of [baseProfile.daysUntilAppointment, 2, 6, 10]) {
              const candidate = { ...baseProfile, distanceKm, languageBarrier, financialVulnerability, accessibilityNeed, priorMissedCalls, g8FrailtyScore, daysUntilAppointment };
              const score = computeBaselineRisk(candidate).score;
              if (getRiskTier(clampScore(score + delta)) !== targetTier) continue;
              const changes = Number(languageBarrier !== baseProfile.languageBarrier) + Number(financialVulnerability !== baseProfile.financialVulnerability)
                + Number(accessibilityNeed !== baseProfile.accessibilityNeed) + Number(priorMissedCalls !== baseProfile.priorMissedCalls)
                + Number(g8FrailtyScore !== baseProfile.g8FrailtyScore) + Number(daysUntilAppointment !== baseProfile.daysUntilAppointment);
              const diff = Math.abs(score - baseScore) + changes * 0.5;
              if (!best || diff < best.diff) best = { profile: candidate, diff };
            }
  if (best) {
    const adjusted = buildPatient(regionId, index, tier, seed, best.profile, phoneSequence, barrierOverride);
    if (adjusted.riskTier === targetTier) return adjusted;
  }
  if (probe.riskTier === targetTier) return probe;
  return buildPatient(regionId, index, tier, seed, baseProfile, phoneSequence);
}

export const INITIAL_PATIENTS: PatientRecord[] = FOCUS_REGION_ORDER.flatMap((regionId, regionIndex) => {
  const mix = regionalMix[regionId] ?? { urgent: 0, veryHigh: 0, high: 5 + regionIndex % 6, total: 20 + regionIndex % 10 };
  const specs = Array.from({ length: mix.total }, (_, index) => {
    sequence += 1;
    const seed = regionIndex * 37 + index * 13;
    const tier: RiskTier = index < mix.urgent ? 'Urgent'
      : index < mix.urgent + mix.veryHigh ? 'Very High Risk'
      : index < mix.urgent + mix.veryHigh + mix.high ? 'High Risk'
      : index % 2 ? 'Medium' : 'Low';
    const original = buildPatient(regionId, index, tier, seed, createProfile(tier, seed), sequence);
    return { index, seed, tier, phoneSequence: sequence, original };
  });
  // Synthetic barrier labels follow the region's barrier mix (see BARRIER_MIX).
  const weights = BARRIER_MIX[regionBarrierProfile(regionId)];
  const overrides = new Map<number, BarrierCategory>();
  for (const status of ['Appointment Cancelled', 'Follow-Up Required (Human Callback Queued)'] as const) {
    const list = specs.filter(spec => spec.original.callStatus === status);
    const categories = apportionBarriers(weights, list.length);
    list.forEach((spec, i) => overrides.set(spec.index, categories[i]));
  }
  return specs.map(spec => withRealisticDistance(regionId, spec.index, spec.tier, spec.seed, spec.phoneSequence,
    spec.original.riskTier, overrides.get(spec.index)));
}).map(p => p.id === DEMO_PATIENT.id ? { ...p, name: DEMO_PATIENT.name, municipality: DEMO_PATIENT.municipality } : p);
