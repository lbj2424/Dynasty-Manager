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

  // safety: ensure arrays exist (old saves)
  g.scouting.scoutedNCAAIds ??= [];
  g.scouting.scoutedIntlIds ??= [];
  g.scouting.intlFoundWeekById ??= {};

  root.appendChild(card("Scouting", "Find and secure your next diamond.", [
    el("div", { class:"row" }, [
      badge(`Week: ${g.week}/${g.seasonWeeks}`),
      badge(`Hours: ${g.hours.available} avail · ${g.hours.banked} banked`),
      badge(`Declare threshold: ${DECLARE_THRESHOLD}`),
      badge(`Draft stock: ${g.scouting.ncaa.length} NCAA · ${g.scouting.intlPool.length} Intl`)
    ]),
    tabs(tabItems, g.scouting.tab, (k) => { g.scouting.tab = k; rerender(); })
  ]));

  root.appendChild(g.scouting.tab === "NCAA" ? renderNCAA() : renderInternational());
  return root;
}

function renderNCAA(){
  const s = getState();
  const g = s.game;

  g.scouting.scoutedNCAAIds ??= [];

  const rows = g.scouting.ncaa.slice(0, 40).map(p => {
    const isScouted = !!p.scouted || g.scouting.scoutedNCAAIds.includes(p.id);

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, isScouted ? String(p.currentOVR) : "Unknown"),
      el("td", {}, isScouted ? p.potentialGrade : "Unknown"),
      el("td", {}, p.declared ? "Yes" : "No"),
      el("td", {}, [
        button(isScouted ? "Scouted" : "Scout (1h)", {
          small: true,
          primary: !isScouted,
          onClick: () => {
            if (isScouted) return;
            const ok = spendHours(1);
            if (!ok) return alert("Not enough hours.");

            p.scouted = true;
            if (!g.scouting.scoutedNCAAIds.includes(p.id)){
              g.scouting.scoutedNCAAIds.push(p.id);
            }
            rerender();
          }
        })
      ])
    ]);
  });

  return card("NCAA Draft Stock", "100 prospects. No travel cost. Scouting reveals true OVR + potential grade.", [
    el("div", { class:"p" }, `You have scouted ${g.scouting.scoutedNCAAIds.length} NCAA prospects.`),
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

  g.scouting.scoutedIntlIds ??= [];
  g.scouting.intlFoundWeekById ??= {};

  const loc = g.scouting.intlLocation;
  const locObj = loc ? CONTINENTS.find(c => c.key === loc) : null;

  const top = el("div", { class:"row" }, [
    badge(loc ? `Location: ${locObj?.name}` : "Location: None"),
    button("Leave (Reset Location)", {
      small: true,
      onClick: () => {
        g.scouting.intlLocation = null;
        rerender();
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
          rerender();
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

        const c = CONTINENTS.find(x => x.key === g.scouting.intlLocation);
        const density = c?.density ?? 0.5;

        const foundCount = rollFoundCount(density);

        // find prospects from this continent that are not discovered yet
        const pool = g.scouting.intlPool.filter(p =>
          p.continentKey === g.scouting.intlLocation && !p.discovered
        );

        let actuallyFound = 0;

        for (let i=0;i<foundCount;i++){
          const p = pool[i];
          if (!p) break;

          p.discovered = true;
          actuallyFound++;

          // mark "found week" ONE time so they can expire after 3 weeks if not declared
          if (!p.declared && !g.scouting.intlFoundWeekById[p.id]){
            g.scouting.intlFoundWeekById[p.id] = g.week;
          }
        }

        if (actuallyFound > 0){
          g.inbox.unshift({ t: Date.now(), msg: `Scouting: found ${actuallyFound} prospect(s) in ${c.name}.` });
        } else {
          g.inbox.unshift({ t: Date.now(), msg: `Scouting: no new prospects found in ${c.name}.` });
        }

        rerender();
      }
    })
  ]);

  const discovered = g.scouting.intlPool.filter(p => p.discovered).slice(0, 60);

  const rows = discovered.map(p => {
    const isScouted = !!p.scouted || g.scouting.scoutedIntlIds.includes(p.id);
    const canRecruit = isScouted && !p.declared;

    const foundWeek = g.scouting.intlFoundWeekById?.[p.id];
    const weeksSinceFound = foundWeek ? (g.week - foundWeek) : 0;
    const expiresIn = p.declared ? null : clamp(3 - weeksSinceFound, 0, 3);

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, isScouted ? String(p.currentOVR) : "Unknown"),
      el("td", {}, isScouted ? p.potentialGrade : "Unknown"),
      el("td", {}, p.declared ? "Yes" : "No"),
      el("td", {}, p.declared ? "-" : `${p.declareInterest ?? 0}`),
      el("td", {}, p.declared ? "-" : (foundWeek ? `${expiresIn}w` : "-")),
      el("td", {}, [
        button(isScouted ? "Scouted" : "Scout (2h)", {
          small: true,
          primary: !isScouted,
          onClick: () => {
            if (isScouted) return;
            const ok = spendHours(2);
            if (!ok) return alert("Not enough hours.");
            p.scouted = true;
            if (!g.scouting.scoutedIntlIds.includes(p.id)){
              g.scouting.scoutedIntlIds.push(p.id);
            }
            rerender();
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

            const base = 10;
            const gradePenalty = gradeRecruitPenalty(p.potentialGrade);
            const gain = clamp(base - gradePenalty + Math.floor(Math.random()*6), 4, 14);

            p.declareInterest = clamp((p.declareInterest ?? 0) + gain, 0, 100);

            if (p.declareInterest >= DECLARE_THRESHOLD){
              p.declared = true;
              // once declared, they should never expire
              delete g.scouting.intlFoundWeekById[p.id];
              g.inbox.unshift({ t: Date.now(), msg: `${p.name} (${p.potentialGrade}) agreed to declare for the draft.` });
            }

            rerender();
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
    card("Discovered Prospects", "Players can disappear 3 weeks after being found if they haven’t declared.", [
      el("div", { class:"p" }, `You have scouted ${g.scouting.scoutedIntlIds.length} international prospects.`),
      el("table", { class:"table" }, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Player"),
          el("th", {}, "Pos"),
          el("th", {}, "OVR"),
          el("th", {}, "Pot"),
          el("th", {}, "Declared"),
          el("th", {}, "Interest"),
          el("th", {}, "Expires In"),
          el("th", {}, "Actions")
        ])),
        el("tbody", {}, rows)
      ])
    ])
  ]);
}

function rollFoundCount(density){
  const x = Math.random();
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
  return ({
    "A+": 6,
    "A":  4,
    "B":  2,
    "C":  1,
    "D":  0,
    "F":  0
  })[grade] ?? 2;
}

function rerender(){
  const app = document.getElementById("app");
  if (!app) return;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
