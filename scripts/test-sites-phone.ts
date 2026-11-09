// S768: the sites page on a phone (REVIEW-S761 section 5 item 1).
// Run: npx tsx scripts/test-sites-phone.ts
import { readFileSync } from "node:fs";
import {
  SITES_PHONE_BUTTON,
  SITES_PHONE_LINE,
  isPhoneUserAgent,
  sitesComputerEmail,
  sitesComputerPath,
  sitesPhoneMailedLine,
  sitesPhoneMarketplaceHref,
} from "../lib/sites-phone";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_TAB = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPAD_OLD = "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WIN_EDGE = WIN_CHROME + " Edg/130.0.0.0";

ok("iPhone is a phone", isPhoneUserAgent(IPHONE));
ok("Android phone is a phone", isPhoneUserAgent(ANDROID));
ok("Android tablet counts", isPhoneUserAgent(ANDROID_TAB));
ok("old iPad counts", isPhoneUserAgent(IPAD_OLD));
ok("Mac Chrome is a computer", !isPhoneUserAgent(MAC_CHROME));
ok("Windows Chrome is a computer", !isPhoneUserAgent(WIN_CHROME));
ok("Windows Edge is a computer", !isPhoneUserAgent(WIN_EDGE));
ok("no user agent is a computer", !isPhoneUserAgent(null) && !isPhoneUserAgent(""));

ok("path without a rental", sitesComputerPath(null) === "/dashboard/sites");
ok("path keeps the rental", sitesComputerPath("abc-1") === "/dashboard/sites?property=abc-1");
ok("Marketplace without a rental", sitesPhoneMarketplaceHref(null) === "/dashboard/properties");
ok(
  "Marketplace with a rental",
  sitesPhoneMarketplaceHref("abc-1") === "/dashboard/properties/abc-1?tab=distribute#for-you-facebook",
);

const withAddr = sitesComputerEmail({ address: "833 Pillette Rd Unit 3" });
const noAddr = sitesComputerEmail({ address: null });
ok("subject", withAddr.subject === "Connect your rental sites from your computer");
ok("body names the rental", withAddr.body.includes("for 833 Pillette Rd Unit 3."));
ok("body without a rental reads cleanly", noAddr.body.includes("in Vacantless.\n") && !noAddr.body.includes(", for"));
ok("body names the three sites", /Kijiji, Rentals\.ca and Zumper/.test(withAddr.body));

ok("sent line", sitesPhoneMailedLine("1", "a@b.c") === "Sent to a@b.c. Open it on your computer.");
ok("sent line without email", sitesPhoneMailedLine("1", null) === "Sent. Open it on your computer.");
ok("fail line", (sitesPhoneMailedLine("0", "a@b.c") ?? "").startsWith("We couldn't send it."));
ok("no line by default", sitesPhoneMailedLine(undefined, "a@b.c") === null);

const copy = [SITES_PHONE_LINE, SITES_PHONE_BUTTON, withAddr.subject, withAddr.body, noAddr.body].join("\n");
ok("no em or en dashes in the copy", !/[–—]/.test(copy));

// --- wiring ---
const root = process.env.APP_ROOT ?? process.cwd();
const page = readFileSync(`${root}/app/dashboard/sites/page.tsx`, "utf8");
const actions = readFileSync(`${root}/app/dashboard/sites/actions.ts`, "utf8");
ok("page reads the user agent", page.includes('headers().get("user-agent")') && page.includes("isPhoneUserAgent("));
ok("page shows the phone line and the email button", page.includes("SITES_PHONE_LINE") && page.includes("emailSitesComputerLink"));
ok("page keeps the full list behind a details", page.includes("<details") && page.includes("<SitesRows"));
ok("action sends only to the signed-in user", actions.includes("auth.getUser()") && actions.includes("to_email: to"));
ok("action checks the rental belongs to the account", actions.includes('.eq("organization_id", org.id)'));
ok("action uses the pure email", actions.includes("sitesComputerEmail(") && actions.includes("sitesComputerPath("));

console.log(`test-sites-phone: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
