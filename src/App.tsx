import React, { useMemo, useRef, useState } from 'react';
import { Activity, UsersRound, MapPinned, HandHeart } from 'lucide-react';
import { finishPatientCall } from './utils/callLifecycle.ts';
import { getAttentionRegions, getRegionalSummaries } from './utils/regionalSummary.ts';
import { getEligiblePatients } from './utils/simulationEngine.ts';
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

export function App() {
  const patientSection = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<'patients' | 'regional' | 'support'>('patients');
  const tabs = [
    { id: 'patients', label: 'Patients', icon: UsersRound },
    { id: 'regional', label: 'Regional summary', icon: MapPinned },
    { id: 'support', label: 'Regional support', icon: HandHeart },
  ] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [patients, setPatients] = useState<PatientRecord[]>(INITIAL_PATIENTS);
  const [selectedPatientId, setSelectedPatientId] = useState<string>(FEATURED_DEMO_PATIENT_ID);
  const [activeCallPatientId, setActiveCallPatientId] = useState<string | null>(null);
  const callBeforeStartRef = useRef<{ id: string; status: CallStatus } | null>(null);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);

  // Shared dashboard state
  const [simRegionId, setSimRegionId] = useState<FocusRegionId | null>(null);
  const attentionRegions = useMemo(() => getAttentionRegions(patients), [patients]);
  const defaultRegionId = useMemo(() => getRegionalSummaries(patients)[0].regionId, [patients]);
  const [deployedActions, setDeployedActions] = useState<DeployedActionLog[]>([]);
  const [demoStepNotice, setDemoStepNotice] = useState<string | null>(null);

  const activeCallRegionId = useMemo(() => {
    if (!activeCallPatientId) return null;
    return patients.find((p) => p.id === activeCallPatientId)?.regionId ?? null;
  }, [patients, activeCallPatientId]);

  const handleStartCall = (patientId: string) => {
    callBeforeStartRef.current = { id: patientId, status: patients.find((p) => p.id === patientId)?.callStatus ?? 'Pending Call' };
    setActiveCallPatientId(patientId);
    setPatients((prev) =>
      prev.map((p) => (p.id === patientId ? { ...p, callStatus: 'Calling Live' } : p))
    );
  };

  const handleEndCall = () => {
    const previous = callBeforeStartRef.current;
    callBeforeStartRef.current = null;
    setActiveCallPatientId(null);
    setPatients((prev) =>
      prev.map((p) =>
        p.id === previous?.id || p.callStatus === 'Calling Live'
          ? finishPatientCall(p, p.id === previous?.id ? previous.status : 'Pending Call') : p
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
            text: `Human-in-the-Loop Override: Barrier classification verified/updated to [${newBarrier}]. Appointment held.`,
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

  const handleDeployIntervention = (
    regionId: FocusRegionId,
    intervention: InterventionComparison
  ) => {
    const affectedIds = new Set(getEligiblePatients(patients, regionId, intervention.id).map(p => p.id));
    const affectedCount = affectedIds.size;
    if (!affectedCount) return;
    setPatients((prev) =>
      prev.map((p) => {
        if (!affectedIds.has(p.id)) return p;
        return {
          ...p,
          deployedOperationAction: intervention.actionTemplate,
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
      severeWeatherActive: false,
      affectedPatientCount: affectedCount,
      taskSummary: `${intervention.actionTemplate} (queued for ${affectedCount} flagged patients in ${FOCUS_REGIONS[regionId].shortLabel}).`,
    };
    setDeployedActions((prev) => [log, ...prev]);
    setDemoStepNotice(
      `Support plan saved: ${intervention.shortName} for ${affectedCount} patients in ${FOCUS_REGIONS[regionId].shortLabel}.`
    );
  };

  function showPatients() {
    setActiveTab('patients');
    requestAnimationFrame(() => patientSection.current?.focus({ preventScroll: true }));
  }

  function openPlanning(regionId: FocusRegionId) {
    setSimRegionId(regionId);
    setActiveTab('support');
    tabRefs.current[2]?.focus();
  }

  return (
    <div className="care-dashboard min-h-screen">
      <a className="dashboard-skip" href="#patients" onClick={showPatients}>Skip to patients</a>
      <header className="dashboard-header">
        <div className="dashboard-brand"><Activity aria-hidden="true" /><h1>CareCatalyzer</h1></div>
      </header>
      <main className="dashboard-main">
        <div role="tablist" aria-label="CareCatalyzer sections" className="dashboard-tabs">
          {tabs.map((tab, index) => (
            <button key={tab.id} ref={(element) => { tabRefs.current[index] = element; }}
              type="button" role="tab" id={`tab-${tab.id}`} aria-controls={tab.id}
              aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setActiveTab(tabs[next].id);
                tabRefs.current[next]?.focus();
              }}>
              <span className="dashboard-tab-icon"><tab.icon aria-hidden="true" strokeWidth={1.8} /></span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        {activeTab === 'regional' && <div className="regional-attention" role="status">
          <div><strong>{attentionRegions.length ? 'Most attention needed' : 'No urgent cases'}</strong>
            <span>{attentionRegions.length ? attentionRegions.map(region => FOCUS_REGIONS[region.regionId].name).join(' · ') : 'Across all 19 regions'}</span>
            {attentionRegions.length > 0 && <small>{attentionRegions[0].urgent} urgent {attentionRegions.length > 1 ? 'in each region · tied highest count' : 'patients in the queue'}</small>}
          </div>
          {attentionRegions.length > 0 && <button type="button" onClick={() => openPlanning(attentionRegions[0].regionId)}>Plan support <HandHeart size={20} aria-hidden="true" /></button>}
        </div>}
        {demoStepNotice && activeTab === 'support' && <p className="dashboard-notice" role="status">{demoStepNotice}</p>}
        <section id="patients" role="tabpanel" aria-labelledby="tab-patients" hidden={activeTab !== 'patients'} ref={patientSection} tabIndex={0} className="dashboard-section">
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
          />
        </section>
        <section id="regional" role="tabpanel" aria-labelledby="tab-regional" hidden={activeTab !== 'regional'} tabIndex={0} className="dashboard-section">
          <h2 id="regional-heading">Regional summary</h2>
          <Tab2RegionalBarrierMap
            patients={patients}
            activeCallRegionId={activeCallRegionId}
            onJumpToSimulator={openPlanning}
          />
        </section>
        <section id="support" role="tabpanel" aria-labelledby="tab-support" hidden={activeTab !== 'support'} tabIndex={0} className="dashboard-section">
          <h2>Regional support</h2>
          <div className="dashboard-planning-body">
            <Tab3InterventionSimulator
              patients={patients}
              selectedRegionId={simRegionId ?? defaultRegionId}
              deployedActions={deployedActions}
              onChangeRegion={setSimRegionId}
              onDeployIntervention={handleDeployIntervention}
              onReturnToPatients={showPatients}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
