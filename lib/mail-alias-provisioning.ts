import { validateMailAlias } from "./email-ingest";

export const MAIL_ALIAS_PROVISION_STATUSES = [
  "requested",
  "reserved",
  "provider_pending",
  "provider_verified",
  "active",
  "needs_forward_update",
  "failed",
  "disabled",
] as const;

export type MailAliasProvisionStatus = (typeof MAIL_ALIAS_PROVISION_STATUSES)[number];

export const OPEN_MAIL_ALIAS_PROVISION_STATUSES: MailAliasProvisionStatus[] =
  MAIL_ALIAS_PROVISION_STATUSES.filter((status) => status !== "disabled");

const STATUS_LABELS: Record<MailAliasProvisionStatus, string> = {
  requested: "Requested",
  reserved: "Reserved",
  provider_pending: "Provider pending",
  provider_verified: "Provider verified",
  active: "Active",
  needs_forward_update: "Needs forwarding update",
  failed: "Failed",
  disabled: "Disabled",
};

export type MailAliasProvisionRequestResult =
  | { ok: true; value: string }
  | { ok: false; reason: "required" | "shape" | "reserved" };

export type MailAliasProvisionActivationInput = {
  requested_alias: string | null;
  status: string | null;
  expected_forward_to_email: string | null;
  expected_ingest_email: string | null;
  provider_forward_readback?: string[] | null;
};

export function isMailAliasProvisionStatus(
  value: unknown,
): value is MailAliasProvisionStatus {
  return (
    typeof value === "string" &&
    (MAIL_ALIAS_PROVISION_STATUSES as readonly string[]).includes(value)
  );
}

export function mailAliasProvisionStatusLabel(status: unknown): string {
  return isMailAliasProvisionStatus(status) ? STATUS_LABELS[status] : "Unknown";
}

export function isOpenMailAliasProvisionStatus(status: unknown): boolean {
  return isMailAliasProvisionStatus(status) && status !== "disabled";
}

export function mailAliasEmailFor(alias: string): string {
  return `${alias}@vacantless.com`;
}

export function expectedMailAliasIngestEmail(
  alias: string,
  ingestDomain = "in.vacantless.com",
): string {
  return `${alias}@${ingestDomain}`;
}

export function validateMailAliasProvisionRequest(
  input: unknown,
): MailAliasProvisionRequestResult {
  const result = validateMailAlias(input);
  if (!result.ok) return { ok: false, reason: result.reason };
  if (!result.value) return { ok: false, reason: "required" };
  return { ok: true, value: result.value };
}

function normEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function providerForwardingMatches(args: {
  providerForwardReadback: readonly string[] | null | undefined;
  expectedForwardToEmail: string | null | undefined;
  expectedIngestEmail: string | null | undefined;
}): boolean {
  const readback = new Set(
    (args.providerForwardReadback ?? []).map((value) => normEmail(value)).filter(Boolean),
  );
  const expectedForward = normEmail(args.expectedForwardToEmail);
  const expectedIngest = normEmail(args.expectedIngestEmail);
  return (
    Boolean(expectedForward) &&
    Boolean(expectedIngest) &&
    readback.has(expectedForward) &&
    readback.has(expectedIngest)
  );
}

export function canActivateMailAliasProvision(
  row: MailAliasProvisionActivationInput,
): boolean {
  const alias = validateMailAliasProvisionRequest(row.requested_alias);
  if (!alias.ok) return false;
  if (row.status !== "provider_verified") return false;
  return providerForwardingMatches({
    providerForwardReadback: row.provider_forward_readback,
    expectedForwardToEmail: row.expected_forward_to_email,
    expectedIngestEmail:
      row.expected_ingest_email ?? expectedMailAliasIngestEmail(alias.value),
  });
}
