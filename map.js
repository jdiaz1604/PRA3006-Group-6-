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

// ============================================
// INITIALIZATION FUNCTIONS
// ============================================

// Sets up button used by the user to interact with the map If the start button exists, attach a listener that, when clicked, finds the 'explorer' element and smoothly scrolls it into view.)
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
    'Portugal': 'PRT', 'Kenya': 'KEN', 'Tanzania': 'TZA', 'Nigeria': 'NGA', 'Ethiopia': 'ETH',
    'Afghanistan': 'AFG', 'Albania': 'ALB', 'Andorra': 'AND', 'Angola': 'AGO',
    'Antigua and Barbuda': 'ATG', 'Armenia': 'ARM', 'Aruba': 'ABW', 'Azerbaijan': 'AZE',
    'Bahamas': 'BHS', 'Bahrain': 'BHR', 'Bangladesh': 'BGD', 'Barbados': 'BRB',
    'Belarus': 'BLR', 'Belgium': 'BEL', 'Belize': 'BLZ', 'Benin': 'BEN',
    'Bermuda': 'BMU', 'Bhutan': 'BTN', 'Bolivia': 'BOL', 'Bosnia and Herzegovina': 'BIH',
    'Botswana': 'BWA', 'British Indian Ocean Territory': 'IOT', 'Brunei': 'BRN',
    'Bulgaria': 'BGR', 'Burkina Faso': 'BFA', 'Burundi': 'BDI', 'Cabo Verde': 'CPV',
    'Cambodia': 'KHM', 'Cameroon': 'CMR', 'Central African Republic': 'CAF',
    'Chad': 'TCD', 'Chile': 'CHL', 'Christmas Island': 'CXR', 'Cocos (Keeling) Islands': 'CCK',
    'Comoros': 'COM', 'Democratic Republic of the Congo': 'COD', 'Republic of the Congo': 'COG',
    'Cook Islands': 'COK', 'Costa Rica': 'CRI', 'Croatia': 'HRV', 'Cuba': 'CUB',
    'Curaçao': 'CUW', 'Cyprus': 'CYP', 'Czech Republic': 'CZE', 'Côte d\'Ivoire': 'CIV',
    'Denmark': 'DNK', 'Djibouti': 'DJI', 'Dominica': 'DMA', 'Dominican Republic': 'DOM',
    'Ecuador': 'ECU', 'El Salvador': 'SLV', 'Equatorial Guinea': 'GNQ', 'Eritrea': 'ERI',
    'Estonia': 'EST', 'Eswatini': 'SWZ', 'Fiji': 'FJI', 'French Guiana': 'GUF',
    'French Polynesia': 'PYF', 'French Southern Territories': 'ATF', 'Gabon': 'GAB',
    'Gambia': 'GMB', 'Georgia': 'GEO', 'Ghana': 'GHA', 'Gibraltar': 'GIB',
    'Greece': 'GRC', 'Grenada': 'GRD', 'Guadeloupe': 'GLP', 'Guam': 'GUM',
    'Guatemala': 'GTM', 'Guernsey': 'GGY', 'Guinea': 'GIN', 'Guinea-Bissau': 'GNB',
    'Guyana': 'GUY', 'Haiti': 'HTI', 'Heard Island and McDonald Islands': 'HMD',
    'Holy See': 'VAT', 'Honduras': 'HND', 'Hong Kong': 'HKG', 'Hungary': 'HUN',
    'Iran': 'IRN', 'Iraq': 'IRQ', 'Ireland': 'IRL', 'Isle of Man': 'IMN',
    'Israel': 'ISR', 'Jamaica': 'JAM', 'Jersey': 'JEY', 'Jordan': 'JOR',
    'Kazakhstan': 'KAZ', 'Kiribati': 'KIR', 'Kuwait': 'KWT', 'Kyrgyzstan': 'KGZ',
    'Laos': 'LAO', 'Latvia': 'LVA', 'Lebanon': 'LBN', 'Lesotho': 'LSO',
    'Liberia': 'LBR', 'Libya': 'LBY', 'Liechtenstein': 'LIE', 'Lithuania': 'LTU',
    'Luxembourg': 'LUX', 'Macao': 'MAC', 'Madagascar': 'MDG', 'Malawi': 'MWI',
    'Maldives': 'MDV', 'Mali': 'MLI', 'Malta': 'MLT', 'Marshall Islands': 'MHL',
    'Martinique': 'MTQ', 'Mauritania': 'MRT', 'Mauritius': 'MUS', 'Mayotte': 'MYT',
    'Micronesia': 'FSM', 'Moldova': 'MDA', 'Monaco': 'MCO', 'Mongolia': 'MNG',
    'Montenegro': 'MNE', 'Montserrat': 'MSR', 'Morocco': 'MAR', 'Mozambique': 'MOZ',
    'Myanmar': 'MMR', 'Namibia': 'NAM', 'Nauru': 'NRU', 'Nepal': 'NPL',
    'Netherlands': 'NLD', 'New Caledonia': 'NCL', 'New Zealand': 'NZL',
    'Nicaragua': 'NIC', 'Niger': 'NER', 'Nigeria': 'NGA', 'Niue': 'NIU',
    'Norfolk Island': 'NFK', 'North Korea': 'PRK', 'North Macedonia': 'MKD',
    'Northern Mariana Islands': 'MNP', 'Oman': 'OMN', 'Pakistan': 'PAK',
    'Palau': 'PLW', 'Palestine': 'PSE', 'Panama': 'PAN', 'Papua New Guinea': 'PNG',
    'Paraguay': 'PRY', 'Peru': 'PER', 'Philippines': 'PHL', 'Pitcairn Islands': 'PCN',
    'Poland': 'POL', 'Puerto Rico': 'PRI', 'Qatar': 'QAT', 'Romania': 'ROU',
    'Rwanda': 'RWA', 'Réunion': 'REU', 'Saint Barthélemy': 'BLM',
    'Saint Helena, Ascension and Tristan da Cunha': 'SHN', 'Saint Kitts and Nevis': 'KNA',
    'Saint Lucia': 'LCA', 'Saint Martin': 'MAF', 'Saint Pierre and Miquelon': 'SPM',
    'Saint Vincent and the Grenadines': 'VCT', 'Samoa': 'WSM', 'San Marino': 'SMR',
    'Sao Tome and Principe': 'STP', 'Senegal': 'SEN', 'Serbia': 'SRB',
    'Seychelles': 'SYC', 'Sierra Leone': 'SLE', 'Singapore': 'SGP', 'Sint Maarten': 'SXM',
    'Slovakia': 'SVK', 'Slovenia': 'SVN', 'Solomon Islands': 'SLB', 'Somalia': 'SOM',
    'South Korea': 'KOR', 'South Sudan': 'SSD', 'Sri Lanka': 'LKA', 'Sudan': 'SDN',
    'Suriname': 'SUR', 'Svalbard and Jan Mayen': 'SJM', 'Sweden': 'SWE',
    'Switzerland': 'CHE', 'Syria': 'SYR', 'Taiwan': 'TWN', 'Tajikistan': 'TJK',
    'Tanzania': 'TZA', 'Thailand': 'THA', 'Timor-Leste': 'TLS', 'Togo': 'TGO',
    'Tokelau': 'TKL', 'Tonga': 'TON', 'Trinidad and Tobago': 'TTO', 'Tunisia': 'TUN',
    'Turkmenistan': 'TKM', 'Turks and Caicos Islands': 'TCA', 'Tuvalu': 'TUV',
    'Uganda': 'UGA', 'Ukraine': 'UKR', 'United Arab Emirates': 'ARE',
    'Uruguay': 'URY', 'Uzbekistan': 'UZB', 'Vanuatu': 'VUT', 'Venezuela': 'VEN',
    'Vietnam': 'VNM', 'Virgin Islands (British)': 'VGB', 'Virgin Islands (U.S.)': 'VIR',
    'Wallis and Futuna': 'WLF', 'Western Sahara': 'ESH', 'Yemen': 'YEM',
    'Zambia': 'ZMB', 'Zimbabwe': 'ZWE'
  };
  return isoMap[countryName] || '';// Return the corresponding ISO code or an empty string if not found
}

// ============ BIOME DETECTION ============
// Determines which biome color to apply to each country based on name/geography
// Biomes are displayed in map legend and styled with different colors
function getCountryBiome(country) {
  const countryName = country.properties?.name;//Looks at the country's properties list, finds the one called 'name' and tells what name it has to encode for the variable.
  const continent = continentByCountryId.get(country.id);//Looks up which continent the country belongs to using its unique identifier (ID) and stores that continent name in the variable continent.( this is used later if the country is not found in any specific biome list)
  
  // Extreme biomes that override everything (highest priority)
  if (countryName === 'Greenland') return 'ice';
  if (countryName === 'Antarctica') return 'ice';
  if (countryName === 'Iceland') return 'tundra';
  
  // Check specific biome lists in order of priority (most specific first)
  const desertCountries = ['Saudi Arabia', 'Egypt', 'Libya', 'Algeria', 'Australia', 'United Arab Emirates', 
                          'Oman', 'Yemen', 'Kuwait', 'Qatar', 'Bahrain', 'Mauritania', 'Niger', 'Chad', 
                          'Sudan', 'Mali', 'Western Sahara', 'Jordan', 'Israel', 'Iraq', 'Iran', 'Pakistan',
                          'Afghanistan', 'Turkmenistan', 'Uzbekistan', 'Kazakhstan', 'Mongolia'];
  if (desertCountries.includes(countryName)) return 'desert';// If the country name is contained in the list above then the biome of the country is dessert
  
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
  // Get the country name from feature properties (if it exists)
  const name = feature?.properties?.name;
  
  // Step 1: Check hard-coded overrides first (highest priority)
  if (NAME_OVERRIDES.has(name)) return NAME_OVERRIDES.get(name);
  
  // Step 2: Get geographic center (centroid) of the country
  const [lon, lat] = d3.geoCentroid(feature);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Unassigned';  // Handle invalid coords
  
  // Step 3: Use coordinate ranges to determine continent
  // These ranges are approximate but work well for most countries
  if (lat <= -50) return 'Antarctica';
  
  // Rule 2: Western hemisphere → North or South America
  if (lon < -30) {
    return lat >= 15 ? 'North America' : 'South America';  // Divide Americas by latitude
  }
  
  // Rule 3: Europe zone (specific longitude/latitude box)
  if (lon >= -25 && lon <= 60 && lat >= 35) return 'Europe';
  
  // Rule 4: Africa zone (complex bounding box excluding Middle East)
  if (lon >= -20 && lon <= 52 && lat < 35 && lat > -40 && !(lon > 40 && lat > 20)) return 'Africa';
  
  // Rule 5: Oceania rules (Pacific islands)
  if ((lon >= 110 && lat <= -10) || lon >= 150) return 'Oceania';
  if (lon >= 95 && lat <= -15) return 'Oceania';
  
  // Rule 6: Eastern hemisphere → Asia
  if (lon >= 25) return 'Asia';
  
  // Rule 7: Northern hemisphere default → Europe
  if (lat >= 0) return 'Europe';
  return 'Africa';  // Default fallback
}
// ============================================
// MAP RENDERING FUNCTIONS
// ============================================

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

// Creates readable string from year set
function formatYearNote(set) {// set = Set of years
  if (!set || !set.size) return '';// Return empty string if no years
  const arr = Array.from(set).sort();// Convert set to sorted array
  if (arr.length === 1) return `Latest year: ${arr[0]}`;// Single year case
  return `Latest years: ${arr[0]}–${arr[arr.length - 1]}`;// Range of years case
}

// Displays continent summary in side panel
function applyContinentSummary(summary, name) {// summary = Aggregated continent data, name = Continent name
  setTitle(name);// Set panel title to continent name
  
  if (!summary.totalCountries) {// No countries case
    clearPanel();// Clear existing panel data
    dataContextEl.textContent = summary.note;// Update context message
    return;// Exit function
  }
  
  // Display endemic data
  if (summary.endemicCount) {// If there is endemic data
    applyEndemicResult({// Show endemic species summary   
      status: 'ok',// Status OK
      totalEndemicSpecies: summary.totalEndemic,// Total endemic species count
      nearThreatened: summary.nt,// Near threatened count
      vulnerable: summary.vu,// Vulnerable count
      endangered: summary.en,// Endangered count
      criticallyEndangered: summary.cr// Critically endangered count
    });
  } else {// No endemic data case
    applyEndemicResult({ status: 'empty' });// Show empty status
  }
  
  // Display GDP data
  if (summary.gdpCount) {// If there is GDP data
    applyGdpResult({ status: 'ok', gdpUSD: summary.gdpUSD, gdpYear: summary.gdpYearNote });// Show GDP summary
  } else {// No GDP data case
    applyGdpResult({ status: 'empty' });// Show empty status
  }
  
  // Display population data
  if (summary.popCount) {// If there is population data
    applyPopResult({ status: 'ok', population: summary.population, popYear: summary.popYearNote });// Show population summary
  } else {// No population data case
    applyPopResult({ status: 'empty' });// Show empty status
  }
  
  // Status messages
  const endemicMsg = summary.endemicCount ? `Countries with endemic data: ${summary.endemicCount}` : 'No data';// If there is endemic data, show count otherwise, show 'No data'
  const gdpMsg = summary.gdpCount ? `Countries with GDP data: ${summary.gdpCount}` : 'No data';// If there is GDP data, show count otherwise, show 'No data'
  const popMsg = summary.popCount ? `Countries with population data: ${summary.popCount}` : 'No data';// If there is population data, show count otherwise, show 'No data'  
  
  setStatuses(endemicMsg, gdpMsg, popMsg);// Update status messages
  dataContextEl.textContent = `${summary.note} Select a highlighted country within ${name} to drill down.`;// Update context message
  
  // Update map highlighting
  updateCountryLayerState();// Ensure country layer reflects current state
  countryLayer.classed('active', true);// Activate country layer for interaction
}

// Loads and displays country data
async function hydrateCountryPanel(feature) {// feature = GeoJSON feature of selected country
  const isoNumeric = parseInt(feature.id, 10);// Get ISO numeric code of country
  if (!Number.isFinite(isoNumeric)) return;// Exit if invalid ISO code
  
  // Get best available name
  const topoName = (feature.properties || {}).name || feature.properties?.admin ||// Get name from properties
                   feature.properties?.sovereignt || feature.properties?.brk_name || '';// Fallback to various property names
  const lbl = endemicTable?.get(isoNumeric)?.countryLabel // Get country label from endemic data
    || gdpTable?.get(isoNumeric)?.countryLabel// Get country label from GDP data
    || populationTable?.get(isoNumeric)?.countryLabel// Get country label from population data
    || topoName// Fallback to TopoJSON name
    || `ISO numeric ${isoNumeric}`;// Final fallback to ISO code
  
  setTitle(lbl);// Set panel title to country name

  // Handle errors
  if (preloadError) {// If there was a preload error
    setAllStatuses('Request failed: unexpected error.');// Update status message
    return;// Exit function
  }

  // Display endemic data
  const endemicRow = endemicTable?.get(isoNumeric);// Get endemic data row for country
  if (endemicRow) {// If endemic data exists
    applyEndemicResult({// Show endemic species data
      status: 'ok',// Status OK
      totalEndemicSpecies: endemicRow.totalEndemicSpecies,// Total endemic species count
      nearThreatened: endemicRow.nearThreatenedEndemicSpecies,// Near threatened count
      vulnerable: endemicRow.vulnerableEndemicSpecies,// Vulnerable count
      endangered: endemicRow.endangeredEndemicSpecies,// Endangered count
      criticallyEndangered: endemicRow.criticallyEndangeredEndemicSpecies// Critically endangered count
    });// Show endemic species summary
  } else {// No endemic data case
    applyEndemicResult({ status: 'empty' });// Show empty status
  }

  // Display GDP data
  const gRow = gdpTable?.get(isoNumeric);// Get GDP data row for country
  if (gRow) {// If GDP data exists
    applyGdpResult({ status: 'ok', gdpUSD: gRow.gdpUSD, gdpYear: gRow.gdpYear });// Show GDP summary
  } else {// No GDP data case
    applyGdpResult({ status: 'empty' });// Show empty status
  }

  // Display population data
  const pRow = populationTable?.get(isoNumeric);// Get population data row for country
  if (pRow) {// If population data exists
    applyPopResult({ status: 'ok', population: pRow.population, popYear: pRow.popYear });// Show population summary
  } else {// No population data case
    applyPopResult({ status: 'empty' });// Show empty status
  }// No population data case

  setStatuses('', '', '');// Clear status messages
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
// Handles window resize (debounced)
// When the user resizes the browser window, this ensures the map adjusts to the new size.
// Without debouncing, the map would redraw 60+ times during a 2-second resize (wasteful!).
// The 150ms delay balances responsiveness vs performance - since our geographic data (borders, biomes, countries) is static and doesn't change from minute to minute,we can wait for the user to finish resizing before recalculating the projection
function onResize() {// Debounced resize handler
  clearTimeout(resizeTimer);// Clear existing timer
  resizeTimer = setTimeout(() => {// Set new timer
    renderMap();// Re-render map after resize
  }, 150);// 150ms debounce delay
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
      throw e;// Rethrow error if max retries reached
    }
  }
}

// Waits with random jitter (prevents thundering herd)
function delayWithJitter(base, attempt) {// base = base delay in ms, attempt = current attempt number
  const jitter = Math.random() * 400;// Random jitter up to 400ms
  const wait = Math.min(800, base * attempt) + jitter;// Calculate total wait time with max cap at 800ms
  return new Promise(r => setTimeout(r, wait));// Return promise that resolves after wait time
}

// ============================================
// SPARQL QUERIES
// ============================================

// Query for endemic species + IUCN categories
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

// Query for GDP data
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

// Query for population data
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

// ============================================
// DATA PARSING FUNCTIONS
// ============================================

// Converts SPARQL JSON to Map for endemic data
function buildEndemicMap(json) {// SPARQL JSON to Map for endemic data                                        
  const m = new Map();// Initialize empty Map to hold endemic data                                                  
  const rows = json?.results?.bindings || [];// Extract rows from SPARQL JSON                           
  for (const r of rows) {// Iterate over each row                                               
    const isoNumStr = r.isoNum?.value;// Get ISO numeric code as string                                  
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;// Parse ISO numeric code to integer           
    if (!Number.isFinite(isoInt)) continue;// Skip invalid ISO codes                             
    const nt = +(r.nearThreatenedEndemicSpecies?.value || 0);// Near threatened count           
    const vu = +(r.vulnerableEndemicSpecies?.value || 0);// Vulnerable count               
    const en = +(r.endangeredEndemicSpecies?.value || 0);// Endangered count               
    const cr = +(r.criticallyEndangeredEndemicSpecies?.value || 0);// Critically endangered count     
    m.set(isoInt, {// Store data in Map with ISO numeric code as key                                                     
      countryLabel: r.countryLabel?.value || '',// Country label                        
      iso3: r.iso3?.value || '',// ISO 3-letter code                                        
      isoNum: isoNumStr,// ISO numeric code as string                                                
      totalEndemicSpecies: +(r.totalEndemicSpecies?.value || 0),// Total endemic species count        
      nearThreatenedEndemicSpecies: nt,// Near threatened count                                 
      vulnerableEndemicSpecies: vu,// Vulnerable count                                     
      endangeredEndemicSpecies: en,// Endangered count                                     
      criticallyEndangeredEndemicSpecies: cr// Critically endangered count                            
    });
  }
  return m;// Return the populated Map                                                             
}

// Converts SPARQL JSON to Map for GDP data
function buildGdpMap(json) {// SPARQL JSON to Map for GDP data                                            
  const m = new Map();// Initialize empty Map to hold GDP data
  const rows = json?.results?.bindings || [];// Extract rows from SPARQL JSON
  for (const r of rows) {// Iterate over each row
    const isoNumStr = r.isoNum?.value;// Get ISO numeric code as string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;// Parse ISO numeric code to integer
    if (!Number.isFinite(isoInt)) continue;// Skip invalid ISO codes
    m.set(isoInt, {// Store data in Map with ISO numeric code as key
      countryLabel: r.countryLabel?.value || '',// Country label
      iso3: r.iso3?.value || '',// ISO 3-letter code
      isoNum: isoNumStr,// ISO numeric code as string
      gdpUSD: +(r.gdpUSD?.value || 0),// GDP in USD
      gdpYear: r.gdpYear?.value || ''// GDP year
    });
  }
  return m;// Return the populated Map
}

// Converts SPARQL JSON to Map for population data
function buildPopulationMap(json) {// SPARQL JSON to Map for population data                                     
  const m = new Map();// Initialize empty Map to hold population data
  const rows = json?.results?.bindings || [];// Extract rows from SPARQL JSON
  for (const r of rows) {// Iterate over each row
    const isoNumStr = r.isoNum?.value;// Get ISO numeric code as string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;// Parse ISO numeric code to integer
    if (!Number.isFinite(isoInt)) continue;// Skip invalid ISO codes
    m.set(isoInt, {// Store data in Map with ISO numeric code as key
      countryLabel: r.countryLabel?.value || '',// Country label
      iso3: r.iso3?.value || '',// ISO 3-letter code
      isoNum: isoNumStr,// ISO numeric code as string
      population: +(r.population?.value || 0),// Population count
      popYear: r.popYear?.value || ''// Population year
    });
  }
  return m;// Return the populated Map
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

// Shows/hides loading indicator
function showLoading(on) {// on = true to show, false to hide                                       
  $loading.style.display = on ? 'flex' : 'none';// Show or hide loading indicator                 
  $loading.setAttribute('aria-hidden', on ? 'false' : 'true');// Update ARIA(Accessible Rich Internet Applications) attribute for accessibility   
}

// Updates panel mode display
function setPanelMode(text) {// text = Mode text to display
  panelModeEl.textContent = text;// Update panel mode text
}

// Updates main title
function setTitle(text) {// text = Title text to display
  document.getElementById('country-title').textContent = text || 'Select a continent';// Update title text with fallback
}

// Clears side panel data
function clearPanel() {// Clears side panel data
  setEndemic({ status: null });// Clear endemic data display
  setGDP({ status: null });// Clear GDP data display
  setPopulation({ status: null });// Clear population data display
  drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 }); // Draw an empty pie chart
  setStatuses('', '', '');// Clear all three status messages
}

// Updates status messages
function setStatuses(endemicMsg, gdpMsg, popMsg) {// endemicMsg = Endemic status message, gdpMsg = GDP status message, popMsg = Population status message
  const es = document.getElementById('endemicStatus');// Get the status element for endemic data
  const gs = document.getElementById('gdpStatus');// Get the status element for GDP data
  const ps = document.getElementById('popStatus');// Get the status element for population data
  es.textContent = endemicMsg || '';// Update endemic status message
  gs.textContent = gdpMsg || '';// Update GDP status message
  ps.textContent = popMsg || '';// Update population status message
  [es, gs, ps].forEach(el => el.classList.remove('err'));// Remove error styling from all status elements
}

// Sets all status messages to error
function setAllStatuses(message) {// message = Error message to display
  const es = document.getElementById('endemicStatus');// Get the status element for endemic data
  const gs = document.getElementById('gdpStatus');// Get the status element for GDP data
  const ps = document.getElementById('popStatus');//Get the status element for population data
  [es, gs, ps].forEach(el => { el.textContent = message || ''; el.classList.add('err'); });   // Add the error styling class to all status elements
}

// Updates endemic data display based on result
function applyEndemicResult(res) {// res = Result object with status and data
  const status = document.getElementById('endemicStatus');// Get the status element for endemic data
  if (res.status === 'ok') {// If the request was successful
    setEndemic(res);// Update the endemic data display
    drawEndemicChart({// Draw the endemic species pie chart
      total: res.totalEndemicSpecies,// Total endemic species
      nt: res.nearThreatened,// Near threatened species
      vu: res.vulnerable,// Vulnerable species
      en: res.endangered,// Endangered species
      cr: res.criticallyEndangered// Critically endangered species
    });
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling
  } else if (res.status === 'empty') {// If there is no data available
    setEndemic({ status: 'empty' });// Update the endemic data display to show no data
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });// Draw an empty pie chart
    status.textContent = 'No data';// Set status message to indicate no data
    status.classList.remove('err');// Remove error styling
  } else if (res.status === 'error') {// If there was an error during the request
    setEndemic({ status: 'error' });// Update the endemic data display to show an error
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });// Draw an empty pie chart
    status.textContent = 'Request failed';// Set status message to indicate request failure
    status.classList.add('err');// Add error styling
  } else {// For any other unexpected status
    setEndemic({ status: null });// Clear the endemic data display
    drawEndemicChart({ total: 0, nt: 0, vu: 0, en: 0, cr: 0 });// Draw an empty pie chart
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling
  }
}

// Updates GDP data display
function applyGdpResult(res) {
  const status = document.getElementById('gdpStatus');// Get the status element for GDP data
  if (res.status === 'ok') {// If the request was successful
    setGDP(res);// Update the GDP data display
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling 
  } else if (res.status === 'empty') {// If there is no data available
    setGDP({ status: 'empty' });// Update the GDP data display to show no data
    status.textContent = 'No data';// Set status message to indicate no data
    status.classList.remove('err');// Remove error styling
  } else if (res.status === 'error') {// If there was an error during the request
    setGDP({ status: 'error' });// Update the GDP data display to show an error
    status.textContent = 'Request failed';// Set status message to indicate request failure
    status.classList.add('err');// Add error styling
  } else {// For any other unexpected status
    setGDP({ status: null });// Clear the GDP data display
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling
  }
}

// Updates population data display
function applyPopResult(res) {// res = Result object with status and data
  const status = document.getElementById('popStatus');// Get the status element for population data
  if (res.status === 'ok') {// If the request was successful
    setPopulation(res);// Update the population data display
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling
  } else if (res.status === 'empty') {// If there is no data available
    setPopulation({ status: 'empty' });// Update the population data display to show no data
    status.textContent = 'No data';// Set status message to indicate no data
    status.classList.remove('err');// Remove error styling
  } else if (res.status === 'error') {// If there was an error during the request
    setPopulation({ status: 'error' });// Update the population data display to show an error
    status.textContent = 'Request failed';// Set status message to indicate request failure
    status.classList.add('err');// Add error styling
  } else {// For any other unexpected status
    setPopulation({ status: null });// Clear the population data display
    status.textContent = '';// Clear any status message
    status.classList.remove('err');// Remove error styling
  }
}

// Sets endemic numbers in UI
function setEndemic(payload) {// payload = Result object with status and data
  const totalEl = document.getElementById('totalEndemic');// Get the total endemic species element
  const endEl = document.getElementById('endangeredEndemic');// Get the endangered endemic species element
  if (payload.status === 'ok') {// If the request was successful
    const nt = payload.nearThreatened || 0;//Pick NT species or 0
    const vu = payload.vulnerable || 0;// Pick VU species or 0
    const en = payload.endangered || 0;// Pick EN species or 0
    const cr = payload.criticallyEndangered || 0;// Pick CR species or 0
    const threatened = nt + vu + en + cr;// Calculate total threatened species
    totalEl.textContent = fmtInt(payload.totalEndemicSpecies);// Set total endemic species count
    endEl.textContent = fmtInt(threatened);// Set total threatened endemic species count
  } else if (payload.status === 'empty') {// If there is no data available
    totalEl.textContent = 'No data available';//  Set total endemic species to em dash  
    endEl.textContent = 'No data available';// Set threatened endemic species to em dash
  } else if (payload.status === 'error') {// If there was an error during the request
    totalEl.textContent = 'Request failed';// Set total endemic species to error message
    endEl.textContent = 'Request failed';// Set threatened endemic species to error message
  } else {// For any other unexpected status
    totalEl.textContent = '—';// Set total endemic species to em dash
    endEl.textContent = '—';// Set threatened endemic species to em dash
  }
}

// Sets GDP numbers in UI
function setGDP(payload) {// payload = Result object with status and data
  const g = document.getElementById('gdp');// Get the GDP element
  const gy = document.getElementById('gdpYear');// Get the GDP year element
  if (payload.status === 'ok') {// If the request was successful
    g.textContent = `${fmtMoney(payload.gdpUSD)} USD`;// Set GDP value with formatting
    gy.textContent = formatYearLabel(payload.gdpYear);// Set GDP year label
  } else if (payload.status === 'empty') {// If there is no data available
    g.textContent = 'No data available';// Set GDP to em dash
    gy.textContent = '';// Clear GDP year
  } else if (payload.status === 'error') {// If there was an error during the request
    g.textContent = 'Request failed';// Set GDP to error message
    gy.textContent = '';// Clear GDP year
  } else {// For any other unexpected status
    g.textContent = '—';// Set GDP to em dash
    gy.textContent = '';// Clear GDP year
  }
}

// Sets population numbers in UI
function setPopulation(payload) {// payload = Result object with status and data
  const p = document.getElementById('population');// Get the population element  
  const py = document.getElementById('popYear');// Get the population year element
  if (payload.status === 'ok') {// If the request was successful
    p.textContent = fmtInt(payload.population);// Set population value with formatting
    py.textContent = formatYearLabel(payload.popYear);// Set population year label
  } else if (payload.status === 'empty') {// If there is no data available
    p.textContent = 'No data available';// Set population to em dash
    py.textContent = '';// Clear population year
  } else if (payload.status === 'error') {// If there was an error during the request
    p.textContent = 'Request failed';// Set population to error message
    py.textContent = '';// Clear population year
  } else {// For any other unexpected status
    p.textContent = '—';// Set population to em dash
    py.textContent = '';// Clear population year
  }
}

// Creates pie chart for endemic species
function drawEndemicChart({ total, nt, vu, en, cr }) {// total = Total endemic species, nt = Near threatened count, vu = Vulnerable count, en = Endangered count, cr = Critically endangered count
  const cont = d3.select('#chart');// Select the chart container element
  cont.selectAll('*').remove();// Clear any existing chart content
  const width = 280;// Set chart width
  const height = 200;// Set chart height
  const radius = Math.min(width, height) / 2 - 6;// Calculate pie chart radius
  const threatened = (nt || 0) + (vu || 0) + (en || 0) + (cr || 0);// Calculate total threatened species
  const other = Math.max((total || 0) - threatened, 0);// Calculate "Other" category count

  const data = [// Prepare data for the pie chart/colors for the pie chart
    { label: 'Near threatened', value: nt || 0, color: '#58BB43' },// Data for Near Threatened category
    { label: 'Vulnerable', value: vu || 0, color: '#3AA346' },// Data for Vulnerable category
    { label: 'Endangered', value: en || 0, color: '#1E8C45' },// Data for Endangered category
    { label: 'Critically endangered', value: cr || 0, color: '#9BE931' },// Data for Critically Endangered category
    { label: 'Other', value: other, color: '#8a5a2e' }// Data for Other category  
  ].filter(d => d.value > 0);// Keep only categories with non-zero values

  if (!data.length) return;// If there's no data to display, exit the function

  const svgC = cont.append('svg')// Append an SVG (Scalable Vector Graphics) element to the chart container
    .attr('width', width)// Set SVG width
    .attr('height', height)// Set SVG height
    .append('g')// Create a group element for the pie chart
    .attr('transform', `translate(${width / 2}, ${height / 2})`);// Center the pie chart within the SVG

  const pie = d3.pie().sort(null).value(d => d.value);// Create a pie layout generator
  const arc = d3.arc().innerRadius(0).outerRadius(radius);// Create an arc generator for pie slices

  const arcs = pie(data);// Generate pie slices based on the data

  svgC.selectAll('path')// Select all path elements (pie slices)
    .data(arcs)// Bind pie slice data
    .join('path')// Create path elements for each pie slice
    .attr('d', arc)// Define the shape of each pie slice using the arc generator
    .attr('fill', d => d.data.color)// Set fill color for pie slices
    .attr('stroke', '#05170aff')// Set separation color for pie slices
    .attr('stroke-width', 0.6);// Set stroke width for pie slices

  const legend = cont.append('div').attr('class', 'pie-legend');// Create a legend container for the pie chart
  const items = legend.selectAll('.pie-legend-item')// Select all legend item elements
    .data(data)// Bind data for legend items
    .join('div')// Create div elements for each legend item
    .attr('class', 'pie-legend-item');// Set class for legend items

  items.append('span')// Append a span for the color swatch
    .attr('class', 'pie-swatch') // Assign CSS class for styling the color swatch
    .style('background', d => d.color);// Set background color of swatch to match pie slice color

  items.append('span')// Append a span for the label
    .attr('class', 'pie-label')// Assign CSS class for styling the label
    .text(d => `${d.label}: ${fmtInt(d.value)}`);// Set legend label with category name and value
}

// Formats year information for display
function formatYearLabel(value) {// value = Year value to format
  if (!value) return '';// Return empty string if no value
  if (typeof value === 'string' && (value.startsWith('Latest') || value.includes(':'))) {// If the value is a string indicating "Latest" or contains a colon, return it as is
    return value;// Return the value as is
  }
  return `Year: ${value}`;// Otherwise, format it as "Year: [value]"
}

// Handles initialization errors
function handleInitError(err) {// err = Error object
  console.error(err);// Log the error to the console for debugging
  dataContextEl.textContent = 'Unable to draw the basemap right now. Please retry.';// Update data context message to inform the user
}

// ============================================
// APPLICATION STARTUP
// ============================================

// Main initialization function
async function boot() {// Main initialization function
  setupButtons();// Set up button event listeners
  try {// Try to initialize the application
    await loadGeoData();// Load geographic data
    initMapLayers();// Initialize map layers
    renderMap();// Render the map
    window.addEventListener('resize', onResize, { passive: true });// Add resize event listener with passive option
    clearPanel();// Clear side panel data
  } catch (err) {// Handle initialization errors
    handleInitError(err);// Call error handling function
  }
}

boot();
