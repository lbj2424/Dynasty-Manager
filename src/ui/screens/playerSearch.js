import { el, card, badge, showPlayerModal } from "../components.js";
import { getState } from "../../state.js";

export function PlayerSearchScreen() {
  const s = getState();
  const g = s.game;
  const root = el("div", {}, []);

  s.playerSearch ??= { query: "", pos: "All", status: "All" };
  const filter = s.playerSearch;

  const players = gatherSearchablePlayers(g);
  const query = filter.query.trim().toLowerCase();
  let list = players;

  if (query) {
    list = list.filter(x =>
      x.player.name.toLowerCase().includes(query) ||
      x.team.toLowerCase().includes(query) ||
      x.status.toLowerCase().includes(query)
    );
  }
  if (filter.pos !== "All") list = list.filter(x => x.player.pos === filter.pos);
  if (filter.status !== "All") list = list.filter(x => x.group === filter.status);

  list = list
    .slice()
    .sort((a, b) => (b.player.ovr || b.player.currentOVR || 0) - (a.player.ovr || a.player.currentOVR || 0))
    .slice(0, 80);

  const searchInput = el("input", {
    type: "search",
    value: filter.query,
    placeholder: "Search player, team, or status...",
    style: "min-width:260px; flex:1; padding:9px 10px; border-radius:10px; border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--text);",
    oninput: (e) => {
      filter.query = e.target.value;
      rerender(root);
    }
  });

  const posSelect = makeSelect(["All", "PG", "SG", "SF", "PF", "C"], filter.pos, (value) => {
    filter.pos = value;
    rerender(root);
  });
  const statusSelect = makeSelect(["All", "Roster", "Available", "Free Agent", "Draft", "Retired"], filter.status, (value) => {
    filter.status = value;
    rerender(root);
  });

  root.appendChild(card("Player Search", "Find players across teams, free agency, available players, draft boards, and retirements.", [
    el("div", { class: "row" }, [
      searchInput,
      el("span", {}, "Position:"),
      posSelect,
      el("span", {}, "Status:"),
      statusSelect
    ]),
    el("div", { class: "sep" }),
    el("div", { class: "row" }, [
      badge(`${players.length} total`),
      badge(`${list.length} shown`)
    ])
  ]));

  root.appendChild(renderResults(list, query));
  return root;
}

function gatherSearchablePlayers(g) {
  const byId = new Map();
  const add = (player, status, team, group, route = null) => {
    if (!player?.id) return;
    if (byId.has(player.id)) return;
    byId.set(player.id, { player, status, team, group, route });
  };

  for (const team of (g.league?.teams || [])) {
    for (const p of (team.roster || [])) {
      add(p, `Roster - ${team.name}`, team.name, "Roster", "#/standings");
    }
  }

  for (const p of (g.midseasonFaPool || [])) {
    if (!p.signedByTeamId) add(p, "Available Players", "Unsigned", "Available", "#/available-players");
  }

  for (const p of (g.offseason?.freeAgents?.pool || [])) {
    if (!p.signedByTeamId) add(p, "Offseason Free Agent", "Unsigned", "Free Agent", "#/free-agency");
  }

  for (const p of (g.offseason?.draft?.declaredProspects || [])) {
    if (!p._drafted) add(p, "Draft Board", p.college || p.country || "Prospect", "Draft", "#/draft");
  }

  for (const p of (g.retiredPlayers || [])) {
    add(p, `Retired ${p.retiredYear || ""}`.trim(), p.finalTeam || "Retired", "Retired", "#/retired");
  }

  return [...byId.values()];
}

function renderResults(list, query) {
  const rows = list.map(x => {
    const p = x.player;
    const modalPlayer = x.group === "Draft"
      ? { ...p, ovr: p.currentOVR ?? p.ovr, age: p.age ?? 19, contract: null }
      : p;
    const ovr = p.ovr ?? p.currentOVR ?? "-";
    const age = p.age ?? "-";
    const contract = p.contract
      ? `$${p.contract.salary}M / ${p.contract.years}y`
      : x.group === "Draft"
      ? "Draft eligible"
      : "Free agent";

    return el("tr", {}, [
      el("td", {}, el("span", {
        style: "cursor:pointer; text-decoration:underline; color:var(--accent);",
        onclick: () => showPlayerModal(modalPlayer)
      }, p.name)),
      el("td", {}, p.pos || "-"),
      el("td", { style: "font-weight:bold;" }, String(ovr)),
      el("td", {}, String(age)),
      el("td", {}, x.team),
      el("td", {}, x.status),
      el("td", {}, contract),
      el("td", {}, x.route ? el("button", {
        class: "btn btnSmall",
        onclick: () => { location.hash = x.route; }
      }, "Go") : "")
    ]);
  });

  return card("Results", query ? `Matches for "${query}"` : "Top players shown by OVR.", [
    el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Age"),
        el("th", {}, "Team / Pool"),
        el("th", {}, "Status"),
        el("th", {}, "Contract"),
        el("th", {}, "")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan: "8" }, "No players found.")])
      ])
    ])
  ]);
}

function makeSelect(options, selected, onChange) {
  return el("select", {
    value: selected,
    onchange: (e) => onChange(e.target.value)
  }, options.map(o => el("option", { value: o, selected: o === selected }, o)));
}

function rerender(root) {
  const parent = root.parentElement;
  if (!parent) return;
  parent.innerHTML = "";
  parent.appendChild(PlayerSearchScreen());
}
