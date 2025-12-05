// ============ API & DATA ENDPOINTS ============
const QLEVER = 'https://qlever.dev/api/wikidata';  // QLever endpoint for SPARQL queries
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };  // Header to request JSON responses from SPARQL
const worldUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';  // World map in TopoJSON format

// ============ D3 FORMATTERS ============
// These format numbers for display (e.g., 1000000 → "1,000,000")
const fmtInt = d3.format(',d');  // Integer formatter with commas
const fmtMoney = d3.format('~s');  // Abbreviated formatter (e.g., "1.2M")

// ============ DOM ELEMENT REFERENCES ============
// Cache DOM elements for performance (avoid repeated getElementById calls)
const $loading = document.getElementById('loading');  // Spinner overlay
const $tooltip = document.getElementById('tooltip');  // Hover tooltip (country/continent name)
const panelModeEl = document.getElementById('panelMode');  // Text showing "Continent overview" or "Country profile"
const dataContextEl = document.getElementById('dataContext');  // Explanatory text below panel title
const backBtn = document.getElementById('backToWorld');  // "Back to continents" button

// ============ DATA CACHES ============
// These Maps store fetched SPARQL data. Lazy-loaded on first interaction.
// Key = ISO numeric code (e.g., 840 for USA), Value = { countryLabel, endemic count, threatened counts, etc. }
let endemicTable = null;  // Endemic & threatened species data by country
let gdpTable = null;  // GDP data by country
let populationTable = null;  // Population data by country
let preloadError = null;  // Stores error if SPARQL fetch fails, so we don't retry

// ============ GEOGRAPHIC DATA ============
// Populated when world map loads
let worldTopo = null;  // TopoJSON topology (raw map data from CDN)
let countries = [];  // Array of country features extracted from TopoJSON
let continents = [];  // Array of continent features (merged from countries)

// ============ LOOKUP TABLES FOR FAST QUERYING ============
const continentByCountryId = new Map();  // Maps country ID → continent name (e.g., 840 → "North America")
const countriesByContinent = new Map();  // Maps continent name → array of country features (for aggregation)

// ============ APPLICATION STATE ============
// This object tracks what the user is currently viewing. When user clicks a continent/country,
// these values change, which triggers D3 styling updates and panel refreshes.
const state = {
  continentName: null,  // Which continent is selected? null = none (showing world overview)
  countryId: null  // Which country is selected? null = none (showing continent view)
};

// ============ D3 RENDERING STATE ============
// These control how the map is drawn and transformed on screen
let projection = null;  // Geographic projection (converts lat/lon to x/y pixels)
let path = null;  // Path generator (converts geographic features to SVG path strings)
let rootLayer = null;  // Root <g> group that holds all map elements
let sphereLayer = null;  // Blue ocean background
let continentLayer = null;  // <g> for continent borders/selection
let countryLayer = null;  // <g> for individual country shapes
let borderLayer = null;  // <path> for country borders/edges
let zoomBehavior = null;  // D3 zoom handler for pan/zoom interactions
let currentTransform = d3.zoomIdentity;  // Current zoom/pan state (identity = no transform)
let resizeTimer = null;  // Timeout ID for debounced resize handler
let inFlight = false;  // Flag to prevent multiple simultaneous API requests (mutual exclusion)

// ============ SVG & DOM CONTAINERS ============
const svg = d3.select('.map');  // Main SVG element where map is drawn
const mapWrap = document.querySelector('.map-wrap');  // Container div (for measuring width/height)

function setupButtons() {
  backBtn?.addEventListener('click', () => { resetToContinents(); });
}

// ============ RESPONSIVE SIZING ============
// Calculate SVG dimensions based on available screen space
function resize() {
  const w = mapWrap.clientWidth || 800;  // Use container width, fallback to 800
  const h = Math.max(460, window.innerHeight - 220);  // Min 460px height, leave room for header/panel
  return { w, h };
}

// ============ LOAD & PROCESS GEOGRAPHIC DATA ============
// Fetches world map from CDN and assigns countries to continents
async function loadGeoData() {
  // Fetch TopoJSON from CDN (compressed geographic format, much smaller than GeoJSON)
  worldTopo = await d3.json(worldUrl);
  
  // Convert TopoJSON topology to GeoJSON features (each feature = one country)
  // topojson.feature() "unrolls" the compressed TopoJSON into usable GeoJSON
  countries = topojson.feature(worldTopo, worldTopo.objects.countries).features;
  
  // Use geographic coordinates to determine which continent each country belongs to
  // Populates continentByCountryId and countriesByContinent Maps
  assignContinents();
}

// ============ CONTINENT ASSIGNMENT LOGIC ============
// Hard-coded overrides for edge cases (countries on continent borders, disputed territories)
// These are applied BEFORE geographic centroid checking to guarantee correct continent
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
// ============ COUNTRY-TO-ISO3 MAPPING ============
// Maps country names from TopoJSON to ISO 3166-1 alpha-3 codes (used in biome detection)
// Only includes countries that need special mapping; others are looked up dynamically
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

// ============ BIOME DETECTION ============
// Determines which biome color to apply to each country based on name/geography
// Biomes are displayed in map legend and styled with different colors
function getCountryBiome(country) {
  const countryName = country.properties?.name;
  const continent = continentByCountryId.get(country.id);
  
  // Extreme biomes that override everything (highest priority)
  if (countryName === 'Greenland') return 'ice';
  if (countryName === 'Antarctica') return 'ice';
  if (countryName === 'Iceland') return 'tundra';
  
  // Check specific biome lists in order of priority (most specific first)
  const desertCountries = ['Saudi Arabia', 'Egypt', 'Libya', 'Algeria', 'Australia', 'United Arab Emirates', 
                          'Oman', 'Yemen', 'Kuwait', 'Qatar', 'Bahrain', 'Mauritania', 'Niger', 'Chad', 
                          'Sudan', 'Mali', 'Western Sahara', 'Jordan', 'Israel', 'Iraq', 'Iran', 'Pakistan',
                          'Afghanistan', 'Turkmenistan', 'Uzbekistan', 'Kazakhstan', 'Mongolia'];
  if (desertCountries.includes(countryName)) return 'desert';
  
  // Central African rainforest belt
  const rainforestCountries = ['Brazil', 'Colombia', 'Indonesia', 'Malaysia', 'Democratic Republic of the Congo', 
                              'Peru', 'Venezuela', 'Ecuador', 'Republic of the Congo', 'Gabon', 'Cameroon', 
                              'Central African Republic', 'Equatorial Guinea', 'Ghana', 'Ivory Coast', 'Liberia', 
                              'Sierra Leone', 'Guinea', 'Nigeria', 'Uganda', 'Rwanda', 'Burundi', 'Tanzania',
                              'Papua New Guinea', 'Philippines', 'Vietnam', 'Cambodia', 'Laos', 'Thailand',
                              'Myanmar', 'Sri Lanka', 'Bangladesh'];
  if (rainforestCountries.includes(countryName)) return 'rainforest';
  
  // Tundra/Arctic countries
  const tundraCountries = ['Russia', 'Canada', 'Norway', 'Sweden', 'Finland'];
  if (tundraCountries.includes(countryName)) return 'tundra';
  
  // Mountain countries
  const mountainCountries = ['Nepal', 'Bhutan', 'Switzerland', 'Austria', 'Bolivia'];
  if (mountainCountries.includes(countryName)) return 'mountain';
  
  // Mediterranean countries
  const mediterraneanCountries = ['Spain', 'Italy', 'Greece', 'Turkey', 'Portugal', 'Israel', 'Lebanon', 
                                 'Morocco', 'Tunisia', 'Algeria', 'Syria', 'Jordan', 'Cyprus', 'Malta',
                                 'Croatia', 'Albania', 'Montenegro'];
  if (mediterraneanCountries.includes(countryName)) return 'mediterranean';
  
  // Grassland/Savanna countries
  const grasslandCountries = ['Argentina', 'South Africa', 'Kenya', 'Zambia', 'Zimbabwe', 'Botswana', 
                             'Namibia', 'Mozambique', 'Madagascar', 'Malawi', 'Angola', 'Ethiopia',
                             'Somalia', 'Eritrea', 'Djibouti', 'Paraguay', 'Uruguay'];
  if (grasslandCountries.includes(countryName)) return 'grassland';
  
  // Default forest countries (temperate regions)
  const forestCountries = ['United States', 'China', 'Japan', 'South Korea', 'North Korea', 'France', 
                          'Germany', 'United Kingdom', 'Poland', 'Ukraine', 'Belarus', 'Romania',
                          'Bulgaria', 'Serbia', 'Hungary', 'Czech Republic', 'Slovakia', 'Austria',
                          'Switzerland', 'Chile', 'New Zealand'];
  if (forestCountries.includes(countryName)) return 'forest';
  
  // Continent-based fallbacks (lowest priority; used if country not in specific lists)
  // These provide reasonable defaults if a country wasn't explicitly categorized
  if (continent === 'Europe') return 'forest';
  if (continent === 'North America') return 'forest';
  if (continent === 'Asia') return 'forest';
  if (continent === 'Africa') return 'grassland';
  if (continent === 'South America') return 'rainforest';
  if (continent === 'Oceania') return 'desert';
  if (continent === 'Antarctica') return 'ice';
  
  // Ultimate fallback
  return 'forest';
}
// ============ ASSIGN COUNTRIES TO CONTINENTS ============
// Called once at startup. Groups countries by continent for aggregation and queries.
// Creates two Maps: (1) country ID → continent, (2) continent → array of countries
function assignContinents() {
  continentByCountryId.clear();  // Reset maps
  countriesByContinent.clear();
  
  const buckets = new Map();  // Temp storage: continent → array of TopoJSON geometries
  const geometries = worldTopo?.objects?.countries?.geometries || [];
  
  // For each country, determine its continent and add to lookup tables
  countries.forEach((feature, index) => {
    const continent = inferContinent(feature) || 'Unassigned';  // Infer continent from lat/lon
    feature.properties = feature.properties || {};
    feature.properties.continent = continent;  // Attach continent to feature for later use
    continentByCountryId.set(feature.id, continent);  // Fast lookup: country ID → continent
    
    if (continent === 'Unassigned') return;  // Skip unassigned countries
    
    // Add country to its continent's list
    if (!countriesByContinent.has(continent)) countriesByContinent.set(continent, []);
    countriesByContinent.get(continent).push(feature);
    
    // Also track geometries so we can merge them later
    if (!buckets.has(continent)) buckets.set(continent, []);
    const geom = geometries[index];
    if (geom) buckets.get(continent).push(geom);
  });

  // Merge each continent's country geometries into a single continent polygon
  continents = Array.from(buckets.entries())
    .filter(([name]) => name && name !== 'Unassigned')
    .map(([name, geoms]) => ({
      type: 'Feature',
      properties: { name },
      // topojson.merge() combines multiple geometries into one (used for continent boundaries)
      geometry: topojson.merge(worldTopo, geoms)
    }));
}

// ============ INFER CONTINENT FROM COORDINATES ============
// Uses geographic centroid (center point) + hardcoded NAME_OVERRIDES to determine continent
// This runs after NAME_OVERRIDES are checked, so edge cases are already handled
function inferContinent(feature) {
  const name = feature?.properties?.name;
  
  // Step 1: Check hard-coded overrides first (highest priority)
  if (NAME_OVERRIDES.has(name)) return NAME_OVERRIDES.get(name);
  
  // Step 2: Get geographic center (centroid) of the country
  const [lon, lat] = d3.geoCentroid(feature);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Unassigned';  // Handle invalid coords
  
  // Step 3: Use coordinate ranges to determine continent
  // These ranges are approximate but work well for most countries
  if (lat <= -50) return 'Antarctica';
  if (lon < -30) {
    return lat >= 15 ? 'North America' : 'South America';  // Divide Americas by latitude
  }
  if (lon >= -25 && lon <= 60 && lat >= 35) return 'Europe';
  if (lon >= -20 && lon <= 52 && lat < 35 && lat > -40 && !(lon > 40 && lat > 20)) return 'Africa';
  if ((lon >= 110 && lat <= -10) || lon >= 150) return 'Oceania';
  if (lon >= 95 && lat <= -15) return 'Oceania';
  if (lon >= 25) return 'Asia';
  if (lat >= 0) return 'Europe';
  return 'Africa';  // Default fallback
}

// ============ INITIALIZE D3 LAYERS ============
// Creates SVG layer hierarchy and zoom behavior handler
// Layer structure:
//   svg
//   └─ rootLayer (g) - holds all map content, gets transformed by zoom/pan
//      ├─ sphereLayer (path) - blue ocean background
//      ├─ continentLayer (g) - continent boundaries, responds to clicks
//      ├─ countryLayer (g) - individual countries, responds to clicks
//      └─ borderLayer (path) - country borders/edges
function initMapLayers() {
  svg.selectAll('*').remove();  // Clear any existing content
  
  // Create root group that will be transformed for zoom/pan
  rootLayer = svg.append('g').attr('class', 'map-root');
  
  // Ocean background (blue sphere from CSS)
  sphereLayer = rootLayer.append('path').attr('class', 'sphere');
  
  // Continent layer (clickable, highlighted on selection)
  continentLayer = rootLayer.append('g').attr('class', 'continents-layer');
  
  // Country layer (only visible after selecting a continent)
  countryLayer = rootLayer.append('g').attr('class', 'countries-layer');
  
  // Country borders (lines between countries, no fill)
  borderLayer = rootLayer.append('path')
    .attr('fill', 'none')
    .attr('stroke', '#0f1738')
    .attr('stroke-width', 0.6);
  
  // Zoom behavior: lets users pan and zoom the map (scale 1x to 8x)
  // When zoom changes, rootLayer gets transformed to show the new view
  zoomBehavior = d3.zoom()
    .scaleExtent([1, 8])  // Min zoom = 1x, max zoom = 8x
    .on('zoom', (event) => {
      currentTransform = event.transform;  // Save current transform state
      rootLayer.attr('transform', currentTransform);  // Apply transform to all layers
    });
  
  svg.call(zoomBehavior);  // Attach zoom behavior to SVG
}

// ============ RENDER MAP ============
// Main D3 rendering function: draws continents and countries based on current state
// Called on page load and whenever screen is resized
function renderMap() {
  if (!countries.length || !continents.length) return;  // Safety check
  
  // Step 1: Calculate new dimensions and update SVG
  const { w, h } = resize();
  svg.attr('width', w).attr('height', h);
  
  // Step 2: Create geographic projection (Mercator: converts lat/lon to x/y pixels)
  projection = d3.geoMercator().fitExtent([[10, 10], [w - 10, h - 10]], { type: 'Sphere' });
  
  // Step 3: Create path generator (converts GeoJSON to SVG path strings)
  path = d3.geoPath(projection);

  // Step 4: Draw ocean background
  sphereLayer.attr('d', path({ type: 'Sphere' }));

  // Step 5: BIND & RENDER CONTINENTS
  // D3 join pattern: enter (new data) + update (existing) + exit (removed)
  continentLayer.selectAll('path')
  .data(continents, d => d.properties?.name || d.id)  // Key by continent name
  .join(
    enter => enter.append('path')
      .attr('class', 'continent')
      .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')
      .attr('d', path)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave)
      .on('click', (event, d) => { event.stopPropagation(); handleContinentClick(d); }),
    update => update
      .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')
      .attr('d', path),
    exit => exit.remove()
  );

  // Step 6: BIND & RENDER COUNTRIES
  countryLayer.selectAll('path')
  .data(countries, d => d.id)  // Key by country ID
  .join(
    enter => enter.append('path')
      .attr('class', 'country')
      .attr('data-country', d => getCountryISO3(d))
      .attr('data-biome', d => getCountryBiome(d))  // Biome affects CSS styling/color
      .attr('d', path)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave)
      .on('click', (event, d) => { event.stopPropagation(); handleCountryClick(d); }),
    update => update
      .attr('data-country', d => getCountryISO3(d))
      .attr('data-biome', d => getCountryBiome(d))
      .attr('d', path),
    exit => exit.remove()
  );
  
  // Step 7: Draw country borders (topojson.mesh extracts border lines from countries)
  const mesh = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
  borderLayer.attr('d', path(mesh));

  // Step 8: Apply zoom/pan transform to all layers
  rootLayer.attr('transform', currentTransform);
  svg.call(zoomBehavior.transform, currentTransform);
  
  // Step 9: Update styling based on current state (selected continent/country)
  updateContinentLayerState();
  updateCountryLayerState();
}

// ============ MOUSE INTERACTIONS ============
// Show tooltip with country/continent name on hover
function handleMouseMove(event, feature) {
  const props = feature?.properties || {};
  // Try multiple name fields to find a label
  const name = props.name || props.admin || props.sovereignt || props.brk_name || `ISO ${feature?.id}`;
  
  // Position tooltip near cursor
  $tooltip.style.opacity = 1;
  $tooltip.style.left = (event.offsetX + 14) + 'px';
  $tooltip.style.top = (event.offsetY + 14) + 'px';
  $tooltip.textContent = name;
  
  // Style tooltip differently for continents vs. countries
  if (feature.geometry && feature.geometry.type === 'MultiPolygon' || 
      feature.properties?.name && continents.some(c => c.properties?.name === feature.properties?.name)) {
    // Continent: green highlight
    $tooltip.style.background = 'var(--accent)';
    $tooltip.style.color = 'var(--bg)';
    $tooltip.style.fontWeight = '600';
    $tooltip.style.borderColor = 'var(--accent-strong)';
  } else {
    // Country: default gray
    $tooltip.style.background = '#0e1530';
    $tooltip.style.color = 'var(--ink)';
    $tooltip.style.fontWeight = 'normal';
    $tooltip.style.borderColor = '#1f2a50';
  }
}

// Hide tooltip when mouse leaves
function handleMouseLeave() {
  $tooltip.style.opacity = 0;
  $tooltip.style.background = '#0e1530';
  $tooltip.style.color = 'var(--ink)';
  $tooltip.style.fontWeight = 'normal';
  $tooltip.style.borderColor = '#1f2a50';
}
// ============ CONTINENT CLICK HANDLER ============
// User clicked a continent: fetch data, zoom to it, and show aggregated stats
async function handleContinentClick(feature) {
  if (!feature || inFlight) return;  // Prevent double-clicks
  
  inFlight = true;  // Lock: prevent other API calls until this completes
  showLoading(true);  // Show spinner
  
  const contName = feature.properties?.name || 'Selected continent';
  setPanelMode('Continent overview');
  setTitle(contName);
  dataContextEl.textContent = 'Aggregating continent-wide data...';
  toggleBackButton(true);
  
  try {
    // Step 1: Fetch SPARQL data (endemic, GDP, population)
    // If already cached, ensureDataReady() returns immediately
    await ensureDataReady();
    if (preloadError) throw preloadError;
    
    // Step 2: Update application state
    state.continentName = contName;
    state.countryId = null;
    
    // Step 3: Compute continent-wide aggregates from cached tables
    const summary = summarizeContinent(contName);
    
    // Step 4: Update D3 layers (highlight continent, fade others, show countries in region)
    updateContinentLayerState();
    updateCountryLayerState();
    
    // Step 5: Animate zoom to the selected continent
    zoomToFeature(feature);
    
    // Step 6: Display the aggregated data in the sidebar
    applyContinentSummary(summary, contName);
  } catch (err) {
    console.error(err);
    setAllStatuses('Request failed: unexpected error.');
    dataContextEl.textContent = 'Unable to load continent aggregates right now.';
  } finally {
    showLoading(false);  // Hide spinner
    inFlight = false;  // Unlock: allow new API calls
  }
}

// ============ COUNTRY CLICK HANDLER ============
// User clicked a country (only works within a selected continent): show country-specific data
async function handleCountryClick(feature) {
  // Only allow country clicks if:
  // 1. We have a continent selected (state.continentName is set)
  // 2. The clicked country is in the selected continent
  // 3. No other API call is in progress
  if (!feature || !state.continentName || inFlight) return;
  
  const contName = continentByCountryId.get(feature.id);
  if (!contName || contName !== state.continentName) return;  // Country not in current continent
  
  inFlight = true;
  showLoading(true);
  
  try {
    // Fetch data if not already cached
    await ensureDataReady();
    if (preloadError) throw preloadError;
    
    // Update state to reflect selected country
    state.countryId = parseInt(feature.id, 10);
    updateCountryLayerState();  // Highlight selected country
    
    // Populate sidebar with country-specific data
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

// ============ CONTINENT DATA AGGREGATION ============
// Sums up endemic, GDP, and population data for all countries in a continent
function summarizeContinent(name) {
  const list = countriesByContinent.get(name) || [];  // Get all countries in this continent
  const isoList = list.map(c => parseInt(c.id, 10)).filter(Number.isFinite);  // Extract ISO numeric codes
  
  // Initialize accumulator object
  const summary = {
    totalCountries: list.length,  // How many countries in this continent?
    endemicCount: 0,  // How many countries have endemic data?
    gdpCount: 0,
    popCount: 0,
    totalEndemic: 0,  // Sum of all endemic species
    threatened: 0,  // Sum of threatened species
    nt: 0, vu: 0, en: 0, cr: 0,  // Sum by threat category
    gdpUSD: 0,  // Sum of GDP
    population: 0,  // Sum of population
    gdpYears: new Set(),  // Track which years are represented
    popYears: new Set()
  };
  
  // Loop through each country in the continent and aggregate its data
  for (const iso of isoList) {
    const eRow = endemicTable?.get(iso);  // Look up endemic data
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
    
    const gRow = gdpTable?.get(iso);  // Look up GDP data
    if (gRow) {
      summary.gdpCount++;
      summary.gdpUSD += gRow.gdpUSD || 0;
      if (gRow.gdpYear) summary.gdpYears.add(gRow.gdpYear);
    }
    
    const pRow = populationTable?.get(iso);  // Look up population data
    if (pRow) {
      summary.popCount++;
      summary.population += pRow.population || 0;
      if (pRow.popYear) summary.popYears.add(pRow.popYear);
    }
  }
  
  // Format year ranges for display
  summary.gdpYearNote = formatYearNote(summary.gdpYears);
  summary.popYearNote = formatYearNote(summary.popYears);
  
  // Create summary note describing what data is available
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

// ============ UPDATE D3 STYLING BASED ON STATE ============
// These functions add/remove CSS classes to highlight or fade map elements

// Highlight selected continent, fade others
function updateContinentLayerState() {
  if (!continentLayer) return;
  continentLayer.selectAll('path')
    .classed('continent-selected', d => state.continentName && (d.properties?.name === state.continentName))
    .classed('continent-dim', d => state.continentName && (d.properties?.name !== state.continentName));
}

// Show countries and highlight selected country (only if continent is selected)
function updateCountryLayerState() {
  if (!countryLayer) return;
  const active = Boolean(state.continentName);  // Are we in continent view?
  countryLayer.classed('active', active);  // Show countries only if continent selected
  countryLayer.selectAll('path')
    .classed('country-muted', d => active && continentByCountryId.get(d.id) !== state.continentName)  // Fade if in different continent
    .classed('country-selected', d => state.countryId === parseInt(d.id, 10));  // Highlight if selected
}

// ============ ZOOM & NAVIGATION ============
// Animate smooth zoom to a selected continent or country
function zoomToFeature(feature) {
  if (!feature || !path) return;
  
  // Step 1: Calculate bounding box of the feature
  const [[x0, y0], [x1, y1]] = path.bounds(feature);  // Get pixel bounds
  const w = parseFloat(svg.attr('width')) || 800;
  const h = parseFloat(svg.attr('height')) || 500;
  
  // Step 2: Calculate zoom level needed to fit feature in view
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;  // Center X
  const y = (y0 + y1) / 2;  // Center Y
  const scale = Math.min(8, 0.85 / Math.max(dx / w, dy / h));  // Calculate scale, cap at 8x
  
  // Step 3: Calculate translation to center the feature
  const translate = [w / 2 - scale * x, h / 2 - scale * y];
  
  // Step 4: Animate zoom transition over 850ms
  svg.transition()
    .duration(850)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

// Reset zoom back to world view
function resetZoom() {
  svg.transition().duration(650).call(zoomBehavior.transform, d3.zoomIdentity);
}

// ============ "BACK" BUTTON & RESET ============
// Clear selection and return to world overview
function resetToContinents() {
  state.continentName = null;
  state.countryId = null;
  setPanelMode('Continent overview');
  setTitle('Select a continent');
  dataContextEl.textContent = 'Select a continent to see aggregated totals.';
  clearPanel();
  updateContinentLayerState();  // Unhighlight continents
  updateCountryLayerState();  // Hide countries
  toggleBackButton(false);  // Disable back button (we're at root)
  countryLayer?.classed('active', false);
  resetZoom();  // Zoom back to world view
}

// Enable/disable the back button
function toggleBackButton(active) {
  if (backBtn) backBtn.disabled = !active;
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderMap();
  }, 150);
}

// ============ LAZY DATA LOADING ============
// Fetch SPARQL data only when user first clicks a continent
// Data is cached so subsequent clicks are instant
async function ensureDataReady() {
  // If all three tables are already loaded, return immediately
  if (endemicTable && gdpTable && populationTable) return;
  
  try {
    await preloadAllTables();
  } catch (err) {
    preloadError = err;  // Cache error so we don't retry
    throw err;
  }
}

// ============ FETCH ALL SPARQL DATA IN PARALLEL ============
// Runs three SPARQL queries simultaneously to get endemic, GDP, and population data
// Results are transformed into lookup Maps for fast O(1) access
async function preloadAllTables() {
  // Query 1: Endemic species + IUCN threat categories
  const endData = await runSparqlGETWithRetry(Q_END_EMD);
  endemicTable = buildEndemicMap(endData);

  // Query 2: GDP data (latest year per country)
  const gdpData = await runSparqlGETWithRetry(Q_GDP);
  gdpTable = buildGdpMap(gdpData);

  // Query 3: Population data (latest year per country)
  const popData = await runSparqlGETWithRetry(Q_POP);
  populationTable = buildPopulationMap(popData);
}

async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400, timeoutMs = 15000 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const url = QLEVER + '?query=' + encodeURIComponent(query);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const res = await fetch(url, { 
          method: 'GET', 
          headers: ACCEPT_JSON,
          signal: controller.signal 
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) {
          if ((res.status === 429 || res.status === 403 || res.status === 503) && attempt < retries) {
            attempt++;
            await delayWithJitter(baseDelayMs, attempt);
            continue;
          }
          throw new Error(`QLever error ${res.status}`);
        }
        return await res.json();
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw fetchErr;
      }
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

function buildEndemicMap(json) {                                        // Builds a Map from the SPARQL JSON results for endemic species (converts SPARQL results into a JavaScript Map)
  const m = new Map();                                                  // Initialize an empty Map to hold the endemic species data
  const rows = json?.results?.bindings || [];                           // Extract the rows from the SPARQL JSON results
  for (const r of rows) {                                               // Loop through each row returned by the query
    const isoNumStr = r.isoNum?.value;                                  // Get the ISO numeric code as a string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;           // Convert the ISO numeric code to an integer
    if (!Number.isFinite(isoInt)) continue;                             // Skip rows with invalid ISO numeric codes
    const nt = +(r.nearThreatenedEndemicSpecies?.value || 0);           // Read near-threatened count or fall back to 0
    const vu = +(r.vulnerableEndemicSpecies?.value || 0);               // Read vulnerable count or fall back to 0
    const en = +(r.endangeredEndemicSpecies?.value || 0);               // Read endangered count or fall back to 0
    const cr = +(r.criticallyEndangeredEndemicSpecies?.value || 0);     // Read critically endangered count or fall back to 0
    m.set(isoInt, {                                                     // Store the data in the Map using the ISO numeric code as the key
      countryLabel: r.countryLabel?.value || '',                        // country name
      iso3: r.iso3?.value || '',                                        // 3-letter ISO code
      isoNum: isoNumStr,                                                // numeric ISO code
      totalEndemicSpecies: +(r.totalEndemicSpecies?.value || 0),        // total endemic species count or fall back to 0
      nearThreatenedEndemicSpecies: nt,                                 // near-threatened count (storaged separately for convenience)
      vulnerableEndemicSpecies: vu,                                     // vulnerable count (storaged separately for convenience)
      endangeredEndemicSpecies: en,                                     // endangered count (storaged separately for convenience)
      criticallyEndangeredEndemicSpecies: cr                            // critically endangered count (storaged separately for convenience)
    });
  }
  return m;                                                             // Return the constructed Map
}

function buildGdpMap(json) {                                            // Builds a Map from the SPARQL JSON results for GDP data (the same as above but for GDP)
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

function buildPopulationMap(json) {                                     // Builds a Map from the SPARQL JSON results for population data (the same as above but for population)
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

function showLoading(on) {                                       // Toggles the loading indicator visibility (hide/show)
  $loading.style.display = on ? 'flex' : 'none';                 // If "on" is true, show it; if false, hide it
  $loading.setAttribute('aria-hidden', on ? 'false' : 'true');   // Update accessibility attribute
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

boot();
