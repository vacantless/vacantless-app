// Run with: npx tsx scripts/test-run-item-closer.ts
// S728: which distribution_run_items are closed as bookkeeping.
import { runItemsToClose, STALE_WAIT_DAYS, supersededItems, SUPERSEDED_REASON } from "../lib/run-item-closer";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const now = Date.parse("2026-10-21T00:00:00Z");
const day = 24 * 3_600_000;
const row = (o: Partial<Parameters<typeof runItemsToClose>[0][number]>) => ({
  id: "x",
  publish_status: "live",
  updated_at: new Date(now - day).toISOString(),
  listing_post: { status: "live" },
  run: { property: { status: "available" } },
  ...o,
});

ok("live ad on an available unit stays", runItemsToClose([row({})], now).length === 0);
ok("live item, expired record, available unit stays (the live check decides)", runItemsToClose([row({ listing_post: { status: "expired" } })], now).length === 0);
ok("live item, removed record, leased unit closes", runItemsToClose([row({ listing_post: { status: "removed" }, run: { property: { status: "leased" } } })], now).length === 1);
ok("live item, expired record, off-market unit closes", runItemsToClose([row({ listing_post: { status: "expired" }, run: { property: { status: "off_market" } } })], now).length === 1);
ok("live item, live record, leased unit stays (paid ads stay up)", runItemsToClose([row({ run: { property: { status: "leased" } } })], now).length === 0);
ok("needs_login for a week stays", runItemsToClose([row({ publish_status: "needs_login", updated_at: new Date(now - 7 * day).toISOString() })], now).length === 0);
ok(`needs_login for ${STALE_WAIT_DAYS + 1} days closes`, runItemsToClose([row({ publish_status: "needs_login", updated_at: new Date(now - (STALE_WAIT_DAYS + 1) * day).toISOString() })], now).length === 1);
ok("needs_payment for 60 days closes", runItemsToClose([row({ publish_status: "needs_payment", updated_at: new Date(now - 60 * day).toISOString() })], now).length === 1);
ok("skipped stays skipped", runItemsToClose([row({ publish_status: "skipped", updated_at: new Date(now - 90 * day).toISOString() })], now).length === 0);
ok("reason names the wait", runItemsToClose([row({ publish_status: "needs_login", updated_at: new Date(now - 40 * day).toISOString() })], now)[0].reason.includes("login"));
ok("array-shaped relations read too", runItemsToClose([row({ listing_post: [{ status: "removed" }], run: [{ property: [{ status: "leased" }] }] })], now).length === 1);

// S788 (W9): an old ad record replaced by a newer verified-live ad on the same site.
const sup = (o: Partial<Parameters<typeof supersededItems>[0][number]>) => ({
  id: "old",
  channel: "kijiji",
  publish_status: "live",
  verification_status: "stale",
  external_url: "https://www.kijiji.ca/v/1744721877",
  listing_post: { status: "removed" },
  run: { property_id: "p1" },
  ...o,
});
const fresh = sup({ id: "new", verification_status: "verified_live", external_url: "https://www.kijiji.ca/v/1746104811", listing_post: { status: "live" } });
ok("Pillette 3: two old Kijiji records close, the new one stays", (() => {
  const r = supersededItems([sup({ id: "a" }), sup({ id: "b" }), fresh]);
  return r.length === 2 && r.every((x) => x.id !== "new" && x.reason === SUPERSEDED_REASON);
})());
ok("no newer verified ad on the site: stays (Glenrose, Unit 33)", supersededItems([sup({})]).length === 0);
ok("newer ad on a different site does not count", supersededItems([sup({}), { ...fresh, channel: "zumper" }]).length === 0);
ok("newer ad on a different rental does not count", supersededItems([sup({}), { ...fresh, run: { property_id: "p2" } }]).length === 0);
ok("old record whose ad record is still live stays", supersededItems([sup({ listing_post: { status: "live" } }), fresh]).length === 0);
ok("old record the checker still sees live stays", supersededItems([sup({ verification_status: "verified_live" }), fresh]).length === 0);
ok("same link as the verified record stays (that path is the tracker's)", supersededItems([sup({ external_url: fresh.external_url }), fresh]).length === 0);
ok("not_found counts like stale", supersededItems([sup({ verification_status: "not_found", listing_post: { status: "expired" } }), fresh]).length === 1);
ok("array-shaped relations read too", supersededItems([sup({ listing_post: [{ status: "removed" }], run: [{ property_id: "p1" }] }), fresh]).length === 1);
ok("a verified record without a link closes nothing", supersededItems([sup({}), { ...fresh, external_url: null }]).length === 0);

console.log(`run-item-closer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
