import { NBA_TEAM_NAMES_32, SALARY_CAP } from "../data/constants.js";
import { seedFromString, rng, id, clamp } from "../utils.js";

export function generateLeague({ seed="league_v1" } = {}){
  const r = rng(seedFromString(seed));

  const teams = NBA_TEAM_NAMES_32.slice(0, 32).map(() => ({
    id: id("team", r),
    name: null,
    rating: 0,
    wins: 0,
    losses: 0,
    cap: {
      cap: SALARY_CAP,
      payroll: 0
    },
    roster: [],
    picks: {
      r1: true,
      r2: true
    }
  }));

  // assign names + ratings
  for (let i=0;i<teams.length;i++){
    teams[i].name = NBA_TEAM_NAMES_32[i];
    // rating 68-92
    teams[i].rating = clamp(Math.floor(68 + r()*25), 60, 95);
  }

  return {
    id: id("league", r),
    seed,
    teams
  };
}
