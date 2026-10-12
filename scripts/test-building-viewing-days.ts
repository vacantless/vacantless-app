// S708: viewing days per building. Run: npx tsx scripts/test-building-viewing-days.ts
import { readFileSync } from "node:fs";
import { buildingLabel, parseBuildingWeekdays } from "../lib/booking";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("weekdays parsed, sorted, unique", JSON.stringify(parseBuildingWeekdays(["3", "2", "2"])) === "[2,3]");
ok("out-of-range and junk dropped", JSON.stringify(parseBuildingWeekdays(["7", "-1", "x", "", "0"])) === "[0]");
ok("no ticks -> empty (every day)", parseBuildingWeekdays([]).length === 0);
ok("label strips the unit", buildingLabel("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4") === "833 Pillette Rd");
ok("label keeps a plain street", buildingLabel("1195 Bruce Ave, Unit 303, Windsor, ON") === "1195 Bruce Ave");

const mig = readFileSync("supabase/migrations/0237_availability_building_days.sql", "utf8");
ok("table has unique org+building+weekday", mig.includes("unique (organization_id, building_key, weekday)"));
ok("table granted to authenticated", mig.includes("to authenticated"));
ok("rules filtered by building days", mig.includes("or a.weekday in ("));
ok("specific dates filtered by building days", mig.includes("or extract(dow from v.day)::int in ("));
ok("booking guard inserted", mig.includes("S708: building viewing days") && mig.includes("b.weekday = v_dow"));
ok("booking guard refuses if the anchor moved", mig.includes("anchor not found; not modified"));
ok("no drop policy or revoke lines", !/drop policy|revoke /i.test(mig));

const page = readFileSync("app/dashboard/availability/page.tsx", "utf8");
ok("page renders the building section", page.includes("Viewing days by building") && page.includes("saveBuildingViewingDays"));
const actions = readFileSync("app/dashboard/availability/actions.ts", "utf8");
ok("save checks the building belongs to the org", actions.includes('.eq("building_key", buildingKey)') && actions.includes("building_invalid"));
ok("save is capability gated", /saveBuildingViewingDays[\s\S]{0,300}requireCapability\("manage_availability"/.test(actions));

console.log(`\nbuilding-viewing-days: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
