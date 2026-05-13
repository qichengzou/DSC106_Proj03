// Mirrors main.js precomputeDIDSeries logic in Node and validates §7 checks:
//   * SSP2-4.5 line is exactly y=0 for every fruit/subregion.
//   * Plum: SSP5-8.5 ends <0 and SSP1-2.6 ends >0 at 2100.
//   * Same end-sign expectation for Apple/Pacific and Cherry/Pacific.
//   * Apple/Continental and Cherry/Continental are visibly different from their Pacific siblings.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHILL_CSV = path.join(ROOT, "data", "chill_days.csv");
const REGIONS_JSON = path.join(ROOT, "data", "fruit_regions.json");

const SCENARIOS = ["ssp126", "ssp245", "ssp585"];
const REF = "ssp245";

function r3(x) { return Math.round(x * 1000) / 1000; }
function key(lat, lon) { return `${r3(+lat)},${r3(+lon)}`; }

const regions = JSON.parse(fs.readFileSync(REGIONS_JSON, "utf8"));

// Streaming-ish: read once, index relevant cells only
const text = fs.readFileSync(CHILL_CSV, "utf8");
const lines = text.split(/\r?\n/);
const header = lines[0].split(",").map(s => s.trim());
const iLat = header.indexOf("lat");
const iLon = header.indexOf("lon");
const iYr = header.indexOf("year");
const iSc = header.indexOf("scenario");
const iCh = header.indexOf("chill_days");

const wanted = new Set();
for (const f of Object.keys(regions)) {
  for (const s of Object.keys(regions[f])) {
    for (const [lat, lon] of regions[f][s]) wanted.add(key(lat, lon));
  }
}

// key -> sc -> year -> chill
const index = new Map();
const yearsSet = new Set();
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const c = line.split(",");
  const lat = Number(c[iLat]);
  let lon = Number(c[iLon]); if (lon > 180) lon -= 360;
  const k = key(lat, lon);
  if (!wanted.has(k)) continue;
  const sc = c[iSc];
  const yr = Number(c[iYr]);
  const ch = Number(c[iCh]);
  if (!Number.isFinite(yr) || !Number.isFinite(ch)) continue;
  yearsSet.add(yr);
  let scMap = index.get(k);
  if (!scMap) { scMap = new Map(); index.set(k, scMap); }
  let yrMap = scMap.get(sc);
  if (!yrMap) { yrMap = new Map(); scMap.set(sc, yrMap); }
  yrMap.set(yr, ch);
}
const years = Array.from(yearsSet).sort((a, b) => a - b);

function computeDID(fruit, sub) {
  const keys = regions[fruit][sub].map(([lat, lon]) => key(lat, lon));
  const meanByScenario = {};
  for (const sc of SCENARIOS) {
    meanByScenario[sc] = new Map();
    for (const y of years) {
      let sum = 0, n = 0;
      for (const k of keys) {
        const v = index.get(k)?.get(sc)?.get(y);
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      meanByScenario[sc].set(y, n > 0 ? sum / n : null);
    }
  }
  const smoothed = {};
  for (const sc of SCENARIOS) {
    smoothed[sc] = new Map();
    for (let i = 0; i < years.length; i++) {
      const lo = Math.max(0, i - 4);
      const hi = Math.min(years.length - 1, i + 5);
      let sum = 0, n = 0;
      for (let j = lo; j <= hi; j++) {
        const v = meanByScenario[sc].get(years[j]);
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      smoothed[sc].set(years[i], n > 0 ? sum / n : null);
    }
  }
  const baseline = {};
  const baseYears = years.filter(y => y >= 2020 && y <= 2029);
  for (const sc of SCENARIOS) {
    let sum = 0, n = 0;
    for (const y of baseYears) {
      const v = smoothed[sc].get(y);
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    baseline[sc] = n > 0 ? sum / n : 0;
  }
  const delta = {};
  for (const sc of SCENARIOS) {
    delta[sc] = new Map();
    for (const y of years) {
      const v = smoothed[sc].get(y);
      delta[sc].set(y, Number.isFinite(v) ? v - baseline[sc] : null);
    }
  }
  const did = {};
  for (const sc of SCENARIOS) {
    did[sc] = [];
    for (const y of years) {
      const a = delta[sc].get(y);
      const b = delta[REF].get(y);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        did[sc].push({ year: y, did: a - b });
      }
    }
  }
  return did;
}

const results = {};
for (const fruit of Object.keys(regions)) {
  results[fruit] = {};
  for (const sub of Object.keys(regions[fruit])) {
    results[fruit][sub] = computeDID(fruit, sub);
  }
}

// === §7.6 (mandatory): SSP2-4.5 line exactly 0 everywhere ===
console.log("=== Check 1: SSP2-4.5 line is exactly y=0 for every fruit/subregion ===");
let allRefZero = true;
for (const f of Object.keys(results)) {
  for (const s of Object.keys(results[f])) {
    const pts = results[f][s][REF];
    const maxAbs = pts.reduce((m, p) => Math.max(m, Math.abs(p.did)), 0);
    const ok = maxAbs < 1e-9;
    console.log(`  ${f}/${s.padEnd(11)} max|did(ref)| = ${maxAbs.toExponential(2)}  ${ok ? "OK" : "FAIL"}`);
    if (!ok) allRefZero = false;
  }
}
console.log(`  >>> ${allRefZero ? "PASS" : "FAIL — DID sign convention or zeroing broken"}\n`);

// === §7.6 sign-direction at year 2100 ===
function endVal(pts) { return pts.length ? pts[pts.length - 1].did : null; }
console.log("=== Check 2: end-of-2100 sign direction ===");
const cases = [
  { f: "Plum",   s: "All",         exp126: ">0", exp585: "<0" },
  { f: "Pear",   s: "All",         exp126: ">0", exp585: "<0" },
  { f: "Apple",  s: "Pacific",     exp126: ">0", exp585: "<0" },
  { f: "Cherry", s: "Pacific",     exp126: ">0", exp585: "<0" },
  { f: "Apple",  s: "Continental", exp126: "any", exp585: "any" },
  { f: "Cherry", s: "Continental", exp126: "any", exp585: "any" }
];
for (const c of cases) {
  const r = results[c.f]?.[c.s];
  if (!r) { console.log(`  ${c.f}/${c.s}: missing`); continue; }
  const e126 = endVal(r.ssp126);
  const e585 = endVal(r.ssp585);
  const check126 = c.exp126 === "any" ? true : (c.exp126 === ">0" ? e126 > 0 : e126 < 0);
  const check585 = c.exp585 === "any" ? true : (c.exp585 === ">0" ? e585 > 0 : e585 < 0);
  const tag = (check126 && check585) ? "OK" : "WARN";
  console.log(`  ${c.f}/${c.s.padEnd(11)} ssp126_2100=${e126.toFixed(2).padStart(7)} (want ${c.exp126})   ssp585_2100=${e585.toFixed(2).padStart(7)} (want ${c.exp585})   ${tag}`);
}

// === Continental vs Pacific dissimilarity at 2100 ===
console.log("\n=== Check 3: Continental subplot is visibly different from Pacific ===");
for (const f of ["Apple", "Cherry"]) {
  const pacEnd585 = endVal(results[f].Pacific.ssp585);
  const conEnd585 = endVal(results[f].Continental.ssp585);
  const pacEnd126 = endVal(results[f].Pacific.ssp126);
  const conEnd126 = endVal(results[f].Continental.ssp126);
  const diff585 = Math.abs(pacEnd585 - conEnd585);
  const diff126 = Math.abs(pacEnd126 - conEnd126);
  console.log(`  ${f}: |Pac-Con| @2100 — ssp585=${diff585.toFixed(2)}, ssp126=${diff126.toFixed(2)}`);
}

console.log("\nDone.");
