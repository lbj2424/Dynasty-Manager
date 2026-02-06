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

  const teams = [...g.league.teams].sort((a,b) => b.wins - a.wins);
  const top16 = teams.slice(0, 16);

  // bracket pairs: 1v16, 2v15, ...
  const series = [];
  for (let i=0;i<8;i++){
    const high = top16[i];
    const low  = top16[15 - i];
    series.push(makeSeries(high.id, low.id));
  }

  g.playoffs = {
    round: 1,
    rounds: [
      { name: "Round 1", series },
      { name: "Round 2", series: [] },
      { name: "Conference Finals", series: [] },
      { name: "Finals", series: [] }
    ],
    championTeamId: null
  };

  g.phase = PHASES.PLAYOFFS;
  g.inbox.unshift({ t: Date.now(), msg: "Playoffs started (Top 16 overall, best of 7)." });
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

  const cur = g.playoffs.rounds[g.playoffs.round - 1];
  for (const s of cur.series){
    if (!s.done) simulateSeries(s);
  }

  // advance winners
  const winners = cur.series.map(s => s.winner);
  if (g.playoffs.round === 4){
    g.playoffs.championTeamId = winners[0];
    g.inbox.unshift({ t: Date.now(), msg: `Champion crowned: ${teamById(winners[0]).name}.` });
    // go to free agency
    startFreeAgency();
    return;
  }

  const next = g.playoffs.rounds[g.playoffs.round]; // next round object
  next.series = [];
  for (let i=0;i<winners.length/2;i++){
    next.series.push(makeSeries(winners[i*2], winners[i*2+1]));
  }

  g.playoffs.round += 1;
  g.inbox.unshift({ t: Date.now(), msg: `Advanced to ${next.name}.` });
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
