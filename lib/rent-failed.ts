// S835b (REVIEW-S835 finding 5): the email an owner gets when a tenant's
// monthly rent debit fails on Stripe. Pure, so it is unit-tested; the send is
// lib/rent-failed-notify.ts.

import { ROTESSA } from "@/lib/rent-rail-costs";

export type RentRail = "stripe" | "rotessa";

export function rentFailedEmail(input: {
  tenantName: string | null;
  address: string | null;
  amountLabel: string | null;
  /** S835d: where the debit ran. Stripe when not given. */
  rail?: RentRail;
}): { subject: string; body: string; actionLabel: string } {
  const rotessa = input.rail === "rotessa";
  const who = (input.tenantName ?? "").trim() || "Your tenant";
  const where = (input.address ?? "").trim();
  const amount = (input.amountLabel ?? "").trim();
  const subject = where ? `Rent payment did not go through: ${where}` : "A rent payment did not go through";
  const first = `${who}'s rent payment${amount ? ` of ${amount}` : ""}${where ? ` for ${where}` : ""} did not go through. The bank debit failed.`;
  return {
    subject,
    body: [
      first,
      rotessa
        ? "Talk to your tenant, and open their page to see the NSF charge."
        : "Stripe may try the debit again. Talk to your tenant, and open their page to see the payment.",
      rotessa
        ? `Rotessa bills you $${ROTESSA.nsfCents / 100} for an NSF or stopped payment. It is on their page as an NSF charge and in your expenses.`
        : "Stripe charges its failed payment fee on your Stripe account.",
    ].join("\n\n"),
    actionLabel: "Open the tenant",
  };
}
