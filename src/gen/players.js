import { rng, seedFromString, pick, id, clamp } from "../utils.js";

const FIRST = ["Jalen","Marcus","Isaiah","Noah","Liam","Ethan","Mason","Aiden","Kai","Leo","Mateo","Jayden","Caleb","Owen","Carter","Julian","Jordan","Darius","Malik","Trey","Dillon","DeAndre","Aaron","Tyrese","Luke","Sam","Tim"];
const LAST  = ["Cruz","Johnson","Smith","Brown","Williams","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Jones","Smith","Ward"];
const POS = ["PG","SG","SF","PF","C"];

// New Salary Logic: Exponential curve based on OVR + Age Discount
export function calculateSalary(ovr, age) {
  // 1. Base Salary Curve (based on ~120M Cap)
  // 99 OVR -> ~48M (Supermax)
  // 90 OVR -> ~30M
  // 80 OVR -> ~12M
  // 70 OVR -> ~2.5M
  // 60 OVR -> ~0.5M (Min)
  
  let base = 0.5;
  if (ovr > 60) {
      // Normalized score 0.0 to 1.0
      const t = (ovr - 60) / (99 - 60); 
      // Power curve 2.2 makes it grow slowly then fast
      base = 0.5 + Math.pow(t, 2.2) * 47.5; 
  }

  // 2. Age Factor
  // < 22: 95% (Rookie scale / Unproven)
  // 22-29: 100% (Prime)
  // 30-33: 90% (Post-Prime)
  // 34+: 70% (Decline discount)
  let ageMult = 1.0;
  if (age < 22) ageMult = 0.95;
  else if (age >= 30 && age < 34) ageMult = 0.90;
  else if (age >= 34) ageMult = 0.70;

  return Number((base * ageMult).toFixed(2));
}

export function generateTeamRoster({ teamName, teamRating, year=1, seed="roster" }){
  const r = rng(seedFromString(`${seed}_${teamName}_${year}`));
  const roster = [];
  
  // Normalize team quality (0.0 = trash, 1.0 = super team)
  // teamRating typically 60-95
  const quality = clamp((teamRating - 60) / 35, 0, 1);

  // Helper to gen player in specific tier
  const genPlayer = (minOvr, maxOvr) => {
      const pos = pick(POS, r);
      // skew OVR slightly towards middle of range
      const ovr = clamp(Math.floor(minOvr + r()*(maxOvr - minOvr + 1)), 60, 99);
      
      // Age Distribution weighted towards 23-28
      const rand = r();
      let age;
      if (rand < 0.15) age = 19 + Math.floor(r()*3);      // 19-21 (Young)
      else if (rand < 0.70) age = 22 + Math.floor(r()*8); // 22-29 (Prime)
      else if (rand < 0.90) age = 30 + Math.floor(r()*5); // 30-34 (Vet)
      else age = 35 + Math.floor(r()*5);                  // 35-39 (Old)

      // Potential based on age
      let pot = "C";
      if (age < 23) pot = pick(["A","A","B","B","C","D"], r);
      else if (age > 29) pot = pick(["C","C","D","F"], r);
      else pot = pick(["A","B","C","C","D"], r);

      const salary = calculateSalary(ovr, age);

      return {
          id: id("pl", r),
          name: `${pick(FIRST, r)} ${pick(LAST, r)}`,
          pos,
          age,
          ovr,
          potentialGrade: pot,
          happiness: 70,
          dev: { focus: "Balanced", points: 0 },
          contract: { years: 1 + Math.floor(r()*4), salary },
          stats: { gp:0, pts:0, reb:0, ast:0 },
          rotation: { minutes: 0, isStarter: false }
      };
  };

  // --- STRUCTURED ROSTER CONSTRUCTION ---
  
  // 1. The Stars (2 players)
  // Best team: 94-99, Worst team: 78-85
  roster.push(genPlayer(78 + 16*quality, 85 + 14*quality)); 
  roster.push(genPlayer(75 + 12*quality, 82 + 10*quality));

  // 2. The Starters (3 players)
  // Best: 80-86, Worst: 70-76
  for(let i=0; i<3; i++) {
      roster.push(genPlayer(70 + 10*quality, 76 + 10*quality));
  }

  // 3. The Bench (5 players)
  // Best: 74-79, Worst: 65-72
  for(let i=0; i<5; i++) {
      roster.push(genPlayer(65 + 9*quality, 72 + 7*quality));
  }

  // 4. The Reserves (5 players)
  // Everyone has scrubs (60-68)
  for(let i=0; i<5; i++) {
      roster.push(genPlayer(60, 68));
  }

  // Sort by OVR
  roster.sort((a,b) => b.ovr - a.ovr);
  
  return roster;
}
