// S719: email sweep fixes. Run: npx tsx scripts/test-s719-email-fixes.ts
import { robotNextStep } from "../lib/posting-lanes";
import { getNotificationEvent } from "../lib/notifications";
import { STUCK_NEXT_STEP } from "../lib/distribution-stuck-sweep";
import { scrubEmDashes } from "../lib/email";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name, detail ?? "");
  }
}

for (const ch of ["rentals_ca", "kijiji", "zumper"]) {
  const op = robotNextStep("needs_operator", ch, "Rentals.ca");
  ok(`${ch} operator says approve`, !!op && /Approve and post/.test(op), op);
  ok(`${ch} operator never asks to paste a link`, !!op && !/paste|submit|URL/i.test(op), op);
  const login = robotNextStep("needs_login", ch, "Rentals.ca");
  ok(`${ch} login says sign in once`, !!login && /sign in once/.test(login), login);
  const pay = robotNextStep("needs_payment", ch, "Kijiji");
  ok(`${ch} payment never enters cards`, !!pay && /never enter card/.test(pay), pay);
  ok(`${ch} unclaimed falls back`, robotNextStep("unclaimed_concierge", ch, "X") === null);
}
ok("facebook keeps its own wording", robotNextStep("needs_operator", "facebook", "Facebook") === null);
ok("manual operator step points to the rental page", /rental's page/.test(STUCK_NEXT_STEP.needs_operator));
ok("manual operator step has no URL jargon", !/live URL/.test(STUCK_NEXT_STEP.needs_operator));

const desk = getNotificationEvent("leasing.distribution_job_needs_action")!;
ok("desk body has no paste sentence", !/paste its link/.test(desk.defaultBody), desk.defaultBody);
ok("desk body still promises nothing posted", /Nothing has been posted, paid for or sent for you yet\./.test(desk.defaultBody));

const cancel = getNotificationEvent("leasing.showing_cancelled")!;
ok("cancel subject uses a colon", cancel.defaultSubject === "Viewing cancelled: {{lead_name}}, {{property_address}}", cancel.defaultSubject);

ok("timeline note scrub", scrubEmDashes('Booking confirmation sent to a@b.c — "Hi"') === 'Booking confirmation sent to a@b.c - "Hi"');

// No em dash or "Distribute" button anywhere in the touched sources.
import { readFileSync } from "node:fs";
const files = [
  "app/api/cron/distribution-worker/route.ts",
  "lib/leaseup-takedown.ts",
  "lib/relist-radar.ts",
  "app/api/relist-radar/decision/[token]/route.ts",
];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  ok(`${f} has no Distribute button`, !/"(Open|Manage in) Distribute"|open Distribute/.test(src));
}
for (const f of [
  "app/dashboard/properties/actions.ts",
  "app/api/cron/feedback/route.ts",
  "app/api/cron/nurture/route.ts",
  "app/api/cron/reminders/route.ts",
  "lib/lease-signing.ts",
  "lib/rent-receipt.ts",
  "lib/n1-render.ts",
  "lib/lease-render.ts",
  "lib/rental-application-summary.ts",
]) {
  const src = readFileSync(f, "utf8");
  ok(`${f} has no quoted em dash`, !/["`]\s*—|—\s*["`]/.test(src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n")));
}
const fb = readFileSync("app/f/[showingId]/actions.ts", "utf8");
ok("feedback refuses a future viewing", /viewingIsInFuture\(showingId\)/.test(fb) && /error=not_yet/.test(fb));

console.log(`s719-email-fixes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
