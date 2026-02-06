import { NBA_TEAM_NAMES_32, SALARY_CAP, EAST_TEAMS } from "../data/constants.js";
import { seedFromString, rng, id, clamp } from "../utils.js";

export function generateLeague({ seed="league_v1" } = {}){
  const r = rng(seedFromString(seed));

  const teams = NBA_TEAM_NAMES_32.slice(0, 32).map((name) => ({
    id: id("team", r),
    name,
    conference: EAST_TEAMS.has(name) ? "EAST" : "WEST",
    rating: clamp(Math.floor(68 + r()*25), 60, 95),
    wins: 0,
    losses: 0,
    cap: { cap: SALARY_CAP, payroll: 0 },
    roster: [],
    picks: { r1: true, r2: true }
  }));

  return { id: id("league", r), seed, teams };
}
