import { el, card, button, badge } from "../components.js";
import { getState, startDraft } from "../../state.js";
import { PHASES, ROSTER_MAX } from "../../data/constants.js";
import { clamp } from "../../utils.js";

export function FreeAgencyScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  if (g.phase !== PHASES.FREE_AGENCY){
    root.appendChild(card("Free Agency", "Not currently in free agency.", [
      el("div", { class:"p" }, "Finish playoffs first. Free agency starts right after the champion is crowned.")
    ]));
    return root;
  }

  const userTeam = g.league.teams[g.userTeamIndex];
  const fa = g.offseason.freeAgents;

  // -------- NEW: initialize CPU offers the first time you open FA --------
  initCpuOffersOnce(fa, g);

  root.appendChild(card("Free Agency", "CPU teams make offers too. When you offer, the player picks between all offers immediately.", [
    el("div", { class:"row" }, [
      badge(`Team: ${userTeam.name}`),
      badge(`Cap: ${userTeam.cap.cap}`),
      badge(`Payroll: ${userTeam.cap.payroll.toFixed(1)}`),
      badge(`Roster: ${userTeam.roster.length}/${ROSTER_MAX}`),
      badge(`Last season: ${userTeam.wins}-${userTeam.losses}`)
    ]),
    el("div", { class:"sep" }),

    // optional: push the market forward so CPU makes new offers later
    button("Advance FA Round (CPU offers)", {
      onClick: () => {
        cpuOfferRound(fa, g);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }),

    button("Continue to Draft", {
      primary: true,
      onClick: () => {
        startDraft();
        location.hash = "#/draft";
      }
    })
  ]));

  root.appendChild(renderRoster(userTeam));
  root.appendChild(renderFreeAgentPool(fa.pool, userTeam, g));

  return root;
}

function renderRoster(team){
  const rows = (team.roster || []).map(p => el("tr", {}, [
    el("td", {}, p.name),
    el("td", {}, p.pos),
    el("td", {}, String(p.ovr)),
    el("td", {}, `${p.contract.years}y / ${p.contract.salary}M`),
    el("td", {}, p.promisedRole || "-")
  ]));

  return card("Your Roster", "v1 roster view", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Contract"),
        el("th", {}, "Promised Role")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"5" }, "No signed players yet.")])
      ])
    ])
  ]);
}

function renderFreeAgentPool(pool, userTeam, g){
  const teamsById = new Map(g.league.teams.map(t => [t.id, t]));

  const top = pool.filter(p => !p.signedByTeamId).slice(0, 40);

  const rows = top.map(p => {
    p.offers ??= [];
    p._traits ??= {
      ambition: Math.floor(30 + Math.random()*71),
      loyalty:  Math.floor(30 + Math.random()*71)
    };

    const roles = ["Star","Starter","Bench","Reserve"];
    const roleSelect = el("select", {}, roles.map(r => el("option", { value:r }, r)));
    roleSelect.value = "Bench";

    const yearsSelect = el("select", {}, [1,2,3,4].map(y => el("option", { value:String(y) }, `${y}`)));
    yearsSelect.value = String(Math.min(4, p.yearsAsk));

    const salaryInput = el("input", { type:"number", min:"1", step:"0.5", value:String(p.ask), style:"width:90px" });

    const offersCell = el("div", { class:"p" }, "");
    const interestCell = el("div", { class:"p" }, "");

    const updateUI = () => {
      const offerSalary = Number(salaryInput.value || 0);
      const offerYears = Number(yearsSelect.value || 1);
      const role = roleSelect.value;

      const interest = computeInterest(userTeam, p, { offerSalary, offerYears, role });
      const chancePct = chanceFromInterest(interest, p, { offerSalary });

      interestCell.textContent = `Your Interest: ${interest}/100 · Est. Chance (if only you): ${chancePct}%`;
      interestCell.title = "This is a rough estimate. If CPU teams have offers, it's a competition.";

      // show current offers (top 2)
      const sorted = p.offers.slice().sort((a,b) => b.score - a.score);
      const top2 = sorted.slice(0, 2).map(o => {
        const t = teamsById.get(o.teamId);
        return `${t?.name || "CPU"}: ${o.years}y/${o.salary}M (${o.role})`;
      });

      offersCell.textContent =
        p.offers.length
          ? `${p.offers.length} offer(s): ${top2.join(" | ")}${p.offers.length > 2 ? " | …" : ""}`
          : "No offers yet";
    };

    roleSelect.addEventListener("change", updateUI);
    yearsSelect.addEventListener("change", updateUI);
    salaryInput.addEventListener("input", updateUI);

    const canOffer = () => {
      const salary = Number(salaryInput.value || 0);
      return userTeam.roster.length < ROSTER_MAX && (userTeam.cap.payroll + salary) <= userTeam.cap.cap;
    };

    const offerBtn = button("Offer", {
      small: true,
      primary: true,
      onClick: () => {
        const offerSalary = Number(salaryInput.value || 0);
        const offerYears = Number(yearsSelect.value || 1);
        const role = roleSelect.value;

        if (!canOffer()) return alert("Cap or roster limit prevents this signing.");
        if (offerSalary <= 0) return alert("Offer salary must be > 0.");

        // Add/replace your offer (one offer per team)
        const userOffer = makeOffer(userTeam, p, { salary: offerSalary, years: offerYears, role });
        upsertOffer(p, userOffer);

        // Player chooses NOW between all offers
        const winner = pickWinningOffer(p);

        if (!winner){
          return alert("No offers available (unexpected).");
        }

        if (winner.teamId === userTeam.id){
          signToTeam(p, userTeam, winner);
          alert(`SIGNED! ${p.name}\n\nYou won the bidding.\nDeal: ${winner.years}y / ${winner.salary}M (${winner.role})`);
        } else {
          const t = teamsById.get(winner.teamId);
          const team = t;
          if (team) signToTeam(p, team, winner);

          alert(`You lost ${p.name}.\n\nWinner: ${t?.name || "CPU"}\nDeal: ${winner.years}y / ${winner.salary}M (${winner.role})`);
        }

        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });

    updateUI();

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `${p.ask}M`),
      el("td", {}, yearsSelect),
      el("td", {}, salaryInput),
      el("td", {}, roleSelect),
      el("td", {}, offersCell),
      el("td", {}, interestCell),
      el("td", {}, offerBtn)
    ]);
  });

  return card("Free Agent Pool", "CPU teams make offers. When you offer, the player picks between all current offers.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Ask"),
        el("th", {}, "Years"),
        el("th", {}, "Salary"),
        el("th", {}, "Role"),
        el("th", {}, "Current Offers"),
        el("th", {}, "Your Fit"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows)
    ]),
    el("div", { class:"p" }, "Tip: if a player already has 3–5 offers, you usually need to overpay or promise a bigger role.")
  ]);
}

/* ===================== CPU MARKET ===================== */

function initCpuOffersOnce(fa, g){
  if (fa._cpuOffersInitialized) return;
  fa._cpuOffersInitialized = true;

  // do 2 rounds immediately so the market feels active
  cpuOfferRound(fa, g);
  cpuOfferRound(fa, g);
}

function cpuOfferRound(fa, g){
  const teams = g.league.teams;
  const unsigned = fa.pool.filter(p => !p.signedByTeamId);

  // pick some players to receive new CPU offers
  // prioritize higher OVR guys (more competition)
  const candidates = unsigned
    .slice()
    .sort((a,b) => (b.ovr - a.ovr) + (Math.random() - 0.5))
    .slice(0, 30);

  for (const p of candidates){
    p.offers ??= [];
    p._traits ??= {
      ambition: Math.floor(30 + Math.random()*71),
      loyalty:  Math.floor(30 + Math.random()*71)
    };

    // 0-2 teams make new offers this round
    const newOffers = rollInt(0, 2);

    for (let i=0;i<newOffers;i++){
      const team = pickCpuTeamToOffer(teams, p);
      if (!team) continue;
      if (team.roster.length >= ROSTER_MAX) continue;

      // CPU offer near ask with some variance + team strength impact
      const winPct = team.wins + team.losses > 0 ? team.wins/(team.wins+team.losses) : 0.5;
      const qualityBump = (team.rating - 75) * 0.05 + (winPct - 0.5) * 0.8;

      const salary = clamp(
        roundToHalf(p.ask + (Math.random()*2.5 - 1.0) + qualityBump),
        1,
        45
      );

      // cap check (simple: only salary counts)
      if ((team.cap.payroll + salary) > team.cap.cap) continue;

      const years = clamp(p.yearsAsk + rollInt(-1, 1), 1, 4);
      const role = cpuRolePromise(team, p);

      const offer = makeOffer(team, p, { salary, years, role });
      upsertOffer(p, offer);
    }

    // Sometimes a player with many offers immediately signs somewhere (market moves)
    if (p.offers.length >= 4 && Math.random() < 0.35){
      const winner = pickWinningOffer(p);
      const team = g.league.teams.find(t => t.id === winner.teamId);
      if (team) signToTeam(p, team, winner);
    }
  }
}

function pickCpuTeamToOffer(teams, p){
  // pick a team weighted by need + quality
  const pool = teams.filter(t => true);
  const weights = pool.map(t => {
    const need = clamp((ROSTER_MAX - (t.roster?.length || 0)) / ROSTER_MAX, 0, 1);
    const quality = clamp((t.rating - 60) / 40, 0, 1);
    // better teams and teams with need offer more often
    return 0.4 + need*0.8 + quality*0.6;
  });
  return weightedChoice(pool, weights);
}

function cpuRolePromise(team, p){
  const top = (team.roster || []).slice().sort((a,b)=>b.ovr-a.ovr);
  const best = top[0]?.ovr ?? 70;
  if (p.ovr >= best - 2) return "Star";
  if (p.ovr >= best - 6) return "Starter";
  if (p.ovr >= best - 10) return "Bench";
  return "Reserve";
}

/* ===================== OFFER + SIGNING ===================== */

function makeOffer(team, player, { salary, years, role }){
  const interest = computeInterest(team, player, { offerSalary: salary, offerYears: years, role });
  // score is interest + money bump + tiny noise to break ties
  const moneyDelta = salary - player.ask;
  const score = interest + clamp(moneyDelta*6, -20, 20) + (Math.random()*6 - 3);

  return {
    teamId: team.id,
    salary: roundToHalf(salary),
    years,
    role,
    interest,
    score
  };
}

function upsertOffer(player, offer){
  player.offers ??= [];
  const idx = player.offers.findIndex(o => o.teamId === offer.teamId);
  if (idx >= 0) player.offers[idx] = offer;
  else player.offers.push(offer);
}

function pickWinningOffer(player){
  const offers = (player.offers || []).slice();
  if (!offers.length) return null;

  // Softmax-like pick: higher score more likely, but not guaranteed
  offers.sort((a,b) => b.score - a.score);

  const weights = offers.map((o, i) => {
    // keep top offers favored
    const base = 1 / Math.pow(i+1, 1.1);
    // score matters
    const scoreBump = clamp(o.score / 100, 0.2, 1.6);
    return base * scoreBump;
  });

  return weightedChoice(offers, weights);
}

function signToTeam(player, team, offer){
  // mark signed
  player.signedByTeamId = team.id;

  // add to roster
  team.roster.push({
    id: player.id,
    name: player.name,
    pos: player.pos,
    ovr: player.ovr,
    potentialGrade: player.potentialGrade,
    happiness: 70,
    dev: { focus: "Overall", points: 7 },
    promisedRole: offer.role,
    contract: { years: offer.years, salary: offer.salary },
    stats: { gp:0, pts:0, reb:0, ast:0 }
  });

  team.cap.payroll = Number((team.cap.payroll + offer.salary).toFixed(1));
}

/* ===================== INTEREST MODEL ===================== */

function computeInterest(team, player, offer){
  const winPct = team.wins + team.losses > 0 ? (team.wins / (team.wins + team.losses)) : 0.5;

  const teamPull =
    (team.rating - 60) * 1.2 +
    (winPct - 0.5) * 60;

  const moneyDelta = offer.offerSalary - player.ask;
  const moneyPull = clamp(moneyDelta * 8, -30, 30);

  const roleScore = roleValue(offer.role);
  const ambition = player._traits?.ambition ?? 60;
  const rolePull = clamp((roleScore - 1) * (ambition / 30), -10, 18);

  const loyalty = player._traits?.loyalty ?? 60;
  const yearsPull = clamp((offer.offerYears - 1) * (loyalty / 35), -8, 12);

  const pickiness = clamp((player.ovr - 75) * 1.2, 0, 18);

  const raw = 45 + teamPull + moneyPull + rolePull + yearsPull - pickiness;
  return clamp(Math.round(raw), 0, 100);
}

function chanceFromInterest(interest, player, offer){
  // rough “solo” estimate shown in UI
  const moneyDelta = offer.offerSalary - player.ask;
  if (moneyDelta < -2) return 0;

  let chance = (interest - 35) * 1.6;
  chance = clamp(chance, 5, 92);

  if (moneyDelta > 0) chance += clamp(moneyDelta * 4, 0, 10);
  if (moneyDelta < 0) chance -= clamp(Math.abs(moneyDelta) * 6, 0, 18);

  return clamp(Math.round(chance), 1, 95);
}

function roleValue(role){
  return ({
    "Star": 3,
    "Starter": 2,
    "Bench": 1,
    "Reserve": 0
  })[role] ?? 1;
}

/* ===================== SMALL UTILS ===================== */

function weightedChoice(items, weights){
  const total = weights.reduce((a,b)=>a+b,0);
  let r = Math.random() * total;
  for (let i=0;i<items.length;i++){
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[0];
}

function rollInt(min, max){
  return Math.floor(min + Math.random() * (max - min + 1));
}

function roundToHalf(x){
  return Math.round(x * 2) / 2;
}
