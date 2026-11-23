// S835b (REVIEW-S835 finding 5): the email an owner gets when a tenant's
// monthly rent debit fails on Stripe. Pure, so it is unit-tested; the send is
// lib/rent-failed-notify.ts.

export function rentFailedEmail(input: {
  tenantName: string | null;
  address: string | null;
  amountLabel: string | null;
}): { subject: string; body: string; actionLabel: string } {
  const who = (input.tenantName ?? "").trim() || "Your tenant";
  const where = (input.address ?? "").trim();
  const amount = (input.amountLabel ?? "").trim();
  const subject = where ? `Rent payment did not go through: ${where}` : "A rent payment did not go through";
  const first = `${who}'s rent payment${amount ? ` of ${amount}` : ""}${where ? ` for ${where}` : ""} did not go through. The bank debit failed.`;
  return {
    subject,
    body: [
      first,
      "Stripe may try the debit again. Talk to your tenant, and open their page to see the payment.",
      "Stripe charges its failed payment fee on your Stripe account.",
    ].join("\n\n"),
    actionLabel: "Open the tenant",
  };
}
