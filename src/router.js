import { HomeScreen } from "./ui/screens/home.js";
import { DashboardScreen } from "./ui/screens/dashboard.js";
import { ScoutingScreen } from "./ui/screens/scouting.js";
import { PlayoffsScreen } from "./ui/screens/playoffs.js";
import { FreeAgencyScreen } from "./ui/screens/freeAgency.js";
import { DraftScreen } from "./ui/screens/draft.js";
import { TeamScreen } from "./ui/screens/team.js";
import { StandingsScreen } from "./ui/screens/standings.js";
import { HistoryScreen } from "./ui/screens/history.js";

export const router = {
  "/": () => HomeScreen(),               // <-- FIXED: Matches import name
  "/dashboard": () => DashboardScreen(), // <-- FIXED: Matches import name
  "/scouting": () => ScoutingScreen(),   // <-- FIXED: Matches import name
  "/free-agency": () => FreeAgencyScreen(),
  "/draft": () => DraftScreen(),
  "/playoffs": () => PlayoffsScreen(),
  "/team": () => TeamScreen(),           // <-- ADDED
  "/standings": () => StandingsScreen(), // <-- ADDED
  "/history": () => HistoryScreen()      // <-- ADDED
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
