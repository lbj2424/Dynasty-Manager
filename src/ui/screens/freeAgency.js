import { el, card, button, badge, showPlayerModal } from "../components.js";
import { getState, startDraft } from "../../state.js";
import { PHASES } from "../../data/constants.js";

export function FreeAgencyScreen(){
  const s = getState();
  const g = s.game;

  // Internal State for filtering (reset if leaving screen usually, but can attach to s if needed persistence)
  if (!s.faFilter) {
      s.faFilter = { pos: "All", sort: "OVR" };
  }
  const filter = s.faFilter;

  const root = el("div", {}, []);

  if (g.phase !== PHASES.FREE_AGENCY){
    root.appendChild(card("Free Agency", "Not currently active.", [
      el("div", { class:"p" }, "Wait for the offseason.")
    ]));
    return root;
  }

  const fa = g.offseason.freeAgents;
  const team = g.league.teams[g.userTeamIndex];
  const capSpace = Math.max(0, team.cap.cap - team.cap.payroll);

  // --- FILTERS ---
  const posOpts = ["All", "PG", "SG", "SF", "PF", "C"];
  const sortOpts = ["OVR", "Age", "Ask"];

  const filterBar = el("div", { class:"row", style:"gap:10px; margin-bottom:10px;" }, [
      el("span", {}, "Position: "),
      el("select", { onchange: (e) => { filter.pos = e.target.value; rerender(root); } }, 
          posOpts.map(o => el("option", { value:o, selected:o===filter.pos }, o))
      ),
      el("span", {}, "Sort: "),
      el("select", { onchange: (e) => { filter.sort = e.target.value; rerender(root); } },
          sortOpts.map(o => el("option", { value:o, selected:o===filter.sort }, o))
      )
  ]);

  // --- FILTER & SORT LOGIC ---
  let displayList = fa.pool.filter(p => !p.signedByTeamId); // Only unsigned

  if (filter.pos !== "All") {
      displayList = displayList.filter(p => p.pos === filter.pos);
  }

  if (filter.sort === "OVR") displayList.sort((a,b) => b.ovr - a.ovr);
  else if (filter.sort === "Age") displayList.sort((a,b) => a.age - b.age);
  else if (filter.sort === "Ask") displayList.sort((a,b) => a.ask - b.ask);

  // Show top 300 to allow finding deep bench players
  const rows = displayList.slice(0, 300).map(p => {
    const canAfford = capSpace >= p.ask;
    
    // Clickable Name
    const nameLink = el("span", { 
        style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
        onclick: () => showPlayerModal(p)
    }, p.name);

    return el("tr", {}, [
      el("td", {}, nameLink),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, String(p.age)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `$${p.ask}M / ${p.yearsAsk}y`),
      el("td", {}, button("Sign", {
        small: true,
        disabled: !canAfford,
        onClick: () => {
          if(!canAfford){
             alert("Not enough cap space!"); 
             return;
          }
          signPlayer(p, team.id, g);
          rerender(root);
        }
      }))
    ]);
  });

  root.appendChild(card("Free Agency", `Cap Space: $${capSpace.toFixed(2)}M`, [
    filterBar,
    el("div", { class:"sep" }),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Age"),
        el("th", {}, "Pot"),
        el("th", {}, "Ask"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"7" }, "No players found.")])
      ])
    ]),
    el("div", { class:"sep" }),
    button("Finish Free Agency -> Draft", {
      primary: true,
      onClick: () => {
        // Auto-fill CPU rosters
        simCpuFreeAgency(g);
        startDraft();
        location.hash = "#/draft";
      }
    })
  ]));

  return root;
}

function signPlayer(p, teamId, g){
    const team = g.league.teams.find(t => t.id === teamId);
    if (!team) return;
    
    p.signedByTeamId = teamId;
    p.contract = { years: p.yearsAsk, salary: p.ask };
    
    // Move from pool to roster
    team.roster.push(p);
    
    // Recalc payroll
    team.cap.payroll = Number(team.roster.reduce((sum,x)=> sum + (x.contract?.salary || 0), 0).toFixed(1));
}

function simCpuFreeAgency(g){
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    // Simple fill: Each team signs best available until 10 players or cap full
    for (const t of cpuTeams){
        let space = t.cap.cap - t.cap.payroll;
        while (t.roster.length < 10 && space > 0.5){
            const best = fa.pool.find(p => !p.signedByTeamId && p.ask <= space);
            if (!best) break;
            signPlayer(best, t.id, g);
            space = t.cap.cap - t.cap.payroll;
        }
    }
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(FreeAgencyScreen());
}
