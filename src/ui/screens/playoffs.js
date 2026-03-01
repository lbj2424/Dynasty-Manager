import { el, card, button, badge } from "../components.js";
import { getState, simPlayoffGame, simPlayoffRound } from "../../state.js";
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
  const rObj = bracket.rounds[bracket.round - 1];
  const activeSeries = rObj
    ? [...(rObj.east||[]), ...(rObj.west||[]), ...(rObj.finals||[])]
    : [];
  const roundDone = activeSeries.length > 0 && activeSeries.every(s => s.done);
  const activeCount = activeSeries.filter(s => !s.done).length;

  const buttons = [];
  if (!bracket.championTeamId){
    buttons.push(
      button("Sim Next Game", {
        primary: true,
        onClick: () => { simPlayoffGame(); rerender(root); }
      }),
      button("Sim Full Round", {
        onClick: () => { simPlayoffRound(); rerender(root); }
      })
    );
  }

  root.appendChild(card("Playoffs Bracket", "East/West top 8 each. Best of 7.", [
    el("div", { class:"row" }, [
      badge(`Round ${bracket.round} of 4`),
      bracket.championTeamId ? badge("Champion crowned!") : badge(`${activeCount} series active`),
      roundDone && !bracket.championTeamId ? badge("Round complete — advancing...") : null
    ].filter(Boolean)),
    buttons.length ? el("div", { class:"sep" }) : null,
    buttons.length ? el("div", { class:"row" }, buttons) : null
  ].filter(Boolean)));

  for (let i = 0; i < (bracket.rounds?.length || 0); i++){
    root.appendChild(renderRound(bracket.rounds[i], g, i === bracket.round - 1));
  }

  return root;
}

function renderRound(roundObj, g, isCurrent){
  const teamById = (id) => g.league.teams.find(t => t.id === id);

  const renderSeries = (seriesList) => {
    return (seriesList || []).map(s => {
      const A = teamById(s.a);
      const B = teamById(s.b);
      const games = s.games || [];

      let statusText, statusColor;
      if (s.done){
        const winner = teamById(s.winner);
        const wWins = s.winner === s.a ? s.aWins : s.bWins;
        const lWins = s.winner === s.a ? s.bWins : s.aWins;
        statusText = `${winner?.name} wins ${wWins}-${lWins}`;
        statusColor = "color:var(--good);";
      } else if (games.length === 0){
        statusText = "Not started";
        statusColor = "opacity:0.5;";
      } else {
        const nextGame = s.aWins + s.bWins + 1;
        if (s.aWins > s.bWins)      statusText = `${A?.name} lead ${s.aWins}-${s.bWins} — Game ${nextGame}`;
        else if (s.bWins > s.aWins) statusText = `${B?.name} lead ${s.bWins}-${s.aWins} — Game ${nextGame}`;
        else                         statusText = `Tied ${s.aWins}-${s.bWins} — Game ${nextGame}`;
        statusColor = "color:var(--accent);";
      }

      const gameLogItems = games.map(gm =>
        el("span", {
          style: `font-size:0.78em; padding:2px 6px; border:1px solid var(--line); border-radius:3px; white-space:nowrap; ${gm.scoreA > gm.scoreB ? "color:var(--good)" : "color:var(--warn)"}`,
        }, `G${gm.gameNum}: ${gm.scoreA}-${gm.scoreB}`)
      );

      return el("div", {
        style: "margin-bottom:8px; padding:8px 10px; border:1px solid var(--line); border-radius:4px;"
      }, [
        el("div", { class:"spread" }, [
          el("div", { style:"font-weight:bold;" }, `${A?.name || "TBD"} vs ${B?.name || "TBD"}`),
          el("div", { style: statusColor }, statusText)
        ]),
        games.length
          ? el("div", { style:"display:flex; gap:5px; flex-wrap:wrap; margin-top:6px;" }, gameLogItems)
          : null
      ].filter(Boolean));
    });
  };

  const wrapper = (inner) => isCurrent
    ? el("div", { style:"outline:1px solid var(--accent); border-radius:6px;" }, [inner])
    : inner;

  if (roundObj.name === "Finals"){
    return wrapper(card(roundObj.name, "", renderSeries(roundObj.finals || [])));
  }

  return wrapper(card(roundObj.name, "", [
    el("div", { class:"h2" }, "East"),
    ...renderSeries(roundObj.east || []),
    el("div", { class:"sep" }),
    el("div", { class:"h2" }, "West"),
    ...renderSeries(roundObj.west || [])
  ]));
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(PlayoffsScreen());
}
