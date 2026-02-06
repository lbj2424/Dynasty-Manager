import { el, card, button, badge } from "../components.js";
import { getState, advanceWeek, saveToSlot, getActiveSaveSlot } from "../../state.js";
import { formatWeek } from "../../utils.js";

export function DashboardScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  root.appendChild(card("Dashboard", "Your franchise at a glance.", [
    el("div", { class:"row" }, [
      badge(`Year ${g.year}`),
      badge(formatWeek(g.week, g.seasonWeeks)),
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked (max ${g.hours.bankMax})`)
    ]),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, [
      button("Advance Week", {
        primary: true,
        onClick: () => {
          advanceWeek();
          rerender(root);
        }
      }),
      button("Go to Scouting", {
        onClick: () => location.hash = "#/scouting"
      }),
      button("Save", {
        onClick: () => {
          const slot = getActiveSaveSlot() || "A";
          saveToSlot(slot);
          alert(`Saved to Slot ${slot}`);
        }
      })
    ]),
    el("div", { class:"sep" }),
    el("div", {}, [
      el("div", { class:"h2" }, "Inbox"),
      ...(g.inbox.length ? g.inbox.slice(0, 6).map(m =>
        el("div", { class:"p" }, `• ${m.msg}`)
      ) : [el("div", { class:"p" }, "No messages yet.")])
    ])
  ]));

  root.appendChild(card("League (v1)", "Teams are loaded, standings & schedule come next.", [
    el("div", { class:"p" }, `Teams: ${g.league.teams.length}`),
    el("div", { class:"p" }, `Your team: ${g.league.teams[g.userTeamIndex].name}`)
  ]));

  return root;
}

function rerender(root){
  // cheap rerender for v1
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DashboardScreen());
}
