import { el, card, button, badge } from "../components.js";
import { getState, saveToSlot, getActiveSaveSlot } from "../../state.js";

export function DepthChartScreen(){
  const s = getState();
  const g = s.game;
  const team = g.league.teams[g.userTeamIndex];

  // Ensure everyone has rotation object (just in case)
  team.roster.forEach(p => {
      p.rotation ??= { minutes: 0, isStarter: false };
  });

  const root = el("div", {}, []);

  // Calculation
  const totalMins = team.roster.reduce((sum, p) => sum + (p.rotation.minutes || 0), 0);
  const MAX_MINS = 205; // 5 * 41
  
  // Count starters
  const starterCount = team.roster.filter(p => p.rotation.isStarter).length;

  const statusColor = totalMins === MAX_MINS ? "var(--good)" : totalMins > MAX_MINS ? "var(--bad)" : "var(--warn)";
  const starterColor = starterCount === 5 ? "var(--good)" : "var(--bad)";
  
  root.appendChild(card("Depth Chart", "Game is 41 minutes long. Total minutes available: 205.", [
      el("div", { class:"row" }, [
          badge(`Roster: ${team.roster.length}`),
          el("span", { class:"badge", style:`color:${statusColor}; border-color:${statusColor}` }, `Allocated: ${totalMins} / ${MAX_MINS}`),
          el("span", { class:"badge", style:`color:${starterColor}; border-color:${starterColor}` }, `Starters: ${starterCount} / 5`)
      ]),
      el("div", { class:"sep" }),
      el("div", { class:"row" }, [
        button("Auto-Distribute", {
            onClick: () => {
                autoDistribute(team);
                rerender(root);
            }
        }),
        button("Save Changes", {
            primary: true,
            onClick: () => {
                const slot = getActiveSaveSlot() || "A";
                saveToSlot(slot);
                alert(`Rotation saved to Slot ${slot}.`);
            }
        })
      ])
  ]));

  // Roster List with Inputs
  const rows = team.roster.slice().sort((a,b) => b.ovr - a.ovr).map(p => {
      
      const minInput = el("input", { 
          type:"number", 
          min:"0", 
          max:"41", 
          value: String(p.rotation.minutes),
          style: "width:60px; padding:4px; border-radius:4px; border:1px solid var(--line); background:rgba(0,0,0,0.2); color:var(--text);"
      });

      minInput.onchange = (e) => {
          let val = parseInt(e.target.value) || 0;
          if (val < 0) val = 0;
          if (val > 41) val = 41;
          p.rotation.minutes = val;
          rerender(root);
      };

      const startCheck = el("input", { type:"checkbox", checked: p.rotation.isStarter });
      startCheck.onchange = (e) => {
          const isChecking = e.target.checked;
          const currentStarters = team.roster.filter(x => x.rotation.isStarter).length;

          // Enforce 5 starters limit
          if (isChecking && currentStarters >= 5) {
              e.target.checked = false; // Undo the check
              alert("You can only have 5 starters. Uncheck someone else first.");
              return;
          }
          
          p.rotation.isStarter = isChecking;
          rerender(root); // Re-render to update the starter count badge
      };

      return el("tr", {}, [
          el("td", {}, p.name),
          el("td", {}, p.pos),
          el("td", {}, String(p.ovr)),
          el("td", {}, `${p.stats.pts.toFixed(1)} PPG`), // Context for decisions
          el("td", {}, startCheck),
          el("td", {}, minInput),
          el("td", {}, el("div", { 
              style:`width:${p.rotation.minutes*2}px; height:6px; background:var(--accent); border-radius:2px; opacity:0.7` 
          }))
      ]);
  });

  root.appendChild(card("Rotation", "Check box for 'Starter' (Limit 5). Minutes determine stats.", [
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

function autoDistribute(team){
    // Sort by OVR
    const sorted = team.roster.sort((a,b) => b.ovr - a.ovr);
    
    // Reset
    sorted.forEach(p => {
        p.rotation.minutes = 0; 
        p.rotation.isStarter = false;
    });

    let remain = 205;
    
    // Top 5 (Starters)
    for(let i=0; i<Math.min(5, sorted.length); i++){
        sorted[i].rotation.isStarter = true;
        const give = 33; 
        sorted[i].rotation.minutes = give;
        remain -= give;
    }
    
    // Next 5 (Bench)
    for(let i=5; i<Math.min(10, sorted.length); i++){
        const give = 8;
        sorted[i].rotation.minutes = give;
        remain -= give;
    }
    
    // Add remainder to best players
    if (sorted.length > 0) sorted[0].rotation.minutes += remain;
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DepthChartScreen());
}
