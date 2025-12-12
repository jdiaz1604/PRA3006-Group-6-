# Exam Study Guide: Endemic Species & Economy Explorer

## Project Overview (Start Here)

**Project Title:** Investigating Socioeconomic Impact on Species Endangerment

**Main Question:** Does a country's socioeconomic profile (GDP & population) correlate with the proportion of threatened endemic species?

**Hypothesis:** Higher GDP and smaller population = lower threatened/endemic proportion

**Result:** No significant correlation was found after linear regressions on Wikidata data

---

## Website Pages (What You'll Show on Friday)

### 1. **Home Page (`index.html`)**
- **Purpose:** Landing page that introduces the project
- **Key Sections:**
  - Project explanation (the research question and hypothesis)
  - Key terms defined:
    - **Endemic species:** Native species found ONLY in one geographic location (e.g., Koala only in Australia)
    - **GDP:** Total market value of all goods/services produced in a country
    - **Correlation graph:** Visual showing relationship between two variables (positive, negative, or none)
  - What we did (methodology):
    1. Created SPARQL queries to fetch species data
    2. Built interactive map showing endemic counts
    3. Created threatened categories visualization (NT, VU, EN, CR)
    4. Ran regressions and plotted correlations
  - Limitations explained (important for exam):
    - Correlations are complex (GDP + population alone don't explain everything)
    - Migrating species underrepresented; endemic focus favors islands
    - Only terrestrial species (no marine)

### 2. **Interactive Map (`map.html`)**
- **Purpose:** Main explorer where you interact with data
- **Features:**
  - **Left side:** SVG map of the world with continents and countries
    - Color-coded by biome (forest, rainforest, grassland, desert, tundra, ice, mountain, mediterranean)
    - Shows loading spinner when fetching data
    - Has zoom and pan functionality
  - **Right side:** Data panel showing:
    - Title (continent or country name)
    - Endemic species count (with pie chart showing threatened categories)
    - GDP (in USD)
    - Population
  - **Back button:** Returns from country view back to continent view
  
**How it works (explain this):**
1. Click a continent → shows aggregated data for all countries in that continent
2. Click a country → shows data specifically for that country
3. Data comes from Wikidata queries that run in real-time

### 3. **Correlations Page (`correlations.html`)**
- **Purpose:** Shows statistical relationships between variables
- **Contains:**
  - Scatter plot: Threatened fraction vs. GDP
  - Scatter plot: Threatened fraction vs. Population
  - Each plot has:
    - Data points for each country
    - Trend line (regression line)
    - Statistics: n (number of countries), slope, intercept, R² value
    - Interpretation of results

### 4. **Contact Page (`contact.html`)**
- **Purpose:** Team information
- **Shows:** Project contributors and how to reach them

---

## Code Architecture (What You Need to Explain)

### Main Files & Their Purpose

| File | Purpose | Key Responsibility |
|------|---------|-------------------|
| `map.js` | Core application logic | D3 rendering, SPARQL queries, state management |
| `correlations.js` | Statistical visualization | Scatter plots, trend lines, statistics calculation |
| `style.css` | Visual styling | Colors, layout, responsive design |

### `map.js` - The Heart of the Application

#### **1. Data Fetching (SPARQL Queries)**

```javascript
// Three queries fetch data from Wikidata via QLever endpoint:

Q_END_EMD  // Endemic species query
├─ Returns: Total endemic species per country
└─ Also returns: Threat categories (NT, VU, EN, CR)

Q_GDP     // GDP query
├─ Returns: Latest GDP in USD per country
└─ Also returns: Year of data

Q_POP     // Population query
├─ Returns: Latest population per country
└─ Also returns: Year of data
```

**Key function:** `runSparqlGETWithRetry(query)`
- Fetches data from QLever (Wikidata endpoint)
- **Retry logic:** If request fails, retries up to 3 times with exponential backoff
- **Timeout:** 15 seconds max per request (THIS FIX prevents infinite loading!)
- If all retries fail, shows error message to user

#### **2. Data Processing**

```javascript
// After fetching, data is transformed into Maps for fast lookup:

endemicTable = Map<isoNumeric> → {
  countryLabel: string,
  totalEndemicSpecies: number,
  nearThreatened: number,
  vulnerable: number,
  endangered: number,
  criticallyEndangered: number
}

gdpTable = Map<isoNumeric> → {
  countryLabel: string,
  gdpUSD: number,
  gdpYear: string
}

populationTable = Map<isoNumeric> → {
  countryLabel: string,
  population: number,
  popYear: string
}
```

#### **3. Map Rendering (D3 Visualization)**

```javascript
// Step 1: Load world TopoJSON file
loadGeoData() → fetches world-atlas from CDN

// Step 2: Assign countries to continents
assignContinents() → uses geographic coordinates to determine continent
  ├─ Uses name overrides for edge cases (Turkey→Europe, Egypt→Africa, etc.)
  └─ Groups countries by continent

// Step 3: Render the map
renderMap() → D3 code to draw the map
  ├─ Creates SVG layers: sphereLayer, continentLayer, countryLayer
  ├─ Color countries by biome type
  └─ Add click handlers for continent/country selection
```

#### **4. State Management**

```javascript
const state = {
  continentName: null,  // Which continent is selected? null = none
  countryId: null       // Which country is selected? null = none
}

// State changes when user clicks:
// continent click → state.continentName = "Europe", state.countryId = null
// country click → state.countryId = 124 (add to state, keep continent)
```

#### **5. User Interaction Flow**

```
User clicks continent
         ↓
handleContinentClick()
         ↓
ensureDataReady() → fetch SPARQL data if not already fetched
         ↓
showLoading(true) → display spinner
         ↓
summarizeContinent() → aggregate data for all countries in continent
         ↓
updateContinentLayerState() → highlight selected continent
         ↓
applyContinentSummary() → update right panel with data
         ↓
zoomToFeature() → animate zoom to continent
         ↓
showLoading(false) → hide spinner
```

#### **6. Important Functions**

| Function | What it does |
|----------|------------|
| `loadGeoData()` | Fetches world map TopoJSON, assigns continents |
| `ensureDataReady()` | Lazy-loads SPARQL data on first click |
| `handleContinentClick(feature)` | Handles clicking a continent |
| `handleCountryClick(feature)` | Handles clicking a country |
| `summarizeContinent(name)` | Aggregates data for entire continent |
| `hydrateCountryPanel(feature)` | Fills panel with country-specific data |
| `zoomToFeature(feature)` | Animates map zoom to selected region |
| `resetToContinents()` | Clears selection, returns to continent view |
| `updateCountryLayerState()` | Shows/hides countries based on selection |
| `drawEndemicChart()` | Creates pie chart of threatened species |

### `correlations.js` - Statistical Analysis

- Fetches same SPARQL data as map
- Filters to countries with ≥50 endemic species
- Calculates: `threatened fraction = (NT+VU+EN+CR) / total endemic`
- Creates two scatter plots:
  1. Threatened fraction vs. GDP
  2. Threatened fraction vs. Population
- Draws trend line (linear regression) and shows R² value
- **Key insight:** Low R² values show weak correlation = hypothesis not supported

---

## Key Technical Concepts to Explain

### 1. **SPARQL Queries**
- **What:** Query language for fetching data from Wikidata
- **How:** Uses PREFIX statements to reference Wikidata properties
- **Example property:** 
  - `P183` = "endemic to" (which country is species endemic to?)
  - `P2131` = "GDP" (what's the country's GDP?)
  - `P1082` = "population" (what's the population?)
- **Output:** Returns JSON with results

### 2. **D3.js**
- **What:** JavaScript library for data visualization
- **Used for:**
  - Rendering the interactive map
  - Handling zoom/pan interactions
  - Drawing scatter plots
  - Creating animations (zoom transitions)
- **Key concept:** Data binding - D3 automatically updates visuals when data changes

### 3. **TopoJSON**
- **What:** Compressed format for geographic data
- **Why used:** Much smaller file size than GeoJSON
- **Process:** `world-atlas` file → converted to features → drawn on SVG

### 4. **Async/Await & Promises**
- **Why needed:** SPARQL queries take time to fetch data
- **How it works:**
  ```javascript
  async function handleContinentClick(feature) {
    showLoading(true);           // Show spinner
    await ensureDataReady();      // Wait for data to arrive
    applyContinentSummary();      // Update display
    showLoading(false);           // Hide spinner
  }
  ```

### 5. **Error Handling**
- **Retry logic:** If API fails, tries again up to 3 times
- **Timeout:** If request takes >15 seconds, aborts (YOUR FIX!)
- **User feedback:** Shows "Request failed" message if all retries fail

---

## The Fix You Implemented

**Problem:** Map remained loading forever when QLever endpoint was slow/down

**Solution:** Added 15-second timeout using AbortController
```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);
// Request aborts after 15 seconds, shows error instead of hanging
```

**Why this matters for your exam:**
- Shows you understand async problems and solutions
- Demonstrates practical debugging skills
- Improves user experience (error is better than infinite loading)

---

## Things to Practice for Friday

### 1. **Opening and Running the Website**
- [ ] Serve the website locally (Python server or Live Server)
- [ ] Click a continent (Europe, Africa, etc.)
- [ ] Watch data load and sidebar update
- [ ] Click a country to see details
- [ ] Explore the map features (zoom, pan, tooltip)
- [ ] Go back to continent view using "Back" button

### 2. **Explaining Each Page**
- [ ] Explain what index.html shows and why
- [ ] Walk through map.html features and how they work
- [ ] Show correlations.html and explain the charts
- [ ] Discuss what the data means (what correlations tell us)

### 3. **Code Explanation**
- [ ] Explain the data fetching process (SPARQL queries)
- [ ] Walk through how clicking a continent triggers data loading
- [ ] Show how state management works
- [ ] Explain the timeout fix you implemented
- [ ] Discuss D3 rendering and why it's used

### 4. **Key Points to Emphasize**
- [ ] Project is about testing a hypothesis (not just showing data)
- [ ] Explain why the hypothesis was not supported (what the data shows)
- [ ] Discuss limitations (why correlation is incomplete)
- [ ] Show how you debugged the loading issue
- [ ] Mention technologies used (D3, SPARQL, Wikidata, TopoJSON)

---

## Quick Reference: Project Tech Stack

| Technology | Purpose |
|------------|---------|
| **HTML/CSS** | Page structure and styling |
| **JavaScript (ES6+)** | Application logic |
| **D3.js** | Interactive map visualization |
| **TopoJSON** | Geographic data format |
| **SPARQL** | Query language for Wikidata |
| **QLever** | Wikidata query endpoint |
| **Git/GitHub** | Version control and collaboration |

---

## Sample Explanation Flow for Exam

**Examiner:** "Walk me through your website and code"

**You should say:**

1. **Opening:** "This is a website that investigates whether a country's economy (GDP, population) affects how many endangered species it has. The hypothesis was that richer countries with smaller populations have fewer endangered species, but we found no significant correlation."

2. **Home page:** "The index page explains our research question, defines key terms like endemic species, and lists our methodology - we built SPARQL queries, created an interactive map, and ran statistical analysis."

3. **Map page:** "Click on a continent to see aggregated data for that region. Click on a country to see specific numbers. The data comes from Wikidata queries that fetch real-time information about endemic species, GDP, and population."

4. **Code structure:** "The code has three main datasets fetched via SPARQL. We use D3.js to render an interactive map, manage state to track which continent/country is selected, and display the results in a sidebar with charts."

5. **Technical highlight:** "I also fixed a bug where the loading indicator would hang forever if the API was slow. I added a 15-second timeout that cancels requests if they take too long."

6. **Correlations:** "On the correlations page, you can see scatter plots showing the relationship between threatened species and GDP/population. The R² values are low, indicating weak correlations, which didn't support our hypothesis."

---

## Common Exam Questions & Answers

**Q: What does "endemic" mean?**
A: A species that is native to and found only in one specific geographic location. For example, the Koala is endemic to Australia.

**Q: Why no correlation?**
A: Many factors affect endangered species counts beyond just GDP and population - climate, habitat conservation efforts, biodiversity hotspots, migration patterns, etc.

**Q: How is the data fetched?**
A: We write SPARQL queries that fetch data from Wikidata through the QLever endpoint. These queries run in the browser when you click a continent.

**Q: What does the pie chart show?**
A: It breaks down endemic species into threat categories - how many are critically endangered, endangered, vulnerable, near-threatened, and other.

**Q: Why D3.js?**
A: D3 is perfect for interactive visualizations. It handles data binding, animations, zooming, and responsive updates efficiently.

**Q: What's TopoJSON?**
A: A compact geographic data format. It's compressed and much smaller than GeoJSON, so the world map loads quickly.

**Q: How does zoom work?**
A: When you click a continent, D3 animates a smooth transition, scaling and translating the map to center on that region using `zoomBehavior.transform`.

---

## Before Your Exam Friday

- [ ] Test the website on your laptop
- [ ] Make sure internet connection works (API needs internet)
- [ ] Practice clicking continents and explaining what happens
- [ ] Review SPARQL queries and what they fetch
- [ ] Memorize your correlation findings (no significant correlation)
- [ ] Prepare your explanation of the timeout fix
- [ ] Print or bookmark this guide for reference

Good luck on Friday! 🎯
