// S712: Facebook Marketplace for every org, posted by the org's own team from
// the kit. Pure helpers + wiring checks.
// Run: npx tsx scripts/test-marketplace-kit.ts
import { readFileSync } from "node:fs";
import {
  MARKETPLACE_CREATE_RENTAL_URL,
  agentMarketplaceKitPath,
  marketplaceKitAgents,
  marketplacePhotoFileName,
  marketplacePhotosZipName,
} from "../lib/marketplace-kit";
import { channelShownFor, isHiddenForOrg } from "../lib/posting-lanes";
import { firstRunCostLine } from "../lib/distribution-channels";
import { getNotificationEvent } from "../lib/notifications";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// --- photo names ---
ok("cover first is 01, jpg kept", marketplacePhotoFileName(0, "https://x.supabase.co/storage/v1/object/public/property-photos/a/b.jpg") === "01-photo.jpg");
ok("jpeg becomes jpg", marketplacePhotoFileName(1, "https://x/y/z.JPEG") === "02-photo.jpg");
ok("png kept", marketplacePhotoFileName(9, "https://x/y/z.png") === "10-photo.png");
ok("unknown ext falls back to jpg", marketplacePhotoFileName(2, "https://x/y/z.heic") === "03-photo.jpg");
ok("bad url falls back to jpg", marketplacePhotoFileName(0, "not a url") === "01-photo.jpg");

// --- zip name ---
ok("zip name from address", marketplacePhotosZipName("100 Test Street, Windsor, ON") === "100-test-street-windsor-on-photos.zip");
ok("zip name without address", marketplacePhotosZipName(null) === "rental-photos.zip");

// --- agent kit path ---
ok("agent kit path", agentMarketplaceKitPath("tok", "prop") === "/agent/tok/marketplace/prop");
ok("agent kit path encodes", agentMarketplaceKitPath("a b", "c/d") === "/agent/a%20b/marketplace/c%2Fd");

// --- agents who can be sent the kit ---
const agents = marketplaceKitAgents([
  { id: "1", name: "Odette", email: "o@x.com", archived: false },
  { id: "2", name: "Gone", email: "g@x.com", archived: true },
  { id: "3", name: "No email", email: null, archived: false },
  { id: "4", name: " ", email: "blank@x.com", archived: null },
]);
ok("only active agents with email", agents.map((a) => a.id).join(",") === "1,4");
ok("blank name falls back to email", agents[1]?.name === "blank@x.com");

// --- Marketplace is shown for every org ---
ok("any org sees Marketplace", channelShownFor("facebook", "11111111-1111-1111-1111-111111111111"));
ok("not hidden for another org", !isHiddenForOrg("facebook", "22222222-2222-2222-2222-222222222222"));
ok("cost line says your team posts it", firstRunCostLine("facebook") === "Free. Your team posts it from your own Facebook.");
ok("Marketplace create url", MARKETPLACE_CREATE_RENTAL_URL === "https://www.facebook.com/marketplace/create/rental");

// --- the email event ---
const ev = getNotificationEvent("leasing.marketplace_kit");
ok("marketplace kit event exists and is active", !!ev && ev.active);
ok("event routes to the listing lane", ev?.lane === "listing");
ok("event body carries the kit link", (ev?.defaultBody ?? "").includes("{{kit_url}}"));

// --- wiring ---
const row = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("Marketplace row renders the kit before the desk path", row.indexOf("<MarketplaceRow") > 0 && row.indexOf("<MarketplaceRow") < row.indexOf("requestConciergePublish}"));
const mrow = readFileSync("app/dashboard/properties/[id]/marketplace-row.tsx", "utf8");
ok("landlord saves through addListingPost as a live facebook post", mrow.includes("saveAction={addListingPost}") && mrow.includes('portal: "facebook", status: "live"'));
const send = readFileSync("app/dashboard/properties/[id]/marketplace-actions.ts", "utf8");
ok("send checks capability", send.includes('requireCapability("manage_properties"'));
ok("send scopes rental and agent to the org", (send.match(/\.eq\("organization_id", org\.id\)/g) ?? []).length >= 2);
const agentPage = readFileSync("app/agent/[token]/marketplace/[propertyId]/page.tsx", "utf8");
ok("agent page reads no renter data", !/from\("leads"\)/.test(agentPage));
const ctx = readFileSync("lib/marketplace-kit-server.ts", "utf8");
ok("agent context scopes the rental to the agent's org", ctx.includes('.eq("organization_id", agent.organization_id)'));
ok("archived agent sees nothing", ctx.includes("agent.archived) return null"));
const zip = readFileSync("lib/marketplace-photos-server.ts", "utf8");
ok("zip only fetches our own photo bucket", zip.includes("/storage/v1/object/public/property-photos/"));
const agentActions = readFileSync("app/agent/[token]/marketplace/[propertyId]/actions.ts", "utf8");
ok("agent save re-checks the token", agentActions.includes("loadAgentMarketplaceContext(admin, token, propertyId)"));

console.log(`\nmarketplace-kit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
