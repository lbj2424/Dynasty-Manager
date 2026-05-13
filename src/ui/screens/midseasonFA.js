import { el, card, button, badge, showPlayerModal } from "../components.js";
import { getState, signMidseasonFreeAgent, calculateSignChance } from "../../state.js";
import { PHASES } from "../../data/constants.js";

export function MidseasonFAScreen() {
    const s = getState();
    const g = s.game;
    const root = el("div", {}, []);

    if (g.phase !== PHASES.REGULAR) {
        root.appendChild(card("Available Players", "Only accessible during the regular season.", []));
        return root;
    }

    const pool = (g.midseasonFaPool || []).filter(p => !p.signedByTeamId);
    const userTeam = g.league.teams[g.userTeamIndex];
    const capSpace = Math.max(0, userTeam.cap.cap - userTeam.cap.payroll);

    if (!s.midFaFilter) s.midFaFilter = { pos: "All", sort: "OVR" };
    const filter = s.midFaFilter;
    const posOpts = ["All", "PG", "SG", "SF", "PF", "C"];
    const sortOpts = ["OVR", "Age", "Ask"];

    const filterBar = el("div", { class: "row", style: "gap:10px; margin-bottom:10px;" }, [
        el("span", {}, "Position: "),
        el("select", { onchange: (e) => { filter.pos = e.target.value; rerender(root); } },
            posOpts.map(o => el("option", { value: o, selected: o === filter.pos }, o))
        ),
        el("span", {}, "Sort: "),
        el("select", { onchange: (e) => { filter.sort = e.target.value; rerender(root); } },
            sortOpts.map(o => el("option", { value: o, selected: o === filter.sort }, o))
        )
    ]);

    let list = [...pool];
    if (filter.pos !== "All") list = list.filter(p => p.pos === filter.pos);
    if (filter.sort === "OVR") list.sort((a, b) => b.ovr - a.ovr);
    else if (filter.sort === "Age") list.sort((a, b) => a.age - b.age);
    else if (filter.sort === "Ask") list.sort((a, b) => a.ask - b.ask);

    const rows = list.map(p => {
        const nameLink = el("span", {
            style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
            onclick: () => showPlayerModal(p)
        }, p.name);
        const source = p.cutByTeamName
            ? `Cut by ${p.cutByTeamName}`
            : p.formerTeamName
            ? `Formerly ${p.formerTeamName}`
            : "Unsigned";

        return el("tr", {}, [
            el("td", {}, nameLink),
            el("td", {}, p.pos),
            el("td", { style: "font-weight:bold;" }, String(p.ovr)),
            el("td", { style: "color:var(--good);" }, String(p.off ?? p.ovr)),
            el("td", { style: "color:var(--warn);" }, String(p.def ?? p.ovr)),
            el("td", {}, String(p.age)),
            el("td", {}, p.potentialGrade),
            el("td", {}, `$${p.ask}M / ${p.yearsAsk}y`),
            el("td", {}, source),
            el("td", {}, button("Sign", {
                small: true,
                onClick: () => showSignModal(p, userTeam, capSpace, g, () => rerender(root))
            }))
        ]);
    });

    root.appendChild(card(
        "Available Free Agents",
        `Cut and unsigned players available during the regular season. Cap Space: $${capSpace.toFixed(1)}M - Roster: ${userTeam.roster.length}/15`,
        [
            filterBar,
            el("div", { class: "sep" }),
            pool.length === 0
                ? el("div", { class: "p", style: "opacity:0.6;" }, "No free agents available. Players appear here after being cut or going unsigned in free agency.")
                : el("table", { class: "table" }, [
                    el("thead", {}, el("tr", {}, [
                        el("th", {}, "Player"), el("th", {}, "Pos"), el("th", {}, "OVR"),
                        el("th", {}, "OFF"), el("th", {}, "DEF"), el("th", {}, "Age"),
                        el("th", {}, "Pot"), el("th", {}, "Ask"), el("th", {}, "Source"), el("th", {}, "")
                    ])),
                    el("tbody", {}, rows.length ? rows : [
                        el("tr", {}, [el("td", { colspan: "10" }, "No players match filter.")])
                    ])
                ])
        ]
    ));

    return root;
}

function showSignModal(p, team, capSpace, g, onClose) {
    let offerSalary = p.ask;
    let offerYears = p.yearsAsk;

    const overlay = el("div", {
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;"
    }, []);

    const content = el("div", { class: "card", style: "width:380px; max-width:90%;" }, []);

    const render = () => {
        content.innerHTML = "";
        // No competing offers during regular season — player is desperate
        const chance = calculateSignChance(p, offerSalary, offerYears);
        const color = chance > 80 ? "var(--good)" : chance > 40 ? "var(--warn)" : "var(--bad)";
        const canAfford = capSpace >= offerSalary && team.roster.length < 15;

        content.appendChild(el("div", { class: "spread" }, [
            el("div", { class: "h2" }, `Sign ${p.name}`),
            button("Close", { small: true, onClick: () => { document.body.removeChild(overlay); onClose(); } })
        ]));
        content.appendChild(el("div", { class: "p" }, [
            el("div", {}, `${p.pos} · OVR ${p.ovr} · Age ${p.age} · Pot ${p.potentialGrade}`),
            el("div", {}, `Ask: $${p.ask}M / ${p.yearsAsk}y`),
            el("div", { style: "color:var(--good); font-size:0.9em;" }, "No competing offers — will accept below asking price.")
        ]));
        content.appendChild(el("div", { class: "sep" }));

        const salInput = el("input", {
            type: "number", step: "0.1", value: String(offerSalary),
            style: "width:100%; padding:8px; margin-bottom:10px;",
            onchange: (e) => { offerSalary = parseFloat(e.target.value); render(); }
        });
        const yearInput = el("select", {
            style: "width:100%; padding:8px; margin-bottom:10px;",
            onchange: (e) => { offerYears = parseInt(e.target.value); render(); }
        }, [1, 2, 3, 4].map(y => el("option", { value: y, selected: y === offerYears }, `${y} Year${y !== 1 ? 's' : ''}`)));

        content.appendChild(el("div", {}, [
            el("label", {}, "Salary (M)"), salInput,
            el("label", {}, "Contract Length"), yearInput
        ]));

        content.appendChild(el("div", { class: "p", style: `font-weight:bold; color:${color}; text-align:center; margin:10px 0;` },
            `Signing Probability: ${chance}%`
        ));
        content.appendChild(el("div", { class: "barWrap" }, [
            el("div", { class: "barFill", style: `width:${chance}%; background:${color}` })
        ]));

        if (!canAfford) {
            content.appendChild(el("div", { class: "p", style: "color:var(--bad); margin-top:8px;" },
                team.roster.length >= 15 ? "Roster full (15/15)." : `Not enough cap space ($${capSpace.toFixed(1)}M available).`
            ));
        }

        content.appendChild(button("Submit Offer", {
            primary: true, style: "width:100%; margin-top:12px;",
            disabled: !canAfford,
            onClick: () => {
                if (Math.random() * 100 <= chance) {
                    const result = signMidseasonFreeAgent(p.id, offerSalary, offerYears);
                    alert(result.success ? `${p.name} signed!` : result.msg);
                } else {
                    alert(`${p.name} rejected your offer.`);
                }
                document.body.removeChild(overlay);
                onClose();
            }
        }));
    };

    render();
    overlay.appendChild(content);
    document.body.appendChild(overlay);
}

function rerender(root) {
    const parent = root.parentElement;
    if (!parent) return;
    parent.innerHTML = "";
    parent.appendChild(MidseasonFAScreen());
}
