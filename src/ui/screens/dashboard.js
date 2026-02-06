import { el, card, button, badge } from "../components.js";
import {
  getState,
  advanceWeek,
  saveToSlot,
  getActiveSaveSlot,
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
        onClick: () => rerender(root, () => advanceWeek())
      })
    );

    if (g.week === g.seasonWeeks){
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
  button("Standings", { onClick: () => location.hash = "#/standings" }),
   button("History", { onClick: () => location.hash = "#/history" }),

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
      g.phase === PHASES.REGULAR ? badge(formatWeek(g.week, g.seasonWeeks)) : null,
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked (max ${g.hours.bankMax})`),
      phaseBadge
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, topButtons),
    el("div", { class:"sep" }),
    el("div", {}, [
      el("div", { class:"h2" }, "Inbox"),
      ...(g.inbox.length ? g.inbox.slice(0, 8).map(m => el("div", { class:"p" }, `• ${m.msg}`))
        : [el("div", { class:"p" }, "No messages yet.")])
    ])
  ]));

  return root;
}

function rerender(root, mut){
  if (mut) mut();
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DashboardScreen());
}
