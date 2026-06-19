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
  resolveCurrentClauses,
  buildLeaseVars,
  RESIDENTIAL_CLAUSE_SEED,
  RISK_LEVELS,
  JURISDICTIONS,
  CLAUSE_CATEGORIES,
  isRiskLevel,
  isJurisdiction,
  categoryOrder,
  recommendClauses,
  CANONICAL_LEASE_TOKENS,
  isCanonicalLeaseToken,
  annotateRecommendations,
  selectClausesById,
  collectVarFields,
  type ResolvedClause,
  type ClauseVersionLike,
  type ClauseRowLike,
  type ClauseVersionRowLike,
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

// --- Risk level / jurisdiction guards ---------------------------------------
ok("RISK_LEVELS has the 3 expected", RISK_LEVELS.join(",") === "standard,caution,legal_review");
ok("isRiskLevel accepts known", isRiskLevel("caution") && isRiskLevel("legal_review"));
ok("isRiskLevel rejects unknown", !isRiskLevel("high") && !isRiskLevel(""));
ok("JURISDICTIONS has the 3 expected", JURISDICTIONS.join(",") === "ontario,canada,custom");
ok("isJurisdiction accepts known", isJurisdiction("ontario") && isJurisdiction("custom"));
ok("isJurisdiction rejects unknown", !isJurisdiction("quebec") && !isJurisdiction(""));
ok("categoryOrder ranks known in order", categoryOrder("Rent & Deposits") === 0 && categoryOrder("Property-Specific") === 5);
ok("categoryOrder sorts unknown last", categoryOrder("Whatever") === CLAUSE_CATEGORIES.length);

// --- Residential seed integrity (16 clauses) --------------------------------
ok("seed has 16 clauses", RESIDENTIAL_CLAUSE_SEED.length === 16);
ok("seed has the 16 expected keys", RESIDENTIAL_CLAUSE_SEED.map((c) => c.key).sort().join(",") === [
  "alterations","appliances","custom_property","early_access","flat_monthly_charges",
  "keys_locks","outdoor_space","parking","pets","prorated_rent","seasonal_ac","smoking",
  "storage","tenant_insurance","utilities","utility_account_setup",
].join(","));
ok("seed keys are unique", new Set(RESIDENTIAL_CLAUSE_SEED.map((c) => c.key)).size === RESIDENTIAL_CLAUSE_SEED.length);
ok("seed keys are valid identifiers", RESIDENTIAL_CLAUSE_SEED.every((c) => /^[a-z0-9_]+$/.test(c.key)));
ok("seed applicabilities are valid", RESIDENTIAL_CLAUSE_SEED.every((c) => isClauseApplicability(c.applicableTo)));
ok("seed risk levels are valid", RESIDENTIAL_CLAUSE_SEED.every((c) => isRiskLevel(c.riskLevel)));
ok("seed jurisdictions are valid", RESIDENTIAL_CLAUSE_SEED.every((c) => isJurisdiction(c.jurisdiction)));
ok("seed categories are all from the 6 practical buckets", RESIDENTIAL_CLAUSE_SEED.every((c) => categoryOrder(c.category) < CLAUSE_CATEGORIES.length));
ok("seed notes_for_landlord all present", RESIDENTIAL_CLAUSE_SEED.every((c) => c.notesForLandlord.trim().length > 0));
ok("seed bodies non-empty", RESIDENTIAL_CLAUSE_SEED.every((c) => c.body.trim().length > 0));
ok("seed validates through validateClauseInput", RESIDENTIAL_CLAUSE_SEED.every((c) => validateClauseInput(c).ok));
// Ontario guardrails baked into the seed
const petsSeed = RESIDENTIAL_CLAUSE_SEED.find((c) => c.key === "pets")!;
ok("seed pets is renamed to Pets / Condo or Building Rules", petsSeed.title === "Pets / Condo or Building Rules");
ok("seed pets cites RTA s.14 (never a void no-pets clause)", petsSeed.body.includes("section 14") && !/no pets/i.test(petsSeed.body));
ok("seed pets is flagged caution", petsSeed.riskLevel === "caution");
ok("seed custom clause is flagged legal_review + custom jurisdiction", (() => {
  const cp = RESIDENTIAL_CLAUSE_SEED.find((c) => c.key === "custom_property")!;
  return cp.riskLevel === "legal_review" && cp.jurisdiction === "custom";
})());
ok("seed flat_monthly_charges + smoking + keys flagged caution", ["flat_monthly_charges","smoking","keys_locks"].every((k) => RESIDENTIAL_CLAUSE_SEED.find((c) => c.key === k)!.riskLevel === "caution"));
ok("seed bodies use hyphens not em dashes", RESIDENTIAL_CLAUSE_SEED.every((c) => !c.body.includes("—")));
// Seasonal AC (intake item B) — a legitimate, enforceable seasonal install clause.
const acSeed = RESIDENTIAL_CLAUSE_SEED.find((c) => c.key === "seasonal_ac")!;
ok("seed seasonal_ac present + titled", acSeed.title === "Seasonal Air Conditioner");
ok("seed seasonal_ac is residential + standard risk", acSeed.applicableTo === "residential" && acSeed.riskLevel === "standard");
ok("seed seasonal_ac filed under Maintenance / Access", acSeed.category === "Maintenance / Access");
ok("seed seasonal_ac body covers supply-on-request + tenant install/remove", /on the Tenant's request/i.test(acSeed.body) && /install/i.test(acSeed.body) && /remov/i.test(acSeed.body));
ok("seed seasonal_ac body carries no unfilled tokens", tokensInBody(acSeed.body).length === 0);

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
// build a vars map covering every token referenced across the seed bodies, so a
// fully-filled assembly leaves nothing unresolved (catches a typo'd token).
const allSeedTokens = Array.from(
  new Set(RESIDENTIAL_CLAUSE_SEED.flatMap((c) => tokensInBody(c.body))),
);
const fullSeedVars: Record<string, string> = {};
for (const t of allSeedTokens) fullSeedVars[t] = "[" + t + "]";
const seedAssembled = assembleClauses(seedAsResolved, { leaseType: "residential", vars: fullSeedVars });
const residentialSeedCount = RESIDENTIAL_CLAUSE_SEED.filter((c) => c.applicableTo !== "commercial").length;
ok("seed assembles every residential-applicable clause", seedAssembled.clauses.length === residentialSeedCount);
ok("seed assembly fully resolved when every token is supplied", seedAssembled.unresolved.length === 0);
ok("seed pets clause cites RTA s.14 in assembly", seedAssembled.clauses.find((c) => c.key === "pets")!.rendered.includes("section 14"));
// commercial lease drops the residential-only seed clauses
const seedCommercial = assembleClauses(seedAsResolved, { leaseType: "commercial", vars: {} });
ok("seed commercial excludes residential-only clauses", seedCommercial.excluded.map((e) => e.key).sort().join(",") === "flat_monthly_charges,outdoor_space,pets,seasonal_ac,utilities,utility_account_setup");

// --- recommendClauses (smart recommendations) -------------------------------
const recBaseline = recommendClauses({});
ok("recommend baseline includes utilities + insurance + smoking", ["utilities","tenant_insurance","smoking"].every((k) => recBaseline.some((r) => r.key === k)));
ok("recommend parking when hasParking", recommendClauses({ hasParking: true }).some((r) => r.key === "parking"));
ok("recommend storage when hasStorage", recommendClauses({ hasStorage: true }).some((r) => r.key === "storage"));
ok("recommend outdoor_space when hasOutdoorSpace", recommendClauses({ hasOutdoorSpace: true }).some((r) => r.key === "outdoor_space"));
ok("recommend pets when petsRestricted", recommendClauses({ petsRestricted: true }).some((r) => r.key === "pets"));
ok("recommend utility_account_setup when tenantPaysHydro", recommendClauses({ tenantPaysHydro: true }).some((r) => r.key === "utility_account_setup"));
ok("recommend early_access pairs with tenant_insurance", (() => {
  const r = recommendClauses({ hasEarlyAccess: true });
  return r.some((x) => x.key === "early_access") && r.some((x) => x.key === "tenant_insurance");
})());
ok("recommend prorated_rent when hasProratedRent", recommendClauses({ hasProratedRent: true }).some((r) => r.key === "prorated_rent"));
ok("recommend appliances when appliancesIncluded", recommendClauses({ appliancesIncluded: true }).some((r) => r.key === "appliances"));
ok("recommend custom_property when propertySpecific", recommendClauses({ propertySpecific: true }).some((r) => r.key === "custom_property"));
ok("recommend de-dupes keys", (() => {
  const r = recommendClauses({ hasEarlyAccess: true }); // tenant_insurance both baseline + early-access
  return r.filter((x) => x.key === "tenant_insurance").length === 1;
})());
ok("recommend keys all exist in the seed", recommendClauses({
  hasParking: true, parkingAtExtraCost: true, gasFlatFee: true, tenantPaysHydro: true,
  hasStorage: true, hasOutdoorSpace: true, petsRestricted: true, hasEarlyAccess: true,
  hasProratedRent: true, appliancesIncluded: true, propertySpecific: true,
}).every((r) => RESIDENTIAL_CLAUSE_SEED.some((c) => c.key === r.key)));

// --- resolveCurrentClauses (the DB-rows -> ResolvedClause[] join) ------------
const clauseRows: ClauseRowLike[] = [
  { id: "c_pets", key: "pets", title: "Pets", applicable_to: "residential" },
  { id: "c_parking", key: "parking", title: "Parking", applicable_to: "both" },
  { id: "c_storage", key: "storage", title: "Storage", applicable_to: "both" },
];
const versionRows: ClauseVersionRowLike[] = [
  { id: "pv1", clause_id: "c_pets", version: 1, is_current: false, body: "Pets v1." },
  { id: "pv2", clause_id: "c_pets", version: 2, is_current: true, body: "Pets v2." },
  { id: "kv1", clause_id: "c_parking", version: 1, is_current: true, body: "Parking {{parking_fee}}." },
  // c_storage has versions but NONE current -> must be skipped
  { id: "sv1", clause_id: "c_storage", version: 1, is_current: false, body: "Storage v1." },
];
const resolved = resolveCurrentClauses(clauseRows, versionRows);
ok("resolve skips clauses with no current version", resolved.map((c) => c.key).join(",") === "pets,parking");
ok("resolve picks the current version body", resolved[0].body === "Pets v2." && resolved[0].version === 2);
ok("resolve maps applicable_to -> applicableTo", resolved[1].applicableTo === "both");
ok("resolve carries versionId + clauseId", resolved[0].versionId === "pv2" && resolved[0].clauseId === "c_pets");
ok("resolve preserves input clause order", resolveCurrentClauses(
  [clauseRows[1], clauseRows[0]],
  versionRows,
).map((c) => c.key).join(",") === "parking,pets");
ok("resolve empty when no current versions", resolveCurrentClauses(clauseRows, [
  { id: "x", clause_id: "c_pets", version: 1, is_current: false, body: "x" },
]).length === 0);

// the resolved current versions assemble + snapshot end to end
const resolvedAssembled = assembleClauses(resolved, { leaseType: "residential", vars: { parking_fee: "$60" } });
ok("resolved clauses assemble", resolvedAssembled.text === "Pets v2.\n\nParking $60.");
ok("resolved snapshot pins the current versions", buildExecutedSnapshot(resolvedAssembled).map((c) => `${c.key}@${c.version}`).join(",") === "pets@2,parking@1");

// --- buildLeaseVars (tenancy/unit -> token map) -----------------------------
const vars = buildLeaseVars({
  propertyAddress: " 833 Pillette Rd ",
  parkingSpaces: "1",
  parkingFee: "$50",
  tenantUtilities: "hydro",
  includedUtilities: "",        // blank -> omitted
  storageDescription: null,      // null -> omitted
  rent: "1250",
});
ok("buildLeaseVars trims values", vars.property_address === "833 Pillette Rd");
ok("buildLeaseVars maps camelCase source -> snake token", vars.parking_spaces === "1" && vars.parking_fee === "$50");
ok("buildLeaseVars omits blank values", !("included_utilities" in vars));
ok("buildLeaseVars omits null values", !("storage_description" in vars));
ok("buildLeaseVars keeps provided rent", vars.rent === "1250");
ok("buildLeaseVars empty source -> empty map", Object.keys(buildLeaseVars({})).length === 0);
// buildLeaseVars supplies the record-derivable tokens, so the clauses whose
// tokens are ALL record-derivable (parking, storage, utilities, pets) resolve
// cleanly from the tenancy record alone; the rest (e.g. key_deposit,
// insurance amounts, prorated values) are operator-filled at generation by
// design and stay visible as unresolved tokens until the operator supplies them.
const seedTokenVars = buildLeaseVars({
  propertyAddress: "1 Test St",
  parkingSpaces: "1",
  parkingFee: "$50",
  tenantUtilities: "hydro",
  includedUtilities: "water and heat",
  storageDescription: "one locker",
});
const recordDerivableKeys = ["parking", "storage", "utilities", "pets"];
const recordDerivable = seedAsResolved.filter((c) => recordDerivableKeys.includes(c.key));
ok("buildLeaseVars resolves the record-derivable seed clauses cleanly", assembleClauses(recordDerivable, { leaseType: "residential", vars: seedTokenVars }).unresolved.length === 0);

// --- Clause-selection wizard glue (slice 7) ---------------------------------

// CANONICAL_LEASE_TOKENS / isCanonicalLeaseToken
ok("canonical tokens include the record-derived set", CANONICAL_LEASE_TOKENS.includes("rent") && CANONICAL_LEASE_TOKENS.includes("property_address"));
ok("isCanonicalLeaseToken true for a record token (any case)", isCanonicalLeaseToken("Start_Date"));
ok("isCanonicalLeaseToken false for an operator token", !isCanonicalLeaseToken("parking_fee"));

// annotateRecommendations: marks recommended clauses + carries the reason, in
// library order, and drops recommendations whose key the org doesn't have.
const recs = recommendClauses({ hasParking: true, hasStorage: true });
const annotated = annotateRecommendations(seedAsResolved, recs);
ok("annotateRecommendations preserves library order + count", annotated.length === seedAsResolved.length && annotated[0].key === seedAsResolved[0].key);
ok("annotateRecommendations flags a recommended clause with its reason", (() => { const p = annotated.find((c) => c.key === "parking"); return !!p && p.recommended && !!p.recommendReason; })());
ok("annotateRecommendations leaves a non-recommended clause unflagged", (() => { const a = annotated.find((c) => c.key === "alterations"); return !!a && !a.recommended && a.recommendReason === null; })());
ok("annotateRecommendations drops a recommended key absent from the library", (() => {
  const tiny = seedAsResolved.filter((c) => c.key === "smoking"); // baseline recs incl. utilities/tenant_insurance not present here
  const ann = annotateRecommendations(tiny, recommendClauses({}));
  return ann.length === 1 && ann[0].key === "smoking" && ann[0].recommended; // smoking IS a baseline rec
})());

// selectClausesById: keeps library order, filters to chosen, drops forged ids.
const picked = selectClausesById(seedAsResolved, [seedAsResolved[3].clauseId, seedAsResolved[1].clauseId, "forged-id"]);
ok("selectClausesById keeps only chosen ids", picked.length === 2);
ok("selectClausesById preserves library order (not arg order)", picked[0].clauseId === seedAsResolved[1].clauseId && picked[1].clauseId === seedAsResolved[3].clauseId);
ok("selectClausesById drops a forged id", !picked.some((c) => c.clauseId === "forged-id"));
ok("selectClausesById empty selection -> empty", selectClausesById(seedAsResolved, []).length === 0);

// collectVarFields: prefix strip, lowercase, empty-drop.
const collected = collectVarFields([
  ["var_parking_fee", " $50 "],
  ["var_KEY_DEPOSIT", "100"],
  ["var_blank", "   "],
  ["tenancy_id", "abc"], // no prefix -> ignored
  ["var_", "x"], // empty token -> ignored
]);
ok("collectVarFields strips the prefix", collected.parking_fee === "$50");
ok("collectVarFields lowercases the token", collected.key_deposit === "100");
ok("collectVarFields drops blank values", !("blank" in collected));
ok("collectVarFields ignores unprefixed fields", !("tenancy_id" in collected));
ok("collectVarFields ignores an empty token", Object.keys(collected).length === 2);

// End-to-end glue: record vars + collected vars assemble the chosen clauses.
const wizRecordVars = buildLeaseVars({ propertyAddress: "1 Test St", tenantName: "Pat", rent: "1250" });
const wizChosen = selectClausesById(seedAsResolved, [
  seedAsResolved.find((c) => c.key === "parking")!.clauseId,
  seedAsResolved.find((c) => c.key === "utilities")!.clauseId,
]);
const wizVars = { ...collectVarFields([["var_parking_spaces", "1"], ["var_parking_fee", "$50"], ["var_tenant_utilities", "hydro"], ["var_included_utilities", "water and heat"]]), ...wizRecordVars };
const wizAssembled = assembleClauses(wizChosen, { leaseType: "residential", vars: wizVars });
ok("wizard glue assembles exactly the chosen clauses", wizAssembled.clauses.length === 2);
ok("wizard glue resolves operator-filled + record tokens together", wizAssembled.unresolved.length === 0);

// ----------------------------------------------------------------------------
console.log(`clauses: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
