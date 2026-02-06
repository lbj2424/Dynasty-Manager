import { el, card, badge } from "../components.js";
import { getState } from "../../state.js";

export function HistoryScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  const userTeam = g.league.teams[g.userTeamIndex];

  const hist = (g.history || []).slice().reverse(); // newest first

  root.appendChild(card("History", "Season-by-season results, champions, and awards.", [
    el("div", { class:"row" }, [
      badge(`Team: ${userTeam.name}`),
      badge(`Seasons Played: ${hist.length}`)
    ]),
  ]));

  const rows = hist.map(h => el("tr", {}, [
    el("td", {}, String(h.year)),
    el("td", {}, `${h.userRecord.wins}-${h.userRecord.losses}`),
    el("td", {}, h.userPlayoffFinish || "—"),
    el("td", {}, h.championTeam || "—"),
    el("td", {}, h.awards?.MVP ? `${h.awards.MVP.player} (${h.awards.MVP.team})` : "—"),
    el("td", {}, h.awards?.OPOY ? `${h.awards.OPOY.player} (${h.awards.OPOY.team})` : "—"),
    el("td", {}, h.awards?.DPOY ? `${h.awards.DPOY.player} (${h.awards.DPOY.team})` : "—"),
    el("td", {}, h.awards?.ROY ? `${h.awards.ROY.player} (${h.awards.ROY.team})` : "—"),
  ]));

  root.appendChild(card("Season Log", "Newest season at the top.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Year"),
        el("th", {}, "Your Record"),
        el("th", {}, "Your Playoffs"),
        el("th", {}, "Champion"),
        el("th", {}, "MVP"),
        el("th", {}, "OPOY"),
        el("th", {}, "DPOY"),
        el("th", {}, "ROY")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"8" }, "No history yet. Finish a season to record it.")])
      ])
    ])
  ]));

  return root;
}
