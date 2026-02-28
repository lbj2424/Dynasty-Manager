import { el, card, button, showPlayerModal } from "../components.js";
import { getState } from "../../state.js";

export function StandingsScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);
  root.appendChild(card("Standings", "Sorted by wins (East/West).", [
    renderConf("EAST", g),
    el("div", { class:"sep" }),
    renderConf("WEST", g)
  ]));

  return root;
}

function renderConf(conf, g){
  const teams = g.league.teams
    .filter(t => t.conference === conf)
    .slice()
    .sort((a,b) => b.wins - a.wins || (a.losses - b.losses));

  const rows = teams.map((t, i) => el("tr", {}, [
    el("td", {}, String(i+1)),
    el("td", {}, el("span", {
      style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
      onclick: () => showTeamModal(t)
    }, t.name)),
    el("td", {}, `${t.wins}-${t.losses}`),
    el("td", {}, String(t.rating))
  ]));

  return el("div", {}, [
    el("div", { class:"h2" }, conf),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "#"),
        el("th", {}, "Team"),
        el("th", {}, "Record"),
        el("th", {}, "Rating")
      ])),
      el("tbody", {}, rows)
    ])
  ]);
}

function showTeamModal(team){
  const overlay = el("div", {
    style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;"
  }, []);

  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  const roster = (team.roster || []).slice().sort((a, b) => b.ovr - a.ovr);

  const rows = roster.map(p => el("tr", {}, [
    el("td", {}, el("span", {
      style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
      onclick: () => showPlayerModal(p)
    }, p.name)),
    el("td", {}, p.pos),
    el("td", { style: "font-weight:bold" }, String(p.ovr)),
    el("td", { style: "color:var(--good)" }, String(p.off ?? p.ovr)),
    el("td", { style: "color:var(--warn)" }, String(p.def ?? p.ovr)),
    el("td", {}, String(p.age)),
    el("td", {}, p.potentialGrade),
    el("td", {}, `${p.contract?.years ?? "?"}y / $${p.contract?.salary ?? "?"}M`)
  ]));

  const modal = el("div", {
    class: "card",
    style: "width:640px; max-width:92%; max-height:80vh; overflow-y:auto;"
  }, [
    el("div", { class:"spread" }, [
      el("div", {}, [
        el("div", { class:"h2" }, team.name),
        el("div", { class:"p" }, `${team.conference} · ${team.wins}-${team.losses} · Rating: ${team.rating} · Payroll: $${team.cap.payroll.toFixed(1)}M / $${team.cap.cap}M`)
      ]),
      button("Close", { small: true, onClick: close })
    ]),
    el("div", { class:"sep" }),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"), el("th", {}, "Pos"), el("th", {}, "OVR"),
        el("th", {}, "OFF"), el("th", {}, "DEF"), el("th", {}, "Age"),
        el("th", {}, "Pot"), el("th", {}, "Contract")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"8" }, "No roster data.")])
      ])
    ])
  ]);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
