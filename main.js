// main.js — CMIP6 heatmap for the Americas (D3-only)
// Fixes included:
// - Canvas element now matched (id="heatmap-canvas")
// - Manifest: supports `time` array (your exporter) and several file layouts
// - File resolver: falls back to data/<region>/<YYYY-MM>.csv
// - CSV parsing: reads tas_k (Kelvin → °C) safely (won't pick lat by mistake)

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// ---------- DOM refs ----------
const els = {
  metricTemp: document.querySelector('#metric-temp'),
  metricRate: document.querySelector('#metric-roc'),
  btnBack:    document.querySelector('#btn-back'),
  btnPlay:    document.querySelector('#btn-play'),
  btnFwd:     document.querySelector('#btn-fwd'),
  slider:     document.querySelector('#time-slider'),
  timeLabel:  document.querySelector('#time-label'),
  regionSel:  document.querySelector('#region-select'),
  subregionSel: document.querySelector('#subregion-select'),

  canvas:     document.querySelector('#heatmap-canvas'),
  legendSvg:  document.querySelector('#legend'),
  legendMin:  document.querySelector('#legend-min'),
  legendMax:  document.querySelector('#legend-max'),

  readLat:    document.querySelector('#readout-lat'),
  readLon:    document.querySelector('#readout-lon'),
  readVal:    document.querySelector('#readout-value'),
  readValLabel: document.querySelector('#readout-value-label'),

  tooltip:    document.querySelector('#tooltip'),
  ttDate:     document.querySelector('#tt-date'),
  ttLL:       document.querySelector('#tt-ll'),
  ttVal:      document.querySelector('#tt-value'),
  ttLabel:    document.querySelector('#tt-label'),

  statRes:    document.querySelector('#stat-res'),
  statRange:  document.querySelector('#stat-range'),
  statCells:  document.querySelector('#stat-cells'),
};

if (!els.canvas) {
  throw new Error('Canvas #heatmap-canvas not found. Make sure you applied the HTML patch.');
}
const ctx = els.canvas.getContext('2d', { alpha: false });

// ---------- Global state ----------
const STATE = {
  region: 'americas',
  months: [],
  tIndex: 0,
  metric: 'temperature',    // 'temperature' | 'rate'
  playing: false,
  playTimer: null,

  lats: [], lons: [],
  latIdx: new Map(), lonIdx: new Map(),
  cellW: 1, cellH: 1,

  // Color scales in °C
  colorTemp: d3.scaleSequential().interpolator(d3.interpolateRdYlBu).domain([35, -25]),
  colorRate: d3.scaleDiverging().interpolator(d3.interpolatePuOr).domain([-1.5, 0, 1.5]),

  cache: new Map(),
  manifest: null,
};

// ---------- Utils ----------
const fmt = {
  dateLabel: (ym) => ym,
  value: (v) => Number.isFinite(v) ? d3.format(".2f")(v) : '—',
  ll: (lat, lon) => `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
};
const keyLL = (lat, lon) => `${lat}|${lon}`;

function KtoC(v){ return Number.isFinite(v) ? (v > 150 ? v - 273.15 : v) : NaN; }

// ---------- Manifest & files ----------
async function loadManifest(){
  const resp = await fetch('data/manifest.json');
  const manifest = await resp.json();
  STATE.manifest = manifest;
  STATE.region = manifest.region ?? STATE.region;

  // Accept several shapes; your exporter uses `time`
  let months = [];
  if (Array.isArray(manifest.time)) months = manifest.time.slice();
  else if (Array.isArray(manifest.months)) months = manifest.months.slice();
  else if (Array.isArray(manifest.files)) months = manifest.files.map(d => d.date || d.month);
  else if (manifest.files && typeof manifest.files === 'object') months = Object.keys(manifest.files);

  months = months.filter(Boolean).sort(d3.ascending);
  if (!months.length) throw new Error('No months found in manifest.');

  STATE.months = months;

  // slider & label
  els.slider.min = 0;
  els.slider.max = months.length - 1;
  els.slider.step = 1;
  els.slider.value = 0;
  els.timeLabel.value = fmt.dateLabel(months[0]);

  if (els.statRange) els.statRange.textContent = `${months[0]} → ${months[months.length - 1]}`;
}

function fileFor(ym){
  const m = STATE.manifest;
  if (!m) return null;

  // Explicit maps / arrays
  if (Array.isArray(m.files)){
    const rec = m.files.find(d => (d.date || d.month) === ym);
    if (rec) return rec.path || rec.file;
  }
  if (m.files && typeof m.files === 'object' && !Array.isArray(m.files)){
    if (m.files[ym]) return m.files[ym];
  }
  if (m.pattern){
    const YYYY = ym.slice(0,4), MM = ym.slice(5,7);
    const dir = m.path ?? `data/${STATE.region}`;
    return `${dir}/${m.pattern.replace('{YYYY}', YYYY).replace('{MM}', MM)}`;
  }
  // Fallback to your exporter layout: data/<region>/<YYYY-MM>.csv
  const dir = m.path ?? `data/${STATE.region}`;
  return `${dir}/${ym}.csv`;
}

// ---------- Data loading ----------
async function loadSlice(ym){
  if (STATE.cache.has(ym)) return STATE.cache.get(ym);

  const path = fileFor(ym);
  const rows = await d3.csv(path, (r) => {
    // robust numeric parse
    const lat = +r.lat ?? +r.latitude ?? +r.Lat ?? +r.y;
    const lon = +r.lon ?? +r.longitude ?? +r.Lon ?? +r.x;

    // prefer tas_k (Kelvin); fall back to tas/temp/temperature; never pick lat/lon
    let vK = (r.tas_k !== undefined) ? +r.tas_k :
             (r.tas   !== undefined) ? +r.tas   :
             (r.temp  !== undefined) ? +r.temp  :
             (r.temperature !== undefined) ? +r.temperature : NaN;

    const vC = KtoC(vK);
    return { lat, lon, vC };
  });

  const map = new Map();
  let min = +Infinity, max = -Infinity;
  for (const d of rows){
    map.set(keyLL(d.lat, d.lon), d.vC);
    if (Number.isFinite(d.vC)){
      if (d.vC < min) min = d.vC;
      if (d.vC > max) max = d.vC;
    }
  }

  const slice = { rows, map, min, max };
  STATE.cache.set(ym, slice);
  return slice;
}

// ---------- Grid & sizing ----------
function ensureGridGeometry(slice){
  if (STATE.lats.length && STATE.lons.length) return;

  const lats = Array.from(new Set(slice.rows.map(d => d.lat))).sort(d3.descending);
  const lons = Array.from(new Set(slice.rows.map(d => d.lon))).sort(d3.ascending);
  STATE.lats = lats; STATE.lons = lons;
  STATE.latIdx = new Map(lats.map((v,i)=>[v,i]));
  STATE.lonIdx = new Map(lons.map((v,i)=>[v,i]));

  const dLat = d3.median(d3.pairs(lats).map(([a,b]) => Math.abs(a-b))) ?? 0;
  const dLon = d3.median(d3.pairs(lons).map(([a,b]) => Math.abs(a-b))) ?? 0;
  if (els.statRes) els.statRes.textContent = `${dLon.toFixed(2)}° lon × ${dLat.toFixed(2)}° lat`;

  sizeCanvasToContainer();
}

function sizeCanvasToContainer(){
  const container = els.canvas.parentElement;
  const wCss = container.clientWidth || 900;
  const ratio = (STATE.lats.length || 1) / (STATE.lons.length || 1);
  const hCss = Math.max(200, Math.round(wCss * ratio));

  els.canvas.width  = Math.min(2000, Math.max(300, Math.round(wCss)));
  els.canvas.height = Math.min(2000, hCss);

  STATE.cellW = els.canvas.width  / (STATE.lons.length || 1);
  STATE.cellH = els.canvas.height / (STATE.lats.length || 1);
}

// ---------- Legend ----------
function currentMetricScale(){
  return STATE.metric === 'rate' ? STATE.colorRate : STATE.colorTemp;
}

function updateLegend(){
  const svg = d3.select(els.legendSvg);
  const w = 420, h = 60;
  svg.attr('viewBox', `0 0 ${w} ${h}`).selectAll('*').remove();

  const scale = currentMetricScale();
  const [d0, d1] = [scale.domain()[0], scale.domain().slice(-1)[0]];

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'legend-grad')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');

  const stops = d3.range(0, 1.0001, 0.1);
  grad.selectAll('stop')
    .data(stops)
    .enter().append('stop')
      .attr('offset', d => `${d*100}%`)
      .attr('stop-color', d => scale(d0 + d*(d1 - d0)));

  svg.append('rect')
    .attr('x', 10).attr('y', 20).attr('width', w-20).attr('height', 14)
    .attr('fill', 'url(#legend-grad)')
    .attr('stroke', 'currentColor').attr('stroke-opacity', 0.2);

  const axisScale = d3.scaleLinear().domain([d0, d1]).range([10, w-10]);
  const axis = d3.axisBottom(axisScale).ticks(6);
  svg.append('g').attr('transform', `translate(0, ${34})`).call(axis)
     .call(g => g.selectAll('text').style('font-size','10px'));

  if (els.legendMin) els.legendMin.textContent = d3.format(".1f")(Math.min(d0,d1));
  if (els.legendMax) els.legendMax.textContent = d3.format(".1f")(Math.max(d0,d1));
}

function moveLegendPointer(value){
  const svg = d3.select(els.legendSvg);
  const line = svg.select('#legend-pointer');
  if (!line.node() || !Number.isFinite(value)) return;
  const scale = currentMetricScale();
  const [d0, d1] = [scale.domain()[0], scale.domain().slice(-1)[0]];
  const x = d3.scaleLinear().domain([d0, d1]).range([10, 420-10])(value);
  line.attr('x1', x).attr('x2', x);
}

// ---------- Rendering ----------
function renderSlice(slice, prevSlice=null){
  if (STATE.metric === 'temperature'){
    // dynamic temperature domain with reasonable clamp
    const pad = 2;
    const lo = Math.max(-60, Math.floor(slice.min - pad));
    const hi = Math.min( 60, Math.ceil (slice.max + pad));
    STATE.colorTemp.domain([hi, lo]); // reversed so red=warm
  }
  updateLegend();

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  const scale = currentMetricScale();

  for (const r of slice.rows){
    const ri = STATE.latIdx.get(r.lat);
    const ci = STATE.lonIdx.get(r.lon);
    if (ri == null || ci == null) continue;

    let v = r.vC;
    if (STATE.metric === 'rate' && prevSlice){
      const prev = prevSlice.map.get(keyLL(r.lat, r.lon));
      v = (Number.isFinite(v) && Number.isFinite(prev)) ? (v - prev) : NaN;
    }

    ctx.fillStyle = Number.isFinite(v) ? scale(v) : '#000';
    ctx.fillRect(
      Math.round(ci * STATE.cellW),
      Math.round(ri * STATE.cellH),
      Math.ceil(STATE.cellW),
      Math.ceil(STATE.cellH)
    );
  }
  if (els.statCells) els.statCells.textContent = slice.rows.length.toLocaleString();
}

// ---------- Hover / tooltip ----------
function handleMouseMove(evt){
  if (!STATE.lats.length || !STATE.lons.length) return;
  const rect = els.canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (els.canvas.width / rect.width);
  const y = (evt.clientY - rect.top)  * (els.canvas.height / rect.height);

  const col = Math.max(0, Math.min(STATE.lons.length - 1, Math.floor(x / STATE.cellW)));
  const row = Math.max(0, Math.min(STATE.lats.length - 1, Math.floor(y / STATE.cellH)));

  const lat = STATE.lats[row];
  const lon = STATE.lons[col];

  const date = STATE.months[STATE.tIndex];
  const slice = STATE.cache.get(date);
  const prev = STATE.cache.get(STATE.months[STATE.tIndex - 1]);

  const vNow = slice?.map.get(keyLL(lat, lon));
  const v = (STATE.metric === 'rate' && prev)
    ? (Number.isFinite(vNow) && Number.isFinite(prev.map.get(keyLL(lat, lon))) ? vNow - prev.map.get(keyLL(lat, lon)) : NaN)
    : vNow;

  if (els.readLon) els.readLon.textContent = lon?.toFixed(1) ?? '—';
  if (els.readLat) els.readLat.textContent = lat?.toFixed(1) ?? '—';
  if (els.readVal) els.readVal.textContent = fmt.value(v);

  moveLegendPointer(v);

  if (els.tooltip){
    els.ttDate && (els.ttDate.textContent = date ?? '—');
    els.ttLL && (els.ttLL.textContent = fmt.ll(lat, lon));
    els.ttVal && (els.ttVal.textContent = fmt.value(v));
    els.ttLabel && (els.ttLabel.textContent = STATE.metric === 'rate' ? 'Δ Temp' : 'Temp');
    const pad = 12;
    els.tooltip.style.left = `${evt.clientX + pad}px`;
    els.tooltip.style.top  = `${evt.clientY + pad}px`;
    els.tooltip.hidden = false;
  }
}
function handleMouseLeave(){ if (els.tooltip) els.tooltip.hidden = true; }

// ---------- Time / controls ----------
function setMetric(next){
  if (STATE.metric === next) return;
  STATE.metric = next;
  els.readValLabel && (els.readValLabel.textContent = next === 'rate' ? 'Δ Temp' : 'Temp');
  drawCurrent();
}
function step(delta){
  const next = Math.max(0, Math.min(STATE.months.length - 1, STATE.tIndex + delta));
  if (next !== STATE.tIndex){
    STATE.tIndex = next;
    els.slider.value = next;
    els.timeLabel.value = fmt.dateLabel(STATE.months[next] ?? '—');
    drawCurrent();
  }
}
function togglePlay(){
  STATE.playing = !STATE.playing;
  els.btnPlay.textContent = STATE.playing ? '❚❚' : '►';
  if (STATE.playing){
    STATE.playTimer = setInterval(() => {
      if (STATE.tIndex >= STATE.months.length - 1) togglePlay(); else step(1);
    }, 600);
  } else {
    clearInterval(STATE.playTimer);
  }
}
async function drawCurrent(){
  const ym = STATE.months[STATE.tIndex];
  if (!ym) return;
  const slice = await loadSlice(ym);
  ensureGridGeometry(slice);
  let prev = null;
  if (STATE.metric === 'rate' && STATE.tIndex > 0){
    prev = await loadSlice(STATE.months[STATE.tIndex - 1]);
  }
  renderSlice(slice, prev);
}

// ---------- Events ----------
function wireEvents(){
  els.metricTemp?.addEventListener('change', () => setMetric('temperature'));
  els.metricRate?.addEventListener('change', () => setMetric('rate'));
  els.btnBack?.addEventListener('click', () => step(-1));
  els.btnFwd?.addEventListener('click',  () => step(1));
  els.btnPlay?.addEventListener('click', togglePlay);
  els.slider?.addEventListener('input', (e) => {
    STATE.tIndex = +e.target.value;
    els.timeLabel.value = fmt.dateLabel(STATE.months[STATE.tIndex] ?? '—');
    drawCurrent();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  els.canvas.addEventListener('mousemove', handleMouseMove);
  els.canvas.addEventListener('mouseleave', handleMouseLeave);

  let t=null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!STATE.lats.length) return;
      sizeCanvasToContainer();
      drawCurrent();
    }, 120);
  });
}

// ---------- Bootstrap ----------
(async function init(){
  wireEvents();
  await loadManifest();

  // first frame
  const first = await loadSlice(STATE.months[0]);
  ensureGridGeometry(first);
  updateLegend();
  await drawCurrent();
})();
