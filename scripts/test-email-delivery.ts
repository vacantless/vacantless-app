// Run with: npx tsx scripts/test-email-delivery.ts
import {
  canonicalEvent,
  isUndeliverable,
  parseTags,
  undeliverableSince,
} from "../lib/email-delivery";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

eq("canonical delivered", canonicalEvent("delivered"), "delivered");
eq("canonical hard bounce", canonicalEvent("hard_bounce"), "bounced");
eq("canonical soft bounce", canonicalEvent("soft-bounce"), "bounced");
eq("canonical blocked", canonicalEvent("blocked"), "blocked");
eq("canonical spam", canonicalEvent("spam"), "spam");
eq("canonical complaint", canonicalEvent("complaint"), "spam");
eq("canonical opened", canonicalEvent("unique_opened"), "opened");
eq("canonical request", canonicalEvent("request"), "other");
eq("canonical unknown", canonicalEvent("something_new"), "other");

eq("parse missing kind", parseTags(null).kind, null);
eq("parse wrong type lead", parseTags({ lead: "x" }).leadId, null);
eq("parse foreign tags ignored", parseTags(["foo", "campaign:x"]).kind, null);
const parsed = parseTags([
  "kind:reminder_24h",
  "lead:lead_1",
  "showing:showing_1",
  7,
]);
eq("parse kind", parsed.kind, "reminder_24h");
eq("parse lead", parsed.leadId, "lead_1");
eq("parse showing", parsed.showingId, "showing_1");

ok("isUndeliverable bounced", isUndeliverable("bounced"));
ok("isUndeliverable blocked", isUndeliverable("blocked"));
ok("isUndeliverable spam", isUndeliverable("spam"));
ok("isUndeliverable delivered false", !isUndeliverable("delivered"));
ok("isUndeliverable opened false", !isUndeliverable("opened"));
ok("isUndeliverable other false", !isUndeliverable("other"));

const since = "2026-07-20T12:00:00.000Z";
ok(
  "undeliverableSince true on bounce after since",
  undeliverableSince([{ event: "bounced", occurred_at: "2026-07-20T12:01:00.000Z" }], since),
);
ok(
  "undeliverableSince false when later delivered exists",
  !undeliverableSince(
    [
      { event: "bounced", occurred_at: "2026-07-20T12:01:00.000Z" },
      { event: "delivered", occurred_at: "2026-07-20T12:02:00.000Z" },
    ],
    since,
  ),
);
ok(
  "undeliverableSince true when bounce follows delivered",
  undeliverableSince(
    [
      { event: "delivered", occurred_at: "2026-07-20T12:01:00.000Z" },
      { event: "blocked", occurred_at: "2026-07-20T12:02:00.000Z" },
    ],
    since,
  ),
);
ok(
  "undeliverableSince false on bounce before since",
  !undeliverableSince([{ event: "spam", occurred_at: "2026-07-20T11:59:00.000Z" }], since),
);
ok("undeliverableSince empty false", !undeliverableSince([], since));

if (fail) {
  console.error(`\nemail-delivery: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`email-delivery: ${pass} passed, 0 failed`);
