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
let sphereLayer = null;      // Background sphere/globe layer ( ocean layer)
let continentLayer = null;   // Continent shapes layer
let countryLayer = null;     // Country shapes layer
let borderLayer = null;      // Country borders layer
let zoomBehavior = null;     // Zoom and pan behavior controller
let currentTransform = d3.zoomIdentity;  // Current zoom/pan transformation ( initially zoomed out)
let resizeTimer = null;      // Timer that stops the map from resizing too often
let inFlight = false;        // Flag to prevent multiple simultaneous requests( avoid double clicks while loading)

// Defines the variable svg as being the canvas of the map 
const svg = d3.select('.map');

// ============================================
// INITIALIZATION FUNCTIONS
// ============================================

// Sets up button used by the user to interact with the map If the start button exists, attach a listener that, when clicked, finds the 'explorer' element and smoothly scrolls it into view.)
function setupButtons() {

  // Back to continents button
  backBtn?.addEventListener('click', () => { resetToContinents(); });
}

// Calculates and returns map container dimensions
function resize() {//This function's job is to calculate dimensions 
  const mapWrap = document.querySelector('.map-wrap');//Searches the HTML DOM (Document Object Model) - the actual webpage structure for an element with the class name 'map-wrap' and assigns it to the variable mapWrap.
  const w = mapWrap?.clientWidth || 800;// Calculates the width of the map container. If mapWrap exists, it uses its clientWidth property; otherwise, it defaults to 800 pixels. Gets from the browser the width of the map container element. If that element is not found, it defaults to 800 pixels.
  const h = mapWrap?.clientHeight || Math.max(500, window.innerHeight * 0.7);// Calculates the height of the map container. If mapWrap exists, it uses its clientHeight property otherwise, it defaults to the greater of 500 pixels or 70% of the window's inner height. Gets from the browser the height of the map container element. If that element is not found, it defaults to the greater of 500 pixels or 70% of the browser window's height.
  return { w, h };
}

// Loads geographic data from external source ( coordinate of borders of countries)
async function loadGeoData() {
  try {// Try to execute the following code block
    // Fetch world topographic data
    worldTopo = await d3.json(worldUrl);// Variable that stores the downloaded world map JSON data
    
    // Convert TopoJSON to GeoJSON features (countries)
    countries = topojson.feature(worldTopo, worldTopo.objects.countries).features;// Converts the TopoJSON data into GeoJSON format, specifically extracting the country features and storing them in the countries variable.
    
    // Group countries into continents
    assignContinents();
  } catch (error) {// If an error occurs during the try block, execute this code block
    console.error('Failed to load geo data:', error);
    throw error;
  }
}

// ============================================
// CONTINENT AND BIOME ASSIGNMENT
// ============================================

//Manually assigns specific countries to continents based on their names, overriding any automatic geographic calculations. Because some countries are geographically located in one continent but are politically or culturally associated with another.
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
function getCountryISO3(country) {//This function's job is to return the 3-letter International Organization for Standardization code for a given country. the code is meant to get the country code used in wikidata to get data about the country.
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

// Determines biome type for a country (used for visual styling)
function getCountryBiome(country) {
  const countryName = country.properties?.name;//Looks at the country's properties list, finds the one called 'name' and tells what name it has to encode for the variable.
  const continent = continentByCountryId.get(country.id);//Looks up which continent the country belongs to using its unique identifier (ID) and stores that continent name in the variable continent.( this is used later if the country is not found in any specific biome list)
  
  // Special hardcoded cases
  if (countryName === 'Greenland') return 'ice';
  if (countryName === 'Antarctica') return 'ice';
  if (countryName === 'Iceland') return 'tundra';
  
  // Desert biome countries
  const desertCountries = ['Saudi Arabia', 'Egypt', 'Libya', 'Algeria', 'Australia', 'United Arab Emirates', //defines all the countries that belong to a desert biome
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
  
  // Assign biome based on continent in case a country is not listed above
  if (continent === 'Europe') return 'forest';
  if (continent === 'North America') return 'forest';
  if (continent === 'Asia') return 'forest';
  if (continent === 'Africa') return 'grassland';
  if (continent === 'South America') return 'rainforest';
  if (continent === 'Oceania') return 'desert';
  if (continent === 'Antarctica') return 'ice';
}

// Groups countries into continents and creates continent features
function assignContinents() {//This function's job is to group countries into their respective continents and create continent features by merging country boundaries. 
  // Clear previous data
  continentByCountryId.clear();// Empties the map that links country IDs to continent names, preparing it for fresh assignments.
  countriesByContinent.clear();// Empties the map that links continent names to arrays of country features, preparing it for fresh assignments.
  
  const buckets = new Map(); // Initializing a temporary storage for continent geometries
  const geometries = worldTopo?.objects?.countries?.geometries || [];// Extracts the geometries of countries from the TopoJSON(worldmap) data or initializes an empty array if not available.
  
  // Process each country
  countries.forEach((feature, index) => {// Loops through ALL countries, feature = Current country object, index = Position in array (0, 1, 2, ...)
    const continent = inferContinent(feature) || 'Unassigned';// Determines the continent for the current country using the inferContinent function. If no continent is found, it defaults to 'Unassigned'.
    
    // Store continent information with the country
    feature.properties = feature.properties || {};// Ensures the country has a properties object to store additional information.
    feature.properties.continent = continent;// Adds continent to the country's own properties
    continentByCountryId.set(feature.id, continent);// Maps the country ID to its continent for quick lookup later.
    
    // Skip unassigned countries
    if (continent === 'Unassigned') return;
    
    // Add country to continent's list
    if (!countriesByContinent.has(continent)) countriesByContinent.set(continent, []);// Check: "Does this continent already have a list?" If not, create an empty list(array) for it.
    countriesByContinent.get(continent).push(feature);//Get the continent's country list and Add the current country to the continent's list.
    
    //Collects country shapes grouped by continent so they can later be merged into continent shapes.
    if (!buckets.has(continent)) buckets.set(continent, []);//Make sure this continent has an empty array in buckets if not create empty array
    const geom = geometries[index];// Get the geometry for the current country using its index in the array.
    if (geom) buckets.get(continent).push(geom);// If the geometry exists, add it to the continent's list in buckets.
  });

  // Create continent features by merging country boundaries
  continents = Array.from(buckets.entries())// Convert buckets Map to array of [continentName, arrayOfCountryShapes] pairs
    .filter(([name]) => name && name !== 'Unassigned')// Exclude any unassigned continents Keeps only entries where: name exists (not null/undefined/empty) and name is not unassigned
    .map(([name, geoms]) => ({// Transforms each [continentName, geometryArray of each country] pair into a continent feature
      type: 'Feature',// Specifies that this object is a GeoJSON Feature (standard format for geographic data)
      properties: { name },// Sets the continent name in properties
      geometry: topojson.merge(worldTopo, geoms) // Merge shapes to get the actual continent shape
    }));
}

// Infers continent based on geographic coordinates (fallback method if Manual Assignments fail)
function inferContinent(feature) {
  // Get the country name from feature properties (if it exists)
  const name = feature?.properties?.name;
  
  // Check manual overrides first - if country is in our override list, use that
  if (NAME_OVERRIDES.has(name)) return NAME_OVERRIDES.get(name);
  // Example: NAME_OVERRIDES has ['Turkey', 'Europe'] → Turkey returns 'Europe'
  
  // Calculate geographic center - find the central point of the country
  const [lon, lat] = d3.geoCentroid(feature);
  // lon = longitude (east-west position: -180 to 180)
  // lat = latitude (north-south position: -90 to 90)
  
  // Return if invalid coordinates - safety check for corrupted data
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Unassigned';
  
  // Geographic rules for continent assignment
  
  // Rule 1: Very far south → Antarctica
  if (lat <= -50) return 'Antarctica';
  
  // Rule 2: Western hemisphere → North or South America
  if (lon < -30) {
    // North of 15°N → North America, South → South America
    return lat >= 15 ? 'North America' : 'South America';
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
  
  // Final fallback: Everything else → Africa
  return 'Africa';
}
// ============================================
// MAP RENDERING FUNCTIONS
// ============================================

// Initializes Scalable Vector Graphics layers for the map
function initMapLayers() {
  // Clear any existing map
  svg.selectAll('*').remove();
  
  // Create main group that will be transformed (zoomed/panned)
  rootLayer = svg.append('g').attr('class', 'map-root');// Creates a new group element within the SVG canvas and assigns it to the variable rootLayer. This group will contain all the map elements and will be the target for zooming and panning transformations. Attribute HTML class to map root
  
  // Create layers in drawing order (back to front)
  sphereLayer = rootLayer.append('path').attr('class', 'sphere'); // Background
  continentLayer = rootLayer.append('g').attr('class', 'continents-layer');//creates a new group g which is a child element of rootlayer, then it sets class attribute to that new g group then it stores it as a reference in continentlayer. For drawing continents
  countryLayer = rootLayer.append('g').attr('class', 'countries-layer');// For drawing countries
  borderLayer = rootLayer.append('path')// Country borders
    .attr('fill', 'none')// No fill color for borders
    .attr('stroke', '#0f1738')//Country borders color
    .attr('stroke-width', 0.6);// Country borders thickness
  
  // Set up zoom and pan behavior
  zoomBehavior = d3.zoom()//Function call that creates and returns a zoom behavior object
    .scaleExtent([1, 8]) // Limit zoom between 1x and 8x
    .on('zoom', (event) => {// registers an event listener/handler that will run every time the user zooms or pans the map.
      currentTransform = event.transform;// Update current zoomed state
      rootLayer.attr('transform', currentTransform);// Apply transformation to root layer
    });
  
  // Apply zoom behavior to SVG in HTML
  svg.call(zoomBehavior);
}

// This function draws/redraws the entire map
function renderMap() {
  // Don't render if no data
  if (!countries.length || !continents.length) return;// If there are no countries or continents data, exit the function early.
  
  // Get container dimensions
  const { w, h } = resize();// Calls the resize function to get the current width (w) and height (h) of the map container.
  
  // Apply the calculated dimensions (w, h) as width/height attributes in the svg
  svg.attr('width', w).attr('height', h);
  
  // Create Mercator projection that fits container
  projection = d3.geoMercator().fitExtent([[20, 20], [w - 20, h - 20]], { type: 'Sphere' });// Sets up a Mercator projection that fits within the specified width and height, with a 20-pixel margin on all sides.
  path = d3.geoPath(projection); // Create path generator using the projection
  
  // Draw background sphere (ocean)
  sphereLayer.attr('d', path({ type: 'Sphere' }));//Sets the "d" (path data) attribute of the sphereLayer element to the SVG drawing commands generated by projecting a sphere.
  
  // Draw continents using D3 data join pattern
  continentLayer.selectAll('path')// Selects all existing path elements within the continentLayer group
    .data(continents, d => d.properties?.name || d.id)// Binds the continents data to the selected path elements, using the continent name or ID as the key for data binding.
    .join(// Joins the data to the DOM elements, handling enter, update and exit selections
     enter => enter.append('path')// For new continents, append a path element
        .attr('class', 'continent')// Sets the class attribute to 'continent'
        .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')// Sets a data attribute for continent name in lowercase with spaces replaced by hyphens
        .attr('d', path)// Sets the "d" attribute to define the shape of the continent using the path generator
        .on('mousemove', handleMouseMove)// Attach mousemove event for tooltip - .on It attaches event listeners to DOM elements it makes elements respond to user interactions.
        .on('mouseleave', handleMouseLeave)// Attach mouseleave event to hide tooltip
        .on('click', (event, d) => { // Attach click event to handle continent selection
          event.stopPropagation(); // Prevent event bubbling
          handleContinentClick(d); // Call continent click handler
        }),
      update => update// For existing continents, update attributes
        .attr('data-continent', d => d.properties?.name?.toLowerCase().replace(' ', '-') || '')// Update data attribute
        .attr('d', path),// Update shape 
      exit => exit.remove()// Remove continents that are no longer in the data
    );
  
  // Draw countries
  countryLayer.selectAll('path')// Selects all existing path elements within the countryLayer group
    .data(countries, d => d.id)// Binds the countries data to the selected path elements, using the country ID as the key for data binding.
    .join(// Joins the data to the DOM elements, handling enter, update and exit selections
      enter => enter.append('path')// For new countries, append a path element
        .attr('class', 'country')// Sets the class attribute to 'country'
        .attr('data-country', d => getCountryISO3(d))// Sets a data attribute for country ISO3 code
        .attr('data-biome', d => getCountryBiome(d))// Sets a data attribute for country biome type
        .attr('d', path)// Sets the "d" attribute to define the shape of the country using the path generator
        .on('mousemove', handleMouseMove)// Attach mousemove event for tooltip
        .on('mouseleave', handleMouseLeave)// Attach mouseleave event to hide tooltip
        .on('click', (event, d) => { // Attach click event to handle country selection
          event.stopPropagation(); // Prevent event bubbling
          handleCountryClick(d); // Call country click handler
        }),
      update => update// For existing countries, update attributes
        .attr('data-country', d => getCountryISO3(d))// Update data attribute
        .attr('data-biome', d => getCountryBiome(d))// Update biome attribute
        .attr('d', path),// Update shape
      exit => exit.remove()// Remove countries that are no longer in the data
    );
  
  // Draw country borders
  const mesh = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);// Creates a mesh of country borders by extracting shared boundaries between different countries from the TopoJSON data.
  borderLayer.attr('d', path(mesh));// Sets the "d" attribute of the borderLayer to draw borders between countries using the mesh function to extract shared boundaries.
  
  // Apply current zoom/pan
  rootLayer.attr('transform', currentTransform);// Apply current zoom/pan transform to root layer
  svg.call(zoomBehavior.transform, currentTransform);// Sync zoom behavior with current transform
  
  // Update visual states
  updateContinentLayerState();// Ensure continent layer reflects current state
  updateCountryLayerState();// Ensure country layer reflects current state
}

// ============================================
// INTERACTION HANDLERS
// ============================================

// Shows tooltip on mouse hover
function handleMouseMove(event, feature) {// event = Mouse event object, feature = GeoJSON feature being hovered over
  const props = feature?.properties || {};// Get feature properties or empty object
  const name = props.name || props.admin || props.sovereignt || props.brk_name || `ISO ${feature?.id}`;// Determine name to display in tooltip
  
  // Position and show tooltip
  $tooltip.style.opacity = 1;//opacity 1 means fully visible, it is a purcentage [0.0 - 1.0]
  $tooltip.style.left = (event.offsetX + 14) + 'px';// Position tooltip slightly offset from cursor
  $tooltip.style.top = (event.offsetY + 14) + 'px';// Position tooltip slightly offset from cursor
  $tooltip.textContent = name;// Set tooltip text to feature name
  
  // Style differently for continents vs countries
  if (feature.geometry && feature.geometry.type === 'MultiPolygon' ||// Check if feature is a continent (MultiPolygon) 
      feature.properties?.name && continents.some(c => c.properties?.name === feature.properties?.name)) {// Or if its name matches a known continent
    // Continent styling - use CSS class
    $tooltip.className = 'tooltip tooltip-continent';// Set tooltip class for continent
  } else {// Otherwise, it's a country
    // Country styling - use CSS class
    $tooltip.className = 'tooltip tooltip-country';// Set tooltip class for country
  }
}

function handleMouseLeave() {// Hides tooltip on mouse leave
  $tooltip.style.opacity = 0;// Set tooltip opacity to 0 (invisible) when mouse leaves
  // Optional: Reset class when hidden
  $tooltip.className = 'tooltip';// Reset tooltip class to default
}

// Hides tooltip
function handleMouseLeave() {// Hides tooltip on mouse leave
  $tooltip.style.opacity = 0;// Set tooltip opacity to 0 (invisible) when mouse leaves
}

// Handles continent click - shows continent-level data
async function handleContinentClick(feature) {// feature = GeoJSON feature of clicked continent
  if (!feature || inFlight) return;// Ignore if no feature or request already in flight
  inFlight = true;// Mark request as in flight
  showLoading(true);// Show loading indicator
  
  const contName = feature.properties?.name || 'Selected continent';// Get continent name or default
  
  // Update UI
  setPanelMode('Continent overview');// Set side panel to continent overview mode
  setTitle(contName);// Update title to continent name
  dataContextEl.textContent = 'Aggregating continent-wide data...';// Update context message
  toggleBackButton(true);// Show back button
  
  try {// Try-catch block for error handling
    // Ensure data is loaded
    await ensureDataReady();// Wait for data to be ready
    if (preloadError) throw preloadError;// Throw error if preload failed
    
    // Update state
    state.continentName = contName;// Set selected continent in state
    state.countryId = null;// Clear selected country
    
    // Calculate summary
    const summary = summarizeContinent(contName);// Summarize continent data
    
    // Update visualization
    updateContinentLayerState();// Update continent layer visual state
    updateCountryLayerState();// Update country layer visual state
    zoomToFeature(feature);// Zoom map to continent
    
    // Display summary
    applyContinentSummary(summary, contName);// Show continent summary in side panel
  } catch (err) {// Handle errors
    console.error(err);// Log error to console
    setAllStatuses('Request failed: unexpected error.');// Update status message  
    dataContextEl.textContent = 'Unable to load continent aggregates right now.';// Update context message
  } finally {// Always execute cleanup
    showLoading(false);// Hide loading indicator  
    inFlight = false;// Mark request as complete
  }
}

// Handles country click - shows country-level data
async function handleCountryClick(feature) {// feature = GeoJSON feature of clicked country
  if (!feature || !state.continentName || inFlight) return;// Ignore if no feature, no continent selected, or request already in flight
  const contName = continentByCountryId.get(feature.id);// Get continent name for clicked country
  if (!contName || contName !== state.continentName) return;// Ignore if country not in selected continent
  
  inFlight = true;// Mark request as in flight
  showLoading(true);// Show loading indicator
  
  try {// Try-catch block for error handling
    await ensureDataReady();// Ensure data is loaded
    if (preloadError) throw preloadError;// Throw error if preload failed
    
    // Update state
    state.countryId = parseInt(feature.id, 10);// Set selected country ID in state
    updateCountryLayerState();// Update country layer visual state
    
    // Load and display country data
    await hydrateCountryPanel(feature);// Show country data in side panel
    
    // Update UI
    setPanelMode('Country profile');// Set side panel to country profile mode
    dataContextEl.textContent = 'Country-level figures pulled directly from cached Wikidata tables.';// Update context message
  } catch (err) {// Handle errors
    console.error(err);// Log error to console
    setAllStatuses('Request failed: unexpected error.');// Update status message
  } finally {// Always execute cleanup
    showLoading(false);// Hide loading indicator
    inFlight = false;// Mark request as complete
  }
}

// ============================================
// DATA PROCESSING FUNCTIONS
// ============================================

// Calculates summary statistics for a continent
function summarizeContinent(name) {// name = Continent name
  const list = countriesByContinent.get(name) || [];// Get list of countries in continent or empty array
  const isoList = list.map(c => parseInt(c.id, 10)).filter(Number.isFinite);// Extract ISO numeric codes of countries
  
  // Initialize summary object
  const summary = {// Object to hold aggregated summary data
    totalCountries: list.length,// Total number of countries in continent  
    endemicCount: 0,// Number of countries with endemic species data
    gdpCount: 0,// Number of countries with GDP data
    popCount: 0,// Number of countries with population data
    totalEndemic: 0,// Total endemic species count
    threatened: 0,// Total threatened endemic species count
    nt: 0,// Near threatened count
    vu: 0,// Vulnerable count
    en: 0,// Endangered count
    cr: 0,// Critically endangered count
    gdpUSD: 0,// Total GDP in USD
    population: 0,// Total population
    gdpYears: new Set(),// Set of years for GDP data
    popYears: new Set()// Set of years for population data
  };//all of the variables are set to zero or empty for initialization
  
  // Aggregate(combine individual data points into summarized totals) data from all countries in continent
  for (const iso of isoList) {// Loop through each country's ISO numeric code
    // Endemic species data
    const eRow = endemicTable?.get(iso);// Get endemic data row for country
    if (eRow) {// If endemic data exists
      summary.endemicCount++;// Increment count of countries with endemic data
      summary.totalEndemic += eRow.totalEndemicSpecies || 0;// Add to total endemic species count
      const nt = eRow.nearThreatenedEndemicSpecies || 0;// Near threatened count
      const vu = eRow.vulnerableEndemicSpecies || 0;// Vulnerable count
      const en = eRow.endangeredEndemicSpecies || 0;// Endangered count
      const cr = eRow.criticallyEndangeredEndemicSpecies || 0;// Critically endangered count
      summary.nt += nt;// Aggregate threatened species counts
      summary.vu += vu;// Aggregate threatened species counts
      summary.en += en;// Aggregate threatened species counts
      summary.cr += cr;// Aggregate threatened species counts
      summary.threatened += nt + vu + en + cr;// Total threatened species
    }
    
    // GDP data
    const gRow = gdpTable?.get(iso);// Get GDP data row for country
    if (gRow) {// If GDP data exists
      summary.gdpCount++;// Increment count of countries with GDP data
      summary.gdpUSD += gRow.gdpUSD || 0;// Add to total GDP
      if (gRow.gdpYear) summary.gdpYears.add(gRow.gdpYear);// Collect GDP year
    }
    
    // Population data
    const pRow = populationTable?.get(iso);// Get population data row for country
    if (pRow) {// If population data exists
      summary.popCount++;// Increment count of countries with population data
      summary.population += pRow.population || 0;// Add to total population
      if (pRow.popYear) summary.popYears.add(pRow.popYear);// Collect population year
    }
  }
  
  // Format year information
  summary.gdpYearNote = formatYearNote(summary.gdpYears);// Create readable GDP year note
  summary.popYearNote = formatYearNote(summary.popYears);// Create readable population year note
  
  // Create description
  summary.note = summary.totalCountries// If there are countries in the continent
    ? `Aggregated from ${summary.totalCountries} countries (${summary.endemicCount || 0} with endemic data).`// Summary note about data availability
    : 'No linked countries found for this continent yet.';// Summary note about data availability
  
  return summary;// Return the aggregated summary object
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

// ============================================
// MAP STATE MANAGEMENT
// ============================================

// Updates continent layer visual state
function updateContinentLayerState() {// Updates continent layer visual state
  if (!continentLayer) return;// Exit if continent layer not initialized
  continentLayer.selectAll('path')// Select all continent paths
    .classed('continent-selected', d => state.continentName && (d.properties?.name === state.continentName))//class for selected continent
    .classed('continent-dim', d => state.continentName && (d.properties?.name !== state.continentName));// Dim non-selected continents when one is selected
}

// Updates country layer visual state
function updateCountryLayerState() {// Updates country layer visual state
  if (!countryLayer) return;// Exit if country layer not initialized
  const active = Boolean(state.continentName);// Country layer active if a continent is selected
  countryLayer.classed('active', active);// Set active class based on continent selection
  countryLayer.selectAll('path')// Select all country paths
    .classed('country-muted', d => active && continentByCountryId.get(d.id) !== state.continentName)// Dim countries not in selected continent
    .classed('country-selected', d => state.countryId === parseInt(d.id, 10));//class for selected country
}

// Zooms map to focus on a feature using the biggest box that fits in the target area
function zoomToFeature(feature) {// feature = GeoJSON feature to zoom to
  if (!feature || !path) return;// Exit if no feature or path generator
  
  const [[x0, y0], [x1, y1]] = path.bounds(feature);// Get bounding box of feature
  const w = parseFloat(svg.attr('width')) || 800;// Get SVG width with default
  const h = parseFloat(svg.attr('height')) || 500;//  Get SVG height with default
  const dx = x1 - x0;// Width of feature bounds
  const dy = y1 - y0;// Height of feature bounds
  const x = (x0 + x1) / 2;// Center X of feature bounds
  const y = (y0 + y1) / 2;// Center Y of feature bounds
  
  const scale = Math.min(8, 0.85 / Math.max(dx / w, dy / h));// Calculate scale factor with max zoom limit
  const translate = [w / 2 - scale * x, h / 2 - scale * y];// Calculate translation to center feature
  
  svg.transition().duration(850).call(// Smoothly transition to new zoom/translate
    zoomBehavior.transform,// Apply transform to zoom behavior
    d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)// Create new transform with calculated translate and scale
  );
}

// Resets zoom to show entire world
function resetZoom() {// Resets zoom to show entire world, the function is called the "Back to continents" button is pressed 
  svg.transition().duration(650).call(zoomBehavior.transform, d3.zoomIdentity);// Smoothly transition back to identity transform (no zoom/pan)
}

// Returns to world/continent view
function resetToContinents() {// Resets state and UI to continent overview
  // Reset state
  state.continentName = null;// Clear selected continent
  state.countryId = null;// Clear selected country
  
  // Update UI
  setPanelMode('Continent overview');// Set side panel to continent overview mode
  setTitle('Select a continent');// Update title
  dataContextEl.textContent = 'Select a continent to see aggregated totals.';// Update context message
  clearPanel();// Clear existing panel data
  
  // Update visualization
  updateContinentLayerState();// Ensure continent layer reflects current state
  updateCountryLayerState();// Ensure country layer reflects current state
  toggleBackButton(false);// Hide back button
  countryLayer?.classed('active', false);// Deactivate country layer
  
  // Reset zoom
  resetZoom();// Zoom out to show entire world
}

// Shows/hides back button
function toggleBackButton(active) {// active = true to show, false to hide
  if (backBtn) backBtn.disabled = !active;// Enable or disable back button based on active state
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

// ============================================
// DATA LOADING FUNCTIONS
// ============================================

// Ensures all data tables are loaded
async function ensureDataReady() {// Ensures all data tables are loaded
  if (endemicTable && gdpTable && populationTable) return;// Return if all tables are already loaded
  
  try {// Try to load data
    await preloadAllTables();// Load all data tables
  } catch (err) {// Handle errors
    preloadError = err;// Store preload error
    throw err;// Rethrow error for caller to handle
  }
}

// Loads all data tables from Wikidata
async function preloadAllTables() {// Loads all data tables from Wikidata
  // Load endemic species data
  const endData = await runSparqlGETWithRetry(Q_END_EMD);// Execute SPARQL query with retry logic
  endemicTable = buildEndemicMap(endData);// Build endemic species data map

  // Load GDP data
  const gdpData = await runSparqlGETWithRetry(Q_GDP);// Execute SPARQL query with retry logic
  gdpTable = buildGdpMap(gdpData);// Build GDP data map

  // Load population data
  const popData = await runSparqlGETWithRetry(Q_POP);// Execute SPARQL query with retry logic
  populationTable = buildPopulationMap(popData);// Build population data map
}

// Executes SPARQL query with retry logic
async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400 } = {}) {// query = SPARQL query string, retries = number of retries, baseDelayMs = base delay in ms
  let attempt = 0;// Initialize attempt counter
  while (true) {// Retry loop with exponential backoff (400ms→800ms→800ms) + jitter(is random variation in timing added to prevent synchronization problems), max 3 attempts
    try {// Try to execute query
      const url = QLEVER + '?query=' + encodeURIComponent(query);// Construct full URL with encoded query
      const res = await fetch(url, { method: 'GET', headers: ACCEPT_JSON });// Execute HTTP GET request
      
      if (!res.ok) {// Check for HTTP errors
        if ((res.status === 429 || res.status === 403 || res.status === 503) && attempt < retries) {// Retry on rate limit or server errors
          attempt++;// Increment attempt counter
          await delayWithJitter(baseDelayMs, attempt);// Wait with jitter before retrying
          continue;// Retry the request
        }
        throw new Error(`QLever error ${res.status}`);// Throw error for other HTTP errors
      }
      return await res.json();// Parse and return JSON response
    } catch (e) {// Handle fetch errors
      if (attempt < retries) {// Retry on network errors
        attempt++;// Increment attempt counter
        await delayWithJitter(baseDelayMs, attempt);//  Wait with jitter before retrying
        continue;// Retry the request
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

// Start the application
boot();
