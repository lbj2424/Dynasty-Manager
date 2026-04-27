import { el, card, button, badge, showPlayerModal } from "../components.js";
import {
  getState,
  advanceWeek,
  saveToSlot,
  getActiveSaveSlot,
  startPlayoffs,
  calculateAllStars
} from "../../state.js";
import { formatWeek } from "../../utils.js";
import { PHASES, TRADE_DEADLINE_WEEK } from "../../data/constants.js";

export function DashboardScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  const phaseBadge = badge(`Phase: ${g.phase}`);
  const topButtons = [];

  if (g.phase === PHASES.REGULAR){
    topButtons.push(
      button("Advance Week", {
        primary: true,
        onClick: () => {
          advanceWeek();
          // NEW: Trigger All-Star announcement at end of regular season
          if (g.week > g.seasonWeeks && g.phase === PHASES.REGULAR) {
              const allStars = calculateAllStars(g);
              showAllStarModal(allStars, () => rerender(root));
          } else {
              rerender(root);
          }
        }
      })
    );

    if (g.week > g.seasonWeeks){
      topButtons.push(
        button("Start Playoffs", {
          primary: true,
          onClick: () => {
            startPlayoffs();
            location.hash = "#/playoffs";
          }
        })
      );
    }
  }

  if (g.phase === PHASES.PLAYOFFS){
    topButtons.push(button("Go to Playoffs", { primary:true, onClick: () => location.hash = "#/playoffs" }));
  }
  if (g.phase === PHASES.FREE_AGENCY){
    topButtons.push(button("Go to Free Agency", { primary:true, onClick: () => location.hash = "#/free-agency" }));
  }
  if (g.phase === PHASES.DRAFT){
    topButtons.push(button("Go to Draft", { primary:true, onClick: () => location.hash = "#/draft" }));
  }

  topButtons.push(
    button("My Team", { onClick: () => location.hash = "#/team" }),
    button("Trade", { onClick: () => location.hash = "#/trade" }),
    g.phase === PHASES.REGULAR
        ? button(`Available Players${(g.midseasonFaPool?.length > 0) ? ` (${g.midseasonFaPool.length})` : ""}`, { onClick: () => location.hash = "#/available-players" })
        : null,
    button("Standings", { onClick: () => location.hash = "#/standings" }),
    button("League Leaders", { onClick: () => location.hash = "#/league-leaders" }),
    button("History", { onClick: () => location.hash = "#/history" }),
    button("Retired", { onClick: () => location.hash = "#/retired" }),
    button("Go to Scouting", { onClick: () => location.hash = "#/scouting" }),
    g.lastSeasonRecap
        ? button(`Season ${g.lastSeasonRecap.year} Recap`, {
            primary: true,
            onClick: () => showSeasonRecapModal(g.lastSeasonRecap, () => rerender(root))
          })
        : null,
    button("Save", {
      onClick: () => {
        const slot = getActiveSaveSlot() || "A";
        saveToSlot(slot);
        alert(`Saved to Slot ${slot}`);
      }
    })
  );

  // Auto-show season recap once when landing on dashboard after playoffs end
  if (g.lastSeasonRecap && !g.lastSeasonRecap.viewed) {
    setTimeout(() => showSeasonRecapModal(g.lastSeasonRecap, () => rerender(root)), 50);
  }

  root.appendChild(card("Dashboard", "Regular season → Playoffs → Free Agency → Draft.", [
    el("div", { class:"row" }, [
      badge(`Year ${g.year}`),
      g.phase === PHASES.REGULAR ? badge(formatWeek(Math.min(g.week, g.seasonWeeks), g.seasonWeeks)) : null,
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked (max ${g.hours.bankMax})`),
      phaseBadge,
      g.phase === PHASES.REGULAR && g.week >= 15 && g.week <= TRADE_DEADLINE_WEEK
          ? el("div", { class:"badge", style:"background:var(--warn); font-weight:bold;" },
              `TRADE DEADLINE: Week ${TRADE_DEADLINE_WEEK} (${TRADE_DEADLINE_WEEK - g.week} week${TRADE_DEADLINE_WEEK - g.week === 1 ? '' : 's'} left)`)
          : null
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, topButtons.filter(Boolean)),
    el("div", { class:"sep" }),
    el("div", {}, [
      el("div", { class:"h2" }, "Inbox"),
      el("div", { style:"max-height:400px; overflow-y:auto;" },
        g.inbox.length
          ? g.inbox.map(m => el("div", { class:"p" }, `• ${m.msg}`))
          : [el("div", { class:"p" }, "No messages yet.")]
      )
    ])
  ]));

  return root;
}

function showAllStarModal(allStars, onClose) {
    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const renderRoster = (title, list) => {
        return el("div", { style:"flex:1; min-width:200px;" }, [
            el("div", { class:"h2", style:"text-align:center; border-bottom:1px solid var(--line); padding-bottom:4px;" }, title),
            ...list.map(p => el("div", {
                class:"p",
                style:"display:flex; justify-content:space-between; cursor:pointer;",
                onclick: () => showPlayerModal(p)
            }, [
                el("span", {}, `${p.pos} - ${p.name}`),
                el("span", { style:"color:var(--accent); font-size:0.85em;" }, p.teamName)
            ]))
        ]);
    };

    const renderSnubs = (title, snubs) => {
        if (!snubs || !snubs.length) return null;
        return el("div", { style:"margin-top:12px;" }, [
            el("div", { class:"h2", style:"font-size:0.9em; color:var(--warn); margin-bottom:4px;" }, title),
            el("div", { style:"display:flex; flex-wrap:wrap; gap:6px;" },
                snubs.map(p => el("div", {
                    class:"badge",
                    style:"background:rgba(255,165,0,0.15); border:1px solid var(--warn); cursor:pointer; font-size:0.85em;",
                    onclick: () => showPlayerModal(p)
                }, `${p.pos} ${p.name} (${p.teamName})`))
            )
        ]);
    };

    const modal = el("div", { class:"card", style:"width:650px; max-width:90%; max-height:80vh; overflow-y:auto;" }, [
        el("div", { class:"h2", style:"text-align:center; font-size:1.5em; color:var(--good);" }, "All-Star Rosters Announced!"),
        el("div", { class:"sep" }),
        el("div", { style:"display:flex; gap:20px; flex-wrap:wrap;" }, [
            renderRoster("Eastern Conference", allStars.east),
            renderRoster("Western Conference", allStars.west)
        ]),
        renderSnubs("East Snubs (just missed)", allStars.eastSnubs),
        renderSnubs("West Snubs (just missed)", allStars.westSnubs),
        el("div", { class:"sep" }),
        button("Continue to Playoffs", {
            primary: true,
            style: "width:100%",
            onClick: () => {
                document.body.removeChild(overlay);
                onClose();
            }
        })
    ]);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function showSeasonRecapModal(recap, onClose) {
    recap.viewed = true;

    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        onClose();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const awardRow = (label, val) => val
        ? el("div", { style: "display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.07);" }, [
            el("span", { style: "opacity:0.65;" }, label),
            el("span", { style: "font-weight:bold;" }, `${val.player} (${val.team})`)
          ])
        : null;

    const miniStatTable = (leaders, label) => {
        if (!leaders || !leaders.length) return null;
        const rows = leaders.slice(0, 3).map((p, i) =>
            el("div", { style: "display:flex; justify-content:space-between; font-size:0.88em; padding:2px 0;" }, [
                el("span", { style: "opacity:0.5; width:18px;" }, `${i + 1}.`),
                el("span", { style: "flex:1;" }, p.name),
                el("span", { style: "opacity:0.6; font-size:0.85em; margin-right:8px;" }, p.team),
                el("span", { style: "font-weight:bold; color:var(--accent); width:40px; text-align:right;" }, String(p[label]))
            ])
        );
        return el("div", { style: "flex:1; min-width:140px;" }, rows);
    };

    const finishColor = recap.userFinish === "Champion" ? "var(--good)"
        : recap.userFinish === "Finals" ? "var(--accent)"
        : "var(--text)";

    const modal = el("div", { class: "card", style: "width:620px; max-width:92%; max-height:88vh; overflow-y:auto;" }, [
        el("div", { style: "text-align:center; padding-bottom:8px;" }, [
            el("div", { style: "font-size:1.7em; font-weight:bold; color:var(--good);" }, `${recap.year} Season Complete`),
            el("div", { style: "font-size:1.1em; color:var(--accent); margin-top:4px;" }, `${recap.champion} are Champions!`)
        ]),
        el("div", { class: "sep" }),

        el("div", { style: "display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px;" }, [
            el("div", { class: "card", style: "flex:1; min-width:140px; padding:10px;" }, [
                el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:4px;" }, "YOUR SEASON"),
                el("div", { style: "font-size:1.4em; font-weight:bold;" }, recap.userRecord),
                el("div", { style: `color:${finishColor}; font-weight:bold; margin-top:4px;` }, recap.userFinish)
            ]),
            el("div", { class: "card", style: "flex:2; min-width:220px; padding:10px;" }, [
                el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:6px;" }, "AWARDS"),
                awardRow("MVP", recap.awards?.MVP),
                awardRow("DPOY", recap.awards?.DPOY),
                awardRow("OPOY", recap.awards?.OPOY),
                awardRow("ROY", recap.awards?.ROY)
            ].filter(Boolean))
        ]),

        recap.statsLeaders ? el("div", { class: "card", style: "padding:10px;" }, [
            el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:8px;" }, "STATS LEADERS (TOP 3)"),
            el("div", { style: "display:flex; gap:16px; flex-wrap:wrap;" }, [
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "POINTS PER GAME"),
                    miniStatTable(recap.statsLeaders.ppg, "ppg")
                ]),
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "REBOUNDS PER GAME"),
                    miniStatTable(recap.statsLeaders.rpg, "rpg")
                ]),
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "ASSISTS PER GAME"),
                    miniStatTable(recap.statsLeaders.apg, "apg")
                ])
            ].filter(Boolean))
        ]) : null,

        el("div", { class: "sep" }),
        el("div", { style: "display:flex; gap:8px;" }, [
            el("button", {
                class: "btn btnPrimary",
                style: "flex:1;",
                onclick: () => { close(); location.hash = "#/free-agency"; }
            }, "Go to Free Agency"),
            el("button", {
                class: "btn",
                onclick: close
            }, "Close")
        ])
    ].filter(Boolean));

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function rerender(root, mut){
  if (mut) mut();
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DashboardScreen());
}
