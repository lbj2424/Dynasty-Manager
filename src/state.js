import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { generateTeamRoster } from "./gen/players.js";
import {
  HOURS_BANK_MAX,
  HOURS_PER_WEEK,
  SEASON_WEEKS,
  PHASES,
  SALARY_CAP
} from "./data/constants.js";
import { clamp } from "./utils.js";

const KEY_ACTIVE = "dynasty_active_slot";
const KEY_SAVE_PREFIX = "dynasty_save_";

let STATE = null;

export function getState(){ return STATE; }

export function ensureAppState(loadedOrNull){
  if (loadedOrNull){
    STATE = loadedOrNull;
    // basic migration safety
    STATE.game.history ??= [];
    STATE.game.league?.teams?.forEach(t => {
      t.wins ??= 0;
      t.losses ??= 0;
      t.roster?.forEach(p => {
        p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
        p.happiness ??= 70;
      });
    });
    return;
  }
  STATE = newGameState({ userTeamIndex: 0 });
}

// -------------------- NEW GAME --------------------
export function newGameState({ userTeamIndex=0 } = {}){
  const year = 1;
  const league = generateLeague({ seed: "v1_seed" });

  // Ensure wins/losses exist (CRITICAL)
  for (const t of league.teams){
    t.wins ??= 0;
    t.losses ??= 0;
    t.roster ??= [];
    t.cap ??= { cap: SALARY_CAP, payroll: 0 };
    t.cap.cap ??= SALARY_CAP;
    t.cap.payroll ??= 0;
  }

  // Build rosters for ALL teams + ensure safe player fields
  for (const t of league.teams){
    t.roster = generateTeamRoster({ teamName: t.name, teamRating: t.rating, year }) || [];

    for (const p of t.roster){
      p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
      p.happiness ??= 70;
      // optional placeholders for future systems
      p.energy ??= 100;
      p.dev ??= p.dev || { focus: "Balanced", points: 7 };
    }

    t.cap.payroll = Number(t.roster.reduce((sum,p)=> sum + (p.contract?.salary || 0), 0).toFixed(1));

    // Ensure under cap by scaling down slightly if needed
    if (t.cap.payroll > t.cap.cap){
      const scale = t.cap.cap / Math.max(1, t.cap.payroll);
      for (const p of t.roster){
        if (p.contract?.salary != null){
          p.contract.salary = Number((p.contract.salary * scale).toFixed(1));
        }
      }
      t.cap.payroll = Number(t.roster.reduce((sum,p)=> sum + (p.contract?.salary || 0), 0).toFixed(1));
    }
  }

  // schedule: 20 weeks, each team plays 4 games/week ~ 80 games
  const schedule = generateWeeklySchedule(league.teams.map(t => t.id), SEASON_WEEKS, 4);

  return {
    meta: { version: "0.3.1", createdAt: Date.now() },
    activeSaveSlot: null,
    game: {
      year,
      phase: PHASES.REGULAR,
      week: 1,
      seasonWeeks: SEASON_WEEKS,
      schedule,
      hours: {
        available: HOURS_PER_WEEK,
        banked: 0,
        bankMax: HOURS_BANK_MAX
      },
      league,
      userTeamIndex,
      scouting: {
        tab: "NCAA",
        ncaa: generateNCAAProspects({ year, count: 100, seed: "ncaa" }),
        intlPool: generateInternationalPool({ year, count: 100, seed: "intl" }),
        scoutedNCAAIds: [],
        scoutedIntlIds: [],
        intlFoundWeekById: {},
        intlLocation: null
      },
      playoffs: null,
      offseason: { freeAgents: null, draft: null },
      inbox: [],
      history: []
    }
  };
}

// -------------------- SAVES --------------------
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

// -------------------- HOURS --------------------
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

// -------------------- REGULAR SEASON --------------------
export function advanceWeek(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  // simulate games for this week
  simWeekGames(g);

  // increment week
  g.week += 1;

  // hours rollover
  g.hours.banked = clamp(g.hours.banked + g.hours.available, 0, g.hours.bankMax);
  g.hours.available = HOURS_PER_WEEK;

  // expire intl "found" but not declared after 3 weeks
  expireIntlFoundProspects(g);

  if (g.week > g.seasonWeeks){
    g.week = g.seasonWeeks;
    g.inbox.unshift({ t: Date.now(), msg: "Regular season complete. Start Playoffs." });
  }
}

function expireIntlFoundProspects(g){
  const found = g.scouting.intlFoundWeekById || {};
  const nowWeek = g.week;

  const keep = [];
  for (const p of g.scouting.intlPool){
    if (p.declared) { keep.push(p); continue; }

    const fw = found[p.id];
    if (!fw) { keep.push(p); continue; }

    if ((nowWeek - fw) >= 3){
      // remove from "scouted" so you can't see hidden info later
      g.scouting.scoutedIntlIds = g.scouting.scoutedIntlIds.filter(x => x !== p.id);
      delete found[p.id];
      continue;
    }

    keep.push(p);
  }

  g.scouting.intlPool = keep;
  g.scouting.intlFoundWeekById = found;
}

function generateWeeklySchedule(teamIds, weeks){
  const schedule = [];
  for (let w=1; w<=weeks; w++){
    const games = [];

    // 2 passes of random pairings => 4 games per team each week
    for (let pass=0; pass<2; pass++){
      const ids = teamIds.slice();
      shuffle(ids);
      for (let i=0;i<ids.length;i+=2){
        games.push([ids[i], ids[i+1]]);
      }
    }

    schedule.push({ week:w, games });
  }
  return schedule;
}

function shuffle(a){
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function simWeekGames(g){
  const wk = g.week;
  const bundle = g.schedule.find(x => x.week === wk);
  if (!bundle) return;

  for (const [aId, bId] of bundle.games){
    const A = g.league.teams.find(t => t.id === aId);
    const B = g.league.teams.find(t => t.id === bId);
    if (!A || !B) continue;

    A.wins ??= 0; A.losses ??= 0;
    B.wins ??= 0; B.losses ??= 0;

    const pA = clamp(
      0.5 + (A.rating - B.rating) * 0.015 + (Math.random()*0.06 - 0.03),
      0.15,
      0.85
    );

    const aWin = Math.random() < pA;

    if (aWin){ A.wins += 1; B.losses += 1; }
    else { B.wins += 1; A.losses += 1; }

    simTeamStats(A);
    simTeamStats(B);

    bumpHappiness(A, aWin ? +1 : -1);
    bumpHappiness(B, aWin ? -1 : +1);
  }
}

function simTeamStats(team){
  const roster = team.roster || [];
  const top = roster.slice().sort((a,b)=> (b.ovr||0) - (a.ovr||0)).slice(0, 9);

  for (let i=0;i<top.length;i++){
    const p = top[i];
    p.stats ??= { gp:0, pts:0, reb:0, ast:0 };

    const usage = clamp(1.2 - i*0.08, 0.55, 1.2);

    const pts = clamp(((p.ovr || 70) - 55) * 0.35 * usage + (Math.random()*6), 0, 40);
    const rebBase = (p.pos==="C"||p.pos==="PF") ? 6 : 3;
    const reb = clamp(rebBase * usage + Math.random()*3, 0, 18);

    const astBase = p.pos==="PG" ? 6 : p.pos==="SG" ? 3.5 : 2.2;
    const ast = clamp(astBase * usage + Math.random()*2, 0, 14);

    p.stats.gp += 1;
    p.stats.pts += pts;
    p.stats.reb += reb;
    p.stats.ast += ast;
  }
}

function bumpHappiness(team, delta){
  for (const p of (team.roster || [])){
    p.happiness = clamp((p.happiness ?? 70) + delta, 0, 100);
  }
}
// ... existing imports

// -------------------- PLAYOFFS --------------------
export function startPlayoffs(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  const east = getConferenceStandings(g, "EAST").slice(0, 8);
  const west = getConferenceStandings(g, "WEST").slice(0, 8);

  g.phase = PHASES.PLAYOFFS;

  g.playoffs = {
    startedAt: Date.now(),
    round: 1,
    bestOf: 7,
    eastSeeds: east.map(t => t.id),
    westSeeds: west.map(t => t.id),
    championTeamId: null,
    userFinish: null,
    rounds: [] // Initialize rounds array
  };

  // Generate Round 1 Matchups immediately
  generateNextRoundMatchups(g);

  g.inbox.unshift({ t: Date.now(), msg: "Playoffs started (Top 8 East/West)." });
}

export function simPlayoffRound(){
  const g = STATE.game;
  if (g.phase !== PHASES.PLAYOFFS) return;
  
  const p = g.playoffs;
  const currentRoundIndex = p.round - 1;
  
  // Safety check
  if (!p.rounds[currentRoundIndex]) return;

  const rObj = p.rounds[currentRoundIndex];
  const allSeries = [...(rObj.east || []), ...(rObj.west || []), ...(rObj.finals || [])];

  let roundOver = true;

  // Sim games for every series in this round
  for (const s of allSeries){
    if (s.done) continue;

    // Sim until someone reaches 4 wins
    while (s.aWins < 4 && s.bWins < 4){
        // 50/50 coin flip for prototype (you can add team rating logic here later)
        if (Math.random() > 0.5) s.aWins++; 
        else s.bWins++;
    }

    s.done = true;
    s.winner = (s.aWins === 4) ? s.a : s.b;
  }

  // Check if we need to advance to next round
  if (roundOver) {
      if (p.round === 4) {
          // Finals just finished
          p.championTeamId = allSeries[0].winner;
          const userTeam = g.league.teams[g.userTeamIndex];
          finalizeSeasonAndLogHistory({ 
            championTeamId: p.championTeamId, 
            userPlayoffFinish: "Playoffs" // Simple placeholder
          });
          startFreeAgency(); // Auto-transition to FA
      } else {
          // Advance Round
          p.round++;
          generateNextRoundMatchups(g);
      }
  }
}

function generateNextRoundMatchups(g){
    const p = g.playoffs;
    const rNum = p.round;
    
    // Helper to build a series object
    const makeSeries = (idA, idB) => ({ a: idA, b: idB, aWins:0, bWins:0, done:false, winner:null });

    if (rNum === 1) {
        // 1v8, 4v5, 3v6, 2v7 (Standard bracket order for next round matching)
        const pair = (seeds) => [
            makeSeries(seeds[0], seeds[7]),
            makeSeries(seeds[3], seeds[4]),
            makeSeries(seeds[2], seeds[5]),
            makeSeries(seeds[1], seeds[6])
        ];
        p.rounds.push({ name: "Round 1", east: pair(p.eastSeeds), west: pair(p.westSeeds) });
    } 
    else if (rNum === 2 || rNum === 3) {
        const prev = p.rounds[rNum - 2];
        const nextRound = { name: rNum === 2 ? "Semis" : "Conf. Finals", east: [], west: [] };
        
        // Simple logic: Pair adjacent winners (Winner of Series 0 vs Winner of Series 1, etc.)
        for (const conf of ['east', 'west']) {
            const winners = prev[conf].map(s => s.winner);
            for (let i = 0; i < winners.length; i += 2) {
                nextRound[conf].push(makeSeries(winners[i], winners[i+1]));
            }
        }
        p.rounds.push(nextRound);
    } 
    else if (rNum === 4) {
        // Finals
        const prev = p.rounds[2]; // Conf finals
        const eastChamp = prev.east[0].winner;
        const westChamp = prev.west[0].winner;
        p.rounds.push({ name: "Finals", finals: [makeSeries(eastChamp, westChamp)] });
    }
}

function getConferenceStandings(g, conf){
  // ... (Keep your existing function) ...
  return (g.league.teams || [])
    .filter(t => t.conference === conf)
    .slice()
    .sort((a,b) => (b.wins - a.wins) || (a.losses - b.losses) || (b.rating - a.rating));
}

// ... existing code ...

// -------------------- FREE AGENCY --------------------
export function startFreeAgency(){
  const g = STATE.game;
  g.phase = PHASES.FREE_AGENCY;

  g.offseason.freeAgents = {
    cap: SALARY_CAP,
    pool: generateFreeAgents({ year: g.year, count: 80, seed: "fa" })
  };

  g.inbox.unshift({ t: Date.now(), msg: "Free Agency started." });
}

// -------------------- DRAFT --------------------
export function startDraft(){
  const g = STATE.game;
  g.phase = PHASES.DRAFT;

  // draft order: worst -> best record
  const order = [...g.league.teams].sort((a,b) => (a.wins - b.wins) || (b.losses - a.losses));

  // declared pool (you will hide ratings in UI unless scouted)
  const declared = [
    ...g.scouting.ncaa.filter(p => p.declared),
    ...g.scouting.intlPool.filter(p => p.declared)
  ];

  // slight randomness in overall board, CPU logic should still be separate in draft.js
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

// -------------------- NEXT YEAR --------------------
export function advanceToNextYear(){
  const g = STATE.game;

  g.year += 1;
  g.week = 1;
  g.phase = PHASES.REGULAR;

  // reset hours
  g.hours.available = HOURS_PER_WEEK;
  g.hours.banked = 0;

  // reset scouting pools
  g.scouting.ncaa = generateNCAAProspects({ year: g.year, count: 100, seed: "ncaa" });
  g.scouting.intlPool = generateInternationalPool({ year: g.year, count: 100, seed: "intl" });
  g.scouting.scoutedNCAAIds = [];
  g.scouting.scoutedIntlIds = [];
  g.scouting.intlFoundWeekById = {};
  g.scouting.intlLocation = null;

  // reset league records + schedule + player stats
  for (const t of g.league.teams){
    t.wins = 0;
    t.losses = 0;
    for (const p of (t.roster || [])){
      p.stats = { gp:0, pts:0, reb:0, ast:0 };
    }
  }

  g.schedule = generateWeeklySchedule(g.league.teams.map(t => t.id), SEASON_WEEKS);

  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
}

// -------------------- HISTORY + AWARDS --------------------
export function finalizeSeasonAndLogHistory({ championTeamId, userPlayoffFinish }){
  const g = STATE.game;
  g.history ??= [];

  const userTeam = g.league.teams[g.userTeamIndex];
  const championTeam = g.league.teams.find(t => t.id === championTeamId);

  const awards = computeAwards(g);

  g.history.push({
    year: g.year,
    userRecord: { wins: userTeam.wins, losses: userTeam.losses },
    userPlayoffFinish: userPlayoffFinish || null,
    championTeam: championTeam?.name || "—",
    awards
  });

  g.inbox.unshift({ t: Date.now(), msg: `Season ${g.year} awards saved to History.` });
}

function computeAwards(g){
  const all = [];
  for (const t of g.league.teams){
    for (const p of (t.roster || [])){
      const gp = p.stats?.gp || 0;
      if (gp <= 0) continue;

      const ptsPg = (p.stats.pts / gp);
      const rebPg = (p.stats.reb / gp);
      const astPg = (p.stats.ast / gp);

      all.push({ team: t, player: p, gp, ptsPg, rebPg, astPg });
    }
  }

  const played = all.filter(x => x.gp >= 8);

  const opoy = topBy(played, x => x.ptsPg * 1.0 + x.astPg * 0.45);

  const mvp = topBy(played, x => {
    const winsBoost = (x.team.wins || 0) * 0.10;
    const ovrBoost = (x.player.ovr || 70) * 0.25;
    return x.ptsPg * 1.15 + x.astPg * 0.65 + winsBoost + ovrBoost;
  });

  const dpoy = topBy(played, x => {
    const pos = x.player.pos || "";
    const bigBonus = (pos === "C" ? 14 : pos === "PF" ? 9 : pos === "SF" ? 3 : 0);
    const ovr = (x.player.ovr || 70);
    const teamDefProxy = (x.team.rating || 70) * 0.35;
    return bigBonus + ovr * 1.0 + teamDefProxy;
  });

  const rookies = played.filter(x => x.player.rookieYear === g.year);
  const roy = rookies.length
    ? topBy(rookies, x => x.ptsPg * 1.0 + x.astPg * 0.45 + (x.player.ovr || 70) * 0.2)
    : null;

  return {
    MVP: packAward(mvp),
    OPOY: packAward(opoy),
    DPOY: packAward(dpoy),
    ROY: roy ? packAward(roy) : null
  };
}

function packAward(x){
  if (!x) return null;
  return { player: x.player.name, team: x.team.name };
}

function topBy(arr, scoreFn){
  if (!arr.length) return null;
  let best = arr[0];
  let bestS = scoreFn(best);

  for (let i=1;i<arr.length;i++){
    const s = scoreFn(arr[i]);
    if (s > bestS){
      best = arr[i];
      bestS = s;
    }
  }
  return best;
}
