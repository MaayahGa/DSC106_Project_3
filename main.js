import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const initialized = { 
  alaska: false, us: false, hawaii: false, kansas: false, florida: false, ny: false, california: false, washington: false 
};

const regionState = {
  alaska: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  us: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  hawaii: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  kansas: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  florida: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  ny: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  california: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null },
  washington: { data: [], selectedMonth: 'all', selectedSeason: 'all', regression: null }
};

// Tab switching
window.switchTab = function(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const tabMap = {
    alaska: [1, 'alaska'],
    us: [2, 'us'],
    hawaii: [3, 'hawaii'],
    ny: [4, 'ny'],
    florida: [5, 'florida'],
    kansas: [6, 'kansas'],
    california: [7, 'california'],
    washington: [8, 'washington']
  };

  if(tabMap[tab]){
    const [index, id] = tabMap[tab];
    document.querySelector(`.tab:nth-child(${index})`).classList.add('active');
    document.getElementById(`${id}-content`).classList.add('active');

    if(!initialized[tab]){
      initialized[tab] = true;
      createVisualization(`#chart-${tab}`, `#loading-${tab}`, tab, `#filter-${tab}`);
    }
  }
};

// Tooltip
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

// Month & Season buttons
const monthNames = ["All Months","January","February","March","April","May","June","July","August","September","October","November","December"];
document.querySelectorAll('.month-buttons').forEach(div=>{
  monthNames.forEach((name,i)=>{
    const btn = document.createElement("button");
    btn.className="month-btn"; 
    btn.dataset.month=i===0?"all":i; 
    btn.textContent=name;
    if(i===0) btn.classList.add("active");
    div.appendChild(btn);
  });

  const seasonFilter = document.createElement("div");
  seasonFilter.className="season-filter";
  seasonFilter.innerHTML=`
    <div class="filter-label">Filter by Season</div>
    <div class="season-buttons"></div>
  `;
  div.parentElement.appendChild(seasonFilter);

  const seasons = [
    {name:"All Seasons 🌎", value:"all"},
    {name:"Winter ❄️", value:"winter"},
    {name:"Spring 🌸", value:"spring"},
    {name:"Summer ☀️", value:"summer"},
    {name:"Fall 🍂", value:"fall"}
  ];
  const seasonButtons = seasonFilter.querySelector(".season-buttons");
  seasons.forEach(s=>{
    const btn=document.createElement("button");
    btn.className="month-btn"; btn.dataset.season=s.value; btn.textContent=s.name;
    if(s.value==="all") btn.classList.add("active");
    seasonButtons.appendChild(btn);
  });
});

// Helper: apply month/season filters to a dataset
function applyFiltersToData(data, monthFilter, seasonFilter) {
  let filtered = data;
  if (monthFilter && monthFilter !== "all") {
    filtered = filtered.filter(d => d.date.getMonth() + 1 === +monthFilter);
  }
  if (seasonFilter && seasonFilter !== "all") {
    const seasonMonths = { winter: [12,1,2], spring: [3,4,5], summer: [6,7,8], fall: [9,10,11] };
    filtered = filtered.filter(d => seasonMonths[seasonFilter].includes(d.date.getMonth() + 1));
  }
  return filtered;
}

// Helper: compute linear regression line (returns two endpoints for given x-range)
function computeRegressionLine(dataForRegression, xRangeStartTime, xRangeEndTime) {
  if (!dataForRegression || dataForRegression.length < 2) return null;
  const xVals = dataForRegression.map(d => d.date.getTime());
  const yVals = dataForRegression.map(d => d.anomaly);
  const xMean = d3.mean(xVals), yMean = d3.mean(yVals);
  const num = d3.sum(xVals.map((xi, i) => (xi - xMean) * (yVals[i] - yMean)));
  const den = d3.sum(xVals.map(xi => (xi - xMean) ** 2));
  if (den === 0) return null;
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return [
    { date: new Date(xRangeStartTime), anomaly: slope * xRangeStartTime + intercept },
    { date: new Date(xRangeEndTime), anomaly: slope * xRangeEndTime + intercept }
  ];
};

// Create visualization
async function createVisualization(chartSelector, loadingSelector, region, filterSelector){
  const chartDiv = d3.select(chartSelector);
  const loadingDiv = d3.select(loadingSelector);
  const filterDiv = d3.select(filterSelector);
  const dataAll = [];

  const parseDate = str => { const [y,m] = str.split("-").map(Number); return new Date(y,m-1,1); };

  function filterByRegion(d){
    let lat = +d.lat;
    let lon = +d.lon; if(lon<0) lon+=360;
    switch(region){
      case "alaska": return lat>=51&&lat<=72&&lon>=190&&lon<=235;
      case "us": return lat>=25&&lat<=49&&lon>=235&&lon<=294;
      case "hawaii": return lat>=18&&lat<=23&&lon>=199&&lon<=207;
      case "kansas": return lat>=36&&lat<=40&&lon>=-102+360&&lon<=-94+360;
      case "florida": return lat>=24&&lat<=31&&lon>=-87+360&&lon<=-80+360;
      case "ny": return lat>=40&&lat<=45&&lon>=-80+360&&lon<=-73+360;
      case "california": return lat>=32&&lat<=42&&lon>=-125+360&&lon<=-114+360;
      case "washington": return lat>=46&&lat<=49&&lon>=-125+360&&lon<=-116+360;
    }
  }

  async function computeMonthlyBaseline(months){
    const monthlyTemps = Array.from({length:12},()=>[]);
    for(const m of months){
      try{
        const csvData = await d3.csv(`data/americas/${m}.csv`);
        const regionData = csvData.filter(filterByRegion);
        if(regionData.length){
          const avg = d3.mean(regionData,d=>+d.tas_k);
          monthlyTemps[parseInt(m.split("-")[1])-1].push(avg);
        }
      }catch(e){ console.warn("Missing:", m); }
    }
    return monthlyTemps.map(arr=>arr.length?d3.mean(arr):null);
  }

  async function loadData(){
    const months=[];
    for(let y=1987;y<=2014;y++) for(let m=1;m<=12;m++) months.push(`${y}-${String(m).padStart(2,"0")}`);
    const baseline=await computeMonthlyBaseline(months);

    for(const m of months){
      try{
        const csvData = await d3.csv(`data/americas/${m}.csv`);
        const regionData = csvData.filter(filterByRegion);
        if(!regionData.length) continue;
        const avg=d3.mean(regionData,d=>+d.tas_k);
        const monthIdx=parseInt(m.split("-")[1])-1;
        if(baseline[monthIdx]==null) continue;
        dataAll.push({ date:parseDate(m), anomaly:avg-baseline[monthIdx], tempK:avg });
      }catch(e){ console.warn("Failed:", m); }
    }

    if(!dataAll.length){ loadingDiv.text(`No data found for ${region}`); return; }

    regionState[region].data = dataAll;
    loadingDiv.style("display","none");
    setupFilters();
    drawChart();
  }

  function setupFilters(){
    filterDiv.selectAll(".month-btn[data-month]").on("click",function(){
      const selected=this.getAttribute("data-month");
      filterDiv.selectAll(".month-btn[data-month]").classed("active",false);
      d3.select(this).classed("active",true);
      regionState[region].selectedMonth=selected;
      drawChart();
    });

    filterDiv.selectAll(".month-btn[data-season]").on("click",function(){
      const selected=this.getAttribute("data-season");
      filterDiv.selectAll(".month-btn[data-season]").classed("active",false);
      d3.select(this).classed("active",true);
      regionState[region].selectedSeason=selected;
      drawChart();
    });
  }

  function getFilteredData(){
    const { selectedMonth, selectedSeason } = regionState[region];
    return applyFiltersToData(regionState[region].data, selectedMonth, selectedSeason);
  }

  function drawChart(){
    const data = getFilteredData();
    const margin={top:30,right:40,bottom:60,left:100};
    const w=chartDiv.node().clientWidth - margin.left - margin.right;
    const h=400 - margin.top - margin.bottom;
    chartDiv.html("");

    if (!data || data.length === 0) {
      chartDiv.append("div").attr("class","loading").text("No data for this filter combination.");
      return;
    }

    const svg=chartDiv.append("svg")
      .attr("width", w+margin.left+margin.right)
      .attr("height", h+margin.top+margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xTime = d3.scaleTime().range([0,w]).domain(d3.extent(data,d=>d.date));
    const y = d3.scaleLinear().range([h,0]).domain(d3.extent(data,d=>d.anomaly)).nice();
    const xBand = d3.scaleBand().domain(data.map(d=>d.date)).range([0,w]).padding(0.1);

    svg.append("g").attr("transform",`translate(0,${h})`).call(d3.axisBottom(xTime).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat("%Y")));
    svg.append("text").attr("x",w/2).attr("y",h+45).style("text-anchor","middle").text("Date");
    svg.append("g").call(d3.axisLeft(y).ticks(8).tickFormat(d=>`${d>0?'+':''}${d.toFixed(2)} K`));
    svg.append("text").attr("transform","rotate(-90)").attr("y",-margin.left+15).attr("x",-(h/2)).style("text-anchor","middle").text("Difference in Average Monthly Temperature (K)");
    svg.append("line").attr("x1",0).attr("x2",w).attr("y1",y(0)).attr("y2",y(0)).attr("stroke","#888").attr("stroke-dasharray","4,2");

    // Bars
    const bars = svg.selectAll(".bar").data(data).enter().append("rect")
      .attr("class","bar")
      .attr("x",d=>xBand(d.date))
      .attr("y",y(0))
      .attr("width",xBand.bandwidth())
      .attr("height",0)
      .attr("fill",d=>d.anomaly>=0?"#e74c3c":"#3498db");

    bars.transition().delay((d,i)=>i*5).duration(300)
        .attr("y",d=>d.anomaly>=0?y(d.anomaly):y(0))
        .attr("height",d=>Math.abs(y(d.anomaly)-y(0)))
        .on("end",(_,i)=>{ if(i===data.length-1) enableHover(); });

    // Regression for this region
    if(data.length>1){
      const xVals = data.map(d=>d.date.getTime());
      const yVals = data.map(d=>d.anomaly);
      const xMean = d3.mean(xVals), yMean = d3.mean(yVals);
      const slope = d3.sum(xVals.map((xi,i)=>(xi-xMean)*(yVals[i]-yMean))) / d3.sum(xVals.map(xi=>(xi-xMean)**2));
      const intercept = yMean - slope*xMean;
      const regLine = [
        {date:new Date(xVals[0]), anomaly:slope*xVals[0]+intercept},
        {date:new Date(xVals[xVals.length-1]), anomaly:slope*xVals[xVals.length-1]+intercept}
      ];
      regionState[region].regression = regLine;

      svg.append("path").datum(regLine)
        .attr("fill","none")
        .attr("stroke","#ffcc00")
        .attr("stroke-width",2)
        .attr("stroke-dasharray","5,5")
        .attr("d", d3.line().x(d=>xTime(d.date)).y(d=>y(d.anomaly)));

      // Region legend
      const regionLegend = svg.append("g").attr("class","legend").attr("transform",`translate(${w-170},10)`);
      regionLegend.append("line")
          .attr("x1",0).attr("y1",0).attr("x2",30).attr("y2",0)
          .attr("stroke","#ffcc00").attr("stroke-width",2).attr("stroke-dasharray","5,5");
      regionLegend.append("text")
          .attr("x",35).attr("y",5)
          .text(`${region.charAt(0).toUpperCase() + region.slice(1)} Regression (${regLine[1].anomaly.toFixed(2)} K)`)
          .style("font-size","12px").style("fill","#000")
          .attr("alignment-baseline","middle");
    }

    // Alaska regression overlay
    if(region !== "alaska" && regionState.alaska.data && regionState.alaska.data.length){
      const curMonth = regionState[region].selectedMonth;
      const curSeason = regionState[region].selectedSeason;
      const alaskaFiltered = applyFiltersToData(regionState.alaska.data, curMonth, curSeason);
      if (alaskaFiltered && alaskaFiltered.length > 1) {
        const alaskaRegLine = computeRegressionLine(alaskaFiltered, d3.min(data, d => d.date).getTime(), d3.max(data, d => d.date).getTime());
        if (alaskaRegLine) {
          svg.append("path").datum(alaskaRegLine)
            .attr("fill","none")
            .attr("stroke","#2ecc71")
            .attr("stroke-opacity", 0.65)
            .attr("stroke-width",2)
            .attr("stroke-dasharray","5,5")
            .attr("d", d3.line().x(d=>xTime(d.date)).y(d=>y(d.anomaly)));

          // Alaska legend
          const legend = svg.append("g").attr("class","legend").attr("transform",`translate(${w-170},30)`);
          legend.append("line")
                .attr("x1",0).attr("y1",0).attr("x2",30).attr("y2",0)
                .attr("stroke","#2ecc71").attr("stroke-width",2).attr("stroke-dasharray","5,5");
          legend.append("text")
                .attr("x",35).attr("y",5)
                .text(`Alaska Regression (${alaskaRegLine[1].anomaly.toFixed(2)} K)`)
                .style("font-size","12px").style("fill","#000")
                .attr("alignment-baseline","middle");
        }
      }
    }

    // Hover
    function enableHover(){
      svg.append("rect").attr("width",w).attr("height",h).attr("fill","none").attr("pointer-events","all")
        .on("mousemove",function(event){
          const [mx]=d3.pointer(event,this);
          const x0=xTime.invert(mx);
          const i=d3.bisector(d=>d.date).left(data,x0);
          const d=data[i-1] && data[i]? (x0-data[i-1].date>data[i].date-x0?data[i]:data[i-1]):data[i]||data[i-1];
          if(!d) return;

          svg.selectAll(".bar").attr("opacity",b=>b===d?1:0.6)
            .attr("transform",b=>b===d?`scale(1.25,1.25)`:"scale(1,1)")
            .attr("transform-origin",b=>`${xBand(b.date)+xBand.bandwidth()/2}px ${y(Math.max(0,b.anomaly))}px`);

          tooltip.style("opacity",1).html(`<strong>${d3.timeFormat("%Y-%m")(d.date)}</strong><br>Temp: ${d.tempK.toFixed(2)} K<br>Difference in Temperature: ${d.anomaly>=0?'+':''}${d.anomaly.toFixed(2)} K`)
            .style("left",`${event.pageX+15}px`).style("top",`${event.pageY}px`);
        }).on("mouseleave",function(){
          svg.selectAll(".bar").attr("opacity",1).attr("transform","scale(1,1)");
          tooltip.style("opacity",0);
        });
    }
  }

  loadData();
}
