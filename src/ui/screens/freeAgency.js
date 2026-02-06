import { el, card, button, badge } from "../components.js";
import { getState, startDraft } from "../../state.js";
import { PHASES, ROSTER_MAX } from "../../data/constants.js";

export function FreeAgencyScreen(){
  const s = getState();
  const g = s.game;

  const root = el("div", {}, []);

  if (g.phase !== PHASES.FREE_AGENCY){
    root.appendChild(card("Free Agency", "Not currently in free agency.", [
      el("div", { class:"p" }, "Finish playoffs first. Free agency starts right after the champion is crowned.")
    ]));
    return root;
  }

  const userTeam = g.league.teams[g.userTeamIndex];
  const fa = g.offseason.freeAgents;

  root.appendChild(card("Free Agency", "Sign players under the cap. Role promise affects happiness later (coming soon).", [
    el("div", { class:"row" }, [
      badge(`Team: ${userTeam.name}`),
      badge(`Cap: ${userTeam.cap.cap}`),
      badge(`Payroll: ${userTeam.cap.payroll.toFixed(1)}`),
      badge(`Roster: ${userTeam.roster.length}/${ROSTER_MAX}`)
    ]),
    el("div", { class:"sep" }),
    button("Continue to Draft", {
      primary: true,
      onClick: () => {
        startDraft();
        location.hash = "#/draft";
      }
    })
  ]));

  root.appendChild(renderRoster(userTeam));
  root.appendChild(renderFreeAgentPool(fa.pool, userTeam));

  return root;
}

function renderRoster(team){
  const rows = (team.roster || []).map(p => el("tr", {}, [
    el("td", {}, p.name),
    el("td", {}, p.pos),
    el("td", {}, String(p.ovr)),
    el("td", {}, `${p.contract.years}y / ${p.contract.salary}M`),
    el("td", {}, p.promisedRole || "-")
  ]));

  return card("Your Roster", "v1 roster view", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Contract"),
        el("th", {}, "Promised Role")
      ])),
      el("tbody", {}, rows.length ? rows : [
        el("tr", {}, [el("td", { colspan:"5" }, "No signed players yet. Sign a few for realism.")])
      ])
    ])
  ]);
}

function renderFreeAgentPool(pool, team){
  const top = pool.filter(p => !p.signedByTeamId).slice(0, 40);

  const rows = top.map(p => {
    const roles = ["Star","Starter","Bench","Reserve"];

    const roleSelect = el("select", {}, roles.map(r => el("option", { value:r }, r)));
    roleSelect.value = "Bench";

    const yearsSelect = el("select", {}, [1,2,3,4].map(y => el("option", { value:String(y) }, `${y}`)));
    yearsSelect.value = String(Math.min(4, p.yearsAsk));

    // default offer: ask price
    const salaryInput = el("input", { type:"number", min:"1", step:"0.5", value:String(p.ask), style:"width:90px" });

    const canSign = () => {
      const salary = Number(salaryInput.value || 0);
      return team.roster.length < 15 && (team.cap.payroll + salary) <= team.cap.cap;
    };

    const signBtn = button("Sign", {
      small: true,
      primary: true,
      onClick: () => {
        const salary = Number(salaryInput.value || 0);
        const years = Number(yearsSelect.value || 1);
        const role = roleSelect.value;

        if (!canSign()) return alert("Cap or roster limit prevents this signing.");

        // simple accept rule: if offer meets ask, accept
        if (salary < p.ask) return alert("Offer too low (v1). Increase salary to at least ask.");

        p.signedByTeamId = team.id;
        p.promisedRole = role;
        p.contract = { years, salary };

        team.roster.push({
          id: p.id,
          name: p.name,
          pos: p.pos,
          ovr: p.ovr,
          potentialGrade: p.potentialGrade,
          promisedRole: role,
          contract: { years, salary }
        });

        team.cap.payroll = Number((team.cap.payroll + salary).toFixed(1));

        // rerender
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });

    return el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.pos),
      el("td", {}, String(p.ovr)),
      el("td", {}, p.potentialGrade),
      el("td", {}, `${p.ask}M`),
      el("td", {}, yearsSelect),
      el("td", {}, salaryInput),
      el("td", {}, roleSelect),
      el("td", {}, signBtn)
    ]);
  });

  return card("Free Agent Pool", "Offer salary, years, and role. (AI signings for other teams comes later.)", [
    el("table", { class:"table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Player"),
        el("th", {}, "Pos"),
        el("th", {}, "OVR"),
        el("th", {}, "Pot"),
        el("th", {}, "Ask"),
        el("th", {}, "Years"),
        el("th", {}, "Salary"),
        el("th", {}, "Role"),
        el("th", {}, "Action")
      ])),
      el("tbody", {}, rows)
    ]),
    el("div", { class:"p" }, "Showing top 40 available FAs for now.")
  ]);
}
