import { rng, seedFromString, pick, id, clamp } from "../utils.js";
// We import the same logic so FAs match roster players exactly
import { calculateSalary } from "./players.js"; 

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Rex","Popi","Josh","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese"];
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

export function generateFreeAgents({ year=1, count=80, seed="fa" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const list = [];

  for (let i=0;i<count;i++){
    const grade = rollGrade(r);
    // Lower OVR avg for FA pool compared to drafted rosters
    const ovr = clamp(Math.floor(60 + r()*26), 60, 90); 
    
    // Generate Age for FAs
    const rand = r();
    let age = 24;
    if (rand < 0.1) age = 20 + Math.floor(r()*3);
    else if (rand < 0.6) age = 23 + Math.floor(r()*7); // prime
    else if (rand < 0.9) age = 30 + Math.floor(r()*5); // vet
    else age = 35 + Math.floor(r()*5);

    // Calculate Ask
    let ask = calculateSalary(ovr, age);
    
    // Add randomness to ask (greed)
    const greed = 0.9 + r() * 0.2; // 0.9x to 1.1x
    ask = Number((ask * greed).toFixed(2));

    list.push({
      id: id("fa", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos: pick(POS, r),
      ovr,
      age, // Added Age
      potentialGrade: grade,
      ask,
      yearsAsk: 1 + Math.floor(r()*4),
      wantsWinning: r() < 0.5,
      wantsRole: r() < 0.6,
      signedByTeamId: null,
      promisedRole: null,
      contract: null
    });
  }

  // sort best first
  list.sort((a,b) => b.ovr - a.ovr);
  return list;
}
