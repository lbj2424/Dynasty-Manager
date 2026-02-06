import { el, card, button, badge, tabs } from "../components.js";
import { getState, spendHours } from "../../state.js";
import { CONTINENTS, DECLARE_THRESHOLD } from "../../data/constants.js";
import { clamp } from "../../utils.js";

export function ScoutingScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  const tabItems = [
    { key:"NCAA", label:"NCAA Draft Stock" },
    { key:"INTL", label:"International (7 Continents)" }
  ];

  root.appendChild(card("Scouting", "Find and secure your next diamond.", [
    el("div", { class:"row" }, [
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked`),
      badge(`Declare threshold: ${DECLARE_THRESHOLD}`),
      badge(`Draft stock: ${g.scouting.ncaa.length} NCAA · ${g.scouting.intlPool.length} Intl hidden`)
    ]),
    tabs(tabItems, g.scouting.tab, (k) => { g.scouting.tab = k; rerender(root); })
  ]));

  if (g.scouting.tab === "NCAA"){
    root.appendChild(renderNCAA());
  } else {
    root.appendChild(renderInternational());
  }

  return root;
}

function renderNCAA(){
  const s = getState();
  const g = s.game;

  const rows = g.scouting.ncaa.slice(0, 40).map(p => {
    const canScout = !p.scouted;

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, canScout ? "Unknown" : String(p.currentOVR)),
      el("td", {}, canScout ? "Unknown" : p.potentialGrade),
      el("td", {}, p.declared ? "Yes" : "No"),
      el("td", {}, [
        button(canScout ? "Scout (1h)" : "Scouted", {
          small: true,
          primary: canScout,
          onClick: () => {
            if (!canScout) return;
            const ok = spendHours(1);
            if (!ok) return alert("Not enough hours.");
            p.scouted = true;
            rerender(document.querySelector("#app > div"));
          }
        })
      ])
    ]);
  });

  return card("NCAA Draft Stock", "100 prospects. No travel cost. Scouting reveals true OVR + potential grade.", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Declared"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows)
    ]),
    el("div", { class:"p" }, "Showing first 40 for now. We’ll add filtering/sorting next.")
  ]);
}

function renderInternational(){
  const s = getState();
  const g = s.game;

  const loc = g.scouting.intlLocation;
  const locObj = loc ? CONTINENTS.find(c => c.key === loc) : null;

  const top = el("div", { class:"row" }, [
    badge(loc ? `Location: ${locObj?.name}` : "Location: None"),
    button("Leave (Reset Location)", {
      small: true,
      onClick: () => {
        g.scouting.intlLocation = null;
        rerender(document.querySelector("#app > div"));
      }
    })
  ]);

  const travelGrid = el("div", { class:"grid" }, CONTINENTS.map(c => {
    return el("div", { class:"card" }, [
      el("div", { class:"spread" }, [
        el("div", {}, [
          el("div", { class:"h2" }, c.name),
          el("div", { class:"p" }, `Travel: ${c.travelHours}h · Talent density: ${(c.density*100).toFixed(0)}%`)
        ]),
        badge(c.key)
      ]),
      el("div", { class:"sep" }),
      button(loc === c.key ? "Here" : `Travel (${c.travelHours}h)`, {
        primary: loc !== c.key,
        onClick: () => {
          if (loc === c.key) return;
          const ok = spendHours(c.travelHours);
          if (!ok) return alert("Not enough hours to travel.");
          g.scouting.intlLocation = c.key;
          rerender(document.querySelector("#app > div"));
        }
      })
    ]);
  }));

  const actions = el("div", { class:"row" }, [
    button("Search (2h)", {
      primary: true,
      onClick: () => {
        if (!g.scouting.intlLocation) return alert("Travel to a continent first.");
        const ok = spendHours(2);
        if (!ok) return alert("Not enough hours.");

        // Discover 0-3 prospects from this continent based on density
        const c = CONTINENTS.find(x => x.key === g.scouting.intlLocation);
        const density = c?.density ?? 0.5;

        const foundCount = rollFoundCount(density);
        const pool = g.scouting.intlPool.filter(p => p.continentKey === g.scouting.intlLocation && !p.discovered);

        for (let i=0;i<foundCount;i++){
          const p = pool[i];
          if (!p) break;
          p.discovered = true;
          // discovered does NOT auto-scout in v1. You still need to scout to see OVR/grade.
          g.scouting.intlDiscoveredIds.push(p.id);
        }

        if (foundCount > 0){
          g.inbox.unshift({ t: Date.now(), msg: `Scouting: found ${foundCount} prospect(s) in ${c.name}.` });
        } else {
          g.inbox.unshift({ t: Date.now(), msg: `Scouting: no new prospects found in ${c.name}.` });
        }

        rerender(document.querySelector("#app > div"));
      }
    })
  ]);

  const discovered = g.scouting.intlPool.filter(p => p.discovered).slice(0, 60);

  const rows = discovered.map(p => {
    const canScout = !p.scouted;
    const canRecruit = p.scouted && !p.declared;

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, canScout ? "Unknown" : String(p.currentOVR)),
      el("td", {}, canScout ? "Unknown" : p.potentialGrade),
      el("td", {}, p.declared ? "Yes" : "No"),
      el("td", {}, p.declared ? "-" : `${p.declareInterest ?? 0}`),
      el("td", {}, [
        button(canScout ? "Scout (2h)" : "Scouted", {
          small: true,
          primary: canScout,
          onClick: () => {
            if (!canScout) return;
            const ok = spendHours(2);
            if (!ok) return alert("Not enough hours.");
            p.scouted = true;
            rerender(document.querySelector("#app > div"));
          }
        }),
        el("span", {}, " "),
        button("Recruit (3h)", {
          small: true,
          primary: canRecruit,
          onClick: () => {
            if (!canRecruit) return;
            const ok = spendHours(3);
            if (!ok) return alert("Not enough hours.");

            // Interest gain depends on potential (diamonds are harder) + slight randomness
            const base = 10;
            const gradePenalty = gradeRecruitPenalty(p.potentialGrade); // higher grade harder to convince
            const gain = clamp(base - gradePenalty + Math.floor(Math.random()*6), 4, 14);

            p.declareInterest = clamp((p.declareInterest ?? 0) + gain, 0, 100);

            if (p.declareInterest >= DECLARE_THRESHOLD){
              p.declared = true;
              g.inbox.unshift({ t: Date.now(), msg: `${p.name} (${p.potentialGrade}) agreed to declare for the draft.` });
            }

            rerender(document.querySelector("#app > div"));
          }
        })
      ])
    ]);
  });

  return el("div", {}, [
    card("International Map", "Travel costs hours. Search to discover prospects. Scout then recruit to get them into the draft.", [
      top,
      el("div", { class:"sep" }),
      travelGrid
    ]),
    card("On-site Actions", "Search takes time and may find nothing. That’s intentional.", [
      actions
    ]),
    card("Discovered Prospects", "Showing up to 60 discovered prospects. Scout to reveal truthful OVR + potential grade.", [
      el("table", { class:"table" }, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Player"),
          el("th", {}, "Pos"),
          el("th", {}, "OVR"),
          el("th", {}, "Pot"),
          el("th", {}, "Declared"),
          el("th", {}, "Interest"),
          el("th", {}, "Actions")
        ])),
        el("tbody", {}, rows)
      ])
    ])
  ]);
}

function rollFoundCount(density){
  // density scales chance of 1-3 finds
  const x = Math.random();
  // baseline: 35% none, 45% one, 15% two, 5% three (scaled by density)
  const none = 0.45 - 0.20 * density;
  const one  = 0.40 + 0.10 * density;
  const two  = 0.12 + 0.08 * density;
  const three= 0.03 + 0.02 * density;

  if (x < none) return 0;
  if (x < none + one) return 1;
  if (x < none + one + two) return 2;
  return 3;
}

function gradeRecruitPenalty(grade){
  // higher potential grades are harder to convince
  return ({
    "A+": 6,
    "A":  4,
    "B":  2,
    "C":  1,
    "D":  0,
    "F":  0
  })[grade] ?? 2;
}

function rerender(root){
  // for v1 simplicity, rerender entire current screen
  const app = document.getElementById("app");
  if (!app) return;
  const curHash = location.hash;
  app.innerHTML = "";
  // re-importing screen is unnecessary; router will render on hashchange.
  // so we simulate it by dispatching a hashchange event.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
