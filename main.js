// -----------------------------
// Global settings
// -----------------------------

const width = 960;
const height = 430;

const svg = d3.select("#map")
  .attr("width", width)
  .attr("height", height)
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

const tooltip = d3.select("#tooltip")
  .style("position", "absolute")
  .style("opacity", 0)
  .style("background", "white")
  .style("border", "1px solid #999")
  .style("padding", "8px")
  .style("pointer-events", "none")
  .style("font-size", "13px");

const fruitThresholds = {
  Apple: 60,
  Cherry: 70,
  Pear: 50,
  Plum: 40
};

let climateData = [];
let states = [];
let fruitRegions = null;
let didSeries = null;

let selectedFruit = "Apple";
let selectedScenario = null;
let selectedYear = null;

let xScale;
let yScale;
let path;

let isPlaying = false;
let playInterval = null;

const suitabilityColor = d3.scaleDiverging()
  .domain([-60, 0, 60])
  .interpolator(d3.interpolateRdYlBu)
  .clamp(true);

// -----------------------------
// SVG layers
// -----------------------------

const defs = svg.append("defs");
const clipPath = defs.append("clipPath").attr("id", "us-clip");

const g = svg.append("g");

const climateLayer = g.append("g")
  .attr("class", "climate-layer")
  .attr("clip-path", "url(#us-clip)");

const stateOutlineLayer = g.append("g")
  .attr("class", "state-outline-layer");

// Zoom: users can zoom in, but not zoom out beyond full map.
const zoom = d3.zoom()
  .scaleExtent([1, 8])
  .extent([[0, 0], [width, height]])
  .translateExtent([[0, 0], [width, height]])
  .on("zoom", event => {
    g.attr("transform", event.transform);
  });

svg.call(zoom);

// -----------------------------
// Load data
// -----------------------------

Promise.all([
  d3.json("data/us-states.json"),
  d3.csv("data/chill_days.csv", d => {
    let lon = +d.lon;

    if (lon > 180) {
      lon = lon - 360;
    }

    return {
      lat: +d.lat,
      lon,
      year: +d.year,
      scenario: d.scenario,
      chill_days: +d.chill_days
    };
  }),
  d3.json("data/fruit_regions.json")
]).then(([statesGeoJSON, data, regions]) => {
  const excludedStates = new Set([
    "Alaska",
    "Hawaii",
    "Puerto Rico"
  ]);

  states = statesGeoJSON.features.filter(
    d => !excludedStates.has(d.properties.name)
  );

  climateData = data.filter(d =>
    Number.isFinite(d.lat) &&
    Number.isFinite(d.lon) &&
    Number.isFinite(d.year) &&
    Number.isFinite(d.chill_days) &&
    d.scenario
  );

  fruitRegions = regions;

  setupRectangularProjection();

  console.log("Loaded climate rows:", climateData.length);
  console.log("Climate sample:", climateData.slice(0, 5));
  console.log("Years:", uniqueYears());
  console.log("Scenarios:", uniqueScenarios());

  precomputeDIDSeries();

  drawStateOutlines();
  initializeControls();
  initializeYearSlider();
  renderLegend();
  updateVisualization();
  updateProductionHighlights();
  renderImpactChart(selectedFruit);
}).catch(error => {
  console.error("Data loading failed:", error);
});

// -----------------------------
// Rectangular lon/lat transform
// -----------------------------

function setupRectangularProjection() {
  const minLon = d3.min(climateData, d => d.lon);
  const maxLon = d3.max(climateData, d => d.lon);
  const minLat = d3.min(climateData, d => d.lat);
  const maxLat = d3.max(climateData, d => d.lat);

  const midLat = (minLat + maxLat) / 2;
  const lonCos = Math.cos(midLat * Math.PI / 180);

  const lonSpan = (maxLon - minLon) * lonCos;
  const latSpan = maxLat - minLat;

  const k = Math.min(width / lonSpan, height / latSpan);
  const xOffset = (width - lonSpan * k) / 2;
  const yOffset = (height - latSpan * k) / 2;

  xScale = d3.scaleLinear()
    .domain([minLon, maxLon])
    .range([xOffset, xOffset + lonSpan * k]);

  yScale = d3.scaleLinear()
    .domain([minLat, maxLat])
    .range([height - yOffset, yOffset]);

  const rectangularProjection = d3.geoTransform({
    point: function(lon, lat) {
      this.stream.point(xScale(lon), yScale(lat));
    }
  });

  path = d3.geoPath().projection(rectangularProjection);
}

// -----------------------------
// State outlines
// -----------------------------

function drawStateOutlines() {
  clipPath.selectAll("path")
    .data(states)
    .join("path")
    .attr("d", path);

  stateOutlineLayer.selectAll(".state-outline")
    .data(states)
    .join("path")
    .attr("class", "state-outline")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#444")
    .attr("stroke-width", 0.7)
    .attr("pointer-events", "none");
}

// -----------------------------
// Controls
// -----------------------------

function initializeControls() {
  d3.select("#fruit-select")
    .selectAll("option")
    .data(Object.keys(fruitThresholds))
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  const scenarios = uniqueScenarios();

  selectedScenario = scenarios.includes("ssp126")
    ? "ssp126"
    : scenarios[0];

  d3.select("#scenario-select")
    .selectAll("option")
    .data(scenarios)
    .join("option")
    .attr("value", d => d)
    .text(d => formatScenario(d));

  d3.select("#fruit-select")
    .property("value", selectedFruit)
    .on("change", function () {
      selectedFruit = this.value;
      updateVisualization();
      updateProductionHighlights();
      renderImpactChart(selectedFruit);
    });

  d3.select("#scenario-select")
    .property("value", selectedScenario)
    .on("change", function () {
      selectedScenario = this.value;
      updateVisualization();
    });
}

function initializeYearSlider() {
  const years = uniqueYears();

  selectedYear = years[0];

  d3.select("#year-slider")
    .attr("min", d3.min(years))
    .attr("max", d3.max(years))
    .attr("step", 1)
    .attr("value", selectedYear)
    .on("input", function () {
      if (isPlaying) togglePlay();
      selectedYear = +this.value;
      d3.select("#year-label").text(selectedYear);
      updateVisualization();
      updateYearMarker();
    });

  d3.select("#year-label").text(selectedYear);
  
}

function togglePlay() {
  const years = uniqueYears();
  const btn = document.getElementById("play-btn");

  if (isPlaying) {
    clearInterval(playInterval);
    playInterval = null;
    isPlaying = false;
    btn.textContent = "▶ Play";
    btn.classList.remove("playing");
  } else {
    isPlaying = true;
    btn.textContent = "⏸ Pause";
    btn.classList.add("playing");

    playInterval = setInterval(() => {
      const currentIndex = years.indexOf(selectedYear);
      const nextIndex = currentIndex + 1;

      if (nextIndex >= years.length) {
        // Stop at the end
        togglePlay();
        return;
      }

      selectedYear = years[nextIndex];
      const slider = document.getElementById("year-slider");
      slider.value = selectedYear;
      d3.select("#year-label").text(selectedYear);
      updateVisualization();
      updateYearMarker();
    }, 1000);
  }
}

// -----------------------------
// Main update
// -----------------------------

function updateVisualization() {
  const filteredData = climateData.filter(d =>
    d.year === selectedYear &&
    d.scenario === selectedScenario
  );

  if (filteredData.length === 0) {
    climateLayer.selectAll(".climate-cell").remove();
    updateSummary(filteredData);
    return;
  }

  const latStep = getMedianSpacing(filteredData.map(d => d.lat));
  const lonStep = getMedianSpacing(filteredData.map(d => d.lon));

  const cells = filteredData.map(d => ({
    ...d,
    cellPath: makeRectangularCellPath(d, latStep, lonStep)
  }));

  climateLayer.selectAll(".climate-cell")
    .data(cells, d => `${d.lat}-${d.lon}`)
    .join(
      enter => enter.append("path")
        .attr("class", "climate-cell")
        .attr("d", d => d.cellPath)
        .attr("fill", d => getFruitSuitabilityColor(d))
        .attr("stroke", "none")
        .attr("opacity", 0.92)
        .on("mousemove", showTooltip)
        .on("mouseleave", hideTooltip),

      update => update
        .transition()
        .duration(250)
        .attr("d", d => d.cellPath)
        .attr("fill", d => getFruitSuitabilityColor(d)),

      exit => exit.remove()
    );

  updateSummary(filteredData);
  updateLegendCaption();
}

// -----------------------------
// Legend
// -----------------------------

function renderLegend() {
  const legendSvg = d3.select("#legend-svg");
  if (legendSvg.empty()) return;
  legendSvg.selectAll("*").remove();

  const vbWidth = 280;
  const vbHeight = 60;
  const margin = { left: 14, right: 14, top: 6, bottom: 22 };
  const barWidth = vbWidth - margin.left - margin.right;
  const barHeight = 14;

  const defs = legendSvg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "legend-gradient")
    .attr("x1", "0%").attr("x2", "100%")
    .attr("y1", "0%").attr("y2", "0%");

  const stopCount = 11;
  const [dMin, , dMax] = suitabilityColor.domain();
  d3.range(stopCount).forEach(i => {
    const t = i / (stopCount - 1);
    const value = dMin + t * (dMax - dMin);
    gradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", suitabilityColor(value));
  });

  legendSvg.append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", barWidth)
    .attr("height", barHeight)
    .attr("fill", "url(#legend-gradient)")
    .attr("stroke", "#bbb")
    .attr("stroke-width", 0.5);

  const x = d3.scaleLinear()
    .domain([dMin, dMax])
    .range([margin.left, margin.left + barWidth]);

  const ticks = [-60, -30, 0, 30, 60];
  const axis = legendSvg.append("g").attr("class", "legend-axis");

  ticks.forEach(t => {
    const xt = x(t);
    axis.append("line")
      .attr("x1", xt).attr("x2", xt)
      .attr("y1", margin.top + barHeight)
      .attr("y2", margin.top + barHeight + 4)
      .attr("stroke", "#444")
      .attr("stroke-width", 1);

    axis.append("text")
      .attr("x", xt)
      .attr("y", margin.top + barHeight + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("font-weight", t === 0 ? 700 : 400)
      .attr("fill", "#222")
      .text(t > 0 ? `+${t}` : `${t}`);
  });
}

function updateLegendCaption() {
  const req = fruitThresholds[selectedFruit];
  d3.select("#legend-caption").html(
    `Gap vs. <strong>${selectedFruit}</strong>'s ${req}-day chill requirement`
  );
}

// -----------------------------
// Climate cell drawing
// -----------------------------

function makeRectangularCellPath(d, latStep, lonStep) {
  const overlap = 1.02;

  const halfLat = (latStep * overlap) / 2;
  const halfLon = (lonStep * overlap) / 2;

  const x0 = xScale(d.lon - halfLon);
  const x1 = xScale(d.lon + halfLon);
  const y0 = yScale(d.lat + halfLat);
  const y1 = yScale(d.lat - halfLat);

  return `
    M ${x0},${y0}
    L ${x1},${y0}
    L ${x1},${y1}
    L ${x0},${y1}
    Z
  `;
}

function getMedianSpacing(values) {
  const unique = Array.from(new Set(values.map(v => +v.toFixed(6))))
    .sort((a, b) => a - b);

  const diffs = unique
    .slice(1)
    .map((v, i) => v - unique[i])
    .filter(d => d > 0);

  return d3.median(diffs) || 1;
}

// -----------------------------
// Color
// -----------------------------

function getFruitSuitabilityColor(d) {
  const required = fruitThresholds[selectedFruit];
  const gap = d.chill_days - required;

  return suitabilityColor(gap);
}

// -----------------------------
// Tooltip
// -----------------------------

function showTooltip(event, d) {
  const requiredDays = fruitThresholds[selectedFruit];
  const gap = d.chill_days - requiredDays;
  const suitable = gap >= 0 ? "Suitable" : "Not enough chill";

  tooltip
    .style("opacity", 1)
    .style("left", `${event.pageX + 12}px`)
    .style("top", `${event.pageY + 12}px`)
    .html(`
      <strong>Climate Grid Cell</strong><br>
      Lat: ${d.lat.toFixed(2)}<br>
      Lon: ${d.lon.toFixed(2)}<br>
      Year: ${d.year}<br>
      Scenario: ${formatScenario(d.scenario)}<br>
      Fruit: ${selectedFruit}<br>
      Chill days: ${d.chill_days}<br>
      Required: ${requiredDays}<br>
      Gap: ${gap >= 0 ? "+" : ""}${gap} days<br>
      <strong>${suitable}</strong>
    `);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

// -----------------------------
// Summary
// -----------------------------

function updateSummary(filteredData) {
  const requiredDays = fruitThresholds[selectedFruit];

  const suitableCount = filteredData.filter(d => d.chill_days >= requiredDays).length;
  const totalCount = filteredData.length;

  const percentSuitable = totalCount === 0
    ? 0
    : Math.round((suitableCount / totalCount) * 100);

  d3.select("#selection-summary").html(`
    Fruit: <strong>${selectedFruit}</strong><br>
    Required chill days: <strong>${requiredDays}</strong><br>
    Scenario: <strong>${formatScenario(selectedScenario)}</strong><br>
    Year: <strong>${selectedYear}</strong><br>
    Suitable grid cells: <strong>${suitableCount}</strong> / ${totalCount}
    (${percentSuitable}%)
  `);
}

// -----------------------------
// Impact chart: DID precomputation
// -----------------------------

const SCENARIOS = ["ssp126", "ssp245", "ssp585"];
const REF_SCENARIO = "ssp245";

function cellKey(lat, lon) {
  return `${Math.round(+lat * 1000) / 1000},${Math.round(+lon * 1000) / 1000}`;
}

function precomputeDIDSeries() {
  didSeries = {};
  if (!fruitRegions || !climateData.length) return;

  // Index climate data: key -> scenario -> year -> chill_days
  const index = new Map();
  for (const d of climateData) {
    const key = cellKey(d.lat, d.lon);
    let scMap = index.get(key);
    if (!scMap) { scMap = new Map(); index.set(key, scMap); }
    let yrMap = scMap.get(d.scenario);
    if (!yrMap) { yrMap = new Map(); scMap.set(d.scenario, yrMap); }
    yrMap.set(d.year, d.chill_days);
  }

  const years = uniqueYears();

  for (const fruit of Object.keys(fruitRegions)) {
    didSeries[fruit] = {};
    for (const sub of Object.keys(fruitRegions[fruit])) {
      const keys = fruitRegions[fruit][sub].map(([lat, lon]) => cellKey(lat, lon));

      // Per-scenario mean chill per year (averaged over cells)
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

      // Centered 10-year rolling mean: window [i-4, i+5], clipped at edges
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

      // Baseline: mean of smoothed for 2020-2029, per scenario
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

      // delta(sc, y) = smoothed(sc, y) - baseline(sc)
      const delta = {};
      for (const sc of SCENARIOS) {
        delta[sc] = new Map();
        for (const y of years) {
          const v = smoothed[sc].get(y);
          delta[sc].set(y, Number.isFinite(v) ? v - baseline[sc] : null);
        }
      }

      // did(sc, y) = delta(sc, y) - delta(ref, y)
      didSeries[fruit][sub] = {};
      for (const sc of SCENARIOS) {
        const pts = [];
        for (const y of years) {
          const a = delta[sc].get(y);
          const b = delta[REF_SCENARIO].get(y);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            pts.push({ year: y, did: a - b });
          }
        }
        didSeries[fruit][sub][sc] = pts;
      }
    }
  }
}

// -----------------------------
// Impact chart: render
// -----------------------------

const SUBREGION_STATES = {
  Apple:  { Pacific: "WA, OR",     Continental: "NY, MI, PA, VA" },
  Cherry: { Pacific: "WA, OR, CA", Continental: "MI, UT" }
};

const SCENARIO_STYLE = {
  ssp126: { stroke: "#1f77b4", width: 2,   dash: null,  opacity: 0.95 },
  ssp245: { stroke: "#ff7f0e", width: 1.4, dash: "3 3", opacity: 0.7  },
  ssp585: { stroke: "#d62728", width: 2,   dash: null,  opacity: 0.95 }
};

const IMPACT_CHART_W = 960;
const IMPACT_MARGIN = { top: 32, right: 24, bottom: 44, left: 64 };

function renderImpactChart(fruit) {
  const chartSvg = d3.select("#impact-chart");
  chartSvg.selectAll("*").remove();

  if (!didSeries || !didSeries[fruit]) return;

  const subRegions = Object.keys(didSeries[fruit]);
  const subOrder = { Pacific: 0, Continental: 1, All: 0 };
  subRegions.sort((a, b) => (subOrder[a] ?? 99) - (subOrder[b] ?? 99));

  const split = subRegions.length > 1;
  const subH = split ? 270 : 300;
  const gap = 20;
  const totalH = split ? (subH * 2 + gap) : subH;

  chartSvg
    .attr("viewBox", `0 0 ${IMPACT_CHART_W} ${totalH}`)
    .attr("height", totalH);

  // Shared symmetric y-domain (padded to 5, 0 centered)
  let yMin = 0, yMax = 0;
  for (const sub of subRegions) {
    for (const sc of SCENARIOS) {
      for (const pt of didSeries[fruit][sub][sc] || []) {
        if (pt.did < yMin) yMin = pt.did;
        if (pt.did > yMax) yMax = pt.did;
      }
    }
  }
  let extent = Math.max(Math.abs(yMin), Math.abs(yMax), 5);
  extent = Math.ceil(extent / 5) * 5;
  const yDomain = [-extent, extent];

  // Header (set once, fruit-agnostic) — keep neutral so subplot titles carry the per-fruit naming
  d3.select("#impact-chart-title").text("Production-region chill-day change");

  // Legend
  const legendDiv = d3.select("#impact-chart-legend");
  legendDiv.html("");
  const items = [
    { sc: "ssp126", label: "SSP1-2.6 (aggressive mitigation)" },
    { sc: "ssp245", label: "SSP2-4.5 (current trajectory, reference)" },
    { sc: "ssp585", label: "SSP5-8.5 (high emissions)" }
  ];
  for (const it of items) {
    const style = SCENARIO_STYLE[it.sc];
    const item = legendDiv.append("span").attr("class", "legend-item");
    const swatch = item.append("span").attr("class", "legend-swatch");
    if (style.dash) {
      swatch.style("background",
        `repeating-linear-gradient(to right, ${style.stroke} 0 5px, transparent 5px 9px)`);
    } else {
      swatch.style("background", style.stroke);
    }
    item.append("span").text(it.label);
  }

  // Subplots
  subRegions.forEach((sub, idx) => {
    const yOff = idx * (subH + gap);
    const subG = chartSvg.append("g")
      .attr("class", `subplot subplot-${sub.toLowerCase()}`)
      .attr("transform", `translate(0, ${yOff})`);
    drawImpactSubplot(subG, fruit, sub, IMPACT_CHART_W, subH, yDomain);
  });

  // Caption + methodology note
  d3.select("#impact-chart-caption").text(
    `Chill-day change in top US ${fruit} production regions, relative to staying on the current-trajectory (SSP2-4.5) path. Each scenario anchored to its own 2020s decadal mean; 10-year rolling smoothing applied.`
  );

  if (split) {
    d3.select("#impact-chart-note")
      .style("display", "")
      .text(`${fruit} shown split because its growing regions span Pacific and Continental climates, which respond differently to higher emissions.`);
  } else {
    d3.select("#impact-chart-note").style("display", "none").text("");
  }
}

function drawImpactSubplot(g, fruit, sub, w, h, yDomain) {
  const m = IMPACT_MARGIN;
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;

  const xs = d3.scaleLinear().domain([2020, 2100]).range([m.left, m.left + innerW]);
  const ys = d3.scaleLinear().domain(yDomain).range([m.top + innerH, m.top]);

  // Gridlines
  const yTicks = ys.ticks(6);
  g.append("g").attr("class", "gridlines")
    .selectAll("line")
    .data(yTicks)
    .join("line")
    .attr("x1", m.left).attr("x2", m.left + innerW)
    .attr("y1", d => ys(d)).attr("y2", d => ys(d))
    .attr("stroke", "#e2e2e2")
    .attr("stroke-dasharray", "2 2");

  // Axes
  const xAxis = d3.axisBottom(xs)
    .tickValues(d3.range(2020, 2101, 10))
    .tickFormat(d3.format("d"));
  g.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${m.top + innerH})`)
    .call(xAxis);

  const yAxis = d3.axisLeft(ys)
    .tickValues(yTicks)
    .tickFormat(d => (d > 0 ? "+" : "") + d);
  g.append("g")
    .attr("class", "axis y-axis")
    .attr("transform", `translate(${m.left}, 0)`)
    .call(yAxis);

  // Axis labels
  g.append("text")
    .attr("class", "axis-label")
    .attr("x", m.left + innerW / 2)
    .attr("y", m.top + innerH + 34)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", "#444")
    .text("Year");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -(m.top + innerH / 2))
    .attr("y", m.left - 46)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", "#444")
    .text("Chill-day change vs SSP2-4.5");

  // Bold zero-line on top of gridlines
  g.append("line")
    .attr("class", "zero-line")
    .attr("x1", m.left).attr("x2", m.left + innerW)
    .attr("y1", ys(0)).attr("y2", ys(0))
    .attr("stroke", "#444").attr("stroke-width", 1);

  // Year marker
  const xm = xs(selectedYear);
  g.append("line")
    .attr("class", "year-marker")
    .attr("x1", xm).attr("x2", xm)
    .attr("y1", m.top).attr("y2", m.top + innerH)
    .attr("stroke", "#888").attr("stroke-width", 1)
    .attr("stroke-dasharray", "4 3");

  // Series (draw ref first so it sits beneath the two scenarios visually)
  const lineGen = d3.line().x(d => xs(d.year)).y(d => ys(d.did));
  for (const sc of ["ssp245", "ssp126", "ssp585"]) {
    const data = didSeries[fruit][sub][sc];
    if (!data || !data.length) continue;
    const style = SCENARIO_STYLE[sc];
    const path = g.append("path")
      .datum(data)
      .attr("class", `series series-${sc}`)
      .attr("fill", "none")
      .attr("stroke", style.stroke)
      .attr("stroke-width", style.width)
      .attr("opacity", style.opacity)
      .attr("d", lineGen);
    if (style.dash) path.attr("stroke-dasharray", style.dash);
  }

  // Subplot title
  let title;
  if (sub === "All") {
    title = `${fruit} production regions`;
  } else {
    const states = SUBREGION_STATES[fruit]?.[sub] || "";
    title = `${sub} ${fruit} regions${states ? ` (${states})` : ""}`;
  }
  g.append("text")
    .attr("class", "subplot-title")
    .attr("x", m.left)
    .attr("y", m.top - 12)
    .attr("font-size", 14)
    .attr("font-weight", 700)
    .attr("fill", "#222")
    .text(title);
}

function updateYearMarker() {
  const chartSvg = d3.select("#impact-chart");
  if (chartSvg.empty()) return;
  const innerW = IMPACT_CHART_W - IMPACT_MARGIN.left - IMPACT_MARGIN.right;
  const xs = d3.scaleLinear().domain([2020, 2100]).range([IMPACT_MARGIN.left, IMPACT_MARGIN.left + innerW]);
  const xm = xs(selectedYear);
  chartSvg.selectAll(".subplot .year-marker")
    .attr("x1", xm).attr("x2", xm);
}

// -----------------------------
// Production-region highlights on map
// -----------------------------

function updateProductionHighlights() {
  if (!fruitRegions) return;
  const subs = fruitRegions[selectedFruit] || {};
  const set = new Set();
  for (const sub of Object.keys(subs)) {
    for (const [lat, lon] of subs[sub]) {
      set.add(cellKey(lat, lon));
    }
  }
  climateLayer.selectAll(".climate-cell")
    .classed("production-cell", d => set.has(cellKey(d.lat, d.lon)));

  d3.select("#production-caption").text(
    `Outlined cells = top US ${selectedFruit} production regions.`
  );
}

// -----------------------------
// Helpers
// -----------------------------

function uniqueYears() {
  return Array.from(new Set(climateData.map(d => d.year)))
    .sort((a, b) => a - b);
}

function uniqueScenarios() {
  return Array.from(new Set(climateData.map(d => d.scenario)))
    .sort();
}

function formatScenario(scenario) {
  const labels = {
    historical: "Historical",
    ssp126: "SSP1-2.6: Low emissions",
    ssp245: "SSP2-4.5: Middle pathway",
    ssp585: "SSP5-8.5: High emissions"
  };

  return labels[scenario] ?? scenario;
}
