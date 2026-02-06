import { mountRouter } from "./router.js";
import { loadActiveOrNull, ensureAppState, setActiveSaveSlot } from "./state.js";
import { router as routes } from "./router.js"; // <--- FIXED: Aliased 'router' to 'routes'

const appEl = document.getElementById("app");

// Try load last active save
const loaded = loadActiveOrNull();
if (loaded) {
  ensureAppState(loaded);
} else {
  ensureAppState(null);
}

mountRouter(appEl, routes);

// Default route
if (!location.hash) location.hash = "#/";
