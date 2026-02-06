import { el, card, button, badge } from "../components.js";
import { getState, advanceToNextYear } from "../../state.js";
import { PHASES } from "../../data/constants.js";
import { clamp } from "../../utils.js";

export function DraftScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  if (g.phase !== PHASES.DRAFT){
    root.appendChild(card("Draft", "Not currently in the draft.", [
      el("div", { class:"p" }, "Finish playoffs → complete free agency → start draft.")
    ]));
    return root;
  }

  const d = g.offseason.draft;
  const teamById = (id) => g.league.teams.find(t => t.id === id);

  // safety for old saves
  g.scouting.scoutedNCAAIds ??= [];
  g.scouting.scoutedIntlIds ??= [];

  const pickNumberOverall = (d.round - 1) * 32 + (d.pickIndex + 1);
  const onClockTeamId = d.orderTeamIds[d.pickIndex];
  const onClockTeam = teamById(onClockTeamId);

  const userTeam = g.league.teams[g.userTeamIndex];
  const userOnClock = onClockTeamId === userTeam.id;

  root.appendChild(card("Draft", "2 rounds. Order is worst → best by regular season record.", [
    el("div", { class:"row" }, [
      badge(`Round ${d.round} / 2`),
      badge(`Pick ${d.pickIndex + 1} / 32`),
      badge(`Overall #${pickNumberOverall}`),
      badge(`On the clock: ${onClockTeam?.name || "—"}`),
      userOnClock ? badge("YOUR PICK") : null
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    userOnClock
      ? el("div", { class:"p" }, "Choose a player. OVR/Potential only show for players you scouted.")
      : button("Sim CPU Pick", {
          primary: true,
          onClick: () => {
            cpuPickWeighted(d, onClockTeamId, g);
            rerender(root);
          }
        })
  ]));

  root.appendChild(renderBoard(d, g, userOnClock, onClockTeamId));
  root.appendChild(renderDrafted(d, g));

  return root;
}

function renderBoard(d, g, userOnClock, onClockTeamId){
  const scoutedSet = makeScoutedSet(g);

  // show more than 60 so late 2nd feels real
  const available = d.declaredProspects.filter(p => !p._drafted).slice(0, 90);

  const rows = available.map(p => {
    const youKnow = scoutedSet.has(p.id);

    const pickBtn = button("Draft", {
      small: true,
      primary: userOnClock,
      onClick: () => {
        if (!userOnClock) return;
        makePick(d, onClockTeamId, p, g);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, youKnow ? String(p.currentOVR) : "Unknown"),
      el("td", {}, youKnow ? p.potentialGrade : "Unknown"),
      el("td", {}, p.pool === "NCAA" ? "NCAA" : (p.continentName || "INTL")),
      el("td", {}, youKnow ? "Yes" : "No"),
      el("td", {}, pickBtn)
    ]);
  });

  return card("Draft Board", "Declared prospects only. OVR/Pot only show if you scouted them.", [
    el("div", { class:"p" }, `Scouted prospects visible: ${makeScoutedSet(g).size}`),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Source"),
        el("th", {}, "Scouted"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"7" }, "No declared prospects available.")])
      ])
    ])
  ]);
}

function renderDrafted(d, g){
  const teamById = (id) => g.league.teams.find(t => t.id === id);
  const rows = d.drafted.slice(-25).reverse().map(x => {
    const t = teamById(x.teamId);
    const p = x.prospect;
    return el("tr", {}, [
      el("td", {}, `R${x.round} #${x.pickOverall}`),
      el("td", {}, t?.name || "—"),
      el("td", {}, p?.name || "—"),
      el("td", {}, p?.pos || "—"),
      el("td", {}, String(p?.currentOVR ?? "")),
      el("td", {}, p?.potentialGrade || "")
    ]);
  });

  return card("Draft Log", d.done ? "Draft complete." : "Latest picks", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Pick"),
        el("th", {}, "Team"),
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"6" }, "No picks yet.")])
      ])
    ]),
    el("div", { class:"sep" }),
    d.done ? button("Advance to Next Year", {
      primary: true,
      onClick: () => {
        advanceToNextYear();
        location.hash = "#/dashboard";
      }
    }) : null
  ]);
}

function makePick(d, teamId, prospect, g){
  const round = d.round;
  const pickOverall = (round - 1) * 32 + (d.pickIndex + 1);

  prospect._drafted = true;

  d.drafted.push({
    teamId,
    prospectId: prospect.id,
    round,
    pickOverall,
    prospect
  });

  // add to team roster as rookie
  const team = g.league.teams.find(t => t.id === teamId);
  if (team){
    const rookieSalary = round === 1 ? 4.0 : 1.5;
    team.roster.push({
      id: prospect.id,
      name: prospect.name,
      pos: prospect.pos,
      ovr: prospect.currentOVR,
      potentialGrade: prospect.potentialGrade,
      happiness: 70,
      dev: { focus: "Overall", points: 7 },
      promisedRole: "Reserve",
      contract: { years: 2, salary: rookieSalary },
      stats: { gp:0, pts:0, reb:0, ast:0 }
    });
    team.cap.payroll = Number((team.cap.payroll + rookieSalary).toFixed(1));
  }

  advancePickCursor(d);
}

// ---------- CPU PICK: weighted randomness ----------
function cpuPickWeighted(d, teamId, g){
  const available = d.declaredProspects.filter(p => !p._drafted);
  if (!available.length) {
    d.done = true;
    return;
  }

  // sort by OVR then take a "top tier" window that grows later in the draft
  available.sort((a,b) => b.currentOVR - a.currentOVR);

  const overallPick = (d.round - 1) * 32 + (d.pickIndex + 1); // 1..64
  const tierSize = clamp(
    8 + Math.floor(overallPick / 8), // early ~8-12, later ~12-16
    8,
    18
  );

  const tier = available.slice(0, tierSize);

  // weights favor the top but allow surprises
  // idx 0 gets biggest weight, idx increases weight falls
  const weights = tier.map((p, i) => {
    const base = 1 / Math.pow(i + 1, 1.25);
    const potBump = potentialBump(p.potentialGrade); // higher upside slightly more appealing
    return base * potBump;
  });

  const choice = weightedChoice(tier, weights);
  makePick(d, teamId, choice, g);
}

function potentialBump(grade){
  return ({
    "A+": 1.12,
    "A":  1.08,
    "B":  1.04,
    "C":  1.00,
    "D":  0.98,
    "F":  0.96
  })[grade] ?? 1.0;
}

function weightedChoice(items, weights){
  const total = weights.reduce((a,b)=>a+b,0);
  let r = Math.random() * total;
  for (let i=0;i<items.length;i++){
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[0];
}

function makeScoutedSet(g){
  const set = new Set();
  for (const id of (g.scouting.scoutedNCAAIds || [])) set.add(id);
  for (const id of (g.scouting.scoutedIntlIds || [])) set.add(id);
  return set;
}

function advancePickCursor(d){
  d.pickIndex += 1;
  if (d.pickIndex >= 32){
    d.pickIndex = 0;
    d.round += 1;
  }
  if (d.round > 2){
    d.done = true;
  }
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DraftScreen());
}
