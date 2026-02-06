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

  root.appendChild(card("Free Agency", "Interest + chance-based signings. Winning, role promises, and money matter.", [
    el("div", { class:"row" }, [
      badge(`Team: ${userTeam.name}`),
      badge(`Cap: ${userTeam.cap.cap}`),
      badge(`Payroll: ${userTeam.cap.payroll.toFixed(1)}`),
      badge(`Roster: ${userTeam.roster.length}/${ROSTER_MAX}`),
      badge(`Last season: ${userTeam.wins}-${userTeam.losses}`)
    ]),
    el("div", { class:"sep" }),
    button("Continue to Draft", {
      primary: true,
      onClick: () => {
        startDraft();
        location.hash = "#/draft";
      }
    })
  ]));

  root.appendChild(renderRoster(userTeam));
  root.appendChild(renderFreeAgentPool(fa.pool, userTeam));

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

function renderFreeAgentPool(pool, team){
  const top = pool.filter(p => !p.signedByTeamId).slice(0, 40);

  const rows = top.map(p => {
    // lightweight “personality” seeded once
    p._traits ??= {
      ambition: Math.floor(30 + Math.random()*71), // 30-100
      loyalty:  Math.floor(30 + Math.random()*71)  // 30-100
    };

    const roles = ["Star","Starter","Bench","Reserve"];
    const roleSelect = el("select", {}, roles.map(r => el("option", { value:r }, r)));
    roleSelect.value = "Bench";

    const yearsSelect = el("select", {}, [1,2,3,4].map(y => el("option", { value:String(y) }, `${y}`)));
    yearsSelect.value = String(Math.min(4, p.yearsAsk));

    const salaryInput = el("input", { type:"number", min:"1", step:"0.5", value:String(p.ask), style:"width:90px" });

    const interestBadge = el("span", {}, "");

    const updateInterestUI = () => {
      const offerSalary = Number(salaryInput.value || 0);
      const offerYears = Number(yearsSelect.value || 1);
      const role = roleSelect.value;

      const interest = computeInterest(team, p, { offerSalary, offerYears, role });
      const { chancePct, reason } = computeSignChance(team, p, { offerSalary, offerYears, role }, interest);

      interestBadge.textContent = `Interest: ${interest}/100 · Chance: ${chancePct}%`;
      interestBadge.title = reason;
    };

    roleSelect.addEventListener("change", updateInterestUI);
    yearsSelect.addEventListener("change", updateInterestUI);
    salaryInput.addEventListener("input", updateInterestUI);

    const canSignCap = () => {
      const salary = Number(salaryInput.value || 0);
      return team.roster.length < ROSTER_MAX && (team.cap.payroll + salary) <= team.cap.cap;
    };

    const signBtn = button("Offer", {
      small: true,
      primary: true,
      onClick: () => {
        const offerSalary = Number(salaryInput.value || 0);
        const offerYears = Number(yearsSelect.value || 1);
        const role = roleSelect.value;

        if (!canSignCap()) return alert("Cap or roster limit prevents this signing.");

        const interest = computeInterest(team, p, { offerSalary, offerYears, role });
        const { chancePct, roll, reason } = computeSignChance(team, p, { offerSalary, offerYears, role }, interest);

        if (!roll){
          return alert(`Offer declined.\n\n${reason}\n\nTip: increase salary, promise a better role, or win more.`);
        }

        // accept
        p.signedByTeamId = team.id;
        p.promisedRole = role;
        p.contract = { years: offerYears, salary: offerSalary };

        team.roster.push({
          id: p.id,
          name: p.name,
          pos: p.pos,
          ovr: p.ovr,
          potentialGrade: p.potentialGrade,
          happiness: 70,
          dev: { focus: "Overall", points: 7 },
          promisedRole: role,
          contract: { years: offerYears, salary: offerSalary },
          stats: { gp:0, pts:0, reb:0, ast:0 }
        });

        team.cap.payroll = Number((team.cap.payroll + offerSalary).toFixed(1));

        alert(`Signed ${p.name} for ${offerYears}y / ${offerSalary}M.\n\n${reason}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });

    // initial compute
    updateInterestUI();

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `${p.ask}M`),
      el("td", {}, yearsSelect),
      el("td", {}, salaryInput),
      el("td", {}, roleSelect),
      el("td", {}, interestBadge),
      el("td", {}, signBtn)
    ]);
  });

  return card("Free Agent Pool", "Interest-based offers. Hover Interest text for why they may accept/decline.", [
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
        el("th", {}, "Interest/Chance"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows)
    ]),
    el("div", { class:"p" }, "Showing top 40 available FAs for now.")
  ]);
}

// ---------- Interest + Chance Model ----------

function computeInterest(team, player, offer){
  // base interest from team quality + winning + traits
  const winPct = team.wins + team.losses > 0 ? (team.wins / (team.wins + team.losses)) : 0.5;
  const teamPull =
    (team.rating - 60) * 1.2 +         // strong teams attract
    (winPct - 0.5) * 60;               // winning helps a lot

  // offer quality
  const moneyDelta = offer.offerSalary - player.ask; // positive = overpay
  const moneyPull = clamp(moneyDelta * 8, -30, 30);  // overpay helps, lowball hurts

  // role pull: ambitious guys want big roles
  const roleScore = roleValue(offer.role); // 0..3
  const ambition = player._traits?.ambition ?? 60;
  const rolePull = clamp((roleScore - 1) * (ambition / 30), -10, 18);

  // loyalty makes them prefer stability (more years)
  const loyalty = player._traits?.loyalty ?? 60;
  const yearsPull = clamp((offer.offerYears - 1) * (loyalty / 35), -8, 12);

  // better players are pickier
  const pickiness = clamp((player.ovr - 75) * 1.2, 0, 18);

  const raw = 45 + teamPull + moneyPull + rolePull + yearsPull - pickiness;
  return clamp(Math.round(raw), 0, 100);
}

function computeSignChance(team, player, offer, interest){
  const reasons = [];

  // hard blocks / strong penalties
  if (offer.offerSalary <= 0){
    return { chancePct: 0, roll: false, reason: "Offer salary must be > 0." };
  }

  const moneyDelta = offer.offerSalary - player.ask;
  if (moneyDelta < -2){
    return {
      chancePct: 0,
      roll: false,
      reason: `Declined: offer is way below ask (${offer.offerSalary}M vs ask ${player.ask}M).`
    };
  }

  // Convert interest to probability
  // baseline: 10% at interest 35, 50% at 60, 85% at 85
  let chance = (interest - 35) * 1.6; // linear
  chance = clamp(chance, 5, 92);

  // money still matters after interest
  if (moneyDelta > 0){
    chance += clamp(moneyDelta * 4, 0, 10);
    reasons.push(`You overpaid by ${moneyDelta.toFixed(1)}M.`);
  } else if (moneyDelta < 0){
    chance -= clamp(Math.abs(moneyDelta) * 6, 0, 18);
    reasons.push(`You offered below ask by ${Math.abs(moneyDelta).toFixed(1)}M.`);
  } else {
    reasons.push("You matched the ask.");
  }

  // role promise impact
  const roleScore = roleValue(offer.role);
  if (roleScore >= 2) reasons.push(`Role promise: ${offer.role}.`);
  else reasons.push(`Role promise: ${offer.role} (less appealing).`);

  // winning matters a lot to ambitious players
  const winPct = team.wins + team.losses > 0 ? (team.wins / (team.wins + team.losses)) : 0.5;
  if (winPct >= 0.55) reasons.push("Your team is winning.");
  if (winPct <= 0.45) chance -= 6;

  // final clamp and roll
  chance = clamp(Math.round(chance), 1, 95);
  const roll = Math.random() * 100 < chance;

  const reason =
    `Interest score: ${interest}/100.\n` +
    `Computed chance: ${chance}%.\n` +
    `Notes: ${reasons.join(" ")}`;

  return { chancePct: chance, roll, reason };
}

function roleValue(role){
  return ({
    "Star": 3,
    "Starter": 2,
    "Bench": 1,
    "Reserve": 0
  })[role] ?? 1;
}
