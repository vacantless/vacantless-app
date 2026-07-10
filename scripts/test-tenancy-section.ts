// Unit tests for the tenancy detail page smart default-open (S286).
// Run: npx tsx scripts/test-tenancy-section.ts
import {
  pickDefaultOpenSection,
  type TenancyOpenInput,
} from "../lib/tenancy-section";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// A fully set-up, in-order tenancy: signed lease, automatic rent, no increase
// due. Each test overrides only the fields it cares about.
function inp(over: Partial<TenancyOpenInput> = {}): TenancyOpenInput {
  return {
    tenantCount: 1,
    leaseDocStatus: "Signed",
    rentCollectionStatus: "Automatic monthly debit",
    rentIncreaseStatus: null,
    ...over,
  };
}

console.log("tenancy-section: smart default-open");

// --- No tenants always wins -------------------------------------------------
ok(
  "no tenants -> tenants (even if other things look pending)",
  pickDefaultOpenSection(
    inp({
      tenantCount: 0,
      leaseDocStatus: "Not started",
      rentCollectionStatus: "Not set up",
    }),
  ) === "tenants",
);
ok(
  "negative/zero tenant count guarded -> tenants",
  pickDefaultOpenSection(inp({ tenantCount: -1 })) === "tenants",
);

// --- Rent increase is the most urgent once tenants exist --------------------
for (const s of ["serve_window", "serve_late", "overdue"] as const) {
  ok(
    `rent increase ${s} -> rent-increase`,
    pickDefaultOpenSection(inp({ rentIncreaseStatus: s })) === "rent-increase",
  );
}
ok(
  "rent increase outranks an unfinished lease",
  pickDefaultOpenSection(
    inp({ rentIncreaseStatus: "overdue", leaseDocStatus: "Draft" }),
  ) === "rent-increase",
);
ok(
  "rent increase 'scheduled' is NOT actionable -> falls through",
  pickDefaultOpenSection(inp({ rentIncreaseStatus: "scheduled" })) === "tenants",
);
ok(
  "rent increase 'exempt' is NOT actionable -> falls through",
  pickDefaultOpenSection(inp({ rentIncreaseStatus: "exempt" })) === "tenants",
);

// --- Lease document needs finishing -----------------------------------------
ok(
  "lease Not started -> lease-document",
  pickDefaultOpenSection(
    inp({ leaseDocStatus: "Not started", rentCollectionStatus: "Not set up" }),
  ) === "lease-document",
);
ok(
  "lease Draft -> lease-document",
  pickDefaultOpenSection(inp({ leaseDocStatus: "Draft" })) === "lease-document",
);
ok(
  "lease Sent for signature is waiting on tenant -> does NOT pull focus",
  pickDefaultOpenSection(
    inp({
      leaseDocStatus: "Sent for signature",
      rentCollectionStatus: "Not set up",
    }),
  ) === "rent-collection",
);
ok(
  "lease outranks rent collection when both pending",
  pickDefaultOpenSection(
    inp({ leaseDocStatus: "Draft", rentCollectionStatus: "Not set up" }),
  ) === "lease-document",
);

// --- Rent collection ---------------------------------------------------------
ok(
  "signed lease + rent not set up -> rent-collection",
  pickDefaultOpenSection(
    inp({ leaseDocStatus: "Signed", rentCollectionStatus: "Not set up" }),
  ) === "rent-collection",
);
ok(
  "authorized-but-not-scheduled is NOT 'Not set up' -> falls through",
  pickDefaultOpenSection(
    inp({ rentCollectionStatus: "Authorized — not scheduled" }),
  ) === "tenants",
);

// --- Fully in order falls back to the roster --------------------------------
ok(
  "everything set up -> tenants (old default)",
  pickDefaultOpenSection(inp()) === "tenants",
);
ok(
  "sent lease + automatic rent (nothing operator-actionable) -> tenants",
  pickDefaultOpenSection(
    inp({ leaseDocStatus: "Sent for signature" }),
  ) === "tenants",
);

// S450 (Codex #6): an UPLOADED lease PDF is a lease on file, so it must NOT pull
// focus to the lease-document section (unlike "Not started"/"Draft").
ok(
  "lease Uploaded -> does not open lease-document (rent-collection next)",
  pickDefaultOpenSection(
    inp({ leaseDocStatus: "Uploaded", rentCollectionStatus: "Not set up" }),
  ) === "rent-collection",
);
ok(
  "lease Uploaded, all in order -> tenants (not lease-document)",
  pickDefaultOpenSection(inp({ leaseDocStatus: "Uploaded" })) === "tenants",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
