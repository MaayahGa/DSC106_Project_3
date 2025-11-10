// Uses D3 v7 (loaded in index.html via ESM CDN)

// ---------- CONFIG ----------
const MANIFEST_URL = './data/manifest.json';     // same folder as this file
// Expected manifest entries look like: [{ "date": "1987-01-15T12:00:00Z", "path": "tas_1987-01.csv" }, ...]
// If your keys differ (e.g., "file" or "time"), the loader below handles common variants.

const TEMP_DOMAIN = [230, 310];             // Kelvin, fixed for consistent reading across months
const RATE_PALETTE = d3.interpolateSpectral; // Diverging for ± changes
const TEMP_PALETTE = d3.interpolateTurbo;    // Sequential for absolute temperature

// Canvas will be 1×1 pixel per grid cell; CSS scales it up
const canvas = document.querySelector('#heatmap');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
ctx.imageSmoothingEnabled = false;

// Controls
const selVar = document.querySelector('#variable');
const slider = document.querySelector('#time');
const outDate = document.querySelector('#time-label');

// Tooltip elements
const tt = document.querySelector('#tooltip');
const ttDate = document.querySelector('#tt-date');
const ttLat  = document.querySelector('#tt-lat');
const ttLon  = document.querySelector('#tt-lon');
const ttVal  = document.querySelector('#tt-val');

// Legend setup
const legendSvg = d3.select('#legend');
const legendCaption = document.getElementById('legend-caption');

// ---------- STATE ----------
const state = {
  variable: 'temp',   // 'temp' | 'rate'
  tIndex: 0,
  dates: [],          // Date[]
  entries: [],        // [{date: Date, url: string}]
  // grid metadata (from first slice)
  nLat: 0,
  nLon: 0,
  latsDesc: null,     // Float64Array (north→south)
  lonsAsc: null,      // Float64Array (west→east)
};

// Cache of loaded slices: index -> { values: Float32Array length nLat*nLon }
const cache = new Map();

// ---------- HELPERS ----------
function parseManifestEntry(obj) {
  const dateStr = obj.date ?? obj.time ?? obj.timestamp ?? obj.month;
  const url = obj.path ?? obj.file ?? obj.url;
  return { date: new Date(dateStr), url };
}

// Convert an array of CSV rows into a dense grid ordered [row=y, col=x] with:
// rows = lats (north→south), cols = lons (west→east)
function rowsToGrid(rows) {
  // Unique sorted coordinates
  const lats = Array.from(new Set(rows.map(r => +r.lat))).sort((a, b) => b - a); // DESC for north→south
  const lons = Array.from(new Set(rows.map(r => +r.lon))).sort((a, b) => a - b); // ASC  for west→east
  const nLat = lats.length, nLon = lons.length;

  const latIndex = new Map(lats.map((v, i) => [v, i]));
  const lonIndex = new Map(lons.map((v, i) => [v, i]));

  const values = new Float32Array(nLat * nLon);
  values.fill(NaN);

  for (const r of rows) {
    const i = latIndex.get(+r.lat);
    const j = lonIndex.get(+r.lon);
    if (i == null || j == null) continue;
    const v = (r.tas ?? r.temp ?? r.temperature ?? r.value);
    values[i * nLon + j] = +v;
  }

  return { nLat, nLon, latsDesc: new Float64Array(lats), lonsAsc: new Float64Array(lons), values };
}

async function loadSlice(index) {
  if (cache.has(index)) return cache.get(index);

  const entry = state.entries[index];
  if (!entry) throw new Error(`No manifest entry for t=${index}`);
  const rows = await d3.csv(entry.url, d => ({
    lat: +d.lat,
    lon: +d.lon,
    tas: +d.tas ?? +d.temp ?? +d.temperature ?? +d.value
  }));

  let grid = rowsToGrid(rows);

  // Initialize canvas/grid metadata from first slice
  if (state.nLat === 0) {
    state.nLat = grid.nLat;
    state.nLon = grid.nLon;
    state.latsDesc = grid.latsDesc;
    state.lonsAsc = grid.lonsAsc;

    // 1px per cell for crisp scaling
    canvas.width = state.nLon;
    canvas.height = state.nLat;
  }

  cache.set(index, grid);
  return grid;
}

// Compute month-over-month ΔK; requires current & previous slices
async function loadDeltaSlice(index) {
  if (index <= 0) return { values: null }; // no delta for first month
  const cur = await loadSlice(index);
  const prev = await loadSlice(index - 1);

  const out = new Float32Array(cur.values.length);
  for (let k = 0; k < out.length; k++) {
    const a = cur.values[k], b = prev.values[k];
    out[k] = (Number.isFinite(a) && Number.isFinite(b)) ? (a - b) : NaN;
  }
  return { values: out };
}

// Convert numeric value to RGBA (0..255) from a given d3 color scale
function rgbaFromScale(scale, v) {
  const c = d3.color(scale(v)) || { r: 0, g: 0, b: 0, opacity: 0 };
  return [c.r, c.g, c.b, Math.round((c.opacity ?? 1) * 255)];
}

// Draw a dense grid (Float32Array) into the canvas (1 cell → 1 pixel)
function drawGrid(values, colorScale) {
  const { nLat, nLon } = state;
  const img = ctx.createImageData(nLon, nLat);
  const data = img.data;

  // Fill from north→south rows; canvas y=0 is top row (north), so direct mapping
  let p = 0;
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const v = values[i * nLon + j];
      const [r, g, b, a] = Number.isFinite(v) ? rgbaFromScale(colorScale, v) : [0, 0, 0, 0];
      data[p++] = r; data[p++] = g; data[p++] = b; data[p++] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Build or update the legend (gradient, axis, and pointer)
function renderLegend(scale, captionText) {
  legendCaption.textContent = captionText;

  const svg = legendSvg;
  svg.selectAll('*').remove();

  // Gradient
  const defs = svg.append('defs');
  const lg = defs.append('linearGradient').attr('id', 'lg').attr('x1', '0%').attr('x2', '100%');
  // 12 stops for smoothness
  d3.range(0, 1.0001, 1/11).forEach(t => {
    lg.append('stop')
      .attr('offset', (t*100).toFixed(1) + '%')
      .attr('stop-color', scale(scale.domain()[0] + t * (scale.domain()[1] - scale.domain()[0])));
  });

  // Bar
  const margin = { left: 14, right: 14, top: 10, bottom: 18 };
  const W = 360, H = 50, barH = 12;
  const innerW = W - margin.left - margin.right;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  g.append('rect').attr('class', 'bar').attr('x', 0).attr('y', 0).attr('width', innerW).attr('height', barH);

  // Axis
  const xScale = d3.scaleLinear().domain(scale.domain()).range([0, innerW]);
  const axis = d3.axisBottom(xScale).ticks(6);
  g.append('g').attr('class', 'axis').attr('transform', `translate(0, ${barH})`).call(axis);

  // Pointer (vertical line + small triangle)
  const pointer = g.append('g').attr('class', 'pointer');
  pointer.append('line').attr('y1', -3).attr('y2', barH + 14);
  pointer.append('path').attr('class', 'tri').attr('d', 'M0,-6 l5,6 h-10 z');

  // Store for updates
  svg.node().__legend = { g, pointer, xScale, innerW, barH, margin };
}

function updateLegendPointer(value) {
  const ref = legendSvg.node().__legend;
  if (!ref || !Number.isFinite(value)) return;
  const x = ref.xScale(value);
  ref.pointer.attr('transform', `translate(${x},0)`);
}

// Map mouse to nearest cell index and return {i, j, val, lat, lon}
function pickCellFromMouse(evt, values) {
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;

  // CSS pixels → canvas pixels
  const cx = x * (canvas.width  / rect.width);
  const cy = y * (canvas.height / rect.height);

  const j = Math.max(0, Math.min(state.nLon - 1, Math.floor(cx)));
  const i = Math.max(0, Math.min(state.nLat - 1, Math.floor(cy)));

  const idx = i * state.nLon + j;
  const val = values[idx];
  const lat = state.latsDesc[i];
  const lon = state.lonsAsc[j];
  return { i, j, val, lat, lon };
}

function showTooltip(evt, date, cell) {
  if (!cell || !Number.isFinite(cell.val)) { tt.hidden = true; return; }
  tt.hidden = false;
  const rect = canvas.getBoundingClientRect();
  tt.style.left = `${evt.clientX - rect.left + 10}px`;
  tt.style.top  = `${evt.clientY - rect.top  + 10}px`;
  ttDate.textContent = date.toISOString().slice(0, 10);
  ttLat.textContent  = cell.lat.toFixed(2);
  ttLon.textContent  = cell.lon.toFixed(2);
  ttVal.textContent  = (state.variable === 'temp' ? cell.val.toFixed(2) + ' K'
                                                  : (cell.val >= 0 ? '+' : '') + cell.val.toFixed(3) + ' K/mo');
}

// ---------- RENDER ----------
async function render() {
  const t = state.tIndex;
  const date = state.dates[t];

  // Select variable + get color scale
  let values, colorScale, caption;
  if (state.variable === 'temp') {
    const grid = await loadSlice(t);
    values = grid.values;
    const scale = d3.scaleSequential(TEMP_PALETTE).domain(TEMP_DOMAIN);
    colorScale = v => scale(v);
    caption = 'Temperature (K)';
  } else {
    const delta = await loadDeltaSlice(t);
    if (!delta.values) {
      // No delta for first time step: clear canvas and bail
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      outDate.textContent = date.toISOString().slice(0, 10) + ' — Δ unavailable for first month';
      legendSvg.selectAll('*').remove();
      tt.hidden = true;
      return;
    }
    values = delta.values;
    // Symmetric domain around 0 for the current month
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
    const m = Math.max(Math.abs(min), Math.abs(max)) || 1;
    const scale = d3.scaleSequential(RATE_PALETTE).domain([+m, -m]); // invert so reds = positive (warming)
    colorScale = v => scale(v);
    caption = 'Rate of change (ΔK / month)';
  }

  // Draw heatmap
  drawGrid(values, colorScale);

  // Update date label
  outDate.textContent = date.toISOString().slice(0, 10);

  // Legend (build once per variable change; update pointer on hover)
  renderLegend(
    d3.scaleLinear()
      .domain(state.variable === 'temp' ? TEMP_DOMAIN
                                        : (() => {
                                            // Use the same symmetric domain as draw (approximate from the image by sampling)
                                            // Here we estimate by re-reading min/max quickly:
                                            let min = Infinity, max = -Infinity;
                                            for (const v of values) { if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
                                            const m = Math.max(Math.abs(min), Math.abs(max)) || 1;
                                            return [-m, m];
                                          })()
      )
      .range([0, 1]) // only used to create gradient stops; true pixel range is set in renderLegend
      .interpolate(() => t => (state.variable === 'temp' ? TEMP_PALETTE(t) : RATE_PALETTE(t))),
    caption
  );

  // Hover events (rebound each render to ensure we use current values)
  canvas.onmousemove = (evt) => {
    const cell = pickCellFromMouse(evt, values);
    showTooltip(evt, date, cell);
    updateLegendPointer(cell.val);
  };
  canvas.onmouseleave = () => { tt.hidden = true; };
}

// ---------- INIT ----------
async function init() {
  // Load manifest
  const manifestRaw = await d3.json(MANIFEST_URL);
  const entries = (Array.isArray(manifestRaw.files) ? manifestRaw.files : manifestRaw)
    .map(parseManifestEntry)
    .filter(d => d.date && d.url)
    .sort((a, b) => a.date - b.date);

  state.entries = entries;
  state.dates = entries.map(d => d.date);

  // Slider bounds
  slider.min = 0;
  slider.max = Math.max(0, entries.length - 1);
  slider.value = 0;
  outDate.textContent = state.dates[0]?.toISOString().slice(0, 10) ?? '—';

  // Variable dropdown
  selVar.addEventListener('change', async (e) => {
    state.variable = e.target.value;
    // If rate is selected at index 0, jump to 1 so delta is defined
    if (state.variable === 'rate' && state.tIndex === 0 && state.dates.length > 1) {
      state.tIndex = 1;
      slider.value = 1;
    }
    await render();
  });

  // Slider input
  slider.addEventListener('input', async (e) => {
    state.tIndex = +e.target.value;
    await render();
    // Prefetch neighbor for snappier scrubbing
    const next = state.tIndex + 1; if (next < state.dates.length) loadSlice(next);
  });

  // Load first slice and draw
  await loadSlice(0);
  await render();
}

init().catch(err => {
  console.error(err);
  outDate.textContent = 'Error loading data. See console.';
});
