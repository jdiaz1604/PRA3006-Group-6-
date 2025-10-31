const countryToSuperPop = {
  // Americas (AMR)
  BRA:"AMR", ARG:"AMR", COL:"AMR", PER:"AMR", MEX:"AMR", CAN:"AMR", USA:"AMR", CHL:"AMR",
  // Europe (EUR)
  PRT:"EUR", ESP:"EUR", FRA:"EUR", DEU:"EUR", ITA:"EUR", GBR:"EUR", NLD:"EUR", SWE:"EUR",
  // Africa (AFR)
  NGA:"AFR", GHA:"AFR", ZAF:"AFR", KEN:"AFR", EGY:"AFR", ETH:"AFR",
  // East Asia (EAS)
  CHN:"EAS", JPN:"EAS", KOR:"EAS", VNM:"EAS", THA:"EAS",
  // South Asia (SAS)
  IND:"SAS", PAK:"SAS", BGD:"SAS", LKA:"SAS", NPL:"SAS"
};

// Illustrative pairwise FST matrix (swap with literature table next)
const fstMatrix = {
  AFR:{AFR:0.01, AMR:0.10, EAS:0.15, EUR:0.12, SAS:0.12},
  AMR:{AFR:0.10, AMR:0.02, EAS:0.07, EUR:0.05, SAS:0.06},
  EAS:{AFR:0.15, AMR:0.07, EAS:0.01, EUR:0.09, SAS:0.08},
  EUR:{AFR:0.12, AMR:0.05, EAS:0.09, EUR:0.01, SAS:0.07},
  SAS:{AFR:0.12, AMR:0.06, EAS:0.08, EUR:0.07, SAS:0.01}
};

let selA=null, selB=null;
const aName = d3.select("#aName"), bName = d3.select("#bName");
const aPop = d3.select("#aPop"), bPop = d3.select("#bPop");
const fstOut = d3.select("#fst"), explain = d3.select("#explain");

function fstPretty(v, same){ if (v==null) return "—"; return same? "0.00–0.02" : v.toFixed(2); }
function superPop(iso3){ return countryToSuperPop[iso3] || null; }
function updatePanel(){
  const a=selA, b=selB;
  aName.text(a? a.name : "—"); bName.text(b? b.name : "—");
  aPop.text(a? (a.sp||"—") : ""); bPop.text(b? (b.sp||"—") : "");
  if(a&&b){
    const same = a.sp===b.sp;
    const v = (fstMatrix[a.sp]||{})[b.sp];
    fstOut.text(fstPretty(v, same));
    explain.text(() => !v && !same
      ? "No estimate available for this pair yet."
      : (same
        ? "Both map to the same super-population; typical within-continent FST is very low."
        : "Different super-populations; between-continent FST is typically around 0.10–0.15. Panel-level estimate, not individual."));
  } else { fstOut.text("—"); explain.text(""); }
}

const svg = d3.select("#world"), g = svg.append("g");
const projection = d3.geoNaturalEarth1().scale(165).translate([450,270]);
const path = d3.geoPath(projection);

// Load topo + country names for ISO3 mapping
Promise.all([
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"),
  d3.csv("https://gist.githubusercontent.com/mbostock/4090846/raw/world-country-names.csv")
]).then(([topology, names])=>{
  const countries = topojson.feature(topology, topology.objects.countries).features;
  const metaById = new Map(names.map(r => [ +r.id, { iso3:r.iso3||r.iso_a3, name:r.name } ]));

  g.selectAll("path.country")
    .data(countries)
    .join("path")
    .attr("class","country")
    .attr("d", path)
    .on("click", (ev, d) => {
      const meta = metaById.get(d.id) || {};
      const iso3 = meta.iso3, name = meta.name || "Unknown", sp = superPop(iso3);

      if(!selA || (selA && selB)){ // start new pair
        selA = {id:d.id, iso3, name, sp}; selB = null;
        d3.selectAll(".country").classed("selectedA", false).classed("selectedB", false);
        d3.select(ev.currentTarget).classed("selectedA", true);
      } else {
        selB = {id:d.id, iso3, name, sp};
        d3.select(ev.currentTarget).classed("selectedB", true);
      }
      updatePanel();
    });
});
