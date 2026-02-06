export const SEASON_WEEKS = 20;

export const HOURS_PER_WEEK = 25;
export const HOURS_BANK_MAX = 60;

export const DECLARE_THRESHOLD = 75;

export const CONTINENTS = [
  { key:"NA", name:"North America", travelHours: 0, density: 1.00 },
  { key:"SA", name:"South America", travelHours: 6, density: 0.55 },
  { key:"EU", name:"Europe",        travelHours: 8, density: 0.80 },
  { key:"AF", name:"Africa",        travelHours: 10, density: 0.45 },
  { key:"AS", name:"Asia",          travelHours: 12, density: 0.60 },
  { key:"OC", name:"Oceania",       travelHours: 10, density: 0.35 },
  { key:"AN", name:"Antarctica",    travelHours: 20, density: 0.02 } // fun easter egg, almost empty
];

export const POTENTIAL_GRADES = ["A+","A","B","C","D","F"];

export const NBA_TEAM_NAMES_32 = [
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets",
  "Chicago Bulls","Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets",
  "Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
  "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat",
  "Milwaukee Bucks","Minnesota Timberwolves","New Orleans Pelicans","New York Knicks",
  "Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns",
  "Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors",
  "Utah Jazz","Washington Wizards",
  "Seattle Supersonics","Las Vegas Aces (Men)" // placeholders to reach 32 if needed
];
