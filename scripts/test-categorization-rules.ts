// Unit tests for the pure categorization-rules engine.
// Run: npx tsx scripts/test-categorization-rules.ts
import {
  normalizeMerchant,
  ruleMatchesTxn,
  ruleSpecificity,
  bestRuleForTxn,
  ruleAutoFiles,
  resolveRuleAssignment,
  validateRuleInput,
  draftRuleFromAssignment,
  type CategorizationRule,
  type MatchableTxn,
} from "../lib/categorization-rules";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- normalizeMerchant -------------------------------------------------------
ok("normalize lowercases + strips punctuation", normalizeMerchant("FACEBK *YK0N-FUM2L2") === "facebk yk0n fum2l2");
ok("normalize collapses whitespace", normalizeMerchant("  Rogers   Communications ") === "rogers communications");
ok("normalize empty -> null", normalizeMerchant("") === null);
ok("normalize null -> null", normalizeMerchant(null) === null);

// --- A base rule + txn -------------------------------------------------------
function rule(partial: Partial<CategorizationRule>): CategorizationRule {
  return {
    scopeKind: "merchant",
    merchantEntityId: null,
    streamId: null,
    merchantNorm: null,
    accountExternalId: null,
    amountMinCents: null,
    amountMaxCents: null,
    dayMin: null,
    dayMax: null,
    category: "other",
    propertyId: null,
    buildingKey: null,
    ...partial,
  };
}
function txn(partial: Partial<MatchableTxn>): MatchableTxn {
  return {
    merchantEntityId: null,
    streamId: null,
    merchant: null,
    accountExternalId: null,
    amountCents: 0,
    postedOn: "2026-06-15",
    ...partial,
  };
}

// --- ruleMatchesTxn: identity ------------------------------------------------
ok(
  "no identity key matches nothing",
  ruleMatchesTxn(rule({}), txn({ merchant: "Rogers" })) === false,
);
ok(
  "stream_id matches",
  ruleMatchesTxn(rule({ streamId: "str_1" }), txn({ streamId: "str_1" })) === true,
);
ok(
  "stream_id mismatch fails",
  ruleMatchesTxn(rule({ streamId: "str_1" }), txn({ streamId: "str_2" })) === false,
);
ok(
  "merchant_entity_id matches",
  ruleMatchesTxn(rule({ merchantEntityId: "mch_x" }), txn({ merchantEntityId: "mch_x" })) === true,
);
ok(
  "merchant_norm matches normalized txn merchant (case/punct-insensitive)",
  ruleMatchesTxn(rule({ merchantNorm: "rogers" }), txn({ merchant: "  ROGERS. " })) === true,
);
ok(
  "merchant_norm mismatch fails",
  ruleMatchesTxn(rule({ merchantNorm: "enbridge" }), txn({ merchant: "Rogers" })) === false,
);

// --- ruleMatchesTxn: narrowers ----------------------------------------------
const r = rule({ merchantEntityId: "mch_x", accountExternalId: "acc_1", amountMinCents: 9000, amountMaxCents: 11000, dayMin: 1, dayMax: 5 });
ok("narrowers all satisfied", ruleMatchesTxn(r, txn({ merchantEntityId: "mch_x", accountExternalId: "acc_1", amountCents: 10000, postedOn: "2026-06-03" })) === true);
ok("wrong account fails", ruleMatchesTxn(r, txn({ merchantEntityId: "mch_x", accountExternalId: "acc_2", amountCents: 10000, postedOn: "2026-06-03" })) === false);
ok("amount below band fails", ruleMatchesTxn(r, txn({ merchantEntityId: "mch_x", accountExternalId: "acc_1", amountCents: 8000, postedOn: "2026-06-03" })) === false);
ok("amount above band fails", ruleMatchesTxn(r, txn({ merchantEntityId: "mch_x", accountExternalId: "acc_1", amountCents: 12000, postedOn: "2026-06-03" })) === false);
ok("day after window fails", ruleMatchesTxn(r, txn({ merchantEntityId: "mch_x", accountExternalId: "acc_1", amountCents: 10000, postedOn: "2026-06-20" })) === false);
ok("amount band inclusive at edges", ruleMatchesTxn(rule({ merchantEntityId: "m", amountMinCents: 100, amountMaxCents: 200 }), txn({ merchantEntityId: "m", amountCents: 200 })) === true);

// --- The same-vendor-many-properties case (the headline) --------------------
// Two Rogers plans, distinct Plaid streams, each filed to a different unit.
const rogersUnit22 = rule({ scopeKind: "stream", streamId: "rec_aaa", category: "utilities", propertyId: "unit-22" });
const rogersUnit27 = rule({ scopeKind: "stream", streamId: "rec_bbb", category: "utilities", propertyId: "unit-27" });
const txU22 = txn({ streamId: "rec_aaa", merchant: "ROGERS", merchantEntityId: "mch_rogers", amountCents: 8999 });
const txU27 = txn({ streamId: "rec_bbb", merchant: "ROGERS", merchantEntityId: "mch_rogers", amountCents: 12500 });
ok("Rogers stream A files to unit 22", bestRuleForTxn([rogersUnit22, rogersUnit27], txU22)?.propertyId === "unit-22");
ok("Rogers stream B files to unit 27", bestRuleForTxn([rogersUnit22, rogersUnit27], txU27)?.propertyId === "unit-27");
ok("a third Rogers stream matches neither", bestRuleForTxn([rogersUnit22, rogersUnit27], txn({ streamId: "rec_ccc", merchantEntityId: "mch_rogers" })) === null);

// --- Specificity: stream rule beats a broad merchant rule -------------------
const broad = rule({ merchantEntityId: "mch_rogers", category: "utilities" });
const scoped = rule({ scopeKind: "stream", streamId: "rec_aaa", category: "utilities", propertyId: "unit-22" });
ok("stream rule more specific than merchant rule", ruleSpecificity(scoped) > ruleSpecificity(broad));
ok("best rule prefers the specific stream rule", bestRuleForTxn([broad, scoped], txU22)?.propertyId === "unit-22");

// --- ruleAutoFiles -----------------------------------------------------------
ok("scoped (property) rule auto-files", ruleAutoFiles(scoped) === true);
ok("building-scoped rule auto-files", ruleAutoFiles(rule({ merchantEntityId: "m", buildingKey: "100-king" })) === true);
ok("category-only merchant rule does NOT auto-file", ruleAutoFiles(broad) === false);

// --- resolveRuleAssignment ---------------------------------------------------
const asg = resolveRuleAssignment(scoped);
ok("assignment carries category + scope", asg.category === "utilities" && asg.propertyId === "unit-22" && asg.buildingKey === null);
ok("unknown category resolves to other", resolveRuleAssignment(rule({ merchantEntityId: "m", category: "zzz" })).category === "other");

// --- validateRuleInput -------------------------------------------------------
ok("valid merchant rule", validateRuleInput({ scopeKind: "merchant", merchantEntityId: "m", category: "utilities" }).ok === true);
ok("bad scope_kind rejected", validateRuleInput({ scopeKind: "nope", merchantEntityId: "m" }).ok === false);
ok("no identity key rejected", (() => { const v = validateRuleInput({ scopeKind: "merchant", category: "utilities" }); return !v.ok && v.code === "identity"; })());
ok("both property + building rejected", (() => { const v = validateRuleInput({ scopeKind: "stream", streamId: "s", propertyId: "p", buildingKey: "b" }); return !v.ok && v.code === "scope"; })());
ok("bad category rejected", (() => { const v = validateRuleInput({ scopeKind: "merchant", merchantEntityId: "m", category: "spaceship" }); return !v.ok && v.code === "category"; })());
ok("inverted amount band rejected", (() => { const v = validateRuleInput({ scopeKind: "stream", streamId: "s", amountMinCents: 5000, amountMaxCents: 1000 }); return !v.ok && v.code === "band"; })());
ok("blank strings normalize to null identity -> rejected", validateRuleInput({ scopeKind: "merchant", merchantEntityId: "  ", merchantNorm: "" }).ok === false);
ok("empty category defaults to other", (() => { const v = validateRuleInput({ scopeKind: "merchant", merchantEntityId: "m", category: "" }); return v.ok && v.value.category === "other"; })());

// --- draftRuleFromAssignment -------------------------------------------------
// merchant scope: keys on entity id, no property, category only.
const dMerchant = draftRuleFromAssignment(
  { merchantEntityId: "mch_fb", streamId: null, merchant: "FACEBK *YK0N", accountExternalId: "acc_amex", amountCents: 5763 },
  { scopeKind: "merchant", category: "advertising", propertyId: "unit-22" },
)!;
ok("merchant draft keys on entity id", dMerchant.merchantEntityId === "mch_fb" && dMerchant.merchantNorm == null);
ok("merchant draft drops the property (broad)", dMerchant.propertyId == null && dMerchant.buildingKey == null);
ok("merchant draft validates", validateRuleInput(dMerchant).ok === true);

// merchant scope, no entity id: falls back to normalized name.
const dName = draftRuleFromAssignment(
  { merchantEntityId: null, streamId: null, merchant: "Enbridge Gas", accountExternalId: null, amountCents: 8000 },
  { scopeKind: "merchant", category: "utilities" },
)!;
ok("merchant draft falls back to merchant_norm", dName.merchantNorm === "enbridge gas" && dName.merchantEntityId == null);

// stream scope WITH stream_id: keys on the stream, carries scope.
const dStream = draftRuleFromAssignment(
  { merchantEntityId: "mch_rogers", streamId: "rec_aaa", merchant: "ROGERS", accountExternalId: "acc_1", amountCents: 8999 },
  { scopeKind: "stream", category: "utilities", propertyId: "unit-22" },
)!;
ok("stream draft keys on stream_id", dStream.streamId === "rec_aaa" && dStream.scopeKind === "stream");
ok("stream draft carries the property scope", dStream.propertyId === "unit-22");
ok("stream draft does NOT carry merchant id (stream is enough)", dStream.merchantEntityId == null);

// stream scope WITHOUT stream_id: falls back to merchant + account + amount band.
const dStreamFallback = draftRuleFromAssignment(
  { merchantEntityId: "mch_enbridge", streamId: null, merchant: "Enbridge", accountExternalId: "acc_1", amountCents: 8000 },
  { scopeKind: "stream", category: "utilities", buildingKey: "100-king", amountToleranceCents: 500 },
)!;
ok("stream fallback keys on merchant + account", dStreamFallback.merchantEntityId === "mch_enbridge" && dStreamFallback.accountExternalId === "acc_1");
ok("stream fallback builds an amount band", dStreamFallback.amountMinCents === 7500 && dStreamFallback.amountMaxCents === 8500);
ok("stream fallback carries building scope", dStreamFallback.buildingKey === "100-king");
ok("stream fallback validates", validateRuleInput(dStreamFallback).ok === true);

// no identity at all -> cannot draft.
ok(
  "draft with no signal returns null",
  draftRuleFromAssignment({ merchantEntityId: null, streamId: null, merchant: null, accountExternalId: null, amountCents: 0 }, { scopeKind: "merchant", category: "other" }) === null,
);

// A drafted stream-fallback rule actually matches its originating txn.
ok(
  "drafted fallback rule matches its own txn",
  ruleMatchesTxn(validateRuleInput(dStreamFallback).ok ? (validateRuleInput(dStreamFallback) as { value: CategorizationRule }).value : rule({}), txn({ merchantEntityId: "mch_enbridge", accountExternalId: "acc_1", amountCents: 8200 })) === true,
);

console.log(`\ncategorization-rules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
