import React, { useMemo, useState } from 'react';
import { ArrowRight, Phone, AlertCircle, Target, FlaskConical } from 'lucide-react';
import { goal3ByRegion, goal3Share } from '../utils/goal3.ts';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER, REGION_MAP_PATHS, REGION_MAP_LABELS } from '../data/regions.ts';
import { getRegionalSummaries, getAttentionRegions, getRegionCategory, REGION_CATEGORY_RULES, type RegionCategory } from '../utils/regionalSummary.ts';
import { BARRIER_CATEGORIES } from '../utils/riskEngine.ts';
import type { FocusRegionId, PatientRecord } from '../types/careconnect.ts';

function Goal3Bar({ label, percent, onTarget, total, strong }: { label: string; percent: number; onTarget: number; total: number; strong?: boolean }) {
  return <div className={'goal3-row' + (strong ? ' goal3-row-strong' : '')}>
    <span className="goal3-label">{label}</span>
    <div className="goal3-track" role="img" aria-label={label + ': ' + percent + '% treatment started within target time (' + onTarget + ' of ' + total + ', synthetic)'}>
      <div className="goal3-fill" style={{ width: Math.max(percent, 12) + '%' }}>{percent}%</div>
    </div>
  </div>;
}

export function Tab2RegionalBarrierMap({ patients, activeCallRegionId, focusRegionId = null, highlight = null, onJumpToSimulator }: {
  patients: PatientRecord[]; activeCallRegionId: FocusRegionId | null;
  focusRegionId?: FocusRegionId | null;
  highlight?: { regionId: FocusRegionId; barrier: string | null; cancelled: boolean } | null;
  onJumpToSimulator: (region: FocusRegionId) => void;
}) {
  const summaries = useMemo(() => getRegionalSummaries(patients), [patients]);
  const leaders = useMemo(() => getAttentionRegions(patients), [patients]);
  const [chosenRegion, setChosenRegion] = useState<FocusRegionId | null>(null);
  const selectedRegion = chosenRegion ?? focusRegionId ?? summaries[0].regionId;
  const goal3 = useMemo(() => goal3ByRegion(patients), [patients]);
  const goal3National = useMemo(() => goal3Share(patients), [patients]);
  const selected = summaries.find(region => region.regionId === selectedRegion)!;
  const records = patients.filter(p => p.regionId === selectedRegion);
  const barrierRecords = records.filter(p => p.verifiedBarrier && p.callStatus !== 'Confirmed Attending');
  return <>
  <section className="goal3-tile" aria-labelledby="goal3-title">
    <div className="goal3-head">
      <h3 id="goal3-title"><Target size={22} aria-hidden="true" /> Treatment started within target time</h3>
      <span className="synthetic-badge" title="Computed from synthetic patients' pathway events"><FlaskConical aria-hidden="true" />synthetic</span>
    </div>
    <div className="goal3-bars">
      <Goal3Bar label={FOCUS_REGIONS[selectedRegion].name} {...goal3[selectedRegion]} strong />
      {selectedRegion !== '01' && <Goal3Bar label={FOCUS_REGIONS['01'].name} {...goal3['01']} />}
      <Goal3Bar label="Finland" {...goal3National} />
    </div>
    <p className="goal3-source">Goal 3 · National Cancer Strategy 2026–2035 · THL Ohjaus 21/2016. Finland publishes no regional figure for this yet — the agent's pathway events produce it.</p>
  </section>
  <div className="regions-layout">
    <div className="region-map-card">
      <div className="region-map-heading"><h3>Finland · 19 regions</h3><span>{patients.length} patients</span></div>
      <div className="region-map-legend" aria-label="Regional attention categories">
        {(Object.keys(REGION_CATEGORY_RULES) as RegionCategory[]).map(category => <span key={category} title={REGION_CATEGORY_RULES[category]}><i className={'category-' + category} />{category}</span>)}
      </div>
      <details className="region-thresholds"><summary>Colour thresholds</summary>
        <p>The highest matching colour applies. Risky = High Risk; very risky = Very High Risk.</p>
        {(Object.keys(REGION_CATEGORY_RULES) as RegionCategory[]).map(category => <p key={category}><strong>{category}:</strong> {REGION_CATEGORY_RULES[category]}</p>)}
      </details>
      <div className="region-map-container">
      <svg className="finland-region-map" viewBox="0 0 560 740" role="group" aria-label="Finland regions. Select a region to view its patients and support needs.">
        {FOCUS_REGION_ORDER.map(id => {
          const stat = summaries.find(region => region.regionId === id)!;
          const priority = leaders.some(region => region.regionId === id);
          const category = getRegionCategory(stat);
          return <path key={id} d={REGION_MAP_PATHS[id]} fillRule="evenodd"
            className={'region-shape category-' + category + (selectedRegion === id ? ' region-selected' : '')}
            role="button" tabIndex={0} aria-pressed={selectedRegion === id}
            aria-label={FOCUS_REGIONS[id].name + ': ' + category + ', ' + stat.urgent + ' urgent, ' + stat.veryHigh + ' very risky, ' + stat.high + ' risky'}
            onClick={() => setChosenRegion(id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosenRegion(id); } }}>
            <title>{FOCUS_REGIONS[id].name} · {category} · {stat.urgent} urgent · {stat.veryHigh} very risky · {stat.high} risky{priority ? ' · Most urgent cases' : ''}</title>
          </path>;
        })}
        {FOCUS_REGION_ORDER.map(id => {
          const label = REGION_MAP_LABELS[id];
          return <text key={id} className="region-map-label" aria-hidden="true" textAnchor="middle" fontSize={label.fontSize}
            transform={'translate(' + label.x + ' ' + label.y + ') rotate(' + label.rotate + ')'}>
            {label.lines.map((line, index) => <tspan key={line} x={0} y={(index - (label.lines.length - 1) / 2) * 10}>{line}</tspan>)}
          </text>;
        })}
      </svg>
      </div>
      <details className="region-attribution"><summary>Map information</summary><p><a href="https://stat.fi/en/services/statistical-data-services/geographic-data/statistical-areas/municipality-based-statistical-units" target="_blank" rel="noreferrer">Statistics Finland, 2026</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p></details>
    </div>
    <div className="region-details">
      <div className="region-detail-card">
        <label htmlFor="summary-region">Selected region</label>
        <select id="summary-region" value={selectedRegion} onChange={e => setChosenRegion(e.target.value as FocusRegionId)}>
          {FOCUS_REGION_ORDER.map(id => <option key={id} value={id}>{FOCUS_REGIONS[id].name}</option>)}
        </select>
        <div className="region-title"><h3>{FOCUS_REGIONS[selectedRegion].name}</h3>{activeCallRegionId === selectedRegion && <span><Phone size={18} aria-hidden="true" /> Call in progress</span>}</div>
        <span className={'region-category-badge category-' + getRegionCategory(selected)}>{getRegionCategory(selected)} attention</span>
        <div className="region-metrics">
          <div><strong>{selected.total}</strong><span>Patients</span></div>
          <div className="urgent-count"><strong>{selected.urgent}</strong><span>Urgent</span></div>
          <div><strong>{selected.veryHigh}</strong><span>Very risky</span></div>
          <div><strong>{selected.high}</strong><span>Risky</span></div>
        </div>
        <section className="recorded-barriers" aria-label="Attendance barriers">
        <h4>Attendance barriers</h4>
        <div className="region-barriers">{BARRIER_CATEGORIES.map(barrier => {
          const count = barrierRecords.filter(p => p.verifiedBarrier === barrier).length;
          const isNew = highlight?.regionId === selectedRegion && highlight.barrier === barrier;
          const maxCount = Math.max(1, ...BARRIER_CATEGORIES.map(b => barrierRecords.filter(p => p.verifiedBarrier === b).length));
          return <div key={barrier} className={isNew ? 'barrier-updated' : undefined}><span>{barrier}</span><meter min={0} max={maxCount} value={count} aria-label={barrier + ': ' + count} /><strong>{count}{isNew && <small> +1</small>}</strong></div>;
        })}</div>
        </section>
        <button type="button" className="region-support-button" onClick={() => onJumpToSimulator(selectedRegion)}>Plan regional support <ArrowRight size={20} aria-hidden="true" /></button>
      </div>
      <div className="region-ranking">
        <h3>Regions by urgent cases</h3>
        <p>Counts in the patient queue</p>
        <div className="region-ranking-list">
          {summaries.map((region, index) => {
            const priority = leaders.some(leader => leader.regionId === region.regionId);
            return <button type="button" key={region.regionId} aria-pressed={selectedRegion === region.regionId}
              className={'region-rank-row' + (priority ? ' region-rank-priority' : '')}
              onClick={() => setChosenRegion(region.regionId)}>
              <span className="region-rank-number">{index + 1}</span>
              <i className={'region-category-dot category-' + getRegionCategory(region)} aria-label={getRegionCategory(region) + ' attention'} />
              <span className="region-rank-name">{FOCUS_REGIONS[region.regionId].name}<small>{region.veryHigh} very risky · {region.high} risky</small></span>
              {priority && <AlertCircle size={19} aria-label="Most attention needed" />}
              <span className="region-rank-count">{region.urgent}<small>urgent</small></span>
            </button>;
          })}
        </div>
      </div>
    </div>
  </div>
  </>;
}
