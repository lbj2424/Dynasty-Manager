import { el, card, badge, button } from "../components.js";
import { getState, releasePlayer } from "../../state.js"; // <--- Import releasePlayer

export function TeamScreen(){
  const s = getState();
  const g = s.game;
  const team = g.league.teams[g.userTeamIndex];

  const root = el("div", {}, []);

  root.appendChild(card("My Team", "Manage your roster and rotation.", [
    el("div", { class:"row" }, [
      badge(team.name),
      badge(`${team.conference}`),
      badge(`Record: ${team.wins}-${team.losses}`),
      badge(`Payroll: ${team.cap.payroll.toFixed(1)} / ${team.cap.cap}`)
    ]),
    el("div", { class:"sep" }),
    button("Manage Depth Chart / Minutes", {
        primary: true,
        onClick: () => location.hash = "#/depth-chart"
    })
  ]));

  // roster table
  const rows = (team.roster || [])
    .slice()
    .sort((a,b) => b.ovr - a.ovr)
    .map(p => {
        // Cut Button
        const cutBtn = button("Cut", {
            small: true, 
            danger: true,
            onClick: () => {
                if(confirm(`Release ${p.name}? This will clear ${p.contract.salary}M cap space immediately.`)){
                    releasePlayer(team.id, p.id);
                    // Force refresh
                    const parent = root.parentElement;
                    parent.innerHTML = "";
                    parent.appendChild(TeamScreen());
                }
            }
        });

        return el("tr", {}, [
            el("td", {}, p.name),
            el("td", {}, p.pos),
            el("td", {}, String(p.ovr)),
            el("td", {}, p.potentialGrade),
            el("td", {}, `${p.dev.focus} (${p.dev.points})`),
            el("td", {}, String(p.happiness)),
            el("td", {}, `${p.contract.years}y / ${p.contract.salary}M`),
            el("td", {}, `${(p.rotation?.minutes || 0)} min`), // Show mins here too
            el("td", {}, `${p.stats.pts.toFixed(1)}`),
            el("td", {}, cutBtn) // <--- Added button
        ]);
    });

  root.appendChild(card("Roster", "PTS/REB/AST are season averages.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Dev"),
        el("th", {}, "Happy"),
        el("th", {}, "Contract"),
        el("th", {}, "Mins"),
        el("th", {}, "PTS"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"10" }, "No roster found.")])
      ])
    ])
  ]));

  return root;
}
