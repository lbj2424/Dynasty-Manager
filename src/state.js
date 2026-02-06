import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { HOURS_BANK_MAX, HOURS_PER_WEEK, SEASON_WEEKS, PHASES, DECLARE_THRESHOLD, SALARY_CAP } from "./data/constants.js";
import { clamp } from "./utils.js";

const KEY_ACTIVE = "dynasty_active_slot";
const KEY_SAVE_PREFIX = "dynasty_save_";

let STATE = null;

export function getState(){ return STATE; }

export function ensureAppState(loadedOrNull){
  if (loadedOrNull){
    STATE = loadedOrNull;
    return;
  }
  STATE = newGameState();
}

export function newGameState(){
  const year = 1;
  const league = generateLeague({ seed: "v1_seed" });

  // pick a user team (v1: first team)
  const userTeamIndex = 0;
  const userTeam = league.teams[userTeamIndex];

  // give user a starter roster placeholder (cheap contracts)
  userTeam.roster = [];
  userTeam.cap.payroll = 0;

  return {
    meta: { version: "0.2.0", createdAt: Date.now() },
    activeSaveSlot: null,
    game: {
      year,
      phase: PHASES.REGULAR,
      week: 1,
      seasonWeeks: SEASON_WEEKS,
      hours: {
        available: 25,
        banked: 0,
        bankMax: HOURS_BANK_MAX
      },
      league,
      userTeamIndex,
      scouting: {
        tab: "NCAA",
        ncaa: generateNCAAProspects({ year, count: 100, seed: "ncaa" }),
        intlPool: generateInternationalPool({ year, count: 100, seed: "intl" }),
        intlDiscoveredIds: [],
        intlLocation: null
      },
      playoffs: null,
      offseason: {
        freeAgents: null,
        draft: null
      },
      inbox: []
    }
  };
}

export function setActiveSaveSlot(slot){
  STATE.activeSaveSlot = slot;
  localStorage.setItem(KEY_ACTIVE, slot);
}

export function getActiveSaveSlot(){
  return localStorage.getItem(KEY_ACTIVE) || null;
}

export function loadActiveOrNull(){
  const slot = getActiveSaveSlot();
  if (!slot) return null;
  const raw = localStorage.getItem(KEY_SAVE_PREFIX + slot);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveToSlot(slot){
  STATE.activeSaveSlot = slot;
  localStorage.setItem(KEY_ACTIVE, slot);
  localStorage.setItem(KEY_SAVE_PREFIX + slot, JSON.stringify(STATE));
  return true;
}

export function loadFromSlot(slot){
  const raw = localStorage.getItem(KEY_SAVE_PREFIX + slot);
  if (!raw) return null;
  try{
    const parsed = JSON.parse(raw);
    STATE = parsed;
    setActiveSaveSlot(slot);
    return STATE;
  } catch {
    return null;
  }
}

export function deleteSlot(slot){
  localStorage.removeItem(KEY_SAVE_PREFIX + slot);
  const active = getActiveSaveSlot();
  if (active === slot) localStorage.removeItem(KEY_ACTIVE);
}

export function spendHours(n){
  const h = STATE.game.hours;
  let need = n;

  const aSpend = Math.min(h.available, need);
  h.available -= aSpend;
  need -= aSpend;

  if (need > 0){
    const bSpend = Math.min(h.banked, need);
    h.banked -= bSpend;
    need -= bSpend;
  }
  return need === 0;
}

export function advanceWeek(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  g.week += 1;

  // weekly hours
  const newBanked = clamp(g.hours.banked + g.hours.available, 0, g.hours.bankMax);
  g.hours.banked = newBanked;
  g.hours.available = HOURS_PER_WEEK;

  if (g.week > g.seasonWeeks){
    g.week = g.seasonWeeks;
    g.inbox.unshift({ t: Date.now(), msg: "Regular season complete. Start Playoffs." });
  }
}

function calcWinsFromRating(rating){
  // 20-week season -> treat as ~82-game scaling but we just need ordering.
  // Map rating to win% around .30 to .70
  const pct = clamp(0.30 + (rating - 68) * 0.01, 0.22, 0.78);
  const games = 82;
  const wins = Math.round(pct * games);
  return clamp(wins, 10, 72);
}

export function finalizeRegularSeasonIfNeeded(){
  const g = STATE.game;
  const teams = g.league.teams;

  // If already has records beyond 0, assume done
  const already = teams.some(t => (t.wins + t.losses) > 0);
  if (already) return;

  for (const t of teams){
    const wins = calcWinsFromRating(t.rating);
    t.wins = wins;
    t.losses = 82 - wins;
  }

  // small random shuffle to break ties without a tool
  teams.sort((a,b) => b.wins - a.wins || (Math.random() - 0.5));
}

export function startPlayoffs(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  finalizeRegularSeasonIfNeeded();

  const east = g.league.teams
    .filter(t => t.conference === "EAST")
    .sort((a,b) => b.wins - a.wins)
    .slice(0, 8);

  const west = g.league.teams
    .filter(t => t.conference === "WEST")
    .sort((a,b) => b.wins - a.wins)
    .slice(0, 8);

  // 1v8, 2v7, 3v6, 4v5
  const seedSeries = (arr8) => ([
    makeSeries(arr8[0].id, arr8[7].id),
    makeSeries(arr8[1].id, arr8[6].id),
    makeSeries(arr8[2].id, arr8[5].id),
    makeSeries(arr8[3].id, arr8[4].id)
  ]);

  g.playoffs = {
    round: 1,
    rounds: [
      { name: "Round 1", east: seedSeries(east), west: seedSeries(west) },
      { name: "Conference Semifinals", east: [], west: [] },
      { name: "Conference Finals", east: [], west: [] },
      { name: "Finals", finals: [] }
    ],
    championTeamId: null
  };

  g.phase = PHASES.PLAYOFFS;
  g.inbox.unshift({ t: Date.now(), msg: "Playoffs started (East/West top 8, best of 7)." });
}


function makeSeries(teamAId, teamBId){
  return {
    a: teamAId,
    b: teamBId,
    aWins: 0,
    bWins: 0,
    done: false,
    winner: null
  };
}
function winnersFromSeries(seriesList){
  return (seriesList || []).map(s => s.winner).filter(Boolean);
}

function pairWinners(winners){
  const out = [];
  for (let i=0;i<winners.length;i+=2){
    out.push(makeSeries(winners[i], winners[i+1]));
  }
  return out;
}

function teamById(id){
  return STATE.game.league.teams.find(t => t.id === id);
}

function simulateSeries(series){
  const A = teamById(series.a);
  const B = teamById(series.b);

  // simple advantage: rating + small randomness
  let a = A.rating + (Math.random()*6 - 3);
  let b = B.rating + (Math.random()*6 - 3);

  // simulate until one hits 4 wins
  let aWins = 0, bWins = 0;
  while (aWins < 4 && bWins < 4){
    const pA = clamp(0.5 + (a - b) * 0.015, 0.20, 0.80);
    if (Math.random() < pA) aWins++;
    else bWins++;
  }

  series.aWins = aWins;
  series.bWins = bWins;
  series.done = true;
  series.winner = aWins > bWins ? series.a : series.b;
}

export function simPlayoffRound(){
  const g = STATE.game;
  if (g.phase !== PHASES.PLAYOFFS) return;

  const bracket = g.playoffs;
  const cur = bracket.rounds[bracket.round - 1];

  // Sim current round series
  if (bracket.round <= 3){
    for (const s of (cur.east || [])) if (!s.done) simulateSeries(s);
    for (const s of (cur.west || [])) if (!s.done) simulateSeries(s);

    const eastW = winnersFromSeries(cur.east);
    const westW = winnersFromSeries(cur.west);

    if (bracket.round === 3){
      // Move to Finals
      const finalsRound = bracket.rounds[3];
      finalsRound.finals = [ makeSeries(eastW[0], westW[0]) ];
      bracket.round = 4;
      g.inbox.unshift({ t: Date.now(), msg: "Finals set: East champ vs West champ." });
      return;
    }

    // Build next round in each conference
    const next = bracket.rounds[bracket.round]; // next object
    next.east = pairWinners(eastW);
    next.west = pairWinners(westW);
    bracket.round += 1;

    g.inbox.unshift({ t: Date.now(), msg: `Advanced to ${next.name}.` });
    return;
  }

  // Finals (round 4)
  const finalsRound = bracket.rounds[3];
  const series = finalsRound.finals?.[0];
  if (series && !series.done) simulateSeries(series);

  if (series?.done){
    bracket.championTeamId = series.winner;
    g.inbox.unshift({ t: Date.now(), msg: `Champion crowned: ${teamById(series.winner).name}.` });
    startFreeAgency();
  }
}

export function startFreeAgency(){
  const g = STATE.game;
  g.phase = PHASES.FREE_AGENCY;

  // generate free agents each offseason
  g.offseason.freeAgents = {
    cap: SALARY_CAP,
    pool: generateFreeAgents({ year: g.year, count: 80, seed: "fa" })
  };

  g.inbox.unshift({ t: Date.now(), msg: "Free Agency started." });
}

export function startDraft(){
  const g = STATE.game;
  g.phase = PHASES.DRAFT;

  // draft order worst -> best based on regular season record (wins asc)
  const order = [...g.league.teams].sort((a,b) => a.wins - b.wins);

  // declared prospects only
  const declared = [
    ...g.scouting.ncaa.filter(p => p.declared),
    ...g.scouting.intlPool.filter(p => p.declared)
  ];

  // randomize a bit so it isn't perfectly sorted
  declared.sort((a,b) => (b.currentOVR - a.currentOVR) + (Math.random() - 0.5));

  g.offseason.draft = {
    round: 1,
    pickIndex: 0,
    orderTeamIds: order.map(t => t.id),
    declaredProspects: declared,
    drafted: [], // {teamId, prospectId, round, pickNumberOverall}
    done: false
  };

  g.inbox.unshift({ t: Date.now(), msg: "Draft started (2 rounds)." });
}

export function advanceToNextYear(){
  const g = STATE.game;

  g.year += 1;
  g.week = 1;
  g.phase = PHASES.REGULAR;

  // reset hours
  g.hours.available = 25;
  g.hours.banked = 0;

  // reset scouting pools
  g.scouting.ncaa = generateNCAAProspects({ year: g.year, count: 100, seed: "ncaa" });
  g.scouting.intlPool = generateInternationalPool({ year: g.year, count: 100, seed: "intl" });
  g.scouting.intlDiscoveredIds = [];
  g.scouting.intlLocation = null;

  // reset league records
  for (const t of g.league.teams){
    t.wins = 0;
    t.losses = 0;
  }

  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
}
