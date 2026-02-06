import { NBA_TEAM_NAMES_32 } from "../data/constants.js";
import { seedFromString, rng, id } from "../utils.js";

export function generateLeague({ seed="league_v1" } = {}){
  const r = rng(seedFromString(seed));

  const teams = NBA_TEAM_NAMES_32.slice(0, 32).map((name, i) => ({
    id: id("team", r),
    name,
    wins: 0,
    losses: 0,
    // roster filled later (v1: empty placeholder)
    roster: []
  }));

  return {
    id: id("league", r),
    seed,
    teams
  };
}
