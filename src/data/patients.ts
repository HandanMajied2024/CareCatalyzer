import type {
  BarrierCategory,
  CallStatus,
  FocusRegionId,
  FocusRegionMeta,
  PathwayStage,
  PatientRecord,
} from '../types/careconnect.ts';
import { applyCallOutcomeToPatient, computeBaselineRisk } from '../utils/riskEngine.ts';

/**
 * Geographic silhouette of Finland in normalized [x, z] coordinates.
 */
export const FINLAND_OUTLINE_XZ: Array<[number, number]> = [
  [-2.6, 6.9],
  [-1.1, 7.1],
  [0.5, 6.85],
  [2.1, 6.6],
  [3.4, 5.4],
  [4.0, 3.8],
  [4.5, 2.1],
  [4.1, 0.7],
  [3.6, -0.8],
  [3.8, -2.5],
  [3.2, -4.4],
  [2.9, -6.2],
  [2.4, -8.3],
  [1.2, -9.3],
  [-0.3, -8.7],
  [-2.1, -8.9],
  [-3.2, -9.5],
  [-3.8, -8.6],
  [-2.3, -7.2],
  [-1.8, -5.6],
  [-2.2, -4.1],
  [-1.6, -2.6],
  [-2.3, -1.2],
  [-3.2, 0.3],
  [-3.5, 1.9],
  [-3.3, 3.6],
  [-3.6, 5.3],
  [-3.4, 6.4],
];

export const FINLAND_LAKES_XZ: Array<Array<[number, number]>> = [
  // Lake Inari
  [
    [0.2, -8.3],
    [0.9, -8.45],
    [1.25, -8.05],
    [0.85, -7.75],
    [0.3, -7.9],
  ],
  // Oulujärvi
  [
    [0.6, -2.6],
    [1.35, -2.7],
    [1.45, -2.25],
    [0.8, -2.15],
  ],
  // Lake Päijänne
  [
    [0.2, 2.2],
    [0.55, 2.25],
    [0.65, 3.9],
    [0.35, 4.15],
    [0.15, 3.2],
  ],
  // Lake Saimaa / Kallavesi
  [
    [1.75, 1.4],
    [2.5, 1.7],
    [2.95, 3.1],
    [2.75, 4.1],
    [2.1, 4.25],
    [1.7, 2.7],
  ],
];

export const FOCUS_REGIONS: Record<FocusRegionId, FocusRegionMeta> = {
  OYS_LAPLAND: {
    id: 'OYS_LAPLAND',
    shortLabel: 'Lapland / OYS North',
    name: 'Lapland / OYS North',
    finnishName: 'Lappi · Pohjoinen syöpäkeskus (OYS)',
    hubCity: 'Oulu / Rovaniemi',
    hubHospital: 'OYS Thoracic Oncology & Rovaniemi Satellite',
    hubXZ: [-0.25, -3.4],
    labelAnchorXZ: [0.45, -5.85],
    polygonXZ: [
      [-3.2, -9.5],
      [-2.1, -8.9],
      [-0.3, -8.7],
      [1.2, -9.3],
      [2.4, -8.3],
      [2.9, -6.2],
      [3.2, -4.4],
      [3.8, -2.5],
      [3.6, -0.8],
      [1.8, -0.6],
      [0.1, -0.3],
      [-2.1, 0.2],
      [-2.8, -0.2],
      [-2.3, -1.2],
      [-1.6, -2.6],
      [-2.2, -4.1],
      [-1.8, -5.6],
      [-2.3, -7.2],
      [-3.8, -8.6],
    ],
    terrainFill: '#335243',
    accentColor: '#F97316',
    profileTag: 'Remote / Rural · >150–415 km · Winter Exposure',
    winterExposureIndex: 0.92,
    counties: ['Lapland (Inari, Sodankylä, Rovaniemi, Kemi)', 'North Ostrobothnia (Oulu)', 'Kainuu'],
    equityChallenge:
      'Long arctic transit (>150–415 km) and winter storm disruptions drive diagnostic CT/biopsy delays and lower NSCLC survival.',
  },
  KYS_SAVO: {
    id: 'KYS_SAVO',
    shortLabel: 'North Savo / KYS East',
    name: 'North Savo / KYS East',
    finnishName: 'Pohjois-Savo · Itäinen syöpäkeskus (KYS)',
    hubCity: 'Kuopio',
    hubHospital: 'KYS Kuopio Cancer Center',
    hubXZ: [1.95, 1.35],
    labelAnchorXZ: [2.25, 2.15],
    polygonXZ: [
      [0.1, -0.3],
      [1.8, -0.6],
      [3.6, -0.8],
      [4.1, 0.7],
      [4.5, 2.1],
      [4.0, 3.8],
      [2.3, 4.0],
      [0.7, 4.3],
      [0.35, 1.9],
    ],
    terrainFill: '#284d3c',
    accentColor: '#F59E0B',
    profileTag: 'Mixed Rural/Urban · Aging 75+ Cohort',
    winterExposureIndex: 0.62,
    counties: ['North Savo (Kuopio, Iisalmi, Varkaus)', 'North Karelia', 'South Savo'],
    equityChallenge:
      'Highest 75+ frailty share in Finland with dispersed lake-district transit creating diagnostic & accessibility friction.',
  },
  HUS_UUSIMAA: {
    id: 'HUS_UUSIMAA',
    shortLabel: 'Uusimaa / HUS South',
    name: 'Uusimaa / HUS South',
    finnishName: 'Uusimaa · Eteläinen syöpäkeskus (HUS)',
    hubCity: 'Helsinki',
    hubHospital: 'HUS Comprehensive Cancer Center (Meilahti)',
    hubXZ: [0.25, 6.0],
    labelAnchorXZ: [1.3, 5.55],
    polygonXZ: [
      [-1.4, 5.0],
      [-0.2, 5.0],
      [0.7, 4.3],
      [2.3, 4.0],
      [4.0, 3.8],
      [3.4, 5.4],
      [2.1, 6.6],
      [0.5, 6.85],
      [-1.2, 7.05],
    ],
    terrainFill: '#31614b',
    accentColor: '#38BDF8',
    profileTag: 'Urban High-Volume · Socioeconomic & Multilingual Gaps',
    winterExposureIndex: 0.25,
    counties: ['Helsinki', 'Vantaa-Kerava', 'Espoo / West Uusimaa', 'East Uusimaa'],
    equityChallenge:
      'High diagnostic throughput masked by work-shift scheduling conflicts, co-pay anxiety, and non-Finnish/Swedish literacy gaps.',
  },
};

export const FOCUS_REGION_ORDER: FocusRegionId[] = [
  'OYS_LAPLAND',
  'KYS_SAVO',
  'HUS_UUSIMAA',
];

export const FEATURED_DEMO_PATIENT_ID = 'LUNG-OYS-01';

interface SiteSeed {
  municipality: string;
  wellbeingCounty: string;
  regionId: FocusRegionId;
  xz: [number, number];
  distanceKm: number;
}

const REGION_SITES: Record<FocusRegionId, SiteSeed[]> = {
  OYS_LAPLAND: [
    { municipality: 'Inari (Ivalo)', wellbeingCounty: 'Lapland', regionId: 'OYS_LAPLAND', xz: [0.55, -7.85], distanceKm: 415 },
    { municipality: 'Sodankylä', wellbeingCounty: 'Lapland', regionId: 'OYS_LAPLAND', xz: [0.35, -6.7], distanceKm: 332 },
    { municipality: 'Kittilä', wellbeingCounty: 'Lapland', regionId: 'OYS_LAPLAND', xz: [-0.85, -6.45], distanceKm: 345 },
    { municipality: 'Rovaniemi', wellbeingCounty: 'Lapland', regionId: 'OYS_LAPLAND', xz: [0.15, -5.55], distanceKm: 218 },
    { municipality: 'Kemijärvi', wellbeingCounty: 'Lapland', regionId: 'OYS_LAPLAND', xz: [1.45, -5.35], distanceKm: 268 },
    { municipality: 'Oulu', wellbeingCounty: 'North Ostrobothnia', regionId: 'OYS_LAPLAND', xz: [-0.35, -3.2], distanceKm: 16 },
  ],
  KYS_SAVO: [
    { municipality: 'Iisalmi', wellbeingCounty: 'North Savo', regionId: 'KYS_SAVO', xz: [1.65, 0.25], distanceKm: 86 },
    { municipality: 'Kiuruvesi', wellbeingCounty: 'North Savo', regionId: 'KYS_SAVO', xz: [1.05, 0.35], distanceKm: 118 },
    { municipality: 'Varkaus', wellbeingCounty: 'North Savo', regionId: 'KYS_SAVO', xz: [2.15, 2.45], distanceKm: 78 },
    { municipality: 'Nurmes / Lieksa', wellbeingCounty: 'North Karelia', regionId: 'KYS_SAVO', xz: [3.25, 1.15], distanceKm: 164 },
    { municipality: 'Kuopio', wellbeingCounty: 'North Savo', regionId: 'KYS_SAVO', xz: [1.85, 1.35], distanceKm: 12 },
  ],
  HUS_UUSIMAA: [
    { municipality: 'Vantaa (Hakunila)', wellbeingCounty: 'Vantaa-Kerava', regionId: 'HUS_UUSIMAA', xz: [0.65, 5.65], distanceKm: 22 },
    { municipality: 'Espoo (Espoon keskus)', wellbeingCounty: 'West Uusimaa', regionId: 'HUS_UUSIMAA', xz: [-0.45, 6.2], distanceKm: 19 },
    { municipality: 'Porvoo', wellbeingCounty: 'East Uusimaa', regionId: 'HUS_UUSIMAA', xz: [1.45, 5.85], distanceKm: 52 },
    { municipality: 'Lohja', wellbeingCounty: 'West Uusimaa', regionId: 'HUS_UUSIMAA', xz: [-0.85, 6.45], distanceKm: 58 },
    { municipality: 'Helsinki (Kontula)', wellbeingCounty: 'Helsinki', regionId: 'HUS_UUSIMAA', xz: [0.45, 6.25], distanceKm: 14 },
    { municipality: 'Helsinki (Töölö)', wellbeingCounty: 'Helsinki', regionId: 'HUS_UUSIMAA', xz: [0.05, 6.45], distanceKm: 6 },
  ],
};

const LUNG_APPOINTMENTS: Record<PathwayStage, string[]> = {
  Referral: [
    'Pulmonology Fast-Track Intake',
    'Primary-to-Specialist Chest Review',
  ],
  'Diagnostic Workup': [
    'Thoracic CT & Bronchoscopy Biopsy',
    'PET-CT Staging & EBUS Biopsy',
  ],
  'Treatment Initiation': [
    'Chemo-Immunotherapy Cycle 1',
    'Stereotactic Thoracic Radiotherapy Start',
  ],
};

const NAMES_FIRST = [
  'Aino', 'Matti', 'Helvi', 'Paavo', 'Tuula', 'Eero', 'Ritva', 'Timo', 'Marja', 'Antti',
  'Leena', 'Jari', 'Päivi', 'Kari', 'Sinikka', 'Heikki', 'Anja', 'Seppo', 'Tarja', 'Olli',
  'Abdirahman', 'Elena', 'Fatima', 'Sergei', 'Amina', 'Viktor', 'Nadia', 'Oskar', 'Katriina', 'Mikko',
];

const NAMES_LAST = [
  'Korhonen', 'Savolainen', 'Kemppainen', 'Hämäläinen', 'Nieminen', 'Mäkinen', 'Koskinen', 'Järvinen',
  'Lehtonen', 'Laine', 'Heikkinen', 'Turunen', 'Väisänen', 'Pulkkinen', 'Karjalainen', 'Rantanen',
  'Hassan', 'Ivanova', 'Lindqvist', 'Virtanen', 'Salminen', 'Kinnunen', 'Saarinen', 'Ahonen',
];

const TARGET_DAYS_BY_STAGE: Record<PathwayStage, number> = {
  Referral: 14,
  'Diagnostic Workup': 21,
  'Treatment Initiation': 28,
};

function buildFeaturedLaplandPatient(): PatientRecord {
  const stage: PathwayStage = 'Diagnostic Workup';
  const baseline = computeBaselineRisk({
    age: 76,
    pathwayStage: stage,
    cancerStage: 'Stage III',
    g8FrailtyScore: 11,
    distanceKm: 415,
    languageBarrier: false,
    financialVulnerability: true,
    accessibilityNeed: false,
    priorMissedCalls: 1,
    daysElapsed: 16,
    daysUntilAppointment: 2,
    targetDaysTotal: 21,
  });

  return {
    id: FEATURED_DEMO_PATIENT_ID,
    name: 'Aino Korhonen',
    age: 76,
    municipality: 'Inari (Ivalo)',
    wellbeingCounty: 'Lapland',
    regionId: 'OYS_LAPLAND',
    positionXZ: [0.55, -7.85],
    distanceKm: 415,
    pathwayStage: stage,
    cancerDiagnosis: 'Suspected NSCLC (Upper Lobe Mass)',
    cancerStage: 'Stage III',
    g8FrailtyScore: 11,
    primaryLanguage: 'Finnish',
    languageBarrier: false,
    financialVulnerability: true,
    accessibilityNeed: false,
    priorMissedCalls: 1,
    targetDaysTotal: 21,
    daysElapsed: 16,
    daysUntilAppointment: 2,
    appointmentType: 'Thoracic CT & Bronchoscopy Biopsy',
    appointmentTimeLabel: 'Tomorrow · 09:00 (OYS Thoracic)',
    baselineScore: baseline.score,
    riskScore: baseline.score,
    scoreDelta: 0,
    riskTier: baseline.tier,
    riskBreakdown: baseline.breakdown,
    goal3AtRisk: true,
    callStatus: 'Pending Call',
    aiDetectedBarrier: null,
    verifiedBarrier: null,
    overriddenByHuman: false,
    barrierSummary: null,
    recommendedAction: null,
    deployedOperationAction: null,
    clinicalNurseAlert: false,
    humanCoordinatorRequested: false,
    lastUpdatedAt: null,
    transcript: [],
  };
}

interface PreSeedSpec {
  callStatus: CallStatus;
  barrier?: BarrierCategory;
  summary?: string;
  nurseAlert?: boolean;
}

/**
 * Designed distributions per region so:
 * - Tab 2 shows meaningful rates per 100 contacted patients (e.g., Transport spike in Lapland,
 *   Accessibility/75+ in North Savo, Scheduling/Language in Uusimaa)
 * - Small-cell subgroups (n < 5) exist realistically in each region to trigger k-anonymity suppression!
 */
const REGION_OUTCOME_PATTERNS: Record<FocusRegionId, PreSeedSpec[]> = {
  OYS_LAPLAND: [
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'No morning winter bus connection >300 km to Oulu.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'Cannot arrange 400 km rural transport without Kela taxi pre-approval.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'Family driver unavailable for 2-day diagnostic roundtrip.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'Regional shuttle route missing for Kemijärvi connection.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'Long-distance ambulance/taxi co-pay barrier.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Weather', summary: 'Arctic blizzard advisory closing local E75 road segment.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Weather', summary: 'Sub-zero storm warning preventing elderly walk to transit stop.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: 'Oxygen-dependent dyspnea makes unescorted transit unsafe.', nurseAlert: true },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Pending Call' },
    { callStatus: 'Pending Call' },
  ],
  KYS_SAVO: [
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: '78+ frailty (G8=9) requires wheelchair-assisted transport.', nurseAlert: true },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: 'Post-biopsy weakness requires home escort support.', nurseAlert: true },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: 'Severe mobility impairment on rural farm lane.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: 'Needs Kotisairaala pre-chemo blood draw & mobility aid.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Accessibility', summary: 'Cognitive/frailty fatigue makes solo hospital navigation unsafe.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: '164 km Nurmes–Kuopio lake transit gap on biopsy day.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'No feeder transit from Kiuruvesi before 08:30 CT slot.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Spouse caregiver overlap prevents morning slot.' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Pending Call' },
    { callStatus: 'Pending Call' },
    { callStatus: 'Pending Call' },
  ],
  HUS_UUSIMAA: [
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Service-sector shift supervisor denied morning clinic leave.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Unable to take unpaid time off for weekday PET-CT.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Childcare conflict during 08:30 Meilahti infusion.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Needs bundled afternoon diagnostic slot to keep job.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Scheduling', summary: 'Conflicting shift roster in Espoo.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Language', summary: 'Somali speaker did not understand Finnish fasting & prep letter.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Language', summary: 'Russian speaker confused about Meilahti Tower entrance.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Language', summary: 'Arabic speaker requested interpreter before immunotherapy consent.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Language', summary: 'Estonian speaker misunderstood biopsy anticoagulant hold.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Language', summary: 'Needs translated fast-track prep guidance.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Transport', summary: 'Cannot afford upfront taxi co-pay before Kela reimbursement.' },
    { callStatus: 'Follow-Up Required (Human Callback Queued)', barrier: 'Weather', summary: 'Icy sidewalks near Porvoo transit hub.' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'No Pick-Up' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Confirmed Attending' },
    { callStatus: 'Pending Call' },
    { callStatus: 'Pending Call' },
    { callStatus: 'Pending Call' },
  ],
};

function buildLungPathwayCohort(): PatientRecord[] {
  const patients: PatientRecord[] = [buildFeaturedLaplandPatient()];
  const stages: PathwayStage[] = ['Referral', 'Diagnostic Workup', 'Treatment Initiation'];
  const tumorStages: Array<PatientRecord['cancerStage']> = ['Stage I', 'Stage II', 'Stage III', 'Stage IV'];

  let globalIdx = 1;

  for (const regionId of FOCUS_REGION_ORDER) {
    const patterns = REGION_OUTCOME_PATTERNS[regionId];
    const sites = REGION_SITES[regionId];

    patterns.forEach((pattern, localIdx) => {
      const seqNum = regionId === 'OYS_LAPLAND' ? localIdx + 2 : localIdx + 1;
      const site = sites[(localIdx + globalIdx) % sites.length];
      const pathwayStage = stages[(localIdx + globalIdx) % stages.length];
      const cancerStage = tumorStages[(localIdx + 1) % tumorStages.length];
      const age =
        regionId === 'KYS_SAVO'
          ? 70 + ((localIdx * 5) % 19) // older 70..88 cohort
          : regionId === 'HUS_UUSIMAA'
            ? 46 + ((localIdx * 7) % 36) // 46..81 urban cohort
            : 54 + ((localIdx * 6) % 32); // 54..85 northern cohort

      const g8 = age >= 75 ? 9 + (localIdx % 5) : 13 + (localIdx % 5);
      const isLangBarrier =
        pattern.barrier === 'Language' || (regionId === 'HUS_UUSIMAA' && localIdx % 5 === 0);
      const lang = isLangBarrier
        ? ['Somali', 'Russian', 'Arabic', 'Estonian'][localIdx % 4]
        : 'Finnish';

      const targetDaysTotal = TARGET_DAYS_BY_STAGE[pathwayStage];
      const daysUntilAppointment = 1 + (localIdx % 4);
      const daysElapsed = Math.max(4, targetDaysTotal - daysUntilAppointment - (localIdx % 5));

      const angle = ((seqNum * 137.5) * Math.PI) / 180;
      const radius = 0.08 + (seqNum % 3) * 0.07;
      const posXZ: [number, number] = [
        Math.round((site.xz[0] + Math.cos(angle) * radius) * 100) / 100,
        Math.round((site.xz[1] + Math.sin(angle) * radius) * 100) / 100,
      ];

      const baseline = computeBaselineRisk({
        age,
        pathwayStage,
        cancerStage,
        g8FrailtyScore: g8,
        distanceKm: site.distanceKm,
        languageBarrier: isLangBarrier,
        financialVulnerability: regionId === 'OYS_LAPLAND' || localIdx % 3 === 0,
        accessibilityNeed: pattern.barrier === 'Accessibility' || g8 <= 11,
        priorMissedCalls: pattern.callStatus === 'No Pick-Up' ? 1 : 0,
        daysElapsed,
        daysUntilAppointment,
        targetDaysTotal,
      });

      const appts = LUNG_APPOINTMENTS[pathwayStage];
      const first = NAMES_FIRST[(globalIdx * 3 + localIdx) % NAMES_FIRST.length];
      const last = NAMES_LAST[(globalIdx * 5 + localIdx) % NAMES_LAST.length];

      const baseRecord: PatientRecord = {
        id: `LUNG-${regionId.slice(0, 3)}-${String(seqNum).padStart(2, '0')}`,
        name: `${first} ${last}`,
        age,
        municipality: site.municipality,
        wellbeingCounty: site.wellbeingCounty,
        regionId,
        positionXZ: posXZ,
        distanceKm: site.distanceKm,
        pathwayStage,
        cancerDiagnosis:
          pathwayStage === 'Referral'
            ? 'Pulmonary Nodule (Fast-Track)'
            : 'NSCLC (Lung Cancer)',
        cancerStage,
        g8FrailtyScore: g8,
        primaryLanguage: lang,
        languageBarrier: isLangBarrier,
        financialVulnerability: regionId === 'OYS_LAPLAND' || localIdx % 3 === 0,
        accessibilityNeed: pattern.barrier === 'Accessibility' || g8 <= 11,
        priorMissedCalls: pattern.callStatus === 'No Pick-Up' ? 1 : 0,
        targetDaysTotal,
        daysElapsed,
        daysUntilAppointment,
        appointmentType: appts[localIdx % appts.length],
        appointmentTimeLabel: `In ${daysUntilAppointment}d · ${FOCUS_REGIONS[regionId].hubCity}`,
        baselineScore: baseline.score,
        riskScore: baseline.score,
        scoreDelta: 0,
        riskTier: baseline.tier,
        riskBreakdown: baseline.breakdown,
        goal3AtRisk: baseline.goal3AtRisk,
        callStatus: 'Pending Call',
        aiDetectedBarrier: null,
        verifiedBarrier: null,
        overriddenByHuman: false,
        barrierSummary: null,
        recommendedAction: null,
        deployedOperationAction: null,
        clinicalNurseAlert: false,
        humanCoordinatorRequested: false,
        lastUpdatedAt: null,
        transcript: [],
      };

      if (pattern.callStatus !== 'Pending Call') {
        const applied = applyCallOutcomeToPatient(baseRecord, {
          callStatus: pattern.callStatus,
          barrierCategory: pattern.barrier ?? null,
          barrierSummary: pattern.summary ?? null,
          clinicalNurseAlert: pattern.nurseAlert ?? false,
        });
        applied.lastUpdatedAt = '08:30:00';
        patients.push(applied);
      } else {
        patients.push(baseRecord);
      }

      globalIdx += 1;
    });
  }

  return patients;
}

export const INITIAL_PATIENTS: PatientRecord[] = buildLungPathwayCohort();
