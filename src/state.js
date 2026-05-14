import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { generateTeamRoster, calculateSalary, calculateExtensionSalary, capPlayerSalary } from "./gen/players.js";
import {
  HOURS_BANK_MAX,
  HOURS_PER_WEEK,
  SEASON_WEEKS,
  TRADE_DEADLINE_WEEK,
  PHASES,
  SALARY_CAP,
  ROSTER_MAX
} from "./data/constants.js";
import { clamp, id, rng, seedFromString } from "./utils.js";

const KEY_ACTIVE = "dynasty_active_slot";
const KEY_SAVE_PREFIX = "dynasty_save_";
export const SOFT_CAP_LIMIT = SALARY_CAP + 20;
export const ROSTER_MIN_AFTER_CUTS = 8;

let STATE = null;

export function getState(){ return STATE; }

// -------------------- INITIALIZATION & MIGRATION --------------------

export function ensureAppState(loadedOrNull){
  if (loadedOrNull){
    STATE = loadedOrNull;
    STATE.game.history ??= [];
    STATE.game.retiredPlayers ??= [];
    STATE.game.inbox ??= [];
    if (STATE.game.inbox.length > 50) STATE.game.inbox.length = 50; 

    if (STATE.game.scouting && STATE.game.scouting.intlPool) {
        const MAP = {
            "France": "EU", "Spain": "EU", "Serbia": "EU", "Slovenia": "EU", "Germany": "EU",
            "Lithuania": "EU", "Turkey": "EU", "Greece": "EU", "Italy": "EU",
            "Canada": "NA", "Brazil": "SA", "Argentina": "SA", "Nigeria": "AF", "China": "AS", "Japan": "AS", "Australia": "OC"
        };
        for (const p of STATE.game.scouting.intlPool) {
            if (!p.continentKey && p.continentName) p.continentKey = MAP[p.continentName] || "EU";
            if (p.declared && !p.visibility) {
                p.visibility = "private";
                p.commitOwner = "user";
                p.commitYear = STATE.game.year;
            }
        }
    }

    // Migrate existing playoff series to include games array
    for (const round of (STATE.game.playoffs?.rounds || [])) {
      for (const s of [...(round.east||[]), ...(round.west||[]), ...(round.finals||[])]) {
        s.games ??= [];
      }
    }

    STATE.game.tradeDemandChecked ??= false;
    STATE.game.midseasonFaPool ??= [];
    if (STATE.game.phase === PHASES.REGULAR && STATE.game.offseason?.freeAgents?.pool?.length) {
      const existingIds = new Set(STATE.game.midseasonFaPool.map(p => p.id));
      for (const p of STATE.game.offseason.freeAgents.pool) {
        if (!p.signedByTeamId && !existingIds.has(p.id)) {
          STATE.game.midseasonFaPool.push({ ...p, offers: [] });
          existingIds.add(p.id);
        }
      }
      STATE.game.midseasonFaPool.sort((a,b) => b.ovr - a.ovr);
    }
    STATE.game.lastSeasonRecap ??= null;
    STATE.game.pendingTradeOffers ??= [];
    STATE.game.lastUserOfferWeek ??= 0;
    STATE.game.gmReview ??= null;
    STATE.game.gmJobMarket ??= [];
    migrateFreeAgentSalaryScale(STATE.game);

    STATE.game.league?.teams?.forEach(t => {
      t.wins ??= 0; t.losses ??= 0;
      t.assets ??= { picks: generateFuturePicks(t.id, STATE.game.year) };
      t.cap ??= { cap: SALARY_CAP, payroll: 0 };
      if (!t.cap.cap || t.cap.cap < SALARY_CAP) t.cap.cap = SALARY_CAP;
      t.momentum ??= 0;

      let needsRotationFix = false;
      t.roster?.forEach(p => {
        p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
        p.careerStats ??= []; 
        p.awards ??= []; // FIX: Initialize awards array
        p.happiness ??= 70;
        p.age ??= 24; 
        p.dev ??= { focus: "Balanced", points: 0 };
        p.dev.focus ??= "Balanced";
        if (p.contract?.salary) {
          p.contract.salary = capPlayerSalary(p.contract.salary, p.ovr, p.awards);
        }
        
        if (p.off === undefined) p.off = p.ovr;
        if (p.def === undefined) p.def = p.ovr;

        if (!p.rotation) {
            p.rotation = { minutes: 0, isStarter: false };
            needsRotationFix = true;
        }
      });

      if (needsRotationFix) autoDistributeMinutes(t);
      updateTeamRating(t);
      recalcPayroll(t);
    });

    // Phase 3: assign owner archetypes to any team that doesn't have one yet
    assignOwners(STATE.game.league?.teams);

    // GM backfill must run AFTER team ratings are recomputed so deriveExpectation uses fresh data
    if (!STATE.game.gm) {
        STATE.game.gm = backfillGmFromHistory(STATE.game);
    } else {
        // Patch Phase-2/3 fields onto a Phase-1 GM
        const gm = STATE.game.gm;
        gm.career ??= {};
        gm.career.tradesExecuted ??= 0;
        if (!("activeMandate" in gm)) gm.activeMandate = null;
        gm.mandateCooldownUntilYear ??= 0;
        if (!gm.career.teamsHistory || !gm.career.teamsHistory.length) {
            const userTeam = STATE.game.league.teams[STATE.game.userTeamIndex];
            gm.career.teamsHistory = userTeam ? [{
                teamId: userTeam.id,
                teamName: userTeam.name,
                startYear: STATE.game.year - (gm.career.yearsAsGM || 0),
                startingRating: userTeam.rating || 70,
                titlesWithTeam: gm.career.titles || 0,
                playoffsWithTeam: gm.career.playoffAppearances || 0,
                yearsWithTeam: gm.career.yearsAsGM || 0
            }] : [];
        }
    }
    normalizeCurrentOwnerGoal(STATE.game);
    return;
  }
  STATE = newGameState({ userTeamIndex: 0 });
}

export function newGameState({ userTeamIndex=0 } = {}){
  const year = 2020; 
  const league = generateLeague({ seed: "v1_seed" });

  for (const t of league.teams){
    t.wins ??= 0; t.losses ??= 0;
    t.assets = { picks: generateFuturePicks(t.id, year) };
    t.roster = generateTeamRoster({ teamName: t.name, teamRating: t.rating, year }) || [];
    t.cap ??= { cap: SALARY_CAP, payroll: 0 };
    if (!t.cap.cap || t.cap.cap < SALARY_CAP) t.cap.cap = SALARY_CAP;

    // Ensure initial gen has awards array
    t.roster.forEach(p => p.awards = []);

    autoDistributeMinutes(t);
    recalcPayroll(t);
    updateTeamRating(t);

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

  const schedule = generateWeeklySchedule(league.teams, SEASON_WEEKS);

  // Phase 3: assign owner archetypes to every team
  assignOwners(league.teams);

  return {
    meta: { version: "0.9.0", createdAt: Date.now() },
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
        intlPool: generateInternationalPool({ year, count: 125, seed: "intl" }),
        scoutedNCAAIds: [], scoutedIntlIds: [], intlFoundWeekById: {}, intlLocation: null
      },
      playoffs: null,
      offseason: { freeAgents: null, draft: null, expiring: [] },
      inbox: [],
      history: [],
      retiredPlayers: [],
      pendingTradeOffers: [],
      lastUserOfferWeek: 0,
      gm: buildInitialGm(league.teams[userTeamIndex], year),
      gmReview: null,
      gmJobMarket: []
    }
  };
}

function migrateFreeAgentSalaryScale(g) {
  const pools = [
    g.midseasonFaPool,
    g.offseason?.freeAgents?.pool,
    g.offseason?.expiring
  ];
  for (const pool of pools) {
    for (const p of (pool || [])) {
      if (p.ask) p.ask = capPlayerSalary(p.ask, p.ovr, p.awards);
      if (p.contract?.salary) p.contract.salary = capPlayerSalary(p.contract.salary, p.ovr, p.awards);
      for (const offer of (p.offers || [])) {
        offer.salary = capPlayerSalary(offer.salary, p.ovr, p.awards);
      }
    }
  }
}

// -------------------- SAVE UTILS --------------------

function autoSave() {
    const slot = getActiveSaveSlot() || "A";
    saveToSlot(slot);
}

// -------------------- ALL-STAR LOGIC --------------------

export function calculateAllStars(g) {
    const allPlayers = [];
    for (const t of g.league.teams) {
        for (const p of (t.roster || [])) {
            const gp = p.stats?.gp || 0;
            if (gp < 5) continue; // Minimum games
            const ptsPg = p.stats.pts / gp;
            const rebPg = p.stats.reb / gp;
            const astPg = p.stats.ast / gp;
            
            // Score = Stats + Team Wins Bonus + OVR proxy
            const score = (ptsPg * 1.0) + (astPg * 0.6) + (rebPg * 0.5) + (t.wins * 0.5) + (p.ovr * 0.2);
            allPlayers.push({ player: p, score, conf: t.conference, teamName: t.name });
        }
    }

    const selectForConf = (conf) => {
        const confPlayers = allPlayers.filter(x => x.conf === conf).sort((a, b) => b.score - a.score);
        const selected = [];
        const snubs = [];
        const posCounts = { PG:0, SG:0, SF:0, PF:0, C:0 };

        // Need exactly 3 per position (3 x 5 = 15 roster spots)
        for (const cand of confPlayers) {
            const pos = cand.player.pos;
            if (posCounts[pos] < 3) {
                selected.push({ ...cand.player, teamName: cand.teamName });
                posCounts[pos]++;

                // Add Award to player model
                cand.player.awards ??= [];
                const awardStr = `${g.year} All-Star`;
                if (!cand.player.awards.includes(awardStr)) {
                    cand.player.awards.push(awardStr);
                }
            } else if (posCounts[pos] === 3 && snubs.filter(s => s.pos === pos).length === 0) {
                // Track the first snub at each position (the player who just missed)
                snubs.push({ ...cand.player, teamName: cand.teamName });
            }
            if (selected.length === 15 && snubs.length >= 5) break;
        }
        return { players: selected, snubs };
    };

    const eastResult = selectForConf("EAST");
    const westResult = selectForConf("WEST");
    return {
        east: eastResult.players,
        west: westResult.players,
        eastSnubs: eastResult.snubs,
        westSnubs: westResult.snubs
    };
}


// -------------------- FREE AGENCY LOGIC (SMART CPU) --------------------

export function startFreeAgency(){
  const g = STATE.game;
  g.phase = PHASES.FREE_AGENCY;
  
  const freshPool = generateFreeAgents({ year: g.year, count: 80, seed: "fa" });
  const expiringPool = g.offseason.expiring || [];
  const combinedPool = [...expiringPool, ...freshPool];
  combinedPool.sort((a,b) => b.ovr - a.ovr);

  g.offseason.freeAgents = {
    cap: SALARY_CAP,
    pool: combinedPool,
    round: 1,
    signings: [],
    resultsReady: false
  };

  generateInitialOffers(g);
  runFaCounterOffers(g);

  g.inbox.unshift({ t: Date.now(), msg: `Free Agency started. ${expiringPool.length} players joined from expired contracts.` });
  autoSave();
}

export function advanceFaRound(){
  const g = STATE.game;
  const fa = g.offseason.freeAgents;
  if (!fa || fa.round >= 3) return;
  fa.round += 1;
  runFaCounterOffers(g);
  autoSave();
}

const POSITIONS = ["PG","SG","SF","PF","C"];

export function analyzeTeamNeeds(team, g = STATE.game) {
    const roster = team?.roster || [];
    const mode = getTeamMode(team, g);
    const counts = Object.fromEntries(POSITIONS.map(pos => [pos, 0]));
    const bestAtPos = Object.fromEntries(POSITIONS.map(pos => [pos, 0]));
    const playableAtPos = Object.fromEntries(POSITIONS.map(pos => [pos, 0]));
    let avgAge = 0;
    let scoring = 0;
    let defense = 0;

    for (const p of roster) {
        counts[p.pos] = (counts[p.pos] || 0) + 1;
        if ((p.ovr || 0) >= 68) playableAtPos[p.pos] = (playableAtPos[p.pos] || 0) + 1;
        if ((p.ovr || 0) > (bestAtPos[p.pos] || 0)) bestAtPos[p.pos] = p.ovr || 0;
        avgAge += p.age || 24;
        scoring += p.off ?? p.ovr ?? 0;
        defense += p.def ?? p.ovr ?? 0;
    }

    avgAge = roster.length ? avgAge / roster.length : 24;
    const top8 = [...roster].sort((a, b) => (b.ovr || 0) - (a.ovr || 0)).slice(0, 8);
    const starPower = top8[0]?.ovr || 0;
    const capSpace = (team?.cap?.cap ?? SALARY_CAP) - (team?.cap?.payroll || 0);
    const capStatus = capSpace >= 20 ? "flexible" : capSpace >= 8 ? "limited" : capSpace >= 0 ? "tight" : "over_cap";

    const needs = POSITIONS.filter(pos => playableAtPos[pos] < 2 || bestAtPos[pos] < 72);
    const surplus = POSITIONS.filter(pos => counts[pos] >= 4 || (counts[pos] >= 3 && bestAtPos[pos] >= 76));
    const weaknesses = [];
    if (starPower < 80) weaknesses.push("star_power");
    if (roster.length < 12) weaknesses.push("depth");
    if (scoring / Math.max(1, roster.length) < 70) weaknesses.push("scoring");
    if (defense / Math.max(1, roster.length) < 70) weaknesses.push("defense");
    if (avgAge > 30) weaknesses.push("age");
    if (capStatus === "tight" || capStatus === "over_cap") weaknesses.push("cap");

    const corePlayerIds = top8
        .filter(p => p.ovr >= 84 || (p.ovr >= 78 && p.age <= 25) || (mode === "win_now" && p.ovr >= 80))
        .map(p => p.id);

    const tradeBlockIds = roster
        .filter(p => !corePlayerIds.includes(p.id))
        .filter(p =>
            surplus.includes(p.pos) ||
            (mode === "rebuilding" && p.age >= 29 && p.ovr >= 72) ||
            ((p.happiness ?? 70) < 40 || p.tradeDemand) ||
            ((p.contract?.salary || 0) > calculateSalary(p.ovr || 60, p.age || 24) * 1.35)
        )
        .map(p => p.id);

    const targetTypes = mode === "rebuilding"
        ? ["young_players", "first_round_picks", "cap_space"]
        : mode === "win_now"
        ? ["veterans", "star_power", "position_need"]
        : ["prime_players", "position_need", "cap_value"];

    return { mode, counts, playableAtPos, bestAtPos, needs, surplus, weaknesses, capSpace, capStatus, avgAge, corePlayerIds, tradeBlockIds, targetTypes };
}

function buildTeamNeeds(cpuTeams, g = STATE.game) {
    const teamNeeds = {};
    for (const t of cpuTeams) teamNeeds[t.id] = analyzeTeamNeeds(t, g);
    return teamNeeds;
}

export function scoreFreeAgentFit(player, team, g = STATE.game, analysis = null) {
    if (!player || !team) return 0;
    const a = analysis || analyzeTeamNeeds(team, g);
    const age = player.age || 24;
    let score = player.ovr || 0;

    if (a.needs.includes(player.pos)) score += 18;
    else if ((a.playableAtPos[player.pos] || 0) < 2) score += 10;
    else if ((a.counts[player.pos] || 0) >= 4 && player.ovr < (a.bestAtPos[player.pos] || 0) + 4) score -= 35;
    else if ((a.counts[player.pos] || 0) >= 3) score -= 15;

    if (player.ovr > (a.bestAtPos[player.pos] || 0) + 5) score += 14;
    if (a.weaknesses.includes("star_power") && player.ovr >= 82) score += 20;
    if (a.weaknesses.includes("depth") && player.ovr >= 68 && player.ovr <= 76) score += 10;
    if (a.weaknesses.includes("scoring") && (player.off ?? player.ovr) >= (player.def ?? player.ovr) + 4) score += 8;
    if (a.weaknesses.includes("defense") && (player.def ?? player.ovr) >= (player.off ?? player.ovr) + 4) score += 8;

    if (a.mode === "rebuilding") {
        if (age <= 24) score += 16;
        else if (age >= 30) score -= 28;
        if ((player.ask || 0) > 12 && player.ovr < 82) score -= 16;
    } else if (a.mode === "win_now") {
        if (player.ovr >= 76 && age >= 27 && age <= 34) score += 14;
        if (age <= 22 && player.ovr < 74) score -= 12;
    } else {
        if (age >= 24 && age <= 29) score += 8;
        if (age >= 33) score -= 10;
    }

    const ask = player.ask || player.contract?.salary || 0;
    const fair = Math.max(1, calculateSalary(player.ovr || 60, age));
    const priceRatio = ask / fair;
    if (priceRatio <= 0.75) score += 12;
    else if (priceRatio >= 1.35) score -= 18;
    if (a.capStatus === "tight" && ask > 8) score -= 22;
    if (a.capStatus === "over_cap" && ask > 3) score -= 40;

    return Math.round(score);
}

export function scoreFreeAgentOffer(player, offer, team, g = STATE.game) {
    if (!player || !offer || !team) return 0;
    const moneyScore = (offer.salary || 0) * (1 + 0.10 * (offer.years || 1));
    const fit = scoreFreeAgentFit(player, team, g);
    const age = player.age || 24;
    const mode = getTeamMode(team, g);
    let score = moneyScore * 10 + fit;

    if (mode === "win_now" && age >= 29 && team.rating >= 78) score += 22;
    if (mode === "rebuilding" && age <= 24) score += 16;
    if (player.formerTeamId === team.id && (player.happiness ?? 70) >= 75) score += 12;

    return score;
}

function generateOffersForPlayer(g, p, cpuTeams, teamNeeds) {
    p.offers = [];

    // Once a player reaches free agency, every team has to fit under the normal cap.
    // Former teams keep a relationship edge, but Bird-rights-style flexibility is extension-only.
    if (p.formerTeamId) {
        const formerTeam = cpuTeams.find(t => t.id === p.formerTeamId);
        if (formerTeam && formerTeam.roster.length < 15) {
            const capSpace = formerTeam.cap.cap - formerTeam.cap.payroll;
            const formerAnalysis = teamNeeds[formerTeam.id] || analyzeTeamNeeds(formerTeam, g);
            let wantsToKeep = scoreFreeAgentFit(p, formerTeam, g, formerAnalysis) >= 72 || p.ovr >= 78;
            if (wantsToKeep) {
                const betterAtPos = formerTeam.roster
                    .filter(r => r.pos === p.pos && r.ovr >= p.ovr + 6 && r.contract?.years >= 1)
                    .sort((a, b) => b.ovr - a.ovr)[0];
                if (betterAtPos) {
                    if (betterAtPos.contract.years >= 3) {
                        wantsToKeep = false;
                    } else {
                        const futureAsk = calculateSalary(betterAtPos.ovr, betterAtPos.age + betterAtPos.contract.years);
                        if ((capSpace - p.ask) < futureAsk * 0.80) wantsToKeep = false;
                    }
                }
            }
            if (wantsToKeep && capSpace >= p.ask) {
                const offerSal = capPlayerSalary(p.ask * (1.05 + Math.random() * 0.05), p.ovr, p.awards);
                p.offers.push({
                    teamId: formerTeam.id, teamName: formerTeam.name,
                    salary: Math.min(offerSal, Number(capSpace.toFixed(2))),
                    years: p.yearsAsk
                });
            }
        }
    }

    let demandChance = 0;
    if (p.ovr >= 88) demandChance = 1.00;
    else if (p.ovr >= 85) demandChance = 0.95;
    else if (p.ovr >= 80) demandChance = 0.70;
    else if (p.ovr >= 75) demandChance = 0.40;
    else if (p.ovr >= 70) demandChance = 0.25; // bench/rotation pieces still get looks
    else if (p.ovr >= 65) demandChance = 0.15; // deep-bench depth deserves some interest
    else demandChance = 0.05;

    if (Math.random() > demandChance) return;

    const numOffers = Math.floor(Math.random() * 3) + 1;
    const candidates = cpuTeams
        .map(t => ({ team: t, analysis: teamNeeds[t.id], fit: scoreFreeAgentFit(p, t, g, teamNeeds[t.id]) }))
        .filter(x => x.team.roster.length < 15)
        .filter(x => x.fit >= 55)
        .sort((a, b) => b.fit - a.fit + (Math.random() - 0.5) * 8);

    for (const { team: t, analysis: needs, fit } of candidates) {
        if (p.offers.length >= numOffers) break;
        const posCount = needs.counts[p.pos] || 0;
        const currentStarterOvr = needs.bestAtPos[p.pos] || 0;
        if (posCount >= 4) continue;
        if (posCount >= 2 && p.ovr < currentStarterOvr && fit < 85) continue;

        let interestBoost = 1.0;
        if (needs.needs.includes(p.pos)) interestBoost = 1.5;
        if (p.ovr > 80 && p.ovr > currentStarterOvr + 3) interestBoost = 2.0;
        if (fit >= 100) interestBoost += 0.25;

        const capSpace = t.cap.cap - t.cap.payroll;
        let salaryMult;
        if (interestBoost >= 2.0) salaryMult = 1.15 + Math.random() * 0.10;
        else if (interestBoost >= 1.5) salaryMult = 1.05 + Math.random() * 0.10;
        else salaryMult = 0.90 + Math.random() * 0.20;
        const offerAmount = capPlayerSalary(p.ask * salaryMult, p.ovr, p.awards);

        if (capSpace > offerAmount && t.roster.length < 15) {
            p.offers.push({ teamId: t.id, teamName: t.name, salary: offerAmount, years: p.yearsAsk });
        }
    }

    ensureStarOutsideOffer(g, p, cpuTeams, teamNeeds);
}

function ensureStarOutsideOffer(g, p, cpuTeams, teamNeeds) {
    if ((p.ovr || 0) < 88) return;
    const hasOutsideOffer = (p.offers || []).some(o => o.teamId !== p.formerTeamId);
    if (hasOutsideOffer) return;

    const candidates = cpuTeams
        .filter(t => t.id !== p.formerTeamId)
        .filter(t => t.roster.length < 15)
        .map(t => ({ team: t, analysis: teamNeeds[t.id], fit: scoreFreeAgentFit(p, t, g, teamNeeds[t.id]) }))
        .filter(x => x.fit >= 62)
        .filter(x => (x.team.cap.cap - x.team.cap.payroll) >= p.ask)
        .sort((a,b) => b.fit - a.fit + (Math.random() - 0.5) * 6);

    const best = candidates[0];
    if (!best) return;

    const capSpace = best.team.cap.cap - best.team.cap.payroll;
    const offerAmount = Math.min(capSpace, capPlayerSalary(p.ask * (1.10 + Math.random() * 0.15), p.ovr, p.awards));
    p.offers.push({
        teamId: best.team.id,
        teamName: best.team.name,
        salary: Number(offerAmount.toFixed(2)),
        years: p.yearsAsk
    });
}

function generateInitialOffers(g){
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
    const teamNeeds = buildTeamNeeds(cpuTeams);

    for (const p of fa.pool) {
        generateOffersForPlayer(g, p, cpuTeams, teamNeeds);
    }
}

// Simulate a second bidding round: teams that are outbid by a small margin may counter-offer
function runFaCounterOffers(g) {
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    for (const p of fa.pool) {
        if (!p.offers || p.offers.length < 2) continue;

        p.offers.sort((a, b) => {
            const teamA = cpuTeams.find(t => t.id === a.teamId);
            const teamB = cpuTeams.find(t => t.id === b.teamId);
            return scoreFreeAgentOffer(p, b, teamB, g) - scoreFreeAgentOffer(p, a, teamA, g);
        });
        const bestScore = scoreFreeAgentOffer(p, p.offers[0], cpuTeams.find(t => t.id === p.offers[0].teamId), g);

        for (let i = 1; i < p.offers.length; i++) {
            const offer = p.offers[i];
            const score = scoreFreeAgentOffer(p, offer, cpuTeams.find(t => t.id === offer.teamId), g);
            const gap = (bestScore - score) / bestScore;

            // If within 20% of the best offer, 50% chance to bump up and compete
            if (gap <= 0.20 && Math.random() < 0.50) {
                const team = cpuTeams.find(t => t.id === offer.teamId);
                if (!team) continue;
                const newSalary = capPlayerSalary(p.offers[0].salary * (1.02 + Math.random() * 0.06), p.ovr, p.awards);
                if ((team.cap.cap - team.cap.payroll) >= newSalary) {
                    offer.salary = newSalary;
                }
            }
        }

        // Re-sort after counter-offers
        p.offers.sort((a, b) => {
            const teamA = cpuTeams.find(t => t.id === a.teamId);
            const teamB = cpuTeams.find(t => t.id === b.teamId);
            return scoreFreeAgentOffer(p, b, teamB, g) - scoreFreeAgentOffer(p, a, teamA, g);
        });
    }
}

export function calculateSignChance(player, offerSalary, offerYears){
    const g = STATE.game;
    const userTeam = g.league.teams[g.userTeamIndex];
    const userScore = offerSalary * (1 + 0.1 * offerYears);
    const askScore = player.ask * (1 + 0.1 * player.yearsAsk);
    const userOffer = { salary: offerSalary, years: offerYears, teamId: userTeam?.id };
    let bestCpuScore = 0;
    for (const off of (player.offers || [])) {
        const team = g.league.teams.find(t => t.id === off.teamId);
        const s = scoreFreeAgentOffer(player, off, team, g);
        if (s > bestCpuScore) bestCpuScore = s;
    }

    // No competing offers = player is desperate, will accept 15% below their ask
    const noCompetition = bestCpuScore === 0;
    const target = noCompetition ? askScore * 8.5 : Math.max(askScore * 10, bestCpuScore);
    if (target === 0) return 100;

    const ratio = scoreFreeAgentOffer(player, userOffer, userTeam, g) / target;
    let chance = (ratio - 0.85) / (1.15 - 0.85) * 100;

    return clamp(Math.round(chance), 0, 100);
}

// -------------------- OWNER ARCHETYPES (Phase 3) --------------------
// Each team has an owner with a distinct personality that shapes expectations, contracts,
// firings, and mid-season directives. Archetype is assigned once and persists for the franchise.
const OWNER_ARCHETYPES = {
    reasonable: {
        key: "reasonable",
        label: "Reasonable",
        blurb: "Balanced. Wants steady progress.",
        winTargetDelta: 0,
        contractYearsDelta: 0,
        salaryMultiplier: 1.0,
        fireApprovalThreshold: 30,
        loyaltyAggression: 1.0,
        mandateChance: 0.40,
        mandateBias: ["win_count", "make_playoffs", "trade_acquire", "cut_payroll", "protect_star"]
    },
    win_now_zealot: {
        key: "win_now_zealot",
        label: "Win-Now Zealot",
        blurb: "Demands titles now. Pays big. Short leash.",
        winTargetDelta: 5,
        contractYearsDelta: -1,
        salaryMultiplier: 1.20,
        fireApprovalThreshold: 45,
        loyaltyAggression: 1.20,
        mandateChance: 0.65,
        mandateBias: ["trade_acquire", "win_count", "make_playoffs"]
    },
    patient_rebuilder: {
        key: "patient_rebuilder",
        label: "Patient Rebuilder",
        blurb: "Long-term thinker. Tolerates losing if there's growth.",
        winTargetDelta: -4,
        contractYearsDelta: 2,
        salaryMultiplier: 0.95,
        fireApprovalThreshold: 15,
        loyaltyAggression: 0.95,
        mandateChance: 0.30,
        mandateBias: ["protect_star", "make_playoffs"]
    },
    cheap: {
        key: "cheap",
        label: "Cheap Owner",
        blurb: "Cap discipline above all. Will fire over excess spending.",
        winTargetDelta: 0,
        contractYearsDelta: 0,
        salaryMultiplier: 0.75,
        fireApprovalThreshold: 30,
        loyaltyAggression: 0.85,
        mandateChance: 0.55,
        mandateBias: ["cut_payroll", "cut_payroll", "win_count"]
    },
    meddler: {
        key: "meddler",
        label: "Meddler",
        blurb: "Strong opinions. Sends frequent directives.",
        winTargetDelta: 2,
        contractYearsDelta: 0,
        salaryMultiplier: 1.0,
        fireApprovalThreshold: 30,
        loyaltyAggression: 1.0,
        mandateChance: 0.90,
        mandateBias: ["trade_acquire", "protect_star", "win_count", "cut_payroll", "make_playoffs"]
    }
};

const OWNER_NAMES = [
    "Mr. Caldwell", "Mrs. Patel", "Mr. Voss", "Ms. Chen", "Mr. Davies",
    "Ms. Reyes", "Mr. Sharpe", "Ms. Okafor", "Mr. Lindgren", "Mr. Wagner",
    "Ms. Stratton", "Mr. Bishop", "Mrs. Akoto", "Mr. Iverson", "Ms. Yates",
    "Mr. Hollis", "Mr. Kane", "Mrs. Eriksen", "Mr. Mendel", "Ms. Bishara",
    "Mr. Quill", "Ms. Tate", "Mr. Pang", "Mr. Levitsky", "Ms. Marek",
    "Mr. Diop", "Mrs. Ashford", "Mr. Krause", "Ms. Onassis", "Mr. Briggs",
    "Mr. Faraj", "Ms. Donnelly"
];

// Owner archetype probabilities — most teams are reasonable; rare extremes are interesting
function pickOwnerArchetype(rand) {
    const r = rand();
    if (r < 0.40) return "reasonable";
    if (r < 0.55) return "win_now_zealot";
    if (r < 0.70) return "patient_rebuilder";
    if (r < 0.85) return "cheap";
    return "meddler";
}

// Assign owners to all teams that don't have one. Idempotent. Seeded by team id for stability.
function assignOwners(teams) {
    if (!teams) return;
    for (let i = 0; i < teams.length; i++) {
        const t = teams[i];
        if (t.owner && t.owner.archetype && t.owner.name) continue;
        const seed = seedFromString(`owner_${t.id || i}_v1`);
        const r = rng(seed);
        const archetype = pickOwnerArchetype(r);
        const name = OWNER_NAMES[Math.floor(r() * OWNER_NAMES.length)];
        t.owner = { archetype, name };
    }
}

// Look up an owner's archetype config; falls back to reasonable.
function ownerConfig(team) {
    const key = team?.owner?.archetype;
    return OWNER_ARCHETYPES[key] || OWNER_ARCHETYPES.reasonable;
}

// Public helper: returns a friendly label + blurb for a team's owner archetype.
export function getOwnerInfo(team) {
    const cfg = ownerConfig(team);
    return {
        name: team?.owner?.name || "—",
        archetype: cfg.key,
        label: cfg.label,
        blurb: cfg.blurb
    };
}

// Public helper: human-readable progress for the active mandate (e.g., "32/45 wins").
export function getMandateProgress(mandate, g) {
    if (!mandate) return null;
    const userTeam = g.league.teams[g.userTeamIndex];
    if (!userTeam) return null;
    if (mandate.type === "win_count") {
        return `${userTeam.wins || 0} / ${mandate.target} wins`;
    }
    if (mandate.type === "cut_payroll") {
        const payroll = userTeam.cap?.payroll || 0;
        return `Payroll: $${payroll.toFixed(1)}M / $${mandate.target}M target`;
    }
    if (mandate.type === "trade_acquire") {
        return mandate.acquired ? "Acquired ✓" : "Not yet";
    }
    if (mandate.type === "protect_star") {
        return mandate.violated ? "Star traded — failing" : "On track";
    }
    if (mandate.type === "make_playoffs") {
        const standing = getConferenceStandings(g, userTeam.conference);
        const rank = standing.findIndex(t => t.id === userTeam.id) + 1;
        return rank > 0 ? `Currently #${rank} in conference` : "Pending standings";
    }
    return null;
}

// -------------------- GM CAREER (Phase 1) --------------------
// Owner expectation, contract, and annual review. The GM is hired by the owner of the user's team
// at game start and reviewed each year. Outcomes: fired, hot-seat, status-quo, or contract extension.

// Derive what the owner expects from the team given its current rating. Re-derived every offseason
// once roster moves settle, so a great year forces higher expectations the year after.
// Owner archetype adjusts win target and description (zealots want more, rebuilders less).
function deriveExpectation(team) {
    const r = team?.rating ?? 70;
    const owner = ownerConfig(team);
    let base;
    if (r >= 85) base = { type: "title",     winTarget: 34, description: "Win the championship" };
    else if (r >= 78) base = { type: "contender", winTarget: 30, description: "Reach the conference finals" };
    else if (r >= 70) base = { type: "playoffs",  winTarget: 22, description: "Make the playoffs" };
    else base = { type: "rebuild", winTarget: 14, description: "Show improvement and develop young talent" };

    // Apply archetype modifier to win target
    base.winTarget = clamp(base.winTarget + (owner.winTargetDelta || 0), 8, 38);

    // Sharpen description for distinctive archetypes
    if (owner.key === "win_now_zealot" && base.type !== "title") {
        base.description = "Push harder — owner demands more.";
    } else if (owner.key === "patient_rebuilder" && base.type !== "rebuild") {
        base.description = base.description + " (owner is patient — sustainable growth matters)";
    } else if (owner.key === "cheap") {
        base.description = base.description + " (owner watches the payroll closely)";
    }

    return base;
}

// Initial salary tier — scales with how demanding the role is. Owner archetype adjusts up/down.
function expectationLevelFromRating(r) {
    if (r >= 85) return 3;
    if (r >= 78) return 2;
    if (r >= 70) return 1;
    return 0;
}

function expectationFromLevel(level) {
    if (level >= 3) return { type: "title", winTarget: 34, description: "Win the championship" };
    if (level === 2) return { type: "contender", winTarget: 30, description: "Reach the conference finals" };
    if (level === 1) return { type: "playoffs", winTarget: 22, description: "Make the playoffs" };
    return { type: "rebuild", winTarget: 14, description: "Show improvement and develop young talent" };
}

function playoffFinishLevel(finish) {
    if (finish === "Champion") return 4;
    if (finish === "Finals") return 3;
    if (finish === "Conf. Finals") return 2;
    if (finish === "Semis") return 1.5;
    if (finish === "Round 1") return 1;
    return 0;
}

function latestReviewForExpectation(g) {
    const history = g?.gm?.reviewHistory || [];
    return history.length ? history[history.length - 1] : null;
}

function latestTeamRecord(g, teamId) {
    const seasons = g?.history || [];
    const stint = currentOrLatestStint(g, teamId);
    for (let i = seasons.length - 1; i >= 0; i--) {
        const h = seasons[i];
        const isManagedSeason = h.userTeamId === teamId || (
            !h.userTeamId &&
            stint &&
            h.year >= stint.startYear &&
            (!stint.endYear || h.year <= stint.endYear)
        );
        if (isManagedSeason) {
            const rec = h.userRecord || {};
            return {
                id: teamId,
                name: h.userTeamName || stint?.teamName || "",
                wins: rec.wins || 0,
                losses: rec.losses || 0,
                rating: h.userTeamRating,
                madePlayoffs: playoffFinishLevel(h.userPlayoffFinish) > 0,
                playoffFinish: h.userPlayoffFinish
            };
        }

        const row = (seasons[i].allTeamRecords || []).find(t => t.id === teamId);
        if (row) return row;
    }
    return null;
}

function currentOrLatestStint(g, teamId) {
    const history = g?.gm?.career?.teamsHistory || [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].teamId === teamId) return history[i];
    }
    return null;
}

function activeStintYears(g, teamId) {
    const stint = currentOrLatestStint(g, teamId);
    return stint?.yearsWithTeam || 0;
}

function rosterIsDevelopmental(team) {
    const core = (team?.roster || [])
        .slice()
        .sort((a,b) => (b.ovr || 0) - (a.ovr || 0))
        .slice(0, 8);
    if (!core.length) return false;

    const avgAge = core.reduce((sum,p) => sum + (p.age || 24), 0) / core.length;
    const upsideCount = core.filter(p => ["A+", "A", "B"].includes(p.potentialGrade)).length;
    return avgAge <= 24.5 || upsideCount >= 4;
}

function expectationCapFromRecentPerformance(team, g, level, owner) {
    const record = latestTeamRecord(g, team?.id);
    if (!record) return { level, note: "" };

    let cap = 3;
    let note = "";
    const wins = record.wins || 0;
    const madePlayoffs = !!record.madePlayoffs;
    const stintYears = activeStintYears(g, team?.id);
    const developmental = rosterIsDevelopmental(team);

    if (wins < 12) {
        cap = owner.key === "win_now_zealot" && (team?.rating || 70) >= 80 ? 1 : 0;
        note = " after last season's rough record";
    } else if (wins < 18) {
        cap = 1;
        note = " after last season's losing record";
    } else if (!madePlayoffs) {
        cap = 1;
        note = " after missing the playoffs last season";
    } else if (wins < 24) {
        cap = 1;
        note = " after last season's playoff berth";
    } else if (madePlayoffs && wins < 30) {
        cap = 2;
        note = " after last season's playoff step";
    }

    if (stintYears < 2 && wins < 18) {
        cap = Math.min(cap, developmental ? 0 : 1);
        note = developmental
            ? " while your young core develops"
            : " while you stabilize the rebuild";
    }

    if (owner.key === "patient_rebuilder" && wins < 24) {
        cap = Math.min(cap, 0);
        note = " with a patient rebuild mandate";
    }

    if (level > cap) {
        return { level: cap, note };
    }
    return { level, note: "" };
}

function tuneExpectationWinTarget(base, team, g, owner) {
    const record = latestTeamRecord(g, team?.id);
    if (!record) {
        base.winTarget = clamp(base.winTarget + (owner.winTargetDelta || 0), 8, 38);
        if (base.type === "rebuild") base.winTarget = Math.min(base.winTarget, 18);
        if (base.type === "playoffs") base.winTarget = Math.min(base.winTarget, 26);
        if (base.type === "contender") base.winTarget = Math.min(base.winTarget, 32);
        return base;
    }

    const wins = record.wins || 0;
    if (base.type === "rebuild") {
        base.winTarget = clamp(Math.max(10, wins + 4), 8, 18);
    } else if (base.type === "playoffs" && wins < 18) {
        base.winTarget = clamp(wins + 8, 14, 24);
    } else if (base.type === "playoffs" && wins < 24) {
        base.winTarget = clamp(wins + 5, 18, 26);
    } else if (base.type === "contender" && wins < 30) {
        base.winTarget = clamp(wins + 5, 24, 30);
    }

    base.winTarget = clamp(base.winTarget + (owner.winTargetDelta || 0), 8, 38);
    if (base.type === "rebuild") base.winTarget = Math.min(base.winTarget, 18);
    if (base.type === "playoffs") base.winTarget = Math.min(base.winTarget, 26);
    if (base.type === "contender") base.winTarget = Math.min(base.winTarget, 32);
    return base;
}

function deriveAdjustedExpectation(team, g = null) {
    const r = team?.rating ?? 70;
    const owner = ownerConfig(team);
    let level = expectationLevelFromRating(r);
    let contextNote = "";

    const perf = expectationCapFromRecentPerformance(team, g, level, owner);
    level = perf.level;
    contextNote = perf.note;

    const review = latestReviewForExpectation(g);
    const approval = g?.gm?.ownerApproval ?? 70;
    const reviewBelongsToTeam = review?.teamId
        ? review.teamId === team?.id
        : activeStintYears(g, team?.id) > 0;
    const isRecentReview = review && (!g?.year || review.year >= g.year - 1) && reviewBelongsToTeam;
    if (isRecentReview) {
        const finishLevel = playoffFinishLevel(review.playoffFinish);

        if (finishLevel === 0) {
            const cap = owner.key === "win_now_zealot" && r >= 82 ? 2 : 1;
            if (level > cap) {
                level = cap;
                contextNote = owner.key === "win_now_zealot"
                    ? " after last season's miss"
                    : " after missing the playoffs last season";
            }
        } else if (finishLevel <= 1 && level >= 3) {
            level = 2;
            contextNote = " after an early playoff exit";
        } else if (finishLevel === 1.5 && level >= 3 && owner.key !== "win_now_zealot" && approval < 80) {
            level = 2;
            contextNote = " after last season's playoff loss";
        }

        if (approval < 35 && level >= 2) {
            level = 1;
            contextNote = " while you rebuild owner trust";
        } else if (approval < 55 && level >= 3) {
            level = 2;
            contextNote = " while you prove last year was behind you";
        }

        if (owner.key === "patient_rebuilder" && ["missed", "failed"].includes(review.verdict) && level > 1) {
            level -= 1;
            contextNote = " with a steadier, patient approach";
        }
    }

    const base = tuneExpectationWinTarget(expectationFromLevel(level), team, g, owner);

    if (owner.key === "win_now_zealot" && base.type !== "title") {
        if (base.type === "contender") base.description = "Reach the conference finals";
        else if (base.type === "playoffs") base.description = "Make the playoffs";
        base.description += " (owner still wants urgency)";
    } else if (owner.key === "patient_rebuilder" && base.type !== "rebuild") {
        base.description = base.description + " (owner is patient - sustainable growth matters)";
    } else if (owner.key === "cheap") {
        base.description = base.description + " (owner watches the payroll closely)";
    }

    if (contextNote) base.description += contextNote;
    base.ratingLevel = expectationLevelFromRating(r);
    base.adjustedLevel = level;
    return base;
}

function normalizeCurrentOwnerGoal(g) {
    if (!g?.gm || g.gm.status !== "active") return;
    if (g.phase !== PHASES.REGULAR) return;

    const team = g.league?.teams?.[g.userTeamIndex];
    if (!team) return;

    const earlySeason = (g.week || 1) <= 2;
    const currentLevel = expectationTypeLevel(g.gm.expectation?.type);
    const adjusted = deriveAdjustedExpectation(team, g);
    if (earlySeason && (expectationTypeLevel(adjusted.type) < currentLevel || adjusted.winTarget < (g.gm.expectation?.winTarget || 99))) {
        g.gm.expectation = adjusted;
        return;
    }

    const latest = latestTeamRecord(g, team.id);
    const desc = g.gm.expectation?.description || "";
    if (latest?.madePlayoffs && desc.includes("missing the playoffs last season")) {
        g.gm.expectation.description = adjusted.description;
    }
}

function expectationTypeLevel(type) {
    if (type === "title") return 3;
    if (type === "contender") return 2;
    if (type === "playoffs") return 1;
    return 0;
}

function computeInitialSalary(expectation, team) {
    let base;
    switch (expectation?.type) {
        case "title":     base = 10; break;
        case "contender": base = 8; break;
        case "playoffs":  base = 6; break;
        case "rebuild":   base = 4; break;
        default:          base = 5;
    }
    const owner = ownerConfig(team);
    return Math.max(2, Math.min(20, Number((base * (owner.salaryMultiplier || 1.0)).toFixed(1))));
}

// Build the GM object for a brand-new save. Called once from newGameState.
function buildInitialGm(userTeam, year) {
    const expectation = deriveAdjustedExpectation(userTeam);
    const salary = computeInitialSalary(expectation, userTeam);
    const owner = ownerConfig(userTeam);
    const contractYears = Math.max(2, 3 + (owner.contractYearsDelta || 0));
    return {
        contract: {
            years: contractYears,
            salary,
            yearSigned: year,
            initialSalary: salary
        },
        activeMandate: null,
        mandateCooldownUntilYear: 0,
        status: "active",            // 'active' | 'fired'
        ownerApproval: 70,
        expectation,
        career: {
            yearsAsGM: 0,
            titles: 0,
            finalsAppearances: 0,
            playoffAppearances: 0,
            losingSeasons: 0,
            extensions: 0,
            tradesExecuted: 0,
            bestRecord: { wins: 0, losses: 0 },
            firstTeamName: userTeam?.name || "—",
            // Per-stint history; new entry pushed when GM moves teams.
            teamsHistory: userTeam ? [{
                teamId: userTeam.id,
                teamName: userTeam.name,
                startYear: year,
                startingRating: userTeam.rating || 70,
                titlesWithTeam: 0,
                playoffsWithTeam: 0,
                yearsWithTeam: 0
            }] : []
        },
        reviewHistory: []
    };
}

// Backfill an existing save that predates the GM system. Best-effort estimates of career stats
// from saved history so the player isn't shown as a rookie in year 6.
function backfillGmFromHistory(g) {
    const userTeam = g.league.teams[g.userTeamIndex];
    const gm = buildInitialGm(userTeam, g.year);
    let titles = 0, finals = 0, playoffs = 0, losing = 0, best = { wins: 0, losses: 0 };
    for (const h of (g.history || [])) {
        const rec = h.userRecord || {};
        if (rec.wins > best.wins) best = { wins: rec.wins, losses: rec.losses };
        if ((rec.losses ?? 0) > (rec.wins ?? 0)) losing += 1;
        const f = h.userPlayoffFinish;
        if (f && f !== "Didn't Make" && f !== "Missed") playoffs += 1;
        if (f === "Finals" || f === "Champion") finals += 1;
        if (f === "Champion") titles += 1;
    }
    gm.career.yearsAsGM = (g.history || []).length;
    gm.career.titles = titles;
    gm.career.finalsAppearances = finals;
    gm.career.playoffAppearances = playoffs;
    gm.career.losingSeasons = losing;
    gm.career.bestRecord = best;
    // Bump initial salary slightly based on prior success so a long-running save isn't insulting
    if (titles > 0) gm.contract.salary = Math.min(20, gm.contract.salary + 2 * titles);
    return gm;
}

// -------------------- MID-SEASON MANDATES (Phase 3) --------------------
// Owners issue one directive per season around week 5; check fulfillment at season end.

// Generate a mandate appropriate to the owner archetype + team state.
// Returns the mandate object (also writes it to gm.activeMandate) or null if none fired.
function generateMandate(g) {
    const gm = g.gm;
    if (!gm || gm.activeMandate || gm.status !== "active") return null;
    if ((gm.mandateCooldownUntilYear || 0) > g.year) return null;
    const userTeam = g.league.teams[g.userTeamIndex];
    if (!userTeam) return null;
    const owner = ownerConfig(userTeam);

    // Probability gate
    if (Math.random() > (owner.mandateChance || 0)) return null;

    // Pick type from the archetype bias
    const bias = owner.mandateBias && owner.mandateBias.length
        ? owner.mandateBias
        : ["win_count", "make_playoffs"];
    let type = bias[Math.floor(Math.random() * bias.length)];
    if (gm.expectation?.type === "rebuild" && type === "make_playoffs") {
        type = "win_count";
    }

    const mandate = {
        id: `mandate_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        type,
        issuedWeek: g.week,
        status: "active"
    };

    if (type === "win_count") {
        const baseTarget = gm.expectation?.winTarget || 18;
        const minTarget = gm.expectation?.type === "rebuild" ? 10 : 18;
        const bump = gm.expectation?.type === "rebuild" ? 2 : 4;
        const target = Math.min(g.seasonWeeks * 4 - 5, Math.max(minTarget, baseTarget + bump));
        mandate.target = target;
        mandate.description = `Win at least ${target} games this regular season.`;
        mandate.reward = 12;
        mandate.penalty = -10;
    } else if (type === "make_playoffs") {
        mandate.description = `Make the playoffs.`;
        mandate.reward = 15;
        mandate.penalty = -12;
    } else if (type === "trade_acquire") {
        const minOvr = 78;
        mandate.target = minOvr;
        mandate.description = `Acquire a player rated ${minOvr}+ via trade before the deadline.`;
        mandate.reward = 14;
        mandate.penalty = -10;
        mandate.acquired = false;
    } else if (type === "cut_payroll") {
        const cur = userTeam.cap?.payroll || 100;
        const target = Math.max(60, Math.floor(cur * 0.90));
        mandate.target = target;
        mandate.description = `Get team payroll under $${target}M by season's end.`;
        mandate.reward = 10;
        mandate.penalty = -8;
    } else if (type === "protect_star") {
        const star = (userTeam.roster || [])
            .filter(p => p.ovr >= 75)
            .sort((a, b) => b.ovr - a.ovr)[0];
        if (!star) return null; // no star to protect, skip
        mandate.targetPlayerId = star.id;
        mandate.targetPlayerName = star.name;
        mandate.description = `Do not trade ${star.name} this season.`;
        mandate.reward = 8;
        mandate.penalty = -10;
        mandate.violated = false;
    } else {
        return null; // unknown type
    }

    const ownerName = userTeam.owner?.name || "The owner";
    mandate.pitch = `${ownerName} has issued a directive: "${mandate.description}"`;

    gm.activeMandate = mandate;
    gm.mandateCooldownUntilYear = g.year + 2 + Math.floor(Math.random() * 2);
    g.inbox.unshift({
        t: Date.now(),
        msg: `OWNER MANDATE (Week ${g.week}): ${mandate.pitch}`
    });
    return mandate;
}

// Check the active mandate at season end. Applies approval delta, clears the mandate.
// `opts.payrollSnapshot` is the user's payroll captured BEFORE end-of-season contract expirations,
// so cut_payroll isn't trivially passed by natural attrition.
function resolveMandate(g, opts = {}) {
    const gm = g.gm;
    if (!gm || !gm.activeMandate) return null;
    const mandate = gm.activeMandate;
    const userTeam = g.league.teams[g.userTeamIndex];
    if (!userTeam) { gm.activeMandate = null; return null; }

    let completed = false;
    if (mandate.type === "win_count") {
        completed = (userTeam.wins || 0) >= mandate.target;
    } else if (mandate.type === "make_playoffs") {
        const finish = g.lastSeasonRecap?.userFinish;
        completed = !!finish && finish !== "Didn't Make" && finish !== "Missed";
    } else if (mandate.type === "trade_acquire") {
        completed = !!mandate.acquired;
    } else if (mandate.type === "cut_payroll") {
        const payroll = opts.payrollSnapshot ?? (userTeam.cap?.payroll || 999);
        completed = payroll <= mandate.target;
    } else if (mandate.type === "protect_star") {
        completed = !mandate.violated;
    }

    mandate.status = completed ? "completed" : "failed";
    const delta = completed ? (mandate.reward || 10) : (mandate.penalty || -10);
    gm.ownerApproval = clamp((gm.ownerApproval ?? 70) + delta, 0, 100);

    const ownerName = userTeam.owner?.name || "Owner";
    g.inbox.unshift({
        t: Date.now(),
        msg: completed
            ? `MANDATE COMPLETE: ${ownerName} is pleased. (+${delta} approval)`
            : `MANDATE FAILED: ${ownerName} is unhappy. (${delta} approval)`
    });

    gm.activeMandate = null;
    return { completed, delta };
}

// Stamp the current teamsHistory entry with an end year and final rating. Idempotent.
function closeCurrentStint(gm, team, year) {
    const history = gm?.career?.teamsHistory;
    if (!history || !history.length) return;
    const stint = history[history.length - 1];
    if (stint.endYear) return; // already closed
    stint.endYear = year;
    stint.endingRating = team?.rating || stint.startingRating || 70;
}

// End-of-season owner review. Updates approval/status only; contracts change through accepted offers.
//   fired | hot_seat | champion_review | positive_review | lame_duck | status_quo
// Returns the review object (also written to g.gmReview for the modal to pick up).
function conductAnnualReview(g, userFinish) {
    const gm = g.gm;
    if (!gm || gm.status !== "active") return null;

    const userTeam = g.league.teams[g.userTeamIndex];
    const wins = userTeam?.wins ?? 0;
    const losses = userTeam?.losses ?? 0;
    const winTarget = gm.expectation?.winTarget ?? 38;
    const expectationType = gm.expectation?.type ?? "playoffs";
    const winDelta = wins - winTarget;
    const isChamp = userFinish === "Champion";
    const isFinals = userFinish === "Finals" || isChamp;
    const madePlayoffs = userFinish && userFinish !== "Didn't Make" && userFinish !== "Missed";

    // Update career stats
    gm.career.yearsAsGM += 1;
    if (isChamp) gm.career.titles += 1;
    if (isFinals) gm.career.finalsAppearances += 1;
    if (madePlayoffs) gm.career.playoffAppearances += 1;
    if (losses > wins) gm.career.losingSeasons += 1;
    if (wins > (gm.career.bestRecord?.wins || 0)) {
        gm.career.bestRecord = { wins, losses };
    }
    // Per-stint tracking
    const history = gm.career.teamsHistory || [];
    const stint = history[history.length - 1];
    if (stint) {
        stint.yearsWithTeam = (stint.yearsWithTeam || 0) + 1;
        if (isChamp) stint.titlesWithTeam = (stint.titlesWithTeam || 0) + 1;
        if (madePlayoffs) stint.playoffsWithTeam = (stint.playoffsWithTeam || 0) + 1;
    }

    // Determine verdict. Playoff-round goals are judged by playoff finish first,
    // with wins still acting as context for "close" and "exceeded" seasons.
    let verdict, approvalDelta;
    const finishLevel = playoffFinishLevel(userFinish);
    if (isChamp) {
        verdict = "exceeded_title"; approvalDelta = 40;
    } else if (expectationType === "title") {
        if (isFinals) { verdict = "close"; approvalDelta = -5; }
        else if (finishLevel >= 2) { verdict = "missed"; approvalDelta = -15; }
        else if (madePlayoffs) { verdict = "missed"; approvalDelta = -25; }
        else { verdict = "failed"; approvalDelta = -45; }
    } else if (expectationType === "contender") {
        if (finishLevel >= 2) {
            verdict = winDelta >= 5 ? "exceeded" : "met";
            approvalDelta = winDelta >= 5 ? 25 : 10;
        } else if (madePlayoffs) {
            verdict = "close"; approvalDelta = -8;
        } else {
            verdict = winDelta >= -5 ? "missed" : "failed";
            approvalDelta = winDelta >= -5 ? -25 : -45;
        }
    } else if (expectationType === "playoffs") {
        if (madePlayoffs) {
            verdict = winDelta >= 8 || finishLevel >= 2 ? "exceeded" : "met";
            approvalDelta = verdict === "exceeded" ? 25 : 10;
        } else if (winDelta >= -5) {
            verdict = "close"; approvalDelta = -5;
        } else if (winDelta >= -10) {
            verdict = "missed"; approvalDelta = -25;
        } else {
            verdict = "failed"; approvalDelta = -45;
        }
    } else if (expectationType === "rebuild") {
        if (madePlayoffs) { verdict = "exceeded"; approvalDelta = 35; }
        else if (wins >= winTarget - 3) { verdict = "met"; approvalDelta = 10; }
        else if (winDelta >= -8) { verdict = "close"; approvalDelta = -5; }
        else { verdict = "missed"; approvalDelta = -20; }
    } else if (winDelta >= 0) {
        verdict = "met"; approvalDelta = 10;
    } else {
        verdict = "missed"; approvalDelta = -20;
    }

    gm.ownerApproval = clamp(gm.ownerApproval + approvalDelta, 0, 100);
    gm.contract.years -= 1;

    // Decision logic
    let action;          // string identifier
    let salaryChange = 0;
    let yearsAdded = 0;
    let ownerMessage;

    const inFinalYear = gm.contract.years <= 0;

    const owner = ownerConfig(userTeam);
    const fireApproval = owner.fireApprovalThreshold ?? 30;
    const rebuildingRunway = expectationType === "rebuild" && (stint?.yearsWithTeam || 0) <= 2;

    if (rebuildingRunway && (verdict === "failed" || verdict === "missed") && inFinalYear) {
        action = "hot_seat";
        ownerMessage = "The owner sees the rebuild is still early, but any new contract will need to be accepted from the offer table.";
    } else if (verdict === "failed" && inFinalYear) {
        action = "fired";
        gm.status = "fired";
        closeCurrentStint(gm, userTeam, g.year);
        ownerMessage = "The owner has decided to move on. After a disappointing season, you have been relieved of your duties.";
    } else if (verdict === "missed" && inFinalYear && gm.ownerApproval < fireApproval) {
        action = "fired";
        gm.status = "fired";
        closeCurrentStint(gm, userTeam, g.year);
        ownerMessage = "The owner has lost confidence. Your contract will not be renewed.";
    } else if (owner.key === "win_now_zealot" && verdict === "missed" && inFinalYear) {
        // Zealots fire on any miss in the final year regardless of approval
        action = "fired";
        gm.status = "fired";
        closeCurrentStint(gm, userTeam, g.year);
        ownerMessage = `${userTeam.owner.name} expects titles. A missed playoff target in your final year is unacceptable.`;
    } else if (verdict === "exceeded_title") {
        action = "champion_review";
        ownerMessage = "CHAMPIONSHIP! The owner is overjoyed. Any new deal will appear as an offer you can accept on the Dashboard.";
    } else if (verdict === "exceeded") {
        action = "positive_review";
        ownerMessage = "The owner is impressed. Any extension or raise will come through an offer you can choose to accept.";
    } else if (verdict === "met" && inFinalYear) {
        action = "positive_review";
        ownerMessage = "Solid season. The owner may put a new deal on the table, but it is your call to accept it.";
    } else if ((verdict === "missed" || verdict === "close") && inFinalYear) {
        action = "hot_seat";
        ownerMessage = "Underwhelming season. If the owner keeps you, the new contract will appear as an offer you can accept.";
    } else if (inFinalYear) {
        action = "lame_duck";
        ownerMessage = "Your contract expires after next season. The owner wants results before discussing an extension.";
    } else if (verdict === "missed" || verdict === "failed") {
        action = "warning";
        ownerMessage = "The owner is not happy with this season. Improvement is expected.";
    } else {
        action = "status_quo";
        ownerMessage = "The owner is satisfied. Keep building.";
    }

    const review = {
        year: g.year,
        teamId: userTeam?.id,
        teamName: userTeam?.name,
        wins, losses, winTarget,
        winDelta,
        expectationType,
        expectationDescription: gm.expectation?.description || "",
        playoffFinish: userFinish,
        verdict,
        action,
        salaryChange,
        yearsAdded,
        salary: gm.contract.salary,
        yearsRemaining: gm.contract.years,
        ownerApproval: gm.ownerApproval,
        ownerMessage,
        viewed: false
    };
    gm.reviewHistory.push({ ...review, viewed: undefined });
    g.gmReview = review;

    return review;
}

// -------------------- GM CAREER (Phase 2: Reputations + Job Market) --------------------

// Derive earned reputations from the GM's career stats. Pure function over gm + g.
// Returns an array of { key, label, blurb } — used both for UI badges and poaching-fit logic.
export function computeReputations(gm, g) {
    const reps = [];
    if (!gm || !gm.career) return reps;
    const c = gm.career;
    const yrs = c.yearsAsGM || 0;

    if (c.titles >= 3) {
        reps.push({ key: "dynasty", label: "Dynasty Builder", blurb: "Multiple championships across your career." });
    } else if (c.titles >= 1) {
        reps.push({ key: "champion", label: "Champion", blurb: "You've won a title." });
    }
    if (c.finalsAppearances >= 3) {
        reps.push({ key: "finals_veteran", label: "Finals Veteran", blurb: "Repeatedly made the championship round." });
    }
    if (yrs >= 3 && (c.playoffAppearances / Math.max(1, yrs)) >= 0.6) {
        reps.push({ key: "mainstay", label: "Playoff Mainstay", blurb: "Reliable postseason team-builder." });
    }
    if (c.tradesExecuted >= 15) {
        reps.push({ key: "trade_specialist", label: "Trade Specialist", blurb: "Active dealmaker — comfortable on the phones." });
    }
    if (yrs >= 8) {
        reps.push({ key: "veteran", label: "Veteran GM", blurb: "Long-tenured league insider." });
    }
    // Rebuilder: any stint where you took a sub-70 rating team to 78+
    const userTeam = g?.league?.teams?.[g.userTeamIndex];
    const currentRating = userTeam?.rating || 0;
    const successfulRebuild = (c.teamsHistory || []).some(t => t.startingRating < 70 && currentRating >= 78);
    if (successfulRebuild) {
        reps.push({ key: "rebuilder", label: "Rebuilder", blurb: "Has turned a losing franchise into a contender." });
    }
    if (c.losingSeasons >= 4 && c.titles === 0) {
        reps.push({ key: "embattled", label: "Embattled", blurb: "Has weathered several losing seasons — owners may hesitate." });
    }
    return reps;
}

// Each offseason, decide which CPU teams fire their GMs and open a position.
// Performance-driven: poor record / steep rating drop = higher chance of an opening.
// Also a small random component so the market always has movement.
function simulateLeagueFirings(g) {
    const teams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
    const openings = [];

    for (const t of teams) {
        let chance = 0.04; // base 4% random churn
        const losses = t.losses || 0;
        const wins = t.wins || 0;
        const games = wins + losses;
        if (games > 0) {
            const winPct = wins / games;
            if (winPct < 0.30) chance += 0.45;
            else if (winPct < 0.40) chance += 0.20;
            else if (winPct < 0.48) chance += 0.06;
        }
        if (Math.random() < chance) openings.push(t.id);
    }

    // Cap openings to 4 per offseason so the league doesn't churn wildly
    return openings.slice(0, 4);
}

// Score how attractive a given user (with their reputations) is to a given team.
// Higher = team more likely to make an aggressive offer. 0-100ish range.
function poachingFitScore(reps, team, gm) {
    let score = 30; // baseline interest
    const repKeys = new Set(reps.map(r => r.key));
    const teamRating = team.rating || 70;
    const isContender = teamRating >= 78;
    const isRebuild = teamRating < 70;

    // Reputation match
    if (repKeys.has("dynasty")) score += 35;
    if (repKeys.has("champion")) score += 20;
    if (repKeys.has("finals_veteran")) score += 15;
    if (repKeys.has("mainstay")) score += 12;
    if (repKeys.has("trade_specialist")) score += 8;
    if (repKeys.has("veteran")) score += 5;
    if (repKeys.has("rebuilder") && isRebuild) score += 25;
    if (repKeys.has("rebuilder") && isContender) score += 5;
    if (repKeys.has("embattled")) score -= 20;

    // Contenders chase proven winners — not someone with losing seasons
    if (isContender && (gm?.career?.losingSeasons || 0) >= 3) score -= 15;
    // Rebuilders are happy with anyone who's worked at this level
    if (isRebuild) score += 5;

    return score;
}

// Build a contract pitch from a hiring team to the user. Salary scales with the team's level
// of need and the user's reputation. Years are tighter for contenders (less patience).
function generatePoachingOffer(team, gm, reps) {
    const teamRating = team.rating || 70;
    const tier = teamRating >= 82 ? "title"
        : teamRating >= 76 ? "contender"
        : teamRating >= 68 ? "playoffs"
        : "rebuild";

    // Base salary tier — higher for higher-stakes jobs
    const baseSalary = tier === "title" ? 12
        : tier === "contender" ? 9
        : tier === "playoffs" ? 7
        : 5;

    // Reputation bonus
    const repKeys = new Set(reps.map(r => r.key));
    let mult = 1.0;
    if (repKeys.has("dynasty")) mult += 0.40;
    else if (repKeys.has("champion")) mult += 0.20;
    if (repKeys.has("finals_veteran")) mult += 0.10;
    if (repKeys.has("rebuilder") && tier === "rebuild") mult += 0.15;
    if (repKeys.has("embattled")) mult -= 0.10;

    // Owner archetype shapes the offer further — zealots overpay, cheap owners under-pay
    const owner = ownerConfig(team);
    mult *= (owner.salaryMultiplier || 1.0);

    let salary = baseSalary * mult;
    const currentSalary = gm?.contract?.salary || 0;
    if (currentSalary > 0) {
        let stretch = 1.08;
        if (repKeys.has("champion")) stretch = 1.15;
        if (repKeys.has("finals_veteran")) stretch = Math.max(stretch, 1.18);
        if (repKeys.has("dynasty")) stretch = 1.25;
        if (owner.key === "win_now_zealot") stretch += 0.05;
        if (owner.key === "cheap") stretch -= 0.04;
        salary = Math.max(salary, currentSalary * stretch);
    }
    salary = Math.max(3, Math.min(30, Number(salary.toFixed(1))));

    // Title contenders want shorter, results-now deals; rebuilders give longer runways
    let years = tier === "title" ? 3
        : tier === "contender" ? 3
        : tier === "playoffs" ? 4
        : 5;
    years = Math.max(3, years + (owner.contractYearsDelta || 0));

    // Build pitch, using owner name and archetype flavor
    const ownerName = team.owner?.name || `${team.name} owner`;
    let pitch;
    if (owner.key === "win_now_zealot") {
        pitch = `${ownerName}: "We're done waiting. Win us a title or you're gone. We'll pay for the right person."`;
    } else if (owner.key === "patient_rebuilder") {
        pitch = `${ownerName}: "We're playing the long game. You'll get the runway to build it properly."`;
    } else if (owner.key === "cheap") {
        pitch = `${ownerName}: "We need a GM who can squeeze value. The cap is sacred here."`;
    } else if (owner.key === "meddler") {
        pitch = `${ownerName}: "I have a lot of ideas. I need a GM who can execute them. You in?"`;
    } else if (tier === "title" && repKeys.has("champion")) {
        pitch = `${ownerName}: "We're built to win now. We need a closer who's done it before — that's you."`;
    } else if (tier === "rebuild" && repKeys.has("rebuilder")) {
        pitch = `${ownerName}: "We saw what you did before. Come run our rebuild. You'll have full control."`;
    } else if (tier === "contender") {
        pitch = `${ownerName}: "We're knocking on the door. The right GM gets us through — we think it's you."`;
    } else if (tier === "rebuild") {
        pitch = `${ownerName}: "We're starting fresh. Patient ownership, real autonomy. Help us climb out."`;
    } else {
        pitch = `${ownerName}: "We want stability and a path forward. Your name keeps coming up."`;
    }

    return {
        id: `poach_${team.id}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        teamId: team.id,
        teamName: team.name,
        teamRating,
        teamTier: tier,
        contractYears: years,
        salary,
        pitch,
        kind: "poaching" // 'poaching' | 'wilderness'
    };
}

// Wilderness offers for a fired GM — fewer, smaller, but a path back to a job.
// Always at least 1 if there are any openings; max 2.
function generateWildernessOffers(g, openings) {
    const offers = [];
    const teams = openings
        .map(id => g.league.teams.find(t => t.id === id))
        .filter(Boolean)
        .sort((a, b) => (a.rating || 70) - (b.rating || 70)); // worst first

    const pool = teams.slice(0, 4);
    for (const t of pool) {
        if (offers.length >= 2) break;
        // Wilderness offers are lower-tier deals, but still give the GM a real runway.
        const salary = Math.max(2.5, Math.min(6, Number(((t.rating || 65) / 18).toFixed(1))));
        const ownerName = t.owner?.name || `${t.name} owner`;
        offers.push({
            id: `wild_${t.id}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
            teamId: t.id,
            teamName: t.name,
            teamRating: t.rating || 65,
            teamTier: "rebuild",
            contractYears: 3,
            salary,
            pitch: `${ownerName}: "We need a steady hand — willing to take a chance on a comeback. One-year-show-me deal with an option."`,
            kind: "wilderness"
        });
    }
    return offers;
}

function justWonChampionship(g) {
    const review = g.gmReview || latestReviewForExpectation(g);
    return review?.year === g.year && review?.playoffFinish === "Champion";
}

function generateChampionCuriosityOffer(g, gm, reps, excludeTeamIds = new Set()) {
    const userTeamId = g.league.teams[g.userTeamIndex]?.id;
    const candidates = g.league.teams
        .filter(t => t.id !== userTeamId && !excludeTeamIds.has(t.id))
        .slice()
        .sort((a,b) => {
            const aGames = (a.wins || 0) + (a.losses || 0);
            const bGames = (b.wins || 0) + (b.losses || 0);
            const aPct = aGames ? (a.wins || 0) / aGames : 0.5;
            const bPct = bGames ? (b.wins || 0) / bGames : 0.5;
            return aPct - bPct || (a.rating || 70) - (b.rating || 70);
        });

    const shortList = candidates.slice(0, 4);
    if (!shortList.length) return null;

    const team = shortList[Math.floor(Math.random() * shortList.length)];
    const offer = generatePoachingOffer(team, gm, reps);
    const ownerName = team.owner?.name || `${team.name} owner`;
    offer.kind = "champion_curiosity";
    offer.pitch = `${ownerName}: "You just won it all. We know this is a long shot, but our franchise needs that standard."`;
    return offer;
}

// Generate a loyalty counter-offer from the user's current owner, IF they care enough to match.
// Owner approval drives both willingness to counter and how aggressively they match.
// Returns an offer object (kind: 'loyalty') or null.
function generateLoyaltyCounter(g, gm, bestPoachingSalary) {
    if (!gm || gm.status !== "active") return null;
    const approval = gm.ownerApproval ?? 70;
    if (approval < 60) return null; // owner won't fight to keep you

    const currentTeam = g.league.teams[g.userTeamIndex];
    if (!currentTeam) return null;
    const currentSalary = gm.contract?.salary || 0;
    const owner = ownerConfig(currentTeam);

    // Multiplier scales with approval — beloved GMs get pampered.
    // Owner archetype further modulates: zealots fight harder, cheap owners less.
    let mult;
    if (approval >= 80) mult = 1.05;        // beat best by 5%
    else if (approval >= 70) mult = 1.00;   // match best
    else mult = 0.95;                       // try, but tighter
    mult *= (owner.loyaltyAggression || 1.0);

    const counterSalary = Math.max(currentSalary, Number((bestPoachingSalary * mult).toFixed(1)));
    // If the owner's best effort still doesn't beat current salary, they pass
    if (counterSalary <= currentSalary) return null;

    // Extension: more years for higher approval
    const yearsAdded = approval >= 80 ? 3 : 2;

    const ownerName = currentTeam.owner?.name || `${currentTeam.name} owner`;
    const pitch = approval >= 80
        ? `${ownerName}: "You're our guy. Other teams are calling — let's make sure they stop. New deal on the table."`
        : approval >= 70
        ? `${ownerName}: "We want you here. Let's match what's out there and keep building."`
        : `${ownerName}: "We'd like you to stay. This is our best offer to keep you on board."`;

    return {
        id: `loyalty_${currentTeam.id}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        teamId: currentTeam.id,
        teamName: currentTeam.name,
        teamRating: currentTeam.rating || 70,
        teamTier: gm.expectation?.type || "playoffs",
        contractYears: yearsAdded,        // years ADDED to current contract
        salary: counterSalary,
        pitch,
        kind: "loyalty"
    };
}

function shouldOfferCurrentTeamExtension(g, gm) {
    if (!gm || gm.status !== "active") return false;
    const review = g.gmReview;
    if (!review) return false;
    if ((gm.ownerApproval ?? 0) < 70) return false;
    if ((gm.contract?.years ?? 0) <= 0) return true;
    return ["exceeded_title", "exceeded"].includes(review.verdict);
}

// Build the job market for the user this offseason. Called from finalizeSeasonAndLogHistory
// AFTER conductAnnualReview so we know if they're active or fired.
function buildJobMarket(g) {
    g.gmJobMarket = [];
    const gm = g.gm;
    if (!gm) return;

    const openings = simulateLeagueFirings(g);
    const reps = computeReputations(gm, g);

    if (gm.status === "fired") {
        if (!openings.length) return;
        g.gmJobMarket = generateWildernessOffers(g, openings);
        return;
    }

    // Active GM: each opening considers whether to chase the user based on fit
    const offers = [];
    for (const teamId of openings) {
        const team = g.league.teams.find(t => t.id === teamId);
        if (!team) continue;
        const fit = poachingFitScore(reps, team, gm);
        // Convert fit score to a probability; cap at ~65% so even great fits don't always come calling
        const chance = clamp((fit - 30) / 100, 0, 0.65);
        if (Math.random() < chance) {
            offers.push(generatePoachingOffer(team, gm, reps));
        }
    }

    // Filter: a CPU team only makes the offer if it at least beats the user's current salary.
    // generatePoachingOffer stretches serious bids, so stars still get a market after big raises.
    const currentSalary = gm.contract?.salary || 0;
    const qualifiedPoaching = offers.filter(o => o.salary >= currentSalary + 0.1).slice(0, 3);

    // Counter offer from current team — only if there's something credible to counter
    if (!qualifiedPoaching.length && justWonChampionship(g)) {
        const fallback = generateChampionCuriosityOffer(g, gm, reps, new Set(offers.map(o => o.teamId)));
        if (fallback && fallback.salary >= currentSalary + 0.1) {
            qualifiedPoaching.push(fallback);
        }
    }

    const poachingOffers = [...qualifiedPoaching];
    if (poachingOffers.length) {
        const bestSalary = Math.max(...poachingOffers.map(o => o.salary));
        const counter = generateLoyaltyCounter(g, gm, bestSalary);
        if (counter) poachingOffers.unshift(counter); // loyalty offer at top
    } else if (shouldOfferCurrentTeamExtension(g, gm)) {
        const review = g.gmReview;
        const currentSalary = gm.contract?.salary || 0;
        const targetSalary = currentSalary * (review?.verdict === "exceeded_title" ? 1.25 : 1.08);
        const counter = generateLoyaltyCounter(g, gm, targetSalary);
        if (counter) poachingOffers.unshift(counter);
    }

    g.gmJobMarket = poachingOffers;

    const poachCount = qualifiedPoaching.length;
    if (poachCount > 0) {
        const loyaltyPart = poachingOffers.some(o => o.kind === "loyalty")
            ? " Your owner has countered with a loyalty offer."
            : "";
        g.inbox.unshift({
            t: Date.now(),
            msg: `JOB MARKET: ${poachCount} team${poachCount > 1 ? "s have" : " has"} reached out about your GM services.${loyaltyPart} See the Job Market on the Dashboard.`
        });
    }
}

// Accept a poaching offer. Closes the current team stint, switches the user to the new team,
// resets contract and approval, and clears team-specific session state.
export function acceptPoachingOffer(offerId) {
    const g = STATE.game;
    const gm = g.gm;
    if (!gm) return { success: false, msg: "No GM state." };
    const offer = (g.gmJobMarket || []).find(o => o.id === offerId);
    if (!offer) return { success: false, msg: "Offer not found." };

    const newTeam = g.league.teams.find(t => t.id === offer.teamId);
    if (!newTeam) return { success: false, msg: "Team no longer exists." };
    const newIndex = g.league.teams.findIndex(t => t.id === offer.teamId);
    if (newIndex < 0) return { success: false, msg: "Team not in league." };
    const contractYears = Math.max(3, offer.contractYears || 3);
    offer.contractYears = contractYears;

    // Close out current stint (if any). Fired GMs already closed theirs in conductAnnualReview.
    const currentTeam = g.league.teams[g.userTeamIndex];
    if (gm.status === "active") {
        closeCurrentStint(gm, currentTeam, g.year);
    }

    // Push the new stint
    const history = gm.career.teamsHistory || [];
    history.push({
        teamId: newTeam.id,
        teamName: newTeam.name,
        startYear: g.year + 1, // takes effect for the upcoming season
        startingRating: newTeam.rating || 70,
        titlesWithTeam: 0,
        playoffsWithTeam: 0,
        yearsWithTeam: 0
    });
    gm.career.teamsHistory = history;

    // Switch teams and reset contract / owner
    g.userTeamIndex = newIndex;
    gm.contract = {
        years: contractYears,
        salary: offer.salary,
        yearSigned: g.year,
        initialSalary: offer.salary
    };
    gm.status = "active";
    gm.ownerApproval = 70;
    gm.expectation = deriveAdjustedExpectation(newTeam, g);
    gm.activeMandate = null; // mandate was issued by old owner — drop it
    gm.mandateCooldownUntilYear = Math.max(gm.mandateCooldownUntilYear || 0, g.year + 1);

    // Clear team-specific session state — these all belong to the old team
    g.pendingTradeOffers = [];
    g.midseasonFaPool = [];
    g.lastUserOfferWeek = 0;
    g.tradeDemandChecked = false;
    g.gmJobMarket = [];

    g.inbox.unshift({
        t: Date.now(),
        msg: `NEW JOB: You are now the GM of the ${newTeam.name}. ${contractYears} years at $${offer.salary}M/yr.`
    });
    autoSave();
    return { success: true, msg: `Welcome to the ${newTeam.name}.`, newTeamName: newTeam.name };
}

// Accept a loyalty counter-offer from the current team. Extends the existing contract by the
// counter's years and bumps salary to the counter amount. Clears the entire job market.
export function acceptLoyaltyOffer(offerId) {
    const g = STATE.game;
    const gm = g.gm;
    if (!gm) return { success: false, msg: "No GM state." };
    const offer = (g.gmJobMarket || []).find(o => o.id === offerId);
    if (!offer || offer.kind !== "loyalty") return { success: false, msg: "Loyalty offer not found." };

    // Sanity: the loyalty offer must reference the current team
    const currentTeam = g.league.teams[g.userTeamIndex];
    if (!currentTeam || currentTeam.id !== offer.teamId) {
        return { success: false, msg: "Offer no longer valid." };
    }

    gm.contract.years = (gm.contract.years || 0) + offer.contractYears;
    gm.contract.salary = offer.salary;
    gm.career.extensions = (gm.career.extensions || 0) + 1;

    g.gmJobMarket = [];
    g.inbox.unshift({
        t: Date.now(),
        msg: `LOYALTY DEAL: Extended ${offer.contractYears} years with ${currentTeam.name} at $${offer.salary.toFixed(1)}M/yr. Outside offers declined.`
    });
    autoSave();
    return { success: true, msg: `You signed an extension with the ${currentTeam.name}.` };
}

export function declineAllPoachingOffers() {
    const g = STATE.game;
    g.gmJobMarket = [];
    if (g.gm?.status === "active") {
        g.inbox.unshift({
            t: Date.now(),
            msg: `You declined all outside interest. Staying put for now.`
        });
    }
    autoSave();
    return { success: true };
}

// -------------------- PROGRESSION & SIMULATION --------------------

function processEndSeasonRoster(g){
  const userTeamId = g.league.teams[g.userTeamIndex].id;
  g.offseason.expiring = []; 
  const userDevelopmentReport = [];

  for(const t of g.league.teams){
    const nextRoster = [];
    
    for(const p of t.roster){
      const wasUserPlayer = t.id === userTeamId;
      const beforeDev = wasUserPlayer ? {
          name: p.name,
          pos: p.pos,
          age: p.age || 20,
          ovr: p.ovr,
          off: p.off ?? p.ovr,
          def: p.def ?? p.ovr,
          potentialGrade: p.potentialGrade,
          focus: p.dev?.focus || "Balanced",
          minutes: p.rotation?.minutes || 0,
          gp: p.stats?.gp || 0,
          ppg: p.stats?.gp ? Number((p.stats.pts / p.stats.gp).toFixed(1)) : 0
      } : null;
      const devReasons = [];

      p.off ??= p.ovr;
      p.def ??= p.ovr;
      p.dev ??= { focus: "Balanced", points: 0 };
      p.dev.focus ??= "Balanced";

      p.careerStats ??= [];
      p.careerStats.push({
          year: g.year,
          teamName: t.name,
          ovr: p.ovr,
          gp: p.stats.gp || 0,
          pts: p.stats.pts || 0,
          reb: p.stats.reb || 0,
          ast: p.stats.ast || 0
      });

      const age = p.age || 20;
      const minutes = p.rotation?.minutes || 0; 
      const focus = p.dev.focus || "Balanced";
      
      let baseGrowth = 0;

      // 1. Age
      if (age <= 22) { baseGrowth += 2; devReasons.push("young core age"); }
      else if (age <= 25) { baseGrowth += 1; devReasons.push("still developing"); }
      else if (age <= 29) { baseGrowth += 0; devReasons.push("prime age"); }
      else if (age <= 32) { baseGrowth -= 1; devReasons.push("early decline age"); }
      else { baseGrowth -= 3; devReasons.push("late-career decline"); }

      // 2. Potential
      if (p.potentialGrade === "A+") { baseGrowth += 2; devReasons.push("A+ potential"); }
      else if (p.potentialGrade === "A") { baseGrowth += 1; devReasons.push("A potential"); }
      else if (p.potentialGrade === "B") {
          if (Math.random() > 0.5) { baseGrowth += 1; devReasons.push("B potential bump"); }
          else devReasons.push("B potential held steady");
      }
      else if (p.potentialGrade === "F") { baseGrowth -= 1; devReasons.push("F potential drag"); }
      else devReasons.push(`${p.potentialGrade || "C"} potential`);

      // 3. Playtime
      if (age < 28) {
          if (minutes >= 28) { baseGrowth += 2; devReasons.push("starter minutes"); }
          else if (minutes >= 15) { baseGrowth += 1; devReasons.push("rotation minutes"); }
          else if (minutes < 5) { baseGrowth -= 1; devReasons.push("buried on bench"); }
          else devReasons.push("limited role");
      }

      // 4. Performance
      const ppg = p.stats.gp > 0 ? (p.stats.pts / p.stats.gp) : 0;
      if (age < 26 && ppg >= 15) {
          baseGrowth += 1; 
          devReasons.push("strong scoring year");
          if (t.id === userTeamId && Math.random() < 0.3) {
             g.inbox.unshift({ t:Date.now(), msg:`DEVELOPMENT: ${p.name} improved from strong performance!` });
          }
      }

      // 5. Soft Cap
      const caps = { "A+":99, "A":92, "B":84, "C":77, "D":70, "F":60 };
      const softCap = caps[p.potentialGrade] || 75;
      if (p.ovr >= softCap) {
          if (baseGrowth > 0) baseGrowth = 0; 
          else baseGrowth -= 1; 
          devReasons.push(`near ${p.potentialGrade} soft cap (${softCap})`);
      }

      // 6. Variance
      const roll = Math.random();
      if (roll < 0.05) {
          baseGrowth += 3; 
          devReasons.push("breakout offseason");
          if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`BREAKOUT: ${p.name} had a massive offseason (+${baseGrowth})!` });
      } else if (roll < 0.10) {
          baseGrowth -= 2;
          devReasons.push("rough offseason");
      }

      let offChange = baseGrowth + (Math.floor(Math.random() * 3) - 1); 
      let defChange = baseGrowth + (Math.floor(Math.random() * 3) - 1);

      if (focus === "Offense") {
          offChange += 1;
          devReasons.push("offense focus");
      } else if (focus === "Defense") {
          defChange += 1;
          devReasons.push("defense focus");
      } else if (focus === "Shooting" || focus === "Playmaking") {
          offChange += focus === "Shooting" ? 2 : 1;
          if (focus === "Shooting") defChange -= 1;
          devReasons.push(`${focus.toLowerCase()} focus`);
      } else if (focus === "Strength") {
          defChange += 1;
          if (age <= 25) offChange += 1;
          devReasons.push("strength focus");
      } else {
          devReasons.push("balanced focus");
      }

      if (age >= 30) {
          const declineFloor = age <= 32 ? -1 : age <= 35 ? -2 : -3;
          offChange = Math.min(offChange, declineFloor);
          defChange = Math.min(defChange, declineFloor);
          devReasons.push(age <= 32 ? "veteran decline begins" : "veteran decline");
      }

      p.off = clamp(p.off + offChange, 40, 99);
      p.def = clamp(p.def + defChange, 40, 99);
      p.ovr = Math.round((p.off + p.def) / 2);
      p.age = age + 1;

      // Retirement
      let retireChance = 0;
      if (p.age >= 34) retireChance = 0.10;
      if (p.age >= 36) retireChance = 0.30;
      if (p.age >= 38) retireChance = 0.60;
      if (p.age >= 40) retireChance = 0.90;

      if (Math.random() < retireChance) {
          g.retiredPlayers.push({ ...p, retiredYear: g.year, finalTeam: t.name });
          if (wasUserPlayer && beforeDev) {
              userDevelopmentReport.push({
                  ...beforeDev,
                  newAge: p.age,
                  newOvr: p.ovr,
                  newOff: p.off,
                  newDef: p.def,
                  ovrDelta: p.ovr - beforeDev.ovr,
                  offDelta: p.off - beforeDev.off,
                  defDelta: p.def - beforeDev.def,
                  status: "Retired",
                  reasons: devReasons.slice(0, 5)
              });
          }
          if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`${p.name} has retired at age ${p.age}.` });
          continue; 
      }

      p.contract.years -= 1;
      const devStatus = p.contract.years > 0 ? "Returning" : "Expired";

      if (wasUserPlayer && beforeDev) {
          userDevelopmentReport.push({
              ...beforeDev,
              newAge: p.age,
              newOvr: p.ovr,
              newOff: p.off,
              newDef: p.def,
              ovrDelta: p.ovr - beforeDev.ovr,
              offDelta: p.off - beforeDev.off,
              defDelta: p.def - beforeDev.def,
              status: devStatus,
              reasons: devReasons.slice(0, 5)
          });
      }

      if(p.contract.years > 0){
        nextRoster.push(p);
      } else {
        if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`${p.name}'s contract expired.` });
        
        const fairValue = calculateSalary(p.ovr, p.age);
        const greed = 0.9 + Math.random() * 0.3;
        const prestigeMult = calcAwardPrestige(p);

        g.offseason.expiring.push({
            ...p,
            ask: capPlayerSalary(fairValue * greed * prestigeMult, p.ovr, p.awards),
            yearsAsk: Math.max(1, Math.min(4, Math.floor(Math.random() * 4) + 1)),
            formerTeamId: t.id,
            signedByTeamId: null,
            contract: null,
            careerStats: p.careerStats,
            offers: []
        });
      }
    }
    
    t.roster = nextRoster;
    // Clear trade demands for next season
    for (const p of t.roster) { p.tradeDemand = false; p.tradeDemandReason = null; }
    autoDistributeMinutes(t);
    recalcPayroll(t);
    updateTeamRating(t);
  }

  // CPU teams cut dead weight after processing rosters
  simCpuRosterCuts(g);
  g.lastDevelopmentReport = userDevelopmentReport;
  g.tradeDemandChecked = false;
}

export function negotiateExtension(teamId, playerId, execute = true){
    const g = STATE.game;
    const team = g.league.teams.find(t => t.id === teamId);
    const p = team.roster.find(x => x.id === playerId);
    
    if (!p) return { success:false, msg:"Player not found." };
    if (p.contract.years > 2) return { success:false, msg:"Too early to extend (>2 years left)." };
    if (p.happiness < 40) return { success:false, msg:"Player is too unhappy to discuss an extension." };

    const askAmount = calculateExtensionSalary(p.ovr, p.age, p.happiness, p.awards);
    const addYears = 3; 

    const projectedPayroll = team.cap.payroll + (askAmount - p.contract.salary);
    const softCapLimit = team.cap.cap + 20;

    if (projectedPayroll > softCapLimit) {
        return { success:false, msg:`Cannot sign. Payroll (${projectedPayroll.toFixed(1)}M) would exceed Soft Cap (${softCapLimit}M).` };
    }

    if (!execute) {
        return { success:true, msg:`Would you like to extend ${p.name} for ${addYears} additional years at $${askAmount}M/yr?` };
    }

    p.contract.salary = askAmount;
    p.contract.years += addYears;
    p.happiness += 5; 

    recalcPayroll(team);
    autoSave();
    
    return { success:true, msg:`Signed ${p.name} to ${addYears}y extension ($${askAmount}M/yr).` };
}

// Award prestige multiplier — players with accolades demand more in free agency
function calcAwardPrestige(p) {
    const awards = p.awards || [];
    let mult = 1.0;
    const mvps    = awards.filter(a => a.includes("MVP") && !a.includes("DPOY") && !a.includes("OPOY")).length;
    const allStars = awards.filter(a => a.includes("All-Star")).length;
    const dpoys   = awards.filter(a => a.includes("DPOY")).length;
    const opoys   = awards.filter(a => a.includes("OPOY")).length;
    const roys    = awards.filter(a => a.includes("ROY")).length;
    mult += mvps    * 0.12; // +12% per MVP
    mult += Math.min(allStars, 6) * 0.03; // +3% per All-Star, capped at 6
    mult += dpoys   * 0.07;
    mult += opoys   * 0.07;
    mult += roys    * 0.04;
    return Math.min(mult, 1.50); // cap at +50% premium
}

// ---- CPU TRADE HELPERS ----

function getTeamMode(team, g) {
    const confTeams = [...g.league.teams]
        .filter(t => t.conference === team.conference)
        .sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses));
    const rank = confTeams.findIndex(t => t.id === team.id) + 1;
    if (rank <= 8) return "win_now";
    if (rank <= 14) return "retooling";
    return "rebuilding";
}

function findPlayerTeam(g, playerId) {
    return g?.league?.teams?.find(t => (t.roster || []).some(p => p.id === playerId)) || null;
}

function playerContractMultiplier(p) {
    const salary = p.contract?.salary || 0;
    const years = p.contract?.years || 0;
    if (!salary || !years) return 0.82;

    const fairSalary = Math.max(1, calculateSalary(p.ovr || 60, p.age || 24));
    const ratio = salary / fairSalary;
    let mult = 1.0;

    if (ratio <= 0.45) mult += 0.24;
    else if (ratio <= 0.70) mult += 0.14;
    else if (ratio <= 0.95) mult += 0.05;
    else if (ratio >= 1.65) mult -= 0.30;
    else if (ratio >= 1.35) mult -= 0.18;
    else if (ratio >= 1.15) mult -= 0.08;

    if (years >= 3) mult += ratio <= 1.0 ? 0.10 : -0.10;
    else if (years === 1) mult += ratio <= 0.8 ? 0.02 : -0.08;

    return clamp(mult, 0.55, 1.30);
}

function playerAgeMultiplier(p, receivingTeam, g) {
    const age = p.age || 24;
    const mode = receivingTeam ? getTeamMode(receivingTeam, g || STATE.game) : "retooling";
    let mult;

    if (age <= 21) mult = 1.28;
    else if (age <= 24) mult = 1.18;
    else if (age <= 28) mult = 1.06;
    else if (age <= 31) mult = 0.94;
    else if (age <= 34) mult = 0.76;
    else mult = 0.55;

    if (mode === "win_now") {
        if (age >= 27 && age <= 32) mult += 0.08;
        if (age <= 22) mult -= 0.08;
    } else if (mode === "rebuilding") {
        if (age <= 24) mult += 0.14;
        if (age >= 29) mult -= 0.18;
    }

    return clamp(mult, 0.45, 1.45);
}

function playerLeverageMultiplier(p, sendingTeam, receivingTeam) {
    const happy = p.happiness ?? 70;
    let mult = 1.0;

    if (p.tradeDemand) mult -= 0.24;
    else if (happy < 25) mult -= 0.20;
    else if (happy < 40) mult -= 0.12;
    else if (happy >= 90) mult += 0.08;
    else if (happy >= 80) mult += 0.04;

    if (sendingTeam && receivingTeam && sendingTeam.id === receivingTeam.id && happy >= 80) {
        mult += 0.06;
    }

    return clamp(mult, 0.65, 1.16);
}

function playerFitMultiplier(p, team) {
    if (!p || !team) return 1.0;
    const sameSpot = team.roster.filter(r => r.pos === p.pos && r.id !== p.id);
    const countAtPos = sameSpot.length;
    const bestAtPos = sameSpot.reduce((max, r) => Math.max(max, r.ovr || 0), 0);

    let fitMult = 1.0;
    if (countAtPos === 0) fitMult = 1.30;
    else if (countAtPos === 1 && bestAtPos < p.ovr - 4) fitMult = 1.20;
    else if (countAtPos === 1) fitMult = 1.05;
    else if (countAtPos === 2 && bestAtPos < p.ovr - 4) fitMult = 1.10;
    else if (countAtPos === 2) fitMult = 0.95;
    else if (countAtPos >= 3 && p.ovr > bestAtPos + 2) fitMult = 0.90;
    else if (countAtPos >= 3) fitMult = 0.65;

    return fitMult;
}

export function tradePlayerValue(p, { receivingTeam = null, sendingTeam = null, game = null } = {}) {
    if (!p || p.ovr == null) return 0;
    const g = game || STATE.game;
    const holder = sendingTeam || findPlayerTeam(g, p.id);
    const ovr = Math.max(0, p.ovr - 50);
    let val = Math.pow(ovr, 2.15);

    if (p.ovr >= 92) val *= 1.55;
    else if (p.ovr >= 88) val *= 1.34;
    else if (p.ovr >= 84) val *= 1.18;

    val *= playerAgeMultiplier(p, receivingTeam, g);
    val *= playerContractMultiplier(p);
    val *= playerLeverageMultiplier(p, holder, receivingTeam);
    val *= playerFitMultiplier(p, receivingTeam);

    return Math.max(0, Math.round(val));
}

function projectedPickOriginalTeam(pick, g) {
    return g?.league?.teams?.find(t => t.id === pick.originalOwnerId) || null;
}

function projectedPickStrength(pick, g) {
    const original = projectedPickOriginalTeam(pick, g);
    if (!original) return 0.50;

    const games = (original.wins || 0) + (original.losses || 0);
    if (games >= 6) return (original.wins || 0) / games;
    return clamp(((original.rating || 72) - 55) / 35, 0.05, 0.95);
}

function expectedRookieOvrForPick(pick, strength) {
    if (pick.round === 1) {
        if (strength <= 0.18) return 81; // likely #1-2
        if (strength <= 0.30) return 79; // high lottery
        if (strength <= 0.42) return 77; // lottery
        if (strength <= 0.55) return 75; // mid-first
        if (strength <= 0.70) return 72; // playoff first
        return 70;                       // contender first
    }

    if (strength <= 0.30) return 68;
    if (strength <= 0.55) return 66;
    return 64;
}

function pickUncertaintyMultiplier(pick, strength) {
    if (pick.round === 1) {
        if (strength <= 0.18) return 0.92;
        if (strength <= 0.30) return 0.86;
        if (strength <= 0.42) return 0.78;
        if (strength <= 0.55) return 0.68;
        if (strength <= 0.70) return 0.56;
        return 0.48;
    }

    if (strength <= 0.30) return 0.42;
    if (strength <= 0.55) return 0.34;
    return 0.26;
}

function expectedRookieForPick(pick, g) {
    const strength = projectedPickStrength(pick, g);
    const round = pick.round || 1;
    const ovr = expectedRookieOvrForPick(pick, strength);
    const age = round === 1 ? 21 : 22;
    const salary = round === 1 ? 4.0 : 1.5;
    return {
        id: `expected_${pick.id}`,
        name: "Expected Rookie",
        pos: "SG",
        ovr,
        off: ovr,
        def: ovr,
        age,
        happiness: 70,
        contract: { years: 2, salary },
        potentialGrade: "C"
    };
}

export function tradePickValue(pick, { game = null, receivingTeam = null } = {}) {
    const g = game || STATE.game;
    const yearsOut = Math.max(0, pick.year - g.year);
    const strength = projectedPickStrength(pick, g);
    const expectedRookie = expectedRookieForPick(pick, g);
    let val = tradePlayerValue(expectedRookie, { receivingTeam, game: g });
    val *= pickUncertaintyMultiplier(pick, strength);
    val *= Math.pow(0.84, yearsOut);

    const mode = receivingTeam ? getTeamMode(receivingTeam, g) : "retooling";
    if (mode === "rebuilding") val *= pick.round === 1 ? 1.12 : 1.06;
    else if (mode === "win_now" && yearsOut > 0) val *= 0.92;

    return Math.max(1, Math.round(val));
}

function cpuPlayerValue(p) {
    return tradePlayerValue(p, { game: STATE.game });
}

// Value of player p to a specific team — adjusted for positional fit.
// A scorer to a team that needs scoring is worth more than the same player to a stacked team.
// When `team` is null/undefined, falls back to base cpuPlayerValue (no fit context).
function cpuPlayerValueFor(p, team, sendingTeam = null, g = STATE.game) {
    return tradePlayerValue(p, { receivingTeam: team, sendingTeam, game: g });
}

function cpuPickValue(pick, currentYear, receivingTeam = null, g = STATE.game) {
    return tradePickValue(pick, { game: g || { year: currentYear, league: { teams: [] } }, receivingTeam });
}

// Returns the player `team` should offer, based on what the other team's mode wants.
// Prefers trading from overstocked positions; avoids leaving a position empty.
// If `receivingTeam` is provided, also filters out positions the receiver is already deep at
// and biases toward positions the receiver actually needs.
function pickOfferPlayer(team, requestingMode, receivingTeam = null) {
    const roster = [...team.roster];
    const teamPlan = analyzeTeamNeeds(team, STATE.game);
    const receiverPlan = receivingTeam ? analyzeTeamNeeds(receivingTeam, STATE.game) : null;
    const tradeBlock = new Set(teamPlan.tradeBlockIds);
    const corePlayers = new Set(teamPlan.corePlayerIds);

    // Find positions the team has surplus at (most players) — prefer trading those
    const posCounts = {};
    POSITIONS.forEach(pos => posCounts[pos] = 0);
    roster.forEach(p => posCounts[p.pos] = (posCounts[p.pos] || 0) + 1);
    const maxCount = Math.max(...POSITIONS.map(pos => posCounts[pos]));
    const surplusPos = new Set([...teamPlan.surplus, ...POSITIONS.filter(pos => posCounts[pos] >= maxCount)]);

    // Receiver positional context: how many players they have at each pos, and what their best OVR is
    const receiverCounts = {};
    const receiverBest = {};
    if (receivingTeam) {
        POSITIONS.forEach(pos => { receiverCounts[pos] = 0; receiverBest[pos] = 0; });
        for (const r of receivingTeam.roster) {
            receiverCounts[r.pos] = (receiverCounts[r.pos] || 0) + 1;
            if (r.ovr > (receiverBest[r.pos] || 0)) receiverBest[r.pos] = r.ovr;
        }
    }
    // Receiver doesn't want a player at a position they're already stacked at (3+) unless the player is a clear upgrade
    const fitsReceiver = (p) => {
        if (!receivingTeam) return true;
        const cnt = receiverCounts[p.pos] || 0;
        if (cnt >= 3 && p.ovr <= (receiverBest[p.pos] || 0)) return false;
        return true;
    };
    // Bonus signal: receiver is THIN at this position (0-1 players, or current best is much worse)
    const isReceiverNeed = (p) => {
        if (!receivingTeam) return false;
        if (receiverPlan?.needs?.includes(p.pos)) return true;
        const cnt = receiverCounts[p.pos] || 0;
        if (cnt === 0) return true;
        if (cnt === 1 && (receiverBest[p.pos] || 0) < p.ovr - 4) return true;
        return false;
    };

    // A player is safe to trade only if someone else covers their position
    const isTradeSafe = (p) => roster.filter(x => x.pos === p.pos && x.id !== p.id).length >= 1;
    const isAvailable = (p) => {
        if (!isTradeSafe(p) || !fitsReceiver(p)) return false;
        if (tradeBlock.has(p.id)) return true;
        if (corePlayers.has(p.id) && !p.tradeDemand && (p.happiness ?? 70) >= 45) return false;
        return surplusPos.has(p.pos) || (p.happiness ?? 70) < 40 || p.tradeDemand;
    };

    let pool;
    if (requestingMode === "win_now") {
        pool = roster.filter(p => p.age >= 27 && p.ovr >= 74 && isAvailable(p));
    } else if (requestingMode === "retooling") {
        pool = roster.filter(p => p.age <= 29 && p.ovr >= 70 && isAvailable(p));
    } else {
        // rebuilding wants young players
        pool = roster.filter(p => p.age <= 24 && isAvailable(p));
    }

    // Sort: receiver-needs first, then surplus positions, then by lowest OVR (keep stars)
    pool.sort((a, b) => {
        const aNeed = isReceiverNeed(a) ? 0 : 1;
        const bNeed = isReceiverNeed(b) ? 0 : 1;
        if (aNeed !== bNeed) return aNeed - bNeed;
        const aSurplus = surplusPos.has(a.pos) ? 0 : 1;
        const bSurplus = surplusPos.has(b.pos) ? 0 : 1;
        return aSurplus - bSurplus || a.ovr - b.ovr;
    });

    if (pool.length) return pool[0];

    // Fallback: any safe player, weakest first (keep receiver fit filter if it applies)
    const safe = roster.filter(isAvailable).sort((a, b) => {
        const aBlock = tradeBlock.has(a.id) ? 0 : 1;
        const bBlock = tradeBlock.has(b.id) ? 0 : 1;
        return aBlock - bBlock || a.ovr - b.ovr;
    });
    if (safe.length) return safe[0];

    // Final fallback (no receiver fit): any safe player. Preserves prior behavior for legacy paths.
    const anySafe = roster.filter(isTradeSafe).sort((a, b) => a.ovr - b.ovr);
    return anySafe[0] || null;
}

// CPU teams lock up young stars / valuable players mid-season before they hit free agency
function simCpuExtensions(g) {
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    for (const team of cpuTeams) {
        const mode = getTeamMode(team, g);
        if (mode === "rebuilding") continue; // rebuilders let players walk or get picks

        for (const p of team.roster) {
            if (!p.contract || p.contract.years > 2) continue; // not extension-eligible
            if ((p.happiness ?? 70) < 40) continue; // too unhappy to talk

            const isWorthExtending =
                p.ovr >= 82 ||
                (p.ovr >= 76 && p.age <= 26) ||
                (p.ovr >= 78 && ["A+", "A"].includes(p.potentialGrade));
            if (!isWorthExtending) continue;
            if (Math.random() > 0.70) continue; // not every eligible player gets extended

            const askAmount = calculateExtensionSalary(p.ovr, p.age, p.happiness, p.awards);
            const addYears = 3;

            const projectedPayroll = team.cap.payroll + (askAmount - (p.contract.salary || 0));
            if (projectedPayroll > SALARY_CAP + 20) continue; // can't afford even with soft cap

            // Smart cap logic: don't extend if a better player at the same position is expiring soon
            const betterLocked = team.roster.find(r =>
                r.id !== p.id && r.pos === p.pos && r.ovr >= p.ovr + 6 && (r.contract?.years ?? 0) >= 3
            );
            if (betterLocked) continue; // already have a long-term solution at this position

            const betterExpiringSoon = team.roster.find(r =>
                r.id !== p.id && r.pos === p.pos && r.ovr >= p.ovr + 6 &&
                (r.contract?.years ?? 0) >= 1 && (r.contract?.years ?? 0) <= 2
            );
            if (betterExpiringSoon) {
                const futureAsk = calculateSalary(betterExpiringSoon.ovr, betterExpiringSoon.age + betterExpiringSoon.contract.years);
                const spaceAfterExtend = (SALARY_CAP + 20) - projectedPayroll;
                if (spaceAfterExtend < futureAsk * 0.80) continue; // can't afford the better player if we commit here
            }

            p.contract.salary = askAmount;
            p.contract.years += addYears;
            p.happiness = Math.min(100, (p.happiness ?? 70) + 5);
            recalcPayroll(team);

            g.inbox.unshift({
                t: Date.now(),
                msg: `EXTENSION: ${team.name} signed ${p.name} to a ${addYears}-year extension at $${askAmount}M/yr.`
            });
        }
    }
}

// CPU teams cut overpaid/bloated players at end of season to free cap space
function simCpuRosterCuts(g) {
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
    for (const team of cpuTeams) {
        // Cut down to 15 if over-rostered (keep highest-value players)
        while (team.roster.length > 15) {
            const worst = team.roster.reduce((a, b) => cpuPlayerValue(a) < cpuPlayerValue(b) ? a : b);
            team.roster = team.roster.filter(p => p.id !== worst.id);
        }

        // Cut worst value-per-salary players if still over hard cap + soft cap buffer
        if (team.cap.payroll > SALARY_CAP + 20) {
            const byValueRatio = [...team.roster].sort((a, b) => {
                const ratioA = (a.contract?.salary || 0) / Math.max(1, cpuPlayerValue(a));
                const ratioB = (b.contract?.salary || 0) / Math.max(1, cpuPlayerValue(b));
                return ratioB - ratioA; // worst salary efficiency first
            });
            for (const p of byValueRatio) {
                if (team.roster.length <= 8 || team.cap.payroll <= SALARY_CAP + 20) break;
                team.roster = team.roster.filter(x => x.id !== p.id);
                recalcPayroll(team);
            }
        }

        // Also cut clearly overpaid aging players even within cap (cap hygiene)
        if (team.cap.payroll > SALARY_CAP * 0.95) {
            const deadWeight = team.roster.filter(p =>
                p.age >= 34 && p.ovr < 74 && (p.contract?.salary || 0) > 8 && team.roster.length > 8
            );
            for (const p of deadWeight) {
                team.roster = team.roster.filter(x => x.id !== p.id);
            }
        }

        recalcPayroll(team);
        updateTeamRating(team);
    }
}

function simCpuTrades(g, week){
    const nearDeadline = week >= 16 && week <= TRADE_DEADLINE_WEEK;
    const aiTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
    if (aiTeams.length < 2) return;

    // Try multiple random team pairings per call — stop after first successful trade
    const maxPairs = nearDeadline ? 5 : 3;
    const shuffled = [...aiTeams].sort(() => 0.5 - Math.random());

    for (let pair = 0; pair < maxPairs; pair++) {
        // Each pairing still has a random gate, but we try several before giving up
        const tradeChance = nearDeadline ? 0.70 : 0.50;
        if (Math.random() > tradeChance) continue;

        const idx1 = pair % shuffled.length;
        const idx2 = (pair + Math.floor(shuffled.length / 2)) % shuffled.length;
        if (idx1 === idx2) continue;
        const t1 = shuffled[idx1];
        const t2 = shuffled[idx2];
        const mode1 = getTeamMode(t1, g);
        const mode2 = getTeamMode(t2, g);

        const dealFns = [
            () => cpuDeal_PlayerSwap(t1, t2, mode1, mode2, g),
            () => cpuDeal_TwoForOne(t1, t2, mode1, mode2, g),
            () => cpuDeal_PlayerForPicks(t1, t2, mode1, mode2, g),
            () => cpuDeal_PickSwap(t1, t2, g),
            () => cpuDeal_BuyLow(t1, t2, mode1, mode2, g),
        ];
        for (let i = dealFns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dealFns[i], dealFns[j]] = [dealFns[j], dealFns[i]];
        }

        for (const fn of dealFns) {
            const deal = fn();
            if (!deal) continue;

            const t1OutSal = deal.t1Assets.players.reduce((s, p) => s + (p.contract?.salary || 0), 0);
            const t2OutSal = deal.t2Assets.players.reduce((s, p) => s + (p.contract?.salary || 0), 0);
            if ((t1.cap.payroll - t1OutSal + t2OutSal) > SALARY_CAP + 10) continue;
            if ((t2.cap.payroll - t2OutSal + t1OutSal) > SALARY_CAP + 10) continue;

            const t1Net = deal.t2Assets.players.length - deal.t1Assets.players.length;
            const t2Net = deal.t1Assets.players.length - deal.t2Assets.players.length;
            if (t1.roster.length + t1Net > 15 || t2.roster.length + t2Net > 15) continue;
            if (t1.roster.length + t1Net < 5 || t2.roster.length + t2Net < 5) continue;

            const sendIds1 = new Set(deal.t1Assets.players.map(p => p.id));
            const sendIds2 = new Set(deal.t2Assets.players.map(p => p.id));
            const t1PostRoster = [
                ...t1.roster.filter(p => !sendIds1.has(p.id)),
                ...deal.t2Assets.players
            ];
            const t2PostRoster = [
                ...t2.roster.filter(p => !sendIds2.has(p.id)),
                ...deal.t1Assets.players
            ];
            const hasAllPos = (roster) => ["PG","SG","SF","PF","C"].every(pos => roster.some(p => p.pos === pos));
            if (!hasAllPos(t1PostRoster) || !hasAllPos(t2PostRoster)) continue;

            executeTrade(t1.id, t2.id, deal.t1Assets, deal.t2Assets);
            g.cpuSeasonTradeCount = (g.cpuSeasonTradeCount || 0) + 1;

            const fmtSide = (assets) => [
                ...assets.players.map(p => p.name),
                ...assets.picks.map(pk => `${pk.year} R${pk.round}`)
            ].join(' + ') || '(nothing)';
            g.inbox.unshift({
                t: Date.now(),
                msg: `TRADE: ${t1.name} sends ${fmtSide(deal.t1Assets)} to ${t2.name} for ${fmtSide(deal.t2Assets)}.`
            });
            return; // one trade per call max
        }
    }
}

// CPU teams send trade offers TO the user. Throttled so the user isn't spammed.
// Pending offers are visible on the Dashboard with Accept / Decline buttons.
function simCpuOffersToUser(g, week) {
    if (week > TRADE_DEADLINE_WEEK) return;
    g.pendingTradeOffers ??= [];
    g.lastUserOfferWeek ??= 0;

    // Expire stale offers
    g.pendingTradeOffers = g.pendingTradeOffers.filter(o => o.expiresWeek >= week);

    // Throttle: at most 2 pending offers, and at least 2 weeks between new ones
    if (g.pendingTradeOffers.length >= 2) return;
    if (week - g.lastUserOfferWeek < 2) return;
    if (Math.random() > 0.35) return;

    const userTeam = g.league.teams[g.userTeamIndex];
    if (!userTeam || userTeam.roster.length < 6) return;

    const cpuTeams = g.league.teams.filter(t => t.id !== userTeam.id);
    const shuffled = [...cpuTeams].sort(() => 0.5 - Math.random());

    for (const cpu of shuffled.slice(0, 6)) {
        if (cpu.roster.length < 6) continue;
        const cpuMode = getTeamMode(cpu, g);
        const userMode = getTeamMode(userTeam, g);

        // CPU wants a player from user roster that fits their mode. Pickoffer picks from user surplus
        // that fits CPU's needs — exactly the receiver-aware logic we built earlier.
        const target = pickOfferPlayer(userTeam, cpuMode, cpu);
        if (!target) continue;
        if (target.ovr < 70) continue; // CPU doesn't initiate offers for fringe bench
        // Skip top-tier user stars unless they're aging or unhappy — keeps offers realistic
        if (target.ovr >= 85 && target.age < 30 && (target.happiness ?? 70) >= 55) continue;

        // CPU sends a player from their roster that fits user's needs
        const offerPlayer = pickOfferPlayer(cpu, userMode, userTeam);
        if (!offerPlayer || offerPlayer.id === target.id) continue;

        // Fit-adjusted valuations from each side's perspective
        const userViewOfOffer = cpuPlayerValueFor(offerPlayer, userTeam);
        const userViewOfTarget = cpuPlayerValueFor(target, userTeam);
        const cpuViewOfTarget = cpuPlayerValueFor(target, cpu);
        const cpuViewOfOffer = cpuPlayerValueFor(offerPlayer, cpu);

        // For a credible offer, CPU should value its incoming target more than what it's giving up
        if (cpuViewOfTarget < cpuViewOfOffer * 0.85) continue;

        // From user's side: gap = what they're losing minus what they're getting (in user's eyes)
        const userGap = userViewOfTarget - userViewOfOffer;
        let extraPicks = [];
        if (userGap > 0) {
            // CPU sweetens with picks; aim to cover ~70% of the gap (slight tilt favors CPU)
            const sweetener = _gatherPicks(cpu, userGap * 0.70, 2, g);
            if (sweetener) extraPicks = sweetener;
            else if (userGap / Math.max(1, userViewOfTarget) > 0.30) continue; // gap too big, can't sweeten
        }

        // Cap validation — both teams must still be feasible after the swap
        const targetSal = target.contract?.salary || 0;
        const offerSal = offerPlayer.contract?.salary || 0;
        if ((cpu.cap.payroll - offerSal + targetSal) > SALARY_CAP + 15) continue;
        if ((userTeam.cap.payroll - targetSal + offerSal) > SALARY_CAP + 15) continue;

        // Reason text describing why CPU is making this offer
        const reasonText = cpuMode === "win_now" ? "pushing for a title run"
            : cpuMode === "rebuilding" ? "rebuilding around young talent"
            : "retooling on the fly";

        const offerId = `offer_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
        const offer = {
            id: offerId,
            fromTeamId: cpu.id,
            fromTeamName: cpu.name,
            userPlayerIds: [target.id],
            userPickIds: [],
            otherPlayerIds: [offerPlayer.id],
            otherPickIds: extraPicks.map(pk => pk.id),
            weekCreated: week,
            expiresWeek: week + 3,
            reason: reasonText
        };

        g.pendingTradeOffers.push(offer);
        g.lastUserOfferWeek = week;

        const pickPart = extraPicks.length ? ` + ${extraPicks.length} pick${extraPicks.length > 1 ? 's' : ''}` : '';
        g.inbox.unshift({
            t: Date.now(),
            msg: `TRADE OFFER: ${cpu.name} (${reasonText}) wants ${target.name} for ${offerPlayer.name}${pickPart}. Review on Dashboard.`
        });
        return; // one offer per week
    }
}

// Try to accept a pending CPU-initiated offer. Validates that all assets still exist before executing.
export function acceptUserTradeOffer(offerId) {
    const g = STATE.game;
    g.pendingTradeOffers ??= [];
    const offer = g.pendingTradeOffers.find(o => o.id === offerId);
    if (!offer) return { success: false, msg: "Offer not found." };

    const userTeam = g.league.teams[g.userTeamIndex];
    const cpuTeam = g.league.teams.find(t => t.id === offer.fromTeamId);
    if (!userTeam || !cpuTeam) return { success: false, msg: "Team no longer exists." };

    // Validate all assets are still in place
    const userPlayers = offer.userPlayerIds.map(pid => userTeam.roster.find(p => p.id === pid));
    const otherPlayers = offer.otherPlayerIds.map(pid => cpuTeam.roster.find(p => p.id === pid));
    if (userPlayers.some(p => !p) || otherPlayers.some(p => !p)) {
        g.pendingTradeOffers = g.pendingTradeOffers.filter(o => o.id !== offerId);
        return { success: false, msg: "Offer is no longer valid (player moved)." };
    }
    const userPicks = offer.userPickIds.map(pid => (userTeam.assets?.picks || []).find(pk => pk.id === pid));
    const otherPicks = offer.otherPickIds.map(pid => (cpuTeam.assets?.picks || []).find(pk => pk.id === pid));
    if (userPicks.some(pk => !pk) || otherPicks.some(pk => !pk)) {
        g.pendingTradeOffers = g.pendingTradeOffers.filter(o => o.id !== offerId);
        return { success: false, msg: "Offer is no longer valid (pick moved)." };
    }

    // Cap and roster checks
    const userOutSal = userPlayers.reduce((s, p) => s + (p.contract?.salary || 0), 0);
    const cpuOutSal = otherPlayers.reduce((s, p) => s + (p.contract?.salary || 0), 0);
    if ((userTeam.cap.payroll - userOutSal + cpuOutSal) > SALARY_CAP + 15) {
        return { success: false, msg: "Cap would be exceeded." };
    }
    const userPostSize = userTeam.roster.length - userPlayers.length + otherPlayers.length;
    if (userPostSize > 15 || userPostSize < 5) {
        return { success: false, msg: "Roster size would be out of bounds." };
    }

    const ok = executeTrade(
        userTeam.id, cpuTeam.id,
        { players: userPlayers, picks: userPicks },
        { players: otherPlayers, picks: otherPicks }
    );
    if (!ok) return { success: false, msg: "Trade failed." };

    g.pendingTradeOffers = g.pendingTradeOffers.filter(o => o.id !== offerId);
    g.inbox.unshift({
        t: Date.now(),
        msg: `TRADE ACCEPTED: Deal with ${cpuTeam.name} completed.`
    });
    autoSave();
    return { success: true, msg: "Trade accepted." };
}

export function declineUserTradeOffer(offerId) {
    const g = STATE.game;
    g.pendingTradeOffers ??= [];
    const offer = g.pendingTradeOffers.find(o => o.id === offerId);
    g.pendingTradeOffers = g.pendingTradeOffers.filter(o => o.id !== offerId);
    if (offer) {
        g.inbox.unshift({
            t: Date.now(),
            msg: `Declined offer from ${offer.fromTeamName}.`
        });
    }
    autoSave();
    return { success: true };
}

// Collect picks from `team` totaling roughly `targetVal`, up to `maxPicks`. Returns null if can't reach 40% of target.
function _gatherPicks(team, targetVal, maxPicks, g) {
    const avail = (team.assets?.picks || [])
        .filter(pk => pk.year >= g.year)
        .map(pk => ({ pk, val: cpuPickValue(pk, g.year) }))
        .sort((a, b) => b.val - a.val);
    let covered = 0;
    const result = [];
    for (const { pk, val } of avail) {
        if (covered >= targetVal * 0.75 || result.length >= maxPicks) break;
        result.push(pk);
        covered += val;
    }
    return covered >= targetVal * 0.25 ? result : null;
}

// 1-for-1 player swap, with up to 2 picks added on one side to balance
function cpuDeal_PlayerSwap(t1, t2, mode1, mode2, g) {
    if (!t1.roster.length || !t2.roster.length) return null;
    const p1 = pickOfferPlayer(t1, mode2, t2);
    const p2 = pickOfferPlayer(t2, mode1, t1);
    if (!p1 || !p2 || p1.id === p2.id) return null;

    // Fit-adjusted: p1 going to t2 (value from t2's perspective), p2 going to t1 (value from t1's perspective)
    const v1 = cpuPlayerValueFor(p1, t2), v2 = cpuPlayerValueFor(p2, t1);
    const gap = v1 - v2, avgVal = (v1 + v2) / 2;
    if (avgVal === 0) return null;

    let t1Picks = [], t2Picks = [];
    if (Math.abs(gap) / avgVal > 0.20) {
        const addingTeam = gap > 0 ? t2 : t1;
        const picks = _gatherPicks(addingTeam, Math.abs(gap) * 0.75, 2, g);
        if (picks) {
            if (gap > 0) t2Picks = picks; else t1Picks = picks;
        } else if (Math.abs(gap) / avgVal > 0.45) {
            return null; // gap too large to do without sweetener
        }
        // gap is 20-45% and no picks available — allow the straight swap anyway
    }
    return { t1Assets: { players: [p1], picks: t1Picks }, t2Assets: { players: [p2], picks: t2Picks } };
}

// 2-for-1: one side sends 2 players whose combined value matches a single better player
function cpuDeal_TwoForOne(t1, t2, mode1, mode2, g) {
    const tryOrder = (giver2, receiver1) => {
        if (giver2.roster.length < 8 || receiver1.roster.length < 2) return null;
        const star = pickOfferPlayer(receiver1, getTeamMode(giver2, g), giver2);
        if (!star) return null;
        // Star is going to giver2 — value from giver2's perspective
        const starVal = cpuPlayerValueFor(star, giver2);
        if (starVal < 70) return null;

        // The 2 players from giver2 go to receiver1 — value from receiver1's perspective
        const candidates = [...giver2.roster]
            .filter(p => p.id !== star.id)
            .map(p => ({ p, v: cpuPlayerValueFor(p, receiver1) }))
            .sort((a, b) => b.v - a.v);

        for (let i = 0; i < Math.min(candidates.length - 1, 5); i++) {
            const a = candidates[i];
            for (let j = i + 1; j < Math.min(candidates.length, 6); j++) {
                const b = candidates[j];
                const combined = a.v + b.v;
                if (combined === 0) continue;
                if (Math.abs(combined - starVal) / Math.max(combined, starVal) <= 0.40) {
                    return giver2 === t1
                        ? { t1Assets: { players: [a.p, b.p], picks: [] }, t2Assets: { players: [star], picks: [] } }
                        : { t1Assets: { players: [star], picks: [] }, t2Assets: { players: [a.p, b.p], picks: [] } };
                }
            }
        }
        return null;
    };

    if (mode1 !== mode2) {
        const winNow = mode1 === "win_now" ? t1 : mode2 === "win_now" ? t2 : null;
        const rebuild = mode1 === "rebuilding" ? t1 : mode2 === "rebuilding" ? t2 : null;
        if (winNow && rebuild) return tryOrder(winNow, rebuild) || tryOrder(rebuild, winNow);
        // One team is retooling — try both directions
        return tryOrder(t1, t2) || tryOrder(t2, t1);
    }
    return tryOrder(t1, t2) || tryOrder(t2, t1);
}

// Rebuilding team dumps a veteran for draft picks from a win-now team
function cpuDeal_PlayerForPicks(t1, t2, mode1, mode2, g) {
    const tryDump = (seller, buyer) => {
        const dumpable = [...seller.roster]
            .filter(p => p.ovr >= 72 && p.age >= 26)
            .sort((a, b) => b.ovr - a.ovr);
        if (!dumpable.length) return null;
        const dumpPlayer = dumpable[Math.floor(Math.random() * Math.min(dumpable.length, 3))];
        // Player going from seller to buyer — value from buyer's perspective
        const pVal = cpuPlayerValueFor(dumpPlayer, buyer);
        if (pVal < 50) return null;
        const picks = _gatherPicks(buyer, pVal * 0.75, 3, g);
        if (!picks || !picks.length) return null;
        return seller === t1
            ? { t1Assets: { players: [dumpPlayer], picks: [] }, t2Assets: { players: [], picks } }
            : { t1Assets: { players: [], picks }, t2Assets: { players: [dumpPlayer], picks: [] } };
    };

    if (mode1 === "rebuilding" && mode2 === "win_now") return tryDump(t1, t2);
    if (mode2 === "rebuilding" && mode1 === "win_now") return tryDump(t2, t1);
    // Retooling teams occasionally sell veterans to win-now teams
    if (mode1 === "retooling" && mode2 === "win_now" && Math.random() < 0.15) return tryDump(t1, t2);
    if (mode2 === "retooling" && mode1 === "win_now" && Math.random() < 0.15) return tryDump(t2, t1);
    if (Math.random() < 0.25) return tryDump(t1, t2) || tryDump(t2, t1);
    return null;
}

// Buy low: win-now team targets an unhappy or demanding player at a discount
function cpuDeal_BuyLow(t1, t2, mode1, mode2, g) {
    const tryBuyLow = (buyer, seller, buyerMode) => {
        if (buyerMode !== "win_now") return null;
        // Find an unhappy or trade-demanding player on the seller's team
        const targets = [...seller.roster]
            .filter(p => p.ovr >= 75 && ((p.happiness ?? 70) < 40 || p.tradeDemand))
            .sort((a, b) => b.ovr - a.ovr);
        if (!targets.length) return null;
        const target = targets[0];
        // Target going from seller to buyer — value from buyer's perspective, then 20% discount for unhappiness
        const pVal = cpuPlayerValueFor(target, buyer) * 0.80;
        if (pVal < 60) return null;

        const isSafe = (p) => seller.roster.filter(x => x.pos === p.pos && x.id !== p.id).length >= 1;
        if (!isSafe(target)) return null;

        // Buyer offers a player + picks for the discounted target
        const offerPlayer = pickOfferPlayer(buyer, getTeamMode(seller, g), seller);
        if (!offerPlayer) return null;
        // offerPlayer going from buyer to seller — value from seller's perspective
        const offerVal = cpuPlayerValueFor(offerPlayer, seller);
        const gap = pVal - offerVal;
        let extraPicks = [];
        if (gap > 30) {
            extraPicks = _gatherPicks(buyer, gap * 0.60, 2, g) || [];
        }

        return buyer === t1
            ? { t1Assets: { players: [offerPlayer], picks: extraPicks }, t2Assets: { players: [target], picks: [] } }
            : { t1Assets: { players: [target], picks: [] }, t2Assets: { players: [offerPlayer], picks: extraPicks } };
    };
    return tryBuyLow(t1, t2, mode1) || tryBuyLow(t2, t1, mode2);
}

// Pick-for-pick: 1-for-1 close value swap, or R1 for 2xR2
function cpuDeal_PickSwap(t1, t2, g) {
    const p1s = (t1.assets?.picks || []).filter(pk => pk.year >= g.year)
        .map(pk => ({ pk, val: cpuPickValue(pk, g.year) })).sort((a, b) => b.val - a.val);
    const p2s = (t2.assets?.picks || []).filter(pk => pk.year >= g.year)
        .map(pk => ({ pk, val: cpuPickValue(pk, g.year) })).sort((a, b) => b.val - a.val);
    if (!p1s.length || !p2s.length) return null;

    // 1-for-1 swap where values are within 20%
    for (const a of p1s.slice(0, 3)) {
        for (const b of p2s.slice(0, 3)) {
            if (a.pk.id === b.pk.id) continue;
            if (Math.abs(a.val - b.val) / Math.max(a.val, b.val) <= 0.20) {
                return { t1Assets: { players: [], picks: [a.pk] }, t2Assets: { players: [], picks: [b.pk] } };
            }
        }
    }

    // R1 for 2xR2 (either direction)
    const tryR1for2R2 = (r1side, r2side, t1gives) => {
        const r1 = r1side.find(x => x.pk.round === 1);
        const r2s = r2side.filter(x => x.pk.round === 2);
        if (!r1 || r2s.length < 2) return null;
        const twoR2val = r2s[0].val + r2s[1].val;
        if (Math.abs(r1.val - twoR2val) / Math.max(r1.val, twoR2val) > 0.35) return null;
        return t1gives
            ? { t1Assets: { players: [], picks: [r1.pk] }, t2Assets: { players: [], picks: [r2s[0].pk, r2s[1].pk] } }
            : { t1Assets: { players: [], picks: [r2s[0].pk, r2s[1].pk] }, t2Assets: { players: [], picks: [r1.pk] } };
    };

    return tryR1for2R2(p1s, p2s, true) || tryR1for2R2(p2s, p1s, false);
}

// OVR with a small bump for young high-potential players, used for rotation priority
function devOvr(p) {
    let o = p.ovr;
    if (p.age <= 23 && (p.potentialGrade === "A+" || p.potentialGrade === "A")) o += 4;
    else if (p.age <= 25 && p.potentialGrade === "A+") o += 2;
    return o;
}

// Distribute `pool` minutes across `players` proportionally by devOvr, clamped to [min, max]
function assignMinutes(players, pool, min, max) {
    if (!players.length) return;
    const weights = players.map(p => Math.max(1, devOvr(p) - 50));
    const totalW = weights.reduce((s, w) => s + w, 0);
    let used = 0;
    players.forEach((p, i) => {
        p.rotation.minutes = Math.max(min, Math.min(max, Math.round(weights[i] / totalW * pool)));
        used += p.rotation.minutes;
    });
    // Correct any rounding drift on the best player
    const drift = pool - used;
    if (drift !== 0) players[0].rotation.minutes = Math.max(min, players[0].rotation.minutes + drift);
}

export function autoDistributeMinutes(team){
    const roster = team.roster || [];
    roster.forEach(p => { p.rotation = { minutes: 0, isStarter: false }; });
    if (!roster.length) return;

    const POSITIONS = ["PG","SG","SF","PF","C"];
    const usedIds = new Set();
    const starters = [];

    // Best player at each position; fill any empty slot with the best remaining player
    for (const pos of POSITIONS) {
        const cand = roster.filter(p => p.pos === pos && !usedIds.has(p.id)).sort((a,b) => b.ovr - a.ovr)[0]
                  || roster.filter(p => !usedIds.has(p.id)).sort((a,b) => b.ovr - a.ovr)[0];
        if (cand) { starters.push(cand); usedIds.add(cand.id); }
    }
    starters.forEach(p => p.rotation.isStarter = true);

    // Top 7 remaining players get bench minutes, prioritising young/high-potential
    const bench = roster
        .filter(p => !usedIds.has(p.id))
        .sort((a,b) => devOvr(b) - devOvr(a))
        .slice(0, 7);

    // 170 mins for starters (avg 34), 50 for bench (avg ~7) — total 220
    assignMinutes(starters, 170, 28, 38);
    assignMinutes(bench,    50,   4, 18);
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
    const roster = team.roster || [];
    team.cap.payroll = Number(roster.reduce((sum,p)=> sum + (p.contract?.salary || 0), 0).toFixed(1));
}

function sumSalary(players){
    return (players || []).reduce((sum, p) => sum + (p.contract?.salary || 0), 0);
}

function canCompleteTrade(teamA, teamB, assetsA, assetsB, salaryLimit = SALARY_CAP + 15){
    const aPlayers = assetsA?.players || [];
    const bPlayers = assetsB?.players || [];
    const aPostSize = teamA.roster.length - aPlayers.length + bPlayers.length;
    const bPostSize = teamB.roster.length - bPlayers.length + aPlayers.length;

    if (aPostSize > ROSTER_MAX || bPostSize > ROSTER_MAX) return false;
    if (aPostSize < 5 || bPostSize < 5) return false;

    const aPostPayroll = teamA.cap.payroll - sumSalary(aPlayers) + sumSalary(bPlayers);
    const bPostPayroll = teamB.cap.payroll - sumSalary(bPlayers) + sumSalary(aPlayers);

    if (aPostPayroll > salaryLimit || bPostPayroll > salaryLimit) return false;
    return true;
}

export function executeTrade(userTeamId, otherTeamId, userAssets, otherAssets){
    const g = STATE.game;
    const userTeam = g.league.teams.find(t => t.id === userTeamId);
    const otherTeam = g.league.teams.find(t => t.id === otherTeamId);

    if (!userTeam || !otherTeam) return false;
    if (!canCompleteTrade(userTeam, otherTeam, userAssets, otherAssets)) return false;

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
    updateTeamRating(userTeam);
    updateTeamRating(otherTeam);

    // Track user-involved trades for reputation purposes + mandate progress
    const actualUserTeamId = g.league.teams[g.userTeamIndex]?.id;
    const userInTrade = userTeamId === actualUserTeamId || otherTeamId === actualUserTeamId;
    if (userInTrade && g.gm) {
        g.gm.career.tradesExecuted = (g.gm.career.tradesExecuted || 0) + 1;

        // Determine which side the user is on (executeTrade is symmetric — caller can pass either order)
        const isUserA = userTeamId === actualUserTeamId;
        const userSent = isUserA ? userAssets.players : otherAssets.players;
        const userReceived = isUserA ? otherAssets.players : userAssets.players;

        const mandate = g.gm.activeMandate;
        if (mandate) {
            if (mandate.type === "trade_acquire" && userReceived.some(p => p.ovr >= (mandate.target || 78))) {
                mandate.acquired = true;
            } else if (mandate.type === "protect_star" && userSent.some(p => p.id === mandate.targetPlayerId)) {
                mandate.violated = true;
            }
        }
    }

    autoSave();
    return true;
}

export function releasePlayer(teamId, playerId){
    const g = STATE.game;
    const team = g.league.teams.find(t => t.id === teamId);
    if (!team) return;
    const idx = team.roster.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    const [p] = team.roster.splice(idx, 1);

    // Build a FA entry — cut players accept a slight discount to get signed quickly
    const fairValue = calculateSalary(p.ovr, p.age);
    const greed = 0.85 + Math.random() * 0.15;
    const prestigeMult = calcAwardPrestige(p);
    const faEntry = {
        ...p,
        ask: capPlayerSalary(fairValue * greed * prestigeMult, p.ovr, p.awards),
        yearsAsk: Math.max(1, Math.min(3, Math.floor(Math.random() * 3) + 1)),
        signedByTeamId: null,
        cutByTeamId: team.id,
        cutByTeamName: team.name,
        contract: null,
        offers: []
    };

    if (g.phase === PHASES.FREE_AGENCY && g.offseason.freeAgents?.pool) {
        // FA phase: drop into pool and generate CPU offers immediately
        g.offseason.freeAgents.pool.push(faEntry);
        g.offseason.freeAgents.pool.sort((a, b) => b.ovr - a.ovr);
        const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
        const teamNeeds = buildTeamNeeds(cpuTeams);
        generateOffersForPlayer(g, faEntry, cpuTeams, teamNeeds);
    } else if (g.phase === PHASES.REGULAR || g.phase === PHASES.DRAFT) {
        // Regular-season and post-draft cuts are available once the season begins.
        g.midseasonFaPool ??= [];
        g.midseasonFaPool.push(faEntry);
        g.midseasonFaPool.sort((a, b) => b.ovr - a.ovr);
    } else {
        g.offseason.expiring ??= [];
        g.offseason.expiring.push(faEntry);
    }

    recalcPayroll(team);
    updateTeamRating(team);
    autoSave();
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

export function signMidseasonFreeAgent(playerId, salary, years) {
    const g = STATE.game;
    const pool = g.midseasonFaPool || [];
    const idx = pool.findIndex(p => p.id === playerId);
    if (idx === -1) return { success: false, msg: "Player not found." };

    const p = pool[idx];
    salary = capPlayerSalary(salary, p.ovr, p.awards);
    const userTeam = g.league.teams[g.userTeamIndex];
    const capSpace = userTeam.cap.cap - userTeam.cap.payroll;

    if (capSpace < salary) return { success: false, msg: `Not enough cap space. You have $${capSpace.toFixed(1)}M available.` };
    if (userTeam.roster.length >= 15) return { success: false, msg: "Roster is full (15 players max)." };

    // Remove from pool and sign
    pool.splice(idx, 1);
    const signed = { ...p, contract: { salary, years }, stats: { gp:0, pts:0, reb:0, ast:0 }, rotation: { minutes:0, isStarter:false }, signedByTeamId: userTeam.id };
    signed.happiness = Math.min(100, (signed.happiness ?? 70) + 5);
    userTeam.roster.push(signed);
    recalcPayroll(userTeam);
    autoDistributeMinutes(userTeam);
    updateTeamRating(userTeam);
    autoSave();
    return { success: true, msg: `Signed ${p.name} for $${salary}M / ${years} yr${years !== 1 ? 's' : ''}.` };
}

export function isTradeWindowOpen(){
  const g = STATE.game;
  if (g.phase === PHASES.PLAYOFFS) return false;
  if (g.phase === PHASES.REGULAR && g.week > TRADE_DEADLINE_WEEK) return false;
  return true;
}

export function advanceWeek(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;
  const capIssue = getUserRosterRuleIssue(g);
  if (capIssue) {
      g.inbox.unshift({ t: Date.now(), msg: capIssue.message });
      autoSave();
      return;
  }
  
  // NOTE: If week is > seasonWeeks, we shouldn't sim games. 
  // It means we are at the "End of Season" checkpoint waiting for user to start playoffs.
  if (g.week <= g.seasonWeeks) {
      simWeekGames(g);
      checkTradeDemands(g);
      if (g.week <= TRADE_DEADLINE_WEEK) {
          simCpuTrades(g, g.week);
          // Guarantee minimum trades: if behind pace, run extra attempts
          const tradeCount = g.cpuSeasonTradeCount || 0;
          if ((g.week === 9 && tradeCount < 2) || (g.week === 14 && tradeCount < 4)) {
              simCpuTrades(g, g.week);
              simCpuTrades(g, g.week);
          }
          // CPU teams may send the user a trade offer this week (throttled internally)
          simCpuOffersToUser(g, g.week);
      }
      // Extensions happen at multiple checkpoints — early-season (week 5) and mid-season (week 14)
      // so teams can react to evolving cap situations and roster context, not just one snapshot.
      if (g.week === 5 || g.week === 14) simCpuExtensions(g);
      // Owner may issue a mid-season mandate at week 5 (only one per season)
      if (g.week === 5) generateMandate(g);
      expireIntlFoundProspects(g);

      // Trade deadline buzz notifications
      if (g.week === 15) {
          g.inbox.unshift({ t: Date.now(), msg: `TRADE DEADLINE: 3 weeks remaining to make deals. Deadline is Week ${TRADE_DEADLINE_WEEK}.` });
      } else if (g.week === 17) {
          g.inbox.unshift({ t: Date.now(), msg: `TRADE DEADLINE: Final week! All trades must be completed before Week ${TRADE_DEADLINE_WEEK} ends.` });
      }
  }

  g.week += 1;
  g.hours.banked = clamp(g.hours.banked + g.hours.available, 0, g.hours.bankMax);
  g.hours.available = HOURS_PER_WEEK;

  if (g.week === g.seasonWeeks + 1){
    g.inbox.unshift({ t: Date.now(), msg: "Regular season complete. All-Stars announced! Start Playoffs." });
  }

  if (g.inbox.length > 50) g.inbox.length = 50;
  autoSave();
}

function expireIntlFoundProspects(g){
  const found = g.scouting.intlFoundWeekById || {};
  const nowWeek = g.week;
  const keep = [];
  for (const p of g.scouting.intlPool){
    if (p.declared) { keep.push(p); continue; }
    const fw = found[p.id];
    if (!fw) { keep.push(p); continue; }
    if ((nowWeek - fw) >= 4){
      g.scouting.scoutedIntlIds = g.scouting.scoutedIntlIds.filter(x => x !== p.id);
      delete found[p.id];
      continue;
    }
    keep.push(p);
  }
  g.scouting.intlPool = keep;
  g.scouting.intlFoundWeekById = found;
}

function generateWeeklySchedule(teamsOrIds, weeks){
  const teams = teamsOrIds.map(t => typeof t === "string"
    ? { id: t, conference: null }
    : { id: t.id, conference: t.conference || null }
  );
  const ids = teams.map(t => t.id);
  const homeCounts = Object.fromEntries(ids.map(id => [id, 0]));
  const rounds = [];

  const shuffledIds = ids.slice();
  shuffle(shuffledIds);
  const allRounds = makeRoundRobinRounds(shuffledIds);
  rounds.push(...allRounds);

  const byConference = new Map();
  for (const t of teams){
    const key = t.conference || "LEAGUE";
    if (!byConference.has(key)) byConference.set(key, []);
    byConference.get(key).push(t.id);
  }

  const extraRoundsNeeded = Math.max(0, (weeks * 2) - rounds.length);
  const confRoundSets = [...byConference.values()].map(confIds => {
    const shuffledConfIds = confIds.slice();
    shuffle(shuffledConfIds);
    return makeRoundRobinRoundsWithByes(shuffledConfIds);
  });
  for (let r=0; r<extraRoundsNeeded; r++){
    const combined = [];
    for (const confRounds of confRoundSets){
      const confRound = confRounds[r % Math.max(1, confRounds.length)];
      combined.push(...(confRound?.games || []));
    }
    const byes = [];
    for (const confRounds of confRoundSets){
      const confRound = confRounds[r % Math.max(1, confRounds.length)];
      byes.push(...(confRound?.byes || []));
    }
    shuffle(byes);
    for (let i=0; i<byes.length-1; i+=2){
      combined.push([byes[i], byes[i+1]]);
    }
    rounds.push(combined);
  }

  const scheduledRounds = rounds.slice(0, weeks * 2).map(round =>
    round.map(([aId, bId]) => assignHomeAway(aId, bId, homeCounts))
  );

  const schedule = [];
  for (let w=1; w<=weeks; w++){
    const games = [
      ...(scheduledRounds[(w - 1) * 2] || []),
      ...(scheduledRounds[(w - 1) * 2 + 1] || [])
    ];
    schedule.push({ week:w, games });
  }
  return schedule;
}

function makeRoundRobinRounds(ids){
  return makeRoundRobinRoundsWithByes(ids).map(r => r.games);
}

function makeRoundRobinRoundsWithByes(ids){
  const list = ids.slice();
  if (list.length % 2 === 1) list.push(null);
  const rounds = [];
  const n = list.length;
  for (let r=0; r<n-1; r++){
    const games = [];
    const byes = [];
    for (let i=0; i<n/2; i++){
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) games.push([a, b]);
      else if (a || b) byes.push(a || b);
    }
    rounds.push({ games, byes });
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

function assignHomeAway(aId, bId, homeCounts){
  const aHomeNeed = homeCounts[aId] || 0;
  const bHomeNeed = homeCounts[bId] || 0;
  const aIsHome = aHomeNeed < bHomeNeed || (aHomeNeed === bHomeNeed && Math.random() < 0.5);
  const homeId = aIsHome ? aId : bId;
  const awayId = aIsHome ? bId : aId;
  homeCounts[homeId] = (homeCounts[homeId] || 0) + 1;
  return { homeId, awayId };
}

function shuffle(a){
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// Derive a specific reason for a trade demand based on the player's context.
// Returns a short string describing the dominant grievance; falls back to a generic line.
function deriveTradeDemandReason(p, team, g) {
    const mins = p.rotation?.minutes ?? 0;

    // 1. Buried behind a younger teammate at same position who gets more minutes
    const youngerStealing = team.roster.find(r =>
        r.id !== p.id && r.pos === p.pos && r.age < p.age - 1 &&
        (r.rotation?.minutes ?? 0) > mins + 4
    );
    if (youngerStealing) {
        return `losing minutes to ${youngerStealing.name} (${youngerStealing.age}yo ${youngerStealing.pos})`;
    }

    // 2. Behind a clearly better star at same position
    const starAhead = team.roster.find(r =>
        r.id !== p.id && r.pos === p.pos && r.ovr >= p.ovr + 6 &&
        (r.rotation?.minutes ?? 0) > mins
    );
    if (starAhead) {
        return `stuck behind ${starAhead.name} (OVR ${starAhead.ovr})`;
    }

    // 3. Almost no role
    if (mins > 0 && mins < 14) {
        return `frustrated with limited minutes (${mins}/game)`;
    }
    if (mins === 0) {
        return `not in the rotation at all`;
    }

    // 4. Team is losing
    const games = (team.wins || 0) + (team.losses || 0);
    if (games >= 6 && team.losses > team.wins + 4) {
        return `tired of losing (${team.wins}-${team.losses})`;
    }

    // 5. Veteran on a rebuild
    if (p.age >= 30 && getTeamMode(team, g) === "rebuilding") {
        return `veteran wants a contender (team is rebuilding)`;
    }

    // 6. Generic
    return `wants a fresh start`;
}

function checkTradeDemands(g) {
    if (g.tradeDemandChecked) return;
    if (g.week < 8) return; // give players time to settle in
    g.tradeDemandChecked = true;

    const userTeamId = g.league.teams[g.userTeamIndex].id;

    for (const team of g.league.teams) {
        for (const p of team.roster) {
            const isStarUnhappy = p.ovr >= 80 && (p.happiness ?? 70) < 35;
            const isGoodPlayerMiserable = p.ovr >= 74 && (p.happiness ?? 70) < 20;
            if (!isStarUnhappy && !isGoodPlayerMiserable) continue;
            if (p.tradeDemand) continue; // already demanding

            p.tradeDemand = true;
            const reason = deriveTradeDemandReason(p, team, g);
            p.tradeDemandReason = reason;

            if (team.id === userTeamId) {
                g.inbox.unshift({ t: Date.now(), msg: `TRADE DEMAND: ${p.name} (OVR ${p.ovr}) wants out — ${reason}.` });
            } else {
                g.inbox.unshift({ t: Date.now(), msg: `TRADE DEMAND: ${p.name} (${team.name}, OVR ${p.ovr}) — ${reason}.` });
            }
        }
    }
}

function simWeekGames(g){
  const wk = g.week;
  const bundle = g.schedule.find(x => x.week === wk);
  if (!bundle) return;

  const userTeamId = g.league.teams[g.userTeamIndex].id;

  // Track biggest blowout this week for "around the league" recap
  let weeklyTopBlowout = null;

  for (const game of bundle.games){
    const hasStoredVenue = !!game.homeId;
    const aId = game.homeId || game[0];
    const bId = game.awayId || game[1];
    const A = g.league.teams.find(t => t.id === aId);
    const B = g.league.teams.find(t => t.id === bId);
    if (!A || !B) continue;

    const statsA = calcTeamPerformance(A);
    const statsB = calcTeamPerformance(B);

    const varA = 0.9 + Math.random() * 0.2;
    const varB = 0.9 + Math.random() * 0.2;
    const homeBoost = 1.05;
    const aIsHome = hasStoredVenue ? true : Math.random() < 0.5;

    let pointsA = statsA.offPoints * varA * (aIsHome ? homeBoost : 1.0);
    let pointsB = statsB.offPoints * varB * (aIsHome ? 1.0 : homeBoost);

    const defenseFactorA = (statsA.defRating - 75) / 100;
    const defenseFactorB = (statsB.defRating - 75) / 100;

    let finalScoreA = Math.round(pointsA * (1 - defenseFactorB));
    let finalScoreB = Math.round(pointsB * (1 - defenseFactorA));

    while (finalScoreA === finalScoreB) {
        finalScoreA += Math.floor(Math.random() * 4) + 1;
        finalScoreB += Math.floor(Math.random() * 4) + 1;
    }

    const aWin = finalScoreA > finalScoreB;

    if (aWin){ A.wins += 1; B.losses += 1; }
    else { B.wins += 1; A.losses += 1; }

    // Momentum: win streaks slightly boost performance, losing streaks hurt
    A.momentum = Math.max(-3, Math.min(3, (A.momentum || 0) + (aWin ? 0.5 : -0.5)));
    B.momentum = Math.max(-3, Math.min(3, (B.momentum || 0) + (aWin ? -0.5 : 0.5)));

    bumpHappiness(A, aWin ? +1 : -1);
    bumpHappiness(B, aWin ? -1 : +1);

    if (A.id === userTeamId || B.id === userTeamId) {
        const userWon = (A.id === userTeamId && aWin) || (B.id === userTeamId && !aWin);
        const opponent = A.id === userTeamId ? B : A;
        const userScore = A.id === userTeamId ? finalScoreA : finalScoreB;
        const opponentScore = A.id === userTeamId ? finalScoreB : finalScoreA;
        const scoreStr = `${userScore}-${opponentScore}`;
        const userIsHome = A.id === userTeamId ? aIsHome : !aIsHome;
        const venue = userIsHome ? "vs" : "at";

        g.inbox.unshift({
            t: Date.now(),
            msg: `Week ${g.week}: ${userWon ? "WON" : "LOST"} ${venue} ${opponent.name} (${scoreStr})`
        });
    }

    // Track the largest margin of the week (skip user games — those already have their own line)
    const margin = Math.abs(finalScoreA - finalScoreB);
    if (A.id !== userTeamId && B.id !== userTeamId &&
        margin >= 15 && (!weeklyTopBlowout || margin > weeklyTopBlowout.margin)) {
        weeklyTopBlowout = {
            margin,
            winner: aWin ? A.name : B.name,
            loser: aWin ? B.name : A.name,
            score: `${Math.max(finalScoreA, finalScoreB)}-${Math.min(finalScoreA, finalScoreB)}`
        };
    }
  }

  // Around-the-league spotlight — best individual game performance + biggest blowout
  postAroundTheLeague(g, weeklyTopBlowout);
}

// Emit a 1-2 line "around the league" inbox entry summarizing the week's headline performance.
// Reads p.lastGamePts which is set during calcTeamPerformance for each player that played this week.
function postAroundTheLeague(g, blowout) {
    const userTeamId = g.league.teams[g.userTeamIndex].id;
    let topScorer = null;
    let topTeamName = "";
    for (const t of g.league.teams) {
        for (const p of t.roster) {
            const pts = p.lastGamePts || 0;
            if (pts > 0 && (!topScorer || pts > topScorer.pts)) {
                topScorer = { name: p.name, pts: Math.round(pts), team: t.name, isUser: t.id === userTeamId };
                topTeamName = t.name;
            }
        }
    }

    const lines = [];
    if (topScorer && topScorer.pts >= 25) {
        const tag = topScorer.isUser ? "your" : topScorer.team;
        lines.push(`${topScorer.name} (${tag}) dropped ${topScorer.pts} this week`);
    }
    if (blowout) {
        lines.push(`${blowout.winner} blew out ${blowout.loser} ${blowout.score}`);
    }
    if (!lines.length) return;

    g.inbox.unshift({ t: Date.now(), msg: `AROUND THE LEAGUE: ${lines.join(" · ")}.` });
}

function calcTeamPerformance(team){
  const roster = team.roster || [];
  let totalOffPoints = 0;
  let totalDefSum = 0;
  let totalMinutes = 0;

  for (const p of roster){
    p.off ??= p.ovr;
    p.def ??= p.ovr;
    p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
    p.rotation ??= { minutes: 0, isStarter: false };
    p.lastGamePts = 0; // reset before recording this game

    const mins = p.rotation.minutes;
    if (mins <= 0) continue;

    const usage = mins / 28.0;
    const gameVar = 0.8 + Math.random() * 0.4;
    // Happiness shifts performance: 70 is neutral, 0 = -15%, 100 = +10%
    const happinessMult = clamp(1.0 + ((p.happiness ?? 70) - 70) * 0.002, 0.85, 1.10);
    const ptsBase = Math.max(0, (p.off - 50));
    const pts = clamp(ptsBase * 0.6 * usage * gameVar * happinessMult, 0, 60);

    p.stats.gp += 1;
    p.stats.pts += pts;
    p.stats.reb += (p.pos==="C"||p.pos==="PF" ? 0.35 : 0.12) * ptsBase * usage;
    p.stats.ast += (p.pos==="PG" ? 0.4 : 0.1) * ptsBase * usage;
    p.lastGamePts = pts;

    totalOffPoints += pts;
    totalDefSum += (p.def * mins * happinessMult);
    totalMinutes += mins;
  }

  const defRating = totalMinutes > 0 ? (totalDefSum / totalMinutes) : 60;
  const momentumMult = 1.0 + ((team.momentum || 0) * 0.01); // ±3% max
  return { offPoints: totalOffPoints * momentumMult, defRating };
}

function bumpHappiness(team, delta){
  for (const p of (team.roster || [])){
    p.happiness = clamp((p.happiness ?? 70) + delta, 0, 100);
  }
}

export function startPlayoffs(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;

  // Clear any pending CPU-to-user trade offers — trade window is closed in playoffs
  g.pendingTradeOffers = [];

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
  autoSave();
}

function _simOneGame(s, teamA, teamB){
  s.games ??= [];
  const gameNum = s.aWins + s.bWins + 1;
  const statsA = calcTeamPerformance(teamA);
  const statsB = calcTeamPerformance(teamB);

  const homeAdvA = [1,2,5,7].includes(gameNum) ? 1.05 : 1.0;
  const homeAdvB = [1,2,5,7].includes(gameNum) ? 1.0 : 1.05;
  const varA = 0.9 + Math.random() * 0.2;
  const varB = 0.9 + Math.random() * 0.2;

  const defFactA = (statsA.defRating - 75) / 100;
  const defFactB = (statsB.defRating - 75) / 100;

  let scoreA = Math.round(statsA.offPoints * varA * homeAdvA * (1 - defFactB));
  let scoreB = Math.round(statsB.offPoints * varB * homeAdvB * (1 - defFactA));
  while (scoreA === scoreB){
    scoreA += Math.floor(Math.random() * 4) + 1;
    scoreB += Math.floor(Math.random() * 4) + 1;
  }

  if (scoreA > scoreB) s.aWins++; else s.bWins++;
  s.games.push({ gameNum, scoreA, scoreB });

  if (s.aWins === 4 || s.bWins === 4){
    s.done = true;
    s.winner = s.aWins === 4 ? s.a : s.b;
  }
}

function _advancePlayoffRound(g, p, allSeries){
  if (p.round === 4){
    p.championTeamId = allSeries[0].winner;
    finalizeSeasonAndLogHistory({ championTeamId: p.championTeamId, userPlayoffFinish: "Playoffs" });
    startFreeAgency();
  } else {
    p.round++;
    generateNextRoundMatchups(g);
  }
}

export function simPlayoffGame(){
  const g = STATE.game;
  if (g.phase !== PHASES.PLAYOFFS) return;
  const p = g.playoffs;
  const rObj = p.rounds[p.round - 1];
  if (!rObj) return;

  const allSeries = [...(rObj.east||[]), ...(rObj.west||[]), ...(rObj.finals||[])];
  if (allSeries.every(s => s.done)) return;

  for (const s of allSeries){
    if (s.done) continue;
    const teamA = g.league.teams.find(t => t.id === s.a);
    const teamB = g.league.teams.find(t => t.id === s.b);
    if (teamA && teamB) _simOneGame(s, teamA, teamB);
  }

  if (allSeries.every(s => s.done)) _advancePlayoffRound(g, p, allSeries);
  autoSave();
}

export function simPlayoffRound(){
  const g = STATE.game;
  if (g.phase !== PHASES.PLAYOFFS) return;
  const p = g.playoffs;
  const rObj = p.rounds[p.round - 1];
  if (!rObj) return;

  const allSeries = [...(rObj.east||[]), ...(rObj.west||[]), ...(rObj.finals||[])];

  for (const s of allSeries){
    if (s.done) continue;
    const teamA = g.league.teams.find(t => t.id === s.a);
    const teamB = g.league.teams.find(t => t.id === s.b);
    while (s.aWins < 4 && s.bWins < 4) _simOneGame(s, teamA, teamB);
    s.done = true;
    s.winner = s.aWins === 4 ? s.a : s.b;
  }

  _advancePlayoffRound(g, p, allSeries);
  autoSave();
}

function generateNextRoundMatchups(g){
    const p = g.playoffs;
    const rNum = p.round;
    const makeSeries = (idA, idB) => ({ a: idA, b: idB, aWins:0, bWins:0, done:false, winner:null, games:[] });

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

export function startDraft(){
  const g = STATE.game;
  g.phase = PHASES.DRAFT;

  normalizeInternationalDraftFlags(g);
  const autoDeclaredIntlCount = autoDeclareInternationalProspects(g);

  // Carry unsigned FA pool players into the midseason pool for next season
  const unsigned = (g.offseason.freeAgents?.pool || []).filter(p => !p.signedByTeamId);
  g.midseasonFaPool = unsigned.map(p => ({ ...p, offers: [] }));

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
    ...g.scouting.intlPool.filter(p => isInternationalDraftEligibleForPool(p, g))
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

  const intlMsg = autoDeclaredIntlCount
    ? ` ${autoDeclaredIntlCount} international prospect(s) publicly entered the draft.`
    : "";
  g.inbox.unshift({ t: Date.now(), msg: `Draft started (2 rounds).${intlMsg}` });
  autoSave();
}

export function getUserRosterRuleIssue(g = STATE.game) {
    const userTeam = g?.league?.teams?.[g.userTeamIndex];
    if (!userTeam) return null;
    recalcPayroll(userTeam);

    if ((userTeam.roster?.length || 0) > ROSTER_MAX) {
        return {
            type: "roster_max",
            message: `ROSTER LIMIT: You have ${userTeam.roster.length}/${ROSTER_MAX} players. Cut or trade a player before advancing.`
        };
    }

    if ((userTeam.cap?.payroll || 0) > SOFT_CAP_LIMIT) {
        return {
            type: "soft_cap",
            message: `PAYROLL LIMIT: You are at $${userTeam.cap.payroll.toFixed(1)}M. Get under the $${SOFT_CAP_LIMIT}M soft cap before advancing.`
        };
    }

    return null;
}

function normalizeInternationalDraftFlags(g){
  for (const p of (g.scouting?.intlPool || [])){
    if (p.declared && !p.visibility){
      p.visibility = "private";
      p.commitOwner = "user";
      p.commitYear = g.year;
    }
  }
}

function autoDeclareInternationalProspects(g){
  const eligible = (g.scouting?.intlPool || []).filter(p =>
    p.pool === "INTL" &&
    !p.declared &&
    p.visibility !== "private"
  );
  if (!eligible.length) return 0;

  const target = Math.min(eligible.length, 5 + Math.floor(Math.random() * 16));
  const ranked = eligible
    .map(p => ({
      p,
      score: p.currentOVR + Math.random() * 20 + (p.age <= 20 ? 2 : 0)
    }))
    .sort((a,b) => b.score - a.score);

  for (const { p } of ranked.slice(0, target)){
    p.declared = true;
    p.visibility = "public";
    p.autoDeclared = true;
    p.commitOwner = null;
    p.commitYear = g.year;
  }

  return target;
}

function isInternationalDraftEligibleForPool(p, g){
  if (!p.declared) return false;
  if (p.visibility === "private"){
    return p.commitOwner === "user" && p.commitYear === g.year;
  }
  return true;
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

export function advanceToNextYear(){
  const g = STATE.game;
  const carriedAvailablePlayers = new Map();
  for (const p of (g.midseasonFaPool || [])) {
    if (!p.signedByTeamId) carriedAvailablePlayers.set(p.id, { ...p, offers: [] });
  }
  for (const p of (g.offseason.freeAgents?.pool || [])) {
    if (!p.signedByTeamId && !carriedAvailablePlayers.has(p.id)) {
      carriedAvailablePlayers.set(p.id, { ...p, offers: [] });
    }
  }

  g.year += 1;
  g.week = 1;
  g.phase = PHASES.REGULAR;
  g.hours.available = HOURS_PER_WEEK;
  g.hours.banked = 0;
  g.pendingTradeOffers = [];
  g.lastUserOfferWeek = 0;
  
  g.scouting.ncaa = generateNCAAProspects({ year: g.year, count: 100, seed: "ncaa" });
  g.scouting.intlPool = generateInternationalPool({ year: g.year, count: 125, seed: "intl" });
  g.scouting.scoutedNCAAIds = [];
  g.scouting.scoutedIntlIds = [];
  g.scouting.intlFoundWeekById = {};
  g.scouting.intlLocation = null;

  for (const t of g.league.teams){
    if (t.assets && t.assets.picks) {
        t.assets.picks = t.assets.picks.filter(p => p.year >= g.year);
    }

    if (!t.assets) t.assets = { picks: [] };
    const newYear = g.year + 3;
    t.assets.picks.push({ id: `pick_${t.id}_${newYear}_1`, originalOwnerId: t.id, year: newYear, round: 1 });
    t.assets.picks.push({ id: `pick_${t.id}_${newYear}_2`, originalOwnerId: t.id, year: newYear, round: 2 });
  }

  for (const t of g.league.teams){
    t.wins = 0; t.losses = 0;
    t.momentum = 0;
    for (const p of (t.roster || [])){
      p.stats = { gp:0, pts:0, reb:0, ast:0 };
    }
    autoDistributeMinutes(t);
    updateTeamRating(t);
  }
  g.tradeDemandChecked = false;

  g.schedule = generateWeeklySchedule(g.league.teams, SEASON_WEEKS);
  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;
  g.offseason.expiring = [];
  g.tradeDemandChecked = false;
  g.cpuSeasonTradeCount = 0;
  g.midseasonFaPool = [...carriedAvailablePlayers.values()].sort((a, b) => b.ovr - a.ovr);
  g.lastSeasonRecap = null;

  // Reset preseason expectation based on the refreshed roster.
  // Skip if GM is fired — career is effectively over, no point projecting goals.
  if (g.gm && g.gm.status === "active") {
    const userTeam = g.league.teams[g.userTeamIndex];
    g.gm.expectation = deriveAdjustedExpectation(userTeam, g);
    g.inbox.unshift({
      t: Date.now(),
      msg: `OWNER GOAL (${g.year}): ${g.gm.expectation.description} (target: ${g.gm.expectation.winTarget} wins).`
    });
  }

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
  const rosterIssue = getUserRosterRuleIssue(g);
  if (rosterIssue) {
    g.inbox.unshift({ t: Date.now(), msg: rosterIssue.message });
  }
  autoSave();
}

function computeStatsLeaders(g, topN = 5) {
    const all = [];
    for (const t of g.league.teams) {
        for (const p of (t.roster || [])) {
            const gp = p.stats?.gp || 0;
            if (gp < 5) continue;
            all.push({
                name: p.name, team: t.name, pos: p.pos, gp,
                ppg: Number((p.stats.pts / gp).toFixed(1)),
                rpg: Number((p.stats.reb / gp).toFixed(1)),
                apg: Number((p.stats.ast / gp).toFixed(1))
            });
        }
    }
    const top = (key) => [...all].sort((a, b) => b[key] - a[key]).slice(0, topN);
    return { ppg: top('ppg'), rpg: top('rpg'), apg: top('apg') };
}

export function finalizeSeasonAndLogHistory({ championTeamId, userPlayoffFinish }){
  const g = STATE.game;

  // Capture stats leaders before roster processing clears/resets anything
  const statsLeaders = computeStatsLeaders(g);

  // Snapshot user payroll BEFORE processEndSeasonRoster expires contracts — fair check for cut_payroll mandate
  const userTeamPreroster = g.league.teams[g.userTeamIndex];
  const userPayrollSnapshot = userTeamPreroster?.cap?.payroll || 0;

  processEndSeasonRoster(g);

  g.history ??= [];
  const userTeam = g.league.teams[g.userTeamIndex];
  const championTeam = g.league.teams.find(t => t.id === championTeamId);
  
  // FIX: calculate awards and push them to the player arrays
  const awards = computeAwards(g);

  let userFinish = "Didn't Make";
  const userTeamId = userTeam.id;
  const p = g.playoffs;

  if (p.eastSeeds.includes(userTeamId) || p.westSeeds.includes(userTeamId)) {
      userFinish = "Round 1"; 
      for (const r of p.rounds) {
          const allSeries = [...(r.east||[]), ...(r.west||[]), ...(r.finals||[])];
          const userSeries = allSeries.find(s => s.a === userTeamId || s.b === userTeamId);
          
          if (userSeries) {
              if (userSeries.winner === userTeamId) {
                  if (r.name === "Round 1") userFinish = "Semis";
                  else if (r.name === "Semis") userFinish = "Conf. Finals";
                  else if (r.name === "Conf. Finals") userFinish = "Finals";
                  else if (r.name === "Finals") userFinish = "Champion";
              } else {
                  userFinish = r.name;
                  break; 
              }
          }
      }
  }

  const allTeamRecords = g.league.teams.map(t => ({
      id: t.id,
      name: t.name,
      conference: t.conference,
      wins: t.wins,
      losses: t.losses,
      rating: t.rating,
      madePlayoffs: g.playoffs
          ? (g.playoffs.eastSeeds.includes(t.id) || g.playoffs.westSeeds.includes(t.id))
          : false
  }));

  g.history.push({
    year: g.year,
    userTeamId: userTeam.id,
    userTeamName: userTeam.name,
    userTeamRating: userTeam.rating,
    userRecord: { wins: userTeam.wins, losses: userTeam.losses },
    userPlayoffFinish: userFinish,
    championTeam: championTeam?.name || "—",
    awards,
    allTeamRecords,
    statsLeaders,
    developmentReport: g.lastDevelopmentReport || []
  });

  g.lastSeasonRecap = {
    year: g.year,
    champion: championTeam?.name || "—",
    userRecord: `${userTeam.wins}-${userTeam.losses}`,
    userFinish,
    awards,
    statsLeaders,
    developmentReport: g.lastDevelopmentReport || [],
    viewed: false
  };

  // Resolve any active mandate first so its approval delta flows into the review verdict.
  // We pass the pre-roster-processing payroll snapshot so cut_payroll isn't trivially passed by expirations.
  resolveMandate(g, { payrollSnapshot: userPayrollSnapshot });

  // Owner reviews the GM. Updates contract / fires / extends and posts a notification.
  const review = conductAnnualReview(g, userFinish);
  if (review) {
    if (review.action === "fired") {
      g.inbox.unshift({ t: Date.now(), msg: `OWNER REVIEW: You have been fired. ${review.ownerMessage}` });
    } else {
      g.inbox.unshift({ t: Date.now(), msg: `OWNER REVIEW: ${review.ownerMessage} See the Year-End Review on the Dashboard.` });
    }
  }

  // Job market — other teams may fire their GMs and reach out to the user
  buildJobMarket(g);

  g.inbox.unshift({ t: Date.now(), msg: `Season ${g.year} awards saved to History.` });
  autoSave();
}

// In-season MVP race — same scoring formula as the end-of-year award.
// Returns top N candidates with their score, ppg, team, etc. Empty list if no one has played.
export function computeMVPRace(g, limit = 5) {
  const all = [];
  for (const t of g.league.teams) {
    for (const p of (t.roster || [])) {
      const gp = p.stats?.gp || 0;
      if (gp < 3) continue; // need a meaningful sample
      const ptsPg = p.stats.pts / gp;
      const astPg = p.stats.ast / gp;
      const rebPg = p.stats.reb / gp;
      const winsBoost = (t.wins || 0) * 0.10;
      const ovrBoost = (p.ovr || 70) * 0.25;
      const score = ptsPg * 1.15 + astPg * 0.65 + winsBoost + ovrBoost;
      all.push({
        playerId: p.id,
        name: p.name,
        teamName: t.name,
        teamId: t.id,
        pos: p.pos,
        ovr: p.ovr,
        ptsPg: Math.round(ptsPg * 10) / 10,
        astPg: Math.round(astPg * 10) / 10,
        rebPg: Math.round(rebPg * 10) / 10,
        score
      });
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
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
  
  let rookies = played.filter(x => x.player.rookieYear === g.year);
  if (rookies.length === 0) {
      rookies = all.filter(x => x.player.rookieYear === g.year);
  }
  const roy = topBy(rookies, x => x.ptsPg * 1.0 + x.astPg * 0.45 + (x.player.ovr || 70) * 0.2);

  // FIX: Apply the awards directly to the players
  if (mvp) { mvp.player.awards ??= []; mvp.player.awards.push(`${g.year} MVP`); }
  if (opoy) { opoy.player.awards ??= []; opoy.player.awards.push(`${g.year} OPOY`); }
  if (dpoy) { dpoy.player.awards ??= []; dpoy.player.awards.push(`${g.year} DPOY`); }
  if (roy) { roy.player.awards ??= []; roy.player.awards.push(`${g.year} ROY`); }

  return {
    MVP: packAward(mvp),
    OPOY: packAward(opoy),
    DPOY: packAward(dpoy),
    ROY: roy ? packAward(roy) : { player: "None", team: "-" } 
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

function updateTeamRating(team) {
    if (!team.roster || team.roster.length === 0) {
        team.rating = 60;
        return;
    }
    const top8 = team.roster.slice().sort((a,b) => b.ovr - a.ovr).slice(0, 8);
    const total = top8.reduce((sum, p) => sum + p.ovr, 0);
    team.rating = Math.round(total / Math.max(1, top8.length));
}
