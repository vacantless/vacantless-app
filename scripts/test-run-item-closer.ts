// Run with: npx tsx scripts/test-run-item-closer.ts
// S728: which distribution_run_items are closed as bookkeeping.
import { runItemsToClose, STALE_WAIT_DAYS } from "../lib/run-item-closer";

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

console.log(`run-item-closer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
