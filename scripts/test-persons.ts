// Unit tests for the pure per-person vault domain model (lib/persons.ts).
// Run: npx tsx scripts/test-persons.ts
import {
  normalizeEmail,
  personMatchKey,
  matchPerson,
  planResolvePerson,
  personDisplayName,
  dedupeById,
  mergePersonDocuments,
  sortVaultTenancies,
  sortPeople,
  type PersonMatchRow,
  type VaultDocument,
} from "../lib/persons";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- normalizeEmail ---------------------------------------------------------
ok("normalizeEmail lowercases + trims", normalizeEmail("  Pat@Example.COM ") === "pat@example.com");
ok("normalizeEmail blank -> null", normalizeEmail("   ") === null);
ok("normalizeEmail null -> null", normalizeEmail(null) === null);
ok("normalizeEmail undefined -> null", normalizeEmail(undefined) === null);

// --- personMatchKey ---------------------------------------------------------
ok(
  "personMatchKey prefers email",
  personMatchKey({ email_norm: "a@b.com", phone_e164: "+15551234567" }) === "a@b.com",
);
ok(
  "personMatchKey falls back to phone",
  personMatchKey({ email_norm: null, phone_e164: "+15551234567" }) === "+15551234567",
);
ok("personMatchKey null when neither", personMatchKey({ email_norm: null, phone_e164: null }) === null);

// --- matchPerson ------------------------------------------------------------
const people: PersonMatchRow[] = [
  { id: "p1", email_norm: "pat@example.com", phone_e164: "+15550000001" },
  { id: "p2", email_norm: null, phone_e164: "+15550000002" },
  { id: "p3", email_norm: "sam@example.com", phone_e164: null },
];
ok(
  "matchPerson by email",
  matchPerson(people, { email_norm: "pat@example.com", phone_e164: null })?.id === "p1",
);
ok(
  "matchPerson by phone when no email",
  matchPerson(people, { email_norm: null, phone_e164: "+15550000002" })?.id === "p2",
);
ok(
  "matchPerson email beats phone (precedence)",
  // email points at p3, phone points at p2 -> email wins
  matchPerson(people, { email_norm: "sam@example.com", phone_e164: "+15550000002" })?.id === "p3",
);
ok(
  "matchPerson no match -> null",
  matchPerson(people, { email_norm: "new@example.com", phone_e164: "+15559999999" }) === null,
);
ok(
  "matchPerson ignores null keys on both sides",
  matchPerson(
    [{ id: "x", email_norm: null, phone_e164: null }],
    { email_norm: null, phone_e164: null },
  ) === null,
);

// --- planResolvePerson ------------------------------------------------------
const existPlan = planResolvePerson(people, { email_norm: "pat@example.com", phone_e164: null });
ok("planResolvePerson existing", existPlan.kind === "existing" && existPlan.id === "p1");
const createPlan = planResolvePerson(people, { email_norm: "fresh@example.com", phone_e164: "+15551112222" });
ok(
  "planResolvePerson create carries keys",
  createPlan.kind === "create" &&
    createPlan.email_norm === "fresh@example.com" &&
    createPlan.phone_e164 === "+15551112222",
);

// --- personDisplayName ------------------------------------------------------
ok("displayName uses name", personDisplayName({ full_name: " Jane Doe " }) === "Jane Doe");
ok("displayName falls to email", personDisplayName({ full_name: "", email: "jane@x.com" }) === "jane@x.com");
ok("displayName falls to phone", personDisplayName({ full_name: null, email: null, phone: "555-1212" }) === "555-1212");
ok("displayName ultimate fallback", personDisplayName({}) === "Unnamed person");

// --- dedupeById -------------------------------------------------------------
const deduped = dedupeById([{ id: "a" }, { id: "b" }, { id: "a" }]);
ok("dedupeById drops repeats", deduped.length === 2);
ok("dedupeById keeps first order", deduped[0].id === "a" && deduped[1].id === "b");

// --- mergePersonDocuments ---------------------------------------------------
type DocBase = Omit<VaultDocument, "signed_by_person">;
const viaTenancy: DocBase[] = [
  { id: "d1", tenancy_id: "t1", title: "Lease A", status: "draft", created_at: "2026-01-01T00:00:00Z", executed_at: null },
  { id: "d2", tenancy_id: "t1", title: "Lease B", status: "executed", created_at: "2026-03-01T00:00:00Z", executed_at: "2026-03-02T00:00:00Z" },
];
const viaSigner: DocBase[] = [
  // d2 also reached via signer (dup) + d3 only via signer (different tenancy)
  { id: "d2", tenancy_id: "t1", title: "Lease B", status: "executed", created_at: "2026-03-01T00:00:00Z", executed_at: "2026-03-02T00:00:00Z" },
  { id: "d3", tenancy_id: "t2", title: "Lease C", status: "executed", created_at: "2026-02-01T00:00:00Z", executed_at: "2026-02-02T00:00:00Z" },
];
const merged = mergePersonDocuments(viaTenancy, viaSigner, ["d2", "d3"]);
ok("merge dedupes the union", merged.length === 3);
ok("merge newest first", merged.map((d) => d.id).join(",") === "d2,d3,d1");
ok("merge flags signed docs", merged.find((d) => d.id === "d2")?.signed_by_person === true);
ok("merge flags d3 signed", merged.find((d) => d.id === "d3")?.signed_by_person === true);
ok("merge unsigned draft not flagged", merged.find((d) => d.id === "d1")?.signed_by_person === false);

// --- sortVaultTenancies -----------------------------------------------------
const tenancies = [
  { id: "x", property_address: "1 A St", status: "ended", start_date: "2024-01-01", end_date: "2025-01-01", is_primary: true },
  { id: "y", property_address: "2 B St", status: "active", start_date: "2025-06-01", end_date: null, is_primary: true },
  { id: "z", property_address: null, status: "active", start_date: null, end_date: null, is_primary: false },
];
const sortedT = sortVaultTenancies(tenancies);
ok("tenancies newest start first", sortedT[0].id === "y" && sortedT[1].id === "x");
ok("tenancies null start last", sortedT[2].id === "z");
ok("sortVaultTenancies is pure (no mutation)", tenancies[0].id === "x");

// --- sortPeople -------------------------------------------------------------
const ppl = [
  { id: "1", display_name: "zoe", email: null, phone: null, tenancy_count: 1, document_count: 0 },
  { id: "2", display_name: "Abe", email: null, phone: null, tenancy_count: 2, document_count: 3 },
];
const sortedP = sortPeople(ppl);
ok("sortPeople case-insensitive A before z", sortedP[0].display_name === "Abe");
ok("sortPeople is pure (no mutation)", ppl[0].display_name === "zoe");

// ----------------------------------------------------------------------------
console.log(`persons: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
