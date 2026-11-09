// S771: the cost and free-listing line before Set Live. Run: npx tsx scripts/test-set-live-cost-line.ts
import { setLiveSiteNote, setLiveSitesSentence } from "../lib/set-live-cost-line";
import { channelCostCap, EMPTY_COST_CAP } from "../lib/distribution-channels";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL: ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}
const personal = { capabilities: { kijiji_tier: "personal" } };
const business = { capabilities: { kijiji_tier: "business" } };

// Kijiji
eq("kijiji personal, free ad left", setLiveSiteNote("kijiji", channelCostCap("kijiji", personal, { cap_used: 0 })).note, "Uses your 1 free ad.");
const kUsed = setLiveSiteNote("kijiji", channelCostCap("kijiji", personal, { cap_used: 1 }));
eq("kijiji personal, free ad used: paid", [kUsed.paid, kUsed.note], [true, "$33.84, you pay Kijiji at checkout."]);
const kBiz = setLiveSiteNote("kijiji", channelCostCap("kijiji", business, null));
eq("kijiji business: paid", [kBiz.paid, kBiz.note], [true, "$33.84, you pay Kijiji at checkout."]);
eq("kijiji tier unknown: honest either way", setLiveSiteNote("kijiji", channelCostCap("kijiji", null, null)).note,
  "Free if it is your first ad, otherwise $33.84 at checkout.");

// Rentals.ca and Zumper
eq("rentals 2 of 3", setLiveSiteNote("rentals_ca", channelCostCap("rentals_ca", null, { cap_used: 2 })).note, "Free. 2 of 3 free listings used.");
const rFull = setLiveSiteNote("rentals_ca", channelCostCap("rentals_ca", null, { cap_used: 3 }));
eq("rentals full", [rFull.capReached, rFull.note], [true, "All 3 free listings are in use. Take one down first."]);
eq("rentals unknown", setLiveSiteNote("rentals_ca", channelCostCap("rentals_ca", null, null)).note, "Free for up to 3 listings.");
eq("zumper 4 of 5", setLiveSiteNote("zumper", channelCostCap("zumper", null, { cap_used: 4 })).note, "Free. 4 of 5 free listings used.");
eq("zumper full", setLiveSiteNote("zumper", channelCostCap("zumper", null, { cap_used: 5 })).capReached, true);
eq("empty verdict falls back", setLiveSiteNote("zumper", EMPTY_COST_CAP).note, "Free for up to 5 listings.");

// Sentence
eq("no sites: no sentence", setLiveSitesSentence([]), null);
eq("one site", setLiveSitesSentence([setLiveSiteNote("zumper", EMPTY_COST_CAP)]),
  "This rental will also post to Zumper on your own accounts.");
eq("three sites, one paid, one full", setLiveSitesSentence([kUsed, rFull, setLiveSiteNote("zumper", EMPTY_COST_CAP)]),
  "This rental will also post to Kijiji, Rentals.ca and Zumper on your own accounts. Kijiji charges for this ad. Rentals.ca has no free listing left.");

const zFull = setLiveSiteNote("zumper", channelCostCap("zumper", null, { cap_used: 5 }));
eq("two full sites: plural", setLiveSitesSentence([rFull, zFull]),
  "This rental will also post to Rentals.ca and Zumper on your own accounts. Rentals.ca and Zumper have no free listing left.");

// Copy rules: no em dash, no parentheses, no slash or ampersand in what a landlord reads.
const all = [kUsed, kBiz, rFull].map((n) => n.note).concat(setLiveSitesSentence([kUsed, rFull]) ?? "");
for (const line of all) {
  eq(`plain: ${line}`, /[—()&/]/.test(line), false);
}

console.log(`set-live-cost-line: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
