// Unit tests for the pure work-order-dispatch domain model (Option B Slice 5).
// Run: npx tsx scripts/test-work-order-dispatch.ts
import {
  DISPATCH_STATUSES,
  isDispatchStatus,
  ACTIVE_DISPATCH_STATUSES,
  isActiveDispatchStatus,
  isTerminalDispatchStatus,
  dispatchStatusLabel,
  dispatchStatusTone,
  canAccept,
  canDecline,
  canQuote,
  canApproveSchedule,
  canComplete,
  canCancel,
  tradeActionsFor,
  generateDispatchToken,
  DISPATCH_TOKEN_TTL_DAYS,
  dispatchTokenExpiry,
  isDispatchTokenExpired,
  validateDispatchQuote,
  validateScheduleConfirmation,
  normalizeOperatorNote,
  MAX_QUOTE_CENTS,
  MAX_OPERATOR_NOTE_LEN,
  formatDispatchQuote,
  formatDispatchDate,
  tradeStatusHeadline,
  tradeJobPath,
  tradeJobUrl,
  dispatchErrorMessage,
  tradeDispatchErrorMessage,
} from "../lib/work-order-dispatch";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Status set -------------------------------------------------------------
ok("statuses: 7 states", DISPATCH_STATUSES.length === 7);
ok("isDispatchStatus: known", isDispatchStatus("quoted"));
ok("isDispatchStatus: unknown", !isDispatchStatus("paid"));
ok("isDispatchStatus: non-string", !isDispatchStatus(42));

// active vs terminal
ok("active: offered", isActiveDispatchStatus("offered"));
ok("active: accepted", isActiveDispatchStatus("accepted"));
ok("active: quoted", isActiveDispatchStatus("quoted"));
ok("active: scheduled", isActiveDispatchStatus("scheduled"));
ok("active: NOT completed", !isActiveDispatchStatus("completed"));
ok("active: NOT declined", !isActiveDispatchStatus("declined"));
ok("active: NOT cancelled", !isActiveDispatchStatus("cancelled"));
ok("active set length 4", ACTIVE_DISPATCH_STATUSES.length === 4);
ok("terminal: completed", isTerminalDispatchStatus("completed"));
ok("terminal: declined", isTerminalDispatchStatus("declined"));
ok("terminal: cancelled", isTerminalDispatchStatus("cancelled"));
ok("terminal: NOT offered", !isTerminalDispatchStatus("offered"));
// every status is exactly one of active/terminal
ok(
  "partition: active XOR terminal covers all",
  DISPATCH_STATUSES.every(
    (s) => isActiveDispatchStatus(s) !== isTerminalDispatchStatus(s),
  ),
);

// labels + tones
ok("label: quoted", dispatchStatusLabel("quoted") === "Quote submitted");
ok("label: unknown passthrough", dispatchStatusLabel("weird") === "weird");
ok("tone: completed green", dispatchStatusTone("completed") === "green");
ok("tone: declined red", dispatchStatusTone("declined") === "red");
ok("tone: quoted amber", dispatchStatusTone("quoted") === "amber");
ok("tone: unknown gray", dispatchStatusTone("weird") === "gray");

// --- Transition predicates --------------------------------------------------
ok("accept: only offered", canAccept("offered") && !canAccept("accepted"));
ok("decline: only offered", canDecline("offered") && !canDecline("quoted"));
ok("quote: accepted", canQuote("accepted"));
ok("quote: revise while quoted", canQuote("quoted"));
ok("quote: NOT offered", !canQuote("offered"));
ok("quote: NOT scheduled", !canQuote("scheduled"));
ok("approveSchedule: only quoted", canApproveSchedule("quoted") && !canApproveSchedule("accepted"));
ok("complete: only scheduled", canComplete("scheduled") && !canComplete("quoted"));
ok("cancel: any active", canCancel("offered") && canCancel("scheduled"));
ok("cancel: NOT terminal", !canCancel("completed") && !canCancel("declined") && !canCancel("cancelled"));

// trade actions per state
ok("tradeActions offered: accept+decline", JSON.stringify(tradeActionsFor("offered")) === JSON.stringify(["accept", "decline"]));
ok("tradeActions accepted: quote", JSON.stringify(tradeActionsFor("accepted")) === JSON.stringify(["quote"]));
ok("tradeActions quoted: revise", JSON.stringify(tradeActionsFor("quoted")) === JSON.stringify(["revise_quote"]));
ok("tradeActions scheduled: none", tradeActionsFor("scheduled").length === 0);
ok("tradeActions completed: none", tradeActionsFor("completed").length === 0);

// --- Token ------------------------------------------------------------------
const t1 = generateDispatchToken();
const t2 = generateDispatchToken();
ok("token: url-safe", /^[A-Za-z0-9_-]+$/.test(t1));
ok("token: long enough", t1.length >= 32);
ok("token: unique", t1 !== t2);

ok("ttl: 60 days", DISPATCH_TOKEN_TTL_DAYS === 60);
const base = new Date("2026-06-23T12:00:00Z");
const exp = dispatchTokenExpiry(base);
ok(
  "expiry: base + 60d",
  exp.getTime() === base.getTime() + 60 * 86_400_000,
);
ok("expired: past date", isDispatchTokenExpired("2020-01-01T00:00:00Z", base));
ok("expired: future not expired", !isDispatchTokenExpired(exp, base));
ok("expired: null -> true", isDispatchTokenExpired(null, base));
ok("expired: garbage -> true", isDispatchTokenExpired("not-a-date", base));
ok("expired: exactly now -> true (<=)", isDispatchTokenExpired(base, base));

// --- validateDispatchQuote --------------------------------------------------
const q1 = validateDispatchQuote({ quoteCents: 25000, note: "  parts + labor ", proposedDate: "2026-07-01" });
ok("quote ok: basic", q1.ok === true);
if (q1.ok) {
  ok("quote ok: cents", q1.value.quoteCents === 25000);
  ok("quote ok: note trimmed", q1.value.note === "parts + labor");
  ok("quote ok: date", q1.value.proposedDate === "2026-07-01");
}
const q0 = validateDispatchQuote({ quoteCents: 0 });
ok("quote ok: zero allowed (free/warranty)", q0.ok === true);
const qBlank = validateDispatchQuote({ quoteCents: 5000, note: "  ", proposedDate: "" });
ok("quote ok: blank note -> null", qBlank.ok && qBlank.value.note === null);
ok("quote ok: blank date -> null", qBlank.ok && qBlank.value.proposedDate === null);
ok("quote: null cents rejected", validateDispatchQuote({ quoteCents: null }).ok === false);
ok("quote: negative rejected", validateDispatchQuote({ quoteCents: -1 }).ok === false);
ok("quote: NaN rejected", validateDispatchQuote({ quoteCents: NaN }).ok === false);
ok("quote: over ceiling rejected", validateDispatchQuote({ quoteCents: MAX_QUOTE_CENTS + 1 }).ok === false);
ok("quote: at ceiling allowed", validateDispatchQuote({ quoteCents: MAX_QUOTE_CENTS }).ok === true);
const qLong = validateDispatchQuote({ quoteCents: 100, note: "x".repeat(2001) });
ok("quote: note too long", qLong.ok === false && qLong.code === "note_too_long");
const qBadDate = validateDispatchQuote({ quoteCents: 100, proposedDate: "07/01/2026" });
ok("quote: bad date format rejected", qBadDate.ok === false && qBadDate.code === "bad_date");
ok("quote: cents rounded", (validateDispatchQuote({ quoteCents: 1250.7 }) as { ok: true; value: { quoteCents: number } }).value.quoteCents === 1251);

// --- validateScheduleConfirmation -------------------------------------------
const s1 = validateScheduleConfirmation({ scheduledFor: "2026-07-02" });
ok("schedule ok", s1.ok === true && s1.value.scheduledFor === "2026-07-02");
ok("schedule: blank rejected", validateScheduleConfirmation({ scheduledFor: "" }).ok === false);
ok("schedule: null rejected", validateScheduleConfirmation({ scheduledFor: null }).ok === false);
const sBad = validateScheduleConfirmation({ scheduledFor: "2026-13-99" });
ok("schedule: invalid date rejected", sBad.ok === false && sBad.code === "bad_date");

// --- normalizeOperatorNote --------------------------------------------------
ok("note: blank -> null", normalizeOperatorNote("   ") === null);
ok("note: null -> null", normalizeOperatorNote(null) === null);
ok("note: trims", normalizeOperatorNote("  hi  ") === "hi");
ok("note: caps length", (normalizeOperatorNote("x".repeat(MAX_OPERATOR_NOTE_LEN + 50)) ?? "").length === MAX_OPERATOR_NOTE_LEN);

// --- formatting -------------------------------------------------------------
ok("formatQuote: cents", formatDispatchQuote(25000) === "$250.00");
ok("formatQuote: null dash", formatDispatchQuote(null) === "—");
ok("formatDate: passthrough null", formatDispatchDate(null) === "—" || formatDispatchDate(null) === "");
ok("headline: offered", tradeStatusHeadline("offered").length > 0);
ok("headline: scheduled mentions booked", /booked/i.test(tradeStatusHeadline("scheduled")));
ok("headline: unknown empty", tradeStatusHeadline("weird") === "");

// --- link builders ----------------------------------------------------------
ok("path: encodes token", tradeJobPath("a/b c") === "/job/a%2Fb%20c");
ok("url: strips trailing slash", tradeJobUrl("https://x.com/", "tok") === "https://x.com/job/tok");
ok("url: no trailing slash", tradeJobUrl("https://x.com", "tok") === "https://x.com/job/tok");

// --- error messages ---------------------------------------------------------
ok("err: undefined -> null", dispatchErrorMessage(undefined) === null);
ok("err: locked premium", /Premium/i.test(dispatchErrorMessage("locked") ?? ""));
ok("err: no_email", /email/i.test(dispatchErrorMessage("no_email") ?? ""));
ok("err: active_exists", /active dispatch/i.test(dispatchErrorMessage("active_exists") ?? ""));
ok("err: dispatched success", /dispatched/i.test(dispatchErrorMessage("dispatched") ?? ""));
ok("err: unknown -> null", dispatchErrorMessage("xyz") === null);
ok("trade err: expired", /expired/i.test(tradeDispatchErrorMessage("expired")));
ok("trade err: wrong_state", /moved on/i.test(tradeDispatchErrorMessage("wrong_state")));
ok("trade err: default", tradeDispatchErrorMessage("zzz").length > 0);

// ---------------------------------------------------------------------------
console.log(`\nwork-order-dispatch: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
