const QLEVER = 'https://qlever.dev/api/wikidata';                                   // SPARQL endpoint URL
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };                // HTTP headers for JSON response
const MIN_ENDEMIC = 50;                                                             // Minimum endemic species count filter

const statusEl = document.getElementById('vizStatus');                              // Status display element reference
const tooltip = document.getElementById('vizTooltip');                              // Tooltip element reference
const fmtInt = d3.format(',d');                                                     // D3 number formatter with commas

async function initCorrelations() {                                                 // Main initialization function
  setStatus('Loading live data from QLever…');                                      // Update loading status
  try {                                                                             // Try block for error handling
    const [endData, gdpData, popData] = await Promise.all([                         // Fetch all datasets in parallel
      runSparqlGETWithRetry(Q_END_EMD),                                             // Endemic species data
      runSparqlGETWithRetry(Q_GDP),                                                 // GDP data
      runSparqlGETWithRetry(Q_POP)                                                  // Population data
    ]);
    const endemicTable = buildEndemicMap(endData);                                  // Parse endemic data to Map
    const gdpTable = buildGdpMap(gdpData);                                          // Parse GDP data to Map
    const populationTable = buildPopulationMap(popData);                            // Parse population data to Map
    const dataset = combineDataset(endemicTable, gdpTable, populationTable);        // Combine all datasets
    if (!dataset.length) {                                                          // Check if dataset is empty
      setStatus('No countries meet the minimum endemic species threshold yet.');    // Update status message
      return;                                                                       // Exit function
    }
    setStatus(`Loaded ${dataset.length} countries (≥ ${MIN_ENDEMIC} endemic species).`); // Success message
    renderCharts(dataset);                                                          // Render correlation charts
  } catch (err) {                                                                   // Catch any errors
    console.error(err);                                                             // Log error to console
    setStatus('Unable to fetch data from the SPARQL endpoint right now. Please retry.'); // Error message
  }
}

function setStatus(text) {                                                          // Function to update status display
  if (statusEl) statusEl.textContent = text;                                        // Update if element exists
}

function combineDataset(endemicTable, gdpTable, populationTable) {                  // Combine three datasets into one
  const rows = [];                                                                  // Initialize result array
  endemicTable.forEach((endRow, isoNumeric) => {                                    // Iterate through endemic data
    const gRow = gdpTable.get(isoNumeric);                                          // Get matching GDP data
    const pRow = populationTable.get(isoNumeric);                                   // Get matching population data
    if (!gRow || !pRow) return;                                                     // Skip if missing data
    const total = +(endRow.totalEndemicSpecies || 0);                               // Convert total to number
    const nt = +(endRow.nearThreatenedEndemicSpecies || 0);                         // Convert NT count to number
    const vu = +(endRow.vulnerableEndemicSpecies || 0);                             // Convert VU count to number
    const en = +(endRow.endangeredEndemicSpecies || 0);                             // Convert EN count to number
    const cr = +(endRow.criticallyEndangeredEndemicSpecies || 0);                   // Convert CR count to number
    const threatened = nt + vu + en + cr;                                           // Calculate total threatened
    if (!Number.isFinite(total) || total < MIN_ENDEMIC || total === 0) return;      // Apply minimum threshold filter
    const fraction = threatened / total;                                             // Calculate threatened fraction
    rows.push({                                                                     // Add combined row to array
      isoNumeric,                                                                   // ISO numeric code
      countryLabel: endRow.countryLabel || gRow.countryLabel || pRow.countryLabel || `ISO ${isoNumeric}`, // Country name
      totalEndemic: total,                                                          // Total endemic species
      threatenedEndemic: threatened,                                                // Threatened endemic species
      fraction,                                                                     // Threatened fraction (0-1)
      gdpUSD: +(gRow.gdpUSD || 0),                                                  // GDP in USD
      gdpYear: gRow.gdpYear || '',                                                  // Year of GDP data
      population: +(pRow.population || 0),                                          // Population count
      popYear: pRow.popYear || ''                                                   // Year of population data
    });
  });
  return rows;                                                                      // Return combined dataset
}

function renderCharts(data) {                                                       // Function to render both charts
  const configs = [                                                                 // Configuration for each chart
    {                                                                               // GDP chart configuration
      svgId: 'chartGDP',                                                            // SVG element ID
      statsId: 'statsGDP',                                                          // Statistics display ID
      xField: 'gdpUSD',                                                             // Data field for x-axis
      xLabelBase: 'GDP (USD)',                                                      // Base label for x-axis
      tooltipFmt: (d) => formatNumber(d.gdpUSD, 'usd'),                             // Tooltip formatting function
      tooltipLabel: 'GDP',                                                          // Tooltip label
      domainPadding: 0.12                                                           // X-axis domain padding
    },
    {                                                                               // Population chart configuration
      svgId: 'chartPOP',                                                            // SVG element ID
      statsId: 'statsPOP',                                                          // Statistics display ID
      xField: 'population',                                                         // Data field for x-axis
      xLabelBase: 'Population',                                                     // Base label for x-axis
      tooltipFmt: (d) => formatNumber(d.population, 'pop'),                         // Tooltip formatting function
      tooltipLabel: 'Population',                                                   // Tooltip label
      domainPadding: 0.08                                                           // X-axis domain padding
    }
  ];

  configs.forEach(cfg => renderScatter(cfg, data));                                 // Render each chart
}

function renderScatter(cfg, data) {                                                 // Function to render a scatter plot
  const svg = d3.select(`#${cfg.svgId}`);                                           // Select SVG element
  if (svg.empty()) return;                                                          // Exit if SVG doesn't exist
  svg.selectAll('*').remove();                                                      // Clear existing content

  const maxRaw = d3.max(data, d => d[cfg.xField]) || 0;                             // Find maximum x-value
  const scale = chooseScale(maxRaw, cfg.xLabelBase || cfg.xLabel);                  // Determine appropriate scale
  const factor = scale.factor || 1;                                                 // Division factor for display
  const xLabel = scale.label || (cfg.xLabelBase || '');                             // Final x-axis label

  const filtered = data                                                             // Filter and transform data
    .filter(row => Number.isFinite(row[cfg.xField]) && row[cfg.xField] > 0)         // Keep valid positive values
    .map(row => ({                                                                  // Transform each row
      ...row,                                                                       // Copy all properties
      x: row[cfg.xField] / factor,                                                  // Scale x-value
      y: row.fraction                                                               // y-value = threatened fraction
    }));

  if (!filtered.length) {                                                           // Check if any data remains
    svg.append('text').attr('x', 12).attr('y', 24).attr('fill', '#a8b3c7').text('No data available.'); // Show message
    const statsSlot = document.getElementById(cfg.statsId);                         // Get stats element
    if (statsSlot) statsSlot.textContent = 'No data available.';                    // Update stats display
    return;                                                                         // Exit function
  }

  const margin = { top: 24, right: 28, bottom: 60, left: 60 };                      // Chart margins
  const width = Math.min(550, svg.node().parentNode?.clientWidth || 520);           // Responsive width
  const height = 360;                                                               // Fixed height
  svg.attr('width', width).attr('height', height);                                  // Set SVG dimensions

  const xMax = d3.max(filtered, d => d.x) || 1;                                     // Maximum x-value after scaling
  const yMax = d3.max(filtered, d => d.y) || 0.2;                                   // Maximum y-value

  const x = d3.scaleLinear()                                                        // Create x-scale
    .domain([0, xMax * (1 + (cfg.domainPadding || 0.1))])                           // Domain with padding
    .range([margin.left, width - margin.right]);                                    // Pixel range

  const regression = linearRegression(filtered);                                    // Calculate linear regression
  const predicted = regression.intercept + regression.slope * x.domain()[1];        // Predicted y at max x
  const yMaxCandidate = Math.max(yMax, regression.intercept, predicted, 0.05);      // Ensure all points visible
  const y = d3.scaleLinear()                                                        // Create y-scale
    .domain([0, Math.min(1, yMaxCandidate * 1.15)])                                 // Domain with padding, max 1
    .range([height - margin.bottom, margin.top]);                                   // Pixel range (inverted)
  const group = svg.append('g');                                                    // Create main drawing group

  const linePoints = [                                                              // Regression line endpoints
    { x: 0, y: regression.intercept },                                              // Start at x=0
    { x: x.domain()[1], y: regression.intercept + regression.slope * x.domain()[1] } // End at max x
  ];

  group.append('g')                                                                 // Add x-axis
    .attr('transform', `translate(0,${height - margin.bottom})`)                    // Position at bottom
    .call(d3.axisBottom(x))                                                         // Create axis
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px')) // Style text
    .call(g => g.selectAll('line,path').attr('stroke', '#27335c'));                 // Style lines

  group.append('g')                                                                 // Add y-axis
    .attr('transform', `translate(${margin.left},0)`)                               // Position at left
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.0%')))                     // Create axis with % format
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px')) // Style text
    .call(g => g.selectAll('line,path').attr('stroke', '#27335c'));                 // Style lines

  group.append('text')                                                              // Add x-axis label
    .attr('x', width / 2)                                                           // Center horizontally
    .attr('y', height - 18)                                                         // Position above axis
    .attr('text-anchor', 'middle')                                                  // Center text
    .attr('fill', '#a8b3c7')                                                        // Text color
    .attr('font-size', 12)                                                          // Font size
    .text(xLabel);                                                                  // Label text

  group.append('text')                                                              // Add y-axis label
    .attr('transform', 'rotate(-90)')                                               // Rotate 90° counterclockwise
    .attr('x', -height / 2)                                                         // Center vertically
    .attr('y', 20)                                                                  // Position left of axis
    .attr('text-anchor', 'middle')                                                  // Center text
    .attr('fill', '#a8b3c7')                                                        // Text color
    .attr('font-size', 12)                                                          // Font size
    .text('Endangered / total endemic');                                            // Label text

  group.selectAll('circle')                                                         // Create data points
    .data(filtered)                                                                 // Bind data
    .join('circle')                                                                 // Create/update circles
    .attr('cx', d => x(d.x))                                                        // x-position
    .attr('cy', d => y(d.y))                                                        // y-position
    .attr('r', 5)                                                                   // Radius
    .attr('fill', '#74c0ff')                                                        // Blue color
    .attr('opacity', 0.9)                                                           // Slight transparency
    .on('mouseenter', (event, d) => showTooltip(event, d, cfg, svg.node()))         // Show tooltip on hover
    .on('mousemove', (event, d) => showTooltip(event, d, cfg, svg.node()))          // Update tooltip position
    .on('mouseleave', hideTooltip);                                                 // Hide tooltip

  group.append('line')                                                              // Add regression line
    .attr('x1', x(linePoints[0].x))                                                 // Start x
    .attr('y1', y(linePoints[0].y))                                                 // Start y
    .attr('x2', x(linePoints[1].x))                                                 // End x
    .attr('y2', y(linePoints[1].y))                                                 // End y
    .attr('stroke', '#f6c177')                                                      // Orange color
    .attr('stroke-width', 2);                                                       // Line thickness

  writeStats(cfg.statsId, regression, filtered.length);                             // Display regression statistics
}

function showTooltip(event, datum, cfg, svgNode) {                                  // Show tooltip on hover
  if (!tooltip) return;                                                             // Exit if no tooltip element
  tooltip.style.opacity = '1';                                                      // Make tooltip visible
  tooltip.setAttribute('aria-hidden', 'false');                                     // Accessibility: mark as visible
  const x = event.pageX || event.clientX || 0;                                      // Mouse x-coordinate
  const y = event.pageY || event.clientY || 0;                                      // Mouse y-coordinate
  const left = x + 14;                                                              // Position to right of cursor
  const top = y - 12;                                                               // Position above cursor
  const maxLeft = window.innerWidth - 240;                                          // Prevent going off right edge
  const maxTop = window.innerHeight - 120;                                          // Prevent going off bottom edge
  tooltip.style.left = `${Math.min(left, maxLeft)}px`;                              // Set left position
  tooltip.style.top = `${Math.min(top, maxTop)}px`;                                 // Set top position
  tooltip.innerHTML = `                                                             // Set tooltip content
    <strong>${datum.countryLabel}</strong><br>                                      // Country name
    Threatened fraction: ${(datum.y * 100).toFixed(1)}%<br>                         // Threatened percentage
    ${cfg.tooltipLabel || cfg.xLabel}: ${cfg.tooltipFmt(datum)}<br>                 // GDP/Population value
    Total endemic: ${fmtInt(datum.totalEndemic)} | Threatened: ${fmtInt(datum.threatenedEndemic)} // Species counts
  `;
}

function hideTooltip() {                                                            // Hide tooltip
  if (!tooltip) return;                                                             // Exit if no tooltip element
  tooltip.style.opacity = '0';                                                      // Make tooltip transparent
  tooltip.setAttribute('aria-hidden', 'true');                                      // Accessibility: mark as hidden
}

function writeStats(targetId, regression, n) {                                      // Display regression statistics
  const el = document.getElementById(targetId);                                     // Get target element
  if (!el) return;                                                                  // Exit if element doesn't exist
  const slope = regression.slope?.toFixed(4) || '0';                                // Format slope to 4 decimals
  const intercept = regression.intercept?.toFixed(4) || '0';                        // Format intercept to 4 decimals
  const r = regression.r?.toFixed(3) || '0';                                        // Format correlation coefficient to 3 decimals
  const r2 = regression.r2?.toFixed(3) || '0';                                      // Format R-squared to 3 decimals
  el.innerHTML = `                                                                  // Set HTML content
    <p><strong>Linear regression</strong> (y = a·x + b)</p>                         // Title
    <p>n = ${n}</p>                                                                 // Sample size
    <p>a (slope) ≈ ${slope}</p>                                                     // Slope
    <p>b (intercept) ≈ ${intercept}</p>                                             // Intercept
    <p>r ≈ ${r}</p>                                                                 // Correlation coefficient
    <p>R² ≈ ${r2}</p>                                                               // Coefficient of determination
  `;
}

function linearRegression(points) {                                                 // Calculate linear regression
  const n = points.length;                                                          // Number of data points
  if (!n) return { slope: 0, intercept: 0, r: 0, r2: 0 };                          // Default if no points
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;                         // Initialize sums
  points.forEach(p => {                                                             // Loop through points
    sumX += p.x;                                                                    // Sum of x values
    sumY += p.y;                                                                    // Sum of y values
    sumXY += p.x * p.y;                                                             // Sum of x*y products
    sumXX += p.x * p.x;                                                             // Sum of x squared
    sumYY += p.y * p.y;                                                             // Sum of y squared
  });
  const denom = n * sumXX - sumX * sumX;                                            // Denominator for slope calculation
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;                // Calculate slope
  const intercept = (sumY - slope * sumX) / n;                                      // Calculate intercept
  const rDenom = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));  // Denominator for r
  const r = rDenom ? (n * sumXY - sumX * sumY) / rDenom : 0;                        // Calculate correlation coefficient
  return { slope, intercept, r, r2: r * r };                                        // Return all values
}

function chooseScale(maxVal, baseLabel) {                                           // Determine appropriate scale for large numbers
  if (!maxVal || maxVal <= 0) return { factor: 1, label: baseLabel };               // No scaling needed
  if (maxVal >= 1e12) return { factor: 1e12, label: `${baseLabel} (trillions)` };   // Trillions scale
  if (maxVal >= 1e9) return { factor: 1e9, label: `${baseLabel} (billions)` };      // Billions scale
  return { factor: 1e6, label: `${baseLabel} (millions)` };                         // Millions scale
}

async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400 } = {}) { // Fetch with retry logic
  let attempt = 0;                                                                  // Attempt counter
  while (true) {                                                                    // Infinite loop (breaks on success or max retries)
    try {                                                                           // Try to fetch
      const res = await fetch(`${QLEVER}?query=${encodeURIComponent(query)}`, { headers: ACCEPT_JSON }); // Send request
      if (!res.ok) throw new Error(`HTTP ${res.status}`);                           // Check HTTP status
      return await res.json();                                                      // Return JSON response
    } catch (err) {                                                                 // Handle error
      attempt++;                                                                    // Increment attempt counter
      if (attempt > retries) throw err;                                             // Throw error if max retries reached
      const delay = baseDelayMs * Math.pow(2, attempt - 1);                         // Exponential backoff delay
      await new Promise(resolve => setTimeout(resolve, delay));                     // Wait before retrying
    }
  }
}

// SPARQL QUERIES (NO COMMENTS AS REQUESTED)
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

function buildEndemicMap(json) {                                                    // Parse endemic JSON into Map
  const m = new Map();                                                              // Create Map
  const rows = json?.results?.bindings || [];                                       // Get rows or empty array
  for (const r of rows) {                                                           // Loop through rows
    const isoNumStr = r.isoNum?.value;                                              // Get ISO numeric code string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;                       // Convert to integer
    if (!Number.isFinite(isoInt)) continue;                                         // Skip invalid ISO codes
    const nt = +(r.nearThreatenedEndemicSpecies?.value || 0);                       // NT count
    const vu = +(r.vulnerableEndemicSpecies?.value || 0);                           // VU count
    const en = +(r.endangeredEndemicSpecies?.value || 0);                           // EN count
    const cr = +(r.criticallyEndangeredEndemicSpecies?.value || 0);                 // CR count
    m.set(isoInt, {                                                                 // Add to Map
      countryLabel: r.countryLabel?.value || '',                                    // Country name
      iso3: r.iso3?.value || '',                                                    // ISO 3-letter code
      isoNum: isoNumStr,                                                            // ISO numeric string
      totalEndemicSpecies: +(r.totalEndemicSpecies?.value || 0),                    // Total endemic
      nearThreatenedEndemicSpecies: nt,                                             // NT count
      vulnerableEndemicSpecies: vu,                                                 // VU count
      endangeredEndemicSpecies: en,                                                 // EN count
      criticallyEndangeredEndemicSpecies: cr                                        // CR count
    });
  }
  return m;                                                                         // Return Map
}

function buildGdpMap(json) {                                                        // Parse GDP JSON into Map
  const m = new Map();                                                              // Create Map
  const rows = json?.results?.bindings || [];                                       // Get rows or empty array
  for (const r of rows) {                                                           // Loop through rows
    const isoNumStr = r.isoNum?.value;                                              // Get ISO numeric code string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;                       // Convert to integer
    if (!Number.isFinite(isoInt)) continue;                                         // Skip invalid ISO codes
    m.set(isoInt, {                                                                 // Add to Map
      countryLabel: r.countryLabel?.value || '',                                    // Country name
      iso3: r.iso3?.value || '',                                                    // ISO 3-letter code
      isoNum: isoNumStr,                                                            // ISO numeric string
      gdpUSD: +(r.gdpUSD?.value || 0),                                              // GDP value
      gdpYear: r.gdpYear?.value || ''                                               // GDP year
    });
  }
  return m;                                                                         // Return Map
}

function buildPopulationMap(json) {                                                 // Parse population JSON into Map
  const m = new Map();                                                              // Create Map
  const rows = json?.results?.bindings || [];                                       // Get rows or empty array
  for (const r of rows) {                                                           // Loop through rows
    const isoNumStr = r.isoNum?.value;                                              // Get ISO numeric code string
    const isoInt = isoNumStr ? parseInt(isoNumStr, 10) : NaN;                       // Convert to integer
    if (!Number.isFinite(isoInt)) continue;                                         // Skip invalid ISO codes
    m.set(isoInt, {                                                                 // Add to Map
      countryLabel: r.countryLabel?.value || '',                                    // Country name
      iso3: r.iso3?.value || '',                                                    // ISO 3-letter code
      isoNum: isoNumStr,                                                            // ISO numeric string
      population: +(r.population?.value || 0),                                      // Population value
      popYear: r.popYear?.value || ''                                               // Population year
    });
  }
  return m;                                                                         // Return Map
}

function formatNumber(value, type) {                                                // Format numbers for display
  if (!Number.isFinite(value)) return '—';                                          // Return dash for invalid numbers
  if (type === 'usd') {                                                             // USD formatting
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} T USD`;                 // Trillions
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B USD`;                   // Billions
    return `${fmtInt(Math.round(value))} USD`;                                      // Normal formatting
  }
  if (type === 'pop') {                                                             // Population formatting
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B people`;                // Billions
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} M people`;                // Millions
    return `${fmtInt(Math.round(value))} people`;                                   // Normal formatting
  }
  return fmtInt(Math.round(value));                                                 // Default formatting
}

initCorrelations();                                                                  // Start the application