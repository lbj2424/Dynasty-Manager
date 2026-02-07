// ... (Previous exports: el, card, badge, button, interestBar, tabs - keep same) ...
// (Only showPlayerModal changes)

export function showPlayerModal(player) {
    const overlay = el("div", { 
        style: "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; justify-content:center; align-items:center;" 
    }, []);

    const close = () => {
        if(document.body.contains(overlay)) document.body.removeChild(overlay);
    };
    overlay.onclick = (e) => { if(e.target === overlay) close(); };

    const stats = player.careerStats || [];
    
    const historyRows = stats.map(h => el("tr", {}, [
        el("td", {}, String(h.year)),
        el("td", {}, h.teamName || "-"),
        el("td", {}, String(h.ovr)),
        el("td", {}, String(h.gp)),
        el("td", {}, (h.pts / (h.gp || 1)).toFixed(1)),
        el("td", {}, (h.reb / (h.gp || 1)).toFixed(1)),
        el("td", {}, (h.ast / (h.gp || 1)).toFixed(1))
    ]));

    if (historyRows.length === 0) {
        historyRows.push(el("tr", {}, [el("td", { colspan:7, style:"text-align:center; opacity:0.5;" }, "No career history yet.")]));
    }

    const modal = el("div", { 
        class: "card", 
        style: "width:500px; max-width:90%; max-height:80vh; overflow-y:auto;" 
    }, [
        el("div", { class:"spread" }, [
            el("div", { class:"h2" }, player.name),
            button("Close", { onClick: close, small:true })
        ]),
        // NEW STATS DISPLAY
        el("div", { class:"p" }, [
            el("span", {}, `${player.pos} • ${player.age || "??"} yrs`),
            el("br",{}),
            el("span", { style:"font-weight:bold" }, `OVR: ${player.ovr}`),
            el("span", {}, " | "),
            el("span", { style:"color:var(--good)" }, `OFF: ${player.off ?? player.ovr}`),
            el("span", {}, " | "),
            el("span", { style:"color:var(--warn)" }, `DEF: ${player.def ?? player.ovr}`),
            el("br",{}),
            el("span", {}, `Potential: ${player.potentialGrade}`)
        ]),
        el("div", { class:"sep" }),
        el("div", { class:"h2" }, "Career History"),
        el("table", { class:"table" }, [
            el("thead", {}, el("tr", {}, [
                el("th", {}, "Year"), el("th", {}, "Team"), el("th", {}, "OVR"), 
                el("th", {}, "GP"), el("th", {}, "PTS"), el("th", {}, "REB"), el("th", {}, "AST")
            ])),
            el("tbody", {}, historyRows)
        ])
    ]);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}
