// Base URL for the QLever SPARQL API that serves Wikidata data as JSON
const QLEVER = 'https://qlever.dev/api/wikidata';

// HTTP header telling the server we want SPARQL results in JSON format
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };

// Minimum number of endemic species a country must have to be included in the correlation plots
const MIN_ENDEMIC = 50;

// Reference to the DOM element that shows status messages for the correlation visualisation
const statusEl = document.getElementById('vizStatus');

// Reference to the floating tooltip element used when hovering over scatterplot points
const tooltip = document.getElementById('vizTooltip');

// Formatter that turns integers into nicely formatted strings with thousands separators
const fmtInt = d3.format(',d');


// Main entry function that loads data and builds the correlation plots
async function initCorrelations() {
  setStatus('Loading live data from QLever…');                    // Show a loading message while data is being fetched
  try {
    const [endData, gdpData, popData] = await Promise.all([       // Run three SPARQL queries in parallel and wait for all to finish
      runSparqlGETWithRetry(Q_END_EMD),                           // Query for endemic species and threat categories
      runSparqlGETWithRetry(Q_GDP),                               // Query for GDP data
      runSparqlGETWithRetry(Q_POP)                                // Query for population data
    ]);
    const endemicTable = buildEndemicMap(endData);                // Convert endemic species response into a Map keyed by country ISO code
    const gdpTable = buildGdpMap(gdpData);                        // Convert GDP response into a Map keyed by ISO code
    const populationTable = buildPopulationMap(popData);          // Convert population response into a Map keyed by ISO code
    const dataset = combineDataset(endemicTable, gdpTable, populationTable); // Merge all three Maps into a single array of country objects
    if (!dataset.length) {                                        // If no country passes the filters
      setStatus('No countries meet the minimum endemic species threshold yet.'); // Inform the user there is nothing to plot
      return;                                                     // Stop early
    }
    setStatus(`Loaded ${dataset.length} countries (≥ ${MIN_ENDEMIC} endemic species).`); // Show how many countries are used
    renderCharts(dataset);                                        // Draw both correlation charts (GDP and population)
  } catch (err) {
    console.error(err);                                           // Log the error for debugging in the console
    setStatus('Unable to fetch data from the SPARQL endpoint right now. Please retry.'); // Show a user-friendly error
  }
}

// Helper to update the status message in the UI
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;                      // If the status element exists, set its text
}

// Combines endemic, GDP, and population tables into one array used for plotting
function combineDataset(endemicTable, gdpTable, populationTable) {
  const rows = [];                                                // This will store the final list of country-level records
  endemicTable.forEach((endRow, isoNumeric) => {                  // Loop through each country in the endemic species table
    const gRow = gdpTable.get(isoNumeric);                        // Find the matching GDP row for this country
    const pRow = populationTable.get(isoNumeric);                 // Find the matching population row for this country
    if (!gRow || !pRow) return;                                   // Skip this country if either GDP or population is missing

    const total = +(endRow.totalEndemicSpecies || 0);             // Read total endemic species, defaulting to 0
    const nt = +(endRow.nearThreatenedEndemicSpecies || 0);       // Read near-threatened species count
    const vu = +(endRow.vulnerableEndemicSpecies || 0);           // Read vulnerable species count
    const en = +(endRow.endangeredEndemicSpecies || 0);           // Read endangered species count
    const cr = +(endRow.criticallyEndangeredEndemicSpecies || 0); // Read critically endangered species count
    const threatened = nt + vu + en + cr;                         // Total threatened endemic species across four categories

    if (!Number.isFinite(total) || total < MIN_ENDEMIC || total === 0) return; // Skip countries with too few or invalid totals

    const fraction = threatened / total;                          // Compute threatened / total endemic as a fraction between 0 and 1

    rows.push({                                                   // Add a combined record for this country
      isoNumeric,                                                 // Numeric ISO code
      countryLabel: endRow.countryLabel || gRow.countryLabel || pRow.countryLabel || `ISO ${isoNumeric}`, // Best available country name
      totalEndemic: total,                                        // Total number of endemic species
      threatenedEndemic: threatened,                              // Total number of threatened endemic species
      fraction,                                                   // Fraction of endemic species that are threatened
      gdpUSD: +(gRow.gdpUSD || 0),                                // Latest GDP value in USD
      gdpYear: gRow.gdpYear || '',                                // Year of GDP measurement
      population: +(pRow.population || 0),                        // Latest population
      popYear: pRow.popYear || ''                                 // Year of population measurement
    });
  });
  return rows;                                                    // Return the full dataset array for plotting
}

// Renders both correlation charts: one vs GDP and one vs population
function renderCharts(data) {
  const configs = [                                               // Configuration objects describing each scatterplot
    {
      svgId: 'chartGDP',                                          // ID of the SVG element for the GDP chart
      statsId: 'statsGDP',                                        // ID of the stats container for the GDP regression summary
      xField: 'gdpUSD',                                           // X-axis uses GDP values
      xLabelBase: 'GDP (USD)',                                    // Base label for the X-axis
      tooltipFmt: (d) => formatNumber(d.gdpUSD, 'usd'),           // Function to format GDP numbers in the tooltip
      tooltipLabel: 'GDP',                                        // Human-readable label shown in tooltip
      domainPadding: 0.12                                         // Extra space added to the right side of the X-axis
    },
    {
      svgId: 'chartPOP',                                          // ID of the SVG element for the population chart
      statsId: 'statsPOP',                                        // ID of the stats container for population regression summary
      xField: 'population',                                       // X-axis uses population values
      xLabelBase: 'Population',                                   // Base X-axis label for population
      tooltipFmt: (d) => formatNumber(d.population, 'pop'),       // Function to format population numbers in the tooltip
      tooltipLabel: 'Population',                                 // Label in tooltip for X-axis value
      domainPadding: 0.08                                         // Extra X-axis padding for population chart
    }
  ];

  configs.forEach(cfg => renderScatter(cfg, data));               // For each configuration, draw a scatterplot with regression line
}

// Draws a single scatterplot and regression line based on the provided configuration
function renderScatter(cfg, data) {
  const svg = d3.select(`#${cfg.svgId}`);                         // Select the target SVG by ID
  if (svg.empty()) return;                                        // If the SVG is missing, do nothing
  svg.selectAll('*').remove();                                    // Clear any previous drawing in the SVG

  const maxRaw = d3.max(data, d => d[cfg.xField]) || 0;           // Find the maximum raw X value across all countries
  const scale = chooseScale(maxRaw, cfg.xLabelBase || cfg.xLabel);// Decide whether to use millions, billions, or trillions for axis units
  const factor = scale.factor || 1;                               // Factor by which raw values will be divided
  const xLabel = scale.label || (cfg.xLabelBase || '');           // Final X-axis label with unit

  const filtered = data                                           // Build the list of points to plot
    .filter(row => Number.isFinite(row[cfg.xField]) && row[cfg.xField] > 0) // Only keep countries with valid positive X values
    .map(row => ({
      ...row,
      x: row[cfg.xField] / factor,                                // Normalised X value scaled by factor
      y: row.fraction                                             // Y value is the threatened fraction (0–1)
    }));

  if (!filtered.length) {                                         // If there are no valid points, show a message instead of a chart
    svg.append('text').attr('x', 12).attr('y', 24).attr('fill', '#a8b3c7').text('No data available.');
    const statsSlot = document.getElementById(cfg.statsId);        // Find stats container for this chart
    if (statsSlot) statsSlot.textContent = 'No data available.';   // Show the same message there
    return;                                                        // Stop drawing this chart
  }

  const margin = { top: 24, right: 28, bottom: 60, left: 60 };    // Margins around the plotting area
  const width = Math.min(550, svg.node().parentNode?.clientWidth || 520); // Width depends on container width, with an upper limit
  const height = 360;                                             // Fixed height of the chart
  svg.attr('width', width).attr('height', height);                // Apply size to the SVG

  const xMax = d3.max(filtered, d => d.x) || 1;                   // Maximum X value after scaling
  const yMax = d3.max(filtered, d => d.y) || 0.2;                 // Maximum Y value (threatened fraction) in the sample

  const x = d3.scaleLinear()                                     // Create linear X scale
    .domain([0, xMax * (1 + (cfg.domainPadding || 0.1))])        // Domain starts at 0 and adds some extra padding above max value
    .range([margin.left, width - margin.right]);                 // Map domain to pixel range inside margins

  const regression = linearRegression(filtered);                  // Compute linear regression values from the (x, y) pairs
  const predicted = regression.intercept + regression.slope * x.domain()[1]; // Predicted Y value at the right end of X domain
  const yMaxCandidate = Math.max(yMax, regression.intercept, predicted, 0.05); // Choose a Y max that fits both data and regression line

  const y = d3.scaleLinear()                                     // Create linear Y scale (0 to max fraction)
    .domain([0, Math.min(1, yMaxCandidate * 1.15)])              // Limit max Y to 1 and add extra padding
    .range([height - margin.bottom, margin.top]);                // Map Y values to pixel space (top-bottom inverted)

  const group = svg.append('g');                                 // Main group container for all chart elements

  const linePoints = [                                           // Two points defining the regression line segment
    { x: 0, y: regression.intercept },                           // Left end of the regression line
    { x: x.domain()[1], y: regression.intercept + regression.slope * x.domain()[1] } // Right end of line
  ];

  group.append('g')                                              // Add the X-axis group
    .attr('transform', `translate(0,${height - margin.bottom})`) // Position at the bottom of the chart
    .call(d3.axisBottom(x))                                      // Draw the X-axis using the X scale
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px')) // Style axis labels
    .call(g => g.selectAll('line,path').attr('stroke', '#2a5c27ff')); // Style axis line and ticks

  group.append('g')                                              // Add the Y-axis group
    .attr('transform', `translate(${margin.left},0)`)            // Position at left margin
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.0%')))  // Draw Y-axis with percentage tick labels
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px')) // Style axis text
    .call(g => g.selectAll('line,path').attr('stroke', '#2a5c27ff')); // Style axis lines

  group.append('text')                                           // Add X-axis label text
    .attr('x', width / 2)
    .attr('y', height - 18)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a8b3c7')
    .attr('font-size', 12)
    .text(xLabel);                                               // Use the label chosen by chooseScale

  group.append('text')                                           // Add Y-axis label text
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a8b3c7')
    .attr('font-size', 12)
    .text('Endangered / total endemic');                         // Fixed Y-axis label

  group.selectAll('circle')                                      // Draw one circle per country
    .data(filtered)
    .join('circle')
    .attr('cx', d => x(d.x))                                     // Horizontal position from X value
    .attr('cy', d => y(d.y))                                     // Vertical position from Y value
    .attr('r', 5)                                                // Circle radius
    .attr('fill', '#99ff74ff')                                     // Circle color
    .attr('opacity', 0.9)                                        // Slight transparency
    .on('mouseenter', (event, d) => showTooltip(event, d, cfg, svg.node())) // Show tooltip when mouse enters
    .on('mousemove', (event, d) => showTooltip(event, d, cfg, svg.node()))  // Update tooltip position on move
    .on('mouseleave', hideTooltip);                              // Hide tooltip when mouse leaves

  group.append('line')                                           // Draw the regression line on top of points
    .attr('x1', x(linePoints[0].x))
    .attr('y1', y(linePoints[0].y))
    .attr('x2', x(linePoints[1].x))
    .attr('y2', y(linePoints[1].y))
    .attr('stroke', '#f6c177')                                   // Line color
    .attr('stroke-width', 2);                                    // Line thickness

  writeStats(cfg.statsId, regression, filtered.length);          // Write regression statistics into the legend panel
}

// Shows the tooltip near the mouse cursor with details about a point
function showTooltip(event, datum, cfg, svgNode) {
  if (!tooltip) return;                                          // If no tooltip element, do nothing
  tooltip.style.opacity = '1';                                   // Make the tooltip visible
  tooltip.setAttribute('aria-hidden', 'false');                  // Update accessibility attribute

  const x = event.pageX || event.clientX || 0;                   // X position of the mouse
  const y = event.pageY || event.clientY || 0;                   // Y position of the mouse
  const left = x + 14;                                           // Horizontal offset for tooltip
  const top = y - 12;                                            // Vertical offset for tooltip

  const maxLeft = window.innerWidth - 240;                       // Right boundary to avoid cutting off tooltip
  const maxTop = window.innerHeight - 120;                       // Bottom boundary to avoid cutting off tooltip

  tooltip.style.left = `${Math.min(left, maxLeft)}px`;           // Set tooltip X position within bounds
  tooltip.style.top = `${Math.min(top, maxTop)}px`;              // Set tooltip Y position within bounds

  tooltip.innerHTML = `                                          
    <strong>${datum.countryLabel}</strong><br>
    Threatened fraction: ${(datum.y * 100).toFixed(1)}%<br>
    ${cfg.tooltipLabel || cfg.xLabel}: ${cfg.tooltipFmt(datum)}<br>
    Total endemic: ${fmtInt(datum.totalEndemic)} | Threatened: ${fmtInt(datum.threatenedEndemic)}
  `;
}

// Hides the tooltip from view
function hideTooltip() {
  if (!tooltip) return;                                          // If no tooltip element, exit
  tooltip.style.opacity = '0';                                   // Make it invisible
  tooltip.setAttribute('aria-hidden', 'true');                   // Update accessibility attribute
}

// Writes regression statistics (slope, intercept, r, R²) into a target HTML element
function writeStats(targetId, regression, n) {
  const el = document.getElementById(targetId);                  // Find the stats container by ID
  if (!el) return;                                               // If missing, do nothing

  const slope = regression.slope?.toFixed(4) || '0';             // Format slope to 4 decimal places
  const intercept = regression.intercept?.toFixed(4) || '0';     // Format intercept
  const r = regression.r?.toFixed(3) || '0';                     // Format correlation coefficient r
  const r2 = regression.r2?.toFixed(3) || '0';                   // Format R² value

  el.innerHTML = `                                               
    <p><strong>Linear regression</strong> (y = a·x + b)</p>
    <p>n = ${n}</p>
    <p>a (slope) ≈ ${slope}</p>
    <p>b (intercept) ≈ ${intercept}</p>
    <p>r ≈ ${r}</p>
    <p>R² ≈ ${r2}</p>
  `;
}

// Computes simple linear regression and correlation statistics for an array of points {x, y}
function linearRegression(points) {
  const n = points.length;                                      // Number of data points
  if (!n) return { slope: 0, intercept: 0, r: 0, r2: 0 };       // If no points, return zeroed stats

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;      // Running sums for regression formula

  points.forEach(p => {                                         // Loop over each point
    sumX += p.x;                                                // Sum of x
    sumY += p.y;                                                // Sum of y
    sumXY += p.x * p.y;                                         // Sum of x*y
    sumXX += p.x * p.x;                                         // Sum of x^2
    sumYY += p.y * p.y;                                         // Sum of y^2
  });

  const denom = n * sumXX - sumX * sumX;                        // Denominator for slope calculation
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0; // Compute slope or 0 if denominator is zero
  const intercept = (sumY - slope * sumX) / n;                  // Compute intercept using mean values

  const rDenom = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY)); // Denominator for correlation coefficient
  const r = rDenom ? (n * sumXY - sumX * sumY) / rDenom : 0;    // Compute Pearson correlation or 0 if invalid

  return { slope, intercept, r, r2: r * r };                    // Return slope, intercept, r, and R²
}

// Chooses an appropriate scale (millions, billions, trillions) for the X-axis based on the maximum value
function chooseScale(maxVal, baseLabel) {
  if (!maxVal || maxVal <= 0) return { factor: 1, label: baseLabel }; // If no valid value, do not scale
  if (maxVal >= 1e12) return { factor: 1e12, label: `${baseLabel} (trillions)` }; // Use trillions if values are huge
  if (maxVal >= 1e9) return { factor: 1e9, label: `${baseLabel} (billions)` };    // Use billions for large numbers
  return { factor: 1e6, label: `${baseLabel} (millions)` };                        // Otherwise use millions
}

// Runs a SPARQL GET request with automatic retries and exponential backoff
async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400 } = {}) {
  let attempt = 0;                                              // Count how many attempts have been made
  while (true) {                                                // Keep trying until success or retries exhausted
    try {
      const res = await fetch(`${QLEVER}?query=${encodeURIComponent(query)}`, { headers: ACCEPT_JSON }); // Send request to QLever
      if (!res.ok) throw new Error(`HTTP ${res.status}`);       // Throw an error if HTTP status is not OK (200)
      return await res.json();                                  // Parse and return JSON if successful
    } catch (err) {
      attempt++;                                                // Increment attempt counter
      if (attempt > retries) throw err;                         // If too many retries, rethrow the error
      const delay = baseDelayMs * Math.pow(2, attempt - 1);     // Calculate exponential backoff delay
      await new Promise(resolve => setTimeout(resolve, delay)); // Wait for the delay before retrying
    }
  }
}

// SPARQL query that returns endemic species counts and threat categories per country
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

// SPARQL query that returns the latest GDP value and year per country
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

// SPARQL query that returns the latest population value and year per country
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

// Builds a Map of endemic species data keyed by ISO numeric country code
function buildEndemicMap(json) {
  const m = new Map();                                           // New Map to store country data
  const rows = json?.results?.bindings || [];                    // Safely get the array of bindings from the SPARQL JSON
  for (const r of rows) {                                        // Loop over each result row
    const isoNumStr = r.isoNum?.value;                           // Read ISO numeric code as a string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;    // Convert it to a number
    if (!Number.isFinite(isoInt)) continue;                      // Skip if ISO numeric is missing or invalid

    const nt = +(r.nearThreatenedEndemicSpecies?.value || 0);    // Parse near-threatened count
    const vu = +(r.vulnerableEndemicSpecies?.value || 0);        // Parse vulnerable count
    const en = +(r.endangeredEndemicSpecies?.value || 0);        // Parse endangered count
    const cr = +(r.criticallyEndangeredEndemicSpecies?.value || 0); // Parse critically endangered count

    m.set(isoInt, {                                              // Store all data for this country in the Map
      countryLabel: r.countryLabel?.value || '',                 // Country name (or empty string)
      iso3: r.iso3?.value || '',                                 // ISO-3 code
      isoNum: isoNumStr,                                         // ISO numeric string
      totalEndemicSpecies: +(r.totalEndemicSpecies?.value || 0), // Total endemic species count
      nearThreatenedEndemicSpecies: nt,                          // NT count
      vulnerableEndemicSpecies: vu,                              // VU count
      endangeredEndemicSpecies: en,                              // EN count
      criticallyEndangeredEndemicSpecies: cr                     // CR count
    });
  }
  return m;                                                      // Return the completed Map
}

// Builds a Map of GDP data keyed by ISO numeric country code
function buildGdpMap(json) {
  const m = new Map();                                           // New Map for GDP data
  const rows = json?.results?.bindings || [];                    // Extract rows from SPARQL JSON
  for (const r of rows) {                                        // Loop over rows
    const isoNumStr = r.isoNum?.value;                           // ISO numeric as string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;    // Convert to integer
    if (!Number.isFinite(isoInt)) continue;                      // Skip invalid rows

    m.set(isoInt, {                                              // Store GDP info for this country
      countryLabel: r.countryLabel?.value || '',                 // Country label
      iso3: r.iso3?.value || '',                                 // ISO-3 code
      isoNum: isoNumStr,                                         // ISO numeric string
      gdpUSD: +(r.gdpUSD?.value || 0),                           // GDP in USD
      gdpYear: r.gdpYear?.value || ''                            // Year as string
    });
  }
  return m;                                                      // Return GDP Map
}

// Builds a Map of population data keyed by ISO numeric country code
function buildPopulationMap(json) {
  const m = new Map();                                           // New Map for population data
  const rows = json?.results?.bindings || [];                    // Extract rows
  for (const r of rows) {                                        // Loop each row
    const isoNumStr = r.isoNum?.value;                           // ISO numeric string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;    // Convert to number
    if (!Number.isFinite(isoInt)) continue;                      // Skip invalid
    m.set(isoInt, {                                              // Store population info
      countryLabel: r.countryLabel?.value || '',                 // Country name
      iso3: r.iso3?.value || '',                                 // ISO-3 code
      isoNum: isoNumStr,                                         // ISO numeric string
      population: +(r.population?.value || 0),                   // Population value
      popYear: r.popYear?.value || ''                            // Year
    });
  }
  return m;                                                      // Return population Map
}

// Formats large numbers nicely for tooltips depending on whether it's GDP or population
function formatNumber(value, type) {
  if (!Number.isFinite(value)) return '—';                       // Show dash if value is not a number
  if (type === 'usd') {                                          // When formatting GDP
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} T USD`; // Trillions with 2 decimals
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B USD`;   // Billions
    return `${fmtInt(Math.round(value))} USD`;                      // Otherwise plain integer USD
  }
  if (type === 'pop') {                                          // When formatting population
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B people`; // Billions of people
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} M people`; // Millions of people
    return `${fmtInt(Math.round(value))} people`;                   // Otherwise plain number of people
  }
  return fmtInt(Math.round(value));                              // Fallback generic formatting
}

// Starts the entire data loading and correlation plotting process
initCorrelations();
