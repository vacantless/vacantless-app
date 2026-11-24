// S840 (REVIEW-S839 step G): the phone bottom bar and "Needs you now" first on Today.
// Run: npx tsx scripts/test-s840-phone-bar.ts
import { readFileSync } from "node:fs";

// Read the constants from the file: the nav is a client component that pulls
// in server actions, so it is not imported here.
const navSrc = readFileSync("app/dashboard/dashboard-nav.tsx", "utf8");
const barBlock = /export const PHONE_BAR[^=]*= \[([\s\S]*?)\n\];/.exec(navSrc)?.[1] ?? "";
const PHONE_BAR = [...barBlock.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"([^}]*)\}/g)].map((m) => ({
  href: m[1],
  label: m[2],
  match: (/match: \[([^\]]*)\]/.exec(m[3])?.[1] ?? "").split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean),
}));
const PHONE_BAR_HIDDEN_ON = (/export const PHONE_BAR_HIDDEN_ON = \[([^\]]*)\]/.exec(navSrc)?.[1] ?? "").split(",").map((x) => x.trim().replace(/"/g, ""));

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

ok("four daily places, in order", PHONE_BAR.map((i) => i.label).join(",") === "Today,Renters,Viewings,Rentals");
ok("bar links the same routes as the top bar", PHONE_BAR.map((i) => i.href).join(",") === "/dashboard,/dashboard/leads,/dashboard/showings,/dashboard/properties");
ok("Viewings stays lit on viewing times", (PHONE_BAR.find((i) => i.label === "Viewings")?.match ?? []).includes("/dashboard/availability"));
ok("hidden on the Back / Next step pages", ["/dashboard/add-details", "/dashboard/send-live", "/dashboard/after-live"].every((p) => PHONE_BAR_HIDDEN_ON.includes(p)));

const nav = readFileSync("app/dashboard/dashboard-nav.tsx", "utf8");
ok("bar only below lg", /aria-label="Daily work"[\s\S]{0,200}lg:hidden/.test(nav));
ok("bar not printed", /aria-label="Daily work"[\s\S]{0,300}print:hidden/.test(nav));
ok("bar clears the iPhone home line", nav.includes("pb-[env(safe-area-inset-bottom)]"));
ok("fifth place is More, opening the menu", /setOpen\(\(v\) => !v\);[\s\S]{0,400}\{open \? "Close" : "More"\}/.test(nav));

const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
ok("page leaves room for the bar on phones only", layout.includes("pb-28 pt-8 lg:pb-8"));
ok("demo login keeps its own nav (no bar)", /isDemo \? \(\s*<nav/.test(layout));

console.log(`s840 phone bar: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
