import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudSnow,
  Download,
  Info,
  Rocket,
} from 'lucide-react';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER } from '../data/patients.ts';
import type {
  DeployedActionLog,
  FocusRegionId,
  InterventionComparison,
  InterventionId,
  PatientRecord,
} from '../types/careconnect.ts';
import { runInterventionSimulation } from '../utils/simulationEngine.ts';

interface Tab3InterventionSimulatorProps {
  patients: PatientRecord[];
  selectedRegionId: FocusRegionId;
  severeWeatherActive: boolean;
  deployedActions: DeployedActionLog[];
  onChangeRegion: (regionId: FocusRegionId) => void;
  onToggleSevereWeather: (active: boolean) => void;
  onDeployIntervention: (
    regionId: FocusRegionId,
    intervention: InterventionComparison,
    severeWeatherActive: boolean
  ) => void;
  onReturnToTab1: () => void;
}

export const Tab3InterventionSimulator: React.FC<Tab3InterventionSimulatorProps> = ({
  patients,
  selectedRegionId,
  severeWeatherActive,
  deployedActions,
  onChangeRegion,
  onToggleSevereWeather,
  onDeployIntervention,
  onReturnToTab1,
}) => {
  const [monthlyBudgetEur, setMonthlyBudgetEur] = useState<number>(32000);
  const [adoptionPct, setAdoptionPct] = useState<number>(80);
  const [selectedInterventionId, setSelectedInterventionId] =
    useState<InterventionId>('shared_shuttle');
  const [expandedCards, setExpandedCards] = useState<Record<InterventionId, boolean>>({
    shared_shuttle: true,
    travel_vouchers: false,
    flexible_navigation: false,
  });

  const interventions = useMemo(
    () =>
      runInterventionSimulation(patients, {
        regionId: selectedRegionId,
        severeWeatherActive,
        monthlyBudgetEur,
        coordinatorAdoptionPct: adoptionPct,
      }),
    [patients, selectedRegionId, severeWeatherActive, monthlyBudgetEur, adoptionPct]
  );

  const liveRegionStats = useMemo(() => {
    const regPatients = patients.filter((p) => p.regionId === selectedRegionId);
    const contacted = regPatients.filter((p) => p.callStatus !== 'Pending Call');
    const transportWeather = contacted.filter(
      (p) => p.verifiedBarrier === 'Transport' || p.verifiedBarrier === 'Weather'
    ).length;
    const goal3RiskCount = regPatients.filter((p) => p.goal3AtRisk).length;
    const followUpQueued = regPatients.filter(
      (p) => p.callStatus === 'Follow-Up Required (Human Callback Queued)'
    ).length;

    return {
      total: regPatients.length,
      contactedN: contacted.length,
      transportWeatherRate:
        contacted.length > 0 ? ((transportWeather / contacted.length) * 100).toFixed(1) : '0.0',
      goal3RiskCount,
      followUpQueued,
    };
  }, [patients, selectedRegionId]);

  const activeIntervention =
    interventions.find((i) => i.id === selectedInterventionId) ?? interventions[0];

  const toggleExpand = (id: InterventionId) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExportPlanJson = () => {
    const affected = patients.filter(
      (p) =>
        p.regionId === selectedRegionId &&
        (p.callStatus === 'Follow-Up Required (Human Callback Queued)' ||
          p.goal3AtRisk ||
          p.distanceKm >= 100)
    );
    const manifest = {
      exportedAt: new Date().toISOString(),
      pathway: 'Lung Cancer Fast-Track (Finland Cancer Strategy 2026–2035, Goal 3)',
      region: FOCUS_REGIONS[selectedRegionId].name,
      severeWeatherStressTest: severeWeatherActive,
      selectedIntervention: {
        name: activeIntervention.name,
        estimatedMonthlyCostEur: activeIntervention.estimatedCostEur,
        projectedAttendanceGainPct: `${activeIntervention.attendanceGainPctLow}–${activeIntervention.attendanceGainPctHigh}%`,
        daysSaved95CI: `-${activeIntervention.daysSavedLow} to -${activeIntervention.daysSavedHigh} days`,
        equityGapReduction95CI: `${activeIntervention.equityGapReductionPctLow}–${activeIntervention.equityGapReductionPctHigh}%`,
      },
      operationalTaskQueue: affected.map((p) => ({
        patientId: p.id,
        municipality: p.municipality,
        pathwayStage: p.pathwayStage,
        barrier: p.verifiedBarrier ?? 'Preventive Rural Support',
        task: activeIntervention.actionTemplate,
      })),
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fican-action-plan-${selectedRegionId.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Scenario & Stress-Test Controls Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Scenario &amp; Severe Weather Stress-Test Controls
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live baseline rates synced from Tab 1 &amp; Tab 2 · Synthetic model estimates include
              explicit 95% confidence bands
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Region selector */}
            <div className="flex items-center p-0.5 rounded-md bg-slate-100 border border-slate-200">
              {FOCUS_REGION_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeRegion(id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    selectedRegionId === id
                      ? 'bg-white text-sky-800 font-semibold shadow-2xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {FOCUS_REGIONS[id].shortLabel}
                </button>
              ))}
            </div>

            {/* Severe Weather Stress-Test Toggle */}
            <button
              type="button"
              onClick={() => onToggleSevereWeather(!severeWeatherActive)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${
                severeWeatherActive
                  ? 'bg-red-50 border-red-300 text-red-800'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <CloudSnow className="w-3.5 h-3.5" />
              Severe Winter Weather: {severeWeatherActive ? 'ACTIVE' : 'Normal'}
            </button>
          </div>
        </div>

        {/* Live Regional Baseline Inputs + Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3 border-t border-slate-200">
          <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs">
            <div className="text-[11px] text-slate-500">
              Live Baseline ({FOCUS_REGIONS[selectedRegionId].shortLabel})
            </div>
            <div className="mt-1 font-mono tabular-nums text-slate-900 font-semibold">
              {liveRegionStats.transportWeatherRate} / 100 Transport+Weather
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              {liveRegionStats.followUpQueued} callbacks queued · {liveRegionStats.goal3RiskCount} Goal 3 at-risk
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Monthly Pilot Budget</span>
              <span className="font-mono tabular-nums font-semibold text-sky-800">
                €{monthlyBudgetEur.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min={12000}
              max={60000}
              step={2000}
              value={monthlyBudgetEur}
              onChange={(e) => setMonthlyBudgetEur(Number(e.target.value))}
              aria-label="Monthly pilot budget in euros"
              className="w-full accent-sky-700 cursor-pointer"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Coordinator Adoption</span>
              <span className="font-mono tabular-nums font-semibold text-sky-800">
                {adoptionPct}%
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={100}
              step={5}
              value={adoptionPct}
              onChange={(e) => setAdoptionPct(Number(e.target.value))}
              aria-label="Care coordinator adoption rate"
              className="w-full accent-sky-700 cursor-pointer"
            />
          </div>

          <div className="flex flex-col justify-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onDeployIntervention(selectedRegionId, activeIntervention, severeWeatherActive)
              }
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5" />
              Deploy Action Plan to Care Team
            </button>
            <button
              type="button"
              onClick={handleExportPlanJson}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" />
              Export &amp; Trigger Operational Action (JSON)
            </button>
          </div>
        </div>
      </section>

      {/* Side-by-Side Comparison of 3 Interventions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {interventions.map((item) => {
          const isSelected = item.id === selectedInterventionId;
          const isExpanded = expandedCards[item.id];

          return (
            <section
              key={item.id}
              className={`rounded-lg border flex flex-col transition-colors bg-white shadow-2xs ${
                isSelected
                  ? 'border-sky-600 ring-1 ring-sky-600/20'
                  : 'border-slate-200'
              }`}
            >
              <div className="p-4 space-y-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{item.name}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Eligible cohort:{' '}
                      <strong className="font-mono text-slate-800">
                        {item.eligiblePatientsCount}
                      </strong>{' '}
                      patients in {FOCUS_REGIONS[selectedRegionId].shortLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedInterventionId(item.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-sky-700 text-white border-sky-700'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {isSelected ? 'Selected Plan' : 'Select'}
                  </button>
                </div>

                {/* 4 Comparison Metrics with 95% Uncertainty Ranges */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">Estimated Cost</div>
                    <div className="mt-0.5 font-mono tabular-nums font-bold text-slate-900">
                      €{item.estimatedCostEur.toLocaleString()}/mo
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">{item.costRangeText}</div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">Attendance Gain (95% CI)</div>
                    <div className="mt-0.5 font-mono tabular-nums font-bold text-emerald-700">
                      +{item.attendanceGainPctLow}% to +{item.attendanceGainPctHigh}%
                    </div>
                    <div className="text-[10px] text-slate-500">Fast-track completion</div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">Days Saved to Treatment</div>
                    <div className="mt-0.5 font-mono tabular-nums font-bold text-sky-800">
                      -{item.daysSavedLow} to -{item.daysSavedHigh} days
                    </div>
                    <div className="text-[10px] text-slate-500">95% uncertainty band</div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">Equity Gap Reduction</div>
                    <div className="mt-0.5 font-mono tabular-nums font-bold text-amber-800">
                      -{item.equityGapReductionPctLow}% to -{item.equityGapReductionPctHigh}%
                    </div>
                    <div className="text-[10px] text-slate-500">Rural vs urban parity</div>
                  </div>
                </div>

                {/* Expandable Mechanism, Evidence Base & Assumptions */}
                <div className="border-t border-slate-200 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    className="w-full flex items-center justify-between text-xs font-medium text-slate-800 hover:text-sky-700 cursor-pointer py-1"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-sky-700" />
                      Mechanism, Evidence Base &amp; Assumptions
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mt-2 space-y-2 text-[11px] text-slate-700 leading-relaxed">
                      <div>
                        <strong className="text-slate-900">Why it helps:</strong> {item.mechanism}
                      </div>
                      <div>
                        <strong className="text-slate-900">Public Evidence:</strong>
                        <ul className="list-disc pl-4 mt-0.5 space-y-0.5 text-slate-700">
                          {item.evidenceBase.map((ev, idx) => (
                            <li key={idx}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-amber-50/70 border border-amber-200 rounded p-2 text-slate-700">
                        <strong className="text-amber-900">Synthetic Model Caveats:</strong>
                        <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                          {item.assumptions.map((asmp, idx) => (
                            <li key={idx}>{asmp}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Live Deployed Operational Actions Feed */}
      {deployedActions.length > 0 && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              Operational Action Plans Triggered to Care Team ({deployedActions.length})
            </div>
            <button
              type="button"
              onClick={onReturnToTab1}
              className="text-xs font-semibold text-sky-800 hover:underline cursor-pointer"
            >
              Inspect Updated Patient Tasks in Tab 1 &rarr;
            </button>
          </div>

          <div className="space-y-1.5">
            {deployedActions.map((act) => (
              <div
                key={act.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white border border-emerald-200 rounded px-3 py-2"
              >
                <div>
                  <span className="font-semibold text-slate-900">{act.interventionName}</span>
                  <span className="text-slate-600 ml-2">
                    · {FOCUS_REGIONS[act.regionId].shortLabel}
                    {act.severeWeatherActive ? ' (Severe Weather Active)' : ''}
                  </span>
                  <p className="text-[11px] text-emerald-800 mt-0.5">{act.taskSummary}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500">
                  {act.affectedPatientCount} tasks queued · {act.deployedAt}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
