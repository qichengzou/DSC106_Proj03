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

const fruitTopStates = {
  Apple:  ["Washington", "New York",  "Michigan"],
  Cherry: ["Washington", "California","Michigan"],
  Pear:   ["Washington", "Oregon",    "California"],
  Plum:   ["California", "Michigan",  "Oregon"],
};
const ALL_CHART_STATES = ["Washington", "New York", "Michigan", "California", "Oregon"];
const CHART_SCENARIOS  = ["ssp126", "ssp245", "ssp585"];
const scenarioColors   = { ssp126: "#2196f3", ssp245: "#ff9800", ssp585: "#f44336" };

const CHART_W = 300, CHART_H = 190;
const CHART_M = { top: 24, right: 18, bottom: 38, left: 46 };
const CHART_IW = CHART_W - CHART_M.left - CHART_M.right;
const CHART_IH = CHART_H - CHART_M.top - CHART_M.bottom;

let stateAssignmentMap = new Map();
let stateChartData = {};
let lastChartFruit = null;
let lastChartScenario = null;
let xChartScale;

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
  })
]).then(([statesGeoJSON, data]) => {
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

  buildStateAssignments();
  buildStateChartData();

  setupRectangularProjection();

  console.log("Loaded climate rows:", climateData.length);
  console.log("Climate sample:", climateData.slice(0, 5));
  console.log("Years:", uniqueYears());
  console.log("Scenarios:", uniqueScenarios());

  drawStateOutlines();
  initializeControls();
  initializeYearSlider();
  updateVisualization();
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
    if (selectedFruit !== lastChartFruit || selectedScenario !== lastChartScenario) {
      drawStateCharts(selectedFruit, selectedScenario);
      lastChartFruit = selectedFruit;
      lastChartScenario = selectedScenario;
    }
    updateYearMarker();
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

  if (selectedFruit !== lastChartFruit || selectedScenario !== lastChartScenario) {
    drawStateCharts(selectedFruit, selectedScenario);
    lastChartFruit = selectedFruit;
    lastChartScenario = selectedScenario;
  }
  updateYearMarker();
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

// -----------------------------
// Point-in-polygon (ray casting)
// -----------------------------

function rayCast(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  let [px, py] = ring[n - 1];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = ring[i];
    if ((cy > lat) !== (py > lat) &&
        lon < ((px - cx) * (lat - cy)) / (py - cy) + cx) {
      inside = !inside;
    }
    [px, py] = [cx, cy];
  }
  return inside;
}

function pointInFeature(lon, lat, feature) {
  const { type, coordinates } = feature.geometry;
  if (type === "Polygon") {
    if (!rayCast(lon, lat, coordinates[0])) return false;
    for (let h = 1; h < coordinates.length; h++) {
      if (rayCast(lon, lat, coordinates[h])) return false;
    }
    return true;
  }
  if (type === "MultiPolygon") {
    for (const poly of coordinates) {
      if (rayCast(lon, lat, poly[0])) return true;
    }
  }
  return false;
}

// -----------------------------
// State assignment (PIP + coastal snap)
// -----------------------------

function minDistToFeature(lon, lat, feature) {
  const rings = feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat();
  let min = Infinity;
  for (const ring of rings) {
    for (const [vlon, vlat] of ring) {
      const d = (lon - vlon) ** 2 + (lat - vlat) ** 2;
      if (d < min) min = d;
    }
  }
  return Math.sqrt(min);
}

function buildStateAssignments() {
  const targets = states.filter(f => ALL_CHART_STATES.includes(f.properties.name));
  const pairs = new Set(climateData.map(d => `${d.lat}_${d.lon}`));
  const unassigned = [];

  for (const key of pairs) {
    const [lat, lon] = key.split("_").map(Number);
    let found = false;
    for (const feature of targets) {
      if (pointInFeature(lon, lat, feature)) {
        stateAssignmentMap.set(key, feature.properties.name);
        found = true;
        break;
      }
    }
    if (!found) unassigned.push({ key, lat, lon });
  }

  // Snap coastal/offshore cells to nearest state boundary within one grid cell diagonal
  const SNAP_DEG = 3;
  for (const { key, lat, lon } of unassigned) {
    let nearest = null, nearestDist = Infinity;
    for (const feature of targets) {
      const d = minDistToFeature(lon, lat, feature);
      if (d < nearestDist) { nearestDist = d; nearest = feature.properties.name; }
    }
    if (nearestDist <= SNAP_DEG) stateAssignmentMap.set(key, nearest);
  }
}

// -----------------------------
// Pre-aggregate chart data
// -----------------------------

function buildStateChartData() {
  for (const fruit of Object.keys(fruitThresholds)) {
    stateChartData[fruit] = {};
    for (const state of ALL_CHART_STATES) {
      stateChartData[fruit][state] = {};
      for (const sc of CHART_SCENARIOS) {
        stateChartData[fruit][state][sc] = {};
      }
    }
  }

  for (const d of climateData) {
    const state = stateAssignmentMap.get(`${d.lat}_${d.lon}`);
    if (!state || !CHART_SCENARIOS.includes(d.scenario)) continue;
    for (const fruit of Object.keys(fruitThresholds)) {
      const bucket = stateChartData[fruit][state][d.scenario];
      if (!bucket[d.year]) bucket[d.year] = { suit: 0, total: 0 };
      bucket[d.year].total++;
      if (d.chill_days >= fruitThresholds[fruit]) bucket[d.year].suit++;
    }
  }

  for (const fruit of Object.keys(fruitThresholds)) {
    for (const state of ALL_CHART_STATES) {
      for (const sc of CHART_SCENARIOS) {
        const bucket = stateChartData[fruit][state][sc];
        stateChartData[fruit][state][sc] = Object.entries(bucket)
          .map(([yr, { suit, total }]) => ({
            year: +yr,
            pct: total > 0 ? (suit / total) * 100 : 0
          }))
          .sort((a, b) => a.year - b.year);
      }
    }
  }
}

// -----------------------------
// State line charts
// -----------------------------

function drawStateCharts(fruit, scenario) {
  const container = d3.select("#state-charts");
  container.html("");

  xChartScale = d3.scaleLinear().domain([2020, 2100]).range([0, CHART_IW]);
  const yCS = d3.scaleLinear().domain([0, 100]).range([CHART_IH, 0]);
  const lineGen = d3.line()
    .x(d => xChartScale(d.year))
    .y(d => yCS(d.pct))
    .curve(d3.curveMonotoneX);

  for (const stateName of fruitTopStates[fruit]) {
    const card = container.append("div").attr("class", "state-chart-card");
    card.append("h3").attr("class", "chart-title").text(stateName);

    const svg = card.append("svg")
      .attr("viewBox", `0 0 ${CHART_W} ${CHART_H}`)
      .attr("class", "state-chart-svg");

    const g = svg.append("g")
      .attr("transform", `translate(${CHART_M.left},${CHART_M.top})`);

    g.append("g")
      .attr("transform", `translate(0,${CHART_IH})`)
      .call(d3.axisBottom(xChartScale).ticks(5).tickFormat(d3.format("d")));

    g.append("g")
      .call(d3.axisLeft(yCS).ticks(5).tickFormat(d => d + "%"));

    g.append("text").attr("class", "axis-label")
      .attr("x", CHART_IW / 2).attr("y", CHART_IH + 32)
      .attr("text-anchor", "middle").text("Year");

    g.append("text").attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -CHART_IH / 2).attr("y", -38)
      .attr("text-anchor", "middle").text("% Suitable");

    g.append("path")
      .datum(stateChartData[fruit][stateName][scenario])
      .attr("class", "scenario-line")
      .attr("d", lineGen)
      .attr("stroke", scenarioColors[scenario])
      .attr("stroke-width", 2.5)
      .attr("fill", "none");

    g.append("line").attr("class", "year-marker")
      .attr("x1", xChartScale(selectedYear)).attr("x2", xChartScale(selectedYear))
      .attr("y1", 0).attr("y2", CHART_IH)
      .attr("stroke", "#333").attr("stroke-width", 1.5).attr("stroke-dasharray", "4,3");
  }
}

function updateYearMarker() {
  if (!xChartScale) return;
  const x = xChartScale(selectedYear);
  d3.selectAll(".year-marker").attr("x1", x).attr("x2", x);
}
