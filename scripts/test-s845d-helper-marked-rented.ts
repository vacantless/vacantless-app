// Run with: npx tsx scripts/test-s845d-helper-marked-rented.ts
// S845d: helper 1.2.8 reports the landlord's own "Mark as rented" press.
import { MARKETPLACE_HELPER_MARKED_RENTED_MIN_VERSION, markedRentedNote, versionAtLeast } from "../lib/marketplace-helper";
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
ok("min version", MARKETPLACE_HELPER_MARKED_RENTED_MIN_VERSION === "1.2.8" && versionAtLeast("1.2.8", "1.2.8") && !versionAtLeast("1.2.7", "1.2.8"));
ok("note names who and how", markedRentedNote("2026-11-26").includes("by the landlord on 2026-11-26"));
const server = readFileSync("lib/marketplace-helper-server.ts", "utf8");
const fn = server.slice(server.indexOf("export async function saveHelperMarkedRented"));
ok("only a rental that is off the market", fn.includes("isUnavailableStatus(p.status) || !!p.archived_at"));
ok("only a live Marketplace ad", fn.includes('.eq("portal", "facebook")') && fn.includes('.eq("status", "live")'));
ok("closes the takedown item", fn.includes("closeTakedownItems(") && fn.includes("resetLiveRunItemsForPost("));
const sync = readFileSync("components/marketplace-helper-sync.tsx", "utf8");
ok("page asks 1.2.8+ helpers", sync.includes('post({ type: "get_marked_rented" })') && sync.includes("MARKETPLACE_HELPER_MARKED_RENTED_MIN_VERSION"));
ok("page tells the helper what to forget", sync.includes('post({ type: "marked_rented_saved", itemIds: done })'));
ok("layout wires it", readFileSync("app/dashboard/layout.tsx", "utf8").includes("saveMarkedRented={helperSaveMarkedRented}"));

// The helper lives beside the app on Noam's Mac; in CI it is not there.
const ext = "../vacantless-extension/facebook-watch.js";
if (existsSync(ext)) {
  const watch = readFileSync(ext, "utf8");
  const part = watch.slice(watch.indexOf("---- 9. the landlord's own"), watch.indexOf("---- 5. an ad Facebook removed"));
  ok("helper only listens (no click call)", part.length > 200 && !/\.click\(\)/.test(part));
  ok("helper notes only rented rentals", part.includes("if (entry && !entry.available) noteMarkedRented(itemId);"));
  ok("the press-for-me switch starts off", watch.includes("let autoMarkRented = false;") && watch.includes("got[C.AUTO_MARK_RENTED_KEY] === true"));
  ok("it presses only a rented rental's own ad, once", watch.includes("if (!autoMarkRented || autoPressed.has(itemId)) return;") && watch.includes("if (!entry || entry.available || itemIdFrom(location.pathname) !== itemId) return;"));
  ok("the note says how to turn it off", watch.includes("Off unless you tick it. Untick it here any time."));
  const bridge = readFileSync("../vacantless-extension/app-bridge.js", "utf8");
  ok("bridge answers the page", bridge.includes('data.type === "get_marked_rented"') && bridge.includes('type: "marked_rented_ads"'));
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
