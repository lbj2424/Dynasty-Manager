import { el, card, button, badge } from "../components.js";
import { getState, advanceToNextYear } from "../../state.js";
import { PHASES } from "../../data/constants.js";

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
      ? el("div", { class:"p" }, "Choose a player from the board below.")
      : button("Sim CPU Pick", {
          primary: true,
          onClick: () => {
            cpuPick(d, onClockTeamId, g);
            rerender(root);
          }
        })
  ]));

  root.appendChild(renderBoard(d, g, userOnClock, onClockTeamId));
  root.appendChild(renderDrafted(d, g));

  return root;
}

function renderBoard(d, g, userOnClock, onClockTeamId){
  const available = d.declaredProspects.filter(p => !p._drafted).slice(0, 60);

  const rows = available.map(p => {
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
      el("td", {}, String(p.currentOVR)),
      el("td", {}, p.potentialGrade),
      el("td", {}, p.pool === "NCAA" ? "NCAA" : (p.continentName || "INTL")),
      el("td", {}, pickBtn)
    ]);
  });

  return card("Draft Board", "Declared prospects only. Showing top 60 available.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Source"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"6" }, "No declared prospects available.")])
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

  const done = d.done;

  return card("Draft Log", done ? "Draft complete." : "Latest picks", [
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
    done ? button("Advance to Next Year", {
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

  // add to team roster as rookie (simple contract placeholder)
  const team = g.league.teams.find(t => t.id === teamId);
  if (team){
    const rookieSalary = round === 1 ? 4.0 : 1.5;
    team.roster.push({
      id: prospect.id,
      name: prospect.name,
      pos: prospect.pos,
      ovr: prospect.currentOVR,
      potentialGrade: prospect.potentialGrade,
      promisedRole: "Reserve",
      contract: { years: 2, salary: rookieSalary }
    });
    team.cap.payroll = Number((team.cap.payroll + rookieSalary).toFixed(1));
  }

  advancePickCursor(d);
}

function cpuPick(d, teamId, g){
  const available = d.declaredProspects.filter(p => !p._drafted);
  if (!available.length) {
    d.done = true;
    return;
  }
  // CPU picks best OVR
  available.sort((a,b) => b.currentOVR - a.currentOVR);
  makePick(d, teamId, available[0], g);
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
