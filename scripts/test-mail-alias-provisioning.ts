// Unit tests for S684/S685 mail-alias provisioning safety.
// Run: npx tsx scripts/test-mail-alias-provisioning.ts
import { readFileSync } from "node:fs";

import {
  canActivateMailAliasProvision,
  expectedMailAliasIngestEmail,
  isOpenMailAliasProvisionStatus,
  mailAliasProvisionForwardingReset,
  mailAliasEmailFor,
  mailAliasProvisionStatusLabel,
  providerForwardingMatches,
  validateMailAliasProvisionRequest,
} from "../lib/mail-alias-provisioning";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

{
  const result = validateMailAliasProvisionRequest("agile");
  ok("valid alias request passes", result.ok && result.value === "agile", result);
}

{
  const result = validateMailAliasProvisionRequest(" ");
  ok("blank alias request is required", !result.ok && result.reason === "required", result);
}

{
  const result = validateMailAliasProvisionRequest("Agile");
  ok("uppercase alias request fails shape", !result.ok && result.reason === "shape", result);
}

{
  const result = validateMailAliasProvisionRequest("leads");
  ok("reserved alias request fails reserved", !result.ok && result.reason === "reserved", result);
}

ok("alias email helper uses main domain", mailAliasEmailFor("agile") === "agile@vacantless.com");
ok(
  "ingest helper uses Postmark subdomain",
  expectedMailAliasIngestEmail("agile") === "agile@in.vacantless.com",
);

ok("reserved status is open", isOpenMailAliasProvisionStatus("reserved"));
ok("disabled status is closed", !isOpenMailAliasProvisionStatus("disabled"));
ok("unknown status is closed", !isOpenMailAliasProvisionStatus("mystery"));
ok(
  "status label falls back",
  mailAliasProvisionStatusLabel("mystery") === "Unknown",
);

ok(
  "provider readback matches both destinations",
  providerForwardingMatches({
    providerForwardReadback: ["Rentals@AgileOnline.ca", "agile@in.vacantless.com"],
    expectedForwardToEmail: "rentals@agileonline.ca",
    expectedIngestEmail: "agile@in.vacantless.com",
  }),
);

ok(
  "provider readback rejects missing ingest copy",
  !providerForwardingMatches({
    providerForwardReadback: ["rentals@agileonline.ca"],
    expectedForwardToEmail: "rentals@agileonline.ca",
    expectedIngestEmail: "agile@in.vacantless.com",
  }),
);

ok(
  "provider verified row can activate when readback matches",
  canActivateMailAliasProvision({
    requested_alias: "agile",
    status: "provider_verified",
    expected_forward_to_email: "rentals@agileonline.ca",
    expected_ingest_email: "agile@in.vacantless.com",
    provider_forward_readback: ["rentals@agileonline.ca", "agile@in.vacantless.com"],
  }),
);

ok(
  "reserved row cannot activate",
  !canActivateMailAliasProvision({
    requested_alias: "agile",
    status: "reserved",
    expected_forward_to_email: "rentals@agileonline.ca",
    expected_ingest_email: "agile@in.vacantless.com",
    provider_forward_readback: ["rentals@agileonline.ca", "agile@in.vacantless.com"],
  }),
);

ok(
  "provider verified row cannot activate when forwarding is stale",
  !canActivateMailAliasProvision({
    requested_alias: "agile",
    status: "provider_verified",
    expected_forward_to_email: "new@example.com",
    expected_ingest_email: "agile@in.vacantless.com",
    provider_forward_readback: ["rentals@agileonline.ca", "agile@in.vacantless.com"],
  }),
);

{
  const reset = mailAliasProvisionForwardingReset({
    requestedAlias: "north-star-rentals-qa",
    nextReplyToEmail: "noam@royallepage.ca",
    checkedAt: "2026-08-22T21:43:06.569Z",
  });
  ok(
    "reply-to change reset scrubs stale provider verification",
    reset.status === "needs_forward_update" &&
      reset.expected_forward_to_email === "noam@royallepage.ca" &&
      reset.expected_ingest_email === "north-star-rentals-qa@in.vacantless.com" &&
      Array.isArray(reset.provider_forward_readback) &&
      reset.provider_forward_readback.length === 0 &&
      reset.provider_verified_at === null &&
      reset.activated_at === null &&
      reset.last_checked_at === "2026-08-22T21:43:06.569Z" &&
      reset.updated_at === "2026-08-22T21:43:06.569Z",
    reset,
  );
}

{
  const migration = readFileSync(
    "supabase/migrations/0221_org_mail_alias_provisions.sql",
    "utf8",
  );
  ok(
    "migration revokes service_role defaults before DML grant",
    migration.includes(
      "revoke all on public.org_mail_alias_provisions from service_role;\n" +
        "grant select on public.org_mail_alias_provisions to authenticated;\n" +
        "grant select, insert, update, delete on public.org_mail_alias_provisions to service_role;",
    ),
  );
}

console.log(`\nmail-alias-provisioning: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
