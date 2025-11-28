const QLEVER = 'https://qlever.dev/api/wikidata';
const ACCEPT_JSON = { 'Accept': 'application/sparql-results+json' };
const MIN_ENDEMIC = 50;

const statusEl = document.getElementById('vizStatus');
const tooltip = document.getElementById('vizTooltip');
const fmtInt = d3.format(',d');

async function initCorrelations() {
  setStatus('Loading live data from QLever…');
  try {
    const [endData, gdpData, popData] = await Promise.all([
      runSparqlGETWithRetry(Q_END_EMD),
      runSparqlGETWithRetry(Q_GDP),
      runSparqlGETWithRetry(Q_POP)
    ]);
    const endemicTable = buildEndemicMap(endData);
    const gdpTable = buildGdpMap(gdpData);
    const populationTable = buildPopulationMap(popData);
    const dataset = combineDataset(endemicTable, gdpTable, populationTable);
    if (!dataset.length) {
      setStatus('No countries meet the minimum endemic species threshold yet.');
      return;
    }
    setStatus(`Loaded ${dataset.length} countries (≥ ${MIN_ENDEMIC} endemic species).`);
    renderCharts(dataset);
  } catch (err) {
    console.error(err);
    setStatus('Unable to fetch data from the SPARQL endpoint right now. Please retry.');
  }
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function combineDataset(endemicTable, gdpTable, populationTable) {
  const rows = [];
  endemicTable.forEach((endRow, isoNumeric) => {
    const gRow = gdpTable.get(isoNumeric);
    const pRow = populationTable.get(isoNumeric);
    if (!gRow || !pRow) return;
    const total = +(endRow.totalEndemicSpecies || 0);
    const nt = +(endRow.nearThreatenedEndemicSpecies || 0);
    const vu = +(endRow.vulnerableEndemicSpecies || 0);
    const en = +(endRow.endangeredEndemicSpecies || 0);
    const cr = +(endRow.criticallyEndangeredEndemicSpecies || 0);
    const threatened = nt + vu + en + cr;
    if (!Number.isFinite(total) || total < MIN_ENDEMIC || total === 0) return;
    const fraction = threatened / total;
    rows.push({
      isoNumeric,
      countryLabel: endRow.countryLabel || gRow.countryLabel || pRow.countryLabel || `ISO ${isoNumeric}`,
      totalEndemic: total,
      threatenedEndemic: threatened,
      fraction,
      gdpUSD: +(gRow.gdpUSD || 0),
      gdpYear: gRow.gdpYear || '',
      population: +(pRow.population || 0),
      popYear: pRow.popYear || ''
    });
  });
  return rows;
}

function renderCharts(data) {
  const configs = [
    {
      svgId: 'chartGDP',
      statsId: 'statsGDP',
      xField: 'gdpUSD',
      xLabelBase: 'GDP (USD)',
      tooltipFmt: (d) => formatNumber(d.gdpUSD, 'usd'),
      tooltipLabel: 'GDP',
      domainPadding: 0.12
    },
    {
      svgId: 'chartPOP',
      statsId: 'statsPOP',
      xField: 'population',
      xLabelBase: 'Population',
      tooltipFmt: (d) => formatNumber(d.population, 'pop'),
      tooltipLabel: 'Population',
      domainPadding: 0.08
    }
  ];

  configs.forEach(cfg => renderScatter(cfg, data));
}

function renderScatter(cfg, data) {
  const svg = d3.select(`#${cfg.svgId}`);
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const maxRaw = d3.max(data, d => d[cfg.xField]) || 0;
  const scale = chooseScale(maxRaw, cfg.xLabelBase || cfg.xLabel);
  const factor = scale.factor || 1;
  const xLabel = scale.label || (cfg.xLabelBase || '');

  const filtered = data
    .filter(row => Number.isFinite(row[cfg.xField]) && row[cfg.xField] > 0)
    .map(row => ({
      ...row,
      x: row[cfg.xField] / factor,
      y: row.fraction
    }));

  if (!filtered.length) {
    svg.append('text').attr('x', 12).attr('y', 24).attr('fill', '#a8b3c7').text('No data available.');
    const statsSlot = document.getElementById(cfg.statsId);
    if (statsSlot) statsSlot.textContent = 'No data available.';
    return;
  }

  const margin = { top: 24, right: 28, bottom: 60, left: 60 };
  const width = Math.min(550, svg.node().parentNode?.clientWidth || 520);
  const height = 360;
  svg.attr('width', width).attr('height', height);

  const xMax = d3.max(filtered, d => d.x) || 1;
  const yMax = d3.max(filtered, d => d.y) || 0.2;

  const x = d3.scaleLinear()
    .domain([0, xMax * (1 + (cfg.domainPadding || 0.1))])
    .range([margin.left, width - margin.right]);

  const regression = linearRegression(filtered);
  const predicted = regression.intercept + regression.slope * x.domain()[1];
  const yMaxCandidate = Math.max(yMax, regression.intercept, predicted, 0.05);
  const y = d3.scaleLinear()
    .domain([0, Math.min(1, yMaxCandidate * 1.15)])
    .range([height - margin.bottom, margin.top]);
  const group = svg.append('g');

  const linePoints = [
    { x: 0, y: regression.intercept },
    { x: x.domain()[1], y: regression.intercept + regression.slope * x.domain()[1] }
  ];

  group.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x))
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px'))
    .call(g => g.selectAll('line,path').attr('stroke', '#27335c'));

  group.append('g')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.0%')))
    .call(g => g.selectAll('text').attr('fill', '#a8b3c7').style('font-size', '11px'))
    .call(g => g.selectAll('line,path').attr('stroke', '#27335c'));

  group.append('text')
    .attr('x', width / 2)
    .attr('y', height - 18)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a8b3c7')
    .attr('font-size', 12)
    .text(xLabel);

  group.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a8b3c7')
    .attr('font-size', 12)
    .text('Endangered / total endemic');

  group.selectAll('circle')
    .data(filtered)
    .join('circle')
    .attr('cx', d => x(d.x))
    .attr('cy', d => y(d.y))
    .attr('r', 5)
    .attr('fill', '#74c0ff')
    .attr('opacity', 0.9)
    .on('mouseenter', (event, d) => showTooltip(event, d, cfg, svg.node()))
    .on('mousemove', (event, d) => showTooltip(event, d, cfg, svg.node()))
    .on('mouseleave', hideTooltip);

  group.append('line')
    .attr('x1', x(linePoints[0].x))
    .attr('y1', y(linePoints[0].y))
    .attr('x2', x(linePoints[1].x))
    .attr('y2', y(linePoints[1].y))
    .attr('stroke', '#f6c177')
    .attr('stroke-width', 2);

  writeStats(cfg.statsId, regression, filtered.length);
}

function showTooltip(event, datum, cfg, svgNode) {
  if (!tooltip) return;
  tooltip.style.opacity = '1';
  tooltip.setAttribute('aria-hidden', 'false');
  const x = event.pageX || event.clientX || 0;
  const y = event.pageY || event.clientY || 0;
  const left = x + 14;
  const top = y - 12;
  const maxLeft = window.innerWidth - 240; // prevent clipping
  const maxTop = window.innerHeight - 120;
  tooltip.style.left = `${Math.min(left, maxLeft)}px`;
  tooltip.style.top = `${Math.min(top, maxTop)}px`;
  tooltip.innerHTML = `
    <strong>${datum.countryLabel}</strong><br>
    Threatened fraction: ${(datum.y * 100).toFixed(1)}%<br>
    ${cfg.tooltipLabel || cfg.xLabel}: ${cfg.tooltipFmt(datum)}<br>
    Total endemic: ${fmtInt(datum.totalEndemic)} | Threatened: ${fmtInt(datum.threatenedEndemic)}
  `;
}

function hideTooltip() {
  if (!tooltip) return;
  tooltip.style.opacity = '0';
  tooltip.setAttribute('aria-hidden', 'true');
}

function writeStats(targetId, regression, n) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const slope = regression.slope?.toFixed(4) || '0';
  const intercept = regression.intercept?.toFixed(4) || '0';
  const r = regression.r?.toFixed(3) || '0';
  const r2 = regression.r2?.toFixed(3) || '0';
  el.innerHTML = `
    <p><strong>Linear regression</strong> (y = a·x + b)</p>
    <p>n = ${n}</p>
    <p>a (slope) ≈ ${slope}</p>
    <p>b (intercept) ≈ ${intercept}</p>
    <p>r ≈ ${r}</p>
    <p>R² ≈ ${r2}</p>
  `;
}

function linearRegression(points) {
  const n = points.length;
  if (!n) return { slope: 0, intercept: 0, r: 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  points.forEach(p => {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  });
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const rDenom = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  const r = rDenom ? (n * sumXY - sumX * sumY) / rDenom : 0;
  return { slope, intercept, r, r2: r * r };
}

function chooseScale(maxVal, baseLabel) {
  if (!maxVal || maxVal <= 0) return { factor: 1, label: baseLabel };
  if (maxVal >= 1e12) return { factor: 1e12, label: `${baseLabel} (trillions)` };
  if (maxVal >= 1e9) return { factor: 1e9, label: `${baseLabel} (billions)` };
  return { factor: 1e6, label: `${baseLabel} (millions)` };
}

async function runSparqlGETWithRetry(query, { retries = 3, baseDelayMs = 400 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(`${QLEVER}?query=${encodeURIComponent(query)}`, { headers: ACCEPT_JSON });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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

function formatNumber(value, type) {
  if (!Number.isFinite(value)) return '—';
  if (type === 'usd') {
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} T USD`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B USD`;
    return `${fmtInt(Math.round(value))} USD`;
  }
  if (type === 'pop') {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B people`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} M people`;
    return `${fmtInt(Math.round(value))} people`;
  }
  return fmtInt(Math.round(value));
}

initCorrelations();
