// S808b: tenants text in repair requests (lib/text-in-repairs + server half).
import {
  guessRepairCategory, guessEmergencyKind, textedRepairCategory, isFollowOnText, textedRepairReply,
  textedDescription, appendFollowOn, TEXTED_MARKER,
} from "../lib/text-in-repairs";
import { fileTextedRepair } from "../lib/text-in-repairs-server";
import { readFileSync } from "node:fs";
import { TIERS, canUseIncidentIntake } from "../lib/billing";

let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.log("FAIL", n); } }

ok("cat plumbing", guessRepairCategory("The kitchen sink is leaking") === "plumbing");
ok("cat hvac", guessRepairCategory("thermostat won't turn up") === "hvac");
ok("cat appliance", guessRepairCategory("fridge stopped cooling") === "appliance");
ok("cat pest", guessRepairCategory("I saw a mouse in the kitchen") === "pest");
ok("cat locks", guessRepairCategory("front door lock is broken") === "doors_locks");
ok("cat general", guessRepairCategory("hi can someone call me") === "general");
ok("emerg gas", guessEmergencyKind("I smell gas in the hallway") === "gas_smell");
ok("emerg fire", guessEmergencyKind("there is smoke coming from the outlet") === "fire_smoke");
ok("smoke alarm chirp is not fire", guessEmergencyKind("smoke alarm keeps beeping, needs a battery") === null);
ok("emerg flood", guessEmergencyKind("bathroom is flooded") === "water_leak");
ok("small leak is not emergency", guessEmergencyKind("small leak under the sink") === null);
ok("emerg heat", guessEmergencyKind("we have no heat since last night") === "no_heat");
ok("emerg locked out", guessEmergencyKind("I'm locked out") === "locked_out");
const tc = textedRepairCategory("no heat and the radiator is cold");
ok("emergency category wins", tc.emergencyKind === "no_heat" && tc.category === "hvac");
const now = new Date("2026-11-16T20:00:00Z");
ok("follow-on inside 15 min", isFollowOnText("2026-11-16T19:50:00Z", now));
ok("not follow-on after 15 min", !isFollowOnText("2026-11-16T19:40:00Z", now) && !isFollowOnText(null, now));
const reply = textedRepairReply({ orgName: "Maple Door Rentals", reportUrl: "https://app.vacantless.com/report/abc", emergencyKind: null });
ok("reply names org + link", reply.includes("Maple Door Rentals") && reply.includes("/report/abc") && !reply.includes("911"));
ok("gas reply says 911 first", textedRepairReply({ orgName: null, reportUrl: "u", emergencyKind: "gas_smell" }).startsWith("If anyone is in danger, call 911"));
ok("no em dash", !(reply + textedDescription("x")).includes("—"));
ok("marker", textedDescription("sink leaks").endsWith(TEXTED_MARKER) && appendFollowOn("a", "b").endsWith("Also texted: b"));

// Every paid plan has it; Free does not; the Premium card no longer claims it alone.
for (const p of ["starter", "growth", "portfolio", "premium", "managed"]) ok(`intake on ${p}`, canUseIncidentIntake(p));
ok("free has no intake", !canUseIncidentIntake("free"));
ok("premium card has no text-in line", !JSON.stringify(TIERS.premium).toLowerCase().includes("text in repair") && !JSON.stringify(TIERS.premium).toLowerCase().includes("text-in"));
const route = readFileSync("app/api/sms/inbound/route.ts", "utf8");
ok("route tries repairs before renter replies", route.indexOf("fileTextedRepair(") > 0 && route.indexOf("fileTextedRepair(") < route.indexOf("applyInboundSms(admin"));
ok("route skips STOP/START", /if \(!classifyInbound\(/.test(route));
ok("report actions use shared notify", readFileSync("app/report/[token]/actions.ts", "utf8").includes('from "@/lib/incident-notify-server"'));

// Fake database for the server half.
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>, rpcResult: unknown) {
  const calls: { rpc: [string, unknown][]; updates: { table: string; patch: Row }[] } = { rpc: [], updates: [] };
  function q(table: string) {
    let rows = [...(tables[table] ?? [])];
    let patch: Row | null = null;
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b; },
      in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b; },
      is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
      order(c: string, o: { ascending: boolean }) { rows.sort((a, z) => String(o.ascending ? a[c] : z[c]).localeCompare(String(o.ascending ? z[c] : a[c]))); return b; },
      limit(n: number) { rows = rows.slice(0, n); return b; },
      update(p: Row) { patch = p; return b; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(res: (v: unknown) => unknown) {
        if (patch) { for (const r of rows) Object.assign(r, patch); calls.updates.push({ table, patch }); }
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return b;
  }
  return { from: q, rpc: (name: string, args: unknown) => { calls.rpc.push([name, args]); return Promise.resolve({ data: rpcResult, error: null }); }, calls };
}

(async () => {
  const base = () => ({
    tenants: [{ id: "t1", organization_id: "o1", tenancy_id: "ty1", name: "Pat", sms_opt_out: false, phone_e164: "+15195550100" }],
    tenancies: [{ id: "ty1", organization_id: "o1", status: "active", report_token: null, start_date: "2026-01-01" }],
    organizations: [{ id: "o1", name: "Maple Door Rentals", plan: "growth" }],
    incident_reports: [] as Row[],
    platform_switches: [] as Row[],
  });
  const a1 = fakeAdmin(base(), { ok: true, report_id: "r1", organization_id: "o1" });
  const r1 = await fileTextedRepair(a1 as never, { from: "+1 519 555 0100", body: "The kitchen sink is leaking", ownerOrgId: "o1" });
  ok("files a request", r1.handled === true && (r1 as { reportId: string }).reportId === "r1");
  const args = a1.calls.rpc[0]?.[1] as Record<string, unknown>;
  ok("rpc args", a1.calls.rpc[0]?.[0] === "submit_incident_report" && args.p_category === "plumbing" && String(args.p_description).includes(TEXTED_MARKER) && args.p_reporter_name === "Pat" && typeof args.p_token === "string");
  ok("token minted", a1.calls.updates.some((u) => u.table === "tenancies" && typeof u.patch.report_token === "string"));

  const free = base(); free.organizations[0].plan = "free";
  const r2 = await fileTextedRepair(fakeAdmin(free, null) as never, { from: "+15195550100", body: "sink leaking", ownerOrgId: "o1" });
  ok("free plan falls through", !r2.handled && (r2 as { reason: string }).reason === "plan");

  const other = await fileTextedRepair(fakeAdmin(base(), null) as never, { from: "+15195550199", body: "is the unit available?", ownerOrgId: "o1" });
  ok("a renter falls through", !other.handled);

  const wrongOrg = await fileTextedRepair(fakeAdmin(base(), null) as never, { from: "+15195550100", body: "sink leaking", ownerOrgId: "o2" });
  ok("another landlord's number falls through", !wrongOrg.handled);

  const ended = base(); ended.tenancies[0].status = "ended";
  ok("ended tenancy falls through", !(await fileTextedRepair(fakeAdmin(ended, null) as never, { from: "+15195550100", body: "sink leaking", ownerOrgId: "o1" })).handled);

  const follow = base();
  follow.incident_reports.push({ id: "r0", tenancy_id: "ty1", description: textedDescription("sink leaking"), submitted_at: new Date(Date.now() - 5 * 60_000).toISOString(), status: "submitted" });
  const a3 = fakeAdmin(follow, null);
  const r3 = await fileTextedRepair(a3 as never, { from: "+15195550100", body: "it's getting worse", ownerOrgId: "o1" });
  ok("second text adds to the first", r3.handled && (r3 as { followOn: boolean }).followOn && a3.calls.rpc.length === 0 && String(follow.incident_reports[0].description).includes("Also texted: it's getting worse"));

  console.log(`test-text-in-repairs: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
