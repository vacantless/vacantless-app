// S724 (V251-29): the approval box shows the ad's facts. Run: npx tsx scripts/test-s724-ad-preview.ts
import { readFileSync } from "node:fs";
import { buildAdPreview } from "../lib/ad-preview";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }
const v = (pv: ReturnType<typeof buildAdPreview>, label: string) => pv.facts.find((x) => x.label === label);

const manitoba = buildAdPreview({
  title: "3 Bed Town House, 251 Manitoba St",
  rentCents: 200000, beds: 3, baths: 1.5, description: "Bright townhouse.", photoCount: 9,
  features: { available_date: "2026-11-01", pets_cats: false, pets_dogs: false, heat_included: true, hydro_included: false, water_included: null, parking_type: "outdoor", parking_count: 2 },
});
ok("rent", v(manitoba, "Rent")?.value === "$2,000/month", v(manitoba, "Rent"));
ok("size", v(manitoba, "Size")?.value === "3 bedrooms, 1.5 bathrooms", v(manitoba, "Size"));
ok("date", v(manitoba, "Available")?.value === "Nov 1");
ok("no pets", v(manitoba, "Pets")?.value === "No pets");
ok("heat only", v(manitoba, "Included")?.value === "Heat");
ok("parking", v(manitoba, "Parking")?.value?.endsWith(", 2 spots") === true, v(manitoba, "Parking"));
ok("photos", v(manitoba, "Photos")?.value === "9");
ok("nothing missing", manitoba.facts.every((x) => !x.missing), manitoba.facts);

const blank = buildAdPreview({ title: null, rentCents: null, beds: null, baths: null, description: null, photoCount: 0, features: {} });
ok("pets unknown said plainly", v(blank, "Pets")?.missing === true && /we post No pets/.test(v(blank, "Pets")?.value ?? ""));
ok("utilities unknown", v(blank, "Included")?.missing === true);
ok("photos none", v(blank, "Photos")?.missing === true);
ok("all excluded", v(buildAdPreview({ ...blank, features: { heat_included: false, hydro_included: false, water_included: false } } as never), "Included")?.value === "No utilities");
ok("cats only", v(buildAdPreview({ title: null, rentCents: 1, beds: 1, baths: 1, description: null, photoCount: 1, features: { pets_cats: true, pets_dogs: false } }), "Pets")?.value === "Cats OK, no dogs");
const long = buildAdPreview({ title: "t", rentCents: 1, beds: 0, baths: 1, description: "x".repeat(400), photoCount: 1, features: {} });
ok("studio", v(long, "Size")?.value === "Studio, 1 bathroom");
ok("description trimmed", (long.descriptionStart ?? "").length === 180);

const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("modal renders facts", /adPreview\.facts\.map/.test(pe));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page builds from effective features", /buildAdPreview\(\{[\s\S]{0,400}features: effectiveFeatures/.test(page));
console.log(`s724-ad-preview: ${p} passed, ${f} failed`);
if (f) process.exit(1);
