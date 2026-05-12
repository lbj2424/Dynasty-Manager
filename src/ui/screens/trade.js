import { el, card, button, badge, interestBar, showPlayerModal } from "../components.js";
import { getState, executeTrade, isTradeWindowOpen, tradePlayerValue, tradePickValue } from "../../state.js";
import { clamp } from "../../utils.js";
import { TRADE_DEADLINE_WEEK } from "../../data/constants.js";

export function TradeScreen(){
  const s = getState();
  const g = s.game;
  const userTeam = g.league.teams[g.userTeamIndex];

  if (!isTradeWindowOpen()) {
    const isPlayoffs = g.phase === "PLAYOFFS";
    const msg = isPlayoffs
      ? "Trades are not allowed during the playoffs."
      : `The trade deadline was Week ${TRADE_DEADLINE_WEEK}. Trades resume during Free Agency.`;
    return card("Trade Deadline Passed", msg, []);
  }

  if (!s.tempTradeState) {
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
  const getPlayerValue = (p, receivingTeam, sendingTeam) =>
    tradePlayerValue(p, { receivingTeam, sendingTeam, game: g });
  const getPickValue = (pick, receivingTeam) =>
    tradePickValue(pick, { receivingTeam, game: g });

  const calcTotalValue = (items, receivingTeam, sendingTeam) => {
    let sum = 0;
    items.players.forEach(p => sum += getPlayerValue(p, receivingTeam, sendingTeam));
    items.picks.forEach(p => sum += getPickValue(p, receivingTeam));
    return sum;
  };

  const userVal = calcTotalValue(ts.userOffer, partner, userTeam);
  const partnerVal = calcTotalValue(ts.partnerOffer, partner, partner);
  const delta = userVal - partnerVal;
  
  // CPU Interest Logic
  // They want to WIN the trade (User gives more than they get)
  // Base interest is 50. Bigger positive gaps mean the partner likes the deal more.
  let interest = 50 + (delta / 70); 
  interest = clamp(interest, 0, 100);

  const canSubmit = ts.userOffer.players.length > 0 || ts.partnerOffer.players.length > 0 || ts.userOffer.picks.length > 0 || ts.partnerOffer.picks.length > 0;

  const root = el("div", {}, []);

  // --- Partner Selector ---
  const otherTeams = g.league.teams.filter(t => t.id !== userTeam.id);
  const partnerSelect = el("select", {
      onchange: (e) => {
          s.tempTradeState.partnerId = otherTeams[e.target.selectedIndex].id;
          s.tempTradeState.partnerOffer = { players:[], picks:[] }; 
          rerender(root);
      }
  }, otherTeams.map(t => el("option", { value: t.id, selected: t.id === partner.id }, t.name)));

  root.appendChild(card("Trade Desk", "Select a team to trade with.", [
      el("div", { class:"row" }, [
          el("span", { class:"p" }, "Trade Partner: "),
          partnerSelect,
          el("span", { class:"badge", style:"margin-left:8px;" }, `${partner.wins}-${partner.losses}`),
          el("span", { class:"badge", style:"margin-left:4px; opacity:0.7;" }, `OVR ${partner.rating}`)
      ])
  ]));

  // --- Trade Block Display ---
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
              el("div", { class:"p", style:"margin-top:4px;" }, `Partner Value: ${userVal}`)
          ]),
          el("div", {}, [
              el("div", { class:"h2" }, `${partner.name} Sends:`),
              el("div", { style:"min-height:40px; border:1px dashed var(--line); border-radius:8px; padding:8px;" }, partnerItems),
              el("div", { class:"p", style:"margin-top:4px;" }, `Partner Value: ${partnerVal}`)
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
                  let accepted = false;
                  // If Interest > 60, auto accept. If 45-60, chance.
                  if (interest >= 60) accepted = true;
                  else if (interest >= 45) {
                      if (Math.random() < ((interest - 45) / 15)) accepted = true;
                  }

                  if (accepted) {
                      const success = executeTrade(userTeam.id, partner.id, ts.userOffer, ts.partnerOffer);
                      if(success) {
                          alert("Trade Accepted!");
                          s.tempTradeState.userOffer = {players:[], picks:[]};
                          s.tempTradeState.partnerOffer = {players:[], picks:[]};
                          rerender(root);
                      } else {
                          alert("Trade Failed (Cap Space or Roster Limits).");
                      }
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
          if (side === 'user') return !ts.userOffer.players.find(x => x.id === p.id);
          return !ts.partnerOffer.players.find(x => x.id === p.id);
      }).sort((a,b) => b.ovr - a.ovr);

      // --- FILTER FIX: HIDE OLD PICKS ---
      const picks = (team.assets?.picks || [])
        .filter(p => {
            // Only show picks for Current Year or Future
            if (p.year < g.year) return false; 

            if (side === 'user') return !ts.userOffer.picks.find(x => x.id === p.id);
            return !ts.partnerOffer.picks.find(x => x.id === p.id);
        })
        .sort((a,b) => a.year - b.year || a.round - b.round);
      // ----------------------------------

      return el("div", {}, [
          el("div", { class:"h2" }, "Players"),
          el("div", { style:"max-height:300px; overflow-y:auto;" }, 
            el("table", { class:"table" }, [
              el("thead", {}, el("tr", {}, [el("th",{},"Name"), el("th",{},"Pos"), el("th",{},"OVR"), el("th",{},"Age"), el("th",{},"Contract"), el("th",{},"Happy"), el("th",{},"Value"), el("th",{},"Action")])),
              el("tbody", {}, roster.map(p => {
                  const nameSpan = el("span", {
                      style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
                      onclick: () => showPlayerModal(p)
                  }, p.name);
                  const assetValue = side === "user"
                      ? getPlayerValue(p, partner, userTeam)
                      : getPlayerValue(p, partner, partner);

                  return el("tr", {}, [
                      el("td", {}, nameSpan),
                      el("td", {}, p.pos),
                      el("td", {}, String(p.ovr)),
                      el("td", {}, String(p.age)),
                      el("td", {}, p.contract ? `${p.contract.years}y / ${p.contract.salary}M` : "FA"),
                      el("td", {}, String(p.happiness ?? 70)),
                      el("td", {}, String(assetValue)),
                      el("td", {}, button("Add", { small:true, onClick:()=>{
                          if (side === 'user') ts.userOffer.players.push(p);
                          else ts.partnerOffer.players.push(p);
                          rerender(root);
                      }}))
                  ]);
              }))
            ])
          ),
          el("div", { class:"sep" }),
          el("div", { class:"h2" }, "Draft Picks"),
           el("div", { style:"max-height:200px; overflow-y:auto;" }, 
            el("table", { class:"table" }, [
              el("thead", {}, el("tr", {}, [el("th",{},"Year"), el("th",{},"Round"), el("th",{},"Original"), el("th",{},"Value"), el("th",{},"Action")])),
              el("tbody", {}, picks.map(p => el("tr", {}, [
                  el("td", {}, String(p.year)),
                  el("td", {}, String(p.round)),
                  el("td", {}, g.league.teams.find(t=>t.id===p.originalOwnerId)?.name.split(" ").pop()),
                  el("td", {}, String(getPickValue(p, partner))),
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
