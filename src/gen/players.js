import { rng, seedFromString, pick, id, clamp } from "../utils.js";

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese","Luke","Sam","Tim"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Jones","Smith","Ward"];
const POS = ["PG","SG","SF","PF","C"];

export function calculateSalary(ovr, age) {
  let base = 0.5;
  if (ovr > 60) {
      const t = (ovr - 60) / (99 - 60); 
      base = 0.5 + Math.pow(t, 2.2) * 47.5; 
  }
  let ageMult = 1.0;
  if (age < 22) ageMult = 0.95;
  else if (age >= 30 && age < 34) ageMult = 0.90;
  else if (age >= 34) ageMult = 0.70;

  return Number((base * ageMult).toFixed(2));
}

export function generateTeamRoster({ teamName, teamRating, year=1, seed="roster" }){
  const r = rng(seedFromString(`${seed}_${teamName}_${year}`));
  const roster = [];
  const quality = clamp((teamRating - 60) / 35, 0, 1);

  const genPlayer = (targetPos, minOvr, maxOvr) => {
      const ovr = clamp(Math.floor(minOvr + r()*(maxOvr - minOvr + 1)), 60, 99);
      
      const rand = r();
      let age;
      if (rand < 0.15) age = 19 + Math.floor(r()*3);
      else if (rand < 0.70) age = 22 + Math.floor(r()*8);
      else if (rand < 0.90) age = 30 + Math.floor(r()*5);
      else age = 35 + Math.floor(r()*5);

      let pot = "C";
      if (age < 23) pot = pick(["A","A","B","B","C","D"], r);
      else if (age > 29) pot = pick(["C","C","D","F"], r);
      else pot = pick(["A","B","C","C","D"], r);

      const salary = calculateSalary(ovr, age);

      // --- ROY FIX: If Year 1 and young, mark as Rookie ---
      let rookieYear = null;
      if (year === 1 && age <= 21 && r() < 0.3) {
          rookieYear = 1;
      }
      // ----------------------------------------------------

      return {
          id: id("pl", r),
          name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
          pos: targetPos,
          age,
          ovr,
          potentialGrade: pot,
          happiness: 70,
          dev: { focus: "Balanced", points: 0 },
          contract: { years: 1 + Math.floor(r()*4), salary },
          stats: { gp:0, pts:0, reb:0, ast:0 },
          rotation: { minutes: 0, isStarter: false },
          careerStats: [], // Ensure history exists
          rookieYear 
      };
  };

  // --- POSITIONAL BALANCE ---
  for (const pos of POS) {
      roster.push(genPlayer(pos, 75 + 10*quality, 85 + 10*quality));
      roster.push(genPlayer(pos, 65 + 5*quality, 74 + 5*quality));
  }
  for(let i=0; i<5; i++) {
      const pos = pick(POS, r);
      roster.push(genPlayer(pos, 60, 72));
  }

  roster.sort((a,b) => b.ovr - a.ovr);
  
  return roster;
}
