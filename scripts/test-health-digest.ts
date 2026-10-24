import { readFileSync } from "node:fs";
// S720: the daily health email's rules. Run: npx tsx scripts/test-health-digest.ts
import { buildHealthDigest, healthSections, portalOutcomeIsProblem, torontoDateHour, type HealthInput } from "../lib/health-digest";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}

const now = new Date("2026-10-16T12:30:00Z"); // 8:30 AM Toronto
const clean: HealthInput = {
  now,
  sweeps: [
    { ran_at: "2026-10-16T12:15:00Z", ok: true, ran: 28, failed: [] },
    { ran_at: "2026-10-16T12:00:00Z", ok: true, ran: 28, failed: [] },
  ],
  lastSweepAt: "2026-10-16T12:15:00Z",
  emails: { checked: true, problems: [] },
  portal: [],
  parserNotes: [],
  robot: [],
  signIns: [],
};

{
  const d = buildHealthDigest(clean);
  ok("clean: subject says all clear", d.subject === "Vacantless health: all clear", d.subject);
  ok("clean: zero problems", d.problems === 0);
  ok("clean: says nothing failed", d.body.startsWith("Nothing failed in the last 24 hours."));
  ok("clean: names what was checked", d.body.includes("2 of 2 background sweeps clean"));
  ok("clean: says what it does not check", d.body.includes("Not checked here: app errors"));
}

{
  const d = buildHealthDigest({ ...clean, lastSweepAt: "2026-10-16T10:00:00Z" });
  ok("stale sweeps: flagged", d.problems === 1 && d.body.includes("last ran 150 minutes ago"), d.body);
}
{
  const d = buildHealthDigest({ ...clean, lastSweepAt: null });
  ok("never ran: flagged", d.body.includes("No background sweep has ever been recorded"));
}
{
  const d = buildHealthDigest({
    ...clean,
    sweeps: [
      { ran_at: "a", ok: false, ran: 28, failed: ["/api/cron/reminders:500", "/api/cron/feedback:TimeoutError"] },
      { ran_at: "b", ok: false, ran: 28, failed: ["/api/cron/reminders:500"] },
      { ran_at: "c", ok: true, ran: 28, failed: [] },
    ],
  });
  ok("sweep failures: counted per sweep", d.body.includes("reminders failed in 2 of 3 runs."), d.body);
  ok("sweep failures: second sweep listed", d.body.includes("feedback failed in 1 of 3 runs."));
  ok("sweep failures: problem count", d.problems === 2, d.problems);
  ok("sweep failures: subject", d.subject === "Vacantless health: 2 problems", d.subject);
}
{
  const d = buildHealthDigest({
    ...clean,
    emails: {
      checked: true,
      problems: [{ event: "hardBounces", email: "renter@example.com", subject: "Your viewing is booked", reason: "550 no such user" }],
    },
  });
  ok("bounce: plain words", d.body.includes("To renter@example.com \"Your viewing is booked\": bounced (address does not exist). Reason: 550 no such user"), d.body);
  ok("bounce: one problem", d.subject === "Vacantless health: 1 problem", d.subject);
}
{
  const d = buildHealthDigest({ ...clean, emails: { checked: false, note: "brevo blocked 401", problems: [] } });
  ok("email not checked: said so", d.body.includes("Could not check email delivery (brevo blocked 401)."), d.body);
  ok("email not checked: footer too", d.body.includes("email delivery (not checked)"));
}
{
  const d = buildHealthDigest({
    ...clean,
    parserNotes: [
      {
        org: "Agile Real Estate Group",
        name: "Jem",
        notes: "Received from Kijiji (enquiry).\n\nParser notes: could not isolate the renter's message from the body",
      },
    ],
    portal: [{ org: "Agile Real Estate Group", outcome: "not_parsed", count: 2 }],
  });
  ok("parser gap: the Jem case is reported", d.body.includes("Agile Real Estate Group: Jem was filed with gaps (could not isolate the renter's message from the body)."), d.body);
  ok("portal outcome: reported", d.body.includes("2 site emails not filed as a renter (not parsed)."), d.body);
}
ok("portal: lead_created is fine", !portalOutcomeIsProblem("lead_created"));
ok("portal: duplicate is fine", !portalOutcomeIsProblem("duplicate"));
ok("portal: not_parsed is a problem", portalOutcomeIsProblem("not_parsed"));
{
  const s = healthSections({
    ...clean,
    robot: [{ org: "S712 Test Rentals", channel: "zumper", status: "rejected", error: null }],
    signIns: [{ org: "Agile Real Estate Group", channel: "rentals_ca", code: "needs_login" }],
  });
  const lines = s.flatMap((x) => x.lines).join("\n");
  ok("robot: rejected post listed", lines.includes("S712 Test Rentals, zumper: rejected."), lines);
  ok("robot: signed-out site listed", lines.includes("Agile Real Estate Group, rentals_ca: signed out (needs login)."), lines);
}
{
  // S728: a sweep a flag switched off is named once, from the newest run.
  const s = healthSections({
    ...clean,
    sweeps: [
      { ran_at: "2026-10-16T12:00:00Z", ok: true, ran: 28, failed: [], details: { "landlord-campaign": { status: 200, reason: "disabled" }, nurture: { status: 200, sent: 1 } } },
      { ran_at: "2026-10-16T12:15:00Z", ok: true, ran: 28, failed: [], details: { "landlord-campaign": { status: 200, reason: "disabled" }, "compliance-calendar": { status: 200, reason: "global_disabled" }, nurture: { status: 200, sent: 0 } } },
    ],
  });
  const lines = s.flatMap((x) => x.lines).join("\n");
  ok("flag-off sweeps named", lines.includes("Switched off by a flag (not running): compliance-calendar, landlord-campaign."), lines);
  ok("a sweep that merely sent 0 is not called off", !lines.includes("nurture"), lines);
}
{
  const many = Array.from({ length: 20 }, (_, i) => ({ event: "softBounces", email: `r${i}@x.com`, subject: null, reason: null }));
  const d = buildHealthDigest({ ...clean, emails: { checked: true, problems: many } });
  ok("many bounces: capped with a count", d.body.includes("...and 5 more."), d.body);
}
{
  const all = buildHealthDigest({
    ...clean,
    lastSweepAt: null,
    emails: { checked: false, problems: [] },
    parserNotes: [{ org: "A", name: null, notes: "Parser notes: x" }],
  });
  ok("no em dash anywhere", !/—/.test(all.subject + all.body));
}
ok("toronto: 12:30Z is 8 AM local", torontoDateHour(now).hour === 8 && torontoDateHour(now).date === "2026-10-16", torontoDateHour(now));
ok("toronto: 03:00Z is the previous local day", torontoDateHour(new Date("2026-10-16T03:00:00Z")).date === "2026-10-15");

// S736: the server Node line (information, never a problem).
{
  const waiting = buildHealthDigest({ ...clean, serverNode: { version: "v24.21.0", fixed: false } });
  ok("node: unpatched line", waiting.body.includes("Server Node: v24.21.0. The security fix is not on the server yet."), waiting.body);
  ok("node: unpatched is not a problem", waiting.problems === 0 && waiting.subject.endsWith("all clear"));
  const fixed = buildHealthDigest({ ...clean, serverNode: { version: "v24.22.1", fixed: true } });
  ok("node: patched says roll the Stripe key", fixed.body.includes("Roll the Stripe key now"), fixed.body);
  ok("node: no line when not given", !buildHealthDigest(clean).body.includes("Server Node"));
  ok("node: route passes the server Node", readFileSync("app/api/cron/health-digest/route.ts", "utf8").includes("nodeHasBrotliFix(process.version)"));
  ok("node: the 15-minute log keeps it", readFileSync("app/api/cron/sweep-all/route.ts", "utf8").includes('"server-node": { status: null, reason: process.version }'));
}

console.log(`\nhealth-digest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
