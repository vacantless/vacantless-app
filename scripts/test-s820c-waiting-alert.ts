// S820c: the "no viewing times" alert comes back daily while renters wait.
// Run: npx tsx scripts/test-s820c-waiting-alert.ts
import { readFileSync } from "node:fs";
import { shouldAlertWaiting, waitingSummary } from "../lib/availability-tripwire";
import { getNotificationEvent, renderNotification } from "../lib/notifications";
import { buildSnapshotBlock } from "../lib/leasing-snapshot";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const base = { severity: "zero" as const, lastAlertOn: "2026-11-18", todayLocal: "2026-11-19", localHour: 9, newWaiting: 3 };
ok("zero + waiting + new day + 9 am -> alert", shouldAlertWaiting(base));
ok("thin also alerts", shouldAlertWaiting({ ...base, severity: "thin" }));
ok("ok never", !shouldAlertWaiting({ ...base, severity: "ok" }));
ok("nobody waiting -> no", !shouldAlertWaiting({ ...base, newWaiting: 0 }));
ok("already sent today -> no", !shouldAlertWaiting({ ...base, lastAlertOn: "2026-11-19" }));
ok("before 8 am -> no", !shouldAlertWaiting({ ...base, localHour: 7 }));
ok("never alerted before -> yes", shouldAlertWaiting({ ...base, lastAlertOn: null }));

ok("summary none", waitingSummary([], 0) === "");
ok("summary one", waitingSummary(["Lamar"], 1).startsWith("1 new renter is waiting to book: Lamar."));
ok("summary three", waitingSummary(["Lamar", "Prabhas", "Gaurav"], 3).startsWith("3 new renters are waiting to book: Lamar, Prabhas and Gaurav."));
const many = waitingSummary(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], 10);
ok("summary caps at 8 names", many.includes("a, b, c, d, e, f, g, h and 2 more."), many);
ok("summary unnamed", waitingSummary(["", ""], 2).startsWith("2 new renters are waiting to book."));
ok("summary says why", waitingSummary(["Lamar"], 1).includes("shows no times yet"));

const ev = getNotificationEvent("leasing.viewing_availability_dropped")!;
ok("event has waiting token", ev.tokens.includes("waiting_summary"));
const r = renderNotification(ev, null, { availability_summary: "No times.", waiting_summary: "2 new renters are waiting to book: A and B.\n\n", viewing_times_url: "https://x/a" } as never);
ok("body with waiting", r.body === "No times.\n\n2 new renters are waiting to book: A and B.\n\nAdd viewing times: https://x/a", r.body);
const r0 = renderNotification(ev, null, { availability_summary: "No times.", waiting_summary: "", viewing_times_url: "https://x/a" } as never);
ok("body without waiting unchanged", r0.body === "No times.\n\nAdd viewing times: https://x/a", r0.body);

const route = readFileSync("app/api/cron/availability-tripwire/route.ts", "utf8");
ok("route uses shouldAlertWaiting", route.includes("shouldAlertWaiting({"));
ok("route stamps today on a waiting alert", route.includes("if (waitingAlert && !decision.alert) decision.nextLastAlertOn = todayLocal;"));

// The daily email marks chat renters so they do not read as dead ends.
const lead = (name: string, chat: boolean, phone: string | null = null) => ({ name, phone, move_in: null, source: "Facebook Marketplace", property_address: "1551 Assumption St, Unit 9, Windsor, ON", created_at: "2026-11-19T13:00:00Z", chat });
const block = buildSnapshotBlock({ newLeads: [lead("Lamar", true), lead("Victor chidi", false, "4376653805")], showingsToday: [], showingsWeek: [], noShowing: [] } as never, "America/Toronto");
ok("digest: chat renter labelled", block.includes("Facebook Marketplace chat, reply there"), block);
ok("digest: renter with phone unchanged", block.includes("437-665-3805 · Facebook Marketplace"), block);
const snapRoute = readFileSync("app/api/cron/leasing-snapshot/route.ts", "utf8");
ok("snapshot route sets chat", (snapRoute.match(/chat: isChatPlaceholder\(/g) ?? []).length === 2);

console.log(`S820c waiting alert: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
