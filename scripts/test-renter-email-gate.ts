// Run with: npx tsx scripts/test-renter-email-gate.ts
// S728: one gate for every renter email. A renter who unsubscribed gets no
// marketing email again; their own booking confirmation still goes (the
// Brevo unsubscribe block is lifted); bounced and spam-reported addresses get
// nothing.
import { emailKindClass, gateVerdict, kindFromTags, blockedFromEvents } from "../lib/renter-email-block";
import { signRenterUnsubscribeToken, verifyRenterUnsubscribeToken } from "../lib/renter-unsubscribe";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

ok("kind tag read", kindFromTags(["lead:x", "kind:booking_confirmation"]) === "booking_confirmation");
ok("no kind tag", kindFromTags(["lead:x"]) === null);
ok("nurture is marketing", emailKindClass("nurture_email") === "marketing");
ok("new times is marketing", emailKindClass("viewing_times_opened") === "marketing");
ok("reminder is transactional", emailKindClass("reminder_24h") === "transactional");
ok("booking is transactional", emailKindClass("booking_confirmation") === "transactional");
ok("team alert is other", emailKindClass("notification_email") === "other");
ok("tenant message is other", emailKindClass("tenant_message") === "other");

const unsub = { reason: "unsubscribedViaEmail" };
const bounce = { reason: "hardBounce" };
ok("marketing to opted-out renter blocked", gateVerdict({ kindClass: "marketing", optedOut: true, block: null }).allow === false);
ok("marketing to blocked address blocked", gateVerdict({ kindClass: "marketing", optedOut: false, block: unsub }).allow === false);
ok("marketing to clean renter allowed", gateVerdict({ kindClass: "marketing", optedOut: false, block: null }).allow === true);
const t1 = gateVerdict({ kindClass: "transactional", optedOut: true, block: unsub });
ok("booking to unsubscribed renter allowed and lifts the block", t1.allow === true && t1.liftBlock === true);
const t2 = gateVerdict({ kindClass: "transactional", optedOut: true, block: null });
ok("booking to opted-out renter with no block allowed, no lift", t2.allow === true && !t2.liftBlock);
const t3 = gateVerdict({ kindClass: "transactional", optedOut: false, block: bounce });
ok("booking to bounced address blocked", t3.allow === false && String(t3.reason).startsWith("address_blocked:hardBounce"));
ok("spam report never lifted", gateVerdict({ kindClass: "transactional", optedOut: false, block: { reason: "contactFlaggedAsSpam" } }).allow === false);
ok("other kinds untouched", gateVerdict({ kindClass: "other", optedOut: true, block: bounce }).allow === true);

// The lift records a clear row, so the block state reads clear afterwards.
const rows = [
  { email: "a@x.com", event: "blocked", kind: "blocklist", reason: "unsubscribedViaEmail", occurred_at: "2026-10-16T23:32:00Z" },
  { email: "a@x.com", event: "other", kind: "blocklist_cleared", reason: "lifted_for_transactional", occurred_at: "2026-10-21T01:00:00Z" },
];
ok("lifted address reads clear", !blockedFromEvents(rows).has("a@x.com"));

const secret = "s3cret";
const id = "0a455e72-4981-4a1a-9979-ca971dd3c0ef";
const tok = signRenterUnsubscribeToken(id, secret);
ok("lead token verifies", verifyRenterUnsubscribeToken(tok, secret)?.id === id && verifyRenterUnsubscribeToken(tok, secret)?.subject === "lead");
const wtok = signRenterUnsubscribeToken(id, secret, "waitlist");
ok("waitlist token verifies as waitlist", verifyRenterUnsubscribeToken(wtok, secret)?.subject === "waitlist");
ok("lead token is not a waitlist token", tok !== wtok);
ok("tampered token fails", verifyRenterUnsubscribeToken(tok.slice(0, -1) + "0", secret) === null);
ok("wrong secret fails", verifyRenterUnsubscribeToken(tok, "other") === null);
ok("empty secret fails", verifyRenterUnsubscribeToken(tok, "") === null);

console.log(`renter-email-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
