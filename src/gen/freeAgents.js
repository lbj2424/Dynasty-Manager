import { rng, seedFromString, pick, id, clamp } from "../utils.js";
import { POTENTIAL_GRADES } from "../data/constants.js";

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

function salaryDemandFromOVR(ovr){
  // in "millions", tuned to a 120 cap
  if (ovr >= 90) return 38 + (ovr-90)*1.2;
  if (ovr >= 85) return 26 + (ovr-85)*2.0;
  if (ovr >= 80) return 18 + (ovr-80)*1.6;
  if (ovr >= 75) return 10 + (ovr-75)*1.6;
  if (ovr >= 70) return 6 + (ovr-70)*0.8;
  return 2 + (ovr-60)*0.25;
}

export function generateFreeAgents({ year=1, count=80, seed="fa" } = {}){
  const r = rng(seedFromString(`${seed}_${year}`));
  const list = [];

  for (let i=0;i<count;i++){
    const grade = rollGrade(r);
    const ovr = clamp(Math.floor(64 + r()*24), 55, 92);
    const ask = salaryDemandFromOVR(ovr);

    list.push({
      id: id("fa", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos: pick(POS, r),
      ovr,
      potentialGrade: grade,
      ask: Math.round(ask * 10) / 10,
      yearsAsk: 1 + Math.floor(r()*4),
      // simple personality knobs for later
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
