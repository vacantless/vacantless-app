// S738 the helper's ad list, chat reply and link capture. Run: npx tsx scripts/test-helper-ad-list.ts
import { readFileSync } from "node:fs";
import {
  cleanCapturedAds,
  fillHelperReply,
  helperReplyTemplate,
  helperVersionOk,
  isHelperMessage,
  marketplaceItemIdFrom,
  shortRentalName,
  versionAtLeast,
  MARKETPLACE_HELPER_AD_LIST_MIN_VERSION,
} from "@/lib/marketplace-helper";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

ok("1.0.0 still fills", helperVersionOk("1.0.0"));
ok("1.0.0 has no ad list", !versionAtLeast("1.0.0", MARKETPLACE_HELPER_AD_LIST_MIN_VERSION));
ok("1.1.0 has the ad list", versionAtLeast("1.1.0", MARKETPLACE_HELPER_AD_LIST_MIN_VERSION));
ok("1.10.0 beats 1.9.0", versionAtLeast("1.10.0", "1.9.0"));

ok("item id from ad link", marketplaceItemIdFrom("https://www.facebook.com/marketplace/item/1122221810762451/?ref=x") === "1122221810762451");
ok("no item id on a Page post", marketplaceItemIdFrom("https://www.facebook.com/1237906646071726_122114463033419814") === null);

ok("short name keeps the unit", shortRentalName("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4") === "833 Pillette Rd, Unit 3");
ok("short name, no unit", shortRentalName("88 Lakeview Ave, Windsor, ON") === "88 Lakeview Ave");
ok("short name, empty", shortRentalName(null) === "Your rental");

const link = "https://app.vacantless.com/r/abc?p=post1";
const t = helperReplyTemplate({ available: true, bookingUrl: link, phone: null });
ok("Tess gets her name and the tracked link", fillHelperReply(t, "Tess G") === `Hi Tess, yes it is still available. You can pick a viewing time here: ${link}`, fillHelperReply(t, "Tess G"));
ok("no name reads Hi,", fillHelperReply(t, "").startsWith("Hi, yes it is still available."), fillHelperReply(t, ""));
ok("odd name falls back", fillHelperReply(t, "🙂🙂").startsWith("Hi, yes"));
ok("phone line when the account has one", /also call 519-555-0100\.$/.test(helperReplyTemplate({ available: true, bookingUrl: link, phone: "519-555-0100" })));
const rented = fillHelperReply(helperReplyTemplate({ available: false, bookingUrl: link }), "Sandra");
ok("rented says so, no link", rented === "Hi Sandra, thanks for asking. This one is rented now.", rented);
ok("no em dash anywhere", ![t, rented].some((s) => s.includes("—")));

const uuid = "15a8a7de-271f-4348-9fee-b5a664a4e439";
const c = cleanCapturedAds([
  { itemId: "1469392998385509", propertyId: uuid },
  { itemId: "1469392998385509", propertyId: uuid },
  { itemId: "abc", propertyId: uuid },
  { itemId: "1465666292074489", propertyId: "not-a-uuid" },
  null,
]);
ok("captured: one clean, no repeats", c.length === 1 && c[0].itemId === "1469392998385509", c);
ok("captured: not a list", cleanCapturedAds("x").length === 0);
ok("captured: at most 10", cleanCapturedAds(Array.from({ length: 30 }, (_, i) => ({ itemId: String(1000000 + i), propertyId: uuid }))).length === 10);

ok("helper message check", isHelperMessage({ source: "vacantless-helper", type: "captured_ads" }, "captured_ads"));
ok("page's own message is not the helper", !isHelperMessage({ source: "vacantless-app", type: "captured_ads" }, "captured_ads"));

// Wiring.
const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
ok("every dashboard page syncs the helper", layout.includes("<MarketplaceHelperSync loadAds={helperAdList} saveCaptured={helperSaveCapturedAds}"));
const actions = readFileSync("app/dashboard/marketplace-helper-actions.ts", "utf8");
ok("actions check the signed-in person", actions.includes("auth.getUser()") && actions.includes("helperOrgIds("));
ok("captured input is cleaned first", actions.indexOf("cleanCapturedAds(raw)") < actions.indexOf("signedInOrgIds()", actions.indexOf("helperSaveCapturedAds")));
const server = readFileSync("lib/marketplace-helper-server.ts", "utf8");
ok("only accounts the person manages", server.includes('roleCan(m.role, "manage_properties")'));
ok("a rental outside them is skipped", server.includes("!orgIds.includes(orgId)"));
ok("an ad already saved is not saved twice", server.includes("/marketplace/item/${item.itemId}"));

console.log(`helper-ad-list: ${p} passed, ${f} failed`);
if (f) process.exit(1);
