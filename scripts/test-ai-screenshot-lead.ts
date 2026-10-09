// Run with: npx tsx scripts/test-ai-screenshot-lead.ts
// S702: add a renter from a chat screenshot.
import { readFileSync } from "node:fs";
import {
  SCREENSHOT_MAX_BYTES,
  buildScreenshotPrompt,
  checkScreenshot,
  screenshotSource,
} from "../lib/ai-screenshot-lead";
import { normalizeEnquiryRead } from "../lib/ai-enquiry";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

ok("missing file", checkScreenshot(null).ok === false);
ok("empty file", checkScreenshot({ type: "image/png", size: 0 }).ok === false);
ok("pdf refused", checkScreenshot({ type: "application/pdf", size: 10 }).ok === false);
ok("too big", checkScreenshot({ type: "image/png", size: SCREENSHOT_MAX_BYTES + 1 }).ok === false);
ok("png ok", checkScreenshot({ type: "image/png", size: 1000 }).ok === true);
ok("jpeg ok", checkScreenshot({ type: "image/jpeg", size: 1000 }).ok === true);

const rentals = [{ id: "p1", address: "12 Elm St", rentDollars: 1500, beds: 2 }];
const prompt = buildScreenshotPrompt(rentals);
ok("prompt lists rental id", prompt.includes("id p1: 12 Elm St"));
ok("prompt asks for site", prompt.includes('"site"'));

ok("source with site", screenshotSource("Facebook Marketplace") === "Facebook Marketplace (screenshot)");
ok("source without site", screenshotSource("") === "Screenshot");

const r = normalizeEnquiryRead(
  { is_enquiry: true, confidence: 0.9, name: "Dana", phone: "519 555 1234", rental_id: "nope", site: "Kijiji" },
  rentals,
);
ok("unknown rental dropped", r?.rentalId === null);
ok("phone kept", r?.phone === "519 555 1234");

const actions = readFileSync("app/dashboard/leads/screenshot-actions.ts", "utf8");
ok("actions check capability", (actions.match(/requireCapability\("manage_leads"/g) ?? []).length === 2);
ok("rental checked against org", actions.includes('.eq("organization_id", org!.id)'));
ok("needs phone or email", actions.includes("need_contact"));
ok("no message sent to renter", !/sendAutoReply|sendSms/.test(actions));
const page = readFileSync("app/dashboard/leads/page.tsx", "utf8");
ok("card on leads page", page.includes("<ScreenshotLeadCard"));

console.log(`\nai-screenshot-lead: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
