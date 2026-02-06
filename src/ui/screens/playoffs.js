import { el, card, button, badge } from "../components.js";
import { getState, simPlayoffRound } from "../../state.js";
import { PHASES } from "../../data/constants.js";

export function PlayoffsScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  if (g.phase !== PHASES.PLAYOFFS){
    root.appendChild(card("Playoffs", "Not currently in playoffs.", [
      el("div", { class:"p" }, "Go back to Dashboard and start playoffs after Week 20.")
    ]));
    return root;
  }

  const bracket = g.playoffs;

  root.appendChild(card("Playoffs Bracket", "Top 16 overall. Best of 7. Sim a whole round at a time.", [
    el("div", { class:"row" }, [
      badge(`Round ${bracket.round} of 4`),
      bracket.championTeamId ? badge("Champion crowned") : null
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    button("Sim Current Round", {
      primary: true,
      onClick: () => {
        simPlayoffRound();
        rerender(root);
      }
    })
  ]));

  for (let i=0;i<bracket.rounds.length;i++){
    const r = bracket.rounds[i];
    root.appendChild(renderRound(r.name, r.series, g));
  }

  return root;
}

function renderRound(name, seriesList, g){
  const teamById = (id) => g.league.teams.find(t => t.id === id);

  const rows = (seriesList || []).map(s => {
    const A = teamById(s.a);
    const B = teamById(s.b);
    const score = s.done ? `${s.aWins}-${s.bWins}` : "—";
    const winner = s.done ? teamById(s.winner)?.name : "";

    return el("tr", {}, [
      el("td", {}, A?.name || "TBD"),
      el("td", {}, B?.name || "TBD"),
      el("td", {}, score),
      el("td", {}, winner)
    ]);
  });

  return card(name, "", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Team A"),
        el("th", {}, "Team B"),
        el("th", {}, "Series"),
        el("th", {}, "Winner")
      ])),
      el("tbody", {}, rows.length ? rows : [el("tr", {}, [
        el("td", { colspan:"4" }, "TBD")
      ])])
    ])
  ]);
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(PlayoffsScreen());
}
