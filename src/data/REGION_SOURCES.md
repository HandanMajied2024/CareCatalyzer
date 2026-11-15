# Regional dataset

Regional names, codes and boundaries: Statistics Finland, Regional division 2026.
https://stat.fi/en/luokitukset/maakunta/maakunta_1_20260101

Boundary asset: tilastointialueet:maakunta4500k_2026 from
https://geo.stat.fi/geoserver/tilastointialueet/wfs
Downloaded as GeoJSON in EPSG:3067, 15 November 2026.
Licensed CC BY 4.0. SVG paths apply a uniform affine transform; the source geometry is retained.
These are the 19 maakunta regions, including Åland, not wellbeing services counties or hospital catchment areas.

Patient records, phone numbers, distances and appointments are synthetic fixtures.
The initial fixture intentionally produces 2 red (Lapland, Uusimaa), 4 orange
(North Ostrobothnia, North Savo, Pirkanmaa, Southwest Finland), 1 yellow (Kainuu)
and 12 green regions. Patient profiles and call outcomes generate these counts
through the risk engine; map colours are not forced.
Their distribution is not evidence of regional cancer prevalence. Phone numbers must not be externally dialled.
Urgent counts reflect the existing outreach tier, not cancer incidence or a validated clinical triage category.
Map colours use inclusive user-defined outreach thresholds (highest matching colour wins):
yellow ≥7 urgent OR ≥1 Very High Risk OR ≥20 High Risk;
orange ≥15 urgent OR ≥30 Very High Risk OR ≥40 High Risk;
red ≥30 urgent OR ≥50 Very High Risk; otherwise green.
These are operational count thresholds, not clinical or public-health standards.
All regions tied for the highest positive urgent count are marked in the regional ranking. Zero urgent cases produces no priority region.
The support planner matches individual patient needs without double-counting. Cost allowances are explicit planning assumptions, not provider quotations or clinically validated outcome predictions.
