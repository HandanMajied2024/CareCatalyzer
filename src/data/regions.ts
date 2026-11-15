import boundaries from './finland-regions-2026.json';
import type { FocusRegionId, FocusRegionMeta } from '../types/careconnect.ts';

// Official maakunta codes, not hospital catchment areas or wellbeing services counties.
export const FOCUS_REGION_ORDER: FocusRegionId[] = ['01', '02', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '21'];
const cities: Record<FocusRegionId, string[]> = {
  '01': ['Helsinki', 'Espoo', 'Porvoo'], '02': ['Turku', 'Salo', 'Loimaa'],
  '04': ['Pori', 'Rauma', 'Kankaanpää'], '05': ['Hämeenlinna', 'Riihimäki', 'Forssa'],
  '06': ['Tampere', 'Nokia', 'Valkeakoski'], '07': ['Lahti', 'Heinola', 'Hollola'],
  '08': ['Kouvola', 'Kotka', 'Hamina'], '09': ['Lappeenranta', 'Imatra', 'Parikkala'],
  '10': ['Mikkeli', 'Savonlinna', 'Pieksämäki'], '11': ['Kuopio', 'Iisalmi', 'Varkaus'],
  '12': ['Joensuu', 'Lieksa', 'Nurmes'], '13': ['Jyväskylä', 'Jämsä', 'Äänekoski'],
  '14': ['Seinäjoki', 'Lapua', 'Kauhajoki'], '15': ['Vaasa', 'Pietarsaari', 'Närpiö'],
  '16': ['Kokkola', 'Kannus', 'Kaustinen'], '17': ['Oulu', 'Raahe', 'Kuusamo'],
  '18': ['Kajaani', 'Kuhmo', 'Suomussalmi'], '19': ['Rovaniemi', 'Inari', 'Kemi'],
  '21': ['Mariehamn', 'Jomala', 'Finström'],
};
export const FOCUS_REGIONS = Object.fromEntries(FOCUS_REGION_ORDER.map((id) => {
  const feature = boundaries.features.find((f) => f.properties.maakunta === id);
  if (!feature) throw new Error(`Missing official region boundary: ${id}`);
  return [id, { id, name: feature.properties.name, shortLabel: feature.properties.name,
    finnishName: feature.properties.nimi, hubCity: cities[id][0],
    hubHospital: `${cities[id][0]} care team`, municipalities: cities[id] }];
})) as Record<FocusRegionId, FocusRegionMeta>;

// Project official EPSG:3067 coordinates at a uniform scale to preserve geography.
type Point = [number, number];
// Interior label anchors computed from the largest land polygon of each official region.
export const REGION_MAP_LABELS: Record<FocusRegionId, { x: number; y: number; lines: string[]; fontSize: number; rotate: number }> = {
  '10': { x: 345.7, y: 592.6, lines: ["South","Savo"], fontSize: 9, rotate: 0 },
  '11': { x: 348, y: 484.9, lines: ["North","Savo"], fontSize: 9, rotate: 0 },
  '12': { x: 436.2, y: 512.5, lines: ["North","Karelia"], fontSize: 9, rotate: 0 },
  '13': { x: 288.7, y: 540, lines: ["Central","Finland"], fontSize: 9, rotate: 0 },
  '14': { x: 224.5, y: 509.9, lines: ["South","Ostrobothnia"], fontSize: 9, rotate: 0 },
  '15': { x: 213.9, y: 460.8, lines: ["Ostrobothnia"], fontSize: 9, rotate: -48 },
  '16': { x: 251.1, y: 468.6, lines: ["Central","Ostrobothnia"], fontSize: 8, rotate: 0 },
  '17': { x: 290.3, y: 416.8, lines: ["North","Ostrobothnia"], fontSize: 9, rotate: 0 },
  '18': { x: 384.5, y: 405.5, lines: ["Kainuu"], fontSize: 9, rotate: 0 },
  '19': { x: 324, y: 203.8, lines: ["Lapland"], fontSize: 9, rotate: 0 },
  '21': { x: 103.2, y: 674.5, lines: ["Åland"], fontSize: 9, rotate: 0 },
  '01': { x: 244.1, y: 683, lines: ["Uusimaa"], fontSize: 9, rotate: 0 },
  '02': { x: 190.9, y: 656.7, lines: ["Southwest","Finland"], fontSize: 9, rotate: 0 },
  '04': { x: 179, y: 584.1, lines: ["Satakunta"], fontSize: 9, rotate: 0 },
  '05': { x: 252.3, y: 642.8, lines: ["Kanta-","Häme"], fontSize: 9, rotate: 0 },
  '06': { x: 231, y: 594.4, lines: ["Pirkanmaa"], fontSize: 9, rotate: 0 },
  '07': { x: 295.9, y: 619.9, lines: ["Päijät-","Häme"], fontSize: 9, rotate: 0 },
  '08': { x: 332.7, y: 656, lines: ["Kymenlaakso"], fontSize: 8.5, rotate: 0 },
  '09': { x: 365.8, y: 635.3, lines: ["South","Karelia"], fontSize: 9, rotate: 0 },
};
function geometryRings(geometry: typeof boundaries.features[number]['geometry']): Point[][] {
  return (geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates) as Point[][];
}
const rings = boundaries.features.flatMap((f) => geometryRings(f.geometry));
const points = rings.flat();
const minX = Math.min(...points.map((p) => p[0]));
const maxX = Math.max(...points.map((p) => p[0]));
const minY = Math.min(...points.map((p) => p[1]));
const maxY = Math.max(...points.map((p) => p[1]));
const scale = Math.min(500 / (maxX - minX), 690 / (maxY - minY));
const offsetX = (560 - (maxX - minX) * scale) / 2;
export const REGION_MAP_PATHS = Object.fromEntries(boundaries.features.map((feature) => [
  feature.properties.maakunta,
  geometryRings(feature.geometry).map((ring) => ring.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(2)},${(25 + (maxY - y) * scale).toFixed(2)}`
  ).join(' ') + 'Z').join(' '),
])) as Record<FocusRegionId, string>;
