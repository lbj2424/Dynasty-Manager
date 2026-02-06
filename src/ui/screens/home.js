import { el, card, button, badge } from "../components.js";
import { getState, newGameState, ensureAppState, saveToSlot, loadFromSlot, deleteSlot, setActiveSaveSlot } from "../../state.js";

const SLOTS = ["A","B","C"];

export function HomeScreen(){
  const root = el("div", {}, []);

  root.appendChild(card("Home", "Choose a save slot or start fresh.", [
    el("div", { class:"row" }, [
      badge("Saves: A / B / C"),
      badge("Local only"),
      badge("Desktop-first")
    ]),
    el("div", { class:"sep" }),
    el("div", { class:"grid" }, SLOTS.map(slot => renderSlot(slot)))
  ]));

  return root;
}

function renderSlot(slot){
  const raw = localStorage.getItem("dynasty_save_" + slot);
  const has = !!raw;

  const actions = el("div", { class:"row" }, [
    button(has ? "Load" : "New", {
      primary: true,
      onClick: () => {
        if (has){
          const ok = loadFromSlot(slot);
          if (ok) location.hash = "#/dashboard";
        } else {
          ensureAppState(null);
          setActiveSaveSlot(slot);
          saveToSlot(slot);
          location.hash = "#/dashboard";
        }
      }
    }),
    button("Save", {
      onClick: () => {
        // If empty slot, create a new game first
        const st = getState();
        if (!st) ensureAppState(null);
        saveToSlot(slot);
        alert(`Saved to Slot ${slot}`);
      }
    }),
    button("Delete", {
      danger: true,
      onClick: () => {
        deleteSlot(slot);
        location.reload();
      }
    })
  ]);

  const info = has ? "Saved game found." : "Empty slot.";

  return el("div", { class:"card" }, [
    el("div", { class:"spread" }, [
      el("div", {}, [
        el("div", { class:"h2" }, `Slot ${slot}`),
        el("div", { class:"p" }, info)
      ]),
      badge(has ? "READY" : "EMPTY")
    ]),
    el("div", { class:"sep" }),
    actions
  ]);
}
