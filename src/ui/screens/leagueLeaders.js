import { el, card, badge, tabs } from "../components.js";
import { getState } from "../../state.js";

export function LeagueLeadersScreen() {
    const s = getState();
    const g = s.game;

    s.leagueLeadersTab ??= "stats";

    const root = el("div", {}, []);

    const tabItems = [
        { key: "stats", label: "Stats Leaders" },
        { key: "power", label: "Power Rankings" }
    ];

    root.appendChild(card("League Leaders", "Live stats and power rankings.", [
        el("div", { class: "row" }, [
            badge(`Year ${g.year}`),
            badge(`Week ${Math.min(g.week, g.seasonWeeks)} / ${g.seasonWeeks}`),
            badge(`${g.league.teams.length} Teams`)
        ]),
        tabs(tabItems, s.leagueLeadersTab, (k) => {
            s.leagueLeadersTab = k;
            rerender(root);
        })
    ]));

    if (s.leagueLeadersTab === "stats") {
        root.appendChild(renderStatsLeaders(g));
    } else {
        root.appendChild(renderPowerRankings(g));
    }

    return root;
}

function gatherPlayerStats(g) {
    const all = [];
    for (const t of g.league.teams) {
        for (const p of (t.roster || [])) {
            const gp = p.stats?.gp || 0;
            if (gp < 1) continue;
            all.push({
                name: p.name,
                team: t.name,
                pos: p.pos,
                ovr: p.ovr,
                gp,
                ppg: Number((p.stats.pts / gp).toFixed(1)),
                rpg: Number((p.stats.reb / gp).toFixed(1)),
                apg: Number((p.stats.ast / gp).toFixed(1))
            });
        }
    }
    return all;
}

function statTable(title, players, statKey, statLabel) {
    const sorted = [...players].sort((a, b) => b[statKey] - a[statKey]).slice(0, 10);

    if (!sorted.length) {
        return el("div", { style: "flex:1; min-width:260px;" }, [
            el("div", { class: "h2", style: "margin-bottom:8px;" }, title),
            el("div", { class: "p", style: "opacity:0.5;" }, "No stats yet — play some games.")
        ]);
    }

    const rows = sorted.map((p, i) => el("tr", {}, [
        el("td", { style: "opacity:0.5; width:24px;" }, String(i + 1)),
        el("td", { style: "font-weight:bold;" }, p.name),
        el("td", { style: "opacity:0.7; font-size:0.9em;" }, p.team),
        el("td", {}, p.pos),
        el("td", { style: "opacity:0.6;" }, String(p.gp)),
        el("td", { style: "font-weight:bold; color:var(--accent);" }, String(p[statKey]))
    ]));

    return el("div", { style: "flex:1; min-width:260px;" }, [
        el("div", { class: "h2", style: "margin-bottom:8px;" }, title),
        el("table", { class: "table" }, [
            el("thead", {}, el("tr", {}, [
                el("th", {}, "#"),
                el("th", {}, "Player"),
                el("th", {}, "Team"),
                el("th", {}, "Pos"),
                el("th", {}, "GP"),
                el("th", {}, statLabel)
            ])),
            el("tbody", {}, rows)
        ])
    ]);
}

function renderStatsLeaders(g) {
    const players = gatherPlayerStats(g);

    return card("Stats Leaders", "Top 10 per category. Updates weekly.", [
        el("div", { style: "display:flex; gap:24px; flex-wrap:wrap;" }, [
            statTable("Points Per Game", players, "ppg", "PPG"),
            statTable("Rebounds Per Game", players, "rpg", "RPG"),
            statTable("Assists Per Game", players, "apg", "APG")
        ])
    ]);
}

function renderPowerRankings(g) {
    const userTeam = g.league.teams[g.userTeamIndex];

    const ranked = [...g.league.teams].map(t => {
        const gp = (t.wins || 0) + (t.losses || 0);
        const pct = gp > 0 ? (t.wins || 0) / gp : 0;
        return { ...t, gp, pct };
    }).sort((a, b) => b.pct - a.pct || b.wins - a.wins || a.losses - b.losses);

    const rows = ranked.map((t, i) => {
        const mom = t.momentum || 0;
        let momText = "—";
        let momStyle = "opacity:0.35;";
        if (mom >= 2)       { momText = "HOT";  momStyle = "color:var(--good); font-weight:bold;"; }
        else if (mom >= 1)  { momText = "Warm"; momStyle = "color:var(--accent);"; }
        else if (mom <= -2) { momText = "COLD"; momStyle = "color:var(--bad); font-weight:bold;"; }
        else if (mom <= -1) { momText = "Cool"; momStyle = "color:var(--warn);"; }

        const isUser = t.id === userTeam.id;
        const rowStyle = isUser
            ? "background:rgba(100,200,255,0.07); font-weight:bold;"
            : "";

        return el("tr", { style: rowStyle }, [
            el("td", { style: "opacity:0.5; width:28px;" }, String(i + 1)),
            el("td", {}, isUser ? `${t.name} ★` : t.name),
            el("td", { style: "opacity:0.65;" }, t.conference),
            el("td", { style: "color:var(--good);" }, String(t.wins || 0)),
            el("td", { style: "color:var(--bad);" }, String(t.losses || 0)),
            el("td", { style: "font-weight:bold;" }, t.gp > 0 ? `${(t.pct * 100).toFixed(1)}%` : "—"),
            el("td", { style: momStyle }, momText)
        ]);
    });

    return card("Power Rankings", "All teams ranked by win percentage. HOT/COLD reflects recent momentum.", [
        el("table", { class: "table" }, [
            el("thead", {}, el("tr", {}, [
                el("th", {}, "#"),
                el("th", {}, "Team"),
                el("th", {}, "Conf"),
                el("th", {}, "W"),
                el("th", {}, "L"),
                el("th", {}, "PCT"),
                el("th", {}, "Form")
            ])),
            el("tbody", {}, rows)
        ])
    ]);
}

function rerender(root) {
    const parent = root.parentElement;
    if (!parent) return;
    parent.innerHTML = "";
    parent.appendChild(LeagueLeadersScreen());
}
