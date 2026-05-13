// Builds data/fruit_regions.json from data/top_counties.csv and data/chill_days.csv.
//
// For each top-producing county, snaps its centroid (lat, lon) to the nearest
// cell center in the current climate grid. Output is keyed by fruit -> subregion
// -> deduplicated list of [lat, lon] cell centers, and is grid-resolution agnostic.
//
// Run: node scripts/build_fruit_regions.js (from the project root).
// Re-run any time data/top_counties.csv changes or the chill_days.csv grid changes.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const COUNTIES_CSV = path.join(ROOT, "data", "top_counties.csv");
const CHILL_CSV = path.join(ROOT, "data", "chill_days.csv");
const OUTPUT_JSON = path.join(ROOT, "data", "fruit_regions.json");

function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",").map(s => s.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(s => s.trim());
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ""; });
    return row;
  });
}

function readUniqueGridAxes(chillCsvPath) {
  const text = fs.readFileSync(chillCsvPath, "utf8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",").map(s => s.trim());
  const latIdx = header.indexOf("lat");
  const lonIdx = header.indexOf("lon");
  if (latIdx < 0 || lonIdx < 0) {
    throw new Error("chill_days.csv missing lat/lon columns");
  }
  const lats = new Set();
  const lons = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(",");
    const lat = Number(cells[latIdx]);
    let lon = Number(cells[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon > 180) lon -= 360;
    lats.add(lat);
    lons.add(lon);
  }
  return {
    lats: Array.from(lats).sort((a, b) => a - b),
    lons: Array.from(lons).sort((a, b) => a - b)
  };
}

function nearestValue(sorted, target) {
  let best = sorted[0];
  let bestDist = Math.abs(sorted[0] - target);
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.abs(sorted[i] - target);
    if (d < bestDist) { bestDist = d; best = sorted[i]; }
  }
  return best;
}

function snapToGrid(lat, lon, axes) {
  return [nearestValue(axes.lats, lat), nearestValue(axes.lons, lon)];
}

function round3(x) { return Math.round(x * 1000) / 1000; }

function inferStep(sortedAxis) {
  if (sortedAxis.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < sortedAxis.length; i++) diffs.push(sortedAxis[i] - sortedAxis[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function main() {
  if (!fs.existsSync(COUNTIES_CSV)) throw new Error("Missing " + COUNTIES_CSV);
  if (!fs.existsSync(CHILL_CSV)) throw new Error("Missing " + CHILL_CSV);

  const counties = parseCSV(fs.readFileSync(COUNTIES_CSV, "utf8"));
  const axes = readUniqueGridAxes(CHILL_CSV);

  const latStep = inferStep(axes.lats);
  const lonStep = inferStep(axes.lons);
  console.log(`Grid: ${axes.lats.length} lats x ${axes.lons.length} lons ` +
              `(lat step ~${latStep && latStep.toFixed(3)}, lon step ~${lonStep && lonStep.toFixed(3)})`);
  console.log(`Counties: ${counties.length}`);

  // fruit -> subregion -> Map<"lat,lon", [lat, lon]>
  const byFruit = {};
  let skipped = 0;

  for (const row of counties) {
    const fruit = row.fruit;
    const subregion = row.subregion || "All";
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!fruit || !Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; continue; }

    const [sLat, sLon] = snapToGrid(lat, lon, axes);
    const cellLat = round3(sLat);
    const cellLon = round3(sLon);
    const key = `${cellLat},${cellLon}`;

    if (!byFruit[fruit]) byFruit[fruit] = {};
    if (!byFruit[fruit][subregion]) byFruit[fruit][subregion] = new Map();
    if (!byFruit[fruit][subregion].has(key)) {
      byFruit[fruit][subregion].set(key, [cellLat, cellLon]);
    }
  }

  if (skipped > 0) console.warn(`Skipped ${skipped} malformed county rows`);

  // Stable ordering
  const output = {};
  for (const fruit of Object.keys(byFruit).sort()) {
    output[fruit] = {};
    for (const sub of Object.keys(byFruit[fruit]).sort()) {
      const cells = Array.from(byFruit[fruit][sub].values())
        .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      output[fruit][sub] = cells;
    }
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log("\nProduction cells per fruit/subregion:");
  for (const fruit of Object.keys(output)) {
    for (const sub of Object.keys(output[fruit])) {
      console.log(`  ${fruit} / ${sub.padEnd(11)} : ${output[fruit][sub].length} cells`);
    }
  }
  console.log(`\nWrote ${path.relative(ROOT, OUTPUT_JSON)}`);
}

main();