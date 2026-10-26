// S739 the helper reports Facebook renewals. Run: npx tsx scripts/test-helper-renew.ts
import { readFileSync } from "node:fs";
import {
  cleanRenewedAds,
  renewedPostedOn,
  versionAtLeast,
  MARKETPLACE_HELPER_RENEW_MIN_VERSION,
} from "@/lib/marketplace-helper";
import { localDateString } from "@/lib/leasing-snapshot";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

const now = Date.parse("2026-10-28T14:00:00Z");
ok("1.1.0 does not report renewals", !versionAtLeast("1.1.0", MARKETPLACE_HELPER_RENEW_MIN_VERSION));
ok("1.2.0 does", versionAtLeast("1.2.0", MARKETPLACE_HELPER_RENEW_MIN_VERSION));

const clean = cleanRenewedAds([
  { itemId: "1465666292074489", at: now - 60_000 },
  { itemId: "1465666292074489", at: now - 30_000 }, // duplicate
  { itemId: "abc", at: now },
  { itemId: "1122221810762451", at: now - 8 * 86_400_000 }, // too old
  { itemId: "1469392998385509", at: now + 60 * 60_000 }, // future
  null,
], now);
ok("keeps one good report", clean.length === 1 && clean[0].itemId === "1465666292074489", clean);
ok("not a list", cleanRenewedAds("x", now).length === 0);

ok("moves forward", renewedPostedOn("2026-10-19", "2026-10-28") === "2026-10-28");
ok("never backwards", renewedPostedOn("2026-10-28", "2026-10-27") === null);
ok("same day is a no-op", renewedPostedOn("2026-10-28", "2026-10-28") === null);
ok("empty posted date takes the day", renewedPostedOn(null, "2026-10-28") === "2026-10-28");
ok("bad day refused", renewedPostedOn("2026-10-19", "Oct 28") === null);
ok("late evening Toronto stays the same day", localDateString(Date.parse("2026-10-29T02:30:00Z"), "America/Toronto") === "2026-10-28");

const server = readFileSync("lib/marketplace-helper-server.ts", "utf8");
ok("only live Facebook ads", /saveHelperRenewedAds[\s\S]*\.eq\("portal", "facebook"\)[\s\S]*\.eq\("status", "live"\)/.test(server));
ok("only this person's accounts", /saveHelperRenewedAds[\s\S]*\.in\("organization_id", orgIds\)/.test(server));
const actions = readFileSync("app/dashboard/marketplace-helper-actions.ts", "utf8");
ok("action cleans first", actions.includes("const items = cleanRenewedAds(raw);"));
const sync = readFileSync("components/marketplace-helper-sync.tsx", "utf8");
ok("asks only a 1.2.0 helper", sync.includes('versionAtLeast(data.version, MARKETPLACE_HELPER_RENEW_MIN_VERSION)) post({ type: "get_renewed" })'));
ok("tells the helper what to forget", sync.includes('post({ type: "renewed_saved", itemIds: done })'));
const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
ok("layout wires it", layout.includes("saveRenewed={helperSaveRenewedAds}"));

console.log(`helper-renew: ${p} passed, ${f} failed`);
if (f) process.exit(1);
