// Unit tests for co-pilot reservation detection (S681).
// Run: npx tsx scripts/test-listing-post-reservations.ts
//
// The defect these lock down: a reserved listing_posts row is HIDDEN from the
// where-posted tracker but was COUNTED by hardDeletable, so a property that
// entered the co-pilot could never be deleted and no control existed to fix it.
import {
  isUnpostedDraft,
  reservedListingPostIds,
  visibleListingPostCount,
  loadReservedListingPostIds,
} from "../lib/listing-post-reservations";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const reservation = { id: "res-1", status: "draft", url: null };
const handDraft = { id: "hand-1", status: "draft", url: null };
const livePost = { id: "live-1", status: "live", url: "https://kijiji.ca/ad/1" };
const blankUrlDraft = { id: "res-2", status: "draft", url: "   " };

// --- isUnpostedDraft -------------------------------------------------------
ok("draft with null url is an unposted draft", isUnpostedDraft(reservation));
ok("draft with whitespace url is an unposted draft", isUnpostedDraft(blankUrlDraft));
ok("live post with a url is not", !isUnpostedDraft(livePost));
ok(
  "draft that carries a real url is not",
  !isUnpostedDraft({ id: "x", status: "draft", url: "https://x.test/a" }),
);
ok(
  "null status is not",
  !isUnpostedDraft({ id: "x", status: null, url: null }),
);

// --- reservedListingPostIds ------------------------------------------------
{
  const reserved = reservedListingPostIds(
    [reservation, handDraft, livePost],
    ["res-1"],
  );
  ok("run-item-referenced draft is reserved", reserved.has("res-1"));
  ok(
    "hand-made url-less draft with no run item stays visible",
    !reserved.has("hand-1"),
  );
  ok("live post is never reserved", !reserved.has("live-1"));
  ok("only the one row is reserved", reserved.size === 1);
}

ok(
  "a referenced LIVE post is not reserved (safety guard must keep biting)",
  !reservedListingPostIds([livePost], ["live-1"]).has("live-1"),
);

ok(
  "null listing_post_id references are ignored",
  reservedListingPostIds([reservation], [null]).size === 0,
);

// --- visibleListingPostCount ----------------------------------------------
{
  const posts = [reservation, handDraft, livePost];
  const reserved = reservedListingPostIds(posts, ["res-1"]);
  ok(
    "visible count excludes the reservation only",
    visibleListingPostCount(posts, reserved) === 2,
  );
  ok(
    "a property carrying ONLY reservations counts zero, so it is deletable",
    visibleListingPostCount([reservation], reserved) === 0,
  );
  ok(
    "a property carrying a real post never counts zero",
    visibleListingPostCount([livePost], reserved) === 1,
  );
}

// --- loadReservedListingPostIds -------------------------------------------
void (async () => {
  let calls = 0;
  let sawDraftIds: string[] = [];

  const reserved = await loadReservedListingPostIds(
    [reservation, livePost],
    async (draftIds) => {
      calls++;
      sawDraftIds = draftIds;
      return ["res-1"];
    },
  );
  ok("loader resolves the reserved set", reserved.has("res-1"));
  ok("loader asks about draft ids only", sawDraftIds.join(",") === "res-1");
  ok("loader queried once", calls === 1);

  let skippedCalls = 0;
  const none = await loadReservedListingPostIds([livePost], async () => {
    skippedCalls++;
    return [];
  });
  ok("no url-less draft means no round trip", skippedCalls === 0);
  ok("and an empty reserved set", none.size === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
