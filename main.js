import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Track which charts have been initialized
const initialized = { alaska: false, us: false };

// Tab switching
window.switchTab = function(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  if (tab === 'alaska') {
    document.querySelector('.tab:nth-child(1)').classList.add('active');
    document.getElementById('alaska-content').classList.add('active');
    if (!initialized.alaska) {
      initialized.alaska = true;
      createVisualization("#chart-alaska", "#loading-alaska", "alaska");
    }
  } else {
    document.querySelector('.tab:nth-child(2)').classList.add('active');
    document.getElementById('us-content').classList.add('active');
    if (!initialized.us) {
      initialized.us = true;
      createVisualization("#chart-us", "#loading-us", "us");
    }
  }
};

// Shared tooltip
const tooltip = d3.select("body").append("div")
  .style("position", "absolute")
  .style("background", "#333")
  .style("color", "#fff")
  .style("padding", "6px 10px")
  .style("border-radius", "4px")
  .style("pointer-events", "none")
  .style("opacity", 0)
  .style("font-size", "12px")
  .style("z-index", "1000");

// Create visualization for a region
async function createVisualization(chartSelector, loadingSelector, region) {
  const chartDiv = d3.select(chartSelector);
  const loadingDiv = d3.select(loadingSelector);
  
  let dataAll = [];

  function parseDate(monthStr) {
    const [year, month] = monthStr.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  function filterByRegion(d) {
    const lat = +d.lat;
    let lon = +d.lon;
    if (lon < 0) lon += 360;
    
    if (region === 'alaska') {
      return lat >= 51 && lat <= 72 && lon >= 190 && lon <= 235;
    } else {
      return lat >= 25 && lat <= 49 && lon >= 235 && lon <= 294;
    }
  }

  async function computeMonthlyBaseline(months) {
    const monthlyTemps = Array.from({length: 12}, () => []);
    
    for (const month of months) {
      try {
        const csvData = await d3.csv(`data/americas/${month}.csv`);
        const regionData = csvData.filter(filterByRegion);
        if (regionData.length === 0) continue;
        const avgTemp = d3.mean(regionData, d => +d.tas_k);
        const m = parseInt(month.split("-")[1], 10) - 1;
        monthlyTemps[m].push(avgTemp);
      } catch (err) {
        console.error(`Failed to load ${month} for baseline:`, err);
      }
    }
    
    return monthlyTemps.map(arr => arr.length > 0 ? d3.mean(arr) : null);
  }

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
        const regionData = csvData.filter(filterByRegion);
        if (regionData.length === 0) continue;

        const avgTemp = d3.mean(regionData, d => +d.tas_k);
        const monthIndex = parseInt(month.split("-")[1],10)-1;
        if (baseline[monthIndex] === null) continue;

        const anomaly = avgTemp - baseline[monthIndex];
        dataAll.push({ date: parseDate(month), anomaly, tempK: avgTemp });
      } catch (err) {
        console.error(`Failed to load ${month}:`, err);
      }
    }

    if (dataAll.length === 0) {
      loadingDiv.text(`No data found for ${region}. Check console for details.`);
      return;
    }

    loadingDiv.style("display", "none");
    drawChart();
  }

  function drawChart() {
    const margin = {top: 30, right: 40, bottom: 60, left: 100};
    const containerWidth = chartDiv.node().clientWidth;
    const width = containerWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Clear any existing content
    chartDiv.html("");

    const svg = chartDiv.append("svg")
      .attr("width", containerWidth)
      .attr("height", 400)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand().range([0, width]).padding(0.1);
    const xTimeScale = d3.scaleTime().range([0, width]);
    const yScale = d3.scaleLinear().range([height, 0]);

    xScale.domain(dataAll.map(d => d.date));
    xTimeScale.domain(d3.extent(dataAll, d => d.date));
    yScale.domain(d3.extent(dataAll, d => d.anomaly)).nice();

    // X-axis
    const xAxis = svg.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xTimeScale).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat("%Y")));
    
    xAxis.selectAll("text")
      .style("fill", "#000")
      .style("font-size", "12px");
    
    xAxis.selectAll("line")
      .style("stroke", "#666");
    
    xAxis.select(".domain")
      .style("stroke", "#666");

    // X-axis label
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .style("text-anchor", "middle")
      .style("fill", "#000")
      .style("font-size", "13px")
      .text("Year");

    // Y-axis
    const yAxis = svg.append("g")
      .attr("class", "y-axis")
      .call(d3.axisLeft(yScale).ticks(8).tickFormat(d => (d>0?"+":"")+d.toFixed(2)+" K"));
    
    yAxis.selectAll("text")
      .style("fill", "#000")
      .style("font-size", "11px");
    
    yAxis.selectAll("line")
      .style("stroke", "#666");
    
    yAxis.select(".domain")
      .style("stroke", "#666");

    // Y-axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -margin.left + 15)
      .attr("x", -(height / 2))
      .style("text-anchor", "middle")
      .style("fill", "#000")
      .style("font-size", "13px")
      .text("Difference in Average Monthly Temperature (K)");

    // Zero line
    svg.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "#888").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    // Regression line
    const x = dataAll.map(d => d.date.getTime());
    const y = dataAll.map(d => d.anomaly);
    const n = x.length;
    const xMean = d3.mean(x), yMean = d3.mean(y);

    let num=0, den=0;
    for (let i=0;i<n;i++){num+=(x[i]-xMean)*(y[i]-yMean); den+=(x[i]-xMean)**2;}
    const slope = num/den, intercept = yMean-slope*xMean;
    const regLine = [{date:new Date(x[0]), anomaly:slope*x[0]+intercept},{date:new Date(x[n-1]), anomaly:slope*x[n-1]+intercept}];

    svg.append("path")
      .datum(regLine)
      .attr("fill","none")
      .attr("stroke","#ffcc00")
      .attr("stroke-width",2)
      .attr("stroke-dasharray","5,5")
      .attr("d", d3.line().x(d=>xTimeScale(d.date)).y(d=>yScale(d.anomaly)));

    // Bars
    svg.selectAll(".bar")
      .data(dataAll)
      .enter()
      .append("rect")
      .attr("class","bar")
      .attr("x", d=>xScale(d.date))
      .attr("width", xScale.bandwidth())
      .attr("y", yScale(0))
      .attr("height",0)
      .attr("fill", d=>d.anomaly>=0?"#e74c3c":"#3498db")
      .attr("opacity", 0.8)
      .transition().delay((d,i)=>i*20).duration(300)
      .attr("y", d=>d.anomaly>=0?yScale(d.anomaly):yScale(0))
      .attr("height", d=>Math.abs(yScale(d.anomaly)-yScale(0)));

    // Interaction overlay
    svg.append("rect")
      .attr("width", width).attr("height", height)
      .attr("fill", "none").attr("pointer-events","all")
      .on("mousemove", function(event){
        const [mx] = d3.pointer(event, svg.node());
        const x0 = xTimeScale.invert(mx);
        const bisect = d3.bisector(d=>d.date).left;
        const i = bisect(dataAll, x0);
        const d0 = dataAll[i-1], d1 = dataAll[i];
        let d = d0;
        if(d1&&d0&&(x0-d0.date>d1.date-x0)) d=d1;
        if(!d) return;

        svg.selectAll(".bar").attr("stroke","none").attr("opacity", 0.8);
        svg.selectAll(".bar").filter(b=>b===d).attr("stroke","#fff").attr("stroke-width",2).attr("opacity", 1);

        tooltip.style("opacity",1).html(`
          <strong>${d3.timeFormat("%Y-%m")(d.date)}</strong><br>
          Temp: ${d.tempK.toFixed(2)} K<br>
          Anomaly: ${d.anomaly>=0?'+':''}${d.anomaly.toFixed(2)} K
        `).style("left",(event.pageX+15)+"px").style("top",(event.pageY-25)+"px");
      })
      .on("mouseout",()=>{
        svg.selectAll(".bar").attr("stroke","none").attr("opacity", 0.8); 
        tooltip.style("opacity",0);
      });
  }

  await loadData();
}

// Initialize Alaska chart on page load
initialized.alaska = true;
createVisualization("#chart-alaska", "#loading-alaska", "alaska");