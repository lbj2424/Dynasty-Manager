import { el, card, badge, button, showPlayerModal } from "../components.js";
import { getState, releasePlayer, negotiateExtension } from "../../state.js";

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
                    rerender(root);
                }
            }
        });

        // FIX: Re-sign Button now prompts for confirmation
        let resignBtn = null;
        if (p.contract.years <= 2) {
            resignBtn = button("Extend", {
                small: true,
                onClick: () => {
                    const preview = negotiateExtension(team.id, p.id, false);
                    if (!preview.success) {
                        alert(preview.msg);
                        return;
                    }
                    if (confirm(preview.msg)) {
                        const res = negotiateExtension(team.id, p.id, true);
                        alert(res.msg);
                        if(res.success) rerender(root);
                    }
                }
            });
        }

        // Clickable Name
        const nameLink = el("span", { 
            style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
            onclick: () => showPlayerModal(p)
        }, p.name);

        return el("tr", {}, [
            el("td", {}, nameLink),
            el("td", {}, p.pos),
            el("td", { style:"font-weight:bold" }, String(p.ovr)),
            el("td", { style:"color:var(--good)" }, String(p.off ?? p.ovr)), 
            el("td", { style:"color:var(--warn)" }, String(p.def ?? p.ovr)), 
            el("td", {}, p.potentialGrade),
            el("td", {}, String(p.age)),
            el("td", {}, String(p.happiness)),
            el("td", {}, `${p.contract.years}y / ${p.contract.salary}M`),
            el("td", {}, `${(p.rotation?.minutes || 0)} min`),
            el("td", {}, `${p.stats.pts.toFixed(1)}`),
            el("td", { style:"display:flex; gap:4px;" }, [resignBtn, cutBtn])
        ]);
    });

  root.appendChild(card("Roster", "Click names for history. Extensions allowed with <= 2 years left.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "OFF"), 
        el("th", {}, "DEF"), 
        el("th", {}, "Pot"),
        el("th", {}, "Age"),
        el("th", {}, "Happy"),
        el("th", {}, "Contract"),
        el("th", {}, "Mins"),
        el("th", {}, "PTS"),
        el("th", {}, "Actions")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"12" }, "No roster found.")])
      ])
    ])
  ]));

  return root;
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(TeamScreen());
}
