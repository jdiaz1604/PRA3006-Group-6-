// Map country ISO3 codes to their super-population groups (continental ancestry groups)
const countryToSuperPop = {
  // Americas (AMR) - Countries in the American continent super-population
  BRA:"AMR", ARG:"AMR", COL:"AMR", PER:"AMR", MEX:"AMR", CAN:"AMR", USA:"AMR", CHL:"AMR",
  // Europe (EUR) - Countries in the European super-population
  PRT:"EUR", ESP:"EUR", FRA:"EUR", DEU:"EUR", ITA:"EUR", GBR:"EUR", NLD:"EUR", SWE:"EUR",
  // Africa (AFR) - Countries in the African super-population
  NGA:"AFR", GHA:"AFR", ZAF:"AFR", KEN:"AFR", EGY:"AFR", ETH:"AFR",
  // East Asia (EAS) - Countries in the East Asian super-population
  CHN:"EAS", JPN:"EAS", KOR:"EAS", VNM:"EAS", THA:"EAS",
  // South Asia (SAS) - Countries in the South Asian super-population
  IND:"SAS", PAK:"SAS", BGD:"SAS", LKA:"SAS", NPL:"SAS"
};

// FST genetic distance matrix between super-populations (measures genetic differentiation)
// Lower values = more similar populations; diagonal = within-population comparison
const fstMatrix = {
  AFR:{AFR:0.01, AMR:0.10, EAS:0.15, EUR:0.12, SAS:0.12}, // Africa's FST values with all super-pops
  AMR:{AFR:0.10, AMR:0.02, EAS:0.07, EUR:0.05, SAS:0.06}, // Americas' FST values with all super-pops
  EAS:{AFR:0.15, AMR:0.07, EAS:0.01, EUR:0.09, SAS:0.08}, // East Asia's FST values with all super-pops
  EUR:{AFR:0.12, AMR:0.05, EAS:0.09, EUR:0.01, SAS:0.07}, // Europe's FST values with all super-pops
  SAS:{AFR:0.12, AMR:0.06, EAS:0.08, EUR:0.07, SAS:0.01}  // South Asia's FST values with all super-pops
};

let selA=null, selB=null; // Variables to store the two selected countries for comparison
const aName = d3.select("#aName"), bName = d3.select("#bName"); // D3 selections for country name display elements
const aPop = d3.select("#aPop"), bPop = d3.select("#bPop"); // D3 selections for super-population display elements
const fstOut = d3.select("#fst"), explain = d3.select("#explain"); // D3 selections for FST value and explanation text

// Format FST value for display, showing range for same super-pop comparisons
function fstPretty(v, same){ if (v==null) return "—"; return same? "0.00–0.02" : v.toFixed(2); }
// Look up which super-population a country belongs to based on its ISO3 code
function superPop(iso3){ return countryToSuperPop[iso3] || null; }
// Update the information panel with selected countries' data and FST calculation
function updatePanel(){
  const a=selA, b=selB; // Shorthand references to selected countries
  aName.text(a? a.name : "—"); bName.text(b? b.name : "—"); // Display country names or placeholder
  aPop.text(a? (a.sp||"—") : ""); bPop.text(b? (b.sp||"—") : ""); // Display super-population codes or placeholder
  if(a&&b){ // If both countries are selected
    const same = a.sp===b.sp; // Check if both countries belong to the same super-population
    const v = (fstMatrix[a.sp]||{})[b.sp]; // Look up FST value between the two super-populations
    fstOut.text(fstPretty(v, same)); // Display formatted FST value
    explain.text(() => !v && !same // Generate explanation text based on comparison type
      ? "No estimate available for this pair yet." // No data case
      : (same // Same super-population case
        ? "Both map to the same super-population; typical within-continent FST is very low."
        : "Different super-populations; between-continent FST is typically around 0.10–0.15. Panel-level estimate, not individual.")); // Different super-populations case
  } else { fstOut.text("—"); explain.text(""); } // Clear display if fewer than 2 countries selected
}

const svg = d3.select("#world"), g = svg.append("g"); // Select SVG element and append group for map paths
const projection = d3.geoNaturalEarth1().scale(165).translate([450,270]); // Set up map projection with scale and center position
const path = d3.geoPath(projection); // Create path generator using the projection

// Load world map topology data and country metadata in parallel
Promise.all([
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"), // Load TopoJSON world map data
  d3.csv("https://gist.githubusercontent.com/mbostock/4090846/raw/world-country-names.csv") // Load country names and ISO codes
]).then(([topology, names])=>{ // When both resources load successfully
  const countries = topojson.feature(topology, topology.objects.countries).features; // Convert TopoJSON to GeoJSON features
  const metaById = new Map(names.map(r => [ +r.id, { iso3:r.iso3||r.iso_a3, name:r.name } ])); // Create lookup map: country ID → metadata

  g.selectAll("path.country") // Select all country path elements (initially empty)
    .data(countries) // Bind country feature data to selection
    .join("path") // Create path elements for each country
    .attr("class","country") // Add 'country' CSS class for styling
    .attr("d", path) // Generate SVG path data from GeoJSON using projection
    .on("click", (ev, d) => { // Add click event handler for country selection
      const meta = metaById.get(d.id) || {}; // Look up country metadata by ID
      const iso3 = meta.iso3, name = meta.name || "Unknown", sp = superPop(iso3); // Extract ISO3 code, name, and super-population

      if(!selA || (selA && selB)){ // If no selection or both already selected (start new pair)
        selA = {id:d.id, iso3, name, sp}; selB = null; // Store first country, clear second
        d3.selectAll(".country").classed("selectedA", false).classed("selectedB", false); // Remove all selection styling
        d3.select(ev.currentTarget).classed("selectedA", true); // Add styling to newly selected first country
      } else { // If first country selected but not second
        selB = {id:d.id, iso3, name, sp}; // Store second country
        d3.select(ev.currentTarget).classed("selectedB", true); // Add styling to second country
      }
      updatePanel(); // Update the information panel with new selection
    });
});