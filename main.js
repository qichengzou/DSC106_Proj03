// -----------------------------
// Global settings
// -----------------------------

const width = 960;
const height = 600;

const svg = d3.select("#map");

const tooltip = d3.select("#tooltip")
  .style("position", "absolute")
  .style("opacity", 0)
  .style("background", "white")
  .style("border", "1px solid #999")
  .style("padding", "8px")
  .style("pointer-events", "none");

// Fruit chill-day thresholds
const fruitThresholds = {
  Apple: 60,
  Cherry: 70,
  Pear: 50,
  Plum: 40
};

const scenarios = ["ssp126", "ssp245", "ssp585"];

let climateData = [];
let selectedFruit = "Apple";
let selectedScenario = "ssp126";
let selectedYear = 2020;

// -----------------------------
// Projection
// -----------------------------

const projection = d3.geoAlbersUsa()
  .translate([width / 2, height / 2])
  .scale(1200);

// Group for map points
const g = svg.append("g");

// Zoom behavior
svg.call(
  d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", event => {
      g.attr("transform", event.transform);
    })
);

// -----------------------------
// Load data
// -----------------------------

d3.csv("data/chill_days.csv", d => ({
  lat: +d.lat,
  lon: +d.lon,
  year: +d.year,
  scenario: d.scenario,
  chill_days: +d.chill_days
})).then(data => {
  climateData = data;

  initializeControls();
  initializeYearSlider();
  updateVisualization();
});

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

  d3.select("#scenario-select")
    .selectAll("option")
    .data(scenarios)
    .join("option")
    .attr("value", d => d)
    .text(d => formatScenario(d));

  d3.select("#fruit-select").on("change", function () {
    selectedFruit = this.value;
    updateVisualization();
  });

  d3.select("#scenario-select").on("change", function () {
    selectedScenario = this.value;
    updateVisualization();
  });
}

function initializeYearSlider() {
  const years = Array.from(new Set(climateData.map(d => d.year))).sort((a, b) => a - b);

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
// Main update function
// -----------------------------

function updateVisualization() {
  const requiredChillDays = fruitThresholds[selectedFruit];

  const filteredData = climateData.filter(d =>
    d.year === selectedYear &&
    d.scenario === selectedScenario
  );

  const points = filteredData
    .map(d => {
      const projected = projection([d.lon, d.lat]);

      if (!projected) return null;

      return {
        ...d,
        x: projected[0],
        y: projected[1]
      };
    })
    .filter(d => d !== null);

  g.selectAll("circle")
    .data(points, d => `${d.lat}-${d.lon}`)
    .join(
      enter => enter.append("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", 3)
        .attr("fill", d => getSuitabilityColor(d.chill_days, requiredChillDays))
        .attr("opacity", 0.85)
        .on("mousemove", showTooltip)
        .on("mouseleave", hideTooltip),

      update => update
        .transition()
        .duration(300)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("fill", d => getSuitabilityColor(d.chill_days, requiredChillDays)),

      exit => exit.remove()
    );

  updateSummary(filteredData);
}

// -----------------------------
// Helper functions
// -----------------------------

function getSuitabilityColor(chillDays, requiredDays) {
  return chillDays >= requiredDays ? "#2a9d8f" : "#e76f51";
}

function formatScenario(scenario) {
  const labels = {
    ssp126: "SSP1-2.6: Low emissions",
    ssp245: "SSP2-4.5: Middle pathway",
    ssp585: "SSP5-8.5: High emissions"
  };

  return labels[scenario] ?? scenario;
}

function showTooltip(event, d) {
  const requiredDays = fruitThresholds[selectedFruit];
  const suitable = d.chill_days >= requiredDays ? "Suitable" : "Not enough chill";

  tooltip
    .style("opacity", 1)
    .style("left", `${event.pageX + 12}px`)
    .style("top", `${event.pageY + 12}px`)
    .html(`
      <strong>Grid Cell</strong><br>
      Lat: ${d.lat}<br>
      Lon: ${d.lon}<br>
      Year: ${d.year}<br>
      Scenario: ${formatScenario(d.scenario)}<br>
      Chill days: ${d.chill_days}<br>
      Fruit: ${selectedFruit}<br>
      Required: ${requiredDays}<br>
      <strong>${suitable}</strong>
    `);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

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