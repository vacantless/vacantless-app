// Run: npx tsx scripts/test-renter-email-block.ts
import { blockReasonWords, blockedFromEvents, blocklistRowsToRecord } from "../lib/renter-email-block";
let passed = 0, failed = 0;
const ok = (n: string, c: boolean) => { if (c) passed++; else { failed++; console.error("  X " + n); } };

ok("words: unsubscribe", blockReasonWords("unsubscribedViaEmail") === "they unsubscribed");
ok("words: spam", blockReasonWords("contactFlaggedAsSpam") === "they marked an email as spam");
ok("words: unknown", blockReasonWords(null) === "the email service blocked the address");

{
  const m = blockedFromEvents([
    { email: "A@x.com", event: "delivered", kind: "nurture", occurred_at: "2026-10-16T00:00:00Z" },
    { email: "a@x.com", event: "blocked", kind: "blocklist", reason: "unsubscribedViaEmail", occurred_at: "2026-10-18T00:00:00Z" },
  ]);
  ok("blocked after delivered", m.has("a@x.com") && m.get("a@x.com")?.reason === "unsubscribedViaEmail");
}
{
  const m = blockedFromEvents([
    { email: "a@x.com", event: "blocked", kind: "blocklist", occurred_at: "2026-10-18T00:00:00Z" },
    { email: "a@x.com", event: "other", kind: "blocklist_cleared", occurred_at: "2026-10-19T00:00:00Z" },
  ]);
  ok("cleared after blocked", !m.has("a@x.com"));
}
ok("opened does not clear", blockedFromEvents([
  { email: "a@x.com", event: "spam", kind: "x", occurred_at: "2026-10-18T00:00:00Z" },
  { email: "a@x.com", event: "opened", kind: "x", occurred_at: "2026-10-19T00:00:00Z" },
]).has("a@x.com"));

const now = "2026-10-20T15:00:00.000Z";
const leads = [
  { id: "L1", organization_id: "O", email: "Bansee@gmail.com" },
  { id: "L2", organization_id: "O", email: "bansee@gmail.com" },
  { id: "L3", organization_id: "O", email: "team@agile.ca" },
  { id: "L4", organization_id: "O", email: "back@x.com" },
];
{
  const rows = blocklistRowsToRecord({
    blocked: [{ email: "bansee@gmail.com", reason: { code: "unsubscribedViaEmail" }, blockedAt: "2026-10-18T10:00:00Z" }, { email: "team@agile.ca", reason: { code: "unsubscribedViaEmail" } }],
    team: new Set(["team@agile.ca"]),
    leads,
    recorded: [{ email: "back@x.com", event: "blocked", kind: "blocklist", occurred_at: "2026-10-01T00:00:00Z" }],
    nowIso: now,
  });
  ok("records both leads with the blocked address", rows.filter((r) => r.kind === "blocklist").map((r) => r.lead_id).join() === "L1,L2");
  ok("keeps blockedAt and reason", rows[0].occurred_at === "2026-10-18T10:00:00.000Z" && rows[0].reason === "unsubscribedViaEmail");
  ok("never records a team address", !rows.some((r) => r.lead_id === "L3"));
  ok("clears an address that left the list", rows.some((r) => r.lead_id === "L4" && r.kind === "blocklist_cleared" && r.event === "other"));
}
{
  const rows = blocklistRowsToRecord({
    blocked: [{ email: "bansee@gmail.com" }],
    team: new Set(),
    leads: [leads[0]],
    recorded: [{ email: "bansee@gmail.com", event: "blocked", kind: "blocklist", occurred_at: "2026-10-18T00:00:00Z" }],
    nowIso: now,
  });
  ok("already recorded: nothing new", rows.length === 0);
}
console.log(`\nrenter-email-block: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
