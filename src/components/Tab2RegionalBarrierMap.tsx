import React, { useMemo, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
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

function getRateColor(ratePer100: number): string {
  if (ratePer100 >= 38) return '#EF4444'; // High barrier density (Red)
  if (ratePer100 >= 20) return '#3B82F6'; // Moderate barrier density (Blue)
  return '#10B981'; // Low barrier density (Green)
}

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
    <div className="space-y-4">
      {/* Privacy & Filter Header */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <div className="text-xs">
            <span className="font-semibold text-slate-900">
              Aggregate-Only Regional View · Privacy Guardrail Active
            </span>
            <span className="text-slate-600 ml-2">
              This summary omits patient names and transcripts; subgroups with n &lt; 5 are
              suppressed.
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as PathwayStage | 'ALL')}
            aria-label="Filter map by pathway stage"
            className="bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
          >
            <option value="ALL">Care Stage: All Stages</option>
            <option value="Referral">Referral</option>
            <option value="Diagnostic Workup">Diagnostic Workup</option>
            <option value="Treatment Initiation">Treatment Initiation</option>
          </select>

          <select
            value={barrierFilter}
            onChange={(e) => setBarrierFilter(e.target.value as BarrierCategory | 'ALL')}
            aria-label="Filter map by barrier type"
            className="bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
          >
            <option value="ALL">Barrier Type: All Combined</option>
            {BARRIER_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {selectedRegion !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedRegion('ALL')}
              className="px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs text-slate-800 border border-slate-300 cursor-pointer"
            >
              Show All 3 Regions
            </button>
          )}
        </div>
      </div>

      {/* Main Split: 2D Interactive SVG Map (Left) + Rate Cards & Suppressed Breakdown (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[46fr_54fr] gap-4 items-stretch">
        {/* Realistic Daylight Nordic 2D Vector Map of Finland */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col shadow-2xs">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Finland Barrier Rate Map (per 100 Contacted)
              </h2>
              <p className="text-[11px] text-slate-500">
                Red = High barrier density (≥38/100) · Blue = Moderate (20–37/100) · Green = Low (&lt;20)
              </p>
            </div>
          </div>

          <div className="relative flex-1 bg-sky-100/70 p-2 flex flex-col items-center justify-center min-h-[470px]">
            <svg
              viewBox="0 0 430 530"
              className="w-full max-h-[500px] h-auto select-none"
              role="img"
              aria-label="2D Finland Regional Barrier Rate Map across 3 Focus Regions"
            >
              <defs>
                <radialGradient id="tab2SeaGrad" cx="35%" cy="55%" r="75%">
                  <stop offset="0%" stopColor="#dbeafe" />
                  <stop offset="65%" stopColor="#bfdbfe" />
                  <stop offset="100%" stopColor="#93c5fd" />
                </radialGradient>
                <clipPath id="tab2FinlandClip">
                  <polygon points={finlandOutlinePoints} />
                </clipPath>
              </defs>

              <rect x="0" y="0" width="430" height="530" fill="url(#tab2SeaGrad)" />

              {/* Neighboring landmasses in soft cartographic slate */}
              <polygon
                points="0,0 135,0 112,72 128,150 100,260 64,340 42,460 0,530"
                fill="#e2e8f0"
                opacity="0.85"
              />
              <polygon
                points="250,0 430,0 430,530 245,530 340,455 384,365 362,275 352,185 302,65"
                fill="#e2e8f0"
                opacity="0.85"
              />

              {/* Sea Labels */}
              <text
                x="44"
                y="335"
                fill="#1e40af"
                fontSize="9.5"
                fontStyle="italic"
                fontFamily="DM Sans, sans-serif"
                transform="rotate(-74 44 335)"
                opacity="0.6"
              >
                Gulf of Bothnia
              </text>
              <text
                x="175"
                y="518"
                fill="#1e40af"
                fontSize="9.5"
                fontStyle="italic"
                fontFamily="DM Sans, sans-serif"
                opacity="0.6"
              >
                Gulf of Finland
              </text>

              {/* Neutral Non-Focus Regions (West/Mid Finland) */}
              <polygon
                points={polygonPointsAttr(NEUTRAL_WEST_MID_XZ)}
                fill="#dce8df"
                stroke="#94a3b8"
                strokeWidth="1"
              />

              {/* 3 Focus Regions */}
              {regionalAggregates.map((agg) => {
                const isSelected = selectedRegion === agg.regionId;
                const isDimmed = selectedRegion !== 'ALL' && !isSelected;
                const intensityColor = agg.suppressed
                  ? '#64748b'
                  : getRateColor(agg.barrierRatePer100);
                const naturalTerrain =
                  agg.regionId === 'OYS_LAPLAND'
                    ? '#e2ebe3'
                    : agg.regionId === 'KYS_SAVO'
                      ? '#d3e4d7'
                      : '#cbe0d4';

                return (
                  <g
                    key={agg.regionId}
                    onClick={() =>
                      setSelectedRegion(isSelected ? 'ALL' : agg.regionId)
                    }
                    className="cursor-pointer transition-opacity duration-200"
                    style={{ opacity: isDimmed ? 0.5 : 1 }}
                  >
                    <polygon
                      points={polygonPointsAttr(agg.meta.polygonXZ)}
                      fill={naturalTerrain}
                      stroke={isSelected ? '#0f172a' : intensityColor}
                      strokeWidth={isSelected ? 2.4 : 1.6}
                      strokeLinejoin="round"
                    />
                    {/* Subtle barrier density wash */}
                    <polygon
                      points={polygonPointsAttr(agg.meta.polygonXZ)}
                      fill={intensityColor}
                      opacity={agg.suppressed ? 0.08 : 0.2}
                    />
                  </g>
                );
              })}

              {/* Finnish Inland Lakes */}
              <g clipPath="url(#tab2FinlandClip)" className="pointer-events-none">
                {FINLAND_LAKES_XZ.map((lakePts, idx) => (
                  <polygon
                    key={`lake2-${idx}`}
                    points={polygonPointsAttr(lakePts)}
                    fill="#93c5fd"
                    stroke="#60a5fa"
                    strokeWidth="0.9"
                  />
                ))}
              </g>

              {/* Outer Finland Border */}
              <polygon
                points={finlandOutlinePoints}
                fill="none"
                stroke="#475569"
                strokeWidth="1.2"
                className="pointer-events-none"
              />

              {/* Regional Hospital Hubs + Aggregate Rate Cards (ZERO individual patient nodes) */}
              {regionalAggregates.map((agg) => {
                const [hx, hy] = toSvgPoint(agg.meta.hubXZ);
                const [lx, ly] = toSvgPoint(agg.meta.labelAnchorXZ);
                const isCallActiveHere = activeCallRegionId === agg.regionId;
                const rateCol = agg.suppressed ? '#64748b' : getRateColor(agg.barrierRatePer100);
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
                        <circle r="8" fill="none" stroke="#0284c7" strokeWidth="2">
                          <animate attributeName="r" from="6" to="30" dur="1.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" from="0.95" to="0" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                      </g>
                    )}

                    {/* Hub beacon */}
                    <g transform={`translate(${hx}, ${hy})`}>
                      <rect
                        x="-6"
                        y="-6"
                        width="12"
                        height="12"
                        rx="2"
                        transform="rotate(45)"
                        fill="#0369a1"
                        stroke="#ffffff"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M -2.5 0 H 2.5 M 0 -2.5 V 2.5"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </g>

                    {/* Crisp White Aggregate Rate Card on Map */}
                    <g transform={`translate(${lx - 60}, ${ly - 22})`}>
                      <rect
                        x="0"
                        y="0"
                        width="120"
                        height="44"
                        rx="5"
                        fill="#ffffff"
                        fillOpacity="0.96"
                        stroke={isSelected ? '#0f172a' : rateCol}
                        strokeWidth={isSelected ? 1.8 : 1.3}
                      />
                      <text
                        x="7"
                        y="14"
                        fill="#0f172a"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="Plus Jakarta Sans, sans-serif"
                      >
                        {agg.meta.shortLabel}
                      </text>
                      <text
                        x="7"
                        y="27"
                        fill={rateCol}
                        fontSize="10"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {agg.suppressed
                          ? 'Suppressed (n < 5)'
                          : `${agg.barrierRatePer100} / 100 contacted`}
                      </text>
                      <text
                        x="7"
                        y="38.5"
                        fill="#475569"
                        fontSize="8"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {`n=${agg.contactedN} · Unans ${agg.unansweredRatePct}% · Delay ${agg.goal3DelayRiskPct}%`}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Right: Regional Rate Cards & Privacy-Protected Category Breakdown */}
        <div className="space-y-4">
          {visibleRegions.map((agg) => {
            const rateCol = agg.suppressed ? '#64748b' : getRateColor(agg.barrierRatePer100);
            return (
              <section
                key={agg.regionId}
                className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{agg.meta.name}</h3>
                      <span className="text-[11px] text-slate-500">· {agg.meta.profileTag}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{agg.meta.equityChallenge}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onJumpToSimulator(agg.regionId)}
                    className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Simulate Intervention &rarr;
                  </button>
                </div>

                {/* Rates, Not Just Counts Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
                    <div className="text-[10px] text-slate-500">Barrier Rate / 100</div>
                    {agg.suppressed ? (
                      <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-800">
                        <Lock className="w-3 h-3 shrink-0" />
                        Suppressed (&lt;5)
                      </div>
                    ) : (
                      <div
                        className="mt-0.5 text-lg font-bold font-mono tabular-nums"
                        style={{ color: rateCol }}
                      >
                        {agg.barrierRatePer100}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
                    <div className="text-[10px] text-slate-500">Contacted Sample (n)</div>
                    <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-900">
                      n={agg.contactedN}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        /{agg.totalCohort}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
                    <div className="text-[10px] text-slate-500">Unanswered Call Rate</div>
                    <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-900">
                      {agg.unansweredRatePct}%
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2">
                    <div className="text-[10px] text-slate-500">Demo timing alerts</div>
                    <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-orange-700">
                      {agg.goal3DelayRiskPct}%
                    </div>
                  </div>
                </div>

                {/* 6-Category Barrier Rates with k-anonymity small-group suppression */}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-700">
                    Barrier Breakdown per 100 Contacted (k-anonymity n &lt; 5 enforced)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {agg.categoryBreakdown.map((item) => (
                      <div key={item.category} className="text-[11px]">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-slate-700">{item.category}</span>
                          {item.suppressed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 italic">
                              <Lock className="w-2.5 h-2.5" />
                              Suppressed (&lt;5 patients) to protect privacy
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums text-slate-800">
                              {item.count === 0 ? '0.0' : `${item.ratePer100}`} / 100 (n={item.count})
                            </span>
                          )}
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded overflow-hidden border border-slate-200">
                          {!item.suppressed && item.count > 0 && (
                            <div
                              className="h-full rounded transition-all duration-300"
                              style={{
                                width: `${Math.min(100, item.ratePer100 * 2)}%`,
                                backgroundColor: getRateColor(item.ratePer100 * 1.4),
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
