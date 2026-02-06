import { el, card, button } from "../components.js";
import { newGameState, saveToSlot, loadFromSlot, deleteSlot } from "../../state.js";
import { generateLeague } from "../../gen/league.js";

export function HomeScreen(){
  const root = el("div", {}, []);

  // build list of teams for dropdown
  const leaguePreview = generateLeague({ seed: "v1_seed" });
  const teams = leaguePreview.teams;

  const teamSelect = el("select", {}, teams.map((t, idx) =>
    el("option", { value:String(idx) }, `${t.name} (${t.conference})`)
  ));

  root.appendChild(card("Dynasty Manager", "Pick a team, then pick a save slot.", [
    el("div", { class:"p" }, "Choose Team:"),
    teamSelect,
    el("div", { class:"sep" }),

    slotCard("A", teamSelect),
    slotCard("B", teamSelect),
    slotCard("C", teamSelect),
  ]));

  return root;
}

function slotCard(slot, teamSelect){
  return el("div", {}, [
    el("div", { class:"h2" }, `Save Slot ${slot}`),
    el("div", { class:"row" }, [
      button("New Game", {
        primary: true,
        onClick: () => {
          const userTeamIndex = Number(teamSelect.value || 0);
          const st = newGameState({ userTeamIndex });
          // save and load
          localStorage.setItem("dynasty_active_slot", slot);
          localStorage.setItem("dynasty_save_" + slot, JSON.stringify(st));
          loadFromSlot(slot);
          location.hash = "#/dashboard";
        }
      }),
      button("Load", {
        onClick: () => {
          const ok = loadFromSlot(slot);
          if (!ok) return alert("No save found in this slot.");
          location.hash = "#/dashboard";
        }
      }),
      button("Delete", {
        onClick: () => {
          deleteSlot(slot);
          alert(`Deleted Slot ${slot}`);
        }
      })
    ]),
    el("div", { class:"sep" })
  ]);
}
