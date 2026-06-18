// Unit tests for the pure lease-clause domain model (lib/clauses.ts).
// Run: npx tsx scripts/test-clauses.ts
import {
  CLAUSE_APPLICABILITIES,
  LEASE_TYPES,
  isClauseApplicability,
  isLeaseType,
  clauseAppliesTo,
  interpolateClause,
  tokensInBody,
  unresolvedTokens,
  nextVersionNumber,
  currentVersion,
  latestVersion,
  planSetCurrent,
  hasSingleCurrent,
  assembleClauses,
  buildExecutedSnapshot,
  diffSnapshots,
  validateClauseInput,
  validateVersionInput,
  clauseErrorMessage,
  RESIDENTIAL_CLAUSE_SEED,
  type ResolvedClause,
  type ClauseVersionLike,
  type ExecutedClauseRef,
} from "../lib/clauses";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Applicability / scoping ------------------------------------------------
ok("applicabilities are residential/commercial/both", CLAUSE_APPLICABILITIES.join(",") === "residential,commercial,both");
ok("lease types are residential/commercial", LEASE_TYPES.join(",") === "residential,commercial");
ok("isClauseApplicability accepts known", CLAUSE_APPLICABILITIES.every((a) => isClauseApplicability(a)));
ok("isClauseApplicability rejects unknown", !isClauseApplicability("freehold"));
ok("isLeaseType accepts known", LEASE_TYPES.every((t) => isLeaseType(t)));
ok("isLeaseType rejects 'both'", !isLeaseType("both"));

ok("both applies to residential", clauseAppliesTo("both", "residential"));
ok("both applies to commercial", clauseAppliesTo("both", "commercial"));
ok("residential applies to residential", clauseAppliesTo("residential", "residential"));
ok("residential excluded from commercial", !clauseAppliesTo("residential", "commercial"));
ok("commercial excluded from residential", !clauseAppliesTo("commercial", "residential"));

// --- Token interpolation (same idiom as tenant-comms) -----------------------
ok("token basic", interpolateClause("Fee {{parking_fee}}", { parking_fee: "$50" }) === "Fee $50");
ok("token inner spaces", interpolateClause("Fee {{ parking_fee }}", { parking_fee: "$50" }) === "Fee $50");
ok("token case-insensitive", interpolateClause("Fee {{Parking_Fee}}", { parking_fee: "$50" }) === "Fee $50");
ok("token with digits", interpolateClause("Spot {{space1}}", { space1: "A" }) === "Spot A");
ok("unknown token left as-is", interpolateClause("Fee {{mystery}}", { parking_fee: "$50" }) === "Fee {{mystery}}");
ok("multiple tokens", interpolateClause("{{a}}-{{b}}", { a: "1", b: "2" }) === "1-2");

ok("tokensInBody distinct + ordered", tokensInBody("{{b}} {{a}} {{b}}").join(",") === "b,a");
ok("tokensInBody lowercases", tokensInBody("{{Parking_Fee}}").join(",") === "parking_fee");
ok("tokensInBody none", tokensInBody("no tokens here").length === 0);
ok("unresolvedTokens reports missing", unresolvedTokens("{{a}} {{b}}", { a: "x" }).join(",") === "b");
ok("unresolvedTokens empty when all present", unresolvedTokens("{{a}}", { a: "x" }).length === 0);

// --- Versioning helpers -----------------------------------------------------
const vEmpty: ClauseVersionLike[] = [];
const vThree: ClauseVersionLike[] = [
  { id: "v1", version: 1, is_current: false },
  { id: "v2", version: 2, is_current: true },
  { id: "v3", version: 3, is_current: false },
];
ok("nextVersionNumber empty -> 1", nextVersionNumber(vEmpty) === 1);
ok("nextVersionNumber max+1", nextVersionNumber(vThree) === 4);
ok("nextVersionNumber ignores gaps", nextVersionNumber([{ id: "a", version: 5, is_current: true }]) === 6);

ok("currentVersion finds current", currentVersion(vThree)?.id === "v2");
ok("currentVersion null when none", currentVersion(vEmpty) === null);
ok("latestVersion picks highest", latestVersion(vThree)?.id === "v3");
ok("latestVersion null when empty", latestVersion(vEmpty) === null);

ok("hasSingleCurrent true for valid", hasSingleCurrent(vThree));
ok("hasSingleCurrent true for none-current", hasSingleCurrent([{ id: "a", version: 1, is_current: false }]));
ok("hasSingleCurrent false for two-current", !hasSingleCurrent([
  { id: "a", version: 1, is_current: true },
  { id: "b", version: 2, is_current: true },
]));

// planSetCurrent — the clear-then-set invariant
const planTo3 = planSetCurrent(vThree, "v3");
ok("planSetCurrent ok", planTo3.ok === true);
if (planTo3.ok) {
  ok("planSetCurrent clears the old current", planTo3.clear.join(",") === "v2");
  ok("planSetCurrent sets the target", planTo3.set === "v3");
  ok("planSetCurrent not a noop", planTo3.noop === false);
}
const planToCurrent = planSetCurrent(vThree, "v2");
ok("planSetCurrent target already current -> noop", planToCurrent.ok === true && planToCurrent.noop === true);
ok("planSetCurrent target already current -> no clears", planToCurrent.ok === true && planToCurrent.clear.length === 0);
const planFromNone = planSetCurrent([{ id: "a", version: 1, is_current: false }], "a");
ok("planSetCurrent from no-current sets, clears nothing", planFromNone.ok === true && planFromNone.clear.length === 0 && planFromNone.noop === false);
const planMissing = planSetCurrent(vThree, "nope");
ok("planSetCurrent missing target -> not_found", planMissing.ok === false && planMissing.code === "not_found");

// --- Assembler (ported make-offer-prefill flow) -----------------------------
function rc(over: Partial<ResolvedClause> & { key: string }): ResolvedClause {
  return {
    clauseId: "c_" + over.key,
    title: over.key,
    applicableTo: "both",
    versionId: "ver_" + over.key,
    version: 1,
    body: "Body of " + over.key,
    ...over,
  };
}

const selected: ResolvedClause[] = [
  rc({ key: "pets", applicableTo: "residential", body: "Pets clause." }),
  rc({ key: "parking", applicableTo: "both", body: "Parking {{parking_fee}}." }),
  rc({ key: "smoking", applicableTo: "both", body: "No smoking." }),
];

const resAssembled = assembleClauses(selected, {
  leaseType: "residential",
  vars: { parking_fee: "$50" },
});
ok("assemble joins with blank line", resAssembled.text === "Pets clause.\n\nParking $50.\n\nNo smoking.");
ok("assemble preserves input order", resAssembled.clauses.map((c) => c.key).join(",") === "pets,parking,smoking");
ok("assemble interpolates bodies", resAssembled.clauses[1].rendered === "Parking $50.");
ok("assemble nothing excluded for residential", resAssembled.excluded.length === 0);
ok("assemble no unresolved when var provided", resAssembled.unresolved.length === 0);

// scoping: assembling the SAME selection for a commercial lease drops residential-only clauses
const resCommercial = assembleClauses(selected, { leaseType: "commercial", vars: { parking_fee: "$50" } });
ok("commercial assembly excludes residential-only pets", resCommercial.excluded.map((e) => e.key).join(",") === "pets");
ok("commercial assembly keeps both-scoped clauses", resCommercial.clauses.map((c) => c.key).join(",") === "parking,smoking");

// unresolved tokens surface when a var is missing
const resMissing = assembleClauses([rc({ key: "parking", body: "Fee {{parking_fee}} and {{deposit}}." })], {
  leaseType: "residential",
});
ok("assemble reports unresolved tokens", resMissing.unresolved.join(",") === "parking_fee,deposit");
ok("assemble leaves unresolved tokens literal", resMissing.text === "Fee {{parking_fee}} and {{deposit}}.");

// custom separator
const resSep = assembleClauses(selected, { leaseType: "residential", vars: { parking_fee: "$0" }, separator: " | " });
ok("assemble honors custom separator", resSep.text === "Pets clause. | Parking $0. | No smoking.");

// --- Executed snapshot + renewal diff (the differentiator) ------------------
const snapV1 = buildExecutedSnapshot(resAssembled);
ok("snapshot has one entry per included clause", snapV1.length === 3);
ok("snapshot captures clause_id/key/version", snapV1[0].clause_id === "c_pets" && snapV1[0].key === "pets" && snapV1[0].version === 1);
ok("snapshot body is the pre-interpolation template", snapV1[1].body === "Parking {{parking_fee}}.");

// renewal: parking bumped to v2, smoking unchanged, pets removed, locker added
const current: ExecutedClauseRef[] = [
  { clause_id: "c_parking", key: "parking", title: "Parking", version_id: "ver_parking_2", version: 2, body: "Parking v2." },
  { clause_id: "c_smoking", key: "smoking", title: "Smoking", version_id: "ver_smoking", version: 1, body: "No smoking." },
  { clause_id: "c_locker", key: "locker", title: "Locker", version_id: "ver_locker", version: 1, body: "Locker clause." },
];
const diff = diffSnapshots(snapV1, current);
ok("diff added is the new locker clause", diff.added.map((c) => c.key).join(",") === "locker");
ok("diff removed is the dropped pets clause", diff.removed.map((c) => c.key).join(",") === "pets");
ok("diff changed catches parking version bump", diff.changed.length === 1 && diff.changed[0].key === "parking" && diff.changed[0].from === 1 && diff.changed[0].to === 2);
ok("diff unchanged catches smoking", diff.unchanged.map((c) => c.key).join(",") === "smoking");
ok("diff not identical when things changed", diff.identical === false);

const sameDiff = diffSnapshots(snapV1, snapV1);
ok("diff identical for unchanged renewal", sameDiff.identical === true);
ok("diff identical -> no changes", sameDiff.added.length === 0 && sameDiff.removed.length === 0 && sameDiff.changed.length === 0);
ok("diff identical -> all unchanged", sameDiff.unchanged.length === 3);

// --- Validation -------------------------------------------------------------
const okClause = validateClauseInput({ key: "Pets ", title: " Pets ", applicableTo: "residential" });
ok("validateClauseInput ok", okClause.ok === true);
ok("validateClauseInput trims + lowercases key", okClause.ok === true && okClause.value.key === "pets");
ok("validateClauseInput trims title", okClause.ok === true && okClause.value.title === "Pets");
ok("validateClauseInput defaults category", okClause.ok === true && okClause.value.category === "general");
ok("validateClauseInput missing key", validateClauseInput({ key: "", title: "X", applicableTo: "both" }).ok === false);
ok("validateClauseInput bad key chars", (() => { const r = validateClauseInput({ key: "no spaces", title: "X", applicableTo: "both" }); return !r.ok && r.code === "key_invalid"; })());
ok("validateClauseInput missing title", (() => { const r = validateClauseInput({ key: "k", title: "  ", applicableTo: "both" }); return !r.ok && r.code === "title_required"; })());
ok("validateClauseInput bad applicable_to", (() => { const r = validateClauseInput({ key: "k", title: "T", applicableTo: "freehold" }); return !r.ok && r.code === "applicable_to_invalid"; })());

ok("validateVersionInput ok", (() => { const r = validateVersionInput({ body: " text " }); return r.ok && r.value.body === "text" && r.value.note === null; })());
ok("validateVersionInput keeps note", (() => { const r = validateVersionInput({ body: "x", note: " Bill 60 " }); return r.ok && r.value.note === "Bill 60"; })());
ok("validateVersionInput empty body", (() => { const r = validateVersionInput({ body: "   " }); return !r.ok && r.code === "body_required"; })());

ok("clauseErrorMessage known", typeof clauseErrorMessage("key_required") === "string");
ok("clauseErrorMessage unknown -> null", clauseErrorMessage("zzz") === null);
ok("clauseErrorMessage undefined -> null", clauseErrorMessage(undefined) === null);

// --- Residential seed integrity ---------------------------------------------
ok("seed has the 5 expected clauses", RESIDENTIAL_CLAUSE_SEED.map((c) => c.key).sort().join(",") === "parking,pets,smoking,storage,utilities");
ok("seed keys are unique", new Set(RESIDENTIAL_CLAUSE_SEED.map((c) => c.key)).size === RESIDENTIAL_CLAUSE_SEED.length);
ok("seed keys are valid identifiers", RESIDENTIAL_CLAUSE_SEED.every((c) => /^[a-z0-9_]+$/.test(c.key)));
ok("seed applicabilities are valid", RESIDENTIAL_CLAUSE_SEED.every((c) => isClauseApplicability(c.applicableTo)));
ok("seed bodies non-empty", RESIDENTIAL_CLAUSE_SEED.every((c) => c.body.trim().length > 0));
ok("seed validates through validateClauseInput", RESIDENTIAL_CLAUSE_SEED.every((c) => validateClauseInput(c).ok));
// the seed must assemble cleanly for a residential lease once turned into versions
const seedAsResolved: ResolvedClause[] = RESIDENTIAL_CLAUSE_SEED.map((c, i) => ({
  clauseId: "c" + i,
  key: c.key,
  title: c.title,
  applicableTo: c.applicableTo,
  versionId: "v" + i,
  version: 1,
  body: c.body,
}));
const seedAssembled = assembleClauses(seedAsResolved, {
  leaseType: "residential",
  vars: {
    property_address: "833 Pillette Rd",
    parking_spaces: "1",
    parking_fee: "$50",
    tenant_utilities: "hydro",
    included_utilities: "water and heat",
    storage_description: "one locker",
  },
});
ok("seed assembles all 5 for residential", seedAssembled.clauses.length === 5);
ok("seed assembly fully resolved with realistic vars", seedAssembled.unresolved.length === 0);
ok("seed pets clause cites RTA s.14", seedAssembled.clauses[0].rendered.includes("section 14"));
// commercial lease drops the residential-only seed clauses (pets, utilities)
const seedCommercial = assembleClauses(seedAsResolved, { leaseType: "commercial", vars: {} });
ok("seed commercial excludes residential-only clauses", seedCommercial.excluded.map((e) => e.key).sort().join(",") === "pets,utilities");

// ----------------------------------------------------------------------------
console.log(`clauses: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
