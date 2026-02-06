export const SEASON_WEEKS = 20;

export const HOURS_PER_WEEK = 25;
export const HOURS_BANK_MAX = 60;

export const DECLARE_THRESHOLD = 75;

export const SALARY_CAP = 120;      // cap in "millions"
export const ROSTER_MAX = 15;

export const PHASES = {
  REGULAR: "REGULAR",
  PLAYOFFS: "PLAYOFFS",
  FREE_AGENCY: "FREE_AGENCY",
  DRAFT: "DRAFT"
};

export const CONTINENTS = [
  { key:"NA", name:"North America", travelHours: 0,  density: 1.00 },
  { key:"SA", name:"South America", travelHours: 6,  density: 0.55 },
  { key:"EU", name:"Europe",        travelHours: 8,  density: 0.80 },
  { key:"AF", name:"Africa",        travelHours: 10, density: 0.45 },
  { key:"AS", name:"Asia",          travelHours: 12, density: 0.60 },
  { key:"OC", name:"Oceania",       travelHours: 10, density: 0.35 },
  { key:"AN", name:"Antarctica",    travelHours: 20, density: 0.02 }
];

export const POTENTIAL_GRADES = ["A+","A","B","C","D","F"];

// 32 teams (your request)
export const NBA_TEAM_NAMES_32 = [
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets",
  "Chicago Bulls","Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets",
  "Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
  "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat",
  "Milwaukee Bucks","Minnesota Timberwolves","New Orleans Pelicans","New York Knicks",
  "Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns",
  "Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors",
  "Utah Jazz","Washington Wizards",
  "Seattle Supersonics","Las Vegas Vipers"
];

// East/West mapping for the first 30 (NBA style), plus the 2 extras placed West by default.
// You can move them later if you want.
export const EAST_TEAMS = new Set([
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets",
  "Chicago Bulls","Cleveland Cavaliers","Detroit Pistons","Indiana Pacers",
  "Miami Heat","Milwaukee Bucks","New York Knicks","Orlando Magic",
  "Philadelphia 76ers","Toronto Raptors","Washington Wizards"
]);

export const WEST_TEAMS = new Set([
  "Dallas Mavericks","Denver Nuggets","Golden State Warriors","Houston Rockets",
  "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Minnesota Timberwolves",
  "New Orleans Pelicans","Oklahoma City Thunder","Phoenix Suns","Portland Trail Blazers",
  "Sacramento Kings","San Antonio Spurs","Utah Jazz",
  "Seattle Supersonics","Las Vegas Vipers"
]);
