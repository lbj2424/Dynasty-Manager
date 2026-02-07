import { el, card, button, badge, showPlayerModal } from "../components.js";
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

  if (d.done) {
    root.appendChild(card("Draft Complete", "All rounds finished.", [
      el("div", { class:"p" }, "Review the picks below, then advance to the next season.")
    ]));
    root.appendChild(renderDrafted(d, g));
    return root;
  }

  const teamById = (id) => g.league.teams.find(t => t.id === id);
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
      ? el("div", { class:"p" }, "Choose a player.")
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
  
  const allAvailable = d.declaredProspects.filter(p => !p._drafted);
  const topGeneral = allAvailable.slice(0, 60);
  const scoutedList = allAvailable.filter(p => scoutedSet.has(p.id));
  
  const displaySet = new Set([...topGeneral, ...scoutedList]);
  const displayList = Array.from(displaySet).sort((a,b) => b.currentOVR - a.currentOVR);

  const rows = displayList.map(p => {
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
    
    const nameLink = el("span", { 
        style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
        onclick: () => showPlayerModal(p)
    }, p.name);

    return el("tr", {}, [
      el("td", {}, nameLink),
      el("td", {}, p.pos),
      el("td", {}, youKnow ? String(p.currentOVR) : "Unknown"),
      el("td", {}, youKnow ? p.potentialGrade : "Unknown"),
      el("td", {}, p.pool === "NCAA" ? p.college : (p.continentName || "INTL")),
      el("td", {}, youKnow ? "Yes" : "No"),
      el("td", {}, pickBtn)
    ]);
  });

  return card("Draft Board", "Showing Top 60 + All Scouted Players.", [
    el("div", { class:"p" }, `Scouted prospects visible: ${scoutedList.length}`),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "School/Country"),
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

  const team = g.league.teams.find(t => t.id === teamId);
  if (team){
    const rookieSalary = round === 1 ? 4.0 : 1.5;
    
    // --- FIX: GENERATE OFF/DEF FOR ROOKIES ---
    // Since prospects track 'currentOVR', we split it into OFF/DEF now
    const typeRoll = Math.random();
    let off = prospect.currentOVR; 
    let def = prospect.currentOVR;
    
    if (typeRoll < 0.35) { 
        // Scorer
        off += 5; 
        def -= 5; 
    } else if (typeRoll < 0.70) { 
        // Defender
        off -= 5; 
        def += 5; 
    }
    
    off = clamp(off, 40, 99);
    def = clamp(def, 40, 99);
    const finalOvr = Math.round((off + def)/2);
    // -----------------------------------------

    team.roster.push({
      id: prospect.id,
      name: prospect.name,
      pos: prospect.pos,
      ovr: finalOvr,
      off: off, // NEW
      def: def, // NEW
      age: prospect.age || 20, // FIX: Fallback just in case
      potentialGrade: prospect.potentialGrade,
      rookieYear: g.year, 
      happiness: 70,
      dev: { focus: "Overall", points: 7 },
      promisedRole: "Reserve",
      contract: { years: 2, salary: rookieSalary },
      stats: { gp:0, pts:0, reb:0, ast:0 },
      rotation: { minutes: 0, isStarter: false },
      careerStats: [] 
    });
    team.cap.payroll = Number((team.cap.payroll + rookieSalary).toFixed(1));
  }

  advancePickCursor(d);
}

function cpuPickWeighted(d, teamId, g){
  if (d.done) return; 
  
  const scoutedSet = makeScoutedSet(g);
  
  const available = d.declaredProspects.filter(p => {
      if (p._drafted) return false;
      if (p.pool === "INTL" && scoutedSet.has(p.id)) {
          return false; 
      }
      return true;
  });

  if (!available.length) {
    const trulyAny = d.declaredProspects.filter(p => !p._drafted);
    if (!trulyAny.length) {
        d.done = true;
        return;
    }
    makePick(d, teamId, trulyAny[0], g);
    return;
  }

  available.sort((a,b) => b.currentOVR - a.currentOVR);

  const overallPick = (d.round - 1) * 32 + (d.pickIndex + 1); 
  const tierSize = clamp(8 + Math.floor(overallPick / 8), 8, 18);
  const tier = available.slice(0, tierSize);

  const weights = tier.map((p, i) => {
    const base = 1 / Math.pow(i + 1, 1.25);
    const potBump = potentialBump(p.potentialGrade); 
    return base * potBump;
  });

  const choice = weightedChoice(tier, weights);
  makePick(d, teamId, choice, g);
}

function potentialBump(grade){
  return ({
    "A+": 1.12, "A": 1.08, "B": 1.04, "C": 1.00, "D": 0.98, "F": 0.96
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
