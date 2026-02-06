import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { generateTeamRoster } from "./gen/players.js";
import { HOURS_BANK_MAX, HOURS_PER_WEEK, SEASON_WEEKS, PHASES, SALARY_CAP } from "./data/constants.js";
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
  STATE = newGameState({ userTeamIndex: 0 });
}

// -------- NEW: allow team selection ----------
export function newGameState({ userTeamIndex=0 } = {}){
  const year = 1;
  const league = generateLeague({ seed: "v1_seed" });

  // build rosters for ALL teams
  for (const t of league.teams){
    t.roster = generateTeamRoster({ teamName: t.name, teamRating: t.rating, year });
    t.cap.payroll = Number(t.roster.reduce((sum,p)=> sum + p.contract.salary, 0).toFixed(1));
    // ensure under cap in v1 by scaling down slightly if needed
    if (t.cap.payroll > t.cap.cap){
      const scale = t.cap.cap / t.cap.payroll;
      for (const p of t.roster){
        p.contract.salary = Number((p.contract.salary * scale).toFixed(1));
      }
      t.cap.payroll = Number(t.roster.reduce((sum,p)=> sum + p.contract.salary, 0).toFixed(1));
    }
  }

  // schedule: 20 weeks, each team plays 4 games/week ~ 80 games
  const schedule = generateWeeklySchedule(league.teams.map(t => t.id), SEASON_WEEKS, 4);

  return {
    meta: { version: "0.3.0", createdAt: Date.now() },
    activeSaveSlot: null,
    game: {
      year,
      phase: PHASES.REGULAR,
      week: 1,
      seasonWeeks: SEASON_WEEKS,
      schedule,
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
        // NEW: who YOU scouted
        scoutedNCAAIds: [],
        scoutedIntlIds: [],
        // NEW: "found" intl timers (expire after 3 weeks if not declared)
        intlFoundWeekById: {},
        intlLocation: null
      },
      playoffs: null,
      offseason: { freeAgents: null, draft: null },
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

// ---------- NEW: weekly sim + scouting decay ----------
export function advanceWeek(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  // simulate current week's games before incrementing week
  simWeekGames(g);

  g.week += 1;

  // hours rollover
  const newBanked = clamp(g.hours.banked + g.hours.available, 0, g.hours.bankMax);
  g.hours.banked = newBanked;
  g.hours.available = HOURS_PER_WEEK;

  // scouting decay: intl found but not declared expires after 3 weeks
  expireIntlFoundProspects(g);

  if (g.week > g.seasonWeeks){
    g.week = g.seasonWeeks;
    g.inbox.unshift({ t: Date.now(), msg: "Regular season complete. Start Playoffs." });
  }
}

function expireIntlFoundProspects(g){
  const found = g.scouting.intlFoundWeekById || {};
  const nowWeek = g.week;
  const pool = g.scouting.intlPool;

  const keep = [];
  for (const p of pool){
    if (p.declared) { keep.push(p); continue; }

    const fw = found[p.id];
    if (!fw) { keep.push(p); continue; }

    // after 3 weeks, they disappear if you didn't convince them
    if ((nowWeek - fw) >= 3){
      // vanish: also remove from scouted list so you can’t draft them
      g.scouting.scoutedIntlIds = g.scouting.scoutedIntlIds.filter(x => x !== p.id);
      delete found[p.id];
      continue;
    }
    keep.push(p);
  }
  g.scouting.intlPool = keep;
  g.scouting.intlFoundWeekById = found;
}

// --- schedule + sim ---
function generateWeeklySchedule(teamIds, weeks, gamesPerWeekPerTeam){
  // each week: pair teams randomly without repeats that week
  const schedule = [];
  for (let w=1; w<=weeks; w++){
    const ids = teamIds.slice();
    shuffle(ids);
    const games = [];

    // each team needs gamesPerWeekPerTeam games, but pairing gets tricky
    // v1: create 2 games per team by pairing once (16 games = 32 teams)
    // and do it twice per week => 4 games per team
    for (let pass=0; pass<2; pass++){
      shuffle(ids);
      for (let i=0;i<ids.length;i+=2){
        games.push([ids[i], ids[i+1]]);
      }
    }
    schedule.push({ week:w, games });
  }
  return schedule;

  function shuffle(a){
    for (let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
}

function simWeekGames(g){
  const wk = g.week;
  const bundle = g.schedule.find(x => x.week === wk);
  if (!bundle) return;

  for (const [aId, bId] of bundle.games){
    const A = g.league.teams.find(t => t.id === aId);
    const B = g.league.teams.find(t => t.id === bId);

    // win probability based on team rating + tiny randomness
    const pA = clamp(0.5 + (A.rating - B.rating) * 0.015 + (Math.random()*0.06 - 0.03), 0.15, 0.85);
    const aWin = Math.random() < pA;

    if (aWin){ A.wins++; B.losses++; }
    else { B.wins++; A.losses++; }

    // update player stats (very simple but feels alive)
    simTeamStats(A);
    simTeamStats(B);

    // update happiness slightly based on result
    bumpHappiness(A, aWin ? +1 : -1);
    bumpHappiness(B, aWin ? -1 : +1);
  }
}

function simTeamStats(team){
  const top = team.roster.slice().sort((a,b)=> b.ovr - a.ovr).slice(0, 9);
  for (let i=0;i<top.length;i++){
    const p = top[i];
    const usage = clamp(1.2 - i*0.08, 0.55, 1.2);
    const pts = clamp((p.ovr - 55) * 0.35 * usage + (Math.random()*6), 0, 40);
    const reb = clamp((p.pos==="C"||p.pos==="PF" ? 6 : 3) * usage + Math.random()*3, 0, 18);
    const ast = clamp((p.pos==="PG" ? 6 : p.pos==="SG" ? 3.5 : 2.2) * usage + Math.random()*2, 0, 14);

    p.stats.gp += 1;
    p.stats.pts += pts;
    p.stats.reb += reb;
    p.stats.ast += ast;
  }
}

function bumpHappiness(team, delta){
  for (const p of team.roster){
    p.happiness = clamp((p.happiness ?? 70) + delta, 0, 100);
  }
}

// per-game view helper: stored totals but UI shows per-game
export function finalizePlayerAverages(){
  const g = STATE.game;
  for (const t of g.league.teams){
    for (const p of t.roster){
      const gp = Math.max(1, p.stats.gp || 1);
      p.stats.pts = p.stats.pts / gp;
      p.stats.reb = p.stats.reb / gp;
      p.stats.ast = p.stats.ast / gp;
    }
  }
}

// ===== PLAYOFFS + OFFSEASON remain mostly same as your current East/West version =====
// Keep your existing startPlayoffs and simPlayoffRound from earlier.

export function startFreeAgency(){
  const g = STATE.game;
  g.phase = PHASES.FREE_AGENCY;

  g.offseason.freeAgents = {
    cap: SALARY_CAP,
    pool: generateFreeAgents({ year: g.year, count: 80, seed: "fa" })
  };

  g.inbox.unshift({ t: Date.now(), msg: "Free Agency started." });
}

export function startDraft(){
  const g = STATE.game;
  g.phase = PHASES.DRAFT;

  const order = [...g.league.teams].sort((a,b) => a.wins - b.wins);

  const declared = [
    ...g.scouting.ncaa.filter(p => p.declared),
    ...g.scouting.intlPool.filter(p => p.declared)
  ];

  declared.sort((a,b) => (b.currentOVR - a.currentOVR) + (Math.random() - 0.5));

  g.offseason.draft = {
    round: 1,
    pickIndex: 0,
    orderTeamIds: order.map(t => t.id),
    declaredProspects: declared,
    drafted: [],
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
  g.scouting.scoutedNCAAIds = [];
  g.scouting.scoutedIntlIds = [];
  g.scouting.intlFoundWeekById = {};
  g.scouting.intlLocation = null;

  // reset league records + schedule
  for (const t of g.league.teams){
    t.wins = 0;
    t.losses = 0;
    // keep rosters in place for now (later: contracts expire, etc.)
  }
  g.schedule = generateWeeklySchedule(g.league.teams.map(t => t.id), SEASON_WEEKS, 4);

  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
}
