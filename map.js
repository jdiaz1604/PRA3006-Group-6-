const QLEVER = 'https://qlever.dev/api/wikidata';
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };
const worldUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const fmtInt = d3.format(',d');
const fmtMoney = d3.format('~s');

const $loading = document.getElementById('loading');
const $tooltip = document.getElementById('tooltip');
const panelModeEl = document.getElementById('panelMode');
const dataContextEl = document.getElementById('dataContext');
const backBtn = document.getElementById('backToWorld');
const startBtn = document.getElementById('startExploring');

let endemicTable = null;
let gdpTable = null;
let populationTable = null;
let preloadError = null;

let worldTopo = null;
let countries = [];
let continents = [];
const continentByCountryId = new Map();
const countriesByContinent = new Map();

const state = {
  continentName: null,
  countryId: null
};

let projection = null;
let path = null;
let rootLayer = null;
let sphereLayer = null;
let continentLayer = null;
let countryLayer = null;
let borderLayer = null;
let zoomBehavior = null;
let currentTransform = d3.zoomIdentity;
let resizeTimer = null;
let inFlight = false;

const svg = d3.select('.map');
const mapWrap = document.querySelector('.map-wrap');

function setupButtons() {
  startBtn?.addEventListener('click', () => {
    document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
  });
  backBtn?.addEventListener('click', () => { resetToContinents(); });
}

function resize() {
  const w = mapWrap.clientWidth || 800;
  const h = Math.max(460, window.innerHeight - 220);
  return { w, h };
}

async function loadGeoData() {
  worldTopo = await d3.json(worldUrl);
  countries = topojson.feature(worldTopo, worldTopo.objects.countries).features;
  assignContinents();
}

const NAME_OVERRIDES = new Map([
  // Europe/Asia junctions
  ['Türkiye', 'Europe'],
  ['Turkey', 'Europe'],
  ['Cyprus', 'Europe'],
  ['Georgia', 'Europe'],
  ['Kazakhstan', 'Asia'],
  ['Azerbaijan', 'Asia'],
  ['Armenia', 'Asia'],

  // Africa exceptions
  ['Egypt', 'Africa'],
  ['Madagascar', 'Africa'],
  ['Cabo Verde', 'Africa'],
  ['Seychelles', 'Africa'],
  ['Mauritius', 'Africa'],

  // Americas (Caribbean + Central)
  ['Greenland', 'North America'],
  ['Mexico', 'North America'],
  ['Guatemala', 'North America'],
  ['Belize', 'North America'],
  ['El Salvador', 'North America'],
  ['Honduras', 'North America'],
  ['Nicaragua', 'North America'],
  ['Costa Rica', 'North America'],
  ['Panama', 'North America'],
  ['Cuba', 'North America'],
  ['Jamaica', 'North America'],
  ['Haiti', 'North America'],
  ['Dominican Republic', 'North America'],
  ['Bahamas', 'North America'],
  ['The Bahamas', 'North America'],
  ['Barbados', 'North America'],
  ['Trinidad and Tobago', 'North America'],
  ['Grenada', 'North America'],
  ['Saint Lucia', 'North America'],
  ['Saint Vincent and the Grenadines', 'North America'],
  ['Dominica', 'North America'],
  ['Antigua and Barbuda', 'North America'],
  ['Saint Kitts and Nevis', 'North America'],
  ['Puerto Rico', 'North America'],

  // Middle East / Arabian Peninsula
  ['Saudi Arabia', 'Asia'],
  ['United Arab Emirates', 'Asia'],
  ['Oman', 'Asia'],
  ['Yemen', 'Asia'],
  ['Qatar', 'Asia'],
  ['Bahrain', 'Asia'],
  ['Kuwait', 'Asia'],
  ['Israel', 'Asia'],
  ['Lebanon', 'Asia'],
  ['Jordan', 'Asia'],
  ['State of Palestine', 'Asia'],

  // Oceania islands
  ['Papua New Guinea', 'Oceania'],
  ['New Caledonia', 'Oceania'],
  ['New Zealand', 'Oceania'],
  ['Fiji', 'Oceania'],
  ['Solomon Islands', 'Oceania'],
  ['Vanuatu', 'Oceania'],
  ['Samoa', 'Oceania'],
  ['Tonga', 'Oceania'],
  ['Kiribati', 'Oceania'],
  ['Micronesia', 'Oceania'],
  ['Palau', 'Oceania'],
  ['Marshall Islands', 'Oceania'],
  ['Nauru', 'Oceania'],
  ['Tuvalu', 'Oceania'],

  // South / Southeast Asia islands
  ['Timor-Leste', 'Asia'],
  ['Indonesia', 'Asia'],
  ['Philippines', 'Asia'],
  ['Japan', 'Asia'],
  ['Sri Lanka', 'Asia'],

  // Polar territories
  ['French Southern Territories', 'Antarctica']
]);
// Add these helper functions for biome coloring
function getCountryISO3(country) {
  const countryName = country.properties?.name;
  const isoMap = {
    'Russia': 'RUS', 'United States': 'USA', 'Canada': 'CAN', 'China': 'CHN', 'Australia': 'AUS',
    'Brazil': 'BRA', 'India': 'IND', 'Argentina': 'ARG', 'Saudi Arabia': 'SAU', 'Egypt': 'EGY',
    'South Africa': 'ZAF', 'France': 'FRA', 'Germany': 'DEU', 'United Kingdom': 'GBR', 'Japan': 'JPN',
    'Mexico': 'MEX', 'Greenland': 'GRL', 'Antarctica': 'ATA', 'Libya': 'LBY', 'Algeria': 'DZA',
    'Colombia': 'COL', 'Indonesia': 'IDN', 'Malaysia': 'MYS', 'Norway': 'NOR', 'Sweden': 'SWE',
    'Finland': 'FIN', 'Iceland': 'ISL', 'Nepal': 'NPL', 'Bhutan': 'BTN', 'Switzerland': 'CHE',
    'Austria': 'AUT', 'Spain': 'ESP', 'Italy': 'ITA', 'Greece': 'GRC', 'Turkey': 'TUR',
    'Portugal': 'PRT', 'Kenya': 'KEN', 'Tanzania': 'TZA', 'Nigeria': 'NGA', 'Ethiopia': 'ETH'
  };
  return isoMap[countryName] || '';
}

function getCountryBiome(country) {
  const countryName = country.properties?.name;
  
  // TUNDRA COUNTRIES - Force them to be visible
  const tundraCountries = ['Russia', 'Canada', 'Norway', 'Sweden', 'Finland', 'Iceland'];
  if (tundraCountries.includes(countryName)) {
    console.log(`Tundra country found: ${countryName}`);
    return 'tundra';
  }
  
  // For now, return forest for everything else
  return 'forest';
}
function assignContinents() {
  continentByCountryId.clear();
  countriesByContinent.clear();
  const buckets = new Map();
  const geometries = worldTopo?.objects?.countries?.geometries || [];
  countries.forEach((feature, index) => {
    const continent = inferContinent(feature) || 'Unassigned';
    feature.properties = feature.properties || {};
    feature.properties.continent = continent;
    continentByCountryId.set(feature.id, continent);
    if (continent === 'Unassigned') return;
    if (!countriesByContinent.has(continent)) countriesByContinent.set(continent, []);
    countriesByContinent.get(continent).push(feature);
    if (!buckets.has(continent)) buckets.set(continent, []);
    const geom = geometries[index];
    if (geom) buckets.get(continent).push(geom);
  });

  continents = Array.from(buckets.entries())
    .filter(([name]) => name && name !== 'Unassigned')
    .map(([name, geoms]) => ({
      type: 'Feature',
      properties: { name },
      geometry: topojson.merge(worldTopo, geoms)
    }));
}

function inferContinent(feature) {
  const name = feature?.properties?.name;
  if (NAME_OVERRIDES.has(name)) return NAME_OVERRIDES.get(name);
  const [lon, lat] = d3.geoCentroid(feature);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Unassigned';
  if (lat <= -50) return 'Antarctica';
  if (lon < -30) {
    return lat >= 15 ? 'North America' : 'South America';
  }
  if (lon >= -25 && lon <= 60 && lat >= 35) return 'Europe';
  if (lon >= -20 && lon <= 52 && lat < 35 && lat > -40 && !(lon > 40 && lat > 20)) return 'Africa';
  if ((lon >= 110 && lat <= -10) || lon >= 150) return 'Oceania';
  if (lon >= 95 && lat <= -15) return 'Oceania';
  if (lon >= 25) return 'Asia';
  if (lat >= 0) return 'Europe';
  return 'Africa';
}

function initMapLayers() {
  svg.selectAll('*').remove();
  rootLayer = svg.append('g').attr('class', 'map-root');
  sphereLayer = rootLayer.append('path').attr('class', 'sphere');
  continentLayer = rootLayer.append('g').attr('class', 'continents-layer');
  countryLayer = rootLayer.append('g').attr('class', 'countries-layer');
  borderLayer = rootLayer.append('path').attr('fill', 'none').attr('stroke', '#0f1738').attr('stroke-width', 0.6);
  zoomBehavior = d3.zoom().scaleExtent([1, 8]).on('zoom', (event) => {
    currentTransform = event.transform;
    rootLayer.attr('transform', currentTransform);
  });
  svg.call(zoomBehavior);
}

function renderMap() {
  if (!countries.length || !continents.length) return;
  const { w, h } = resize();
  svg.attr('width', w).attr('height', h);
  projection = d3.geoMercator().fitExtent([[10, 10], [w - 10, h - 10]], { type: 'Sphere' });
  path = d3.geoPath(projection);

  sphereLayer.attr('d', path({ type: 'Sphere' }));

  continentLayer.selectAll('path')
  .data(continents, d => d.properties?.name || d.id)
  .join(
    enter => enter.append('path')
      .attr('class', 'continent')
      .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '') // ADD THIS LINE
      .attr('d', path)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave)
      .on('click', (event, d) => { event.stopPropagation(); handleContinentClick(d); }),
    update => update
      .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '') // ADD THIS LINE
      .attr('d', path),
    exit => exit.remove()
  );

  countryLayer.selectAll('path')
  .data(countries, d => d.id)
  .join(
    enter => enter.append('path')
      .attr('class', 'country')
      .attr('data-country', d => getCountryISO3(d)) // ADD THIS LINE
      .attr('data-biome', d => getCountryBiome(d)) // ADD THIS LINE
      .attr('d', path)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave)
      .on('click', (event, d) => { event.stopPropagation(); handleCountryClick(d); }),
    update => update
      .attr('data-country', d => getCountryISO3(d)) // ADD THIS LINE
      .attr('data-biome', d => getCountryBiome(d)) // ADD THIS LINE
      .attr('d', path),
    exit => exit.remove()
  );
  const mesh = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
  borderLayer.attr('d', path(mesh));

  rootLayer.attr('transform', currentTransform);
  svg.call(zoomBehavior.transform, currentTransform);
  updateContinentLayerState();
  updateCountryLayerState();
  // DEBUG: Check if tundra countries are getting the right biome
setTimeout(() => {
  const tundraCountries = ['Russia', 'Canada', 'Norway', 'Sweden', 'Finland'];
  d3.selectAll('.country').each(function(d) {
    const name = d.properties?.name;
    if (tundraCountries.includes(name)) {
      const biome = d3.select(this).attr('data-biome');
      console.log(`Country: ${name}, Biome: ${biome}`);
      // Force the color
      d3.select(this).style('fill', '#ff0000');
    }
  });
}, 2000);
}

function handleMouseMove(event, feature) {
  const props = feature?.properties || {};
  const name = props.name || props.admin || props.sovereignt || props.brk_name || `ISO ${feature?.id}`;
  $tooltip.style.opacity = 1;
  $tooltip.style.left = (event.offsetX + 14) + 'px';
  $tooltip.style.top = (event.offsetY + 14) + 'px';
  $tooltip.textContent = name;
  
  // Enhanced styling for continent tooltips
  if (feature.geometry && feature.geometry.type === 'MultiPolygon' || 
      feature.properties?.name && continents.some(c => c.properties?.name === feature.properties?.name)) {
    $tooltip.style.background = 'var(--accent)';
    $tooltip.style.color = 'var(--bg)';
    $tooltip.style.fontWeight = '600';
    $tooltip.style.borderColor = 'var(--accent-strong)';
  } else {
    $tooltip.style.background = '#0e1530';
    $tooltip.style.color = 'var(--ink)';
    $tooltip.style.fontWeight = 'normal';
    $tooltip.style.borderColor = '#1f2a50';
  }
}

function handleMouseLeave() {
  $tooltip.style.opacity = 0;
  // Reset tooltip styles
  $tooltip.style.background = '#0e1530';
  $tooltip.style.color = 'var(--ink)';
  $tooltip.style.fontWeight = 'normal';
  $tooltip.style.borderColor = '#1f2a50';
}
async function handleContinentClick(feature) {
  if (!feature || inFlight) return;
  inFlight = true;
  showLoading(true);
  const contName = feature.properties?.name || 'Selected continent';
  setPanelMode('Continent overview');
  setTitle(contName);
  dataContextEl.textContent = 'Aggregating continent-wide data...';
  toggleBackButton(true);
  try {
    await ensureDataReady();
    if (preloadError) throw preloadError;
    state.continentName = contName;
    state.countryId = null;
    const summary = summarizeContinent(contName);
    updateContinentLayerState();
    updateCountryLayerState();
    zoomToFeature(feature);
    applyContinentSummary(summary, contName);
  } catch (err) {
    console.error(err);
    setAllStatuses('Request failed: unexpected error.');
    dataContextEl.textContent = 'Unable to load continent aggregates right now.';
  } finally {
    showLoading(false);
    inFlight = false;
  }
}

async function handleCountryClick(feature) {
  if (!feature || !state.continentName || inFlight) return;
  const contName = continentByCountryId.get(feature.id);
  if (!contName || contName !== state.continentName) return;
  inFlight = true;
  showLoading(true);
  try {
    await ensureDataReady();
    if (preloadError) throw preloadError;
    state.countryId = parseInt(feature.id, 10);
    updateCountryLayerState();
    await hydrateCountryPanel(feature);
    setPanelMode('Country profile');
    dataContextEl.textContent = 'Country-level figures pulled directly from cached Wikidata tables.';
  } catch (err) {
    console.error(err);
    setAllStatuses('Request failed: unexpected error.');
  } finally {
    showLoading(false);
    inFlight = false;
  }
}

function summarizeContinent(name) {
  const list = countriesByContinent.get(name) || [];
  const isoList = list.map(c => parseInt(c.id, 10)).filter(Number.isFinite);
  const summary = {
    totalCountries: list.length,
    endemicCount: 0,
    gdpCount: 0,
    popCount: 0,
    totalEndemic: 0,
    threatened: 0,
    nt: 0,
    vu: 0,
    en: 0,
    cr: 0,
    gdpUSD: 0,
    population: 0,
    gdpYears: new Set(),
    popYears: new Set()
  };
  for (const iso of isoList) {
    const eRow = endemicTable?.get(iso);
    if (eRow) {
      summary.endemicCount++;
      summary.totalEndemic += eRow.totalEndemicSpecies || 0;
      const nt = eRow.nearThreatenedEndemicSpecies || 0;
      const vu = eRow.vulnerableEndemicSpecies || 0;
      const en = eRow.endangeredEndemicSpecies || 0;
      const cr = eRow.criticallyEndangeredEndemicSpecies || 0;
      summary.nt += nt;
      summary.vu += vu;
      summary.en += en;
      summary.cr += cr;
      summary.threatened += nt + vu + en + cr;
    }
    const gRow = gdpTable?.get(iso);
    if (gRow) {
      summary.gdpCount++;
      summary.gdpUSD += gRow.gdpUSD || 0;
      if (gRow.gdpYear) summary.gdpYears.add(gRow.gdpYear);
    }
    const pRow = populationTable?.get(iso);
    if (pRow) {
      summary.popCount++;
      summary.population += pRow.population || 0;
      if (pRow.popYear) summary.popYears.add(pRow.popYear);
    }
  }
  summary.gdpYearNote = formatYearNote(summary.gdpYears);
  summary.popYearNote = formatYearNote(summary.popYears);
  summary.note = summary.totalCountries
    ? `Aggregated from ${summary.totalCountries} countries (${summary.endemicCount || 0} with endemic data).`
    : 'No linked countries found for this continent yet.';
  return summary;
}

function formatYearNote(set) {
  if (!set || !set.size) return '';
  const arr = Array.from(set).sort();
  if (arr.length === 1) return `Latest year: ${arr[0]}`;
  return `Latest years: ${arr[0]}–${arr[arr.length - 1]}`;
}

function applyContinentSummary(summary, name) {
  setTitle(name);
  if (!summary.totalCountries) {
    clearPanel();
    dataContextEl.textContent = summary.note;
    return;
  }
  if (summary.endemicCount) {
    applyEndemicResult({
      status: 'ok',
      totalEndemicSpecies: summary.totalEndemic,
      nearThreatened: summary.nt,
      vulnerable: summary.vu,
      endangered: summary.en,
      criticallyEndangered: summary.cr
    });
  } else {
    applyEndemicResult({ status: 'empty' });
  }
  if (summary.gdpCount) {
    applyGdpResult({ status: 'ok', gdpUSD: summary.gdpUSD, gdpYear: summary.gdpYearNote });
  } else {
    applyGdpResult({ status: 'empty' });
  }
  if (summary.popCount) {
    applyPopResult({ status: 'ok', population: summary.population, popYear: summary.popYearNote });
  } else {
    applyPopResult({ status: 'empty' });
  }
  const endemicMsg = summary.endemicCount ? `Countries with endemic data: ${summary.endemicCount}` : 'No data';
  const gdpMsg = summary.gdpCount ? `Countries with GDP data: ${summary.gdpCount}` : 'No data';
  const popMsg = summary.popCount ? `Countries with population data: ${summary.popCount}` : 'No data';
  setStatuses(endemicMsg, gdpMsg, popMsg);
  dataContextEl.textContent = `${summary.note} Select a highlighted country within ${name} to drill down.`;
  updateCountryLayerState();
  countryLayer.classed('active', true);
}

async function hydrateCountryPanel(feature) {
  const isoNumeric = parseInt(feature.id, 10);
  if (!Number.isFinite(isoNumeric)) return;
  const topoName = (feature.properties || {}).name || feature.properties?.admin || feature.properties?.sovereignt || feature.properties?.brk_name || '';
  const lbl = endemicTable?.get(isoNumeric)?.countryLabel
    || gdpTable?.get(isoNumeric)?.countryLabel
    || populationTable?.get(isoNumeric)?.countryLabel
    || topoName
    || `ISO numeric ${isoNumeric}`;
  setTitle(lbl);

  if (preloadError) {
    setAllStatuses('Request failed: unexpected error.');
    return;
  }

  const endemicRow = endemicTable?.get(isoNumeric);
  if (endemicRow) {
    applyEndemicResult({
      status: 'ok',
      totalEndemicSpecies: endemicRow.totalEndemicSpecies,
      nearThreatened: endemicRow.nearThreatenedEndemicSpecies,
      vulnerable: endemicRow.vulnerableEndemicSpecies,
      endangered: endemicRow.endangeredEndemicSpecies,
      criticallyEndangered: endemicRow.criticallyEndangeredEndemicSpecies
    });
  } else {
    applyEndemicResult({ status: 'empty' });
  }

  const gRow = gdpTable?.get(isoNumeric);
  if (gRow) {
    applyGdpResult({ status: 'ok', gdpUSD: gRow.gdpUSD, gdpYear: gRow.gdpYear });
  } else {
    applyGdpResult({ status: 'empty' });
  }

  const pRow = populationTable?.get(isoNumeric);
  if (pRow) {
    applyPopResult({ status: 'ok', population: pRow.population, popYear: pRow.popYear });
  } else {
    applyPopResult({ status: 'empty' });
  }

  setStatuses('', '', '');
}

function updateContinentLayerState() {
  if (!continentLayer) return;
  continentLayer.selectAll('path')
    .classed('continent-selected', d => state.continentName && (d.properties?.name === state.continentName))
    .classed('continent-dim', d => state.continentName && (d.properties?.name !== state.continentName));
}

function updateCountryLayerState() {
  if (!countryLayer) return;
  const active = Boolean(state.continentName);
  countryLayer.classed('active', active);
  countryLayer.selectAll('path')
    .classed('country-muted', d => active && continentByCountryId.get(d.id) !== state.continentName)
    .classed('country-selected', d => state.countryId === parseInt(d.id, 10));
}

function zoomToFeature(feature) {
  if (!feature || !path) return;
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const w = parseFloat(svg.attr('width')) || 800;
  const h = parseFloat(svg.attr('height')) || 500;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  const scale = Math.min(8, 0.85 / Math.max(dx / w, dy / h));
  const translate = [w / 2 - scale * x, h / 2 - scale * y];
  svg.transition().duration(850).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
  );
}

function resetZoom() {
  svg.transition().duration(650).call(zoomBehavior.transform, d3.zoomIdentity);
}

function resetToContinents() {
  state.continentName = null;
  state.countryId = null;
  setPanelMode('Continent overview');
  setTitle('Select a continent');
  dataContextEl.textContent = 'Select a continent to see aggregated totals.';
  clearPanel();
  updateContinentLayerState();
  updateCountryLayerState();
  toggleBackButton(false);
  countryLayer?.classed('active', false);
  resetZoom();
}

function toggleBackButton(active) {
  if (backBtn) backBtn.disabled = !active;
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderMap();
  }, 150);
}

async function ensureDataReady() {
  if (endemicTable && gdpTable && populationTable) return;
  try {
    await preloadAllTables();
  } catch (err) {
    preloadError = err;
    throw err;
  }
}

async function preloadAllTables() {
  const endData = await runSparqlGETWithRetry(Q_END_EMD);
  endemicTable = buildEndemicMap(endData);

  const gdpData = await runSparqlGETWithRetry(Q_GDP);
  gdpTable = buildGdpMap(gdpData);

  const popData = await runSparqlGETWithRetry(Q_POP);
  populationTable = buildPopulationMap(popData);
}

async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const url = QLEVER + '?query=' + encodeURIComponent(query);
      const res = await fetch(url, { method: 'GET', headers: ACCEPT_JSON });
      if (!res.ok) {
        if ((res.status === 429 || res.status === 403 || res.status === 503) && attempt < retries) {
          attempt++;
          await delayWithJitter(baseDelayMs, attempt);
          continue;
        }
        throw new Error(`QLever error ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      if (attempt < retries) {
        attempt++;
        await delayWithJitter(baseDelayMs, attempt);
        continue;
      }
      throw e;
    }
  }
}

function delayWithJitter(base, attempt) {
  const jitter = Math.random() * 400;
  const wait = Math.min(800, base * attempt) + jitter;
  return new Promise(r => setTimeout(r, wait));
}

const Q_END_EMD = `
PREFIX wd:   <http://www.wikidata.org/entity/>
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT
  ?country
  ?countryLabel
  ?iso3
  ?isoNum
  (COALESCE(?allSpecies, 0)  AS ?totalEndemicSpecies)
  (COALESCE(?ntSpecies, 0)   AS ?nearThreatenedEndemicSpecies)
  (COALESCE(?vuSpecies, 0)   AS ?vulnerableEndemicSpecies)
  (COALESCE(?enSpecies, 0)   AS ?endangeredEndemicSpecies)
  (COALESCE(?crSpecies, 0)   AS ?criticallyEndangeredEndemicSpecies)
WHERE {
  ?country wdt:P31 wd:Q6256 .
  OPTIONAL { ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?country wdt:P298 ?iso3 }
  OPTIONAL { ?country wdt:P299 ?isoNum }

  OPTIONAL {
SELECT ?country (COUNT(DISTINCT ?sp) AS ?allSpecies)
WHERE {
  ?sp wdt:P31 wd:Q16521 ;
      wdt:P105 wd:Q7432 ;
      wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }

  OPTIONAL {
SELECT ?country (COUNT(DISTINCT ?spNT) AS ?ntSpecies)
WHERE {
  ?spNT wdt:P31  wd:Q16521 ;
        wdt:P105 wd:Q7432 ;
        wdt:P141 wd:Q719675 ;
        wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }

  OPTIONAL {
SELECT ?country (COUNT(DISTINCT ?spVU) AS ?vuSpecies)
WHERE {
  ?spVU wdt:P31  wd:Q16521 ;
        wdt:P105 wd:Q7432 ;
        wdt:P141 wd:Q278113 ;
        wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }

  OPTIONAL {
SELECT ?country (COUNT(DISTINCT ?spEN) AS ?enSpecies)
WHERE {
  ?spEN wdt:P31  wd:Q16521 ;
        wdt:P105 wd:Q7432 ;
        wdt:P141 wd:Q96377276 ;
        wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }

  OPTIONAL {
SELECT ?country (COUNT(DISTINCT ?spCR) AS ?crSpecies)
WHERE {
  ?spCR wdt:P31  wd:Q16521 ;
        wdt:P105 wd:Q7432 ;
        wdt:P141 wd:Q219127 ;
        wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }
}
ORDER BY DESC(?totalEndemicSpecies)
`;

const Q_GDP = `
PREFIX wd:   <http://www.wikidata.org/entity/>
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>
PREFIX p:    <http://www.wikidata.org/prop/>
PREFIX ps:   <http://www.wikidata.org/prop/statement/>
PREFIX pq:   <http://www.wikidata.org/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT
  ?country
  ?countryLabel
  ?iso3
  ?isoNum
  ?gdpUSD
  ?gdpYear
WHERE {
  ?country wdt:P31 wd:Q6256 .
  OPTIONAL { ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?country wdt:P298 ?iso3 }
  OPTIONAL { ?country wdt:P299 ?isoNum }

  {
SELECT ?country (MAX(?date) AS ?latestDate)
WHERE {
  ?country wdt:P31 wd:Q6256 ;
           p:P2131 ?st .
  ?st pq:P585 ?date .
}
GROUP BY ?country
  }

  ?country p:P2131 ?st2 .
  ?st2 pq:P585 ?latestDate ;
   ps:P2131 ?gdpUSD .
  BIND(YEAR(?latestDate) AS ?gdpYear)
}
ORDER BY DESC(?gdpUSD)
`;

const Q_POP = `
PREFIX wd:   <http://www.wikidata.org/entity/>
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>
PREFIX p:    <http://www.wikidata.org/prop/>
PREFIX ps:   <http://www.wikidata.org/prop/statement/>
PREFIX pq:   <http://www.wikidata.org/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT
  ?country
  ?countryLabel
  ?iso3
  ?isoNum
  ?population
  ?popYear
WHERE {
  ?country wdt:P31 wd:Q6256 .
  OPTIONAL { ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?country wdt:P298 ?iso3 }
  OPTIONAL { ?country wdt:P299 ?isoNum }

  {
SELECT ?country (MAX(?date) AS ?latestDate)
WHERE {
  ?country wdt:P31 wd:Q6256 ;
           p:P1082 ?popStmt .
  ?popStmt pq:P585 ?date .
}
GROUP BY ?country
  }

  ?country p:P1082 ?popStmt2 .
  ?popStmt2 pq:P585 ?latestDate ;
        ps:P1082 ?population .
  BIND(YEAR(?latestDate) AS ?popYear)
}
ORDER BY DESC(?population)
`;

function buildEndemicMap(json) {
  const m = new Map();
  const rows = json?.results?.bindings || [];
  for (const r of rows) {
    const isoNumStr = r.isoNum?.value;
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;
    if (!Number.isFinite(isoInt)) continue;
    const nt = +(r.nearThreatenedEndemicSpecies?.value || 0);
    const vu = +(r.vulnerableEndemicSpecies?.value || 0);
    const en = +(r.endangeredEndemicSpecies?.value || 0);
    const cr = +(r.criticallyEndangeredEndemicSpecies?.value || 0);
    m.set(isoInt, {
      countryLabel: r.countryLabel?.value || '',
      iso3: r.iso3?.value || '',
      isoNum: isoNumStr,
      totalEndemicSpecies: +(r.totalEndemicSpecies?.value || 0),
      nearThreatenedEndemicSpecies: nt,
      vulnerableEndemicSpecies: vu,
      endangeredEndemicSpecies: en,
      criticallyEndangeredEndemicSpecies: cr
    });
  }
  return m;
}

function buildGdpMap(json) {
  const m = new Map();
  const rows = json?.results?.bindings || [];
  for (const r of rows) {
    const isoNumStr = r.isoNum?.value;
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;
    if (!Number.isFinite(isoInt)) continue;
    m.set(isoInt, {
      countryLabel: r.countryLabel?.value || '',
      iso3: r.iso3?.value || '',
      isoNum: isoNumStr,
      gdpUSD: +(r.gdpUSD?.value || 0),
      gdpYear: r.gdpYear?.value || ''
    });
  }
  return m;
}

function buildPopulationMap(json) {
  const m = new Map();
  const rows = json?.results?.bindings || [];
  for (const r of rows) {
    const isoNumStr = r.isoNum?.value;
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;
    if (!Number.isFinite(isoInt)) continue;
    m.set(isoInt, {
      countryLabel: r.countryLabel?.value || '',
      iso3: r.iso3?.value || '',
      isoNum: isoNumStr,
      population: +(r.population?.value || 0),
      popYear: r.popYear?.value || ''
    });
  }
  return m;
}

function showLoading(on) {
  $loading.style.display = on ? 'flex' : 'none';
  $loading.setAttribute('aria-hidden', on ? 'false' : 'true');
}

function setPanelMode(text) {
  panelModeEl.textContent = text;
}

function setTitle(text) {
  document.getElementById('country-title').textContent = text || 'Select a continent';
}

function clearPanel() {
  setEndemic({ status: null });
  setGDP({ status: null });
  setPopulation({ status: null });
  drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });
  setStatuses('', '', '');
}

function setStatuses(endemicMsg, gdpMsg, popMsg) {
  const es = document.getElementById('endemicStatus');
  const gs = document.getElementById('gdpStatus');
  const ps = document.getElementById('popStatus');
  es.textContent = endemicMsg || '';
  gs.textContent = gdpMsg || '';
  ps.textContent = popMsg || '';
  [es, gs, ps].forEach(el => el.classList.remove('err'));
}

function setAllStatuses(message) {
  const es = document.getElementById('endemicStatus');
  const gs = document.getElementById('gdpStatus');
  const ps = document.getElementById('popStatus');
  [es, gs, ps].forEach(el => { el.textContent = message || ''; el.classList.add('err'); });
}

function applyEndemicResult(res) {
  const status = document.getElementById('endemicStatus');
  if (res.status === 'ok') {
    setEndemic(res);
    drawEndemicChart({
      total: res.totalEndemicSpecies,
      nt: res.nearThreatened,
      vu: res.vulnerable,
      en: res.endangered,
      cr: res.criticallyEndangered
    });
    status.textContent = '';
    status.classList.remove('err');
  } else if (res.status === 'empty') {
    setEndemic({ status: 'empty' });
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });
    status.textContent = 'No data';
    status.classList.remove('err');
  } else if (res.status === 'error') {
    setEndemic({ status: 'error' });
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });
    status.textContent = 'Request failed';
    status.classList.add('err');
  } else {
    setEndemic({ status: null });
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });
    status.textContent = '';
    status.classList.remove('err');
  }
}

function applyGdpResult(res) {
  const status = document.getElementById('gdpStatus');
  if (res.status === 'ok') {
    setGDP(res);
    status.textContent = '';
    status.classList.remove('err');
  } else if (res.status === 'empty') {
    setGDP({ status: 'empty' });
    status.textContent = 'No data';
    status.classList.remove('err');
  } else if (res.status === 'error') {
    setGDP({ status: 'error' });
    status.textContent = 'Request failed';
    status.classList.add('err');
  } else {
    setGDP({ status: null });
    status.textContent = '';
    status.classList.remove('err');
  }
}

function applyPopResult(res) {
  const status = document.getElementById('popStatus');
  if (res.status === 'ok') {
    setPopulation(res);
    status.textContent = '';
    status.classList.remove('err');
  } else if (res.status === 'empty') {
    setPopulation({ status: 'empty' });
    status.textContent = 'No data';
    status.classList.remove('err');
  } else if (res.status === 'error') {
    setPopulation({ status: 'error' });
    status.textContent = 'Request failed';
    status.classList.add('err');
  } else {
    setPopulation({ status: null });
    status.textContent = '';
    status.classList.remove('err');
  }
}

function setEndemic(payload) {
  const totalEl = document.getElementById('totalEndemic');
  const endEl = document.getElementById('endangeredEndemic');
  if (payload.status === 'ok') {
    const nt = payload.nearThreatened || 0;
    const vu = payload.vulnerable || 0;
    const en = payload.endangered || 0;
    const cr = payload.criticallyEndangered || 0;
    const threatened = nt + vu + en + cr;
    totalEl.textContent = fmtInt(payload.totalEndemicSpecies);
    endEl.textContent = fmtInt(threatened);
  } else if (payload.status === 'empty') {
    totalEl.textContent = '—';
    endEl.textContent = '—';
  } else if (payload.status === 'error') {
    totalEl.textContent = 'Request failed';
    endEl.textContent = 'Request failed';
  } else {
    totalEl.textContent = '—';
    endEl.textContent = '—';
  }
}

function setGDP(payload) {
  const g = document.getElementById('gdp');
  const gy = document.getElementById('gdpYear');
  if (payload.status === 'ok') {
    g.textContent = `${fmtMoney(payload.gdpUSD)} USD`;
    gy.textContent = formatYearLabel(payload.gdpYear);
  } else if (payload.status === 'empty') {
    g.textContent = '—';
    gy.textContent = '';
  } else if (payload.status === 'error') {
    g.textContent = 'Request failed';
    gy.textContent = '';
  } else {
    g.textContent = '—';
    gy.textContent = '';
  }
}

function setPopulation(payload) {
  const p = document.getElementById('population');
  const py = document.getElementById('popYear');
  if (payload.status === 'ok') {
    p.textContent = fmtInt(payload.population);
    py.textContent = formatYearLabel(payload.popYear);
  } else if (payload.status === 'empty') {
    p.textContent = '—';
    py.textContent = '';
  } else if (payload.status === 'error') {
    p.textContent = 'Request failed';
    py.textContent = '';
  } else {
    p.textContent = '—';
    py.textContent = '';
  }
}

function drawEndemicChart({ total, nt, vu, en, cr }) {
  const cont = d3.select('#chart');
  cont.selectAll('*').remove();
  const width = 280;
  const height = 200;
  const radius = Math.min(width, height) / 2 - 6;
  const threatened = (nt || 0) + (vu || 0) + (en || 0) + (cr || 0);
  const other = Math.max((total || 0) - threatened, 0);

  const data = [
    { label: 'Near threatened', value: nt || 0, color: '#58BB43' },
    { label: 'Vulnerable', value: vu || 0, color: '#3AA346' },
    { label: 'Endangered', value: en || 0, color: '#1E8C45' },
    { label: 'Critically endangered', value: cr || 0, color: '#9BE931' },
    { label: 'Other', value: other, color: '#8a5a2e' }
  ].filter(d => d.value > 0);

  if (!data.length) return;

  const svgC = cont.append('svg')
    .attr('width', width)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${width / 2}, ${height / 2})`);

  const pie = d3.pie().sort(null).value(d => d.value);
  const arc = d3.arc().innerRadius(0).outerRadius(radius);

  const arcs = pie(data);

  svgC.selectAll('path')
    .data(arcs)
    .join('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', '#0b1020')
    .attr('stroke-width', 0.6);

  // Legend next to the chart
  const legend = cont.append('div').attr('class', 'pie-legend');
  const items = legend.selectAll('.pie-legend-item')
    .data(data)
    .join('div')
    .attr('class', 'pie-legend-item');

  items.append('span')
    .attr('class', 'pie-swatch')
    .style('background', d => d.color);

  items.append('span')
    .attr('class', 'pie-label')
    .text(d => `${d.label}: ${fmtInt(d.value)}`);
}

function formatYearLabel(value) {
  if (!value) return '';
  if (typeof value === 'string' && (value.startsWith('Latest') || value.includes(':'))) {
    return value;
  }
  return `Year: ${value}`;
}

function handleInitError(err) {
  console.error(err);
  dataContextEl.textContent = 'Unable to draw the basemap right now. Please retry.';
}

async function boot() {
  setupButtons();
  try {
    await loadGeoData();
    initMapLayers();
    renderMap();
    window.addEventListener('resize', onResize, { passive: true });
    clearPanel();
  } catch (err) {
    handleInitError(err);
  }
}
// Simple debug - run this after the map loads
setTimeout(() => {
  console.log("=== DEBUG: Checking countries ===");
  
  // Get all country paths
  const countries = d3.selectAll('.country');
  console.log(`Total countries: ${countries.size()}`);
  
  // Check a few specific countries
  const testCountries = ['Russia', 'Canada', 'Norway', 'Sweden', 'Finland'];
  
  countries.each(function(d) {
    const name = d.properties?.name;
    if (testCountries.includes(name)) {
      console.log(`Found: ${name}`);
      // Force it to be red
      d3.select(this).style('fill', 'red');
      console.log(` - Set ${name} to red`);
    }
  });
  
  console.log("=== DEBUG END ===");
}, 3000);
boot();
