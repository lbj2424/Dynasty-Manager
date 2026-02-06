import { rng, seedFromString, pick, clamp, id } from "../utils.js";
import { POTENTIAL_GRADES, CONTINENTS } from "../data/constants.js";

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez"];

const POS = ["PG","SG","SF","PF","C"];

function rollPotentialGrade(r){
  // Rare A+, more A, lots of B/C
  const x = r();
  if (x < 0.02) return "A+";
  if (x < 0.08) return "A";
  if (x < 0.38) return "B";
  if (x < 0.75) return "C";
  if (x < 0.93) return "D";
  return "F";
}

function ceilingFromGrade(grade, currentOVR, r){
  // Hidden ceiling number, but grade is visible. F caps at current.
  const base = {
    "A+": [92, 99],
    "A":  [88, 94],
    "B":  [84, 90],
    "C":  [80, 86],
    "D":  [76, 82],
    "F":  [currentOVR, currentOVR]
  }[grade];

  const ceil = Math.floor(base[0] + (base[1]-base[0]) * r());
  return Math.max(ceil, currentOVR);
}

function currentOVRForPool(pool, grade, r){
  // NCAA pool: generally higher current OVR. Intl hidden pool: more variance.
  let ovr;
  if (pool === "NCAA"){
    ovr = Math.floor(64 + r()*18); // 64-81
    if (grade === "A+" || grade === "A") ovr = Math.max(ovr, Math.floor(72 + r()*10)); // 72-81+
  } else {
    ovr = Math.floor(58 + r()*22); // 58-79
    if (grade === "A+" || grade === "A") ovr = Math.max(ovr, Math.floor(70 + r()*10)); // 70-79+
  }
  return clamp(ovr, 50, 85);
}

function makeName(r){
  return `${pick(FIRST, r)} ${pick(LAST, r)}`;
}

export function generateNCAAProspects({ year=1, count=100, seed="ncaa" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const out = [];
  for (let i=0;i<count;i++){
    const grade = rollPotentialGrade(r);
    const currentOVR = currentOVRForPool("NCAA", grade, r);
    const ceiling = ceilingFromGrade(grade, currentOVR, r);

    out.push({
      id: id("p", r),
      pool: "NCAA",
      name: makeName(r),
      pos: pick(POS, r),
      age: 19 + Math.floor(r()*4),
      currentOVR,
      potentialGrade: grade,        // visible and truthful
      _ceilingOVR: ceiling,          // hidden internal
      declared: true,                // v1 default: NCAA auto declares
      discovered: true,              // already listed
      scouted: false                 // you can still "scout" to see info in UI
    });
  }
  return out;
}

export function generateInternationalPool({ year=1, count=100, seed="intl" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const out = [];
  for (let i=0;i<count;i++){
    const continent = pick(CONTINENTS, r);
    const grade = rollPotentialGrade(r);
    const currentOVR = currentOVRForPool("INTL", grade, r);
    const ceiling = ceilingFromGrade(grade, currentOVR, r);

    out.push({
      id: id("p", r),
      pool: "INTL",
      continentKey: continent.key,
      continentName: continent.name,
      name: makeName(r),
      pos: pick(POS, r),
      age: 18 + Math.floor(r()*6),
      currentOVR,
      potentialGrade: grade,   // truthful once discovered
      _ceilingOVR: ceiling,
      declared: false,
      discovered: false,
      scouted: false,
      declareInterest: Math.floor(10 + r()*30) // starts low
    });
  }
  return out;
}
