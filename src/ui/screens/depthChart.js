import { el, card, button, badge } from "../components.js";
import { getState, saveToSlot, getActiveSaveSlot } from "../../state.js";

export function DepthChartScreen(){
  const s = getState();
  const g = s.game;
  const team = g.league.teams[g.userTeamIndex];

  // Ensure everyone has rotation object
  team.roster.forEach(p => {
      p.rotation ??= { minutes: 0, isStarter: false };
  });

  const root = el("div", {}, []);

  // Calculation
  const totalMins = team.roster.reduce((sum, p) => sum + (p.rotation.minutes || 0), 0);
  const MAX_MINS = 205; 
  
  // Count starters by position
  const starters = { PG:0, SG:0, SF:0, PF:0, C:0 };
  let starterCount = 0;
  team.roster.forEach(p => {
      if(p.rotation.isStarter) {
          if(starters[p.pos] !== undefined) starters[p.pos]++;
          starterCount++;
      }
  });

  const statusColor = totalMins === MAX_MINS ? "var(--good)" : totalMins > MAX_MINS ? "var(--bad)" : "var(--warn)";
  // Valid lineup = exactly 1 at each position
  const isValidLineup = starters.PG===1 && starters.SG===1 && starters.SF===1 && starters.PF===1 && starters.C===1;
  const starterColor = isValidLineup ? "var(--good)" : "var(--bad)";
  
  root.appendChild(card("Depth Chart", "Lineup must have 1 starter per position.", [
      el("div", { class:"row" }, [
          badge(`Roster: ${team.roster.length}`),
          el("span", { class:"badge", style:`color:${statusColor}; border-color:${statusColor}` }, `Allocated: ${totalMins} / ${MAX_MINS}`),
          el("span", { class:"badge", style:`color:${starterColor}; border-color:${starterColor}` }, 
            isValidLineup ? "Lineup Valid" : `Invalid (Need 1 of each PG/SG/SF/PF/C)`
          )
      ]),
      el("div", { class:"sep" }),
      el("div", { class:"row" }, [
        button("Auto-Distribute", {
            onClick: () => {
                // We need to import the new autoDistribute logic from state or replicate it here. 
                // Since this file can't import the helper from state easily without exporting it,
                // I will include the logic locally here for the UI button.
                autoDistributeUI(team); 
                rerender(root);
            }
        }),
        button("Save Changes", {
            primary: true,
            onClick: () => {
                if(!isValidLineup) return alert("Invalid Lineup! You must have exactly one starter for each position (PG, SG, SF, PF, C).");
                const slot = getActiveSaveSlot() || "A";
                saveToSlot(slot);
                alert(`Rotation saved to Slot ${slot}.`);
            }
        })
      ])
  ]));

  // Roster List Sorted by Position then OVR
  const posOrder = { "PG":1, "SG":2, "SF":3, "PF":4, "C":5 };
  const sortedRoster = team.roster.slice().sort((a,b) => {
      if (posOrder[a.pos] !== posOrder[b.pos]) return posOrder[a.pos] - posOrder[b.pos];
      return b.ovr - a.ovr;
  });

  const rows = sortedRoster.map(p => {
      
      const minInput = el("input", { 
          type:"number", 
          min:"0", 
          max:"48", 
          value: String(p.rotation.minutes),
          style: "width:60px; padding:4px; border-radius:4px; border:1px solid var(--line); background:rgba(0,0,0,0.2); color:var(--text);"
      });

      minInput.onchange = (e) => {
          let val = parseInt(e.target.value) || 0;
          if (val < 0) val = 0;
          if (val > 48) val = 48;
          p.rotation.minutes = val;
          rerender(root);
      };

      const startCheck = el("input", { type:"checkbox", checked: !!p.rotation.isStarter });
      startCheck.onchange = (e) => {
          if (e.target.checked) {
              // Uncheck everyone else of this position
              team.roster.forEach(other => {
                  if (other.pos === p.pos && other.id !== p.id) {
                      other.rotation.isStarter = false;
                  }
              });
              p.rotation.isStarter = true;
          } else {
              p.rotation.isStarter = false;
          }
          rerender(root);
      };

      return el("tr", {}, [
          el("td", {}, p.name),
          el("td", {}, p.pos),
          el("td", {}, String(p.ovr)),
          el("td", {}, `${p.stats.pts.toFixed(1)} PPG`),
          el("td", {}, startCheck),
          el("td", {}, minInput),
          el("td", {}, el("div", { 
              style:`width:${p.rotation.minutes*2}px; height:6px; background:var(--accent); border-radius:2px; opacity:0.7` 
          }))
      ]);
  });

  root.appendChild(card("Rotation", "Check 'Start' to set the starter for that position.", [
      el("table", { class:"table" }, [
          el("thead", {}, el("tr", {}, [
              el("th", {}, "Player"),
              el("th", {}, "Pos"),
              el("th", {}, "OVR"),
              el("th", {}, "Stats"),
              el("th", {}, "Start"),
              el("th", {}, "Mins"),
              el("th", {}, "Vis")
          ])),
          el("tbody", {}, rows)
      ])
  ]));

  return root;
}

// Local version for the UI button
function autoDistributeUI(team){
    team.roster.forEach(p => { p.rotation = { minutes: 0, isStarter: false }; });
    let remain = 205; 
    const positions = ["PG","SG","SF","PF","C"];
    
    // Starters
    for (const pos of positions) {
        const candidates = team.roster
            .filter(p => p.pos === pos && !p.rotation.isStarter)
            .sort((a,b) => b.ovr - a.ovr);
        
        if (candidates.length > 0) {
            candidates[0].rotation.isStarter = true;
            candidates[0].rotation.minutes = 34;
            remain -= 34;
        }
    }
    // Bench
    const bench = team.roster.filter(p => !p.rotation.isStarter).sort((a,b) => b.ovr - a.ovr);
    for (let i = 0; i < Math.min(5, bench.length); i++) {
        bench[i].rotation.minutes = 10;
        remain -= 10;
    }
    // Remainder
    const best = team.roster.sort((a,b)=>b.ovr-a.ovr)[0];
    if(best && remain > 0) best.rotation.minutes += remain;
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DepthChartScreen());
}
