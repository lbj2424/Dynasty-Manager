import { rng, seedFromString, pick, id, clamp } from "../utils.js";

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez"];
const POS = ["PG","SG","SF","PF","C"];
const POT = ["A+","A","B","C","D","F"];

function salaryFromOVR(ovr){
  if (ovr >= 90) return 34 + (ovr-90)*1.1;
  if (ovr >= 85) return 24 + (ovr-85)*2.0;
  if (ovr >= 80) return 16 + (ovr-80)*1.6;
  if (ovr >= 75) return 9 + (ovr-75)*1.4;
  if (ovr >= 70) return 5 + (ovr-70)*0.8;
  return 2 + (ovr-60)*0.25;
}

export function generateTeamRoster({ teamName, teamRating, year=1, seed="roster" }){
  const r = rng(seedFromString(`${seed}_${teamName}_${year}`));

  // build 12–15 players around teamRating
  const rosterSize = 15;
  const roster = [];

  for (let i=0;i<rosterSize;i++){
    const pos = pick(POS, r);
    const ovr = clamp(Math.floor((teamRating - 8) + r()*16), 60, 92);
    const pot = pick(POT, r);
    const salary = Math.round(salaryFromOVR(ovr) * 10) / 10;

    roster.push({
      id: id("pl", r),
      name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
      pos,
      ovr,
      potentialGrade: pot,
      happiness: 70,
      dev: { focus: "Overall", points: 7 }, // later you’ll change this
      contract: { years: 1 + Math.floor(r()*4), salary },
      stats: { gp:0, pts:0, reb:0, ast:0 } // totals; we’ll compute per-game
    });
  }

  // normalize payroll near cap by trimming the bottom salaries a bit
  roster.sort((a,b) => b.ovr - a.ovr);

  return roster;
}
