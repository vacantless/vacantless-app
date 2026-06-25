// Unit tests for the pure dispatch-messages domain model (S329 — the
// "trade asks a question" reply). Run: npx tsx scripts/test-dispatch-messages.ts
import {
  DISPATCH_MESSAGE_SENDERS,
  isDispatchMessageSender,
  canPostDispatchMessage,
  validateDispatchMessage,
  MAX_DISPATCH_MESSAGE_LEN,
  tradeSenderLabel,
  operatorSenderLabel,
  messageExcerpt,
  awaitsOperatorReply,
  type DispatchMessage,
} from "../lib/dispatch-messages";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- senders ----------------------------------------------------------------
ok("senders: two", DISPATCH_MESSAGE_SENDERS.length === 2);
ok("isSender: trade", isDispatchMessageSender("trade"));
ok("isSender: operator", isDispatchMessageSender("operator"));
ok("isSender: junk", !isDispatchMessageSender("owner"));
ok("isSender: non-string", !isDispatchMessageSender(3));

// --- state predicate (mirrors the RPC) --------------------------------------
ok("canPost: offered", canPostDispatchMessage("offered"));
ok("canPost: accepted", canPostDispatchMessage("accepted"));
ok("canPost: quoted", canPostDispatchMessage("quoted"));
ok("canPost: scheduled", canPostDispatchMessage("scheduled"));
ok("canPost: completed NO", !canPostDispatchMessage("completed"));
ok("canPost: declined NO", !canPostDispatchMessage("declined"));
ok("canPost: cancelled NO", !canPostDispatchMessage("cancelled"));

// --- validation -------------------------------------------------------------
const vEmpty = validateDispatchMessage("");
ok("validate: empty rejected", !vEmpty.ok && vEmpty.code === "empty");
const vBlank = validateDispatchMessage("   \n  ");
ok("validate: blank rejected", !vBlank.ok && vBlank.code === "empty");
const vNull = validateDispatchMessage(null);
ok("validate: null rejected", !vNull.ok && vNull.code === "empty");
const vGood = validateDispatchMessage("  Where's the shutoff?  ");
ok("validate: trims + ok", vGood.ok && vGood.value === "Where's the shutoff?");
const vLong = validateDispatchMessage("x".repeat(MAX_DISPATCH_MESSAGE_LEN + 1));
ok("validate: too long rejected", !vLong.ok && vLong.code === "too_long");
const vMax = validateDispatchMessage("x".repeat(MAX_DISPATCH_MESSAGE_LEN));
ok("validate: at ceiling ok", vMax.ok);

// --- sender labels ----------------------------------------------------------
ok("tradeLabel: own=You", tradeSenderLabel("trade", "Agile") === "You");
ok("tradeLabel: operator=org", tradeSenderLabel("operator", "Agile") === "Agile");
ok("tradeLabel: operator no-org fallback", tradeSenderLabel("operator", null) === "Owner");
ok("opLabel: own=You", operatorSenderLabel("operator", "Bob Plumbing") === "You");
ok("opLabel: trade=name", operatorSenderLabel("trade", "Bob Plumbing") === "Bob Plumbing");
ok("opLabel: trade no-name fallback", operatorSenderLabel("trade", "  ") === "Trade");

// --- excerpt ----------------------------------------------------------------
ok("excerpt: short unchanged", messageExcerpt("Hi there") === "Hi there");
ok("excerpt: collapses ws", messageExcerpt("a\n\n  b") === "a b");
ok("excerpt: empty", messageExcerpt("") === "" && messageExcerpt(null) === "");
ok(
  "excerpt: ellipsizes at max",
  (() => {
    const out = messageExcerpt("y".repeat(200), 10);
    return out.length === 10 && out.endsWith("…");
  })(),
);

// --- awaitsOperatorReply ----------------------------------------------------
const mk = (sender: "trade" | "operator", i: number): DispatchMessage => ({
  id: String(i),
  sender,
  body: "m" + i,
  created_at: new Date(2026, 0, i + 1).toISOString(),
});
ok("awaits: empty no", !awaitsOperatorReply([]));
ok("awaits: last trade yes", awaitsOperatorReply([mk("operator", 0), mk("trade", 1)]));
ok("awaits: last operator no", !awaitsOperatorReply([mk("trade", 0), mk("operator", 1)]));

// --- summary ----------------------------------------------------------------
if (failed === 0) console.log(`✓ dispatch-messages: ${passed} passed`);
else {
  console.error(`✗ dispatch-messages: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
