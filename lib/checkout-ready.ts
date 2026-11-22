// S829c: the email a landlord gets when the robot leaves a paid ad waiting at
// a site's checkout, and one reminder if it is still unpaid. Noam, 2026-11-22:
// "people will walk away and leave before checking out". Pure, tested in
// scripts/test-s829c-checkout-ready.ts; the sweep is
// app/api/cron/checkout-ready. S829f: the database calls it the moment an ad
// reaches checkout (migration 0320), so the email no longer waits 15 minutes.

/** Remind once, this long after the first email, if still unpaid. */
export const CHECKOUT_REMIND_AFTER_MS = 4 * 60 * 60 * 1000;

export type CheckoutReadyRow = {
  /** siteCheckoutUrl(publish_status, operator_action_url): null = not at checkout. */
  checkoutUrl: string | null;
  notifiedAt: string | null;
  remindedAt: string | null;
};

/** "notify", then one "remind", "clear" once the ad left checkout, else "none". */
export function checkoutReadyAction(row: CheckoutReadyRow, now: number): "notify" | "remind" | "clear" | "none" {
  if (!row.checkoutUrl) return row.notifiedAt || row.remindedAt ? "clear" : "none";
  if (!row.notifiedAt) return "notify";
  if (row.remindedAt) return "none";
  const sent = Date.parse(row.notifiedAt);
  if (!Number.isFinite(sent)) return "none";
  return now - sent >= CHECKOUT_REMIND_AFTER_MS ? "remind" : "none";
}

/**
 * S829f: which site account to sign in to before paying. A checkout only shows
 * the ad to the account that built it (Noam's Chrome was on another Kijiji
 * account on 2026-11-22 and the pay step dead-ended).
 */
export function checkoutAccountLine(siteLabel: string, accountLabel: string | null | undefined): string {
  const label = (accountLabel ?? "").trim();
  const first = label
    ? `Sign in to ${siteLabel} as ${label} first.`
    : `Sign in to ${siteLabel} with the account you connected to Vacantless.`;
  return `${first} Another ${siteLabel} account will not show this ad.`;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function checkoutReadyEmail(input: {
  siteLabel: string;
  where: string;
  priceCents: number | null;
  reminder: boolean;
  accountLabel?: string | null;
}): { subject: string; body: string; actionLabel: string } {
  const pay = input.priceCents ? `Pay ${dollars(input.priceCents)}` : "Pay the fee";
  const subject = input.reminder
    ? `Still waiting: your ${input.siteLabel} ad for ${input.where}`
    : `Your ${input.siteLabel} ad for ${input.where} is ready to pay`;
  const body = [
    input.reminder
      ? `Your ${input.siteLabel} ad for ${input.where} is still waiting at checkout.`
      : `Your ${input.siteLabel} ad for ${input.where} is built and waiting at checkout.`,
    `${pay} and it goes up.`,
    "Nothing is charged until you press Pay.",
    "",
    checkoutAccountLine(input.siteLabel, input.accountLabel),
    "",
    "Press the button below. The rental page shows how to pay.",
  ].join("\n");
  return { subject, body, actionLabel: `Pay for the ${input.siteLabel} ad` };
}
