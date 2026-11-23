// S835h: the homepage is shorter and loses nothing (Noam 2026-11-23: "15
// screens long is tough" and "without losing anything important"). Folds are
// plain <details>, so every line stays in the page.
// Run: npx tsx scripts/test-s835h-homepage-shorter.ts
import { readFileSync } from "node:fs";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const home = noComments(readFileSync("app/page.tsx", "utf8"));
const band = noComments(readFileSync("components/savings-band.tsx", "utf8"));
const table = noComments(readFileSync("components/vendor-cost-table.tsx", "utf8"));

// Pricing: the paid-plan list folds; plan prices stay open.
const paid = home.slice(home.indexOf('id="paid-plans"'), home.indexOf("<VendorCostTable"));
ok("paid-plan list sits inside a fold", /<details[\s\S]*PAID_FEATURE_GROUPS\.map\(\(g\) => \([\s\S]*g\.items\.map[\s\S]*<\/details>/.test(paid));
ok("the group names stay open above the fold", paid.indexOf("g.head).join") > 0 && paid.indexOf("g.head).join") < paid.indexOf("<details"));
ok("the fold says how many features", /See all \{PAID_FEATURE_GROUPS\.reduce/.test(paid));
ok("the support line stays open", paid.indexOf("PAID_SUPPORT_LINE") > paid.indexOf("</details>"));
const plans = home.slice(home.indexOf("{PLANS.map"), home.indexOf('id="paid-plans"'));
ok("plan cards are not folded", !plans.includes("<details"));
ok("Posting and Rent collection share one row", /lg:grid-cols-2[^>]*>\s*<PostingAddonCard \/>\s*<RentOnlyCard \/>/.test(home));
ok("both cards keep their anchors", home.includes('id="posting-addon"') && home.includes('id="rent-only"'));

// Then it runs the rest: three points open, the rest one tap away.
ok("three points shown per card", /AUTOMATION_POINTS_SHOWN = 3/.test(home));
ok("a fold never hides a single line", /if \(extra < 2\) return <AutomationPointList points=\{points\} \/>/.test(home));
ok("folded points are still rendered", /points\.slice\(AUTOMATION_POINTS_SHOWN\)/.test(home));
ok("every card uses the fold", home.includes("<AutomationPoints points={a.points} />"));
const turn = home.slice(home.indexOf('kicker: "Turnovers"'), home.indexOf('kicker: "Rent increases"'));
const lines = turn.split("\n").filter((l) => /^\s+"/.test(l));
ok("turnovers keeps six points", lines.length === 6);
ok("turnovers shows the stall line in the first three", lines.slice(0, 3).some((l) => l.includes("you hear when one stalls")));

// The paperwork section is now a card in Little things.
const main = home.slice(home.indexOf("<main>"), home.indexOf("</main>"));
ok("no separate paperwork section", !main.includes("AfterTheLease") && !home.includes("function AfterTheLease"));
ok("paperwork card leads Little things", /md:grid-cols-2">\s*<PaperworkCard \/>\s*\{LITTLE_THING_GROUPS\.map/.test(home));
ok("the #paperwork anchor is kept once", home.split('id="paperwork"').length === 2);
ok("all three paperwork items and links kept", ["/tools\"", "/tools/standard-lease", "/tools/rent-increase", "Official LTB notices, filled in", "The Ontario Standard Lease", "Free tools, no sign-up"].every((t) => home.includes(t)));
ok("the Ontario line is kept", home.includes("For Ontario rentals. The forms come straight from the tenancy you already have."));

// Sections Noam said to leave alone are still on the page, in order.
const order = ["<Hero />", "<StopDoing />", "<SavingsBand />", "<SeeItWork />", "<LeasingProof />", "<Automations />", "<LessTyping />", "<HowItWorks />", "<LittleThings />", "<Pricing />", "<FounderBand />", "<Questions />", "<ClosingCta />"];
ok("sections in order", order.every((t, i) => main.includes(t) && (i === 0 || main.indexOf(order[i - 1]) < main.indexOf(t))));

// S835g fixes read on the live page.
ok("the band is as wide as the rest of the page", band.includes("w-[min(1120px,calc(100%-32px))]"));
ok("about comes before the number", band.indexOf("about </span>") > 0 && band.indexOf("about </span>") < band.indexOf("CA${sub.low}") && !band.includes("a month, about"));
ok("table prices do not wrap on a wide screen", table.includes("sm:whitespace-nowrap"));
ok("no em dash", ![home, band, table].some((s) => s.includes("—")));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
