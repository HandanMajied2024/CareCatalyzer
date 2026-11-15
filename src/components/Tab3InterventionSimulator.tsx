import React, { useMemo, useState } from 'react';
import {
  ArrowUp,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudSnow,
  Download,
  Euro,
  Info,
  PhoneCall,
  Rocket,
  Scale,
  Timer,
  TrendingUp,
  Users,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  onReturnToPatients: () => void;
}

const shortName = (label: string) => label.split(' / ')[0];

/** Range bar: grey track, coloured band from low to high, label inside. */
const RangeBar: React.FC<{
  icon: LucideIcon;
  label: string;
  low: number;
  high: number;
  max: number;
  text: string;
  colorClass: string;
}> = ({ icon: Icon, label, low, high, max, text, colorClass }) => {
  const left = Math.max(0, Math.min(65, (low / max) * 100));
  const width = Math.min(100 - left, Math.max(35, (high / max) * 100 - left));
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm text-black mb-1.5">
        <Icon className="w-5 h-5 shrink-0" aria-hidden />
        {label}
      </div>
      <div className="relative h-9 w-full bg-cc-surface rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 rounded-full flex items-center justify-center px-2 transition-all duration-300 ${colorClass}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          <span className="text-sm font-bold tabular-nums whitespace-nowrap">{text}</span>
        </div>
      </div>
    </div>
  );
};

export const Tab3InterventionSimulator: React.FC<Tab3InterventionSimulatorProps> = ({
  patients,
  selectedRegionId,
  severeWeatherActive,
  deployedActions,
  onChangeRegion,
  onToggleSevereWeather,
  onDeployIntervention,
  onReturnToPatients,
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

  // Shared scales so the three plans are visually comparable
  const scales = useMemo(
    () => ({
      cost: Math.max(1, ...interventions.map((i) => i.estimatedCostEur)),
      gain: Math.max(1, ...interventions.map((i) => i.attendanceGainPctHigh)) * 1.1,
      days: Math.max(1, ...interventions.map((i) => i.daysSavedHigh)) * 1.1,
      equity: Math.max(1, ...interventions.map((i) => i.equityGapReductionPctHigh)) * 1.1,
    }),
    [interventions]
  );

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
    <div className="space-y-8 text-base">
      {/* Scenario controls */}
      <section className="bg-white border border-cc-line rounded-[20px] p-5 sm:p-8 space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          {/* Region selector */}
          <div
            className="flex flex-wrap items-center gap-1 p-1 rounded-full bg-cc-surface"
            role="group"
            aria-label="Region"
          >
            {FOCUS_REGION_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onChangeRegion(id)}
                aria-pressed={selectedRegionId === id}
                title={FOCUS_REGIONS[id].name}
                className={`min-h-11 px-4 rounded-full text-base font-medium transition-colors cursor-pointer ${
                  selectedRegionId === id
                    ? 'bg-black text-white'
                    : 'text-black hover:bg-cc-line'
                }`}
              >
                {shortName(FOCUS_REGIONS[id].shortLabel)}
              </button>
            ))}
          </div>

          {/* Severe weather toggle */}
          <button
            type="button"
            onClick={() => onToggleSevereWeather(!severeWeatherActive)}
            aria-pressed={severeWeatherActive}
            title="Severe winter weather stress test"
            className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-full border text-base font-semibold transition-colors cursor-pointer ${
              severeWeatherActive
                ? 'bg-cc-yellow border-cc-yellow text-black'
                : 'bg-white border-cc-line text-black hover:bg-cc-surface'
            }`}
          >
            <CloudSnow className="w-5 h-5" aria-hidden />
            Winter
            <span
              className={`ml-1 w-10 h-6 rounded-full p-0.5 transition-colors ${
                severeWeatherActive ? 'bg-black' : 'bg-cc-line'
              }`}
              aria-hidden
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  severeWeatherActive ? 'translate-x-4' : ''
                }`}
              />
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* Live baseline */}
          <div className="bg-cc-surface rounded-[16px] p-5">
            <Car className="w-6 h-6 text-cc-red" aria-hidden />
            <div className="mt-2 text-4xl font-extrabold tabular-nums leading-none">
              {liveRegionStats.transportWeatherRate}
              <span className="text-lg font-medium text-cc-muted">/100</span>
            </div>
            <div className="mt-2 text-sm text-cc-muted">Transport + weather</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-full bg-white text-sm font-semibold"
                title="Callbacks queued"
              >
                <PhoneCall className="w-4 h-4 text-cc-blue" aria-hidden />
                {liveRegionStats.followUpQueued}
              </span>
              <span
                className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-full bg-white text-sm font-semibold"
                title="Timing alerts"
              >
                <Clock className="w-4 h-4 text-cc-yellow" aria-hidden />
                {liveRegionStats.goal3RiskCount}
              </span>
            </div>
          </div>

          {/* Budget slider */}
          <div className="bg-cc-surface rounded-[16px] p-5 flex flex-col">
            <Euro className="w-6 h-6 text-cc-blue" aria-hidden />
            <div className="mt-2 text-4xl font-extrabold tabular-nums leading-none">
              €{Math.round(monthlyBudgetEur / 1000)}k
            </div>
            <div className="mt-2 text-sm text-cc-muted">Budget / month</div>
            <input
              type="range"
              min={12000}
              max={60000}
              step={2000}
              value={monthlyBudgetEur}
              onChange={(e) => setMonthlyBudgetEur(Number(e.target.value))}
              aria-label="Monthly pilot budget in euros"
              className="mt-auto pt-3 w-full h-11 accent-cc-blue cursor-pointer"
            />
          </div>

          {/* Adoption slider */}
          <div className="bg-cc-surface rounded-[16px] p-5 flex flex-col">
            <UserCheck className="w-6 h-6 text-cc-blue" aria-hidden />
            <div className="mt-2 text-4xl font-extrabold tabular-nums leading-none">{adoptionPct}%</div>
            <div className="mt-2 text-sm text-cc-muted">Adoption</div>
            <input
              type="range"
              min={40}
              max={100}
              step={5}
              value={adoptionPct}
              onChange={(e) => setAdoptionPct(Number(e.target.value))}
              aria-label="Care coordinator adoption rate"
              className="mt-auto pt-3 w-full h-11 accent-cc-blue cursor-pointer"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col justify-center gap-3">
            <button
              type="button"
              onClick={() =>
                onDeployIntervention(selectedRegionId, activeIntervention, severeWeatherActive)
              }
              className="w-full inline-flex items-center justify-center gap-2 min-h-14 px-5 rounded-full bg-cc-blue hover:bg-black text-white font-semibold text-lg transition-colors cursor-pointer"
            >
              <Rocket className="w-5 h-5" aria-hidden />
              Deploy
            </button>
            <button
              type="button"
              onClick={handleExportPlanJson}
              title="Export action plan (JSON)"
              className="w-full inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-full bg-white hover:bg-cc-surface text-black border border-cc-line text-base font-medium transition-colors cursor-pointer"
            >
              <Download className="w-5 h-5" aria-hidden />
              Export JSON
            </button>
          </div>
        </div>
      </section>

      {/* 3 interventions side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8 items-stretch">
        {interventions.map((item) => {
          const isSelected = item.id === selectedInterventionId;
          const isExpanded = expandedCards[item.id];
          const costPct = Math.max(8, (item.estimatedCostEur / scales.cost) * 100);

          return (
            <section
              key={item.id}
              className={`rounded-[20px] border-2 flex flex-col transition-colors bg-white ${
                isSelected ? 'border-cc-blue' : 'border-cc-line'
              }`}
            >
              <div className="p-5 sm:p-7 space-y-6 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold tracking-[-0.02em] leading-tight text-black">
                      {item.name}
                    </h3>
                    <div
                      className="mt-2 inline-flex items-center gap-1.5 text-base text-cc-muted"
                      title="Eligible patients"
                    >
                      <Users className="w-5 h-5" aria-hidden />
                      <span className="font-semibold text-black tabular-nums">
                        {item.eligiblePatientsCount}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedInterventionId(item.id)}
                    aria-pressed={isSelected}
                    aria-label={isSelected ? 'Selected plan' : `Select ${item.name}`}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-4 rounded-full text-base font-semibold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-cc-blue text-white border-cc-blue'
                        : 'bg-white text-black border-cc-line hover:bg-cc-surface'
                    }`}
                  >
                    {isSelected ? <Check className="w-5 h-5" aria-hidden /> : 'Select'}
                  </button>
                </div>

                {/* Cost */}
                <div title={item.costRangeText}>
                  <div className="flex items-baseline gap-2">
                    <Euro className="w-5 h-5 self-center" aria-hidden />
                    <span className="text-[32px] font-extrabold tabular-nums leading-none">
                      {item.estimatedCostEur.toLocaleString()}
                    </span>
                    <span className="text-sm text-cc-muted">/ month</span>
                  </div>
                  <div className="mt-3 h-3 w-full bg-cc-surface rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-black transition-all duration-300"
                      style={{ width: `${costPct}%` }}
                    />
                  </div>
                </div>

                {/* Impact bars (95% bands) */}
                <div className="space-y-4">
                  <RangeBar
                    icon={TrendingUp}
                    label="Attendance"
                    low={item.attendanceGainPctLow}
                    high={item.attendanceGainPctHigh}
                    max={scales.gain}
                    text={`+${item.attendanceGainPctLow}–${item.attendanceGainPctHigh}%`}
                    colorClass="bg-cc-green text-white"
                  />
                  <RangeBar
                    icon={Timer}
                    label="Days saved"
                    low={item.daysSavedLow}
                    high={item.daysSavedHigh}
                    max={scales.days}
                    text={`${item.daysSavedLow}–${item.daysSavedHigh} d`}
                    colorClass="bg-cc-blue text-white"
                  />
                  <RangeBar
                    icon={Scale}
                    label="Equity gap"
                    low={item.equityGapReductionPctLow}
                    high={item.equityGapReductionPctHigh}
                    max={scales.equity}
                    text={`−${item.equityGapReductionPctLow}–${item.equityGapReductionPctHigh}%`}
                    colorClass="bg-cc-green text-white"
                  />
                </div>

                {/* Mechanism, evidence, assumptions (behind a click) */}
                <div className="border-t border-cc-line pt-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    aria-expanded={isExpanded}
                    className="w-full min-h-11 flex items-center justify-between text-base font-medium text-black hover:text-cc-blue cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Info className="w-5 h-5 text-cc-blue" aria-hidden />
                      Evidence
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5" aria-hidden />
                    ) : (
                      <ChevronDown className="w-5 h-5" aria-hidden />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-4 text-base text-black leading-normal">
                      <p>{item.mechanism}</p>
                      <ul className="list-disc pl-5 space-y-1 text-cc-muted">
                        {item.evidenceBase.map((ev, idx) => (
                          <li key={idx}>{ev}</li>
                        ))}
                      </ul>
                      <div className="bg-cc-yellow-soft rounded-[12px] p-4">
                        <ul className="list-disc pl-5 space-y-1">
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

      {/* Deployed actions feed */}
      {deployedActions.length > 0 && (
        <section className="bg-cc-green-soft rounded-[20px] p-5 sm:p-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xl font-bold text-black">
              <CheckCircle2 className="w-7 h-7 text-cc-green" aria-hidden />
              Deployed
              <span className="inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-full bg-cc-green text-white text-base tabular-nums">
                {deployedActions.length}
              </span>
            </div>
            <button
              type="button"
              onClick={onReturnToPatients}
              className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-white text-base font-semibold text-cc-blue hover:bg-cc-blue-soft cursor-pointer"
            >
              <ArrowUp className="w-5 h-5" aria-hidden />
              Patients
            </button>
          </div>

          <div className="space-y-3">
            {deployedActions.map((act) => (
              <div
                key={act.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-[12px] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-black">{act.interventionName}</span>
                    <span className="text-cc-muted">· {shortName(FOCUS_REGIONS[act.regionId].shortLabel)}</span>
                    {act.severeWeatherActive && (
                      <CloudSnow className="w-5 h-5 text-black" aria-label="Severe weather" />
                    )}
                  </div>
                  <p className="text-sm text-cc-muted mt-1">{act.taskSummary}</p>
                </div>
                <span className="inline-flex items-center gap-3 text-sm text-cc-muted tabular-nums">
                  <span className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-full bg-cc-green-soft text-black font-semibold">
                    <Users className="w-4 h-4" aria-hidden />
                    {act.affectedPatientCount}
                  </span>
                  {act.deployedAt}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
