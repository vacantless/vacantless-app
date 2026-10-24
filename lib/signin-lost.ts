// S736: the email a landlord gets when Kijiji, Zumper or Rentals.ca signs them
// out (worker session check: alive=false, needs_login). Without it, posting to
// that site stopped quietly until they looked at the site tiles. Pure, tested
// in scripts/test-signin-lost.ts; the 15-minute sweep is
// app/api/cron/signin-lost.

export const SIGNIN_LOST_CODES = ["needs_login", "no_session"] as const;

export type SigninLostRow = {
  alive: boolean | null;
  lastCheckCode: string | null;
  lostNotifiedAt: string | null;
};

/** "notify" once per sign-out, "clear" once it works again, else nothing. Pure. */
export function signinLostAction(row: SigninLostRow): "notify" | "clear" | "none" {
  const lost = row.alive === false && (SIGNIN_LOST_CODES as readonly string[]).includes(row.lastCheckCode ?? "");
  if (lost) return row.lostNotifiedAt ? "none" : "notify";
  if (row.alive === true && row.lostNotifiedAt) return "clear";
  return "none";
}

export function signinLostEmail(input: { siteLabel: string; orgName: string | null }): {
  subject: string;
  body: string;
  actionLabel: string;
} {
  const site = input.siteLabel;
  return {
    subject: `Sign in to ${site} again`,
    body:
      `${site} signed ${input.orgName || "your account"} out.\n` +
      `Until you sign in again, we cannot post your rentals on ${site}.\n` +
      "Your other sites keep working.\n\n" +
      "Press the button below and sign in. It takes about a minute.",
    actionLabel: `Sign in to ${site}`,
  };
}
