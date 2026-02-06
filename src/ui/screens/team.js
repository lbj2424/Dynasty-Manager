import { el, card, badge } from "../components.js";
import { getState } from "../../state.js";

export function TeamScreen(){
  const s = getState();
  const g = s.game;
  const team = g.league.teams[g.userTeamIndex];

  const root = el("div", {}, []);

  root.appendChild(card("My Team", "Roster, stats, development, happiness (v1).", [
    el("div", { class:"row" }, [
      badge(team.name),
      badge(`${team.conference}`),
      badge(`Record: ${team.wins}-${team.losses}`),
      badge(`Payroll: ${team.cap.payroll.toFixed(1)} / ${team.cap.cap}`)
    ]),
  ]));

  // roster table
  const rows = (team.roster || [])
    .slice()
    .sort((a,b) => b.ovr - a.ovr)
    .map(p => el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `${p.dev.focus} (${p.dev.points} pts)`),
      el("td", {}, String(p.happiness)),
      el("td", {}, `${p.contract.years}y / ${p.contract.salary}M`),
      el("td", {}, `${p.stats.pts.toFixed(1)}`),
      el("td", {}, `${p.stats.reb.toFixed(1)}`),
      el("td", {}, `${p.stats.ast.toFixed(1)}`)
    ]));

  root.appendChild(card("Roster", "PTS/REB/AST are season averages (sim-based).", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Dev"),
        el("th", {}, "Happy"),
        el("th", {}, "Contract"),
        el("th", {}, "PTS"),
        el("th", {}, "REB"),
        el("th", {}, "AST")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"10" }, "No roster found.")])
      ])
    ])
  ]));

  return root;
}
