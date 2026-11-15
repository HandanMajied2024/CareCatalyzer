import React, { useMemo, useState } from 'react';
import {
  Accessibility,
  AlertTriangle,
  CalendarClock,
  Car,
  CircleHelp,
  CloudSnow,
  Clock,
  FlaskConical,
  Info,
  Languages,
  Layers,
  Lock,
  PhoneMissed,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  FINLAND_LAKES_XZ,
  FINLAND_OUTLINE_XZ,
  FOCUS_REGIONS,
  FOCUS_REGION_ORDER,
} from '../data/patients.ts';
import type {
  BarrierCategory,
  FocusRegionId,
  PathwayStage,
  PatientRecord,
} from '../types/careconnect.ts';
import { BARRIER_CATEGORIES } from '../utils/riskEngine.ts';

interface Tab2RegionalBarrierMapProps {
  patients: PatientRecord[];
  activeCallRegionId: FocusRegionId | null;
  onJumpToSimulator: (regionId: FocusRegionId) => void;
}

function toSvgPoint(xz: [number, number]): [number, number] {
  const sx = 204 + xz[0] * 40;
  const sy = 302 + xz[1] * 28.5;
  return [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10];
}

function polygonPointsAttr(pts: Array<[number, number]>): string {
  return pts.map((p) => toSvgPoint(p).join(',')).join(' ');
}

// Neutral background polygons for Western/Mid Finland outside the 3 focus areas
const NEUTRAL_WEST_MID_XZ: Array<[number, number]> = [
  [-2.8, -0.2],
  [-2.1, 0.2],
  [0.1, -0.3],
  [0.35, 1.9],
  [0.7, 4.3],
  [-0.2, 5.0],
  [-1.4, 5.0],
  [-1.2, 7.05],
  [-2.6, 6.9],
  [-3.4, 6.4],
  [-3.6, 5.3],
  [-3.3, 3.6],
  [-3.5, 1.9],
  [-3.2, 0.4],
];

const K_ANONYMITY_THRESHOLD = 5;

// Design-system tokens (primary accents only)
const CC = {
  red: '#e5262b',
  blue: '#1f5eff',
  green: '#14a44d',
  yellow: '#ffc400',
  grey: '#d4d4d4',
  ink: '#0a0a0a',
  muted: '#6b6b6b',
  line: '#e6e6e6',
  surface: '#f5f5f5',
  blueSoft: '#e8efff',
};

function getRateColor(ratePer100: number): string {
  if (ratePer100 >= 38) return CC.red; // High barrier density
  if (ratePer100 >= 20) return CC.yellow; // Moderate barrier density
  return CC.green; // Low barrier density
}

const BARRIER_ICONS: Record<BarrierCategory, LucideIcon> = {
  Transport: Car,
  Weather: CloudSnow,
  Scheduling: CalendarClock,
  Accessibility: Accessibility,
  Language: Languages,
  Other: CircleHelp,
};

const shortName = (label: string) => label.split(' / ')[0];

const selectClass =
  'min-h-11 bg-white border border-cc-line rounded-full pl-4 pr-8 py-2 text-base text-black focus:outline-none focus:border-cc-blue cursor-pointer';

export const Tab2RegionalBarrierMap: React.FC<Tab2RegionalBarrierMapProps> = ({
  patients,
  activeCallRegionId,
  onJumpToSimulator,
}) => {
  const [selectedRegion, setSelectedRegion] = useState<FocusRegionId | 'ALL'>('ALL');
  const [stageFilter, setStageFilter] = useState<PathwayStage | 'ALL'>('ALL');
  const [barrierFilter, setBarrierFilter] = useState<BarrierCategory | 'ALL'>('ALL');

  const regionalAggregates = useMemo(() => {
    return FOCUS_REGION_ORDER.map((regionId) => {
      const meta = FOCUS_REGIONS[regionId];
      const stageScoped = patients
        .filter((p) => p.regionId === regionId)
        .filter((p) => (stageFilter === 'ALL' ? true : p.pathwayStage === stageFilter));

      // Contacted cohort = all patients where an outbound call was attempted (excluding Pending Call)
      const contacted = stageScoped.filter((p) => p.callStatus !== 'Pending Call');
      const contactedN = contacted.length;
      const unansweredCount = contacted.filter((p) => p.callStatus === 'No Pick-Up').length;
      const unansweredRatePct =
        contactedN > 0 ? Math.round((unansweredCount / contactedN) * 100) : 0;

      const barrierMatches = contacted.filter((p) =>
        barrierFilter === 'ALL'
          ? Boolean(p.verifiedBarrier)
          : p.verifiedBarrier === barrierFilter
      );
      const barrierMatchCount = barrierMatches.length;

      // k-anonymity small-group suppression: suppress if contacted sample < 5 OR specific barrier subgroup < 5
      const suppressed =
        contactedN < K_ANONYMITY_THRESHOLD ||
        (barrierFilter !== 'ALL' && barrierMatchCount > 0 && barrierMatchCount < K_ANONYMITY_THRESHOLD);

      const barrierRatePer100 =
        contactedN > 0 ? Number(((barrierMatchCount / contactedN) * 100).toFixed(1)) : 0;

      const goal3BreachRiskCount = contacted.filter((p) => p.goal3AtRisk).length;
      const goal3DelayRiskPct =
        contactedN > 0 ? Math.round((goal3BreachRiskCount / contactedN) * 100) : 0;

      // Per-category breakdown with k-anonymity enforcement
      const categoryBreakdown = BARRIER_CATEGORIES.map((cat) => {
        const count = contacted.filter((p) => p.verifiedBarrier === cat).length;
        const catSuppressed = count > 0 && count < K_ANONYMITY_THRESHOLD;
        const ratePer100 =
          contactedN > 0 ? Number(((count / contactedN) * 100).toFixed(1)) : 0;
        return {
          category: cat,
          count,
          ratePer100,
          suppressed: catSuppressed,
        };
      });

      return {
        regionId,
        meta,
        totalCohort: stageScoped.length,
        contactedN,
        unansweredRatePct,
        barrierMatchCount,
        barrierRatePer100,
        goal3DelayRiskPct,
        suppressed,
        categoryBreakdown,
      };
    });
  }, [patients, stageFilter, barrierFilter]);

  const finlandOutlinePoints = useMemo(() => polygonPointsAttr(FINLAND_OUTLINE_XZ), []);

  const visibleRegions =
    selectedRegion === 'ALL'
      ? regionalAggregates
      : regionalAggregates.filter((r) => r.regionId === selectedRegion);

  return (
    <div className="space-y-8">
      {/* Filters + privacy guardrail */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-cc-green-soft text-black text-base font-medium"
          title="Aggregate only. Groups with n < 5 are hidden."
        >
          <ShieldCheck className="w-5 h-5 text-cc-green shrink-0" aria-hidden />
          n&nbsp;&lt;&nbsp;5 hidden
        </span>

        <div className="flex flex-wrap items-center gap-3 sm:ml-auto w-full sm:w-auto">
          <label className="relative inline-flex items-center flex-1 sm:flex-none min-w-0">
            <Layers className="w-5 h-5 absolute left-4 pointer-events-none text-cc-muted" aria-hidden />
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as PathwayStage | 'ALL')}
              aria-label="Filter map by pathway stage"
              className={`${selectClass} pl-11 w-full`}
            >
              <option value="ALL">All stages</option>
              <option value="Referral">Referral</option>
              <option value="Diagnostic Workup">Diagnostic Workup</option>
              <option value="Treatment Initiation">Treatment Initiation</option>
            </select>
          </label>

          <label className="relative inline-flex items-center flex-1 sm:flex-none min-w-0">
            <AlertTriangle className="w-5 h-5 absolute left-4 pointer-events-none text-cc-red" aria-hidden />
            <select
              value={barrierFilter}
              onChange={(e) => setBarrierFilter(e.target.value as BarrierCategory | 'ALL')}
              aria-label="Filter map by barrier type"
              className={`${selectClass} pl-11 w-full`}
            >
              <option value="ALL">All barriers</option>
              {BARRIER_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          {selectedRegion !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedRegion('ALL')}
              className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-cc-surface hover:bg-cc-line text-base text-black cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden />
              All regions
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[46fr_54fr] gap-8 items-start">
        {/* Map */}
        <section className="bg-white border border-cc-line rounded-[20px] overflow-hidden flex flex-col">
          <div className="relative bg-white p-4 sm:p-6 flex flex-col items-center justify-center">
            <svg
              viewBox="0 0 430 530"
              className="w-full max-w-[520px] h-auto select-none"
              role="img"
              aria-label="Finland barrier rate map across 3 focus regions"
            >
              <defs>
                <clipPath id="tab2FinlandClip">
                  <polygon points={finlandOutlinePoints} />
                </clipPath>
              </defs>

              <rect x="0" y="0" width="430" height="530" rx="16" fill={CC.blueSoft} />

              {/* Neighboring landmasses */}
              <polygon
                points="0,0 135,0 112,72 128,150 100,260 64,340 42,460 0,530"
                fill={CC.surface}
              />
              <polygon
                points="250,0 430,0 430,530 245,530 340,455 384,365 362,275 352,185 302,65"
                fill={CC.surface}
              />

              {/* Neutral non-focus regions */}
              <polygon
                points={polygonPointsAttr(NEUTRAL_WEST_MID_XZ)}
                fill="#ffffff"
                stroke={CC.grey}
                strokeWidth="1"
              />

              {/* 3 focus regions, filled by barrier rate */}
              {regionalAggregates.map((agg) => {
                const isSelected = selectedRegion === agg.regionId;
                const isDimmed = selectedRegion !== 'ALL' && !isSelected;
                const intensityColor = agg.suppressed
                  ? CC.grey
                  : getRateColor(agg.barrierRatePer100);

                return (
                  <g
                    key={agg.regionId}
                    onClick={() =>
                      setSelectedRegion(isSelected ? 'ALL' : agg.regionId)
                    }
                    className="cursor-pointer transition-opacity duration-200"
                    style={{ opacity: isDimmed ? 0.4 : 1 }}
                  >
                    <polygon
                      points={polygonPointsAttr(agg.meta.polygonXZ)}
                      fill="#ffffff"
                      stroke={isSelected ? CC.ink : '#ffffff'}
                      strokeWidth={isSelected ? 3 : 1.6}
                      strokeLinejoin="round"
                    />
                    <polygon
                      points={polygonPointsAttr(agg.meta.polygonXZ)}
                      fill={intensityColor}
                      opacity={agg.suppressed ? 0.5 : 0.55}
                    />
                  </g>
                );
              })}

              {/* Inland lakes */}
              <g clipPath="url(#tab2FinlandClip)" className="pointer-events-none" opacity="0.7">
                {FINLAND_LAKES_XZ.map((lakePts, idx) => (
                  <polygon
                    key={`lake2-${idx}`}
                    points={polygonPointsAttr(lakePts)}
                    fill={CC.blueSoft}
                  />
                ))}
              </g>

              {/* Outer border */}
              <polygon
                points={finlandOutlinePoints}
                fill="none"
                stroke={CC.ink}
                strokeWidth="1.2"
                className="pointer-events-none"
              />

              {/* Hubs + aggregate labels (no individual patient nodes) */}
              {regionalAggregates.map((agg) => {
                const [hx, hy] = toSvgPoint(agg.meta.hubXZ);
                const [lx, ly] = toSvgPoint(agg.meta.labelAnchorXZ);
                const isCallActiveHere = activeCallRegionId === agg.regionId;
                const rateCol = agg.suppressed ? CC.muted : getRateColor(agg.barrierRatePer100);
                const isSelected = selectedRegion === agg.regionId;

                return (
                  <g
                    key={`hub2-${agg.regionId}`}
                    onClick={() =>
                      setSelectedRegion(isSelected ? 'ALL' : agg.regionId)
                    }
                    className="cursor-pointer"
                  >
                    {isCallActiveHere && (
                      <g transform={`translate(${hx}, ${hy})`} className="pointer-events-none">
                        <circle r="8" fill="none" stroke={CC.blue} strokeWidth="2.5">
                          <animate attributeName="r" from="6" to="30" dur="1.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" from="0.95" to="0" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                      </g>
                    )}

                    {/* Hub beacon */}
                    <g transform={`translate(${hx}, ${hy})`}>
                      <circle r="8" fill={CC.ink} stroke="#ffffff" strokeWidth="2" />
                      <path
                        d="M -3.5 0 H 3.5 M 0 -3.5 V 3.5"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </g>

                    {/* Label card */}
                    <g transform={`translate(${lx - 62}, ${ly - 26})`}>
                      <rect
                        x="0"
                        y="0"
                        width="124"
                        height="52"
                        rx="12"
                        fill="#ffffff"
                        stroke={isSelected ? CC.ink : CC.line}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      <circle cx="14" cy="17" r="5" fill={rateCol} />
                      <text
                        x="25"
                        y="21.5"
                        fill={CC.ink}
                        fontSize="14"
                        fontWeight="600"
                        fontFamily="Inter, sans-serif"
                      >
                        {shortName(agg.meta.shortLabel)}
                      </text>
                      <text
                        x="10"
                        y="43"
                        fill={CC.ink}
                        fontSize="19"
                        fontWeight="800"
                        fontFamily="Inter, sans-serif"
                      >
                        {agg.suppressed ? 'n < 5' : agg.barrierRatePer100}
                        {!agg.suppressed && (
                          <tspan fontSize="12" fontWeight="500" fill={CC.muted}>
                            {' '}/100
                          </tspan>
                        )}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-black">
              {[
                { c: CC.red, l: '≥ 38' },
                { c: CC.yellow, l: '20–37' },
                { c: CC.green, l: '< 20' },
                { c: CC.grey, l: 'n < 5' },
              ].map((x) => (
                <span key={x.l} className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: x.c }} />
                  {x.l}
                </span>
              ))}
              <span className="text-cc-muted">/100 contacted</span>
            </div>
          </div>
        </section>

        {/* Region cards */}
        <div className="space-y-8 min-w-0">
          {visibleRegions.map((agg) => {
            const rateCol = agg.suppressed ? CC.muted : getRateColor(agg.barrierRatePer100);
            const kpis: Array<{ icon: LucideIcon; value: React.ReactNode; label: string; color: string }> = [
              {
                icon: AlertTriangle,
                value: agg.suppressed ? <Lock className="w-8 h-8" aria-label="Suppressed (n < 5)" /> : agg.barrierRatePer100,
                label: 'Barriers /100',
                color: rateCol,
              },
              {
                icon: Users,
                value: (
                  <>
                    {agg.contactedN}
                    <span className="text-lg font-medium text-cc-muted">/{agg.totalCohort}</span>
                  </>
                ),
                label: 'Contacted',
                color: CC.blue,
              },
              {
                icon: PhoneMissed,
                value: `${agg.unansweredRatePct}%`,
                label: 'No answer',
                color: CC.red,
              },
              {
                icon: Clock,
                value: `${agg.goal3DelayRiskPct}%`,
                label: 'Timing alerts',
                color: CC.yellow,
              },
            ];

            return (
              <section
                key={agg.regionId}
                className="relative bg-white border border-cc-line rounded-[20px] p-5 sm:p-8 space-y-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: rateCol }} />
                    <h3 className="text-xl sm:text-2xl font-bold tracking-[-0.02em] leading-tight text-black">
                      {agg.meta.name}
                    </h3>
                    <details>
                      <summary
                        className="list-none [&::-webkit-details-marker]:hidden inline-flex items-center justify-center w-11 h-11 rounded-full hover:bg-cc-surface cursor-pointer text-cc-muted"
                        aria-label="Region details"
                        title="Region details"
                      >
                        <Info className="w-5 h-5" />
                      </summary>
                      <div className="absolute z-10 left-5 right-5 sm:left-auto sm:right-8 sm:w-[340px] mt-2 bg-white border border-cc-line rounded-[12px] p-4 shadow-lg text-base text-black leading-normal">
                        <p className="font-semibold">{agg.meta.profileTag}</p>
                        <p className="mt-2 text-cc-muted">{agg.meta.equityChallenge}</p>
                      </div>
                    </details>
                  </div>

                  <button
                    type="button"
                    onClick={() => onJumpToSimulator(agg.regionId)}
                    className="inline-flex items-center gap-2 min-h-11 px-5 rounded-full bg-cc-blue hover:bg-black text-white text-base font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <FlaskConical className="w-5 h-5" aria-hidden />
                    Simulate
                  </button>
                </div>

                {/* KPI tiles */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                  {kpis.map((k) => (
                    <div key={k.label} className="bg-cc-surface rounded-[16px] p-4 min-w-0">
                      <k.icon className="w-6 h-6" style={{ color: k.color }} aria-hidden />
                      <div className="mt-2 text-[32px] sm:text-4xl font-extrabold tabular-nums leading-none text-black">
                        {k.value}
                      </div>
                      <div className="mt-2 text-sm text-cc-muted">{k.label}</div>
                    </div>
                  ))}
                </div>

                {/* Barrier tiles with bars */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  {agg.categoryBreakdown.map((item) => {
                    const Icon = BARRIER_ICONS[item.category];
                    const widthPct = item.suppressed || item.count === 0
                      ? 0
                      : Math.max(4, Math.min(100, item.ratePer100 * 2));
                    const inside = widthPct >= 28;
                    return (
                      <div key={item.category} className="flex items-center gap-3 min-w-0">
                        <span
                          className="w-11 h-11 rounded-full bg-cc-red-soft text-cc-red grid place-items-center shrink-0"
                          title={item.category}
                        >
                          <Icon className="w-5 h-5" aria-hidden />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-black mb-1">{item.category}</div>
                          <div className="h-8 w-full bg-cc-surface rounded-full overflow-hidden flex items-center">
                            {item.suppressed ? (
                              <span className="inline-flex items-center gap-1.5 px-3 text-sm text-cc-muted">
                                <Lock className="w-4 h-4" aria-hidden />
                                n &lt; 5
                              </span>
                            ) : (
                              <>
                                {widthPct > 0 && (
                                  <div
                                    className="h-full rounded-full bg-cc-red flex items-center justify-end pr-3 transition-all duration-300"
                                    style={{ width: `${widthPct}%` }}
                                  >
                                    {inside && (
                                      <span className="text-sm font-bold text-white tabular-nums">
                                        {item.ratePer100}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {!inside && (
                                  <span className="px-3 text-sm font-bold text-black tabular-nums">
                                    {item.count === 0 ? '0' : item.ratePer100}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
