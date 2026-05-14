import { el, card, button, badge, showPlayerModal } from "../components.js";
import { getState, startDraft, calculateSignChance, saveToSlot, getActiveSaveSlot, autoDistributeMinutes, advanceFaRound, analyzeTeamNeeds, scoreFreeAgentFit, scoreFreeAgentOffer } from "../../state.js";
import { PHASES, SALARY_CAP } from "../../data/constants.js";

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
      el("div", { class:"p" }, "Offseason free agency happens before the draft. During the regular season, cut and unsigned players are listed under Available Players."),
      g.phase === PHASES.REGULAR
        ? button("Go to Available Players", { primary:true, onClick: () => location.hash = "#/available-players" })
        : null
    ]));
    return root;
  }

  const fa = g.offseason.freeAgents;
  const team = g.league.teams[g.userTeamIndex];
  const capSpace = Math.max(0, team.cap.cap - team.cap.payroll);
  const faRound = fa.round ?? 1;

  if (fa.resultsReady) {
    root.appendChild(renderFreeAgencyResults(g, fa));
    return root;
  }

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
      el("td", { style: "font-weight:bold;" }, String(p.ovr)),
      el("td", { style: "color:var(--good);" }, String(p.off ?? p.ovr)),
      el("td", { style: "color:var(--warn);" }, String(p.def ?? p.ovr)),
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

  const roundLabel = `FA Week ${faRound} of 3`;

  root.appendChild(card("Free Agency", `Cap Space: $${capSpace.toFixed(2)}M  ·  ${roundLabel}`, [
    filterBar,
    el("div", { class:"sep" }),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "OFF"),
        el("th", {}, "DEF"),
        el("th", {}, "Age"),
        el("th", {}, "Pot"),
        el("th", {}, "Ask"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"9" }, "No players found.")])
      ])
    ]),
    el("div", { class:"sep" }),
    el("div", { class:"row", style:"gap:10px;" }, [
      faRound < 3
        ? button(`Advance to FA Week ${faRound + 1}`, {
            onClick: () => {
              advanceFaRound();
              rerender(root);
            }
          })
        : el("span", { style:"opacity:0.5; font-size:0.9em;" }, "FA market has settled (Week 3 of 3)"),
      button(faRound >= 3 ? "Resolve FA Results" : "Finish Free Agency -> Draft", {
        primary: true,
        onClick: () => {
          simCpuFreeAgency(g);
          if (faRound >= 3) {
            fa.resultsReady = true;
            saveToSlot(getActiveSaveSlot() || "A");
            rerender(root);
          } else {
            startDraft();
            location.hash = "#/draft";
          }
        }
      })
    ])
  ]));

  return root;
}

function showNegotiationModal(p, team, g, onClose){
    let offerSalary = p.ask;
    let offerYears = p.yearsAsk;
    
    const overlay = el("div", { 
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;" 
    }, []);

    const content = el("div", { class:"card", style:"width:400px; max-width:90%;" }, []);

    const render = () => {
        content.innerHTML = "";
        
        content.appendChild(el("div", { class:"spread" }, [
            el("div", { class:"h2" }, `Sign ${p.name}`),
            button("Close", { small:true, onClick: () => { document.body.removeChild(overlay); onClose(); } })
        ]));
        
        content.appendChild(el("div", { class:"p" }, [
            el("div", {}, `Ask: $${p.ask}M for ${p.yearsAsk} years`),
            el("div", {}, `Cap Space: ${(team.cap.cap - team.cap.payroll).toFixed(2)}M`)
        ]));
        content.appendChild(el("div", { class:"sep" }));

        if (p.offers && p.offers.length > 0) {
            content.appendChild(el("div", { class:"h2", style:"font-size:1em;" }, "Competing Offers:"));
            p.offers.forEach(o => {
                content.appendChild(el("div", { class:"badge", style:"display:block; margin-bottom:4px;" },
                    `${o.teamName}: $${o.salary}M / ${o.years}y`
                ));
            });
        } else {
            content.appendChild(el("div", { class:"p", style:"color:var(--good); font-size:0.9em;" }, "No other offers — player has no leverage. They'll accept ~15% below their ask."));
        }
        content.appendChild(el("div", { class:"sep" }));

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

        content.appendChild(el("div", { class:"p", style:`font-weight:bold; color:${color}; text-align:center; margin:10px 0;` }, 
            `Signing Probability: ${chance}%`
        ));
        content.appendChild(el("div", { class:"barWrap" }, [
            el("div", { class:"barFill", style:`width:${chance}%; background:${color}` })
        ]));

        const canAfford = (team.cap.cap - team.cap.payroll) >= offerSalary;
        const hasRosterSpot = team.roster.length < 15;

        if (!hasRosterSpot) {
            content.appendChild(el("div", { class:"p", style:"color:var(--bad); margin-top:8px;" },
                "Roster is full (15 players max). Cut or trade a player before signing anyone."
            ));
        }
        
        content.appendChild(button("Submit Offer", {
            primary: true,
            style: "width:100%; margin-top:15px;",
            disabled: !canAfford || !hasRosterSpot,
            onClick: () => {
                if (!canAfford) return alert("Not enough cap space.");
                if (!hasRosterSpot) return alert("Roster is full (15 players max).");
                const roll = Math.random() * 100;
                if (roll <= chance) {
                    alert(`Success! ${p.name} accepted your offer.`);
                    signPlayer(p, team.id, offerSalary, offerYears, "Signed with your team");
                    document.body.removeChild(overlay);
                    onClose();
                } else {
                    if (p.offers && p.offers.length > 0) {
                        p.offers.sort((a,b) => (b.salary * (1+0.1*b.years)) - (a.salary * (1+0.1*a.years)));
                        const best = p.offers[0];
                        alert(`Offer Rejected! ${p.name} signed with ${best.teamName} instead.`);
                        signPlayer(p, best.teamId, best.salary, best.years, "Chose a competing offer");
                    } else {
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

function renderFreeAgencyResults(g, fa) {
    const signings = (fa.signings || []).slice().sort((a, b) => b.ovr - a.ovr || b.salary - a.salary);
    const unsigned = (fa.pool || [])
        .filter(p => !p.signedByTeamId)
        .slice()
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, 25);

    const signingRows = signings.map(x => el("tr", {}, [
        el("td", {}, el("span", {
            style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
            onclick: () => showPlayerModal(x.player)
        }, x.playerName)),
        el("td", {}, x.pos),
        el("td", { style:"font-weight:bold;" }, String(x.ovr)),
        el("td", {}, String(x.age)),
        el("td", {}, x.teamName),
        el("td", {}, `$${x.salary}M / ${x.years}y`),
        el("td", {}, x.reason || "Signed")
    ]));

    const unsignedRows = unsigned.map(p => el("tr", {}, [
        el("td", {}, el("span", {
            style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
            onclick: () => showPlayerModal(p)
        }, p.name)),
        el("td", {}, p.pos),
        el("td", { style:"font-weight:bold;" }, String(p.ovr)),
        el("td", {}, String(p.age)),
        el("td", {}, `$${p.ask}M / ${p.yearsAsk}y`)
    ]));

    return el("div", {}, [
        card("Free Agency Results", `${signings.length} players signed. ${unsigned.length} notable unsigned players remain available next season.`, [
            el("div", { class:"row" }, [
                badge(`Year ${g.year}`),
                badge(`Week 3 complete`),
                badge(`${signings.filter(x => x.teamId === g.league.teams[g.userTeamIndex]?.id).length} signed by you`)
            ]),
            el("div", { class:"sep" }),
            button("Advance to Draft", {
                primary: true,
                onClick: () => {
                    startDraft();
                    location.hash = "#/draft";
                }
            })
        ]),
        card("Signed Players", "Where the market's signed free agents landed.", [
            el("table", { class:"table" }, [
                el("thead", {}, el("tr", {}, [
                    el("th", {}, "Player"),
                    el("th", {}, "Pos"),
                    el("th", {}, "OVR"),
                    el("th", {}, "Age"),
                    el("th", {}, "Team"),
                    el("th", {}, "Contract"),
                    el("th", {}, "Decision")
                ])),
                el("tbody", {}, signingRows.length ? signingRows : [
                    el("tr", {}, [el("td", { colspan:"7" }, "No free agents signed yet.")])
                ])
            ])
        ]),
        card("Still Available", "These players roll into Available Players after the draft.", [
            el("table", { class:"table" }, [
                el("thead", {}, el("tr", {}, [
                    el("th", {}, "Player"),
                    el("th", {}, "Pos"),
                    el("th", {}, "OVR"),
                    el("th", {}, "Age"),
                    el("th", {}, "Ask")
                ])),
                el("tbody", {}, unsignedRows.length ? unsignedRows : [
                    el("tr", {}, [el("td", { colspan:"5" }, "No notable unsigned players.")])
                ])
            ])
        ])
    ]);
}

// --- FIX: Properly initialize player stats/rotation & SAVE game ---
function signPlayer(p, teamId, salary, years, reason = "Accepted best offer"){
    const g = getState().game;
    const team = g.league.teams.find(t => t.id === teamId);
    if (!team) return;
    if (team.roster.length >= 15) return;
    
    p.signedByTeamId = teamId;
    p.contract = { years, salary };
    
    // 1. Initialize stats (Fixes Team Screen crash)
    p.stats = { gp:0, pts:0, reb:0, ast:0 };
    // 2. Initialize rotation (Fixes Team Screen crash)
    p.rotation = { minutes: 0, isStarter: false };
    // 3. Ensure happiness
    p.happiness ??= 70;

    team.roster.push(p);
    team.cap.payroll = Number(team.roster.reduce((sum,x)=> sum + (x.contract?.salary || 0), 0).toFixed(1));
    recordFaSigning(g, p, team, salary, years, reason);

    // 4. SAVE (Fixes reload issue)
    const slot = getActiveSaveSlot() || "A";
    saveToSlot(slot);
}

function recordFaSigning(g, p, team, salary, years, reason) {
    const fa = g.offseason.freeAgents;
    if (!fa) return;
    fa.signings ??= [];
    if (fa.signings.some(x => x.playerId === p.id)) return;
    fa.signings.push({
        playerId: p.id,
        playerName: p.name,
        player: { ...p, contract: { salary, years } },
        teamId: team.id,
        teamName: team.name,
        pos: p.pos,
        ovr: p.ovr,
        age: p.age,
        salary,
        years,
        reason
    });
}

function simCpuFreeAgency(g){
    const fa = g.offseason.freeAgents;
    const cpuTeams = g.league.teams.filter(t => t.id !== g.league.teams[g.userTeamIndex].id);

    // 1. Resolve pending offers — best offer wins each player
    for (const p of fa.pool) {
        if (p.signedByTeamId) continue;
        if (!p.offers || p.offers.length === 0) continue;

        p.offers.sort((a,b) => {
            const teamA = g.league.teams.find(t => t.id === a.teamId);
            const teamB = g.league.teams.find(t => t.id === b.teamId);
            return scoreFreeAgentOffer(p, b, teamB, g) - scoreFreeAgentOffer(p, a, teamA, g);
        });
        const best = p.offers[0];
        const team = g.league.teams.find(t => t.id === best.teamId);
        if (team && (team.cap.cap - team.cap.payroll) >= best.salary && team.roster.length < 15) {
            signPlayer(p, team.id, best.salary, best.years, "Accepted best offer");
        }
    }

    // 2. Fill remaining roster holes — teams with the most need go first
    const sortedCpuTeams = [...cpuTeams].sort((a, b) => {
        const aNeeds = analyzeTeamNeeds(a, g);
        const bNeeds = analyzeTeamNeeds(b, g);
        return (a.roster.length - b.roster.length) ||
            (bNeeds.needs.length - aNeeds.needs.length) ||
            (aNeeds.capSpace - bNeeds.capSpace);
    });

    for (const t of sortedCpuTeams) {
        let space = t.cap.cap - t.cap.payroll;

        while (t.roster.length < 12 && space > 0.5) {
            const analysis = analyzeTeamNeeds(t, g);
            const pick = fa.pool
                .filter(p => !p.signedByTeamId && p.ask <= space)
                .map(p => ({ p, fit: scoreFreeAgentFit(p, t, g, analysis) }))
                .filter(x => x.fit >= 48 || t.roster.length < 9)
                .sort((a, b) => b.fit - a.fit || b.p.ovr - a.p.ovr)[0]?.p;

            if (!pick) break;
            signPlayer(pick, t.id, pick.ask, pick.yearsAsk, "Filled roster need");
            space = t.cap.cap - t.cap.payroll;
        }

        autoDistributeMinutes(t);
    }
}

function rerender(root){
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(FreeAgencyScreen());
}
