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
      selectedYear = +this.value;
      d3.select("#year-label").text(selectedYear);
      updateVisualization();
    });

  d3.select("#year-label").text(selectedYear);
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