// ============================================================================
// The admin email for a Realtor.ca / local-agent request (lib/brokerage-request).
// Operator-facing, not landlord copy, so it lives outside the plain-language
// surfaces. No DOM, no env, no IO.
// ============================================================================

import type { BrokerageRequestInput, BrokerageRequestKind } from "./brokerage-request";

/** The email to the admins. Plain text, everything a person needs to call back. */
export function brokerageRequestEmail(input: {
  kind: BrokerageRequestKind;
  province: string | null;
  orgName: string | null;
  orgId: string;
  propertyId: string;
  address: string | null;
  rentCents: number | null;
  requesterEmail: string | null;
  values: BrokerageRequestInput;
  appUrl: string;
}): { subject: string; body: string } {
  const what =
    input.kind === "realtor_ca_listing"
      ? "an Ontario Realtor.ca listing through a partner agent"
      : `a local agent referral (${input.province ?? "province unknown"})`;
  const rent =
    input.rentCents != null && Number.isFinite(input.rentCents)
      ? `$${Math.round(input.rentCents / 100).toLocaleString()} a month`
      : "rent not set";
  const lines = [
    `${input.orgName || "An account"} asked for ${what}.`,
    "",
    `Rental: ${input.address || "address not set"} (${rent})`,
    `Rental page: ${input.appUrl}/dashboard/properties/${input.propertyId}`,
    `Account: ${input.orgName || input.orgId} (${input.orgId})`,
    `Asked by: ${input.requesterEmail || "unknown login"}`,
    "",
    `Contact name: ${input.values.contactName || "not given"}`,
    `Phone: ${input.values.contactPhone || "not given"}`,
    `Email: ${input.values.contactEmail || "not given"}`,
    `Note: ${input.values.note || "none"}`,
    "",
    "Next: call or email them within one business day. Before any MLS upload:",
    "a signed representation agreement, written owner consent for the listing and",
    "photos, and the two-roles disclosure. The fee is billed by the brokerage,",
    "never by Vacantless. Mark the request contacted in the app when done.",
  ];
  return {
    subject: `Realtor.ca request: ${input.address || input.orgName || input.orgId}`,
    body: lines.join("\n"),
  };
}

