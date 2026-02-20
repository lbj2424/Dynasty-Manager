import { rng, seedFromString, pick, id, clamp } from "../utils.js";
import { calculateSalary } from "./players.js"; 

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez"];
const POS = ["PG","SG","SF","PF","C"];

function rollGrade(r){
  const x = r();
  if (x < 0.02) return "A+";
  if (x < 0.08) return "A";
  if (x < 0.38) return "B";
  if (x < 0.75) return "C";
  if (x < 0.93) return "D";
  return "F";
}

export function generateFreeAgents({ year=2020, count=80, seed="fa" } = {}){ // FIX: Default to 2020
  const r = rng(seedFromString(`${seed}_${year}`));
  const list = [];

  for (let i=0;i<count;i++){
    const grade = rollGrade(r);
    const baseOvr = clamp(Math.floor(60 + r()*26), 60, 90); 
    
    // Archetype Split
    const typeRoll = r();
    let off = baseOvr; 
    let def = baseOvr;
    if (typeRoll < 0.35) { off += 5; def -= 5; } // Scorer
    else if (typeRoll < 0.70) { off -= 5; def += 5; } // Defender
    
    off = clamp(off, 40, 99);
    def = clamp(def, 40, 99);
    const finalOvr = Math.round((off + def)/2);

    const rand = r();
    let age = 24;
    if (rand < 0.1) age = 20 + Math.floor(r()*3);
    else if (rand < 0.6) age = 23 + Math.floor(r()*7); 
    else if (rand < 0.9) age = 30 + Math.floor(r()*5); 
    else age = 35 + Math.floor(r()*5);

    let ask = calculateSalary(finalOvr, age);
    const greed = 0.9 + r() * 0.2; 
    ask = Number((ask * greed).toFixed(2));

    const careerStats = [];
    
    // FIX: Backfill missing history as "Free Agent" for newly generated players
    for (let y = 2020; y < year; y++) {
        careerStats.push({
            year: y,
            teamName: "Free Agent",
            ovr: finalOvr, 
            gp: 0, pts: 0, reb: 0, ast: 0
        });
    }

    list.push({
      id: id("fa", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos: pick(POS, r),
      ovr: finalOvr,
      off, // New
      def, // New
      age,
      potentialGrade: grade,
      ask,
      yearsAsk: 1 + Math.floor(r()*4),
      wantsWinning: r() < 0.5,
      wantsRole: r() < 0.6,
      signedByTeamId: null,
      promisedRole: null,
      contract: null,
      careerStats
    });
  }

  list.sort((a,b) => b.ovr - a.ovr);
  return list;
}
