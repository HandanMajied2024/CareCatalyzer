import React, { useMemo } from 'react';
import { Bus, Wallet, HandHeart, Check } from 'lucide-react';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER } from '../data/regions.ts';
import { getRegionalSummaries } from '../utils/regionalSummary.ts';
import { runInterventionSimulation } from '../utils/simulationEngine.ts';
import type { PatientRecord, FocusRegionId, DeployedActionLog, InterventionComparison } from '../types/careconnect.ts';

export function Tab3InterventionSimulator({ patients, selectedRegionId, deployedActions,
  onChangeRegion, onDeployIntervention, onReturnToPatients }: {
  patients: PatientRecord[]; selectedRegionId: FocusRegionId;
  deployedActions: DeployedActionLog[]; onChangeRegion: (id: FocusRegionId) => void;
  onDeployIntervention: (id: FocusRegionId, intervention: InterventionComparison) => void;
  onReturnToPatients: () => void;
}) {
  const plans = useMemo(() => runInterventionSimulation(patients, { regionId: selectedRegionId,
    severeWeatherActive: false, monthlyBudgetEur: 32000, coordinatorAdoptionPct: 100 }), [patients, selectedRegionId]);
  const stats = getRegionalSummaries(patients).find(region => region.regionId === selectedRegionId)!;
  const icons = { shared_shuttle: Bus, travel_vouchers: Wallet, flexible_navigation: HandHeart };
  const actions = deployedActions.filter(action => action.regionId === selectedRegionId);
  return <div className="regional-support">
    <div className="support-toolbar">
      <label htmlFor="support-region">Region<select id="support-region" value={selectedRegionId} onChange={e => onChangeRegion(e.target.value as FocusRegionId)}>
        {FOCUS_REGION_ORDER.map(id => <option key={id} value={id}>{FOCUS_REGIONS[id].name}</option>)}
      </select></label>
    </div>
    <div className="region-metrics support-metrics">
      <div><strong>{stats.total}</strong><span>Patients</span></div>
      <div className="urgent-count"><strong>{stats.urgent}</strong><span>Urgent</span></div>
      <div><strong>{stats.followUp}</strong><span>Follow-ups</span></div>
      <div><strong>{stats.barriers}</strong><span>Recorded barriers</span></div>
    </div>
    <div className="support-plan-grid">{plans.map(plan => {
      const Icon = icons[plan.id];
      return <article className="support-plan" key={plan.id}>
        <Icon size={30} aria-hidden="true" /><h3>{plan.name}</h3><p>{plan.mechanism}</p>
        <div className="support-plan-numbers"><div><strong>{plan.eligiblePatientsCount}</strong><span>Matching patients</span></div><div><strong>{plan.costRangeText}</strong><span>Estimated allowance · assumption</span></div></div>
        <details><summary>Cost assumptions</summary>{plan.assumptions.map(line => <p key={line}>{line}</p>)}</details>
        <button type="button" disabled={!plan.eligiblePatientsCount} onClick={() => onDeployIntervention(selectedRegionId, plan)}>Save support plan</button>
      </article>;
    })}</div>
    {actions.length > 0 && <div className="support-history"><h3>Saved support plans</h3>{actions.map(action => <div key={action.id}><Check size={20} aria-hidden="true" /><p><strong>{action.interventionName}</strong> · {action.affectedPatientCount} patients<small>{action.deployedAt} · {action.taskSummary}</small></p></div>)}<button type="button" onClick={onReturnToPatients}>View patients</button></div>}
  </div>;
}
