import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// DOM elements
const chartDiv = d3.select("#chart");

// Chart setup
const margin = {top: 20, right: 30, bottom: 30, left: 60};
const width = chartDiv.node().clientWidth - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;

const svg = chartDiv.append("svg")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const xScale = d3.scaleBand().range([0, width]).padding(0.1); // for bars
const xTimeScale = d3.scaleTime().range([0, width]); // for regression line
const yScale = d3.scaleLinear().range([height, 0]);

// Horizontal 0-line
svg.append("line")
  .attr("class", "zero-line")
  .attr("x1", 0)
  .attr("x2", width)
  .attr("y1", yScale(0))
  .attr("y2", yScale(0))
  .attr("stroke", "#888")
  .attr("stroke-width", 1)
  .attr("stroke-dasharray", "4,2");

// Tooltip
const tooltip = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("position", "absolute")
  .style("background", "#333")
  .style("color", "#fff")
  .style("padding", "6px 10px")
  .style("border-radius", "4px")
  .style("pointer-events", "none")
  .style("opacity", 0)
  .style("font-size", "12px");

// State
let dataAll = [];
let slope = 0;
let intercept = 0;

// Helper: parse date
function parseDate(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

// Compute monthly baseline
async function computeMonthlyBaseline(months) {
  const monthlyTemps = Array.from({length: 12}, () => []);
  for (const month of months) {
    const csvData = await d3.csv(`data/americas/${month}.csv`);
    const alaskaData = csvData.filter(d =>
      +d.lat >= 51 && +d.lat <= 72 &&
      +d.lon >= -180 && +d.lon <= -130
    );
    if (alaskaData.length === 0) continue;
    const avgTemp = d3.mean(alaskaData, d => +d.tas_k);
    const m = parseInt(month.split("-")[1], 10) - 1;
    monthlyTemps[m].push(avgTemp);
  }
  return monthlyTemps.map(arr => d3.mean(arr));
}

// Load all data
async function loadData() {
  const months = [];
  for (let year = 1987; year <= 2014; year++) {
    for (let month = 1; month <= 12; month++) {
      months.push(`${year}-${String(month).padStart(2,'0')}`);
    }
  }

  const baseline = await computeMonthlyBaseline(months);

  for (const month of months) {
    try {
      const csvData = await d3.csv(`data/americas/${month}.csv`);
      const alaskaData = csvData.filter(d =>
        +d.lat >= 51 && +d.lat <= 72 &&
        +d.lon >= -180 && +d.lon <= -130
      );
      if (alaskaData.length === 0) continue;

      const avgTemp = d3.mean(alaskaData, d => +d.tas_k);
      const anomaly = avgTemp - baseline[parseInt(month.split("-")[1],10)-1];
      dataAll.push({ date: parseDate(month), anomaly, tempK: avgTemp });
    } catch (err) {
      console.error(`Failed to load ${month}:`, err);
    }
  }

  updateChart();
  drawRegression();
  animateBarsSequentially();
}

// Update chart (axes, scales)
function updateChart() {
  xScale.domain(dataAll.map(d => d.date));
  xTimeScale.domain(d3.extent(dataAll, d => d.date));
  yScale.domain(d3.extent(dataAll, d => d.anomaly)).nice();

  // Axes
  svg.selectAll(".x-axis").remove();
  svg.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(xScale)
      .tickFormat(d3.timeFormat("%Y-%m"))
      .tickValues(xScale.domain().filter((d,i) => i % 12 === 0)));

  svg.selectAll(".y-axis").remove();
  svg.append("g")
    .attr("class", "y-axis")
    .call(d3.axisLeft(yScale).tickFormat(d => `${d.toFixed(2)} K`));

  // Zero line
  svg.select(".zero-line")
    .attr("y1", yScale(0))
    .attr("y2", yScale(0))
    .attr("x2", width);

  // Tooltip overlay
  svg.selectAll(".overlay").remove();
  svg.append("rect")
    .attr("class", "overlay")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .on("mousemove", onMouseMove)
    .on("mouseout", onMouseOut);
}

// Draw regression line
function drawRegression() {
  if (dataAll.length < 2) return;

  const x = dataAll.map(d => d.date.getTime());
  const y = dataAll.map(d => d.anomaly);
  const n = x.length;
  const xMean = d3.mean(x);
  const yMean = d3.mean(y);

  let num = 0, den = 0;
  for (let i=0; i<n; i++) {
    num += (x[i]-xMean)*(y[i]-yMean);
    den += (x[i]-xMean)**2;
  }

  slope = num / den;
  intercept = yMean - slope*xMean;

  const regLine = [
    {date: new Date(x[0]), anomaly: slope*x[0]+intercept},
    {date: new Date(x[n-1]), anomaly: slope*x[n-1]+intercept}
  ];

  const regLinePath = d3.line()
    .x(d => xTimeScale(d.date))
    .y(d => yScale(d.anomaly));

  svg.selectAll(".regression-line").remove();
  svg.append("path")
    .datum(regLine)
    .attr("class", "regression-line")
    .attr("fill", "none")
    .attr("stroke", "#ffcc00")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "5,5")
    .attr("d", regLinePath);
}

// Animate bars sequentially
function animateBarsSequentially() {
  const bars = svg.selectAll(".bar").data(dataAll);

  bars.enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", d => xScale(d.date))
    .attr("width", xScale.bandwidth())
    .attr("y", yScale(0))
    .attr("height", 0)
    .attr("fill", d => d.anomaly >= 0 ? "red" : "blue")
    .transition()
    .delay((d,i) => i * 20)
    .duration(300)
    .attr("y", d => d.anomaly >= 0 ? yScale(d.anomaly) : yScale(0))
    .attr("height", d => Math.abs(yScale(d.anomaly) - yScale(0)));
}

// Tooltip and highlight
function onMouseMove(event) {
  const [mx] = d3.pointer(event, svg.node());
  const x0 = xTimeScale.invert(mx);

  const bisect = d3.bisector(d => d.date).left;
  const i = bisect(dataAll, x0);
  const d0 = dataAll[i - 1];
  const d1 = dataAll[i];
  let d = d0;
  if (d1 && (x0 - d0.date > d1.date - x0)) d = d1;
  if (!d) return;

  // Highlight bar
  svg.selectAll(".bar").attr("stroke", "none");
  svg.selectAll(".bar")
    .filter(b => b === d)
    .attr("stroke", "#fff")
    .attr("stroke-width", 2);

  // Tooltip
  tooltip
    .style("opacity", 1)
    .html(`
      <strong>${d3.timeFormat("%Y-%m")(d.date)}</strong><br>
      Temp: ${d.tempK.toFixed(2)} K<br>
      Anomaly: ${d.anomaly.toFixed(2)} K
    `)
    .style("left", (event.pageX + 15) + "px")
    .style("top", (event.pageY - 25) + "px");
}

function onMouseOut() {
  svg.selectAll(".bar").attr("stroke", "none");
  tooltip.style("opacity", 0);
}

// Start visualization
loadData();
