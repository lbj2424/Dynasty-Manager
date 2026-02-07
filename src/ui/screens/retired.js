import { el, card, badge } from "../components.js";
import { getState } from "../../state.js";

export function RetiredScreen(){
  const s = getState();
  const g = s.game;

  const list = g.retiredPlayers || [];
  // Sort by Year (most recent first), then OVR
  list.sort((a,b) => b.retiredYear - a.retiredYear || b.ovr - a.ovr);

  const rows = list.map(p => el("tr", {}, [
      el("td", {}, String(p.retiredYear)),
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)), // Final OVR
      el("td", {}, String(p.age)), // Retired Age
      el("td", {}, p.finalTeam || "-")
  ]));

  return el("div", {}, [
      card("Retired Players", "Hall of Fame & Retirements", [
          el("table", { class:"table" }, [
              el("thead", {}, el("tr", {}, [
                  el("th", {}, "Year"),
                  el("th", {}, "Name"),
                  el("th", {}, "Pos"),
                  el("th", {}, "Final OVR"),
                  el("th", {}, "Age"),
                  el("th", {}, "Last Team")
              ])),
              el("tbody", {}, rows.length ? rows : [
                  el("tr", {}, [el("td", { colspan:6 }, "No retired players yet.")])
              ])
          ])
      ])
  ]);
}
