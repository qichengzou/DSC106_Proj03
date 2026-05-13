// One-off: validates that Pacific cells lose chill under SSP5-8.5 and Continental
// cells stay non-negative / near zero, per §2 step 3 of PLAN.md.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHILL_CSV = path.join(ROOT, "data", "chill_days.csv");
const REGIONS_JSON = path.join(ROOT, "data", "fruit_regions.json");

function round3(x) { return Math.round(x * 1000) / 1000; }

const regions = JSON.parse(fs.readFileSync(REGIONS_JSON, "utf8"));

// Build cell key -> {fruit, subregion}[] for cells we care about
const wantedCells = new Map();
for (const fruit of Object.keys(regions)) {
  for (const sub of Object.keys(regions[fruit])) {
    for (const [lat, lon] of regions[fruit][sub]) {
      const key = `${round3(lat)},${round3(lon)}`;
      if (!wantedCells.has(key)) wantedCells.set(key, []);
      wantedCells.get(key).push({ fruit, sub });
    }
  }
}

// Stream CSV
const text = fs.readFileSync(CHILL_CSV, "utf8");
const lines = text.split(/\r?\n/);
const header = lines[0].split(",").map(s => s.trim());
const iLat = header.indexOf("lat");
const iLon = header.indexOf("lon");
const iYr = header.indexOf("year");
const iSc = header.indexOf("scenario");
const iCh = header.indexOf("chill_days");

// cellKey -> { early: sum,count, late: sum,count } for ssp585 only
const stats = new Map();
for (const key of wantedCells.keys()) stats.set(key, { eSum: 0, eN: 0, lSum: 0, lN: 0 });

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const cells = line.split(",");
  if (cells[iSc] !== "ssp585") continue;
  const yr = Number(cells[iYr]);
  if (!Number.isFinite(yr)) continue;
  const inEarly = yr >= 2020 && yr <= 2029;
  const inLate = yr >= 2090 && yr <= 2099;
  if (!inEarly && !inLate) continue;
  const lat = round3(Number(cells[iLat]));
  let lon = Number(cells[iLon]);
  if (lon > 180) lon -= 360;
  lon = round3(lon);
  const key = `${lat},${lon}`;
  if (!stats.has(key)) continue;
  const ch = Number(cells[iCh]);
  if (!Number.isFinite(ch)) continue;
  const s = stats.get(key);
  if (inEarly) { s.eSum += ch; s.eN++; }
  else { s.lSum += ch; s.lN++; }
}

// Report by fruit/subregion
const results = {};
for (const [key, owners] of wantedCells.entries()) {
  const s = stats.get(key);
  if (!s || s.eN === 0 || s.lN === 0) {
    console.warn(`No data for ${key}`);
    continue;
  }
  const early = s.eSum / s.eN;
  const late = s.lSum / s.lN;
  const delta = late - early;
  for (const { fruit, sub } of owners) {
    const k = `${fruit}/${sub}`;
    if (!results[k]) results[k] = [];
    results[k].push({ key, early, late, delta });
  }
}

console.log("\nSSP5-8.5 chill_days delta: 2090s mean - 2020s mean (per cell)\n");
for (const k of Object.keys(results).sort()) {
  console.log(`== ${k} ==`);
  let pos = 0, neg = 0, near = 0;
  for (const r of results[k]) {
    console.log(`  ${r.key.padEnd(22)} early=${r.early.toFixed(1).padStart(6)}  late=${r.late.toFixed(1).padStart(6)}  delta=${(r.delta >= 0 ? "+" : "") + r.delta.toFixed(2)}`);
    if (r.delta > 1) pos++;
    else if (r.delta < -1) neg++;
    else near++;
  }
  console.log(`  >> n=${results[k].length} | negative: ${neg}, near-zero (|d|<=1): ${near}, positive: ${pos}\n`);
}
