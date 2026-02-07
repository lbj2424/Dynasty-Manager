import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { generateTeamRoster, calculateSalary } from "./gen/players.js";
import {
  HOURS_BANK_MAX,
  HOURS_PER_WEEK,
  SEASON_WEEKS,
  PHASES,
  SALARY_CAP
} from "./data/constants.js";
import { clamp, id } from "./utils.js";

const KEY_ACTIVE = "dynasty_active_slot";
const KEY_SAVE_PREFIX = "dynasty_save_";

let STATE = null;

export function getState(){ return STATE; }

// -------------------- INITIALIZATION & MIGRATION --------------------

export function ensureAppState(loadedOrNull){
  if (loadedOrNull){
    STATE = loadedOrNull;
    
    // --- MIGRATION: Backfill Missing Data for Old Saves ---
    STATE.game.history ??= [];

    STATE.game.league?.teams?.forEach(t => {
      t.wins ??= 0;
      t.losses ??= 0;
      t.assets ??= { picks: generateFuturePicks(t.id, STATE.game.year) };
      t.cap ??= { cap: SALARY_CAP, payroll: 0 };

      let needsRotationFix = false;
      t.roster?.forEach(p => {
        p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
        p.happiness ??= 70;
        p.age ??= 24; // Default age if missing
        if (!p.rotation) {
            p.rotation = { minutes: 0, isStarter: false };
            needsRotationFix = true;
        }
      });

      if (needsRotationFix) autoDistributeMinutes(t);
      recalcPayroll(t);
    });
    return;
  }
  STATE = newGameState({ userTeamIndex: 0 });
}

export function newGameState({ userTeamIndex=0 } = {}){
  const year = 1;
  const league = generateLeague({ seed: "v1_seed" });

  for (const t of league.teams){
    t.wins ??= 0; t.losses ??= 0;
    t.assets = { picks: generateFuturePicks(t.id, year) };
    t.roster = generateTeamRoster({ teamName: t.name, teamRating: t.rating, year }) || [];
    t.cap ??= { cap: SALARY_CAP, payroll: 0 };
    t.cap.cap ??= SALARY_CAP;

    // 1. SETUP ROTATION (Validates positions too)
    autoDistributeMinutes(t);

    // 2. INITIAL PAYROLL
    recalcPayroll(t);

    // 3. FORCE CAP COMPLIANCE
    if (t.cap.payroll > t.cap.cap) {
        let attempts = 0;
        while (t.cap.payroll > t.cap.cap && attempts < 3) {
            const target = t.cap.cap * 0.99;
            const scale = target / t.cap.payroll;
            for (const p of t.roster) {
                let newSal = p.contract.salary * scale;
                if (newSal < 0.5) newSal = 0.5;
                p.contract.salary = Number(newSal.toFixed(2));
            }
            recalcPayroll(t);
            attempts++;
        }
    }
  }

  const schedule = generateWeeklySchedule(league.teams.map(t => t.id), SEASON_WEEKS, 4);

  return {
    meta: { version: "0.3.9", createdAt: Date.now() },
    activeSaveSlot: null,
    game: {
      year,
      phase: PHASES.REGULAR,
      week: 1,
      seasonWeeks: SEASON_WEEKS,
      schedule,
      hours: { available: HOURS_PER_WEEK, banked: 0, bankMax: HOURS_BANK_MAX },
      league,
      userTeamIndex,
      scouting: {
        tab: "NCAA",
        ncaa: generateNCAAProspects({ year, count: 100, seed: "ncaa" }),
        intlPool: generateInternationalPool({ year, count: 100, seed: "intl" }),
        scoutedNCAAIds: [], scoutedIntlIds: [], intlFoundWeekById: {}, intlLocation: null
      },
      playoffs: null,
      offseason: { freeAgents: null, draft: null, expiring: [] },
      inbox: [],
      history: []
    }
  };
}

// -------------------- REALISTIC SEASON END & PROGRESSION --------------------

function processEndSeasonRoster(g){
  const userTeamId = g.league.teams[g.userTeamIndex].id;
  g.offseason.expiring = []; 

  for(const t of g.league.teams){
    const nextRoster = [];
    
    for(const p of t.roster){
      // --- 1. REALISTIC GROWTH CALCULATION ---
      const age = p.age || 20;
      const minutes = p.rotation?.minutes || 0; // Minutes allocated this season
      
      let baseChange = 0;

      // A. Age Curve
      if (age <= 22) baseChange = 2;       // Young: naturally grow
      else if (age <= 25) baseChange = 1;  // Developing
      else if (age <= 29) baseChange = 0;  // Prime (plateau)
      else if (age <= 32) baseChange = -1; // Slow Decline
      else baseChange = -3;                // Cliff (Rapid Decline)

      // B. Potential Cap ("Soft Ceiling")
      // Players struggle to grow past their potential grade
      const caps = { "A+":99, "A":92, "B":84, "C":77, "D":70, "F":60 };
      const softCap = caps[p.potentialGrade] || 75;
      
      if (p.ovr >= softCap) {
          // If you've hit your ceiling, growth halts or regression starts earlier
          if (baseChange > 0) baseChange = 0; 
          else baseChange -= 1; // Decline faster if you are "playing above your level"
      }

      // C. Playtime / XP Factor (Crucial for Young Players)
      if (age < 26) {
          if (minutes >= 25) baseChange += 1; // Starter minutes = Bonus Growth
          else if (minutes < 10) baseChange -= 1; // Bench warmer = Stunted Development
      }

      // D. Variance & Breakouts (The "Story" Factor)
      const roll = Math.random();
      if (roll < 0.05) {
          // 5% Chance of BREAKOUT (Huge jump)
          baseChange += 3;
          if(t.id === userTeamId) {
              g.inbox.unshift({ t:Date.now(), msg:`BREAKOUT: ${p.name} had a massive offseason (+${baseChange + 1})!` });
          }
      } else if (roll < 0.10) {
          // 5% Chance of REGRESSION (Bust/Injury)
          baseChange -= 2;
      }

      // E. Apply Change
      // Add small noise (-1 to 1) so it's not robotic
      const noise = Math.floor(Math.random() * 3) - 1; 
      let totalChange = baseChange + noise;

      // Safety clamps
      const newOvr = clamp(p.ovr + totalChange, 40, 99);
      p.ovr = newOvr;
      
      // Update Age
      p.age = age + 1;

      // --- 2. CONTRACT LOGIC ---
      p.contract.years -= 1;

      if(p.contract.years > 0){
        nextRoster.push(p);
      } else {
        // Expiring
        if(t.id === userTeamId){
           g.inbox.unshift({ t:Date.now(), msg:`${p.name}'s contract expired. They entered Free Agency.` });
        }
        
        // Convert to Free Agent
        // Recalculate 'Fair Value' based on NEW age and NEW ovr
        const fairValue = calculateSalary(p.ovr, p.age);
        const greed = 0.9 + Math.random() * 0.3; 
        
        const faObj = {
            id: p.id,
            name: p.name,
            pos: p.pos,
            ovr: p.ovr,
            age: p.age,
            potentialGrade: p.potentialGrade,
            ask: Number((fairValue * greed).toFixed(2)),
            yearsAsk: Math.max(1, Math.min(4, Math.floor(Math.random() * 4) + 1)),
            wantsWinning: Math.random() > 0.5,
            wantsRole: Math.random() > 0.5,
            signedByTeamId: null,
            promisedRole: null,
            contract: null,
            offers: []
        };
        g.offseason.expiring.push(faObj);
      }
    }
    
    t.roster = nextRoster;
    
    // CPU Logic: Re-balance lineup after players leave/regress
    autoDistributeMinutes(t);
    recalcPayroll(t);
  }
}

// -------------------- HELPER FUNCTIONS --------------------

function autoDistributeMinutes(team){
    // 1. Reset everyone
    team.roster.forEach(p => { 
        p.rotation = { minutes: 0, isStarter: false }; 
    });

    let remain = 205; 
    const positions = ["PG","SG","SF","PF","C"];
    const starters = [];

    // 2. Pick STARTERS (Best OVR per position)
    for (const pos of positions) {
        // Find best available player for this position
        const candidates = team.roster
            .filter(p => p.pos === pos && !p.rotation.isStarter)
            .sort((a,b) => b.ovr - a.ovr);
        
        if (candidates.length > 0) {
            const starter = candidates[0];
            starter.rotation.isStarter = true;
            starter.rotation.minutes = 34; // Heavy starter minutes
            remain -= 34;
            starters.push(starter);
        }
    }

    // 3. Fill BENCH with whoever is left (Best OVR regardless of position)
    const bench = team.roster
        .filter(p => !p.rotation.isStarter)
        .sort((a,b) => b.ovr - a.ovr);

    // Give minutes to top 5 bench players
    for (let i = 0; i < Math.min(5, bench.length); i++) {
        const p = bench[i];
        const mins = 10; // Solid bench minutes
        p.rotation.minutes = mins;
        remain -= mins;
    }

    // 4. Dump remaining minutes (if any) onto the best player/starters
    if (remain > 0 && starters.length > 0) {
        starters[0].rotation.minutes += remain;
    }
}

function generateFuturePicks(teamId, startYear){
  const picks = [];
  for (let y = startYear; y < startYear + 4; y++){
    picks.push({ id: `pick_${teamId}_${y}_1`, originalOwnerId: teamId, year: y, round: 1 });
    picks.push({ id: `pick_${teamId}_${y}_2`, originalOwnerId: teamId, year: y, round: 2 });
  }
  return picks;
}

function recalcPayroll(team){
    team.cap.payroll = Number(team.roster.reduce((sum,p)=> sum + (p.contract?.salary || 0), 0).toFixed(1));
}

export function executeTrade(userTeamId, otherTeamId, userAssets, otherAssets){
    const g = STATE.game;
    const userTeam = g.league.teams.find(t => t.id === userTeamId);
    const otherTeam = g.league.teams.find(t => t.id === otherTeamId);

    if (!userTeam || !otherTeam) return false;

    for (const p of userAssets.players) {
        userTeam.roster = userTeam.roster.filter(x => x.id !== p.id);
        otherTeam.roster.push(p);
    }
    for (const pk of userAssets.picks) {
        userTeam.assets.picks = userTeam.assets.picks.filter(x => x.id !== pk.id);
        otherTeam.assets.picks.push(pk);
    }
    for (const p of otherAssets.players) {
        otherTeam.roster = otherTeam.roster.filter(x => x.id !== p.id);
        userTeam.roster.push(p);
    }
    for (const pk of otherAssets.picks) {
        otherTeam.assets.picks = otherTeam.assets.picks.filter(x => x.id !== pk.id);
        userTeam.assets.picks.push(pk);
    }

    recalcPayroll(userTeam);
    recalcPayroll(otherTeam);
    autoDistributeMinutes(userTeam);
    autoDistributeMinutes(otherTeam);

    return true;
}

export function releasePlayer(teamId, playerId){
    const g = STATE.game;
    const team = g.league.teams.find(t => t.id === teamId);
    if (!team) return;
    const idx = team.roster.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    team.roster.splice(idx, 1);
    recalcPayroll(team);
}

// -------------------- SAVES & TIME --------------------

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
  simWeekGames(g);
  g.week += 1;
  g.hours.banked = clamp(g.hours.banked + g.hours.available, 0, g.hours.bankMax);
  g.hours.available = HOURS_PER_WEEK;
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
      g.scouting.scoutedIntlIds = g.scouting.scoutedIntlIds.filter(x => x !== p.id);
      delete found[p.id];
      continue;
    }
    keep.push(p);
  }
  g.scouting.intlPool = keep;
  g.scouting.intlFoundWeekById = found;
}

// -------------------- SIMULATION --------------------

function generateWeeklySchedule(teamIds, weeks){
  const schedule = [];
  for (let w=1; w<=weeks; w++){
    const games = [];
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

  const userTeamId = g.league.teams[g.userTeamIndex].id;

  for (const [aId, bId] of bundle.games){
    const A = g.league.teams.find(t => t.id === aId);
    const B = g.league.teams.find(t => t.id === bId);
    if (!A || !B) continue;

    let ptsA = simTeamStats(A);
    let ptsB = simTeamStats(B);

    while (ptsA === ptsB) {
        ptsA += Math.floor(Math.random() * 6);
        ptsB += Math.floor(Math.random() * 6);
    }

    const aWin = ptsA > ptsB;

    if (aWin){ A.wins += 1; B.losses += 1; }
    else { B.wins += 1; A.losses += 1; }

    bumpHappiness(A, aWin ? +1 : -1);
    bumpHappiness(B, aWin ? -1 : +1);

    if (A.id === userTeamId || B.id === userTeamId) {
        const userWon = (A.id === userTeamId && aWin) || (B.id === userTeamId && !aWin);
        const opponent = A.id === userTeamId ? B : A;
        const scoreStr = `${Math.max(ptsA, ptsB)}-${Math.min(ptsA, ptsB)}`;
        
        g.inbox.unshift({ 
            t: Date.now(), 
            msg: `Week ${g.week}: ${userWon ? "WON" : "LOST"} vs ${opponent.name} (${scoreStr})` 
        });
    }
  }
}

function simTeamStats(team){
  const roster = team.roster || [];
  let totalTeamPoints = 0;

  for (const p of roster){
    p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
    p.rotation ??= { minutes: 0, isStarter: false };

    const mins = p.rotation.minutes;
    if (mins <= 0) continue;

    const usage = mins / 28.0; 
    const gameVar = 0.8 + Math.random() * 0.4;

    const ptsBase = Math.max(0, (p.ovr - 50));
    const pts = clamp(ptsBase * 0.6 * usage * gameVar, 0, 60);
    const rebBase = (p.pos==="C"||p.pos==="PF") ? 0.35 : 0.12; 
    const reb = clamp(ptsBase * rebBase * usage * gameVar * 1.5, 0, 25);
    const astBase = p.pos==="PG" ? 0.4 : p.pos==="SG" ? 0.2 : 0.1;
    const ast = clamp(ptsBase * astBase * usage * gameVar * 1.5, 0, 20);

    p.stats.gp += 1;
    p.stats.pts += pts;
    p.stats.reb += reb;
    p.stats.ast += ast;
    
    totalTeamPoints += pts;
  }
  return Math.round(totalTeamPoints);
}

function bumpHappiness(team, delta){
  for (const p of (team.roster || [])){
    p.happiness = clamp((p.happiness ?? 70) + delta, 0, 100);
  }
}

// -------------------- PLAYOFFS & SEASON END --------------------

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
    rounds: []
  };
  
  generateNextRoundMatchups(g);
  g.inbox.unshift({ t: Date.now(), msg: "Playoffs started (Top 8 East/West)." });
}

export function simPlayoffRound(){
  const g = STATE.game;
  if (g.phase !== PHASES.PLAYOFFS) return;
  const p = g.playoffs;
  const currentRoundIndex = p.round - 1;
  if (!p.rounds[currentRoundIndex]) return;

  const rObj = p.rounds[currentRoundIndex];
  const allSeries = [...(rObj.east || []), ...(rObj.west || []), ...(rObj.finals || [])];
  let roundOver = true;

  for (const s of allSeries){
    if (s.done) continue;
    while (s.aWins < 4 && s.bWins < 4){
        if (Math.random() > 0.5) s.aWins++; else s.bWins++;
    }
    s.done = true;
    s.winner = (s.aWins === 4) ? s.a : s.b;
  }

  if (roundOver) {
      if (p.round === 4) {
          p.championTeamId = allSeries[0].winner;
          finalizeSeasonAndLogHistory({ championTeamId: p.championTeamId, userPlayoffFinish: "Playoffs" });
          startFreeAgency();
      } else {
          p.round++;
          generateNextRoundMatchups(g);
      }
  }
}

function generateNextRoundMatchups(g){
    const p = g.playoffs;
    const rNum = p.round;
    const makeSeries = (idA, idB) => ({ a: idA, b: idB, aWins:0, bWins:0, done:false, winner:null });

    if (rNum === 1) {
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
        for (const conf of ['east', 'west']) {
            const winners = prev[conf].map(s => s.winner);
            for (let i = 0; i < winners.length; i += 2) {
                nextRound[conf].push(makeSeries(winners[i], winners[i+1]));
            }
        }
        p.rounds.push(nextRound);
    } 
    else if (rNum === 4) {
        const prev = p.rounds[2];
        const eastChamp = prev.east[0].winner;
        const westChamp = prev.west[0].winner;
        p.rounds.push({ name: "Finals", finals: [makeSeries(eastChamp, westChamp)] });
    }
}

function getConferenceStandings(g, conf){
  return (g.league.teams || [])
    .filter(t => t.conference === conf)
    .slice()
    .sort((a,b) => (b.wins - a.wins) || (a.losses - b.losses) || (b.rating - a.rating));
}

// -------------------- FREE AGENCY & DRAFT --------------------

export function startFreeAgency(){
  const g = STATE.game;
  g.phase = PHASES.FREE_AGENCY;
  
  // 1. Generate random fresh free agents
  const freshPool = generateFreeAgents({ year: g.year, count: 80, seed: "fa" });
  
  // 2. Retrieve the expiring players we saved during season processing
  const expiringPool = g.offseason.expiring || [];
  
  // 3. Combine them
  const combinedPool = [...expiringPool, ...freshPool];
  
  // Sort by OVR
  combinedPool.sort((a,b) => b.ovr - a.ovr);

  g.offseason.freeAgents = {
    cap: SALARY_CAP,
    pool: combinedPool
  };
  g.inbox.unshift({ t: Date.now(), msg: `Free Agency started. ${expiringPool.length} players joined from expired contracts.` });
}

export function startDraft(){
  const g = STATE.game;
  g.phase = PHASES.DRAFT;

  const naturalOrderTeams = [...g.league.teams].sort((a,b) => (a.wins - b.wins) || (b.losses - a.losses));
  
  const finalOrderIds = [];
  const rounds = 2; 
  
  for (let r = 1; r <= rounds; r++) {
    for (const originalTeam of naturalOrderTeams) {
        const owner = findPickOwner(g, originalTeam.id, g.year, r);
        finalOrderIds.push(owner ? owner.id : originalTeam.id);
    }
  }

  const declared = [
    ...g.scouting.ncaa.filter(p => p.declared),
    ...g.scouting.intlPool.filter(p => p.declared)
  ];
  declared.sort((a,b) => (b.currentOVR - a.currentOVR) + (Math.random() - 0.5));

  g.offseason.draft = {
    round: 1,
    pickIndex: 0,
    orderTeamIds: finalOrderIds,
    declaredProspects: declared,
    drafted: [],
    done: false
  };

  g.inbox.unshift({ t: Date.now(), msg: "Draft started (2 rounds)." });
}

function findPickOwner(g, originalOwnerId, year, round){
    for (const t of g.league.teams) {
        if (!t.assets || !t.assets.picks) continue;
        const found = t.assets.picks.find(p => 
            p.originalOwnerId === originalOwnerId && 
            p.year === year && 
            p.round === round
        );
        if (found) return t;
    }
    return g.league.teams.find(t => t.id === originalOwnerId);
}

// -------------------- NEXT YEAR & HISTORY --------------------

export function advanceToNextYear(){
  const g = STATE.game;
  g.year += 1;
  g.week = 1;
  g.phase = PHASES.REGULAR;
  g.hours.available = HOURS_PER_WEEK;
  g.hours.banked = 0;
  
  g.scouting.ncaa = generateNCAAProspects({ year: g.year, count: 100, seed: "ncaa" });
  g.scouting.intlPool = generateInternationalPool({ year: g.year, count: 100, seed: "intl" });
  g.scouting.scoutedNCAAIds = [];
  g.scouting.scoutedIntlIds = [];
  g.scouting.intlFoundWeekById = {};
  g.scouting.intlLocation = null;

  for (const t of g.league.teams){
    if (!t.assets) t.assets = { picks: [] };
    const newYear = g.year + 3;
    t.assets.picks.push({ id: `pick_${t.id}_${newYear}_1`, originalOwnerId: t.id, year: newYear, round: 1 });
    t.assets.picks.push({ id: `pick_${t.id}_${newYear}_2`, originalOwnerId: t.id, year: newYear, round: 2 });
  }

  for (const t of g.league.teams){
    t.wins = 0; t.losses = 0;
    for (const p of (t.roster || [])){
      p.stats = { gp:0, pts:0, reb:0, ast:0 };
    }
  }

  g.schedule = generateWeeklySchedule(g.league.teams.map(t => t.id), SEASON_WEEKS);
  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;
  g.offseason.expiring = []; 

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
}

export function finalizeSeasonAndLogHistory({ championTeamId, userPlayoffFinish }){
  const g = STATE.game;
  
  // --- PROCESS ROSTER UPDATES (Age up, Contracts down, Collect Expiring) ---
  processEndSeasonRoster(g);
  // -------------------------------------------------------------------------

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
