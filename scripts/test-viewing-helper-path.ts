// S745b: a viewing helper is a showing agent with a private page, not a
// sign-in. These checks keep the helper role off the invite list and the
// path from Settings > Team to the showing agents page.
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

const team = read("lib/team.ts");
const roles = team.slice(team.indexOf("export const INVITABLE_ROLES"), team.indexOf("\n", team.indexOf("export const INVITABLE_ROLES")));
ok("invite list is Teammate only", roles.includes('["operator"]'));
ok("invite list never offers the helper role", !roles.includes("showing_helper"));
ok("lib/team.ts says why", team.includes("Do not add \"showing_helper\" here without role-aware RLS first."));

const section = read("app/dashboard/settings/team-section.tsx");
const card = section.slice(section.indexOf('id="viewing-helper"'));
ok("Team has the viewing helper card", section.includes('id="viewing-helper"'));
ok("card links to showing agents", card.includes('href="/dashboard/showing-agents"'));
ok("card is owner-only like the invite form", section.slice(section.lastIndexOf("{canManage && (", section.indexOf('id="viewing-helper"')), section.indexOf('id="viewing-helper"')).length < 80);

const agents = read("app/dashboard/showing-agents/page.tsx");
ok("agents page reads each agent's token", agents.includes('"id, agent_token, name,'));
ok("agents page shows their private page", agents.includes("/agent/${a.agent_token}") && agents.includes('rel="noopener noreferrer"'));

console.log(`\nviewing-helper-path: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
