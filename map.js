// ============================================
// INTERACTIVE WORLD MAP VISUALIZATION
// Main JavaScript file for geographic data display
// ============================================

// Application Programme Interface adress for Wikidata queries using SPARQL
const QLEVER = 'https://qlever.dev/api/wikidata';

// HTTP header to request JSON format responses, specifically designed for SPARQL results
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };

// URL for world geographic data (TopoJSON format)
const worldUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// Number formatters from D3.js library
const fmtInt = d3.format(',d');      // Formats with commas: 1000000 -> "1,000,000"
const fmtMoney = d3.format('~s');    // Formats with SI prefixes: 1000000 -> "1M"

// HTML element references (HTML elements js will interact with)
const $loading = document.getElementById('loading');        // Loading spinner
const $tooltip = document.getElementById('tooltip');        // Hover tooltip
const panelModeEl = document.getElementById('panelMode');   // Panel mode display
const dataContextEl = document.getElementById('dataContext'); // Context information
const backBtn = document.getElementById('backToWorld');     // Back button
const startBtn = document.getElementById('startExploring'); // Start button

// Data storage variables (initially empty, will be filled from Wikdidata)
let endemicTable = null;      // Stores endemic species data per country
let gdpTable = null;          // Stores GDP (Gross Domestic Product) data
let populationTable = null;   // Stores population data
let preloadError = null;      // Stores any loading errors

// Geographic data storage
let worldTopo = null;         // Raw topographic data
let countries = [];           // Country features extracted from worldTopo
let continents = [];          // Continent features (created by grouping countries)

// Data structures for quick lookups
const continentByCountryId = new Map();    // country ID → continent name
const countriesByContinent = new Map();    // continent name → array of country features

// Application state - tracks what user is currently viewing( like a memory of what user is looking at)
const state = {
  continentName: null,   // Currently selected continent (null = world view)
  countryId: null        // Currently selected country ID (null = continent/world view)
};

// Map visualization variables (D3.js related ( Data-Driven Documents)library for visualizations)
let projection = null;        // Geographic projection (converts lat/long to screen coordinates)
let path = null;             // Path generator for SVG(Scalable Vector graphics) drawing
let rootLayer = null;        // Main SVG group that contains all map elements
let sphereLayer = null;      // Background sphere/globe layer
let continentLayer = null;   // Continent shapes layer
let countryLayer = null;     // Country shapes layer
let borderLayer = null;      // Country borders layer
let zoomBehavior = null;     // Zoom and pan behavior controller
let currentTransform = d3.zoomIdentity;  // Current zoom/pan transformation
let resizeTimer = null;      // Timer for debouncing resize events
let inFlight = false;        // Flag to prevent multiple simultaneous requests

// Select the main SVG map element using D3.js
const svg = d3.select('.map');

// ============================================
// INITIALIZATION FUNCTIONS
// ============================================

// Sets up button event listeners
function setupButtons() {
  // Start button scrolls to the explorer section
  startBtn?.addEventListener('click', () => {
    document.getElementById('explorer').scrollIntoView({ behavior: 'smooth' });
  });
  
  // Back button returns to continent/world view
  backBtn?.addEventListener('click', () => { resetToContinents(); });
}

// Calculates and returns map container dimensions
function resize() {
  const mapWrap = document.querySelector('.map-wrap');
  const w = mapWrap?.clientWidth || 800;
  const h = mapWrap?.clientHeight || Math.max(500, window.innerHeight * 0.7);
  return { w, h };
}

// Loads geographic data from external source
async function loadGeoData() {
  try {
    // Fetch world topographic data
    worldTopo = await d3.json(worldUrl);
    
    // Convert TopoJSON to GeoJSON features (countries)
    countries = topojson.feature(worldTopo, worldTopo.objects.countries).features;
    
    // Group countries into continents
    assignContinents();
  } catch (error) {
    console.error('Failed to load geo data:', error);
    throw error;
  }
}

// ============================================
// CONTINENT AND BIOME ASSIGNMENT
// ============================================

// Manual overrides for countries with ambiguous continent placement
const NAME_OVERRIDES = new Map([
  ['Türkiye', 'Europe'], ['Turkey', 'Europe'], ['Cyprus', 'Europe'], ['Georgia', 'Europe'],
  ['Kazakhstan', 'Asia'], ['Azerbaijan', 'Asia'], ['Armenia', 'Asia'], ['Egypt', 'Africa'],
  ['Madagascar', 'Africa'], ['Cabo Verde', 'Africa'], ['Seychelles', 'Africa'], ['Mauritius', 'Africa'],
  ['Greenland', 'North America'], ['Mexico', 'North America'], ['Guatemala', 'North America'],
  ['Belize', 'North America'], ['El Salvador', 'North America'], ['Honduras', 'North America'],
  ['Nicaragua', 'North America'], ['Costa Rica', 'North America'], ['Panama', 'North America'],
  ['Cuba', 'North America'], ['Jamaica', 'North America'], ['Haiti', 'North America'],
  ['Dominican Republic', 'North America'], ['Bahamas', 'North America'], ['The Bahamas', 'North America'],
  ['Barbados', 'North America'], ['Trinidad and Tobago', 'North America'], ['Grenada', 'North America'],
  ['Saint Lucia', 'North America'], ['Saint Vincent and the Grenadines', 'North America'],
  ['Dominica', 'North America'], ['Antigua and Barbuda', 'North America'], ['Saint Kitts and Nevis', 'North America'],
  ['Puerto Rico', 'North America'], ['Saudi Arabia', 'Asia'], ['United Arab Emirates', 'Asia'],
  ['Oman', 'Asia'], ['Yemen', 'Asia'], ['Qatar', 'Asia'], ['Bahrain', 'Asia'], ['Kuwait', 'Asia'],
  ['Israel', 'Asia'], ['Lebanon', 'Asia'], ['Jordan', 'Asia'], ['State of Palestine', 'Asia'],
  ['Papua New Guinea', 'Oceania'], ['New Caledonia', 'Oceania'], ['New Zealand', 'Oceania'],
  ['Fiji', 'Oceania'], ['Solomon Islands', 'Oceania'], ['Vanuatu', 'Oceania'], ['Samoa', 'Oceania'],
  ['Tonga', 'Oceania'], ['Kiribati', 'Oceania'], ['Micronesia', 'Oceania'], ['Palau', 'Oceania'],
  ['Marshall Islands', 'Oceania'], ['Nauru', 'Oceania'], ['Tuvalu', 'Oceania'], ['Timor-Leste', 'Asia'],
  ['Indonesia', 'Asia'], ['Philippines', 'Asia'], ['Japan', 'Asia'], ['Sri Lanka', 'Asia'],
  ['French Southern Territories', 'Antarctica']
]);

// Returns 3-letter ISO code for a country (used for data lookup)
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

// Determines biome type for a country (used for visual styling)
function getCountryBiome(country) {
  const countryName = country.properties?.name;
  const continent = continentByCountryId.get(country.id);
  
  // Special hardcoded cases
  if (countryName === 'Greenland') return 'ice';
  if (countryName === 'Antarctica') return 'ice';
  if (countryName === 'Iceland') return 'tundra';
  
  // Desert biome countries
  const desertCountries = ['Saudi Arabia', 'Egypt', 'Libya', 'Algeria', 'Australia', 'United Arab Emirates', 
                          'Oman', 'Yemen', 'Kuwait', 'Qatar', 'Bahrain', 'Mauritania', 'Niger', 'Chad', 
                          'Sudan', 'Mali', 'Western Sahara', 'Jordan', 'Israel', 'Iraq', 'Iran', 'Pakistan',
                          'Afghanistan', 'Turkmenistan', 'Uzbekistan', 'Kazakhstan', 'Mongolia'];
  if (desertCountries.includes(countryName)) return 'desert';
  
  // Rainforest biome countries
  const rainforestCountries = ['Brazil', 'Colombia', 'Indonesia', 'Malaysia', 'Democratic Republic of the Congo', 
                              'Peru', 'Venezuela', 'Ecuador', 'Republic of the Congo', 'Gabon', 'Cameroon', 
                              'Central African Republic', 'Equatorial Guinea', 'Ghana', 'Ivory Coast', 'Liberia', 
                              'Sierra Leone', 'Guinea', 'Nigeria', 'Uganda', 'Rwanda', 'Burundi', 'Tanzania',
                              'Papua New Guinea', 'Philippines', 'Vietnam', 'Cambodia', 'Laos', 'Thailand',
                              'Myanmar', 'Sri Lanka', 'Bangladesh'];
  if (rainforestCountries.includes(countryName)) return 'rainforest';
  
  // Tundra biome countries
  const tundraCountries = ['Russia', 'Canada', 'Norway', 'Sweden', 'Finland'];
  if (tundraCountries.includes(countryName)) return 'tundra';
  
  // Mountain biome countries
  const mountainCountries = ['Nepal', 'Bhutan', 'Switzerland', 'Austria', 'Bolivia'];
  if (mountainCountries.includes(countryName)) return 'mountain';
  
  // Mediterranean biome countries
  const mediterraneanCountries = ['Spain', 'Italy', 'Greece', 'Turkey', 'Portugal', 'Israel', 'Lebanon', 
                                 'Morocco', 'Tunisia', 'Algeria', 'Syria', 'Jordan', 'Cyprus', 'Malta',
                                 'Croatia', 'Albania', 'Montenegro'];
  if (mediterraneanCountries.includes(countryName)) return 'mediterranean';
  
  // Grassland biome countries
  const grasslandCountries = ['Argentina', 'South Africa', 'Kenya', 'Zambia', 'Zimbabwe', 'Botswana', 
                             'Namibia', 'Mozambique', 'Madagascar', 'Malawi', 'Angola', 'Ethiopia',
                             'Somalia', 'Eritrea', 'Djibouti', 'Paraguay', 'Uruguay'];
  if (grasslandCountries.includes(countryName)) return 'grassland';
  
  // Forest biome countries
  const forestCountries = ['United States', 'China', 'Japan', 'South Korea', 'North Korea', 'France', 
                          'Germany', 'United Kingdom', 'Poland', 'Ukraine', 'Belarus', 'Romania',
                          'Bulgaria', 'Serbia', 'Hungary', 'Czech Republic', 'Slovakia', 'Austria',
                          'Switzerland', 'Chile', 'New Zealand'];
  if (forestCountries.includes(countryName)) return 'forest';
}

// Groups countries into continents and creates continent features
function assignContinents() {
  // Clear previous data
  continentByCountryId.clear();
  countriesByContinent.clear();
  
  const buckets = new Map(); // Temporary storage for continent geometries
  const geometries = worldTopo?.objects?.countries?.geometries || [];
  
  // Process each country
  countries.forEach((feature, index) => {
    // Determine which continent this country belongs to
    const continent = inferContinent(feature) || 'Unassigned';
    
    // Store continent information with the country
    feature.properties = feature.properties || {};
    feature.properties.continent = continent;
    continentByCountryId.set(feature.id, continent);
    
    // Skip unassigned countries
    if (continent === 'Unassigned') return;
    
    // Add country to continent's list
    if (!countriesByContinent.has(continent)) countriesByContinent.set(continent, []);
    countriesByContinent.get(continent).push(feature);
    
    // Collect geometries for merging into continent shapes
    if (!buckets.has(continent)) buckets.set(continent, []);
    const geom = geometries[index];
    if (geom) buckets.get(continent).push(geom);
  });

  // Create continent features by merging country boundaries
  continents = Array.from(buckets.entries())
    .filter(([name]) => name && name !== 'Unassigned')
    .map(([name, geoms]) => ({
      type: 'Feature',
      properties: { name },
      geometry: topojson.merge(worldTopo, geoms) // Merge shapes
    }));
}

// Infers continent based on geographic coordinates (fallback method)
function inferContinent(feature) {
  const name = feature?.properties?.name;
  
  // Check manual overrides first
  if (NAME_OVERRIDES.has(name)) return NAME_OVERRIDES.get(name);
  
  // Calculate geographic center
  const [lon, lat] = d3.geoCentroid(feature);
  
  // Return if invalid coordinates
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Unassigned';
  
  // Geographic rules for continent assignment
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

// ============================================
// MAP RENDERING FUNCTIONS
// ============================================

// Initializes SVG layers for the map
function initMapLayers() {
  // Clear any existing map
  svg.selectAll('*').remove();
  
  // Create main group that will be transformed (zoomed/panned)
  rootLayer = svg.append('g').attr('class', 'map-root');
  
  // Create layers in drawing order (back to front)
  sphereLayer = rootLayer.append('path').attr('class', 'sphere'); // Background
  continentLayer = rootLayer.append('g').attr('class', 'continents-layer');
  countryLayer = rootLayer.append('g').attr('class', 'countries-layer');
  borderLayer = rootLayer.append('path')
    .attr('fill', 'none')
    .attr('stroke', '#0f1738')
    .attr('stroke-width', 0.6);
  
  // Set up zoom and pan behavior
  zoomBehavior = d3.zoom()
    .scaleExtent([1, 8]) // Limit zoom between 1x and 8x
    .on('zoom', (event) => {
      currentTransform = event.transform;
      rootLayer.attr('transform', currentTransform);
    });
  
  // Apply zoom behavior to SVG
  svg.call(zoomBehavior);
}

// Draws/redraws the entire map
function renderMap() {
  // Don't render if no data
  if (!countries.length || !continents.length) return;
  
  // Get container dimensions
  const { w, h } = resize();
  svg.attr('width', w).attr('height', h);
  
  // Create Mercator projection that fits container
  projection = d3.geoMercator().fitExtent([[20, 20], [w - 20, h - 20]], { type: 'Sphere' });
  path = d3.geoPath(projection); // Path generator
  
  // Draw background sphere (ocean)
  sphereLayer.attr('d', path({ type: 'Sphere' }));
  
  // Draw continents using D3 data join pattern
  continentLayer.selectAll('path')
    .data(continents, d => d.properties?.name || d.id)
    .join(
      enter => enter.append('path')
        .attr('class', 'continent')
        .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')
        .attr('d', path)
        .on('mousemove', handleMouseMove)
        .on('mouseleave', handleMouseLeave)
        .on('click', (event, d) => { 
          event.stopPropagation(); 
          handleContinentClick(d); 
        }),
      update => update
        .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')
        .attr('d', path),
      exit => exit.remove()
    );
  
  // Draw countries
  countryLayer.selectAll('path')
    .data(countries, d => d.id)
    .join(
      enter => enter.append('path')
        .attr('class', 'country')
        .attr('data-country', d => getCountryISO3(d))
        .attr('data-biome', d => getCountryBiome(d))
        .attr('d', path)
        .on('mousemove', handleMouseMove)
        .on('mouseleave', handleMouseLeave)
        .on('click', (event, d) => { 
          event.stopPropagation(); 
          handleCountryClick(d); 
        }),
      update => update
        .attr('data-country', d => getCountryISO3(d))
        .attr('data-biome', d => getCountryBiome(d))
        .attr('d', path),
      exit => exit.remove()
    );
  
  // Draw country borders
  const mesh = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
  borderLayer.attr('d', path(mesh));
  
  // Apply current zoom/pan
  rootLayer.attr('transform', currentTransform);
  svg.call(zoomBehavior.transform, currentTransform);
  
  // Update visual states
  updateContinentLayerState();
  updateCountryLayerState();
}

// ============================================
// INTERACTION HANDLERS
// ============================================

// Shows tooltip on mouse hover
function handleMouseMove(event, feature) {
  const props = feature?.properties || {};
  const name = props.name || props.admin || props.sovereignt || props.brk_name || `ISO ${feature?.id}`;
  
  // Position and show tooltip
  $tooltip.style.opacity = 1;
  $tooltip.style.left = (event.offsetX + 14) + 'px';
  $tooltip.style.top = (event.offsetY + 14) + 'px';
  $tooltip.textContent = name;
  
  // Style differently for continents vs countries
  if (feature.geometry && feature.geometry.type === 'MultiPolygon' || 
      feature.properties?.name && continents.some(c => c.properties?.name === feature.properties?.name)) {
    // Continent styling
    $tooltip.style.background = 'var(--accent)';
    $tooltip.style.color = 'var(--bg)';
    $tooltip.style.fontWeight = '600';
    $tooltip.style.borderColor = 'var(--accent-strong)';
  } else {
    // Country styling
    $tooltip.style.background = '#0e1530';
    $tooltip.style.color = 'var(--ink)';
    $tooltip.style.fontWeight = 'normal';
    $tooltip.style.borderColor = '#1f2a50';
  }
}

// Hides tooltip
function handleMouseLeave() {
  $tooltip.style.opacity = 0;
  $tooltip.style.background = '#0e1530';
  $tooltip.style.color = 'var(--ink)';
  $tooltip.style.fontWeight = 'normal';
  $tooltip.style.borderColor = '#1f2a50';
}

// Handles continent click - shows continent-level data
async function handleContinentClick(feature) {
  if (!feature || inFlight) return;
  inFlight = true;
  showLoading(true);
  
  const contName = feature.properties?.name || 'Selected continent';
  
  // Update UI
  setPanelMode('Continent overview');
  setTitle(contName);
  dataContextEl.textContent = 'Aggregating continent-wide data...';
  toggleBackButton(true);
  
  try {
    // Ensure data is loaded
    await ensureDataReady();
    if (preloadError) throw preloadError;
    
    // Update state
    state.continentName = contName;
    state.countryId = null;
    
    // Calculate summary
    const summary = summarizeContinent(contName);
    
    // Update visualization
    updateContinentLayerState();
    updateCountryLayerState();
    zoomToFeature(feature);
    
    // Display summary
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

// Handles country click - shows country-level data
async function handleCountryClick(feature) {
  if (!feature || !state.continentName || inFlight) return;
  const contName = continentByCountryId.get(feature.id);
  if (!contName || contName !== state.continentName) return;
  
  inFlight = true;
  showLoading(true);
  
  try {
    await ensureDataReady();
    if (preloadError) throw preloadError;
    
    // Update state
    state.countryId = parseInt(feature.id, 10);
    updateCountryLayerState();
    
    // Load and display country data
    await hydrateCountryPanel(feature);
    
    // Update UI
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

// ============================================
// DATA PROCESSING FUNCTIONS
// ============================================

// Calculates summary statistics for a continent
function summarizeContinent(name) {
  const list = countriesByContinent.get(name) || [];
  const isoList = list.map(c => parseInt(c.id, 10)).filter(Number.isFinite);
  
  // Initialize summary object
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
  
  // Aggregate data from all countries in continent
  for (const iso of isoList) {
    // Endemic species data
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
    
    // GDP data
    const gRow = gdpTable?.get(iso);
    if (gRow) {
      summary.gdpCount++;
      summary.gdpUSD += gRow.gdpUSD || 0;
      if (gRow.gdpYear) summary.gdpYears.add(gRow.gdpYear);
    }
    
    // Population data
    const pRow = populationTable?.get(iso);
    if (pRow) {
      summary.popCount++;
      summary.population += pRow.population || 0;
      if (pRow.popYear) summary.popYears.add(pRow.popYear);
    }
  }
  
  // Format year information
  summary.gdpYearNote = formatYearNote(summary.gdpYears);
  summary.popYearNote = formatYearNote(summary.popYears);
  
  // Create description
  summary.note = summary.totalCountries
    ? `Aggregated from ${summary.totalCountries} countries (${summary.endemicCount || 0} with endemic data).`
    : 'No linked countries found for this continent yet.';
  
  return summary;
}

// Creates readable string from year set
function formatYearNote(set) {
  if (!set || !set.size) return '';
  const arr = Array.from(set).sort();
  if (arr.length === 1) return `Latest year: ${arr[0]}`;
  return `Latest years: ${arr[0]}–${arr[arr.length - 1]}`;
}

// Displays continent summary in side panel
function applyContinentSummary(summary, name) {
  setTitle(name);
  
  if (!summary.totalCountries) {
    clearPanel();
    dataContextEl.textContent = summary.note;
    return;
  }
  
  // Display endemic data
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
  
  // Display GDP data
  if (summary.gdpCount) {
    applyGdpResult({ status: 'ok', gdpUSD: summary.gdpUSD, gdpYear: summary.gdpYearNote });
  } else {
    applyGdpResult({ status: 'empty' });
  }
  
  // Display population data
  if (summary.popCount) {
    applyPopResult({ status: 'ok', population: summary.population, popYear: summary.popYearNote });
  } else {
    applyPopResult({ status: 'empty' });
  }
  
  // Status messages
  const endemicMsg = summary.endemicCount ? `Countries with endemic data: ${summary.endemicCount}` : 'No data';
  const gdpMsg = summary.gdpCount ? `Countries with GDP data: ${summary.gdpCount}` : 'No data';
  const popMsg = summary.popCount ? `Countries with population data: ${summary.popCount}` : 'No data';
  
  setStatuses(endemicMsg, gdpMsg, popMsg);
  dataContextEl.textContent = `${summary.note} Select a highlighted country within ${name} to drill down.`;
  
  // Update map highlighting
  updateCountryLayerState();
  countryLayer.classed('active', true);
}

// Loads and displays country data
async function hydrateCountryPanel(feature) {
  const isoNumeric = parseInt(feature.id, 10);
  if (!Number.isFinite(isoNumeric)) return;
  
  // Get best available name
  const topoName = (feature.properties || {}).name || feature.properties?.admin || 
                   feature.properties?.sovereignt || feature.properties?.brk_name || '';
  const lbl = endemicTable?.get(isoNumeric)?.countryLabel
    || gdpTable?.get(isoNumeric)?.countryLabel
    || populationTable?.get(isoNumeric)?.countryLabel
    || topoName
    || `ISO numeric ${isoNumeric}`;
  
  setTitle(lbl);

  // Handle errors
  if (preloadError) {
    setAllStatuses('Request failed: unexpected error.');
    return;
  }

  // Display endemic data
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

  // Display GDP data
  const gRow = gdpTable?.get(isoNumeric);
  if (gRow) {
    applyGdpResult({ status: 'ok', gdpUSD: gRow.gdpUSD, gdpYear: gRow.gdpYear });
  } else {
    applyGdpResult({ status: 'empty' });
  }

  // Display population data
  const pRow = populationTable?.get(isoNumeric);
  if (pRow) {
    applyPopResult({ status: 'ok', population: pRow.population, popYear: pRow.popYear });
  } else {
    applyPopResult({ status: 'empty' });
  }

  setStatuses('', '', '');
}

// ============================================
// MAP STATE MANAGEMENT
// ============================================

// Updates continent layer visual state
function updateContinentLayerState() {
  if (!continentLayer) return;
  continentLayer.selectAll('path')
    .classed('continent-selected', d => state.continentName && (d.properties?.name === state.continentName))
    .classed('continent-dim', d => state.continentName && (d.properties?.name !== state.continentName));
}

// Updates country layer visual state
function updateCountryLayerState() {
  if (!countryLayer) return;
  const active = Boolean(state.continentName);
  countryLayer.classed('active', active);
  countryLayer.selectAll('path')
    .classed('country-muted', d => active && continentByCountryId.get(d.id) !== state.continentName)
    .classed('country-selected', d => state.countryId === parseInt(d.id, 10));
}

// Zooms map to focus on a feature
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

// Resets zoom to show entire world
function resetZoom() {
  svg.transition().duration(650).call(zoomBehavior.transform, d3.zoomIdentity);
}

// Returns to world/continent view
function resetToContinents() {
  // Reset state
  state.continentName = null;
  state.countryId = null;
  
  // Update UI
  setPanelMode('Continent overview');
  setTitle('Select a continent');
  dataContextEl.textContent = 'Select a continent to see aggregated totals.';
  clearPanel();
  
  // Update visualization
  updateContinentLayerState();
  updateCountryLayerState();
  toggleBackButton(false);
  countryLayer?.classed('active', false);
  
  // Reset zoom
  resetZoom();
}

// Shows/hides back button
function toggleBackButton(active) {
  if (backBtn) backBtn.disabled = !active;
}

// Handles window resize (debounced)
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderMap();
  }, 150);
}

// ============================================
// DATA LOADING FUNCTIONS
// ============================================

// Ensures all data tables are loaded
async function ensureDataReady() {
  if (endemicTable && gdpTable && populationTable) return;
  
  try {
    await preloadAllTables();
  } catch (err) {
    preloadError = err;
    throw err;
  }
}

// Loads all data tables from Wikidata
async function preloadAllTables() {
  // Load endemic species data
  const endData = await runSparqlGETWithRetry(Q_END_EMD);
  endemicTable = buildEndemicMap(endData);

  // Load GDP data
  const gdpData = await runSparqlGETWithRetry(Q_GDP);
  gdpTable = buildGdpMap(gdpData);

  // Load population data
  const popData = await runSparqlGETWithRetry(Q_POP);
  populationTable = buildPopulationMap(popData);
}

// Executes SPARQL query with retry logic
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

// Waits with random jitter (prevents thundering herd)
function delayWithJitter(base, attempt) {
  const jitter = Math.random() * 400;
  const wait = Math.min(800, base * attempt) + jitter;
  return new Promise(r => setTimeout(r, wait));
}

// ============================================
// SPARQL QUERIES
// ============================================

//Query for endemic species + IUCN categories
const Q_END_EMD = `                                    #This creates a JavaScript string that contains a SPARQL query; the query fetches all species data
PREFIX wd:   <http://www.wikidata.org/entity/>         #This tells SPARQL where Wikidata items should be derived from
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>    #This tells SPARQL where direct Wikidata properties shoud be derived from
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>   #This gives access to standard RDF features, including labels

SELECT               #Everything below defines what pieces of data we want back from Wikidata
  ?country           #We want the Wikidata ID of each country
  ?countryLabel      # country name (in English)
  ?iso3              # code for the country (3-letter ISO code)
  ?isoNum            # numeric code 
  (COALESCE(?allSpecies, 0)  AS ?totalEndemicSpecies)                       # If total endemic species exist, take them; otherwise use 0
  (COALESCE(?ntSpecies, 0)   AS ?nearThreatenedEndemicSpecies)              #same as above for NT species
  (COALESCE(?vuSpecies, 0)   AS ?vulnerableEndemicSpecies)                  # same as above for VU species
  (COALESCE(?enSpecies, 0)   AS ?endangeredEndemicSpecies)                  # same as above for EN species
  (COALESCE(?crSpecies, 0)   AS ?criticallyEndangeredEndemicSpecies)        # same as above for CR species

WHERE {                                                                                         # Begin the data retrieval block (the main query begins here)
  ?country wdt:P31 wd:Q6256 .                                                                   # Select only entities that are instances of "country" (Q6256)
  OPTIONAL { ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }           # Get the English label for each country
  OPTIONAL { ?country wdt:P298 ?iso3 }                                                          # Get the 3-letter ISO code for each country
  OPTIONAL { ?country wdt:P299 ?isoNum }                                                        # Get the numeric ISO code for each country

  OPTIONAL {                                                     # Begin optional block to count all endemic species 
SELECT ?country (COUNT(DISTINCT ?sp) AS ?allSpecies)             #For each country, count distinct species that are endemic
WHERE {                                                          # Begin data retrieval for endemic species
  ?sp wdt:P31 wd:Q16521 ;         # Select organisms that are taxa
      wdt:P105 wd:Q7432 ;         # Make sure they are at species rank
      wdt:P183 ?country .         # Keep only species marked as “endemic to this country.”
  ?country wdt:P31 wd:Q6256 .     # Confirm again that this is a country
}
GROUP BY ?country                 # Group results by country to get counts (ensures the count happens per country)
  }

  OPTIONAL {                                             #Begin optional block to count Near Threatened species
SELECT ?country (COUNT(DISTINCT ?spNT) AS ?ntSpecies)    #For each country, count distinct species that are Near Threatened
WHERE {
  ?spNT wdt:P31  wd:Q16521 ;
        wdt:P105 wd:Q7432 ;
        wdt:P141 wd:Q719675 ;
        wdt:P183 ?country .
  ?country wdt:P31 wd:Q6256 .
}
GROUP BY ?country
  }

  OPTIONAL {                                             #Blocks to count VU, EN, CR species follow same pattern
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

const Q_GDP = `                                         # SPARQL query to get latest GDP data for countries
PREFIX wd:   <http://www.wikidata.org/entity/>          # This tells SPARQL where Wikidata items should be derived from
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>     # This tells SPARQL where direct Wikidata properties shoud be derived from
PREFIX p:    <http://www.wikidata.org/prop/>            # This gives access to Wikidata properties in statement form
PREFIX ps:   <http://www.wikidata.org/prop/statement/>  # This gives access to the main values of Wikidata statements
PREFIX pq:   <http://www.wikidata.org/prop/qualifier/>  # This gives access to qualifiers on Wikidata statements
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>    # This gives access to standard RDF features, including labels

SELECT
  ?country
  ?countryLabel
  ?iso3
  ?isoNum
  ?gdpUSD                                                                                 # GDP in US dollars (latest available)
  ?gdpYear                                                                                # Year of the GDP data
WHERE {                                                                                   # Begin data retrieval block
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

const Q_POP = `                                                # SPARQL query to get latest population data for countries
PREFIX wd:   <http://www.wikidata.org/entity/>                 # This tells SPARQL where Wikidata items should be derived from
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>            # This tells SPARQL where direct Wikidata properties shoud be derived from
PREFIX p:    <http://www.wikidata.org/prop/>                   # This gives access to Wikidata properties in statement form
PREFIX ps:   <http://www.wikidata.org/prop/statement/>         # This gives access to the main values of Wikidata statements
PREFIX pq:   <http://www.wikidata.org/prop/qualifier/>         # This gives access to qualifiers on Wikidata statements
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>           # This gives access to standard RDF features, including labels

SELECT
  ?country
  ?countryLabel
  ?iso3
  ?isoNum
  ?population          # Population (latest available)
  ?popYear             # Year of the population data
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

// ============================================
// DATA PARSING FUNCTIONS
// ============================================

// Converts SPARQL JSON to Map for endemic data
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

// Converts SPARQL JSON to Map for GDP data
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

// Converts SPARQL JSON to Map for population data
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

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

// Shows/hides loading indicator
function showLoading(on) {                                       
  $loading.style.display = on ? 'flex' : 'none';                 
  $loading.setAttribute('aria-hidden', on ? 'false' : 'true');   
}

// Updates panel mode display
function setPanelMode(text) {
  panelModeEl.textContent = text;
}

// Updates main title
function setTitle(text) {
  document.getElementById('country-title').textContent = text || 'Select a continent';
}

// Clears side panel data
function clearPanel() {
  setEndemic({ status: null });
  setGDP({ status: null });
  setPopulation({ status: null });
  drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 }); // Draw an empty pie chart
  setStatuses('', '', '');                                    // Clear all three status messages
}

// Updates status messages
function setStatuses(endemicMsg, gdpMsg, popMsg) {
  const es = document.getElementById('endemicStatus');
  const gs = document.getElementById('gdpStatus');
  const ps = document.getElementById('popStatus');
  es.textContent = endemicMsg || '';                       // Update endemic status message
  gs.textContent = gdpMsg || '';                           // Update GDP status message
  ps.textContent = popMsg || '';                           // Update population status message
  [es, gs, ps].forEach(el => el.classList.remove('err'));  // Remove error styling from all status elements
}

// Sets all status messages to error
function setAllStatuses(message) {
  const es = document.getElementById('endemicStatus');
  const gs = document.getElementById('gdpStatus');
  const ps = document.getElementById('popStatus');
  [es, gs, ps].forEach(el => { el.textContent = message || ''; el.classList.add('err'); });   // Add the error styling class to all status elements
}

// Updates endemic data display based on result
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
    status.textContent = '';                                     // Clear any status message
    status.classList.remove('err');                              // Remove error styling
  } else if (res.status === 'empty') {                           // If there is no data available
    setEndemic({ status: 'empty' });                             // Update the endemic data display to show no data
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });  // Draw an empty pie chart
    status.textContent = 'No data';                              // Set status message to indicate no data
    status.classList.remove('err');                              // Remove error styling
  } else if (res.status === 'error') {                           // If there was an error during the request
    setEndemic({ status: 'error' });                             // Update the endemic data display to show an error
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });  // Draw an empty pie chart
    status.textContent = 'Request failed';                       // Set status message to indicate request failure
    status.classList.add('err');                                 // Add error styling
  } else {                                                       // For any other unexpected status
    setEndemic({ status: null });
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });
    status.textContent = '';
    status.classList.remove('err');
  }
}

// Updates GDP data display
function applyGdpResult(res) {
  const status = document.getElementById('gdpStatus');         // Get the status element for GDP data
  if (res.status === 'ok') {                                   // If the request was successful
    setGDP(res);                                               // Update the GDP data display
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

// Updates population data display
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

// Sets endemic numbers in UI
function setEndemic(payload) {
  const totalEl = document.getElementById('totalEndemic');
  const endEl = document.getElementById('endangeredEndemic');
  if (payload.status === 'ok') {
    const nt = payload.nearThreatened || 0;                       //Pick NT species or 0
    const vu = payload.vulnerable || 0;                           // Pick VU species or 0
    const en = payload.endangered || 0;                           // Pick EN species or 0
    const cr = payload.criticallyEndangered || 0;                 // Pick CR species or 0
    const threatened = nt + vu + en + cr;                         // Calculate total threatened species
    totalEl.textContent = fmtInt(payload.totalEndemicSpecies);    // Set total endemic species count
    endEl.textContent = fmtInt(threatened);                       // Set total threatened endemic species count
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

// Sets GDP numbers in UI
function setGDP(payload) {
  const g = document.getElementById('gdp');
  const gy = document.getElementById('gdpYear');
  if (payload.status === 'ok') {
    g.textContent = `${fmtMoney(payload.gdpUSD)} USD`;      // Set GDP value with formatting
    gy.textContent = formatYearLabel(payload.gdpYear);      // Set GDP year label
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

// Sets population numbers in UI
function setPopulation(payload) {
  const p = document.getElementById('population');
  const py = document.getElementById('popYear');
  if (payload.status === 'ok') {
    p.textContent = fmtInt(payload.population);             // Set population value with formatting
    py.textContent = formatYearLabel(payload.popYear);      // Set population year label
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

// Creates pie chart for endemic species
function drawEndemicChart({ total, nt, vu, en, cr }) {
  const cont = d3.select('#chart');
  cont.selectAll('*').remove();
  const width = 280;
  const height = 200;
  const radius = Math.min(width, height) / 2 - 6;
  const threatened = (nt || 0) + (vu || 0) + (en || 0) + (cr || 0);
  const other = Math.max((total || 0) - threatened, 0);

  const data = [                                                                // Prepare data for the pie chart
    { label: 'Near threatened', value: nt || 0, color: '#58BB43' },
    { label: 'Vulnerable', value: vu || 0, color: '#3AA346' },
    { label: 'Endangered', value: en || 0, color: '#1E8C45' },
    { label: 'Critically endangered', value: cr || 0, color: '#9BE931' },
    { label: 'Other', value: other, color: '#8a5a2e' }
  ].filter(d => d.value > 0);                                                   // Keep only categories with non-zero values

  if (!data.length) return;                                                     // If there's no data to display, exit the function

  const svgC = cont.append('svg')                                               // Append an SVG (Scalable Vector Graphics) element to the chart container
    .attr('width', width)                                                       // Set SVG width
    .attr('height', height)                                                     // Set SVG height
    .append('g')                                                                // Create a group element for the pie chart
    .attr('transform', `translate(${width / 2}, ${height / 2})`);               // Center the pie chart within the SVG

  const pie = d3.pie().sort(null).value(d => d.value);                          // Create a pie layout generator
  const arc = d3.arc().innerRadius(0).outerRadius(radius);                      // Create an arc generator for pie slices

  const arcs = pie(data);                                                       // Generate pie slices based on the data

  svgC.selectAll('path')
    .data(arcs)
    .join('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', '#05170aff')                                                // Set stroke color for pie slices
    .attr('stroke-width', 0.6);                                                   // Set stroke width for pie slices

  const legend = cont.append('div').attr('class', 'pie-legend');
  const items = legend.selectAll('.pie-legend-item')
    .data(data)
    .join('div')
    .attr('class', 'pie-legend-item');

  items.append('span')
    .attr('class', 'pie-swatch')
    .style('background', d => d.color);                             // Create color swatch for each legend item

  items.append('span')
    .attr('class', 'pie-label')
    .text(d => `${d.label}: ${fmtInt(d.value)}`);                   // Set legend label with category name and value
}

// Formats year information for display
function formatYearLabel(value) {
  if (!value) return '';
  if (typeof value === 'string' && (value.startsWith('Latest') || value.includes(':'))) {    // If the value is a string indicating "Latest" or contains a colon, return it as is
    return value;
  }
  return `Year: ${value}`;                                                                   // Otherwise, format it as "Year: [value]"
}

// Handles initialization errors
function handleInitError(err) {
  console.error(err);
  dataContextEl.textContent = 'Unable to draw the basemap right now. Please retry.';
}

// ============================================
// APPLICATION STARTUP
// ============================================

// Main initialization function
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

// Start the application
boot();
