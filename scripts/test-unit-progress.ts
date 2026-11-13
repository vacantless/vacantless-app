// Run with: npx tsx scripts/test-unit-progress.ts
// S788b: unit progress stages, who can tap what, current stage.
import { canTap, tapsFor, currentStage, takesAdsDown, cleanNote, isCrewRole, isStage, TAP_ORDER, STAGE_LABEL, cleanDate, stageTakesDate, stageDateLine } from "../lib/unit-progress";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

ok("manager can tap rented", canTap("manager", "rented"));
ok("leasing can tap waiting for deposit", canTap("leasing", "waiting_deposit"));
ok("contractor can tap being cleaned", canTap("contractor", "being_cleaned"));
ok("contractor can tap photos in", canTap("contractor", "photos_in"));
ok("contractor cannot tap rented", !canTap("contractor", "rented"));
ok("contractor cannot tap ready to post", !canTap("contractor", "ready_to_post"));
ok("photographer can tap photos in only", tapsFor("photographer", null).join() === "photos_in");
ok("touch up and live are never tapped", !TAP_ORDER.includes("touch_up") && !TAP_ORDER.includes("live"));
ok("current stage is left out of the buttons", !tapsFor("manager", "being_cleaned").includes("being_cleaned"));
ok("no events: no stage", currentStage([]) === null);
ok("newest event wins", currentStage([
  { stage: "being_cleaned", created_at: "2026-11-13T10:00:00Z" },
  { stage: "under_construction", created_at: "2026-11-01T10:00:00Z" },
  { stage: "photos_in", created_at: "2026-11-14T10:00:00Z" },
]) === "photos_in");
ok("unknown stage ignored", currentStage([{ stage: "bogus", created_at: "2026-11-20T00:00:00Z" }, { stage: "rented", created_at: "2026-11-13T00:00:00Z" }]) === "rented");
ok("rented takes ads down", takesAdsDown("rented") && !takesAdsDown("waiting_deposit"));
ok("note trimmed and capped", cleanNote("  a  b ") === "a b" && (cleanNote("x".repeat(900)) ?? "").length === 500 && cleanNote("   ") === null);
ok("role and stage guards", isCrewRole("contractor") && !isCrewRole("owner") && isStage("rented") && !isStage("done"));
ok("every stage has a label without dashes", Object.values(STAGE_LABEL).every((l) => l.length > 0 && !/[–—]/.test(l)));

// S788c: the rest of the lifecycle and stage dates.
ok("manager can tap notice, lease signed, moved in, on hold", ["notice_given", "lease_signed", "moved_in", "on_hold"].every((st) => canTap("manager", st as never)));
ok("contractor cannot tap notice or moved in", !canTap("contractor", "notice_given") && !canTap("contractor", "moved_in"));
ok("notice comes first, on hold last", TAP_ORDER[0] === "notice_given" && TAP_ORDER[TAP_ORDER.length - 1] === "on_hold");
ok("dated stages", stageTakesDate("notice_given") && stageTakesDate("under_construction") && stageTakesDate("photographer_booked") && !stageTakesDate("rented"));
const now = new Date("2026-11-13T12:00:00Z");
ok("good date kept", cleanDate("2026-12-01", now) === "2026-12-01");
ok("bad dates dropped", cleanDate("2026-13-01", now) === null && cleanDate("12/01/2026", now) === null && cleanDate("", now) === null && cleanDate("2031-01-01", now) === null && cleanDate("2026-02-30", now) === null);
ok("date line", stageDateLine("under_construction", "2026-12-01") === "Ready by Dec 1" && stageDateLine("notice_given", "2027-01-31") === "Moving out Jan 31" && stageDateLine("rented", "2026-12-01") === "");
console.log(`unit-progress: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
