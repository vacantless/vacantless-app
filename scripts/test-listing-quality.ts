// Unit tests for the pure listing-quality layer.
// Run: npx tsx scripts/test-listing-quality.ts
import {
  scoreListing,
  gradeLabel,
  fairHousingLint,
  missingDetails,
} from "../lib/listing-quality";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const STRONG_DESC =
  "Bright, sunny south-facing one bedroom with an open concept layout and hardwood floors. Renovated kitchen with stainless appliances and a dishwasher. Ensuite laundry, one parking spot, and a private balcony. Steps to transit, shops, and a grocery store in a quiet neighbourhood.";

// --- scoreListing ----------------------------------------------------------
{
  const q = scoreListing({
    description: STRONG_DESC,
    photoCount: 8,
    beds: 1,
    baths: 1,
    rentCents: 129500,
    hasFeatures: true,
  });
  ok("full listing scores 100", q.score === 100);
  ok("grade strong", q.grade === "strong");
  ok("all checks passed", q.passed === q.total);
}
{
  const q = scoreListing({
    description: "Nice place.",
    photoCount: 0,
    beds: null,
    baths: null,
    rentCents: null,
    hasFeatures: false,
  });
  ok("empty listing scores 0", q.score === 0);
  ok("grade thin", q.grade === "thin");
  ok("photos check fails", !q.checks.find((c) => c.key === "photos")!.ok);
}
{
  // Photos + rent + beds only = 30 + 15 + 15 = 60 -> fair.
  const q = scoreListing({
    description: "short",
    photoCount: 5,
    beds: 2,
    baths: 1,
    rentCents: 200000,
    hasFeatures: false,
  });
  ok("partial listing = 60 (fair)", q.score === 60 && q.grade === "fair");
}
ok("gradeLabel strong", gradeLabel("strong") === "Strong");
ok("gradeLabel thin", gradeLabel("thin") === "Needs work");

// --- fairHousingLint -------------------------------------------------------
ok("clean description -> no flags", fairHousingLint(STRONG_DESC).length === 0);
ok("null -> no flags", fairHousingLint(null).length === 0);
{
  const f = fairHousingLint("Quiet building, adults only, no children please.");
  ok("adults only flagged", f.some((x) => x.key === "adults_only"));
  ok("no children flagged", f.some((x) => x.key === "no_children"));
  ok("family status ground present", f.some((x) => /family status/.test(x.ground)));
}
{
  const f = fairHousingLint("Working professionals only. No DSS or social assistance.");
  ok("employment flagged", f.some((x) => x.key === "employment"));
  ok("public assistance flagged", f.some((x) => x.key === "public_assistance"));
}
{
  const f = fairHousingLint("Female only, Christian preferred household.");
  ok("sex flagged", f.some((x) => x.key === "sex"));
  ok("religion flagged", f.some((x) => x.key === "religion"));
}
ok(
  "no pets is NOT flagged (lease matter, not a Code ground)",
  fairHousingLint("Sorry, no pets allowed.").length === 0,
);
ok(
  "no em dashes in fair-housing messages",
  !/[—–]/.test(
    fairHousingLint("adults only, no dss, female only, christian preferred, no students")
      .map((x) => x.message)
      .join(" "),
  ),
);

// --- missingDetails --------------------------------------------------------
ok("strong description misses nothing", missingDetails(STRONG_DESC).length === 0);
{
  const m = missingDetails("One bedroom apartment for rent.");
  ok("thin description misses several details", m.length >= 5);
  ok("flags missing light", m.some((x) => /light/.test(x)));
  ok("flags missing parking", m.some((x) => /parking/.test(x)));
}
ok("null description -> all details missing", missingDetails(null).length === 8);

console.log(`\nlisting-quality: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
