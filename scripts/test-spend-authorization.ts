// Source guards for S668 standing spend authorization.
// Run: npx tsx scripts/test-spend-authorization.ts
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const migration = readFileSync(
  "supabase/migrations/0217_distribution_channel_spend_authorization.sql",
  "utf8",
);
const settingsActions = readFileSync("app/dashboard/settings/actions.ts", "utf8");
const settingsPage = readFileSync("app/dashboard/settings/page.tsx", "utf8");
const distributionActions = readFileSync(
  "app/dashboard/properties/distribution-actions.ts",
  "utf8",
);
const propertyPage = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
const publishEverywhere = readFileSync(
  "app/dashboard/properties/[id]/publish-everywhere.tsx",
  "utf8",
);
const authenticatedLedgerGrants: string[] =
  migration.match(/^grant .* on public\.distribution_channel_spend to authenticated;$/gm) ??
  [];
const serviceRoleLedgerGrants: string[] =
  migration.match(/^grant .* on public\.distribution_channel_spend to service_role;$/gm) ??
  [];

ok(
  "migration extends existing distribution_channel_accounts",
  migration.includes("alter table public.distribution_channel_accounts") &&
    migration.includes("add column if not exists spend_authorized") &&
    migration.includes("add column if not exists spend_max_cents") &&
    !migration.includes("create table if not exists public.distribution_channel_accounts"),
);
ok(
  "migration enforces positive per-ad ceiling when authorized",
  migration.includes("distribution_channel_accounts_spend_authorized_check") &&
    migration.includes("spend_authorized = false") &&
    migration.includes("spend_max_cents is not null and spend_max_cents > 0"),
);
ok(
  "migration adds ledger with org-channel-month index and RLS",
  migration.includes("create table if not exists public.distribution_channel_spend") &&
    migration.includes("amount_cents              integer not null check (amount_cents > 0)") &&
    migration.includes("idx_distribution_channel_spend_org_channel_charged") &&
    migration.includes("alter table public.distribution_channel_spend enable row level security") &&
    migration.includes("distribution_channel_spend_read"),
);
ok(
  "migration keeps ledger append-only",
  migration.includes("revoke all on public.distribution_channel_spend from authenticated") &&
    authenticatedLedgerGrants.includes(
      "grant select on public.distribution_channel_spend to authenticated;",
    ) &&
    serviceRoleLedgerGrants.includes(
      "grant select, insert on public.distribution_channel_spend to service_role;",
    ) &&
    !authenticatedLedgerGrants.some((grant) => /\b(update|delete)\b/.test(grant)) &&
    !serviceRoleLedgerGrants.some((grant) => /\b(update|delete)\b/.test(grant)),
);
ok(
  "migration labels spend ledger as unwritten scaffolding",
  migration.includes("no runtime code writes this ledger yet") &&
    migration.includes("codex/s651-kijiji-paid-lane"),
);
ok(
  "migration provides account-checked claim CAS",
  migration.includes("claim_approved_distribution_run_item_for_worker") &&
    migration.includes("dca.spend_authorized = true") &&
    migration.includes("dca.spend_revoked_at is null") &&
    migration.includes("dca.spend_max_cents > 0") &&
    migration.includes("operator_submit_approved_at = null"),
);
ok(
  "migration refusal preserves approver identity and audits prior approver",
  !migration.includes("operator_submit_approved_by = null") &&
    migration.includes("Prior approver: %s") &&
    migration.includes("coalesce(prior_approver::text, 'unknown')"),
);

const updateDistribution = section(
  settingsActions,
  "export async function updateDistributionChannelAccount",
  "// Building STANDARD POLICY profile",
);
ok(
  "settings action parses CAD ceilings server-side",
  settingsActions.includes("function optionalCadCents") &&
    updateDistribution.includes('optionalCadCents(formData, "spend_max_cad")') &&
    updateDistribution.includes('optionalCadCents(formData, "spend_period_max_cad")'),
);
ok(
  "settings action grants and revokes on the same account row",
  updateDistribution.includes("payload.spend_authorized = true") &&
    updateDistribution.includes("payload.spend_authorized_at = nowISO") &&
    updateDistribution.includes("payload.spend_authorized_by = uid") &&
    updateDistribution.includes("payload.spend_revoked_at = null") &&
    updateDistribution.includes("payload.spend_authorized = false") &&
    updateDistribution.includes("payload.spend_revoked_at = cap.requiresPayment ? nowISO : null") &&
    updateDistribution.includes('{ onConflict: "organization_id,channel" }'),
);
ok(
  "settings action revoke preserves spend ceilings",
  !updateDistribution.includes("payload.spend_max_cents = null") &&
    !updateDistribution.includes("payload.spend_period_max_cents = null"),
);

ok(
  "settings page reads spend columns",
  settingsPage.includes("spend_authorized, spend_max_cents, spend_period_max_cents") &&
    settingsPage.includes("spend_revoked_at"),
);
ok(
  "settings page renders reversible paid-channel control",
  settingsPage.includes('name="spend_authorized"') &&
    settingsPage.includes('name="spend_max_cad"') &&
    settingsPage.includes('name="spend_period_max_cad"') &&
    settingsPage.includes("Authorize paid {meta.label} postings") &&
    settingsPage.includes("Revoked {new Date(account.spend_revoked_at).toLocaleDateString"),
);

const authorizeAutopilot = section(
  distributionActions,
  "export async function authorizeAutopilotSubmit",
  "export async function setRelistRadarStandingAutoRefresh",
);
ok(
  "autopilot approval requires standing spend auth for needs_payment",
  authorizeAutopilot.includes('pendingItem?.publish_status === "needs_payment"') &&
    authorizeAutopilot.includes('.select("spend_authorized, spend_max_cents, spend_revoked_at")') &&
    authorizeAutopilot.includes('backTo(propertyId, "autopilot_spend_auth"'),
);
ok(
  "old one-click payment-consent model was removed",
  !authorizeAutopilot.includes("approval consent covers both") &&
    !authorizeAutopilot.includes("consent to the site's listing fee"),
);
ok(
  "property page explains spend authorization failure",
  propertyPage.includes('searchParams.dist === "autopilot_spend_auth"') &&
    propertyPage.includes("Authorize a standing paid-channel ceiling in Settings"),
);
ok(
  "approval modal copy no longer says approve equals fee consent",
  publishEverywhere.includes("standing spend authorization") &&
    publishEverywhere.includes("Approve prepared post") &&
    !publishEverywhere.includes("Approving authorizes that charge"),
);

console.log(`spend-authorization: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
