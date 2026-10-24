// S736: texting numbers without staff (lib/texting-numbers + wiring).
// Run: npx tsx scripts/test-texting-numbers.ts
import { readFileSync } from "node:fs";
import {
  MAX_PROVISION_ATTEMPTS,
  PROVISION_CLAIM_MS,
  PROVISION_RETRY_GAP_MS,
  RELEASE_GRACE_MS,
  numberFriendlyName,
  numberSearchPlan,
  pickBuyableNumber,
  provisionDecision,
  provisionGaveUpEmail,
  releaseDecision,
  type ProvisionState,
} from "../lib/texting-numbers";
import { SWEEP_PATHS } from "../lib/cron-sweeps";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// --- where to look ---
const windsor = numberSearchPlan(["833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4"]);
ok("Windsor postal code: 519 first", windsor.areaCodes[0] === "519" && windsor.areaCodes.includes("226") && windsor.region === "ON");
ok("Toronto postal code: 416 first", numberSearchPlan(["506 Manning Ave, Toronto, ON M6G 2V7"]).areaCodes[0] === "416");
ok("Ottawa postal code", numberSearchPlan(["1 Main St, Ottawa ON k1p1j1"]).areaCodes[0] === "613");
ok("Vancouver postal code", numberSearchPlan(["1 A St, Vancouver, BC V6B 1A1"]).region === "BC");
ok("first address with a postal code wins", numberSearchPlan(["no code here", "1 B St, Calgary, AB T2P 1J9"]).areaCodes[0] === "403");
// S736: Lakeview's first number came out 249 because its addresses have no postal code.
ok("Windsor by city name: 519 first", numberSearchPlan(["88 Lakeview Ave, Windsor, ON"]).areaCodes[0] === "519");
ok("Toronto by city name", numberSearchPlan(["1 A St, Toronto, ON"]).areaCodes[0] === "416");
ok("city name with a unit", numberSearchPlan(["88 Lakeview Ave Unit 2, Windsor, ON"]).areaCodes[0] === "519");
ok("Calgary by city name", numberSearchPlan(["1 A St, Calgary, AB"]).areaCodes[0] === "403");
ok("postal code beats city name", numberSearchPlan(["1 A St, Windsor, ON M6G 2V7"]).areaCodes[0] === "416");
const provOnly = numberSearchPlan(["100 Lakeview Ave, Smalltown, ON"]);
ok("province only when the city is unknown", provOnly.areaCodes.length === 0 && provOnly.region === "ON");
const none = numberSearchPlan([null, "", "somewhere"]);
ok("anywhere in Canada when nothing is known", none.areaCodes.length === 0 && none.region === null);
ok("a US zip is not a postal code", numberSearchPlan(["1 A St, Detroit, MI 48201"]).region === null);

// --- which number to buy ---
ok("first number with no address needed", pickBuyableNumber([
  { phone_number: "+15195550100", address_requirements: "local", capabilities: { SMS: true } },
  { phone_number: "+15195550101", address_requirements: "none", capabilities: { SMS: true, voice: true } },
]) === "+15195550101");
ok("skips a number that cannot text", pickBuyableNumber([
  { phone_number: "+15195550100", address_requirements: "none", capabilities: { SMS: false } },
]) === null);
ok("skips a malformed number", pickBuyableNumber([{ phone_number: "519-555-0100" }]) === null);
ok("empty list", pickBuyableNumber([]) === null && pickBuyableNumber(null) === null);

// --- when to buy ---
const NOW = Date.UTC(2026, 9, 24, 13, 0, 0);
const base: ProvisionState = {
  plan: "growth",
  planHasTexting: true,
  closed: false,
  requested: true,
  hasNumber: false,
  attempts: 0,
  triedAtMs: null,
  nowMs: NOW,
  fromPress: true,
};
ok("a press buys", provisionDecision(base).go);
ok("no texting on the plan", !provisionDecision({ ...base, planHasTexting: false }).go);
ok("closed account", !provisionDecision({ ...base, closed: true }).go);
ok("already has a number", !provisionDecision({ ...base, hasNumber: true }).go);
ok("not asked", !provisionDecision({ ...base, requested: false }).go);
const running = provisionDecision({ ...base, triedAtMs: NOW - PROVISION_CLAIM_MS + 1000 });
ok("a try in the last 10 minutes holds a second press", !running.go && running.why === "in_progress");
ok("a press after the hold buys even after 5 failures", provisionDecision({ ...base, attempts: MAX_PROVISION_ATTEMPTS, triedAtMs: NOW - PROVISION_CLAIM_MS - 1 }).go);
const sweep = { ...base, fromPress: false };
ok("the sweep retries after an hour", provisionDecision({ ...sweep, attempts: 1, triedAtMs: NOW - PROVISION_RETRY_GAP_MS - 1 }).go);
const soon = provisionDecision({ ...sweep, attempts: 1, triedAtMs: NOW - PROVISION_RETRY_GAP_MS + 60_000 });
ok("the sweep waits an hour between tries", !soon.go && soon.why === "too_soon");
const gaveUp = provisionDecision({ ...sweep, attempts: MAX_PROVISION_ATTEMPTS, triedAtMs: NOW - 2 * PROVISION_RETRY_GAP_MS });
ok("the sweep stops after 5 tries", !gaveUp.go && gaveUp.why === "gave_up");

// --- when to release ---
const rel = { boughtByApp: true, planHasTexting: true, closed: false, lapsedSinceMs: null, nowMs: NOW };
ok("a paying account keeps its number", releaseDecision(rel) === "keep");
ok("a hand-set number is never released", releaseDecision({ ...rel, boughtByApp: false, planHasTexting: false, lapsedSinceMs: NOW - 30 * RELEASE_GRACE_MS }) === "keep");
ok("leaving Growth starts the 7 days", releaseDecision({ ...rel, planHasTexting: false }) === "mark_lapsed");
ok("closing starts the 7 days", releaseDecision({ ...rel, closed: true }) === "mark_lapsed");
ok("inside the 7 days it stays", releaseDecision({ ...rel, planHasTexting: false, lapsedSinceMs: NOW - RELEASE_GRACE_MS + 1000 }) === "keep");
ok("after 7 days it is released", releaseDecision({ ...rel, planHasTexting: false, lapsedSinceMs: NOW - RELEASE_GRACE_MS }) === "release");
ok("coming back inside 7 days keeps it", releaseDecision({ ...rel, lapsedSinceMs: NOW - 1000 }) === "clear_lapsed");

// --- names and emails ---
ok("friendly name", numberFriendlyName("Lakeview Rentals", "b6fdceb7-e7f6") === "Vacantless Lakeview Rentals");
ok("friendly name without a name", numberFriendlyName(null, "b6fdceb7-e7f6") === "Vacantless b6fdceb7");
const mail = provisionGaveUpEmail({ orgName: "Lakeview Rentals", orgId: "b6f", lastError: "twilio_buy_400", plan: windsor });
ok("gave-up email names the account and the error", mail.subject.includes("Lakeview Rentals") && mail.body.includes("twilio_buy_400"));
ok("gave-up email lists the area codes", mail.body.includes("519, 226"));
ok("gave-up email has no em dash", !/—/.test(mail.subject + mail.body));

// --- wiring ---
const read = (f: string) => readFileSync(f, "utf8");
const server = read("lib/texting-numbers-server.ts");
ok("buys only numbers with no address needed", server.includes("pickBuyableNumber("));
ok("points texts at our inbound route", server.includes("/api/sms/inbound") && server.includes("SmsUrl"));
ok("points calls at our voice route", server.includes("/api/sms/voice") && server.includes("VoiceUrl"));
ok("claims the try before buying", server.indexOf("Claim the try") < server.indexOf("await buyNumber("));
ok("releases a number it could not save", server.includes("if (bought) await releaseTwilioNumber(bought.sid)"));
ok("emails admins only at the last try", server.includes("attempts === MAX_PROVISION_ATTEMPTS"));
ok("sweep releases only app-bought numbers", server.includes('.not("twilio_sid", "is", null)'));
ok("release checks the Twilio sid shape", server.includes("/^PN[0-9a-f]{32}$/i"));
ok("an off switch exists", server.includes("TEXTING_AUTO_NUMBERS"));
const settings = read("app/dashboard/settings/actions.ts");
ok("the press buys straight away", settings.includes("provisionTextingNumber(admin, org.id, { fromPress: true })"));
ok("the press still needs texting on the plan", settings.includes('if (!canUseRenterSms(org.plan)) redirect("/dashboard/settings?tab=comms&sms=upgrade")'));
const adminActions = read("app/dashboard/admin/actions.ts");
ok("staff remove releases an app-bought number", adminActions.includes("releaseTwilioNumber(twilioSid)"));
ok("in the 15-minute sweep", (SWEEP_PATHS as readonly string[]).includes("/api/cron/texting-numbers"));
ok("in the GitHub backup", read(".github/workflows/reminders.yml").includes("/api/cron/texting-numbers"));
const route = read("app/api/cron/texting-numbers/route.ts");
ok("sweep route needs the cron secret", route.includes("CRON_SECRET"));
const migration = read("supabase/migrations/0259_texting_numbers_auto.sql");
ok("migration adds the sid and the retry count", migration.includes("twilio_sid") && migration.includes("sms_provision_attempts"));

console.log(`\ntexting-numbers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
