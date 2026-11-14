export interface PolicyInputs { region: number; patients: number; budget: number; months: number; hospital: number; cars: number; mobile: number; winter: boolean }
export const regions = [
  { name: 'Lapland', subtitle: 'Northern Finland', patients: 1240, distance: 186, baseline: 64, capacity: 920 },
  { name: 'North Savo', subtitle: 'Eastern Finland', patients: 1680, distance: 92, baseline: 73, capacity: 1420 },
  { name: 'Uusimaa', subtitle: 'Southern Finland', patients: 3280, distance: 38, baseline: 82, capacity: 3100 },
];
export const initialPolicy: PolicyInputs = { region: 0, patients: 1240, budget: 180000, months: 6, hospital: 12, cars: 8, mobile: 2, winter: false };
export function simulatePolicy(p: PolicyInputs) {
  const r = regions[p.region];
  const cost = p.hospital * 4200 + p.cars * 2800 + p.mobile * 32000;
  const funding = cost ? Math.min(1, p.budget / cost) : 1;
  const ramp = Math.min(1, p.months / 3);
  const delivered = funding * ramp;
  const baselineAccess = Math.max(20, Math.min(95, r.baseline - (p.winter ? 9 : 0)));
  const baselineTreated = Math.min(p.patients * baselineAccess / 100, r.capacity);
  const additionalSlots = (p.hospital * 14 + p.mobile * 70) * delivered;
  const reachable = Math.min(p.patients, p.patients * baselineAccess / 100 + (p.cars * (p.winter ? 17 : 24) + p.mobile * 45) * delivered);
  const treated = Math.round(Math.min(reachable, r.capacity + additionalSlots));
  const access = Math.round(treated / p.patients * 100);
  const additional = Math.max(0, treated - Math.round(baselineTreated));
  const distance = Math.round(r.distance * (1 - Math.min(.65, p.mobile * .105 * delivered)));
  const wait = Math.max(7, Math.round(34 + Math.max(0, p.patients - r.capacity) / 60 - (p.hospital * .6 + p.mobile * 2.4) * delivered + (p.winter ? 4 : 0)));
  return { cost, funding, treated, access, additional, distance, wait, baselineAccess, baselineTreated: Math.round(baselineTreated), baselineWait: Math.round(34 + Math.max(0, p.patients-r.capacity)/60 + (p.winter ? 4 : 0)), totalCost: Math.min(cost,p.budget)*p.months };
}
