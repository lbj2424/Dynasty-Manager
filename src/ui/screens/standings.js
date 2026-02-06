import { el, card } from "../components.js";
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
    el("td", {}, t.name),
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
