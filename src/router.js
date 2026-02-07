import { HomeScreen } from "./ui/screens/home.js";
import { DashboardScreen } from "./ui/screens/dashboard.js";
import { ScoutingScreen } from "./ui/screens/scouting.js";
import { PlayoffsScreen } from "./ui/screens/playoffs.js";
import { FreeAgencyScreen } from "./ui/screens/freeAgency.js";
import { DraftScreen } from "./ui/screens/draft.js";
import { TeamScreen } from "./ui/screens/team.js";
import { StandingsScreen } from "./ui/screens/standings.js";
import { HistoryScreen } from "./ui/screens/history.js";
import { TradeScreen } from "./ui/screens/trade.js"; 
import { DepthChartScreen } from "./ui/screens/depthChart.js";
import { RetiredScreen } from "./ui/screens/retired.js"; // <--- ADD IMPORT

export const router = {
  "/": () => HomeScreen(),
  "/dashboard": () => DashboardScreen(),
  "/scouting": () => ScoutingScreen(),
  "/free-agency": () => FreeAgencyScreen(),
  "/draft": () => DraftScreen(),
  "/playoffs": () => PlayoffsScreen(),
  "/team": () => TeamScreen(),
  "/standings": () => StandingsScreen(),
  "/history": () => HistoryScreen(),
  "/trade": () => TradeScreen(),
  "/depth-chart": () => DepthChartScreen(),
  "/retired": () => RetiredScreen(), // <--- ADD ROUTE
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
