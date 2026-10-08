// S701: the AI listing draft gets the approximate location, is told to use
// every fact, and the form names the details that were left blank.
import {
  descriptionLocation,
  missingDescriptionDetails,
} from "../lib/auto-listing-copy";
import {
  autoListingFactLines,
  buildAutoListingPrompt,
} from "../lib/auto-listing-copy-ai";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean) {
  eq(name, cond, true);
}

// location: street name + city, never the civic number or unit
eq("stranger walk address", descriptionLocation("88 Stranger Test Ave, Unit 2, Windsor, ON N9A 1B1"), "Stranger Test Ave, Windsor");
eq("agile address", descriptionLocation("833 Pillette Rd, Unit 33, Windsor, ON N8Y 3B4"), "Pillette Rd, Windsor");
eq("blank address", descriptionLocation(""), null);
eq("null address", descriptionLocation(null), null);
ok("no civic number leaks", !(descriptionLocation("1195 Bruce Ave, Unit 303, Windsor, ON N9A 4Y5") ?? "").includes("1195"));
ok("no unit leaks", !(descriptionLocation("1195 Bruce Ave, Unit 303, Windsor, ON N9A 4Y5") ?? "").includes("303"));

// the stranger walk's facts: rent, beds, baths, sqft only
const thin = { beds: 1, baths: 1, rent_cents: 140000, sqft: 600 };
eq("thin facts name what is missing", missingDescriptionDetails(thin), ["laundry", "parking", "utilities", "pets", "move-in date"]);
const full = {
  beds: 1, baths: 1, rent_cents: 125000, sqft: 500, laundry: "Shared in building",
  parking: "Street", heat_included: true, hydro_included: false, water_included: null,
  pets_cats: true, pets_dogs: false, available_date: "2026-11-01",
};
eq("full facts miss nothing", missingDescriptionDetails(full), []);
eq("one utility answered counts", missingDescriptionDetails({ ...full, heat_included: null, hydro_included: false }), []);
eq("blank strings count as missing", missingDescriptionDetails({ ...full, laundry: "  ", parking: "" }), ["laundry", "parking"]);
eq("a false pet answer is an answer", missingDescriptionDetails({ ...full, pets_cats: false, pets_dogs: false }), []);

// the prompt
const lines = autoListingFactLines(thin, { location: "Stranger Test Ave, Windsor" });
eq("location is the first fact", lines[0], "Location: Stranger Test Ave, Windsor");
ok("sqft reaches the model", lines.includes("Square feet: 600"));
eq("no location when none given", autoListingFactLines(thin).some((l) => l.startsWith("Location")), false);
const prompt = buildAutoListingPrompt(thin, "fallback", { location: "Stranger Test Ave, Windsor" });
ok("prompt says use every fact", /Use every fact listed/.test(prompt));
ok("prompt forbids house number and neighbourhood", /never add a house number, unit, or neighbourhood/.test(prompt));
ok("prompt still forbids inventing", /Do not add or imply any feature/.test(prompt));

console.log(`\nauto-listing-copy-s701: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
