import { el, card, button, badge, interestBar } from "../components.js";
import { getState, executeTrade } from "../../state.js";
import { clamp } from "../../utils.js";

export function TradeScreen(){
  const s = getState();
  const g = s.game;
  const userTeam = g.league.teams[g.userTeamIndex];

  // Internal state for the screen (selections)
  // We attach it to the DOM node implicitly by closure, 
  // but to keep it simple across renders, we can store in a temp object if needed.
  // For this prototype, we'll re-render on every click.
  
  if (!s.tempTradeState) {
    // Default to the first CPU team
    const firstCpu = g.league.teams.find(t => t.id !== userTeam.id);
    s.tempTradeState = {
        partnerId: firstCpu.id,
        userOffer: { players: [], picks: [] },
        partnerOffer: { players: [], picks: [] }
    };
  }
  
  const ts = s.tempTradeState;
  const partner = g.league.teams.find(t => t.id === ts.partnerId);

  // --- Calculations ---
  
  // Value Formulas (Realistic-ish)
  const getPlayerValue = (p) => {
    // Exponential value for higher OVR
    // 90 OVR ~ 1000 pts
    // 80 OVR ~ 500 pts
    // 70 OVR ~ 180 pts
    // Age penalty
    let val = Math.pow((p.ovr - 50), 2.5) / 10;
    
    // Potential bonus
    const potBonus = { "A+": 1.5, "A": 1.3, "B": 1.15, "C": 1.0, "D": 0.9, "F": 0.8 };
    val *= (potBonus[p.potentialGrade] || 1.0);
    
    // Contract penalty? (Simplified: Ignore for now, or slight penalty if old and expensive)
    
    return Math.round(val);
  };

  const getPickValue = (pick) => {
    // Request: All R1 picks equal, All R2 picks equal.
    if (pick.round === 1) return 250; // Roughly a high-70s starter
    return 50; // Roughly a bench player
  };

  const calcTotalValue = (items) => {
    let sum = 0;
    items.players.forEach(p => sum += getPlayerValue(p));
    items.picks.forEach(p => sum += getPickValue(p));
    return sum;
  };

  const userVal = calcTotalValue(ts.userOffer);
  const partnerVal = calcTotalValue(ts.partnerOffer);
  
  // Interest Calculation
  // If User gives 500 value, and Partner gives 400 value -> Interest High.
  // Delta = UserVal - PartnerVal.
  // If Delta is 0, Interest is ~50% (fair).
  // If Delta > 0, Interest > 50%.
  
  const delta = userVal - partnerVal;
  // Scale: +/- 200 value swings the bar significantly
  let interest = 50 + (delta / 5); 
  interest = clamp(interest, 0, 100);
  
  // "Likelihood" logic
  // If interest > 80, almost certain.
  // If interest < 40, reject.
  const canSubmit = ts.userOffer.players.length > 0 || ts.partnerOffer.players.length > 0 || ts.userOffer.picks.length > 0;


  const root = el("div", {}, []);

  // --- Top Bar: Select Partner ---
  const otherTeams = g.league.teams.filter(t => t.id !== userTeam.id);
  const partnerSelect = el("select", {
      onchange: (e) => {
          s.tempTradeState.partnerId = otherTeams[e.target.selectedIndex].id;
          s.tempTradeState.partnerOffer = { players:[], picks:[] }; // Reset their side
          rerender(root);
      }
  }, otherTeams.map(t => el("option", { value: t.id, selected: t.id === partner.id }, t.name)));

  root.appendChild(card("Trade Desk", "Select a team to trade with.", [
      el("div", { class:"row" }, [
          el("span", { class:"p" }, "Trade Partner: "),
          partnerSelect
      ])
  ]));

  // --- The Trade Block (Center) ---
  
  // Helper to render a selected item
  const renderItem = (item, type, side) => {
      const label = type === 'player' 
        ? `${item.name} (${item.pos} ${item.ovr})`
        : `Y${item.year} R${item.round} (${g.league.teams.find(t=>t.id===item.originalOwnerId)?.name.split(" ").pop()})`;
      
      return el("div", { class:"badge", style:"margin:2px; display:flex; gap:6px;" }, [
        el("span", {}, label),
        el("span", { 
            style:"cursor:pointer; color:var(--bad); font-weight:bold;",
            onclick: () => {
                if (side === 'user') {
                    if (type === 'player') ts.userOffer.players = ts.userOffer.players.filter(x => x.id !== item.id);
                    else ts.userOffer.picks = ts.userOffer.picks.filter(x => x.id !== item.id);
                } else {
                    if (type === 'player') ts.partnerOffer.players = ts.partnerOffer.players.filter(x => x.id !== item.id);
                    else ts.partnerOffer.picks = ts.partnerOffer.picks.filter(x => x.id !== item.id);
                }
                rerender(root);
            }
        }, "×")
      ]);
  };

  const userItems = [
      ...ts.userOffer.players.map(p => renderItem(p, 'player', 'user')),
      ...ts.userOffer.picks.map(p => renderItem(p, 'pick', 'user'))
  ];
  const partnerItems = [
      ...ts.partnerOffer.players.map(p => renderItem(p, 'player', 'partner')),
      ...ts.partnerOffer.picks.map(p => renderItem(p, 'pick', 'partner'))
  ];

  root.appendChild(card("Current Offer", "", [
      el("div", { class:"grid" }, [
          el("div", {}, [
              el("div", { class:"h2" }, `${userTeam.name} Sends:`),
              el("div", { style:"min-height:40px; border:1px dashed var(--line); border-radius:8px; padding:8px;" }, userItems),
              el("div", { class:"p", style:"margin-top:4px;" }, `Total Value: ${userVal}`)
          ]),
          el("div", {}, [
              el("div", { class:"h2" }, `${partner.name} Sends:`),
              el("div", { style:"min-height:40px; border:1px dashed var(--line); border-radius:8px; padding:8px;" }, partnerItems),
              el("div", { class:"p", style:"margin-top:4px;" }, `Total Value: ${partnerVal}`)
          ])
      ]),
      el("div", { class:"sep" }),
      el("div", { class:"row" }, [
          el("div", { class:"h2" }, "Interest:"),
          el("div", { style:"width:200px" }, interestBar(interest)),
          button("Submit Trade", {
              primary: true,
              onClick: () => {
                  if (!canSubmit) return;
                  
                  // Simple logic: Needs interest >= 60 to accept
                  // Or random chance if between 45 and 60.
                  let accepted = false;
                  if (interest >= 60) accepted = true;
                  else if (interest >= 45) {
                      if (Math.random() < ((interest - 45) / 15)) accepted = true;
                  }

                  if (accepted) {
                      executeTrade(userTeam.id, partner.id, ts.userOffer, ts.partnerOffer);
                      alert("Trade Accepted!");
                      // Clear state
                      s.tempTradeState.userOffer = {players:[], picks:[]};
                      s.tempTradeState.partnerOffer = {players:[], picks:[]};
                      rerender(root);
                  } else {
                      alert("Trade Declined. They want more value.");
                  }
              }
          })
      ])
  ]));

  // --- Asset Selectors ---
  
  const renderAssetList = (team, side) => {
      const roster = team.roster.filter(p => {
          // Filter out already selected players
          if (side === 'user') return !ts.userOffer.players.find(x => x.id === p.id);
          return !ts.partnerOffer.players.find(x => x.id === p.id);
      }).sort((a,b) => b.ovr - a.ovr);

      const picks = (team.assets?.picks || []).filter(p => {
          if (side === 'user') return !ts.userOffer.picks.find(x => x.id === p.id);
          return !ts.partnerOffer.picks.find(x => x.id === p.id);
      }).sort((a,b) => a.year - b.year || a.round - b.round);

      return el("div", {}, [
          el("div", { class:"h2" }, "Players"),
          el("div", { style:"max-height:300px; overflow-y:auto;" }, 
            el("table", { class:"table" }, [
              el("thead", {}, el("tr", {}, [el("th",{},"Name"), el("th",{},"Pos"), el("th",{},"OVR"), el("th",{},"Pot"), el("th",{},"Age"), el("th",{},"Action")])),
              el("tbody", {}, roster.map(p => el("tr", {}, [
                  el("td", {}, p.name),
                  el("td", {}, p.pos),
                  el("td", {}, String(p.ovr)),
                  el("td", {}, p.potentialGrade),
                  el("td", {}, String(2025 - (2025 - (p.age || 20)))), // rough hack if age missing
                  el("td", {}, button("Add", { small:true, onClick:()=>{
                      if (side === 'user') ts.userOffer.players.push(p);
                      else ts.partnerOffer.players.push(p);
                      rerender(root);
                  }}))
              ])))
            ])
          ),
          el("div", { class:"sep" }),
          el("div", { class:"h2" }, "Draft Picks"),
           el("div", { style:"max-height:200px; overflow-y:auto;" }, 
            el("table", { class:"table" }, [
              el("thead", {}, el("tr", {}, [el("th",{},"Year"), el("th",{},"Round"), el("th",{},"Original"), el("th",{},"Action")])),
              el("tbody", {}, picks.map(p => el("tr", {}, [
                  el("td", {}, String(p.year)),
                  el("td", {}, String(p.round)),
                  el("td", {}, g.league.teams.find(t=>t.id===p.originalOwnerId)?.name.split(" ").pop()),
                  el("td", {}, button("Add", { small:true, onClick:()=>{
                      if (side === 'user') ts.userOffer.picks.push(p);
                      else ts.partnerOffer.picks.push(p);
                      rerender(root);
                  }}))
              ])))
            ])
          )
      ]);
  };

  root.appendChild(el("div", { class:"grid" }, [
      card("Your Assets", "", [ renderAssetList(userTeam, 'user') ]),
      card("Their Assets", "", [ renderAssetList(partner, 'partner') ])
  ]));

  return root;
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(TradeScreen());
}
