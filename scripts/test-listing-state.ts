// Unit tests for the pure listing-status model.
// Run: npx tsx scripts/test-listing-state.ts
import {
  PROPERTY_STATUSES,
  isPropertyStatus,
  normalizePropertyStatus,
  propertyStatusLabel,
  propertyStatusHelp,
  propertyStatusBadge,
  isPublicBookable,
  isPubliclyVisible,
  isVisibleButUnavailable,
  type PropertyStatus,
} from "../lib/listing-state";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- the status set --------------------------------------------------------
ok("PROPERTY_STATUSES has 5", PROPERTY_STATUSES.length === 5);
ok(
  "PROPERTY_STATUSES = draft/available/paused/leased/off_market",
  PROPERTY_STATUSES.join(",") === "draft,available,paused,leased,off_market",
);
ok("draft comes before available (picker order)", PROPERTY_STATUSES.indexOf("draft" as PropertyStatus) < PROPERTY_STATUSES.indexOf("available" as PropertyStatus));

// --- isPropertyStatus ------------------------------------------------------
ok("isPropertyStatus: available", isPropertyStatus("available"));
ok("isPropertyStatus: draft", isPropertyStatus("draft"));
ok("isPropertyStatus: paused", isPropertyStatus("paused"));
ok("isPropertyStatus: leased", isPropertyStatus("leased"));
ok("isPropertyStatus: off_market", isPropertyStatus("off_market"));
ok("isPropertyStatus: rejects live", !isPropertyStatus("live"));
ok("isPropertyStatus: rejects empty", !isPropertyStatus(""));
ok("isPropertyStatus: rejects null", !isPropertyStatus(null));
ok("isPropertyStatus: rejects number", !isPropertyStatus(3 as unknown));

// --- normalizePropertyStatus ----------------------------------------------
ok("normalize: passes draft", normalizePropertyStatus("draft") === "draft");
ok("normalize: trims whitespace", normalizePropertyStatus("  paused  ") === "paused");
ok("normalize: unknown -> available default", normalizePropertyStatus("nope") === "available");
ok("normalize: empty -> available default", normalizePropertyStatus("") === "available");
ok("normalize: null -> available default", normalizePropertyStatus(null) === "available");
ok("normalize: undefined -> available default", normalizePropertyStatus(undefined) === "available");
ok("normalize: custom fallback honored", normalizePropertyStatus("nope", "draft") === "draft");

// --- labels (operator-facing wording) -------------------------------------
ok("label: available -> Live", propertyStatusLabel("available") === "Live");
ok("label: draft -> Draft", propertyStatusLabel("draft") === "Draft");
ok("label: paused -> Paused", propertyStatusLabel("paused") === "Paused");
ok("label: leased -> Leased", propertyStatusLabel("leased") === "Leased");
ok("label: off_market -> Off market", propertyStatusLabel("off_market") === "Off market");
ok("label: unknown passes through", propertyStatusLabel("weird") === "weird");

// --- help text -------------------------------------------------------------
for (const s of PROPERTY_STATUSES) {
  ok(`help present for ${s}`, propertyStatusHelp(s).length > 0);
}
ok("help: unknown -> empty", propertyStatusHelp("weird") === "");
// House rule: no em dashes in user-facing copy.
for (const s of PROPERTY_STATUSES) {
  ok(`help has no em dash (${s})`, !propertyStatusHelp(s).includes("—"));
}

// --- badges ----------------------------------------------------------------
for (const s of PROPERTY_STATUSES) {
  const b = propertyStatusBadge(s);
  ok(`badge label matches ${s}`, b.label === propertyStatusLabel(s));
  ok(`badge has class ${s}`, b.className.length > 0);
}
ok("badge: unknown -> gray fallback", propertyStatusBadge("weird").className.includes("gray"));
ok("badge: available is green", propertyStatusBadge("available").className.includes("green"));

// --- public contract: bookable (mirrors S193/0018 action gate) -------------
ok("bookable: available only", isPublicBookable("available"));
ok("bookable: draft no", !isPublicBookable("draft"));
ok("bookable: paused no", !isPublicBookable("paused"));
ok("bookable: leased no", !isPublicBookable("leased"));
ok("bookable: off_market no", !isPublicBookable("off_market"));

// --- public contract: visible on /r (mirrors get_public_listing guard) -----
ok("visible: available", isPubliclyVisible("available"));
ok("visible: paused", isPubliclyVisible("paused"));
ok("visible: leased", isPubliclyVisible("leased"));
ok("visible: draft NO (404)", !isPubliclyVisible("draft"));
ok("visible: off_market NO (404)", !isPubliclyVisible("off_market"));

// --- visible-but-unavailable (loads /r, shows the gone state) --------------
ok("visible-unavailable: paused yes", isVisibleButUnavailable("paused"));
ok("visible-unavailable: leased yes", isVisibleButUnavailable("leased"));
ok("visible-unavailable: available no (it's bookable)", !isVisibleButUnavailable("available"));
ok("visible-unavailable: draft no (it 404s)", !isVisibleButUnavailable("draft"));
ok("visible-unavailable: off_market no (it 404s)", !isVisibleButUnavailable("off_market"));

// --- invariant: every status is either bookable, visible-unavailable, or private
for (const s of PROPERTY_STATUSES) {
  const buckets =
    Number(isPublicBookable(s)) +
    Number(isVisibleButUnavailable(s)) +
    Number(!isPubliclyVisible(s));
  ok(`exactly one public bucket for ${s}`, buckets === 1);
}

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-state: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
