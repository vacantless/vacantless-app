// Unit tests for the pure share-readiness checklist.
// Run: npx tsx scripts/test-share-readiness.ts
import {
  buildShareReadiness,
  type ShareReadinessInput,
} from "../lib/share-readiness";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// A fully-ready Live rental with everything in place.
const complete: ShareReadinessInput = {
  status: "available",
  rentCents: 185000,
  beds: 2,
  baths: 1,
  address: "123 Main St",
  photoCount: 4,
  availabilityWindowCount: 3,
  replyToEmail: "rentals@agileonline.ca",
};

function get(input: ShareReadinessInput, key: string) {
  return buildShareReadiness(input).checks.find((c) => c.key === key)!;
}

// --- happy path -------------------------------------------------------------
{
  const r = buildShareReadiness(complete);
  ok("complete: readyToShare", r.readyToShare === true);
  ok("complete: allMet", r.allMet === true);
  ok("complete: no required outstanding", r.requiredOutstanding === 0);
  ok("complete: no recommended outstanding", r.recommendedOutstanding === 0);
  ok("complete: 7 checks", r.checks.length === 7);
  ok("complete: every check ok", r.checks.every((c) => c.ok));
}

// --- live gate --------------------------------------------------------------
{
  const draft = buildShareReadiness({ ...complete, status: "draft" });
  ok("draft: not ready to share", draft.readyToShare === false);
  ok("draft: live check fails", get({ ...complete, status: "draft" }, "live").ok === false);
  ok("draft: live is required", get({ ...complete, status: "draft" }, "live").required === true);
  ok("draft: exactly 1 required outstanding", draft.requiredOutstanding === 1);

  // paused / leased are publicly visible but not bookable, so still "not live".
  ok("paused: live fails", get({ ...complete, status: "paused" }, "live").ok === false);
  ok("leased: live fails", get({ ...complete, status: "leased" }, "live").ok === false);
  ok("available: live ok", get(complete, "live").ok === true);
}

// --- core listing fields ----------------------------------------------------
{
  ok("rent 0 fails", get({ ...complete, rentCents: 0 }, "rent").ok === false);
  ok("rent null fails", get({ ...complete, rentCents: null }, "rent").ok === false);
  ok("rent positive ok", get(complete, "rent").ok === true);

  ok("address blank fails", get({ ...complete, address: "   " }, "address").ok === false);
  ok("address null fails", get({ ...complete, address: null }, "address").ok === false);

  // Studio = 0 beds is a real value, not "missing".
  ok("studio (0 beds) ok", get({ ...complete, beds: 0 }, "beds_baths").ok === true);
  ok("beds null fails", get({ ...complete, beds: null }, "beds_baths").ok === false);
  ok("baths null fails", get({ ...complete, baths: null }, "beds_baths").ok === false);

  // The four core fields are all required.
  for (const key of ["live", "address", "rent", "beds_baths"]) {
    ok(`${key} is required`, get(complete, key).required === true);
  }
}

// --- recommended (non-blocking) checks --------------------------------------
{
  const noPhotos = buildShareReadiness({ ...complete, photoCount: 0 });
  ok("no photos: still ready to share", noPhotos.readyToShare === true);
  ok("no photos: not allMet", noPhotos.allMet === false);
  ok("no photos: photos check fails", get({ ...complete, photoCount: 0 }, "photos").ok === false);
  ok("photos is recommended", get(complete, "photos").required === false);

  const noAvail = buildShareReadiness({ ...complete, availabilityWindowCount: 0 });
  ok("no availability: still ready to share", noAvail.readyToShare === true);
  ok("viewing_times recommended", get(complete, "viewing_times").required === false);
  ok("no availability: viewing check fails", get({ ...complete, availabilityWindowCount: 0 }, "viewing_times").ok === false);

  const noReply = buildShareReadiness({ ...complete, replyToEmail: null });
  ok("no reply-to: still ready to share", noReply.readyToShare === true);
  ok("reply_to recommended", get(complete, "reply_to").required === false);
  ok("blank reply-to fails", get({ ...complete, replyToEmail: "  " }, "reply_to").ok === false);

  ok("3 recommended outstanding when all 3 missing",
    buildShareReadiness({ ...complete, photoCount: 0, availabilityWindowCount: 0, replyToEmail: null }).recommendedOutstanding === 3);
}

// --- empty-rental worst case ------------------------------------------------
{
  const empty = buildShareReadiness({
    status: "draft",
    rentCents: null,
    beds: null,
    baths: null,
    address: null,
    photoCount: 0,
    availabilityWindowCount: 0,
    replyToEmail: null,
  });
  ok("empty: not ready", empty.readyToShare === false);
  ok("empty: 4 required outstanding", empty.requiredOutstanding === 4);
  ok("empty: 3 recommended outstanding", empty.recommendedOutstanding === 3);
  ok("empty: nothing ok", empty.checks.every((c) => !c.ok));
  // Every check carries a non-empty hint to guide the operator.
  ok("every check has a hint", empty.checks.every((c) => c.hint.trim().length > 0));
}

console.log(`\nshare-readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
