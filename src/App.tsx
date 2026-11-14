import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Compass,
  Map as MapIcon,
  PhoneCall,
  Play,
  RotateCcw,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Tab1CallingAgent } from './components/Tab1CallingAgent.tsx';
import { Tab2RegionalBarrierMap } from './components/Tab2RegionalBarrierMap.tsx';
import { Tab3InterventionSimulator } from './components/Tab3InterventionSimulator.tsx';
import {
  FEATURED_DEMO_PATIENT_ID,
  FOCUS_REGIONS,
  INITIAL_PATIENTS,
} from './data/patients.ts';
import type {
  BarrierCategory,
  CallStatus,
  DeployedActionLog,
  FocusRegionId,
  InterventionComparison,
  PatientRecord,
  TranscriptLine,
} from './types/careconnect.ts';
import {
  applyCallOutcomeToPatient,
  getDefaultActionForBarrier,
} from './utils/riskEngine.ts';
import { voiceAudio } from './utils/voiceAudio.ts';

type ActiveTab = 'tab1' | 'tab2' | 'tab3';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('tab1');
  const [patients, setPatients] = useState<PatientRecord[]>(INITIAL_PATIENTS);
  const [selectedPatientId, setSelectedPatientId] = useState<string>(FEATURED_DEMO_PATIENT_ID);
  const [activeCallPatientId, setActiveCallPatientId] = useState<string | null>(null);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(false);

  // Simulator state shared across tabs
  const [simRegionId, setSimRegionId] = useState<FocusRegionId>('OYS_LAPLAND');
  const [severeWeatherActive, setSevereWeatherActive] = useState<boolean>(true);
  const [deployedActions, setDeployedActions] = useState<DeployedActionLog[]>([]);
  const [demoStepNotice, setDemoStepNotice] = useState<string | null>(null);

  const activeCallRegionId = useMemo(() => {
    if (!activeCallPatientId) return null;
    return patients.find((p) => p.id === activeCallPatientId)?.regionId ?? null;
  }, [patients, activeCallPatientId]);

  const pathwayAlertsCount = useMemo(
    () => patients.filter((p) => p.goal3AtRisk || p.clinicalNurseAlert).length,
    [patients]
  );

  const handleStartCall = (patientId: string) => {
    setActiveCallPatientId(patientId);
    setPatients((prev) =>
      prev.map((p) => (p.id === patientId ? { ...p, callStatus: 'Calling Live' } : p))
    );
  };

  const handleEndCall = () => {
    setActiveCallPatientId(null);
    setPatients((prev) =>
      prev.map((p) =>
        p.callStatus === 'Calling Live' ? { ...p, callStatus: 'Pending Call' } : p
      )
    );
  };

  const handleAppendTranscript = (patientId: string, line: TranscriptLine) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId ? { ...p, transcript: [...p.transcript, line] } : p
      )
    );
  };

  const markRecentlyUpdated = (patientId: string) => {
    setRecentlyUpdatedId(patientId);
    window.setTimeout(() => {
      setRecentlyUpdatedId((curr) => (curr === patientId ? null : curr));
    }, 3500);
  };

  const handleApplyOutcome = (
    patientId: string,
    outcome: {
      callStatus: CallStatus;
      barrierCategory?: BarrierCategory | null;
      barrierSummary?: string | null;
      recommendedAction?: string | null;
      clinicalNurseAlert?: boolean;
      overriddenByHuman?: boolean;
      humanCoordinatorRequested?: boolean;
    }
  ) => {
    setPatients((prev) =>
      prev.map((p) => (p.id === patientId ? applyCallOutcomeToPatient(p, outcome) : p))
    );
    markRecentlyUpdated(patientId);
  };

  const handleOverrideBarrier = (patientId: string, newBarrier: BarrierCategory) => {
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== patientId) return p;
        const overridden = applyCallOutcomeToPatient(p, {
          callStatus: 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: newBarrier,
          barrierSummary:
            p.barrierSummary ?? `Human coordinator classified barrier as ${newBarrier}.`,
          recommendedAction: getDefaultActionForBarrier(newBarrier, p),
          clinicalNurseAlert: newBarrier === 'Accessibility' ? true : p.clinicalNurseAlert,
          overriddenByHuman: true,
          humanCoordinatorRequested: true,
        });
        overridden.transcript = [
          ...overridden.transcript,
          {
            id: `sys-override-${Date.now()}`,
            speaker: 'System',
            text: `Human-in-the-Loop Override: Barrier classification verified/updated to [${newBarrier}]. Goal 3 slot preserved.`,
            timestamp: new Date().toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          },
        ];
        return overridden;
      })
    );
    markRecentlyUpdated(patientId);
  };

  const handleRequestHumanCoordinator = (patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId
          ? {
              ...p,
              humanCoordinatorRequested: true,
              callStatus:
                p.callStatus === 'Pending Call'
                  ? 'Follow-Up Required (Human Callback Queued)'
                  : p.callStatus,
              recommendedAction:
                p.recommendedAction ??
                `Human Care Coordinator (nimetty työntekijä) callback queued for ${p.name} — appointment protected.`,
              transcript: [
                ...p.transcript,
                {
                  id: `sys-coord-${Date.now()}`,
                  speaker: 'System',
                  text: 'Human Care Coordinator (nimetty työntekijä) callback requested. Appointment held.',
                  timestamp: new Date().toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                },
              ],
            }
          : p
      )
    );
    markRecentlyUpdated(patientId);
  };

  const handleDeployIntervention = (
    regionId: FocusRegionId,
    intervention: InterventionComparison,
    weatherActive: boolean
  ) => {
    let affectedCount = 0;
    setPatients((prev) =>
      prev.map((p) => {
        const eligible =
          p.regionId === regionId &&
          (p.callStatus === 'Follow-Up Required (Human Callback Queued)' ||
            p.goal3AtRisk ||
            p.distanceKm >= 100);
        if (!eligible) return p;
        affectedCount += 1;
        return {
          ...p,
          deployedOperationAction: intervention.actionTemplate,
          humanCoordinatorRequested: true,
        };
      })
    );

    const log: DeployedActionLog = {
      id: `act-${Date.now()}`,
      deployedAt: new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      regionId,
      interventionId: intervention.id,
      interventionName: intervention.name,
      severeWeatherActive: weatherActive,
      affectedPatientCount: affectedCount,
      taskSummary: `${intervention.actionTemplate} (queued for ${affectedCount} flagged patients in ${FOCUS_REGIONS[regionId].shortLabel}).`,
    };
    setDeployedActions((prev) => [log, ...prev]);
    setDemoStepNotice(
      `Action Plan Deployed: ${intervention.shortName} queued for ${affectedCount} patients in ${FOCUS_REGIONS[regionId].shortLabel}. Switch to Tab 1 to inspect updated patient tasks.`
    );
  };

  /**
   * One-click "Load Featured Demo Journey" walks judges cleanly through:
   * Tab 1 (Lapland CT/biopsy transport barrier + Goal 3 flag + coordinator callback) ->
   * Tab 2 (Regional transport rate spike) ->
   * Tab 3 (Shared Shuttle vs Travel Vouchers + Winter Stress Test).
   */
  const handleLoadFeaturedDemo = () => {
    const now = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== FEATURED_DEMO_PATIENT_ID) return p;
        const updated = applyCallOutcomeToPatient(p, {
          callStatus: 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: 'Transport',
          barrierSummary:
            'Rural transport unavailable from Inari (415 km) for tomorrow morning Thoracic CT & Bronchoscopy Biopsy.',
          recommendedAction:
            'Hold Diagnostic Workup slot (never auto-cancel); flag Goal 3 Diagnostic->Treatment Initiation breach risk and queue Care Coordinator (nimetty työntekijä) for Kela taxi / Shared Shuttle booking.',
          clinicalNurseAlert: false,
          humanCoordinatorRequested: true,
        });
        updated.transcript = [
          {
            id: 'demo-1',
            speaker: 'AI Coordinator',
            text: 'Hello Aino Korhonen, this is the FICAN Care Coordinator from OYS Thoracic Oncology calling about your Lung Pathway Diagnostic Workup (Thoracic CT & Bronchoscopy Biopsy, Tomorrow 09:00). Can you attend as planned?',
            timestamp: now,
          },
          {
            id: 'demo-2',
            speaker: 'Patient',
            text: "I can't make it to Oulu tomorrow morning, I think I need to cancel.",
            timestamp: now,
          },
          {
            id: 'demo-3',
            speaker: 'AI Coordinator',
            text: 'We will NOT cancel your biopsy slot, Aino—it stays held for you. Could you share what is making it hard to attend so we can help?',
            timestamp: now,
            probing: true,
          },
          {
            id: 'demo-4',
            speaker: 'Patient',
            text: 'There is no winter bus or rural transport from Inari (415 km) early enough, and I cannot arrange a ride.',
            timestamp: now,
          },
          {
            id: 'demo-5',
            speaker: 'AI Coordinator',
            text: 'Thank you for explaining. I have logged Transport, protected your Goal 3 fast-track biopsy slot, and queued a human Care Coordinator (nimetty työntekijä) to arrange an upfront Kela voucher or Shared Regional Shuttle.',
            timestamp: now,
          },
        ];
        return updated;
      })
    );

    setSelectedPatientId(FEATURED_DEMO_PATIENT_ID);
    setSimRegionId('OYS_LAPLAND');
    setSevereWeatherActive(true);
    setActiveTab('tab1');
    markRecentlyUpdated(FEATURED_DEMO_PATIENT_ID);
    setDemoStepNotice(
      'Demo Step 1 Loaded (Aino Korhonen · Inari, Lapland): Transport barrier captured & Goal 3 breach risk flagged without auto-cancelling. Next: inspect Tab 2 (Regional Barrier Map) → Tab 3 (Intervention Simulator).'
    );
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    voiceAudio.setMuted(next);
  };

  const handleResetCohort = () => {
    setActiveCallPatientId(null);
    voiceAudio.stopLivePlayback();
    voiceAudio.stopSpeech();
    setPatients(INITIAL_PATIENTS);
    setSelectedPatientId(FEATURED_DEMO_PATIENT_ID);
    setDeployedActions([]);
    setDemoStepNotice(null);
    setRecentlyUpdatedId(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Persistent Top Multi-Tab Navigation Bar */}
      <header className="px-4 lg:px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-sky-700 flex items-center justify-center text-white shadow-xs">
            <Activity className="w-4.5 h-4.5" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap block">
              FICAN CareConnect
            </span>
            <span className="text-[11px] text-slate-500 whitespace-nowrap block">
              Lung Cancer Fast-Track · Goal 3 (2026–2035)
            </span>
          </div>
        </div>

        {/* 3 Dedicated Top-Level Tabs */}
        <nav
          aria-label="Primary Clinical Workflow Tabs"
          className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200"
        >
          <button
            type="button"
            onClick={() => setActiveTab('tab1')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'tab1'
                ? 'bg-white text-sky-800 font-semibold shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5 text-sky-700" />
            1. Patient Calling Agent (Detect &amp; Explain)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tab2')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'tab2'
                ? 'bg-white text-sky-800 font-semibold shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5 text-sky-700" />
            2. Regional Barrier Map (Aggregate &amp; Protect)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tab3')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'tab3'
                ? 'bg-white text-sky-800 font-semibold shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-sky-700" />
            3. Intervention Simulator (Simulate &amp; Act)
          </button>
        </nav>

        {/* Active Pathway Alerts Status Pill & Audio/Reset Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono tabular-nums font-semibold whitespace-nowrap">
            {pathwayAlertsCount} Goal 3 Pathway Alerts
          </div>

          <button
            type="button"
            onClick={handleToggleMute}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-xs text-slate-700 whitespace-nowrap cursor-pointer"
            title={muted ? 'Unmute AI voice' : 'Mute AI voice'}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-sky-700" />}
          </button>

          <button
            type="button"
            onClick={handleResetCohort}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-xs text-slate-700 whitespace-nowrap cursor-pointer"
            title="Reset demo cohort"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Featured Demo Journey Banner */}
      <div className="px-4 lg:px-6 py-2 bg-sky-50/80 border-b border-sky-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs min-w-0">
          <Compass className="w-4 h-4 text-sky-700 shrink-0" />
          <p className="text-slate-700 truncate">
            {demoStepNotice ??
              'Clinical Walkthrough: 1) Call Lapland Lung CT patient (Detect Transport) → 2) Inspect Regional Barrier Map (Rates & Privacy) → 3) Compare Shuttle vs Vouchers & Deploy Plan.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleLoadFeaturedDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
          >
            <Play className="w-3 h-3" />
            Load Featured Demo Journey
          </button>

          {activeTab === 'tab1' && (
            <button
              type="button"
              onClick={() => setActiveTab('tab2')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              Next: Map <ArrowRight className="w-3 h-3" />
            </button>
          )}
          {activeTab === 'tab2' && (
            <button
              type="button"
              onClick={() => setActiveTab('tab3')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              Next: Simulate <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Active Tab Content */}
      <main className="flex-1 px-4 lg:px-6 py-4 max-w-[1600px] w-full mx-auto">
        {activeTab === 'tab1' && (
          <Tab1CallingAgent
            patients={patients}
            selectedPatientId={selectedPatientId}
            activeCallPatientId={activeCallPatientId}
            recentlyUpdatedId={recentlyUpdatedId}
            onSelectPatient={setSelectedPatientId}
            onStartCall={handleStartCall}
            onEndCall={handleEndCall}
            onAppendTranscript={handleAppendTranscript}
            onApplyOutcome={handleApplyOutcome}
            onOverrideBarrier={handleOverrideBarrier}
            onRequestHumanCoordinator={handleRequestHumanCoordinator}
          />
        )}

        {activeTab === 'tab2' && (
          <Tab2RegionalBarrierMap
            patients={patients}
            activeCallRegionId={activeCallRegionId}
            onJumpToSimulator={(regId) => {
              setSimRegionId(regId);
              setActiveTab('tab3');
            }}
          />
        )}

        {activeTab === 'tab3' && (
          <Tab3InterventionSimulator
            patients={patients}
            selectedRegionId={simRegionId}
            severeWeatherActive={severeWeatherActive}
            deployedActions={deployedActions}
            onChangeRegion={setSimRegionId}
            onToggleSevereWeather={setSevereWeatherActive}
            onDeployIntervention={handleDeployIntervention}
            onReturnToTab1={() => setActiveTab('tab1')}
          />
        )}
      </main>
    </div>
  );
}

export default App;
