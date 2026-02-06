import { HomeScreen } from "./ui/screens/home.js";
import { DashboardScreen } from "./ui/screens/dashboard.js";
import { ScoutingScreen } from "./ui/screens/scouting.js";
import { PlayoffsScreen } from "./ui/screens/playoffs.js";
import { FreeAgencyScreen } from "./ui/screens/freeAgency.js";
import { DraftScreen } from "./ui/screens/draft.js";
import { TeamScreen } from "./ui/screens/team.js";
import { StandingsScreen } from "./ui/screens/standings.js";
import { HistoryScreen } from "./ui/screens/history.js";


export const routes = {
  "/": HomeScreen,
  "/dashboard": DashboardScreen,
  "/team": TeamScreen,
  "/standings": StandingsScreen,
  "/scouting": ScoutingScreen,
  "/playoffs": PlayoffsScreen,
  "/free-agency": FreeAgencyScreen,
  "/draft": DraftScreen
  "/history": HistoryScreen,

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
