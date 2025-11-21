# Endemic Species & Economy Explorer

An interactive D3 map that lets students compare biodiversity indicators (total endemic species, endangered endemic species) with two macroeconomic metrics (nominal GDP and population). The map relies on live SPARQL queries against the [QLever Wikidata endpoint](https://qlever.cs.uni-freiburg.de/wikidata) and runs entirely in the browser—no custom server is required.

Use the splash page (`index.html`) to understand the project and launch the explorer. Once on `map.html`, click a continent to see aggregated totals, then drill down into individual countries for the most recent numbers.

## Quick start

1. Clone or download this repository.
2. Serve the root directory using any static web-server (e.g., `python3 -m http.server 9000`) or open `index.html` directly via the VS Code Live Server extension.
3. Visit `/index.html` for the landing page, `/map.html` for the explorer, or `/correlations.html` for the statistical plots.

> **Note:** The explorer fetches live data from the QLever Wikidata endpoint on first interaction. An internet connection must be available to populate the tables.

## Data sources & SPARQL queries

All three datasets originate from Wikidata statements and are queried through QLever. The requests are defined at the bottom of `map.js` as multiline template strings and fetched via the helper `runSparqlGETWithRetry`.

| Dataset | Purpose | Key Wikidata properties | Query ID in `map.js` |
| ------- | ------- | ----------------------- | -------------------- |
| Endemic & endangered species | Returns the total number of endemic species for a country and the subset marked as endangered. | `P1082` (population), `P2874` (endemic to), `Q11394` (species) plus custom filters | `Q_END_EMD` |
| Nominal GDP (USD) | Retrieves the latest statement tagged with currency USD (direct or converted). | `P2131` (GDP), `P38` (currency), `P3487` (normalized USD) | `Q_GDP` |
| Population totals | Pulls the most recent population statement per country. | `P1082` (population), `P585` (point in time) | `Q_POP` |

Each query binds the ISO 3166-1 numeric code, ISO 3166-1 alpha-3 code, label, and the metric of interest. Once the JSON response arrives, the rows are normalized into lookup tables (`Map` objects keyed by the ISO numeric code) for quick continent and country aggregation.

## Architecture overview

- **Static pages:** `index.html` (landing overview), `map.html` (interactive explorer), and `correlations.html` (scatter plots) share styling through `style.css`.
- **Map rendering:** `map.js` loads the [`world-atlas`](https://github.com/topojson/world-atlas) 110m TopoJSON file, converts it into country features with `topojson-client`, and draws both continent and country layers using D3.
- **Interaction model:** The UI maintains a small `state` object (`continentName`, `countryId`) and updates D3 classes to highlight selections, zoom to regions, and show tooltips.
- **Data orchestration:** `ensureDataReady` lazily fetches all SPARQL result sets. Aggregations happen in-memory for instant continent summaries, while country panels reuse the cached tables.
- **Visualization:** The sidebar displays formatted metrics plus a small bar chart comparing endemic vs. endangered counts (`drawEndemicChart`).

Key architectural decisions are documented with inline comments so future contributors can follow the data pipeline, rendering steps, and error-handling behavior.

## Development & testing

Because the project is static, only a modern browser is required. Recommended workflow:

```bash
# Serve locally on http://localhost:9000
python3 -m http.server 9000

# Or use Node's http-server if you already have npm installed
npm install --global http-server
http-server .
```

Open `map.html` and interact with the continents to trigger the SPARQL downloads. Use the browser dev tools console to inspect any fetch errors; the UI exposes user-facing status messages (`Request failed`, `No data`) via helper functions such as `applyEndemicResult`.

## Project structure

```
├── index.html          # Landing page explaining the visualization
├── map.html            # Main explorer shell (sidebar + SVG map containers)
├── map.js              # All D3 logic, SPARQL queries, and UI state for the explorer
├── correlations.html   # Scatter plot dashboard
├── correlations.js     # Data wrangling + D3 scatter plots
├── style.css           # Shared styling and responsive layout rules
├── README.md           # This documentation
├── AUTHORS.md          # Team roster & roles
└── LICENSE             # MIT license for reuse
```

## Correlation dashboard

`correlations.html` reuses the same SPARQL tables but filters to countries with ≥ 50 endemic species, then computes the endangered fraction (`endangered endemic / total endemic`). Two D3 scatter plots compare this fraction against GDP (scaled to USD trillions) and population (billions). Tooltips reveal the raw values, and a least-squares regression line with summary statistics (`n`, slope, intercept, r, R²) appears below each chart so assessors can quickly interpret the direction and strength of the relationships.

## Accessibility & responsiveness

- Uses semantic HTML (landmarks, headings, lists) for screen readers.
- Buttons and links include descriptive text and `aria-hidden` states where applicable (e.g., the loading spinner).
- Layout adapts to narrower screens with flexible `flexbox` panels; the map recalculates its projection on resize.
- Color palette keeps sufficient contrast between land, borders, and highlight states while the tooltip provides textual context.

## Known limitations

- Some territories have ambiguous continent assignments; a curated `NAME_OVERRIDES` map handles the most common exceptions, but a few politically disputed areas may remain unassigned.
- The QLever endpoint occasionally rate-limits repeated calls. `runSparqlGETWithRetry` backs off exponentially, yet the UI will show an error if all retries fail.
- Endemic species counts originate from Wikidata statements and might not include the latest research for every country. The sidebar explains this caveat where relevant.

## Authors

See [`AUTHORS.md`](AUTHORS.md) for contributor names, roles, and contact information.

## License

Released under the MIT License – see [`LICENSE`](LICENSE) for details.
