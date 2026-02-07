import { el, card, button, badge, showPlayerModal } from "../components.js";
import { getState, startDraft, calculateSignChance } from "../../state.js";
import { PHASES } from "../../data/constants.js";

export function FreeAgencyScreen(){
  const s = getState();
  const g = s.game;

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

  // FILTERS
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

  let displayList = fa.pool.filter(p => !p.signedByTeamId);

  if (filter.pos !== "All") {
      displayList = displayList.filter(p => p.pos === filter.pos);
  }

  if (filter.sort === "OVR") displayList.sort((a,b) => b.ovr - a.ovr);
  else if (filter.sort === "Age") displayList.sort((a,b) => a.age - b.age);
  else if (filter.sort === "Ask") displayList.sort((a,b) => a.ask - b.ask);

  const rows = displayList.slice(0, 300).map(p => {
    // Clickable Name for history
    const nameLink = el("span", { 
        style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
        onclick: () => showPlayerModal(p)
    }, p.name);

    // Offers Check
    const offers = p.offers || [];
    const hasOffers = offers.length > 0;
    const offerBadge = hasOffers 
        ? el("span", { class:"badge", style:"background:var(--warn); font-size:0.8em;" }, `${offers.length} Offers`) 
        : null;

    return el("tr", {}, [
      el("td", {}, nameLink),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, String(p.age)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `$${p.ask}M / ${p.yearsAsk}y`),
      el("td", {}, [
          offerBadge,
          button("Negotiate", {
            small: true,
            onClick: () => {
                showNegotiationModal(p, team, g, () => rerender(root));
            }
          })
      ])
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
        simCpuFreeAgency(g);
        startDraft();
        location.hash = "#/draft";
      }
    })
  ]));

  return root;
}

function showNegotiationModal(p, team, g, onClose){
    // Internal state for the modal
    let offerSalary = p.ask;
    let offerYears = p.yearsAsk;
    
    const overlay = el("div", { 
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;" 
    }, []);

    const content = el("div", { class:"card", style:"width:400px; max-width:90%;" }, []);

    const render = () => {
        content.innerHTML = "";
        
        // 1. Header
        content.appendChild(el("div", { class:"spread" }, [
            el("div", { class:"h2" }, `Sign ${p.name}`),
            button("Close", { small:true, onClick: () => { document.body.removeChild(overlay); onClose(); } })
        ]));
        
        // 2. Info
        content.appendChild(el("div", { class:"p" }, [
            el("div", {}, `Ask: $${p.ask}M for ${p.yearsAsk} years`),
            el("div", {}, `Cap Space: ${(team.cap.cap - team.cap.payroll).toFixed(2)}M`)
        ]));
        content.appendChild(el("div", { class:"sep" }));

        // 3. Competing Offers
        if (p.offers && p.offers.length > 0) {
            content.appendChild(el("div", { class:"h2", style:"font-size:1em;" }, "Competing Offers:"));
            p.offers.forEach(o => {
                content.appendChild(el("div", { class:"badge", style:"display:block; margin-bottom:4px;" }, 
                    `${o.teamName}: $${o.salary}M / ${o.years}y`
                ));
            });
        } else {
            content.appendChild(el("div", { class:"p", style:"opacity:0.6" }, "No other offers yet."));
        }
        content.appendChild(el("div", { class:"sep" }));

        // 4. Input Form
        const chance = calculateSignChance(p, offerSalary, offerYears);
        const color = chance > 80 ? "var(--good)" : chance > 40 ? "var(--warn)" : "var(--bad)";

        const salInput = el("input", { 
            type:"number", step:"0.1", value:String(offerSalary), 
            style:"width:100%; padding:8px; margin-bottom:10px;",
            onchange: (e) => { offerSalary = parseFloat(e.target.value); render(); }
        });
        
        const yearInput = el("select", {
            style:"width:100%; padding:8px; margin-bottom:10px;",
            onchange: (e) => { offerYears = parseInt(e.target.value); render(); }
        }, [1,2,3,4].map(y => el("option", { value:y, selected:y===offerYears }, `${y} Years`)));

        content.appendChild(el("div", {}, [
            el("label", {}, "Salary (M)"),
            salInput,
            el("label", {}, "Contract Length"),
            yearInput
        ]));

        // 5. Probability Bar
        content.appendChild(el("div", { class:"p", style:`font-weight:bold; color:${color}; text-align:center; margin:10px 0;` }, 
            `Signing Probability: ${chance}%`
        ));
        content.appendChild(el("div", { class:"barWrap" }, [
            el("div", { class:"barFill", style:`width:${chance}%; background:${color}` })
        ]));

        // 6. Action
        const canAfford = (team.cap.cap - team.cap.payroll) >= offerSalary;
        
        content.appendChild(button("Submit Offer", {
            primary: true,
            style: "width:100%; margin-top:15px;",
            disabled: !canAfford,
            onClick: () => {
                const roll = Math.random() * 100;
                if (roll <= chance) {
                    // Success!
                    alert(`Success! ${p.name} accepted your offer.`);
                    signPlayer(p, team.id, offerSalary, offerYears);
                    document.body.removeChild(overlay);
                    onClose();
                } else {
                    // Fail -> Player signs with best CPU offer (or vanishes if none, simplified to staying available but rejecting user for now? 
                    // No, prompt said "player signs immediately". If user loses, they lose.)
                    
                    // Find best CPU offer
                    if (p.offers && p.offers.length > 0) {
                        p.offers.sort((a,b) => (b.salary * (1+0.1*b.years)) - (a.salary * (1+0.1*a.years)));
                        const best = p.offers[0];
                        alert(`Offer Rejected! ${p.name} signed with ${best.teamName} instead.`);
                        signPlayer(p, best.teamId, best.salary, best.years);
                    } else {
                        // Edge case: No offers but rejected user?
                        // Maybe they just stay in pool but refuse to talk to YOU again?
                        // For simplicity, let's say they stay unsigned but you can try again (maybe with penalty logic later).
                        alert("Offer Rejected. They think they can do better.");
                    }
                    document.body.removeChild(overlay);
                    onClose();
                }
            }
        }));
    };

    render();
    overlay.appendChild(content);
    document.body.appendChild(overlay);
}

function signPlayer(p, teamId, salary, years){
    const team = getState().game.league.teams.find(t => t.id === teamId);
    if (!team) return;
    
    p.signedByTeamId = teamId;
    p.contract = { years, salary };
    
    team.roster.push(p);
    team.cap.payroll = Number(team.roster.reduce((sum,x)=> sum + (x.contract?.salary || 0), 0).toFixed(1));
}

function simCpuFreeAgency(g){
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    for (const t of cpuTeams){
        let space = t.cap.cap - t.cap.payroll;
        while (t.roster.length < 10 && space > 0.5){
            const best = fa.pool.find(p => !p.signedByTeamId && p.ask <= space);
            if (!best) break;
            signPlayer(best, t.id, best.ask, best.yearsAsk);
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
