import { el, card, button, badge, showPlayerModal } from "../components.js";
import {
  getState,
  advanceWeek,
  saveToSlot,
  getActiveSaveSlot,
  startPlayoffs,
  calculateAllStars // NEW: Import logic
} from "../../state.js";
import { formatWeek } from "../../utils.js";
import { PHASES } from "../../data/constants.js";

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
    button("Standings", { onClick: () => location.hash = "#/standings" }),
    button("History", { onClick: () => location.hash = "#/history" }),
    button("Retired", { onClick: () => location.hash = "#/retired" }), 
    button("Go to Scouting", { onClick: () => location.hash = "#/scouting" }),
    button("Save", {
      onClick: () => {
        const slot = getActiveSaveSlot() || "A";
        saveToSlot(slot);
        alert(`Saved to Slot ${slot}`);
      }
    })
  );

  root.appendChild(card("Dashboard", "Regular season → Playoffs → Free Agency → Draft.", [
    el("div", { class:"row" }, [
      badge(`Year ${g.year}`),
      g.phase === PHASES.REGULAR ? badge(formatWeek(Math.min(g.week, g.seasonWeeks), g.seasonWeeks)) : null,
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked (max ${g.hours.bankMax})`),
      phaseBadge
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, topButtons),
    el("div", { class:"sep" }),
    el("div", {}, [
      el("div", { class:"h2" }, "Inbox"),
      ...(g.inbox.length
        ? g.inbox.slice(0, 8).map(m => el("div", { class:"p" }, `• ${m.msg}`))
        : [el("div", { class:"p" }, "No messages yet.")])
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

    const modal = el("div", { class:"card", style:"width:600px; max-width:90%; max-height:80vh; overflow-y:auto;" }, [
        el("div", { class:"h2", style:"text-align:center; font-size:1.5em; color:var(--good);" }, "All-Star Rosters Announced!"),
        el("div", { class:"sep" }),
        el("div", { style:"display:flex; gap:20px; flex-wrap:wrap;" }, [
            renderRoster("Eastern Conference", allStars.east),
            renderRoster("Western Conference", allStars.west)
        ]),
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

function rerender(root, mut){
  if (mut) mut();
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DashboardScreen());
}
