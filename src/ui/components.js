export function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})){
    if (k === "class") {
      node.className = v;
    } 
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    }
    else if (k === "checked" || k === "selected" || k === "disabled" || k === "value") {
      node[k] = v; 
    }
    else {
      node.setAttribute(k, v);
    }
  }
  for (const ch of (Array.isArray(children) ? children : [children])){
    if (ch == null) continue;
    if (typeof ch === "string") node.appendChild(document.createTextNode(ch));
    else node.appendChild(ch);
  }
  return node;
}

export function card(title, subtitle, bodyChildren){
  return el("div", { class:"card" }, [
    el("div", { class:"spread" }, [
      el("div", {}, [
        el("div", { class:"h2" }, title),
        subtitle ? el("div", { class:"p" }, subtitle) : null
      ])
    ]),
    el("div", { class:"sep" }),
    ...(bodyChildren || [])
  ]);
}

export function badge(text){
  return el("span", { class:"badge" }, text);
}

export function button(text, { primary=false, danger=false, small=false, onClick } = {}){
  const cls = ["btn", primary && "btnPrimary", danger && "btnDanger", small && "btnSmall"].filter(Boolean).join(" ");
  return el("button", { class: cls, onclick: onClick }, text);
}

export function interestBar(value0to100){
  const wrap = el("div", { class:"barWrap" }, [
    el("div", { class:"barFill", style:`width:${Math.max(0, Math.min(100, value0to100))}%` })
  ]);
  return wrap;
}

export function tabs(items, activeKey, onPick){
  return el("div", { class:"tabs" },
    items.map(it =>
      el("button", {
        class: "tab " + (it.key === activeKey ? "tabActive" : ""),
        onclick: () => onPick(it.key)
      }, it.label)
    )
  );
}

// --- PLAYER MODAL (WITH AWARDS) ---
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

    // --- PROCESS AWARDS LOGIC ---
    const rawAwards = player.awards || [];
    const processedAwards = [];
    
    // Group All-Stars
    const allStarYears = rawAwards.filter(a => a.includes("All-Star")).map(a => a.split(" ")[0]);
    if (allStarYears.length > 0) {
        if (allStarYears.length >= 3) {
            processedAwards.push(`${allStarYears.length}x All-Star`);
        } else {
            // Less than 3, just show them normally
            allStarYears.forEach(y => processedAwards.push(`${y} All-Star`));
        }
    }
    
    // Add all other awards (MVP, DPOY, etc)
    const otherAwards = rawAwards.filter(a => !a.includes("All-Star"));
    processedAwards.push(...otherAwards);

    // Render award badges
    const awardElements = processedAwards.map(a => el("span", { 
        class:"badge", 
        style:"background:var(--accent); font-size:0.8em; margin-right:4px; margin-bottom:4px; display:inline-block;" 
    }, a));

    const modal = el("div", { 
        class: "card", 
        style: "width:500px; max-width:90%; max-height:80vh; overflow-y:auto;" 
    }, [
        el("div", { class:"spread" }, [
            el("div", { class:"h2" }, player.name),
            button("Close", { onClick: close, small:true })
        ]),
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
        // AWARDS SECTION
        awardElements.length > 0 ? el("div", { style:"margin-top:10px;" }, awardElements) : null,
        
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
