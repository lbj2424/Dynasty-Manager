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

  // League standings history — show all teams' records per season
  if (hist.length > 0) {
    let selectedYear = hist[0].year; // default to most recent
    const container = el("div", {});

    const renderStandings = () => {
      container.innerHTML = "";
      const entry = hist.find(h => h.year === selectedYear);
      if (!entry || !entry.allTeamRecords) {
        container.appendChild(el("div", { class:"p", style:"opacity:0.6" }, "No league standings data for this season."));
        return;
      }

      const east = [...entry.allTeamRecords].filter(t => t.conference === "EAST").sort((a,b) => b.wins - a.wins);
      const west = [...entry.allTeamRecords].filter(t => t.conference === "WEST").sort((a,b) => b.wins - a.wins);

      const renderConf = (title, teams) => el("div", { style:"flex:1; min-width:200px;" }, [
        el("div", { class:"h2", style:"margin-bottom:6px;" }, title),
        el("table", { class:"table" }, [
          el("thead", {}, el("tr", {}, [
            el("th", {}, "#"),
            el("th", {}, "Team"),
            el("th", {}, "W"),
            el("th", {}, "L"),
            el("th", {}, "")
          ])),
          el("tbody", {}, teams.map((t, i) => el("tr", {
            style: t.name === userTeam.name ? "background:rgba(var(--accent-rgb,100,200,255),0.1);" : ""
          }, [
            el("td", { style:"opacity:0.6;" }, String(i + 1)),
            el("td", { style:"font-weight:bold;" }, t.name),
            el("td", { style:"color:var(--good);" }, String(t.wins)),
            el("td", { style:"color:var(--bad);" }, String(t.losses)),
            el("td", {}, t.madePlayoffs ? el("span", { class:"badge", style:"background:var(--good); font-size:0.75em;" }, "Playoffs") : "")
          ])))
        ])
      ]);

      container.appendChild(el("div", { style:"display:flex; gap:20px; flex-wrap:wrap;" }, [
        renderConf("Eastern Conference", east),
        renderConf("Western Conference", west)
      ]));
    };

    const yearSelect = el("select", {
      style: "padding:6px; margin-bottom:12px;",
      onchange: (e) => { selectedYear = parseInt(e.target.value); renderStandings(); }
    }, hist.map(h => el("option", { value: String(h.year), selected: h.year === selectedYear }, `${h.year} Season`)));

    renderStandings();

    root.appendChild(card("League Standings History", "All teams' final records by season.", [
      yearSelect,
      container
    ]));
  }

  return root;
}
