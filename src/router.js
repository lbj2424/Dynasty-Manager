import { HomeScreen } from "./ui/screens/home.js";
import { DashboardScreen } from "./ui/screens/dashboard.js";
import { ScoutingScreen } from "./ui/screens/scouting.js";
import { PlayoffsScreen } from "./ui/screens/playoffs.js";
import { FreeAgencyScreen } from "./ui/screens/freeAgency.js";
import { DraftScreen } from "./ui/screens/draft.js";

export const routes = {
  "/": HomeScreen,
  "/dashboard": DashboardScreen,
  "/scouting": ScoutingScreen,
  "/playoffs": PlayoffsScreen,
  "/free-agency": FreeAgencyScreen,
  "/draft": DraftScreen
};

export function mountRouter(appEl, routesMap){
  function render(){
    const path = (location.hash || "#/").slice(1);
    const Screen = routesMap[path] || routesMap["/"];
    appEl.innerHTML = "";
    appEl.appendChild(Screen());
  }
  window.addEventListener("hashchange", render);
  render();
}
