import { rng, seedFromString, pick, id, clamp } from "../utils.js";

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez"];
const POS = ["PG","SG","SF","PF","C"];
const COLLEGES = ["Duke","unc","Kentucky","Kansas","Villanova","Gonzaga","UCLA","Arizona","Michigan","Texas","Florida","Virginia","Oregon","Ohio St","Alabama","Auburn","Tennessee","Houston","Baylor","Purdue"];
const COUNTRIES = ["France","Spain","Serbia","Slovenia","Australia","Canada","Germany","Lithuania","Turkey","Greece","Italy","Brazil","Argentina","Nigeria","China","Japan"];

// Map Countries to Continent Keys
const COUNTRY_TO_CONT = {
  "France": "EU", "Spain": "EU", "Serbia": "EU", "Slovenia": "EU", "Germany": "EU",
  "Lithuania": "EU", "Turkey": "EU", "Greece": "EU", "Italy": "EU",
  "Canada": "NA",
  "Brazil": "SA", "Argentina": "SA",
  "Nigeria": "AF",
  "China": "AS", "Japan": "AS",
  "Australia": "OC"
};

function rollPot(r){
  const x = r();
  if (x < 0.05) return "A+";
  if (x < 0.15) return "A";
  if (x < 0.40) return "B";
  if (x < 0.75) return "C";
  if (x < 0.90) return "D";
  return "F";
}

export function generateNCAAProspects({ year=1, count=60, seed="ncaa" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const list = [];
  for(let i=0; i<count; i++){
    const ovr = clamp(Math.floor(55 + r()*30), 55, 84);
    const age = 19 + Math.floor(r() * 4);
    
    list.push({
      id: id("ncaa", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos: pick(POS, r),
      age,
      pool: "NCAA",
      college: pick(COLLEGES, r),
      currentOVR: ovr,
      potentialGrade: rollPot(r),
      declared: true,
      careerStats: [] 
    });
  }
  return list.sort((a,b)=>b.currentOVR - a.currentOVR);
}

export function generateInternationalPool({ year=1, count=60, seed="intl" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const list = [];
  for(let i=0; i<count; i++){
    const ovr = clamp(Math.floor(55 + r()*30), 55, 84);
    const age = 18 + Math.floor(r() * 5);
    const country = pick(COUNTRIES, r);

    list.push({
      id: id("intl", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos: pick(POS, r),
      age,
      pool: "INTL",
      continentName: country, // Display name (e.g. "France")
      continentKey: COUNTRY_TO_CONT[country] || "EU", // Logic key (e.g. "EU")
      currentOVR: ovr,
      potentialGrade: rollPot(r),
      declared: r() < 0.3, 
      careerStats: [] 
    });
  }
  return list.sort((a,b)=>b.currentOVR - a.currentOVR);
}
