// Unit tests for the pure role/capability model. Run: npx tsx scripts/test-roles.ts
import {
  ORG_ROLES,
  CAPABILITIES,
  type Capability,
  type OrgRole,
  isOrgRole,
  normalizeRole,
  roleCan,
  roleLabel,
  capabilitiesFor,
} from "../lib/roles";

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

// --- Role identity ---------------------------------------------------------
ok("isOrgRole accepts known roles", ORG_ROLES.every((r) => isOrgRole(r)));
ok("isOrgRole rejects unknown", !isOrgRole("superuser"));
ok("isOrgRole rejects null", !isOrgRole(null));
ok("isOrgRole rejects number", !isOrgRole(3));

// --- normalizeRole: unknown floors to MOST restrictive ---------------------
ok("normalizeRole keeps owner_admin", normalizeRole("owner_admin") === "owner_admin");
ok("normalizeRole keeps operator", normalizeRole("operator") === "operator");
ok("normalizeRole keeps showing_helper", normalizeRole("showing_helper") === "showing_helper");
ok("normalizeRole unknown -> showing_helper", normalizeRole("admin") === "showing_helper");
ok("normalizeRole null -> showing_helper", normalizeRole(null) === "showing_helper");
ok("normalizeRole empty -> showing_helper", normalizeRole("") === "showing_helper");

// --- owner_admin: everything ----------------------------------------------
ok(
  "owner_admin has every capability",
  CAPABILITIES.every((c) => roleCan("owner_admin", c)),
);

// --- operator: everything EXCEPT billing -----------------------------------
ok("operator cannot manage_billing", !roleCan("operator", "manage_billing"));
ok(
  "operator has every non-billing capability",
  CAPABILITIES.filter((c) => c !== "manage_billing").every((c) =>
    roleCan("operator", c),
  ),
);

// --- showing_helper: only add_notes + manage_showings ----------------------
const HELPER_ALLOWED: Capability[] = ["add_notes", "manage_showings"];
ok(
  "showing_helper has exactly its two job capabilities",
  HELPER_ALLOWED.every((c) => roleCan("showing_helper", c)),
);
ok(
  "showing_helper has nothing else",
  CAPABILITIES.filter((c) => !HELPER_ALLOWED.includes(c)).every(
    (c) => !roleCan("showing_helper", c),
  ),
);
ok("showing_helper cannot manage_billing", !roleCan("showing_helper", "manage_billing"));
ok("showing_helper cannot manage_settings", !roleCan("showing_helper", "manage_settings"));
ok("showing_helper cannot manage_properties", !roleCan("showing_helper", "manage_properties"));
ok("showing_helper cannot view_reports", !roleCan("showing_helper", "view_reports"));

// --- Billing is owner-only (the audit C1 invariant) ------------------------
ok(
  "manage_billing is owner_admin-only",
  ORG_ROLES.filter((r) => roleCan(r, "manage_billing")).join(",") === "owner_admin",
);

// --- Unknown role can never over-grant -------------------------------------
ok("unknown role cannot manage_billing", !roleCan("root", "manage_billing"));
ok("unknown role cannot manage_settings", !roleCan("root", "manage_settings"));
ok(
  "unknown role behaves exactly like showing_helper",
  CAPABILITIES.every((c) => roleCan("root", c) === roleCan("showing_helper", c)),
);

// --- capabilitiesFor + labels ----------------------------------------------
ok("capabilitiesFor(owner_admin) is full set", capabilitiesFor("owner_admin").length === CAPABILITIES.length);
ok("capabilitiesFor(operator) drops one (billing)", capabilitiesFor("operator").length === CAPABILITIES.length - 1);
ok("capabilitiesFor(showing_helper) is 2", capabilitiesFor("showing_helper").length === 2);
ok("roleLabel owner_admin", roleLabel("owner_admin") === "Owner / admin");
ok("roleLabel operator", roleLabel("operator") === "Operator");
ok("roleLabel showing_helper", roleLabel("showing_helper") === "Viewing helper");
ok("roleLabel unknown -> helper label", roleLabel("xyz") === "Viewing helper");

// --- Matrix monotonicity: owner >= operator >= helper ----------------------
ok(
  "operator capabilities are a subset of owner_admin",
  (capabilitiesFor("operator") as Capability[]).every((c) => roleCan("owner_admin", c)),
);
ok(
  "helper capabilities are a subset of operator",
  (capabilitiesFor("showing_helper") as Capability[]).every((c) => roleCan("operator", c)),
);

console.log(`\nroles: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
