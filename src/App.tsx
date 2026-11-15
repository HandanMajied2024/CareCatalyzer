import React, { useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, CircleCheck, Map as MapIcon, Users } from 'lucide-react';
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
  const planningSection = useRef<HTMLDetailsElement>(null);
  const [patients, setPatients] = useState<PatientRecord[]>(INITIAL_PATIENTS);
  const [selectedPatientId, setSelectedPatientId] = useState<string>(FEATURED_DEMO_PATIENT_ID);
  const [activeCallPatientId, setActiveCallPatientId] = useState<string | null>(null);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);

  // Shared dashboard state
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
      `Action Plan Deployed: ${intervention.shortName} queued for ${affectedCount} patients in ${FOCUS_REGIONS[regionId].shortLabel}. Patient tasks have been updated below.`
    );
  };

  function showPatients() {
    patientSection.current?.scrollIntoView({ block: 'start' });
    patientSection.current?.focus({ preventScroll: true });
  }

  function openPlanning(regionId: FocusRegionId) {
    setSimRegionId(regionId);
    if (planningSection.current) {
      planningSection.current.open = true;
      planningSection.current.scrollIntoView({ block: 'start' });
      planningSection.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  }

  return (
    <div className="care-dashboard min-h-screen">
      <a className="dashboard-skip" href="#patients">Skip to patients</a>
      <header className="dashboard-header">
        <div className="dashboard-brand"><Activity aria-hidden="true" /><h1>CareCatalyzer</h1></div>
        <div className="dashboard-actions">
          <span className="dashboard-stat" title="Demo patients" aria-label={`${patients.length} demo patients`}>
            <Users aria-hidden="true" />{patients.length}
          </span>
          <span className="dashboard-stat dashboard-stat-alert" title="Timing alerts" aria-label={`${pathwayAlertsCount} timing alerts`}>
            <AlertTriangle aria-hidden="true" />{pathwayAlertsCount}
          </span>
        </div>
      </header>
      <main className="dashboard-main">
        {demoStepNotice && (
          <p className="dashboard-notice" role="status">
            <CircleCheck aria-hidden="true" />
            <span>{demoStepNotice}</span>
          </p>
        )}
        <section id="patients" ref={patientSection} tabIndex={-1} aria-label="Patient coordination" className="dashboard-section">
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
        </section>
        <section aria-labelledby="regional-heading" className="dashboard-section">
          <h2 id="regional-heading">Regions</h2>
          <Tab2RegionalBarrierMap
            patients={patients}
            activeCallRegionId={activeCallRegionId}
            onJumpToSimulator={openPlanning}
          />
        </section>
        <details ref={planningSection} className="dashboard-planning">
          <summary><MapIcon aria-hidden="true" /><span>Support plans</span><ChevronDown aria-hidden="true" className="dashboard-planning-chevron" /></summary>
          <div className="dashboard-planning-body">
            <Tab3InterventionSimulator
              patients={patients}
              selectedRegionId={simRegionId}
              severeWeatherActive={severeWeatherActive}
              deployedActions={deployedActions}
              onChangeRegion={setSimRegionId}
              onToggleSevereWeather={setSevereWeatherActive}
              onDeployIntervention={handleDeployIntervention}
              onReturnToPatients={showPatients}
            />
          </div>
        </details>
      </main>
    </div>
  );
}

export default App;
