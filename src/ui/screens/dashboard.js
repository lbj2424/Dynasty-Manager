import { el, card, button, badge, showPlayerModal } from "../components.js";
import {
  getState,
  advanceWeek,
  saveToSlot,
  getActiveSaveSlot,
  startPlayoffs,
  calculateAllStars,
  computeMVPRace,
  acceptUserTradeOffer,
  declineUserTradeOffer,
  computeReputations,
  acceptPoachingOffer,
  acceptLoyaltyOffer,
  declineAllPoachingOffers,
  getOwnerInfo,
  getMandateProgress,
  getUserRosterRuleIssue
} from "../../state.js";
import { formatWeek } from "../../utils.js";
import { PHASES, TRADE_DEADLINE_WEEK } from "../../data/constants.js";

export function DashboardScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  const phaseBadge = badge(`Phase: ${g.phase}`);
  const isFired = g.gm?.status === "fired";
  const topButtons = [];

  if (!isFired && g.phase === PHASES.REGULAR){
    topButtons.push(
      button("Advance Week", {
        primary: true,
        onClick: () => {
          const weekBefore = g.week;
          advanceWeek();
          if (g.week === weekBefore) {
            const blocked = getUserRosterRuleIssue(g);
            if (blocked) alert(blocked.message);
          }
          // NEW: Trigger All-Star announcement at end of regular season
          if (g.week > g.seasonWeeks && g.phase === PHASES.REGULAR) {
              const allStars = calculateAllStars(g);
              showAllStarModal(allStars, () => rerender(root));
          } else {
              rerender(root);
          }
        }
      })
    );

    if (g.week > g.seasonWeeks){
      topButtons.push(
        button("Start Playoffs", {
          primary: true,
          onClick: () => {
            startPlayoffs();
            location.hash = "#/playoffs";
          }
        })
      );
    }
  }

  if (!isFired && g.phase === PHASES.PLAYOFFS){
    topButtons.push(button("Go to Playoffs", { primary:true, onClick: () => location.hash = "#/playoffs" }));
  }
  if (!isFired && g.phase === PHASES.FREE_AGENCY){
    topButtons.push(button("Go to Free Agency", { primary:true, onClick: () => location.hash = "#/free-agency" }));
  }
  if (!isFired && g.phase === PHASES.DRAFT){
    topButtons.push(button("Go to Draft", { primary:true, onClick: () => location.hash = "#/draft" }));
  }

  topButtons.push(
    !isFired ? button("My Team", { onClick: () => location.hash = "#/team" }) : null,
    !isFired ? button("Trade", { onClick: () => location.hash = "#/trade" }) : null,
    !isFired && g.phase === PHASES.REGULAR
        ? button(`Available Players${(g.midseasonFaPool?.length > 0) ? ` (${g.midseasonFaPool.length})` : ""}`, { onClick: () => location.hash = "#/available-players" })
        : null,
    button("Standings", { onClick: () => location.hash = "#/standings" }),
    button("League Leaders", { onClick: () => location.hash = "#/league-leaders" }),
    button("History", { onClick: () => location.hash = "#/history" }),
    button("Retired", { onClick: () => location.hash = "#/retired" }),
    !isFired ? button("Go to Scouting", { onClick: () => location.hash = "#/scouting" }) : null,
    g.lastSeasonRecap
        ? button(`Season ${g.lastSeasonRecap.year} Recap`, {
            primary: true,
            onClick: () => showSeasonRecapModal(g.lastSeasonRecap, () => rerender(root))
          })
        : null,
    g.gmReview
        ? button(`Year-End Review`, {
            onClick: () => showGMReviewModal(g.gmReview, g.gm, () => rerender(root))
          })
        : null,
    g.gm && (g.gm.career?.yearsAsGM || 0) > 0
        ? button(`GM Hall of Fame`, {
            onClick: () => showGmHallOfFameModal(g.gm, g, () => rerender(root))
          })
        : null,
    button("Save", {
      onClick: () => {
        const slot = getActiveSaveSlot() || "A";
        saveToSlot(slot);
        alert(`Saved to Slot ${slot}`);
      }
    })
  );

  // Auto-show year-end modals on dashboard mount. GM review (firing/extension) comes first;
  // once acknowledged, the season recap follows.
  setTimeout(() => {
    if (g.gmReview && !g.gmReview.viewed) {
      showGMReviewModal(g.gmReview, g.gm, () => {
        g.gmReview.viewed = true;
        saveToSlot(getActiveSaveSlot() || "A");
        rerender(root);
      });
      return;
    }
    if (g.lastSeasonRecap && !g.lastSeasonRecap.viewed) {
      showSeasonRecapModal(g.lastSeasonRecap, () => rerender(root));
    }
  }, 50);

  root.appendChild(card("Dashboard", "Regular season → Playoffs → Free Agency → Draft.", [
    el("div", { class:"row" }, [
      badge(`Year ${g.year}`),
      g.phase === PHASES.REGULAR ? badge(formatWeek(Math.min(g.week, g.seasonWeeks), g.seasonWeeks)) : null,
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked (max ${g.hours.bankMax})`),
      phaseBadge,
      g.phase === PHASES.REGULAR && g.week >= 15 && g.week <= TRADE_DEADLINE_WEEK
          ? el("div", { class:"badge", style:"background:var(--warn); font-weight:bold;" },
              `TRADE DEADLINE: Week ${TRADE_DEADLINE_WEEK} (${TRADE_DEADLINE_WEEK - g.week} week${TRADE_DEADLINE_WEEK - g.week === 1 ? '' : 's'} left)`)
          : null
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, topButtons.filter(Boolean)),
    el("div", { class:"sep" }),
    gmStatusPanel(g, root),
    rosterRulePanel(g),
    mandatePanel(g),
    jobMarketPanel(g, root),
    pendingOffersPanel(g, root),
    schedulePanel(g),
    mvpRacePanel(g),
    el("div", {}, [
      el("div", { class:"h2" }, "Inbox"),
      el("div", { style:"max-height:400px; overflow-y:auto;" },
        g.inbox.length
          ? g.inbox.map(m => el("div", { class:"p" }, `• ${m.msg}`))
          : [el("div", { class:"p" }, "No messages yet.")]
      )
    ])
  ]));

  return root;
}

// GM career panel — contract, owner approval, current season expectation, reputations.
// Fired GMs see a Career Over panel plus any wilderness offers in the job market.
function rosterRulePanel(g) {
  const issue = getUserRosterRuleIssue(g);
  if (!issue) return null;
  const userTeam = g.league.teams[g.userTeamIndex];
  return card("Action Required", issue.message, [
    el("div", { class:"row" }, [
      badge(`Roster ${userTeam.roster.length}/15`),
      badge(`Payroll $${userTeam.cap.payroll.toFixed(1)}M`)
    ]),
    el("div", { class:"sep" }),
    el("div", { class:"row" }, [
      button("Manage Team", { primary:true, onClick: () => location.hash = "#/team" }),
      button("Trade", { onClick: () => location.hash = "#/trade" })
    ])
  ]);
}

function gmStatusPanel(g, root) {
    const gm = g.gm;
    if (!gm) return null;

    const isFired = gm.status === "fired";
    const userTeam = g.league.teams[g.userTeamIndex];
    const reps = computeReputations(gm, g);

    // Career Over screen
    if (isFired) {
        const c = gm.career || {};
        return el("div", {
            style: "margin-bottom:12px; border:2px solid var(--bad); border-radius:10px; padding:14px; background:rgba(255,80,80,0.05);"
        }, [
            el("div", { style:"font-size:1.3em; font-weight:bold; color:var(--bad); margin-bottom:6px;" }, "Career Over"),
            el("div", { class:"p" }, `You have been relieved of your duties as GM of the ${userTeam?.name || "team"}.`),
            reps.length ? el("div", { style:"margin-top:8px;" }, reputationBadges(reps)) : null,
            el("div", { class:"sep" }),
            el("div", { class:"h2", style:"font-size:0.9em; opacity:0.65;" }, "Career Summary"),
            el("div", { style:"display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-top:6px;" }, [
                careerStat("Years as GM", c.yearsAsGM || 0),
                careerStat("Titles", c.titles || 0),
                careerStat("Finals", c.finalsAppearances || 0),
                careerStat("Playoffs", c.playoffAppearances || 0),
                careerStat("Losing Seasons", c.losingSeasons || 0),
                careerStat("Best Record", c.bestRecord?.wins ? `${c.bestRecord.wins}-${c.bestRecord.losses}` : "—")
            ]),
            el("div", { class:"sep" }),
            el("div", { style:"display:flex; gap:8px; align-items:center;" }, [
                button("View Hall of Fame", {
                    onClick: () => showGmHallOfFameModal(gm, g, () => rerender(root))
                }),
                (g.gmJobMarket && g.gmJobMarket.length)
                    ? el("span", { class:"p", style:"opacity:0.85;" }, "Some teams are willing to take a chance on you — see Job Market below.")
                    : el("span", { class:"p", style:"opacity:0.7;" }, "Start a new save to begin a fresh career.")
            ])
        ].filter(Boolean));
    }

    // Active panel
    const c = gm.contract || {};
    const e = gm.expectation || {};
    const approval = gm.ownerApproval ?? 70;
    const yearsLeft = c.years ?? 0;
    const inLastYear = yearsLeft <= 1;
    const onHotSeat = approval < 35;

    const wins = userTeam?.wins ?? 0;
    const losses = userTeam?.losses ?? 0;
    const gamesPlayed = wins + losses;
    const target = e.winTarget || 0;
    const onPace = gamesPlayed > 0 ? Math.round((wins / Math.max(1, gamesPlayed)) * (g.seasonWeeks * 4)) : null;

    const approvalColor = approval >= 70 ? "var(--good)" : approval >= 40 ? "var(--accent)" : "var(--bad)";
    const approvalLabel = approval >= 80 ? "Loved" : approval >= 60 ? "Trusted" : approval >= 40 ? "Watching" : approval >= 25 ? "Concerned" : "Hot Seat";

    const contractColor = inLastYear ? "var(--warn)" : "var(--text)";
    const contractLabel = inLastYear ? "Final Year" : `${yearsLeft} years left`;

    const ownerInfo = getOwnerInfo(userTeam);

    return el("div", {
        style: "margin-bottom:12px; border:1px solid var(--line); border-radius:10px; padding:12px;"
    }, [
        el("div", { style:"display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;" }, [
            el("div", {}, [
                el("div", { class:"h2", style:"margin:0;" }, "GM Office"),
                el("div", { style:"font-size:0.8em; opacity:0.6; margin-top:2px; display:flex; align-items:center; gap:6px;" }, [
                    el("span", {}, `Owner: ${ownerInfo.name}`),
                    el("span", { class:"badge", title: ownerInfo.blurb, style:"font-size:0.75em;" }, ownerInfo.label)
                ])
            ]),
            onHotSeat ? el("span", { class:"badge", style:"background:var(--bad); color:white;" }, "HOT SEAT") : null
        ].filter(Boolean)),
        reps.length ? el("div", { style:"margin-bottom:10px;" }, reputationBadges(reps)) : null,
        el("div", { style:"display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px;" }, [
            // Contract
            el("div", {}, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, "CONTRACT"),
                el("div", { style:`font-weight:bold; color:${contractColor};` }, contractLabel),
                el("div", { style:"font-size:0.85em; opacity:0.7;" }, `$${(c.salary || 0).toFixed(1)}M/yr`)
            ]),
            // Owner approval
            el("div", {}, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, "OWNER APPROVAL"),
                el("div", { style:`font-weight:bold; color:${approvalColor};` }, `${approval} · ${approvalLabel}`),
                el("div", { style:"height:6px; background:rgba(255,255,255,0.08); border-radius:3px; margin-top:4px;" },
                    el("div", { style:`height:100%; width:${approval}%; background:${approvalColor}; border-radius:3px;` }, []))
            ]),
            // Expectation
            el("div", {}, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, `THIS YEAR'S GOAL`),
                el("div", { style:"font-weight:bold;" }, e.description || "—"),
                el("div", { style:"font-size:0.85em; opacity:0.7;" },
                    g.phase === PHASES.REGULAR && gamesPlayed > 0
                        ? `${wins}-${losses} · pace ${onPace} · target ${target}`
                        : gamesPlayed > 0
                            ? `${wins}-${losses} · target ${target}`
                            : `Target: ${target} wins`)
            ])
        ])
    ]);
}

function careerStat(label, value) {
    return el("div", {}, [
        el("div", { style:"font-size:0.7em; opacity:0.5;" }, label),
        el("div", { style:"font-size:1.2em; font-weight:bold;" }, String(value))
    ]);
}

// Active mandate panel — shown during regular season when an owner has issued a directive.
function mandatePanel(g) {
    const mandate = g.gm?.activeMandate;
    if (!mandate || mandate.status !== "active") return null;
    if (g.phase !== PHASES.REGULAR) return null;

    const progress = getMandateProgress(mandate, g);
    const violated = mandate.violated;
    const acquired = mandate.acquired;
    const borderColor = violated ? "var(--bad)" : acquired ? "var(--good)" : "var(--warn)";

    return el("div", {
        style: `margin-bottom:12px; border:2px solid ${borderColor}; border-radius:10px; padding:12px; background:rgba(255,200,80,0.04);`
    }, [
        el("div", { style:"display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;" }, [
            el("div", { class:"h2", style:`color:${borderColor}; margin:0;` }, "Owner Mandate"),
            el("span", { class:"badge", style:"font-size:0.75em; opacity:0.7;" }, `Week ${mandate.issuedWeek} · resolves at season end`)
        ]),
        el("div", { class:"p", style:"font-style:italic; opacity:0.9; margin-bottom:8px;" }, `"${mandate.description}"`),
        progress ? el("div", { style:"display:flex; gap:16px; align-items:center; font-size:0.9em;" }, [
            el("span", { style:"opacity:0.6;" }, "Progress:"),
            el("span", { style:"font-weight:bold;" }, progress)
        ]) : null,
        el("div", { style:"display:flex; gap:14px; margin-top:8px; font-size:0.8em; opacity:0.65;" }, [
            el("span", {}, `Complete: +${mandate.reward} approval`),
            el("span", {}, `Fail: ${mandate.penalty} approval`)
        ])
    ].filter(Boolean));
}

// GM Hall of Fame modal — career retrospective. Shows when fired GM clicks the View Career button,
// or accessible via the GM Office for a retrospective during retirement.
function showGmHallOfFameModal(gm, g, onClose) {
    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.88); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        if (onClose) onClose();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const c = gm.career || {};
    const reps = computeReputations(gm, g);
    const stints = c.teamsHistory || [];

    const renderStint = (s, i) => {
        const yearRange = s.endYear
            ? `${s.startYear}-${s.endYear}`
            : `${s.startYear}-present`;
        return el("div", {
            style: "border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:6px;"
        }, [
            el("div", { style:"display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;" }, [
                el("span", { style:"font-weight:bold;" }, s.teamName),
                el("span", { class:"badge", style:"font-size:0.75em; opacity:0.7;" }, yearRange)
            ]),
            el("div", { style:"display:flex; gap:14px; font-size:0.85em; opacity:0.75;" }, [
                el("span", {}, `${s.yearsWithTeam || 0}y`),
                el("span", {}, `${s.titlesWithTeam || 0} titles`),
                el("span", {}, `${s.playoffsWithTeam || 0} playoffs`),
                el("span", {}, s.endingRating
                    ? `Rating ${s.startingRating || 70}→${s.endingRating}`
                    : `Rating ${s.startingRating || 70}→${(g.league.teams.find(t => t.id === s.teamId)?.rating) || s.startingRating || 70}`)
            ])
        ]);
    };

    const modal = el("div", {
        class: "card",
        style: "width:680px; max-width:94%; max-height:90vh; overflow-y:auto;"
    }, [
        el("div", { style:"text-align:center; padding-bottom:8px;" }, [
            el("div", { style:"font-size:1.7em; font-weight:bold; color:var(--accent);" }, "GM Hall of Fame"),
            el("div", { style:"opacity:0.6; margin-top:4px;" },
                `${c.yearsAsGM || 0} years as GM · ${c.titles || 0} championship${c.titles === 1 ? "" : "s"}`)
        ]),
        reps.length ? el("div", { style:"margin-bottom:12px;" }, reputationBadges(reps)) : null,
        el("div", { class:"sep" }),
        el("div", { class:"h2", style:"font-size:0.85em; opacity:0.6;" }, "CAREER NUMBERS"),
        el("div", { style:"display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin:6px 0 16px;" }, [
            careerStat("Years", c.yearsAsGM || 0),
            careerStat("Titles", c.titles || 0),
            careerStat("Finals", c.finalsAppearances || 0),
            careerStat("Playoffs", c.playoffAppearances || 0),
            careerStat("Losing Seasons", c.losingSeasons || 0),
            careerStat("Trades", c.tradesExecuted || 0),
            careerStat("Extensions", c.extensions || 0),
            careerStat("Best Record", c.bestRecord?.wins ? `${c.bestRecord.wins}-${c.bestRecord.losses}` : "—")
        ]),
        stints.length ? el("div", {}, [
            el("div", { class:"h2", style:"font-size:0.85em; opacity:0.6; margin-bottom:6px;" }, "STINTS"),
            ...stints.map(renderStint)
        ]) : null,
        el("div", { class:"sep" }),
        el("button", { class:"btn btnPrimary", style:"width:100%;", onclick: close }, "Close")
    ].filter(Boolean));

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Renders earned reputations as tooltip-hinted badges.
function reputationBadges(reps) {
    return el("div", { style:"display:flex; gap:6px; flex-wrap:wrap;" },
        reps.map(r => {
            const isNeg = r.key === "embattled";
            const bg = isNeg ? "rgba(255,80,80,0.15)" : "rgba(120,200,255,0.12)";
            const border = isNeg ? "var(--bad)" : "var(--accent)";
            return el("span", {
                class: "badge",
                title: r.blurb,
                style: `background:${bg}; border:1px solid ${border}; font-size:0.75em;`
            }, r.label);
        })
    );
}

// Job Market panel — appears when poaching/wilderness offers are pending.
// Shows each offer with team info, pitch, contract terms, and Accept buttons.
// "Decline All" clears the market and keeps the user on their current team.
function jobMarketPanel(g, root) {
    const offers = g.gmJobMarket || [];
    if (!offers.length) return null;

    const gm = g.gm;
    const isFired = gm?.status === "fired";
    const outsideCount = offers.filter(o => o.kind !== "loyalty").length;
    const hasLoyalty = offers.some(o => o.kind === "loyalty");
    const headerText = isFired
        ? "Job Market — Available Openings"
        : hasLoyalty
            ? `Decision Time: ${outsideCount} outside offer${outsideCount > 1 ? "s" : ""} + loyalty counter`
            : `Outside Interest (${outsideCount})`;
    const headerColor = isFired ? "var(--warn)" : hasLoyalty ? "var(--good)" : "var(--accent)";

    const currentSalary = gm?.contract?.salary || 0;

    const renderOffer = (offer) => {
        const team = g.league.teams.find(t => t.id === offer.teamId);
        if (!team) return null;
        const rating = offer.teamRating || team.rating || 70;
        const isLoyalty = offer.kind === "loyalty";
        const tierColor = isLoyalty ? "var(--good)"
            : offer.teamTier === "title" ? "var(--good)"
            : offer.teamTier === "contender" ? "var(--accent)"
            : offer.teamTier === "playoffs" ? "var(--text)"
            : "var(--warn)";

        const handleAccept = () => {
            let confirmed;
            if (isLoyalty) {
                confirmed = confirm(`Sign an extension with the ${team.name}? Outside offers will be declined.`);
            } else if (isFired) {
                confirmed = confirm(`Take the ${team.name} job?`);
            } else {
                confirmed = confirm(`Leave your current team to become GM of the ${team.name}?\n\nThis cannot be undone.`);
            }
            if (!confirmed) return;
            const res = isLoyalty ? acceptLoyaltyOffer(offer.id) : acceptPoachingOffer(offer.id);
            alert(res.msg);
            rerender(root);
        };

        const salaryDelta = !isLoyalty && currentSalary > 0
            ? offer.salary - currentSalary
            : 0;
        const salaryNote = !isLoyalty && salaryDelta > 0
            ? el("span", { style:"color:var(--good); font-size:0.8em; margin-left:6px;" }, `(+$${salaryDelta.toFixed(1)}M vs current)`)
            : null;

        const borderColor = isLoyalty ? "var(--good)" : "var(--line)";
        const bg = isLoyalty ? "rgba(120,255,160,0.05)" : "transparent";

        return el("div", {
            style: `border:1px solid ${borderColor}; border-radius:8px; padding:12px; margin-bottom:8px; background:${bg};`
        }, [
            el("div", { style:"display:flex; justify-content:space-between; align-items:start; gap:12px; margin-bottom:8px;" }, [
                el("div", {}, [
                    el("div", { style:"display:flex; align-items:center; gap:8px;" }, [
                        el("span", { style:"font-weight:bold; font-size:1.05em;" }, team.name),
                        isLoyalty ? el("span", {
                            class: "badge",
                            style: "background:var(--good); color:white; font-size:0.7em; text-transform:uppercase;"
                        }, "Loyalty Offer") : null
                    ].filter(Boolean)),
                    el("div", { style:"font-size:0.85em; opacity:0.65;" },
                        isLoyalty ? `Your current team · OVR ${rating}` : `${team.wins ?? 0}-${team.losses ?? 0} last season · OVR ${rating}`)
                ]),
                !isLoyalty ? el("span", {
                    class: "badge",
                    style: `background:rgba(255,255,255,0.05); border:1px solid ${tierColor}; color:${tierColor}; text-transform:uppercase; font-size:0.7em;`
                }, offer.teamTier) : null
            ].filter(Boolean)),
            el("div", { class:"p", style:"font-style:italic; opacity:0.85; margin-bottom:8px; line-height:1.4;" }, offer.pitch),
            el("div", { style:"display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;" }, [
                el("div", {}, [
                    el("div", { style:"font-size:0.7em; opacity:0.5;" }, isLoyalty ? "EXTENSION" : "CONTRACT"),
                    el("div", { style:"font-weight:bold;" }, isLoyalty ? `+${offer.contractYears} years` : `${offer.contractYears} years`)
                ]),
                el("div", {}, [
                    el("div", { style:"font-size:0.7em; opacity:0.5;" }, "SALARY"),
                    el("div", { style:"font-weight:bold; display:flex; align-items:center;" }, [
                        el("span", {}, `$${offer.salary.toFixed(1)}M/yr`),
                        salaryNote
                    ].filter(Boolean))
                ])
            ]),
            button(isLoyalty ? "Sign Extension" : "Accept Offer", { primary: true, onClick: handleAccept })
        ]);
    };

    const cards = offers.map(renderOffer).filter(Boolean);

    return el("div", {
        style: `margin-bottom:12px; border:2px solid ${headerColor}; border-radius:10px; padding:12px; background:rgba(255,255,255,0.02);`
    }, [
        el("div", { class:"h2", style:`color:${headerColor};` }, headerText),
        el("div", { class:"p", style:"opacity:0.7; margin-bottom:10px;" },
            isFired
                ? "Pick a job and get back to work, or stay retired."
                : "These teams have an opening and reached out about your services."),
        ...cards,
        !isFired ? button("Decline All — Stay Put", {
            onClick: () => {
                declineAllPoachingOffers();
                rerender(root);
            }
        }) : button("Stay Retired", {
            onClick: () => {
                if (!confirm("Reject all offers and remain retired? This effectively ends your dynasty.")) return;
                declineAllPoachingOffers();
                rerender(root);
            }
        })
  ]);
}

function schedulePanel(g) {
  if (g.phase !== PHASES.REGULAR) return null;
  const userTeam = g.league.teams[g.userTeamIndex];
  if (!userTeam) return null;

  const remaining = [];
  for (const week of (g.schedule || [])) {
    if (week.week < g.week) continue;
    for (const game of (week.games || [])) {
      const homeId = game.homeId || game[0];
      const awayId = game.awayId || game[1];
      if (homeId !== userTeam.id && awayId !== userTeam.id) continue;

      const opponentId = homeId === userTeam.id ? awayId : homeId;
      const opponent = g.league.teams.find(t => t.id === opponentId);
      if (!opponent) continue;
      remaining.push({
        week: week.week,
        opponent,
        isHome: homeId === userTeam.id,
        hasStoredVenue: !!game.homeId
      });
    }
  }

  const nextGames = remaining.slice(0, 5);
  const opponentGames = remaining
    .map(x => (x.opponent.wins || 0) + (x.opponent.losses || 0))
    .filter(Boolean);
  const oppWinPct = opponentGames.length
    ? remaining.reduce((sum, x) => {
        const games = (x.opponent.wins || 0) + (x.opponent.losses || 0);
        return sum + (games ? (x.opponent.wins || 0) / games : 0);
      }, 0) / Math.max(1, remaining.filter(x => (x.opponent.wins || 0) + (x.opponent.losses || 0) > 0).length)
    : null;

  return card("Upcoming Schedule", "Home and away games are now part of the season schedule.", [
    el("div", { class:"row" }, [
      badge(`${remaining.length} games remaining`),
      oppWinPct !== null ? badge(`Opp win% ${(oppWinPct * 100).toFixed(1)}`) : null
    ].filter(Boolean)),
    el("div", { class:"sep" }),
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Week"),
        el("th", {}, "Venue"),
        el("th", {}, "Opponent"),
        el("th", {}, "Record")
      ])),
      el("tbody", {}, nextGames.length ? nextGames.map(x => el("tr", {}, [
        el("td", {}, String(x.week)),
        el("td", {}, x.hasStoredVenue ? (x.isHome ? "Home" : "Away") : "TBD"),
        el("td", {}, x.opponent.name),
        el("td", {}, `${x.opponent.wins || 0}-${x.opponent.losses || 0}`)
      ])) : [
        el("tr", {}, [el("td", { colspan:"4" }, "No regular season games remaining.")])
      ])
    ])
  ]);
}

// Year-End owner review modal. One of: big_extension | extension | hot_seat | lame_duck | warning | status_quo | fired.
function showGMReviewModal(review, gm, onClose) {
    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        onClose();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const isFired = review.action === "fired";
    const goodActions = ["big_extension", "extension"];
    const warnActions = ["hot_seat", "lame_duck", "warning"];

    const headerColor = isFired ? "var(--bad)"
        : goodActions.includes(review.action) ? "var(--good)"
        : warnActions.includes(review.action) ? "var(--warn)"
        : "var(--text)";

    const headerText = isFired ? "Fired"
        : review.action === "big_extension" ? "Major Extension!"
        : review.action === "extension" ? "Contract Extended"
        : review.action === "hot_seat" ? "Hot Seat"
        : review.action === "lame_duck" ? "Final Year"
        : review.action === "warning" ? "Owner Warning"
        : "Year-End Review";

    const verdictText = {
        exceeded_title: "Title Won",
        exceeded: "Exceeded Expectations",
        met: "Met Expectations",
        close: "Just Short",
        missed: "Missed Expectations",
        failed: "Disappointing Season"
    }[review.verdict] || review.verdict;

    const verdictColor = ["exceeded_title", "exceeded"].includes(review.verdict) ? "var(--good)"
        : ["met"].includes(review.verdict) ? "var(--accent)"
        : "var(--bad)";

    const careerBody = isFired ? [
        el("div", { class:"sep" }),
        el("div", { class:"h2", style:"font-size:0.85em; opacity:0.6;" }, "CAREER SUMMARY"),
        el("div", { style:"display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:6px;" }, [
            careerStat("Years as GM", gm.career?.yearsAsGM || 0),
            careerStat("Titles", gm.career?.titles || 0),
            careerStat("Playoffs", gm.career?.playoffAppearances || 0)
        ])
    ] : [];

    const contractBody = !isFired ? [
        el("div", { class:"sep" }),
        el("div", { class:"h2", style:"font-size:0.85em; opacity:0.6;" }, "NEW CONTRACT TERMS"),
        el("div", { style:"display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:6px;" }, [
            careerStat("Years Remaining", review.yearsRemaining),
            careerStat("Salary", `$${review.salary.toFixed(1)}M`),
            careerStat("Owner Approval", review.ownerApproval)
        ]),
        review.salaryChange ? el("div", { class:"p", style:`color:${review.salaryChange > 0 ? "var(--good)" : "var(--bad)"}; margin-top:6px;` },
            `Salary ${review.salaryChange > 0 ? "raised" : "reduced"} by ${Math.abs(Math.round(review.salaryChange * 100))}%.`) : null
    ] : [];

    const modal = el("div", { class:"card", style:"width:560px; max-width:92%; max-height:88vh; overflow-y:auto;" }, [
        el("div", { style:"text-align:center; padding-bottom:8px;" }, [
            el("div", { style:`font-size:1.7em; font-weight:bold; color:${headerColor};` }, headerText),
            el("div", { style:"font-size:1em; opacity:0.6; margin-top:4px;" }, `Year ${review.year} Owner Review`)
        ]),
        el("div", { class:"sep" }),
        el("div", { style:"display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;" }, [
            el("div", { class:"card", style:"flex:1; min-width:160px; padding:10px;" }, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, "SEASON RESULT"),
                el("div", { style:"font-size:1.3em; font-weight:bold;" }, `${review.wins}-${review.losses}`),
                el("div", { style:"opacity:0.7; font-size:0.9em;" }, review.playoffFinish || "Regular Season")
            ]),
            el("div", { class:"card", style:"flex:1; min-width:160px; padding:10px;" }, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, "OWNER GOAL"),
                el("div", { style:"font-size:1em; font-weight:bold;" }, review.expectationDescription || "—"),
                el("div", { style:"opacity:0.7; font-size:0.9em;" }, `Target: ${review.winTarget} wins (${review.winDelta >= 0 ? "+" : ""}${review.winDelta})`)
            ]),
            el("div", { class:"card", style:"flex:1; min-width:160px; padding:10px;" }, [
                el("div", { style:"font-size:0.75em; opacity:0.55;" }, "VERDICT"),
                el("div", { style:`font-size:1.1em; font-weight:bold; color:${verdictColor};` }, verdictText)
            ])
        ]),
        el("div", { class:"card", style:"padding:12px; background:rgba(255,255,255,0.02);" }, [
            el("div", { style:"font-size:0.75em; opacity:0.55; margin-bottom:4px;" }, "FROM THE OWNER"),
            el("div", { class:"p", style:"line-height:1.45;" }, review.ownerMessage)
        ]),
        ...contractBody,
        ...careerBody,
        el("div", { class:"sep" }),
        el("button", {
            class: "btn btnPrimary",
            style: "width:100%;",
            onclick: close
        }, isFired ? "Acknowledge" : "Continue")
    ].filter(Boolean));

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Incoming-trade-offer panel — shown only when CPU teams have pending offers for the user.
// Renders Accept / Decline buttons that resolve via state.js and trigger a re-render.
function pendingOffersPanel(g, root) {
    const offers = g.pendingTradeOffers || [];
    if (!offers.length) return null;

    const userTeam = g.league.teams[g.userTeamIndex];
    const teamById = (id) => g.league.teams.find(t => t.id === id);

    const renderOffer = (offer) => {
        const cpuTeam = teamById(offer.fromTeamId);
        if (!cpuTeam) return null;

        // Resolve assets by ID — if anything is missing the offer became invalid, show a hint
        const userPlayers = offer.userPlayerIds.map(pid => userTeam.roster.find(p => p.id === pid)).filter(Boolean);
        const otherPlayers = offer.otherPlayerIds.map(pid => cpuTeam.roster.find(p => p.id === pid)).filter(Boolean);
        const userPicks = offer.userPickIds.map(pid => (userTeam.assets?.picks || []).find(pk => pk.id === pid)).filter(Boolean);
        const otherPicks = offer.otherPickIds.map(pid => (cpuTeam.assets?.picks || []).find(pk => pk.id === pid)).filter(Boolean);

        const stillValid =
            userPlayers.length === offer.userPlayerIds.length &&
            otherPlayers.length === offer.otherPlayerIds.length &&
            userPicks.length === offer.userPickIds.length &&
            otherPicks.length === offer.otherPickIds.length;

        const fmtAsset = (p, isPick) => isPick
            ? `Y${p.year} R${p.round}`
            : `${p.name} (${p.pos} ${p.ovr})`;
        const userSide = [
            ...userPlayers.map(p => fmtAsset(p, false)),
            ...userPicks.map(pk => fmtAsset(pk, true))
        ].join(" + ") || "(nothing)";
        const otherSide = [
            ...otherPlayers.map(p => fmtAsset(p, false)),
            ...otherPicks.map(pk => fmtAsset(pk, true))
        ].join(" + ") || "(nothing)";

        const handleAccept = () => {
            const res = acceptUserTradeOffer(offer.id);
            alert(res.msg);
            rerender(root);
        };
        const handleDecline = () => {
            declineUserTradeOffer(offer.id);
            rerender(root);
        };

        return el("div", {
            style: "border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);"
        }, [
            el("div", { style:"display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;" }, [
                el("div", {}, [
                    el("span", { style:"font-weight:bold; color:var(--accent);" }, cpuTeam.name),
                    el("span", { style:"opacity:0.65; margin-left:8px;" }, `(${offer.reason || "wants to talk"})`)
                ]),
                el("span", { class:"badge", style:"opacity:0.7;" }, `expires week ${offer.expiresWeek}`)
            ]),
            el("div", { style:"display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:8px;" }, [
                el("div", {}, [
                    el("div", { style:"font-size:0.8em; opacity:0.55; margin-bottom:2px;" }, "YOU SEND"),
                    el("div", {}, userSide)
                ]),
                el("div", {}, [
                    el("div", { style:"font-size:0.8em; opacity:0.55; margin-bottom:2px;" }, "YOU GET"),
                    el("div", {}, otherSide)
                ])
            ]),
            !stillValid
                ? el("div", { style:"color:var(--warn); font-size:0.85em;" }, "Offer no longer valid — assets have moved.")
                : el("div", { style:"display:flex; gap:8px;" }, [
                    button("Accept", { primary: true, small: true, onClick: handleAccept }),
                    button("Decline", { small: true, onClick: handleDecline })
                ])
        ]);
    };

    const cards = offers.map(renderOffer).filter(Boolean);
    if (!cards.length) return null;

    return el("div", { style:"margin-bottom:12px;" }, [
        el("div", { class:"h2" }, `Trade Offers (${cards.length})`),
        ...cards
    ]);
}

// MVP race panel — only shown during regular season once enough games are in the books.
function mvpRacePanel(g) {
    if (g.phase !== PHASES.REGULAR) return null;
    if (g.week < 4) return null; // wait for meaningful sample
    const top = computeMVPRace(g, 5);
    if (!top.length) return null;

    const userTeamId = g.league.teams[g.userTeamIndex]?.id;

    const rows = top.map((c, i) => {
        const isUser = c.teamId === userTeamId;
        return el("div", {
            style: `display:flex; justify-content:space-between; align-items:center; padding:4px 0; ${i < top.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : ''}`
        }, [
            el("span", { style:"opacity:0.5; width:24px;" }, `${i + 1}.`),
            el("span", { style:`flex:1; ${isUser ? 'color:var(--good); font-weight:bold;' : ''}` }, `${c.name} (${c.pos})`),
            el("span", { style:"opacity:0.6; font-size:0.85em; margin-right:8px;" }, c.teamName),
            el("span", { style:"font-weight:bold; color:var(--accent); width:90px; text-align:right;" },
                `${c.ptsPg}p ${c.astPg}a`)
        ]);
    });

    return el("div", { style:"margin-bottom:10px;" }, [
        el("div", { class:"h2", style:"display:flex; justify-content:space-between; align-items:center;" }, [
            el("span", {}, "MVP Race"),
            el("span", { style:"font-size:0.75em; opacity:0.5; font-weight:normal;" }, `through Week ${Math.min(g.week - 1, g.seasonWeeks)}`)
        ]),
        el("div", {}, rows)
    ]);
}

function showAllStarModal(allStars, onClose) {
    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const renderRoster = (title, list) => {
        return el("div", { style:"flex:1; min-width:200px;" }, [
            el("div", { class:"h2", style:"text-align:center; border-bottom:1px solid var(--line); padding-bottom:4px;" }, title),
            ...list.map(p => el("div", {
                class:"p",
                style:"display:flex; justify-content:space-between; cursor:pointer;",
                onclick: () => showPlayerModal(p)
            }, [
                el("span", {}, `${p.pos} - ${p.name}`),
                el("span", { style:"color:var(--accent); font-size:0.85em;" }, p.teamName)
            ]))
        ]);
    };

    const renderSnubs = (title, snubs) => {
        if (!snubs || !snubs.length) return null;
        return el("div", { style:"margin-top:12px;" }, [
            el("div", { class:"h2", style:"font-size:0.9em; color:var(--warn); margin-bottom:4px;" }, title),
            el("div", { style:"display:flex; flex-wrap:wrap; gap:6px;" },
                snubs.map(p => el("div", {
                    class:"badge",
                    style:"background:rgba(255,165,0,0.15); border:1px solid var(--warn); cursor:pointer; font-size:0.85em;",
                    onclick: () => showPlayerModal(p)
                }, `${p.pos} ${p.name} (${p.teamName})`))
            )
        ]);
    };

    const modal = el("div", { class:"card", style:"width:650px; max-width:90%; max-height:80vh; overflow-y:auto;" }, [
        el("div", { class:"h2", style:"text-align:center; font-size:1.5em; color:var(--good);" }, "All-Star Rosters Announced!"),
        el("div", { class:"sep" }),
        el("div", { style:"display:flex; gap:20px; flex-wrap:wrap;" }, [
            renderRoster("Eastern Conference", allStars.east),
            renderRoster("Western Conference", allStars.west)
        ]),
        renderSnubs("East Snubs (just missed)", allStars.eastSnubs),
        renderSnubs("West Snubs (just missed)", allStars.westSnubs),
        el("div", { class:"sep" }),
        button("Continue to Playoffs", {
            primary: true,
            style: "width:100%",
            onClick: () => {
                document.body.removeChild(overlay);
                onClose();
            }
        })
    ]);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function showSeasonRecapModal(recap, onClose) {
    recap.viewed = true;

    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        onClose();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const awardRow = (label, val) => val
        ? el("div", { style: "display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.07);" }, [
            el("span", { style: "opacity:0.65;" }, label),
            el("span", { style: "font-weight:bold;" }, `${val.player} (${val.team})`)
          ])
        : null;

    const miniStatTable = (leaders, label) => {
        if (!leaders || !leaders.length) return null;
        const rows = leaders.slice(0, 3).map((p, i) =>
            el("div", { style: "display:flex; justify-content:space-between; font-size:0.88em; padding:2px 0;" }, [
                el("span", { style: "opacity:0.5; width:18px;" }, `${i + 1}.`),
                el("span", { style: "flex:1;" }, p.name),
                el("span", { style: "opacity:0.6; font-size:0.85em; margin-right:8px;" }, p.team),
                el("span", { style: "font-weight:bold; color:var(--accent); width:40px; text-align:right;" }, String(p[label]))
            ])
        );
        return el("div", { style: "flex:1; min-width:140px;" }, rows);
    };

    const finishColor = recap.userFinish === "Champion" ? "var(--good)"
        : recap.userFinish === "Finals" ? "var(--accent)"
        : "var(--text)";

    const fmtDelta = (n) => n > 0 ? `+${n}` : String(n);
    const deltaColor = (n) => n > 0 ? "var(--good)" : n < 0 ? "var(--bad)" : "var(--muted)";
    const developmentRows = (recap.developmentReport || [])
        .slice()
        .sort((a, b) => b.ovrDelta - a.ovrDelta || b.newOvr - a.newOvr)
        .map(p => el("tr", {}, [
            el("td", { style:"font-weight:bold;" }, p.name),
            el("td", {}, `${p.pos} ${p.newAge}`),
            el("td", {}, p.potentialGrade || "-"),
            el("td", {}, p.focus || "Balanced"),
            el("td", {}, `${p.ovr} -> ${p.newOvr}`),
            el("td", { style:`font-weight:bold; color:${deltaColor(p.ovrDelta)};` }, fmtDelta(p.ovrDelta)),
            el("td", { style:`color:${deltaColor(p.offDelta)};` }, fmtDelta(p.offDelta)),
            el("td", { style:`color:${deltaColor(p.defDelta)};` }, fmtDelta(p.defDelta)),
            el("td", {}, `${p.minutes} min / ${p.ppg} ppg`),
            el("td", {}, p.status),
            el("td", { style:"font-size:0.82em; opacity:0.75;" }, (p.reasons || []).join(", "))
        ]));

    const modal = el("div", { class: "card", style: "width:620px; max-width:92%; max-height:88vh; overflow-y:auto;" }, [
        el("div", { style: "text-align:center; padding-bottom:8px;" }, [
            el("div", { style: "font-size:1.7em; font-weight:bold; color:var(--good);" }, `${recap.year} Season Complete`),
            el("div", { style: "font-size:1.1em; color:var(--accent); margin-top:4px;" }, `${recap.champion} are Champions!`)
        ]),
        el("div", { class: "sep" }),

        el("div", { style: "display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px;" }, [
            el("div", { class: "card", style: "flex:1; min-width:140px; padding:10px;" }, [
                el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:4px;" }, "YOUR SEASON"),
                el("div", { style: "font-size:1.4em; font-weight:bold;" }, recap.userRecord),
                el("div", { style: `color:${finishColor}; font-weight:bold; margin-top:4px;` }, recap.userFinish)
            ]),
            el("div", { class: "card", style: "flex:2; min-width:220px; padding:10px;" }, [
                el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:6px;" }, "AWARDS"),
                awardRow("MVP", recap.awards?.MVP),
                awardRow("DPOY", recap.awards?.DPOY),
                awardRow("OPOY", recap.awards?.OPOY),
                awardRow("ROY", recap.awards?.ROY)
            ].filter(Boolean))
        ]),

        recap.statsLeaders ? el("div", { class: "card", style: "padding:10px;" }, [
            el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:8px;" }, "STATS LEADERS (TOP 3)"),
            el("div", { style: "display:flex; gap:16px; flex-wrap:wrap;" }, [
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "POINTS PER GAME"),
                    miniStatTable(recap.statsLeaders.ppg, "ppg")
                ]),
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "REBOUNDS PER GAME"),
                    miniStatTable(recap.statsLeaders.rpg, "rpg")
                ]),
                el("div", { style: "flex:1; min-width:140px;" }, [
                    el("div", { style: "font-size:0.8em; opacity:0.5; margin-bottom:4px;" }, "ASSISTS PER GAME"),
                    miniStatTable(recap.statsLeaders.apg, "apg")
                ])
            ].filter(Boolean))
        ]) : null,

        developmentRows.length ? el("div", { class: "card", style: "padding:10px; margin-top:12px;" }, [
            el("div", { class: "h2", style: "font-size:0.85em; opacity:0.6; margin-bottom:8px;" }, "PLAYER DEVELOPMENT"),
            el("div", { style:"overflow-x:auto;" }, [
                el("table", { class:"table" }, [
                    el("thead", {}, el("tr", {}, [
                        el("th", {}, "Player"),
                        el("th", {}, "Age"),
                        el("th", {}, "Pot"),
                        el("th", {}, "Focus"),
                        el("th", {}, "OVR"),
                        el("th", {}, "+/-"),
                        el("th", {}, "OFF"),
                        el("th", {}, "DEF"),
                        el("th", {}, "Role"),
                        el("th", {}, "Status"),
                        el("th", {}, "Why")
                    ])),
                    el("tbody", {}, developmentRows)
                ])
            ])
        ]) : null,

        el("div", { class: "sep" }),
        el("div", { style: "display:flex; gap:8px;" }, [
            el("button", {
                class: "btn btnPrimary",
                style: "flex:1;",
                onclick: () => { close(); location.hash = "#/free-agency"; }
            }, "Go to Free Agency"),
            el("button", {
                class: "btn",
                onclick: close
            }, "Close")
        ])
    ].filter(Boolean));

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function rerender(root, mut){
  if (mut) mut();
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(DashboardScreen());
}
