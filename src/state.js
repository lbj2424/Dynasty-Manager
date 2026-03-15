import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { generateFreeAgents } from "./gen/freeAgents.js";
import { generateTeamRoster, calculateSalary } from "./gen/players.js";
import {
  HOURS_BANK_MAX,
  HOURS_PER_WEEK,
  SEASON_WEEKS,
  TRADE_DEADLINE_WEEK,
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
        }
    }

    // Migrate existing playoff series to include games array
    for (const round of (STATE.game.playoffs?.rounds || [])) {
      for (const s of [...(round.east||[]), ...(round.west||[]), ...(round.finals||[])]) {
        s.games ??= [];
      }
    }

    STATE.game.tradeDemandChecked ??= false;

    STATE.game.league?.teams?.forEach(t => {
      t.wins ??= 0; t.losses ??= 0;
      t.assets ??= { picks: generateFuturePicks(t.id, STATE.game.year) };
      t.cap ??= { cap: SALARY_CAP, payroll: 0 };
      t.momentum ??= 0;

      let needsRotationFix = false;
      t.roster?.forEach(p => {
        p.stats ??= { gp:0, pts:0, reb:0, ast:0 };
        p.careerStats ??= []; 
        p.awards ??= []; // FIX: Initialize awards array
        p.happiness ??= 70;
        p.age ??= 24; 
        
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
    t.cap.cap ??= SALARY_CAP;

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

  const schedule = generateWeeklySchedule(league.teams.map(t => t.id), SEASON_WEEKS, 4);

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
        intlPool: generateInternationalPool({ year, count: 100, seed: "intl" }),
        scoutedNCAAIds: [], scoutedIntlIds: [], intlFoundWeekById: {}, intlLocation: null
      },
      playoffs: null,
      offseason: { freeAgents: null, draft: null, expiring: [] },
      inbox: [],
      history: [],
      retiredPlayers: []
    }
  };
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
    round: 1
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

function generateInitialOffers(g){
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    const teamNeeds = {}; 
    for (const t of cpuTeams) {
        const counts = { PG:0, SG:0, SF:0, PF:0, C:0 };
        const bestAtPos = { PG:0, SG:0, SF:0, PF:0, C:0 };
        for (const p of t.roster) {
            counts[p.pos] = (counts[p.pos] || 0) + 1;
            if (p.ovr > (bestAtPos[p.pos] || 0)) bestAtPos[p.pos] = p.ovr;
        }
        teamNeeds[t.id] = { counts, bestAtPos };
    }

    for (const p of fa.pool) {
        p.offers = [];

        // Bird Rights: former CPU team can re-sign up to soft cap (140M)
        if (p.formerTeamId) {
            const formerTeam = cpuTeams.find(t => t.id === p.formerTeamId);
            if (formerTeam && formerTeam.roster.length < 15) {
                const birdSpace = (SALARY_CAP + 20) - formerTeam.cap.payroll;
                let wantsToKeep = p.ovr >= 74 || (p.age <= 25 && ["A+", "A"].includes(p.potentialGrade));

                if (wantsToKeep) {
                    // Is there a meaningfully better player at the same position still under contract?
                    const betterAtPos = formerTeam.roster
                        .filter(r => r.pos === p.pos && r.ovr >= p.ovr + 6 && r.contract?.years >= 1)
                        .sort((a, b) => b.ovr - a.ovr)[0];

                    if (betterAtPos) {
                        if (betterAtPos.contract.years >= 3) {
                            // Already locked in long-term at this position — no need for the lesser player
                            wantsToKeep = false;
                        } else {
                            // Expiring within 1-2 years — check if we can afford both re-signs
                            const futureAsk = calculateSalary(betterAtPos.ovr, betterAtPos.age + betterAtPos.contract.years);
                            const spaceAfterResign = birdSpace - p.ask;
                            if (spaceAfterResign < futureAsk * 0.80) {
                                // Can't afford the better player if we commit to this one
                                wantsToKeep = false;
                            }
                        }
                    }
                }

                if (wantsToKeep && birdSpace >= p.ask) {
                    const offerSal = Number((p.ask * (1.05 + Math.random() * 0.05)).toFixed(2));
                    p.offers.push({
                        teamId: formerTeam.id,
                        teamName: formerTeam.name,
                        salary: Math.min(offerSal, Number(birdSpace.toFixed(2))),
                        years: p.yearsAsk,
                        isBirdRights: true
                    });
                }
            }
        }

        let demandChance = 0;
        if (p.ovr >= 85) demandChance = 0.95;
        else if (p.ovr >= 80) demandChance = 0.70;
        else if (p.ovr >= 75) demandChance = 0.40;
        else if (p.ovr >= 70) demandChance = 0.15;
        else demandChance = 0.05;

        if (Math.random() > demandChance) continue;

        const numOffers = Math.floor(Math.random() * 3) + 1;
        const shuffled = [...cpuTeams].sort(() => 0.5 - Math.random());
        
        for (const t of shuffled) {
            if (p.offers.length >= numOffers) break;

            const needs = teamNeeds[t.id];
            const posCount = needs.counts[p.pos] || 0;
            const currentStarterOvr = needs.bestAtPos[p.pos] || 0;

            if (posCount >= 4) continue;

            if (posCount >= 2 && p.ovr < currentStarterOvr) {
                if (Math.random() > 0.3) continue;
            }

            let interestBoost = 1.0;
            if (posCount <= 1) interestBoost = 1.5;
            if (p.ovr > 80 && p.ovr > currentStarterOvr + 3) interestBoost = 2.0;

            const capSpace = t.cap.cap - t.cap.payroll;
            let salaryMult;
            if (interestBoost >= 2.0) salaryMult = 1.15 + Math.random() * 0.10; // desperate: 1.15–1.25x ask
            else if (interestBoost >= 1.5) salaryMult = 1.05 + Math.random() * 0.10; // interested: 1.05–1.15x ask
            else salaryMult = 0.90 + Math.random() * 0.20; // normal: 0.90–1.10x ask
            const offerAmount = p.ask * salaryMult;
            
            if (capSpace > offerAmount && t.roster.length < 15) {
                p.offers.push({
                    teamId: t.id,
                    teamName: t.name,
                    salary: Number(offerAmount.toFixed(2)),
                    years: p.yearsAsk, 
                });
            }
        }
    }
}

// Simulate a second bidding round: teams that are outbid by a small margin may counter-offer
function runFaCounterOffers(g) {
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    for (const p of fa.pool) {
        if (!p.offers || p.offers.length < 2) continue;

        p.offers.sort((a, b) => (b.salary * (1 + 0.1 * b.years)) - (a.salary * (1 + 0.1 * a.years)));
        const bestScore = p.offers[0].salary * (1 + 0.1 * p.offers[0].years);

        for (let i = 1; i < p.offers.length; i++) {
            const offer = p.offers[i];
            const score = offer.salary * (1 + 0.1 * offer.years);
            const gap = (bestScore - score) / bestScore;

            // If within 20% of the best offer, 50% chance to bump up and compete
            if (gap <= 0.20 && Math.random() < 0.50) {
                const team = cpuTeams.find(t => t.id === offer.teamId);
                if (!team) continue;
                const newSalary = Number((p.offers[0].salary * (1.02 + Math.random() * 0.06)).toFixed(2));
                const capLimit = offer.isBirdRights ? SALARY_CAP + 20 : team.cap.cap;
                if ((capLimit - team.cap.payroll) >= newSalary) {
                    offer.salary = newSalary;
                }
            }
        }

        // Re-sort after counter-offers
        p.offers.sort((a, b) => (b.salary * (1 + 0.1 * b.years)) - (a.salary * (1 + 0.1 * a.years)));
    }
}

export function calculateSignChance(player, offerSalary, offerYears){
    const userScore = offerSalary * (1 + 0.1 * offerYears);
    const askScore = player.ask * (1 + 0.1 * player.yearsAsk);

    let bestCpuScore = 0;
    for (const off of (player.offers || [])) {
        const s = off.salary * (1 + 0.1 * off.years);
        if (s > bestCpuScore) bestCpuScore = s;
    }

    // No competing offers = player is desperate, will accept 15% below their ask
    const noCompetition = bestCpuScore === 0;
    const target = noCompetition ? askScore * 0.85 : Math.max(askScore, bestCpuScore);
    if (target === 0) return 100;

    const ratio = userScore / target;
    let chance = (ratio - 0.85) / (1.15 - 0.85) * 100;

    return clamp(Math.round(chance), 0, 100);
}

// -------------------- PROGRESSION & SIMULATION --------------------

function processEndSeasonRoster(g){
  const userTeamId = g.league.teams[g.userTeamIndex].id;
  g.offseason.expiring = []; 

  for(const t of g.league.teams){
    const nextRoster = [];
    
    for(const p of t.roster){
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
      
      let growthSpeed = 0;

      // 1. Age
      if (age <= 22) growthSpeed += 2;       
      else if (age <= 25) growthSpeed += 1;  
      else if (age <= 29) growthSpeed += 0;  
      else if (age <= 32) growthSpeed -= 1; 
      else growthSpeed -= 3;                

      // 2. Potential
      if (p.potentialGrade === "A+") growthSpeed += 2;      
      else if (p.potentialGrade === "A") growthSpeed += 1; 
      else if (p.potentialGrade === "B") { if (Math.random() > 0.5) growthSpeed += 1; }
      else if (p.potentialGrade === "F") growthSpeed -= 1; 

      // 3. Playtime
      if (age < 28) {
          if (minutes >= 28) growthSpeed += 2;        
          else if (minutes >= 15) growthSpeed += 1;   
          else if (minutes < 5) growthSpeed -= 1;     
      }

      // 4. Performance
      const ppg = p.stats.gp > 0 ? (p.stats.pts / p.stats.gp) : 0;
      if (age < 26 && ppg >= 15) {
          growthSpeed += 1; 
          if (t.id === userTeamId && Math.random() < 0.3) {
             g.inbox.unshift({ t:Date.now(), msg:`DEVELOPMENT: ${p.name} improved from strong performance!` });
          }
      }

      // 5. Soft Cap
      const caps = { "A+":99, "A":92, "B":84, "C":77, "D":70, "F":60 };
      const softCap = caps[p.potentialGrade] || 75;
      if (p.ovr >= softCap) {
          if (growthSpeed > 0) growthSpeed = 0; 
          else growthSpeed -= 1; 
      }

      // 6. Variance
      const roll = Math.random();
      if (roll < 0.05) {
          growthSpeed += 3; 
          if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`BREAKOUT: ${p.name} had a massive offseason (+${growthSpeed})!` });
      } else if (roll < 0.10) {
          growthSpeed -= 2;
      }

      const offChange = growthSpeed + (Math.floor(Math.random() * 3) - 1); 
      const defChange = growthSpeed + (Math.floor(Math.random() * 3) - 1);

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
          if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`${p.name} has retired at age ${p.age}.` });
          continue; 
      }

      p.contract.years -= 1;

      if(p.contract.years > 0){
        nextRoster.push(p);
      } else {
        if(t.id === userTeamId) g.inbox.unshift({ t:Date.now(), msg:`${p.name}'s contract expired.` });
        
        const fairValue = calculateSalary(p.ovr, p.age);
        const greed = 0.9 + Math.random() * 0.3; 
        
        g.offseason.expiring.push({
            ...p,
            ask: Number((fairValue * greed).toFixed(2)),
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
    for (const p of t.roster) { p.tradeDemand = false; }
    autoDistributeMinutes(t);
    recalcPayroll(t);
    updateTeamRating(t);
  }

  // CPU teams cut dead weight after processing rosters
  simCpuRosterCuts(g);
  g.tradeDemandChecked = false;
}

export function negotiateExtension(teamId, playerId, execute = true){
    const g = STATE.game;
    const team = g.league.teams.find(t => t.id === teamId);
    const p = team.roster.find(x => x.id === playerId);
    
    if (!p) return { success:false, msg:"Player not found." };
    if (p.contract.years > 2) return { success:false, msg:"Too early to extend (>2 years left)." };
    if (p.happiness < 40) return { success:false, msg:"Player is too unhappy to discuss an extension." };

    const fairValue = calculateSalary(p.ovr, p.age);
    let discount = 1.0;
    if (p.happiness >= 90) discount = 0.90;
    else if (p.happiness >= 70) discount = 0.95;

    const askAmount = Number((fairValue * discount).toFixed(2));
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

function cpuPlayerValue(p) {
    if (!p || p.ovr == null) return 0;
    let val = Math.pow(Math.max(0, p.ovr - 50), 2.2);
    const potMult = { "A+":1.6, "A":1.35, "B":1.15, "C":1.0, "D":0.85, "F":0.70 };
    val *= (potMult[p.potentialGrade] || 1.0);
    if (p.age <= 23) val *= 1.20;
    else if (p.age >= 32) val *= 0.80;
    else if (p.age >= 29) val *= 0.90;
    return Math.round(val);
}

function cpuPickValue(pick, currentYear) {
    const yearsOut = Math.max(0, pick.year - currentYear);
    const base = pick.round === 1 ? 300 : 80;
    return Math.round(base * Math.pow(0.85, yearsOut));
}

// Returns the player `team` should offer, based on what the other team's mode wants.
// Prefers trading from overstocked positions; avoids leaving a position empty.
function pickOfferPlayer(team, requestingMode) {
    const roster = [...team.roster];
    const POSITIONS = ["PG","SG","SF","PF","C"];

    // Find positions the team has surplus at (most players) — prefer trading those
    const posCounts = {};
    POSITIONS.forEach(pos => posCounts[pos] = 0);
    roster.forEach(p => posCounts[p.pos] = (posCounts[p.pos] || 0) + 1);
    const maxCount = Math.max(...POSITIONS.map(pos => posCounts[pos]));
    const surplusPos = new Set(POSITIONS.filter(pos => posCounts[pos] >= maxCount));

    // A player is safe to trade only if someone else covers their position
    const isTradeSafe = (p) => roster.filter(x => x.pos === p.pos && x.id !== p.id).length >= 1;

    let pool;
    if (requestingMode === "win_now") {
        pool = roster.filter(p => p.age >= 27 && p.ovr >= 74 && isTradeSafe(p));
    } else if (requestingMode === "retooling") {
        pool = roster.filter(p => p.age <= 27 && p.ovr >= 70 && isTradeSafe(p));
    } else {
        // rebuilding wants young players
        pool = roster.filter(p => p.age <= 24 && isTradeSafe(p));
    }

    // Sort: surplus positions first, then by lowest OVR (keep stars)
    pool.sort((a, b) => {
        const aSurplus = surplusPos.has(a.pos) ? 0 : 1;
        const bSurplus = surplusPos.has(b.pos) ? 0 : 1;
        return aSurplus - bSurplus || a.ovr - b.ovr;
    });

    if (pool.length) return pool[0];

    // Fallback: any safe player, weakest first
    const safe = roster.filter(isTradeSafe).sort((a, b) => a.ovr - b.ovr);
    return safe[0] || null;
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

            const fairValue = calculateSalary(p.ovr, p.age);
            const discount = (p.happiness ?? 70) >= 90 ? 0.90 : (p.happiness ?? 70) >= 70 ? 0.95 : 1.0;
            const askAmount = Number((fairValue * discount).toFixed(2));
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
    if (Math.random() > (nearDeadline ? 0.75 : 0.45)) return;
    const aiTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);
    if (aiTeams.length < 2) return;

    const idx1 = Math.floor(Math.random() * aiTeams.length);
    let idx2 = Math.floor(Math.random() * (aiTeams.length - 1));
    if (idx2 >= idx1) idx2++;
    const t1 = aiTeams[idx1];
    const t2 = aiTeams[idx2];
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
        if ((t1.cap.payroll - t1OutSal + t2OutSal) > SALARY_CAP + 5) continue;
        if ((t2.cap.payroll - t2OutSal + t1OutSal) > SALARY_CAP + 5) continue;

        const t1Net = deal.t2Assets.players.length - deal.t1Assets.players.length;
        const t2Net = deal.t1Assets.players.length - deal.t2Assets.players.length;
        if (t1.roster.length + t1Net > 15 || t2.roster.length + t2Net > 15) continue;
        if (t1.roster.length + t1Net < 5 || t2.roster.length + t2Net < 5) continue;

        // Both teams must retain at least 1 player at each position after the trade
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

        const fmtSide = (assets) => [
            ...assets.players.map(p => p.name),
            ...assets.picks.map(pk => `${pk.year} R${pk.round}`)
        ].join(' + ') || '(nothing)';
        g.inbox.unshift({
            t: Date.now(),
            msg: `TRADE: ${t1.name} sends ${fmtSide(deal.t1Assets)} to ${t2.name} for ${fmtSide(deal.t2Assets)}.`
        });
        return;
    }
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
    return covered >= targetVal * 0.40 ? result : null;
}

// 1-for-1 player swap, with up to 2 picks added on one side to balance
function cpuDeal_PlayerSwap(t1, t2, mode1, mode2, g) {
    if (!t1.roster.length || !t2.roster.length) return null;
    const p1 = pickOfferPlayer(t1, mode2);
    const p2 = pickOfferPlayer(t2, mode1);
    if (!p1 || !p2 || p1.id === p2.id) return null;

    const v1 = cpuPlayerValue(p1), v2 = cpuPlayerValue(p2);
    const gap = v1 - v2, avgVal = (v1 + v2) / 2;
    if (avgVal === 0) return null;

    let t1Picks = [], t2Picks = [];
    if (Math.abs(gap) / avgVal > 0.20) {
        const addingTeam = gap > 0 ? t2 : t1;
        const picks = _gatherPicks(addingTeam, Math.abs(gap) * 0.75, 2, g);
        if (!picks) return null;
        if (gap > 0) t2Picks = picks; else t1Picks = picks;
    }
    return { t1Assets: { players: [p1], picks: t1Picks }, t2Assets: { players: [p2], picks: t2Picks } };
}

// 2-for-1: one side sends 2 players whose combined value matches a single better player
function cpuDeal_TwoForOne(t1, t2, mode1, mode2, g) {
    const tryOrder = (giver2, receiver1) => {
        if (giver2.roster.length < 8 || receiver1.roster.length < 2) return null;
        const star = pickOfferPlayer(receiver1, getTeamMode(giver2, g));
        if (!star) return null;
        const starVal = cpuPlayerValue(star);
        if (starVal < 70) return null;

        const candidates = [...giver2.roster]
            .filter(p => p.id !== star.id)
            .map(p => ({ p, v: cpuPlayerValue(p) }))
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
        const pVal = cpuPlayerValue(dumpPlayer);
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
        // Value the player at a 20% discount due to unhappiness
        const pVal = cpuPlayerValue(target) * 0.80;
        if (pVal < 60) return null;

        const isSafe = (p) => seller.roster.filter(x => x.pos === p.pos && x.id !== p.id).length >= 1;
        if (!isSafe(target)) return null;

        // Buyer offers a player + picks for the discounted target
        const offerPlayer = pickOfferPlayer(buyer, getTeamMode(seller, g));
        if (!offerPlayer) return null;
        const offerVal = cpuPlayerValue(offerPlayer);
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
    updateTeamRating(userTeam);
    updateTeamRating(otherTeam);

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
    const faEntry = {
        ...p,
        ask: Number((fairValue * greed).toFixed(2)),
        yearsAsk: Math.max(1, Math.min(3, Math.floor(Math.random() * 3) + 1)),
        signedByTeamId: null,
        contract: null,
        offers: []
    };

    // If FA is already open, drop them straight into the pool; otherwise queue for next offseason
    if (g.offseason.freeAgents?.pool) {
        g.offseason.freeAgents.pool.push(faEntry);
        g.offseason.freeAgents.pool.sort((a, b) => b.ovr - a.ovr);
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

export function isTradeWindowOpen(){
  const g = STATE.game;
  if (g.phase === PHASES.PLAYOFFS) return false;
  if (g.phase === PHASES.REGULAR && g.week > TRADE_DEADLINE_WEEK) return false;
  return true;
}

export function advanceWeek(){
  const g = STATE.game;
  if (g.phase !== PHASES.REGULAR) return;
  
  // NOTE: If week is > seasonWeeks, we shouldn't sim games. 
  // It means we are at the "End of Season" checkpoint waiting for user to start playoffs.
  if (g.week <= g.seasonWeeks) {
      simWeekGames(g);
      checkTradeDemands(g);
      if (g.week <= TRADE_DEADLINE_WEEK) simCpuTrades(g, g.week);
      if (g.week === 5) simCpuExtensions(g);
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

            if (team.id === userTeamId) {
                g.inbox.unshift({ t: Date.now(), msg: `TRADE DEMAND: ${p.name} (OVR ${p.ovr}) is unhappy and wants out! Consider trading him or improving team morale.` });
            } else {
                g.inbox.unshift({ t: Date.now(), msg: `TRADE DEMAND: ${p.name} (${team.name}, OVR ${p.ovr}) has requested a trade.` });
            }
        }
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

    const statsA = calcTeamPerformance(A);
    const statsB = calcTeamPerformance(B);

    const varA = 0.9 + Math.random() * 0.2;
    const varB = 0.9 + Math.random() * 0.2;
    const homeBoost = 1.05;
    const aIsHome = Math.random() < 0.5;

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
        const scoreStr = `${Math.max(finalScoreA, finalScoreB)}-${Math.min(finalScoreA, finalScoreB)}`;
        
        g.inbox.unshift({ 
            t: Date.now(), 
            msg: `Week ${g.week}: ${userWon ? "WON" : "LOST"} vs ${opponent.name} (${scoreStr})` 
        });
    }
  }
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
  autoSave();
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

  g.schedule = generateWeeklySchedule(g.league.teams.map(t => t.id), SEASON_WEEKS);
  g.playoffs = null;
  g.offseason.freeAgents = null;
  g.offseason.draft = null;
  g.offseason.expiring = []; 

  g.inbox.unshift({ t: Date.now(), msg: `New season started. Year ${g.year}.` });
  autoSave();
}

export function finalizeSeasonAndLogHistory({ championTeamId, userPlayoffFinish }){
  const g = STATE.game;
  
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
    userRecord: { wins: userTeam.wins, losses: userTeam.losses },
    userPlayoffFinish: userFinish,
    championTeam: championTeam?.name || "—",
    awards,
    allTeamRecords
  });
  g.inbox.unshift({ t: Date.now(), msg: `Season ${g.year} awards saved to History.` });
  autoSave();
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
