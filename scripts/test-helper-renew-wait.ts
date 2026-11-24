// S809: the helper (1.2.6) reports Facebook's own "Renew (N days)", and the
// reminder waits for that day. Run: npx tsx scripts/test-helper-renew-wait.ts
import { existsSync, readFileSync } from "node:fs";
import {
  cleanRenewWaits,
  renewWaitPostedOn,
  versionAtLeast,
  MARKETPLACE_HELPER_RENEW_WAIT_MIN_VERSION,
} from "@/lib/marketplace-helper";
import { computeChannelStatus, refreshDaysForChannel } from "@/lib/distribution-channels";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

const now = Date.parse("2026-11-17T13:00:00Z");
ok("1.2.5 does not report waits", !versionAtLeast("1.2.5", MARKETPLACE_HELPER_RENEW_WAIT_MIN_VERSION));
ok("1.2.6 does", versionAtLeast("1.2.6", MARKETPLACE_HELPER_RENEW_WAIT_MIN_VERSION));

const clean = cleanRenewWaits([
  { itemId: "1465666292074489", days: 8, at: now - 60_000 },
  { itemId: "1465666292074489", days: 7, at: now - 30_000 }, // newer reading wins
  { itemId: "abc", days: 7, at: now },
  { itemId: "1111111111", days: 0, at: now },
  { itemId: "2222222222", days: 61, at: now },
  { itemId: "3333333333", days: 2.5, at: now },
  { itemId: "4444444444", days: 3, at: now - 8 * 86_400_000 },
  { itemId: "5555555555", days: 3, at: now + 60 * 60_000 },
  null,
], now);
ok("keeps one reading per ad, the latest", clean.length === 1 && clean[0].days === 7, clean);
ok("not a list -> nothing", cleanRenewWaits("x", now).length === 0);

const fb = refreshDaysForChannel("facebook");
ok("S838: Facebook refreshes at 7 days", fb === 7);
// Pillette Unit 3 on 2026-11-17: posted 11-08 in Vacantless, Facebook says Renew in 7 days.
const moved = renewWaitPostedOn("2026-11-08", "2026-11-17", 7, fb);
ok("Unit 3: posted date moves so it is due when Renew opens", moved === "2026-11-17", moved);
const status = computeChannelStatus({ linkIsLive: true, blockers: [], channel: "facebook", today: "2026-11-17", posts: [{ status: "live", url: "https://www.facebook.com/marketplace/item/1", posted_on: moved, inquiryCount: 0 }] } as never);
ok("Unit 3 no longer reads as needing a refresh today", status.value === "posted", status);
const due = computeChannelStatus({ linkIsLive: true, blockers: [], channel: "facebook", today: "2026-11-24", posts: [{ status: "live", url: "https://www.facebook.com/marketplace/item/1", posted_on: moved, inquiryCount: 0 }] } as never);
ok("and needs it on 2026-11-24, the day Facebook opens Renew", due.value === "needs_refresh", due);
ok("never backwards", renewWaitPostedOn("2026-11-16", "2026-11-17", 5, fb) === null);
ok("never after the day it was seen", renewWaitPostedOn("2026-11-01", "2026-11-17", 30, fb) === "2026-11-17");
ok("blank posted date gets the implied day", renewWaitPostedOn(null, "2026-11-17", 9, fb) === "2026-11-17");
ok("no refresh rule -> no change", renewWaitPostedOn("2026-11-01", "2026-11-17", 7, null) === null);
ok("bad day -> no change", renewWaitPostedOn("2026-11-01", "17 Nov", 7, fb) === null);

const sync = readFileSync("components/marketplace-helper-sync.tsx", "utf8");
ok("asks only a 1.2.6 helper", sync.includes('versionAtLeast(data.version, MARKETPLACE_HELPER_RENEW_WAIT_MIN_VERSION)) post({ type: "get_renew_waits" })'));
ok("tells the helper what to forget", sync.includes('post({ type: "renew_waits_saved", itemIds: done })'));
ok("layout wires it", readFileSync("app/dashboard/layout.tsx", "utf8").includes("saveRenewWaits={helperSaveRenewWaits}"));
const server = readFileSync("lib/marketplace-helper-server.ts", "utf8");
ok("server only touches live Facebook ads in the person's accounts", /saveHelperRenewWaits[\s\S]*\.in\("organization_id", orgIds\)[\s\S]*\.eq\("portal", "facebook"\)[\s\S]*\.eq\("status", "live"\)/.test(server));

// The helper half, when the extension folder sits beside the app (Noam's Mac).
const ext = "../vacantless-extension";
if (existsSync(`${ext}/facebook-watch.js`)) {
  const watch = readFileSync(`${ext}/facebook-watch.js`, "utf8");
  const bridge = readFileSync(`${ext}/app-bridge.js`, "utf8");
  const config = readFileSync(`${ext}/config.js`, "utf8");
  ok("helper notes the wait only for an available ad Facebook greys out", watch.includes("if (entry.available && state && !state.now && state.days) noteRenewWait(found.itemId, state.days);"));
  ok("helper reads only the menu on screen (S775)", watch.includes(".filter((m) => m.getClientRects().length > 0)"));
  ok("bridge answers get_renew_waits and forgets saved ones", bridge.includes('data.type === "get_renew_waits"') && bridge.includes('data.type === "renew_waits_saved"'));
  // S828x: 1.2.7 keeps the renew-wait report.
  ok("helper version is 1.2.6 or later", /VERSION: "1\.2\.([6-9]|\d\d)"/.test(config) && /"version": "1\.2\.([6-9]|\d\d)"/.test(readFileSync(`${ext}/manifest.json`, "utf8")));
}

console.log(`helper-renew-wait: ${p} passed, ${f} failed`);
if (f) process.exit(1);
